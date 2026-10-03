import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MatchLaunchRequestSchema } from "@tab10/shared";
import { FakeClock } from "@tab10/test-utils";
import { isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { createPostgresDb, type Db } from "./db/client.js";
import { runPostgresMigrations } from "./db/migrations.js";
import { resolveTestDatabaseUrl } from "./db/test-database-url.js";
import { authSessions, users } from "./db/schema.js";
import * as schema from "./db/schema.js";
import { MatchService } from "./modules/matches/match-service.js";

const databaseUrl = resolveTestDatabaseUrl(process.env, { required: true });
const clock = new FakeClock(new Date("2026-10-03T12:00:00.000Z"));
const ACTOR = "00000000-0000-4000-8000-000000032301";
const PLAYER_A = "00000000-0000-4000-8000-000000032302";
const PLAYER_B = "00000000-0000-4000-8000-000000032303";
const AUTH_SESSION = "00000000-0000-4000-8000-000000032311";
const REQUEST_ID = "00000000-0000-4000-8000-000000032321";

type NamedConnection = {
  applicationName: string;
  client: Sql;
  service: MatchService;
};

type ScoreMutation =
  | { kind: "point"; side: "A" | "B"; key: string }
  | { kind: "undo"; key: string }
  | {
      kind: "correction";
      scoreA: number;
      scoreB: number;
      serverIndex: number;
      key: string;
    };

function fixtureUuid(suffix: number) {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}

async function waitUntilBlocked(observer: Sql, applicationName: string) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const [row] = await observer<{ blocked: boolean }[]>`
      select exists (
        select 1 from pg_stat_activity
        where application_name = ${applicationName}
          and wait_event_type = 'Lock'
      ) as blocked
    `;
    if (row?.blocked) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`${applicationName} did not reach the PostgreSQL lock barrier`);
}

function errorChainMessages(error: unknown) {
  const messages: string[] = [];
  const visited = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    if ("message" in current && typeof current.message === "string") {
      messages.push(current.message);
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return messages;
}

describe.sequential("GAP-032 PostgreSQL match-fact serialization", () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let setup: MatchService;
  const clients: Sql[] = [];

  function isolated(name: string): NamedConnection {
    const client = postgres(databaseUrl, {
      max: 1,
      connection: { application_name: name },
    });
    clients.push(client);
    return {
      applicationName: name,
      client,
      service: new MatchService(
        drizzle(client, { schema }) as unknown as Db,
        clock,
        () => 0,
      ),
    };
  }

  beforeAll(async () => {
    const reset = postgres(databaseUrl, { max: 1 });
    try {
      await reset.unsafe(
        "DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public",
      );
    } finally {
      await reset.end({ timeout: 5 });
    }
    await runPostgresMigrations(databaseUrl, "apply");
    const context = await createPostgresDb(databaseUrl);
    db = context.db;
    closeDb = context.close;
    setup = new MatchService(db, clock, () => 0);
    await db.insert(users).values([
      { id: ACTOR, email: "actor@gap032.pg", passwordHash: "x", firstName: "Actor", lastName: "Judge", mustChangePassword: false },
      { id: PLAYER_A, email: "a@gap032.pg", passwordHash: "x", firstName: "Player", lastName: "A", mustChangePassword: false },
      { id: PLAYER_B, email: "b@gap032.pg", passwordHash: "x", firstName: "Player", lastName: "B", mustChangePassword: false },
    ]);
    await db.insert(authSessions).values({
      id: AUTH_SESSION,
      userId: ACTOR,
      tokenHash: "gap032-pg-session",
      expiresAt: new Date("2026-10-04T12:00:00.000Z"),
    });
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.end({ timeout: 5 })));
    await closeDb?.();
  });

  afterEach(async () => {
    await db
      .update(schema.judgeSessions)
      .set({ releasedAt: clock.now(), reservedForUserId: null })
      .where(isNull(schema.judgeSessions.releasedAt));
  });

  async function launchGuestMatch(requestSuffix: number, pointsToWin = 11) {
    const launch = await setup.launchMatch({
      actorUserId: ACTOR,
      authSessionId: AUTH_SESSION,
      request: MatchLaunchRequestSchema.parse({
        requestId: fixtureUuid(requestSuffix),
        format: "1v1",
        pointsToWin,
        mercyEnabled: false,
        firstServerMethod: "manual",
        firstServerSlot: "A1",
        roster: {
          A1: { guestFirstName: `A${requestSuffix}`, guestLastName: "Guest" },
          B1: { guestFirstName: `B${requestSuffix}`, guestLastName: "Guest" },
        },
      }),
    });
    const match = await setup.getMatch(launch.matchId);
    expect(match).toBeDefined();
    return { matchId: launch.matchId, match: match! };
  }

  async function runMutation(
    connection: NamedConnection,
    fixture: Awaited<ReturnType<typeof launchGuestMatch>>,
    expectedVersion: number,
    mutation: ScoreMutation,
  ) {
    const common = {
      matchId: fixture.matchId,
      expectedVersion,
      idempotencyKey: mutation.key,
      judgeUserId: ACTOR,
      authSessionId: AUTH_SESSION,
    };
    if (mutation.kind === "point") {
      return connection.service.awardPoint({ ...common, side: mutation.side });
    }
    if (mutation.kind === "undo") {
      return connection.service.undoPoint(common);
    }
    return connection.service.manualCorrection({
      ...common,
      scoreA: mutation.scoreA,
      scoreB: mutation.scoreB,
      currentServerParticipantId: fixture.match.participants[mutation.serverIndex]!.id,
    });
  }

  async function runOrderedMutations(
    matchId: string,
    first: { connection: NamedConnection; run: () => Promise<unknown> },
    second: { connection: NamedConnection; run: () => Promise<unknown> },
  ) {
    const blocker = postgres(databaseUrl, { max: 1 });
    const observer = postgres(databaseUrl, { max: 1 });
    clients.push(blocker, observer);

    let releaseBlocker!: () => void;
    const blockerGate = new Promise<void>((resolve) => { releaseBlocker = resolve; });
    let rowLocked!: () => void;
    const rowLockedGate = new Promise<void>((resolve) => { rowLocked = resolve; });
    const blockerPromise = blocker.begin(async (transaction) => {
      await transaction`select id from matches where id = ${matchId} for update`;
      rowLocked();
      await blockerGate;
    });
    void blockerPromise.catch(() => undefined);
    await rowLockedGate;

    let firstPromise: Promise<unknown> | undefined;
    let secondPromise: Promise<unknown> | undefined;
    let barrierError: unknown;
    try {
      firstPromise = first.run();
      void firstPromise.catch(() => undefined);
      await waitUntilBlocked(observer, first.connection.applicationName);
      secondPromise = second.run();
      void secondPromise.catch(() => undefined);
      await waitUntilBlocked(observer, second.connection.applicationName);
    } catch (error) {
      barrierError = error;
    } finally {
      releaseBlocker();
    }

    const blockerResult = await Promise.allSettled([blockerPromise]);
    const outcomes = await Promise.allSettled(
      [firstPromise, secondPromise].filter((promise) => promise !== undefined),
    );
    if (barrierError) throw barrierError;
    if (blockerResult[0]!.status === "rejected") throw blockerResult[0]!.reason;
    if (!firstPromise || !secondPromise) {
      throw new Error("both ordered mutations must reach the PostgreSQL lock barrier");
    }
    return outcomes as [
      PromiseSettledResult<Awaited<ReturnType<MatchService["getMatch"]>>>,
      PromiseSettledResult<Awaited<ReturnType<MatchService["getMatch"]>>>,
    ];
  }

  async function readPersistedMatch(matchId: string) {
    const row = await db.query.matches.findFirst({
      where: (match, { eq }) => eq(match.id, matchId),
    });
    expect(row).toBeDefined();
    return row!;
  }

  it("allows one concurrent revert and never restarts the authoritative clock twice", async () => {
    const launch = await setup.launchMatch({
      actorUserId: ACTOR,
      authSessionId: AUTH_SESSION,
      request: MatchLaunchRequestSchema.parse({
        requestId: REQUEST_ID,
        format: "1v1",
        pointsToWin: 2,
        mercyEnabled: false,
        firstServerMethod: "manual",
        firstServerSlot: "A1",
        roster: { A1: { userId: PLAYER_A }, B1: { userId: PLAYER_B } },
      }),
    });
    clock.advanceMs(1_000);
    await setup.awardPoint({
      matchId: launch.matchId,
      side: "A",
      expectedVersion: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000032331",
      judgeUserId: ACTOR,
      authSessionId: AUTH_SESSION,
    });
    clock.advanceMs(1_000);
    await setup.awardPoint({
      matchId: launch.matchId,
      side: "A",
      expectedVersion: 1,
      idempotencyKey: "00000000-0000-4000-8000-000000032332",
      judgeUserId: ACTOR,
      authSessionId: AUTH_SESSION,
    });

    const first = isolated("gap032_revert_first");
    const second = isolated("gap032_revert_second");
    const results = await Promise.allSettled([
      first.service.revertFinish({
        matchId: launch.matchId,
        judgeUserId: ACTOR,
        authSessionId: AUTH_SESSION,
      }),
      second.service.revertFinish({
        matchId: launch.matchId,
        judgeUserId: ACTOR,
        authSessionId: AUTH_SESSION,
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    clock.advanceMs(5_000);
    const visible = await setup.getVisibleMatch(launch.matchId, ACTOR);
    expect(visible).toMatchObject({
      status: "in_progress",
      version: 3,
      matchFacts: {
        playingClock: {
          state: "available",
          elapsedMs: 7_000,
          running: true,
          asOf: "2026-10-03T12:00:07.000Z",
        },
      },
    });
  });

  it.each([
    {
      name: "point before Undo",
      requestSuffix: 32401,
      seedKey: fixtureUuid(32501),
      first: { kind: "point", side: "B", key: fixtureUuid(32601) },
      second: { kind: "undo", key: fixtureUuid(32701) },
    },
    {
      name: "Undo before point",
      requestSuffix: 32402,
      seedKey: fixtureUuid(32502),
      first: { kind: "undo", key: fixtureUuid(32702) },
      second: { kind: "point", side: "B", key: fixtureUuid(32602) },
    },
    {
      name: "point before manual correction",
      requestSuffix: 32403,
      first: { kind: "point", side: "A", key: fixtureUuid(32603) },
      second: {
        kind: "correction",
        scoreA: 4,
        scoreB: 2,
        serverIndex: 1,
        key: fixtureUuid(32803),
      },
    },
    {
      name: "manual correction before point",
      requestSuffix: 32404,
      first: {
        kind: "correction",
        scoreA: 4,
        scoreB: 2,
        serverIndex: 1,
        key: fixtureUuid(32804),
      },
      second: { kind: "point", side: "A", key: fixtureUuid(32604) },
    },
  ] satisfies Array<{
    name: string;
    requestSuffix: number;
    seedKey?: string;
    first: ScoreMutation;
    second: ScoreMutation;
  }>)("$name serializes deterministically without loser fact leakage", async (scenario) => {
    const fixture = await launchGuestMatch(scenario.requestSuffix);
    if (scenario.seedKey) {
      await setup.awardPoint({
        matchId: fixture.matchId,
        side: "A",
        expectedVersion: 0,
        idempotencyKey: scenario.seedKey,
        judgeUserId: ACTOR,
        authSessionId: AUTH_SESSION,
      });
    }
    const before = (await setup.getMatch(fixture.matchId))!;
    fixture.match = before;
    const beforeFacts = (await setup.getVisibleMatch(fixture.matchId, ACTOR))!.matchFacts;
    const judgeSession = await db.query.judgeSessions.findFirst({
      where: (session, { eq }) => eq(session.matchId, fixture.matchId),
    });
    expect(judgeSession).toBeDefined();

    const firstConnection = isolated(`gap032-first-${scenario.requestSuffix}`);
    const secondConnection = isolated(`gap032-second-${scenario.requestSuffix}`);
    const [firstResult, secondResult] = await runOrderedMutations(
      fixture.matchId,
      {
        connection: firstConnection,
        run: () => runMutation(firstConnection, fixture, before.version, scenario.first),
      },
      {
        connection: secondConnection,
        run: () => runMutation(secondConnection, fixture, before.version, scenario.second),
      },
    );

    if (firstResult.status !== "fulfilled") throw firstResult.reason;
    expect(secondResult.status).toBe("rejected");
    if (secondResult.status !== "rejected") {
      throw new Error("second ordered mutation unexpectedly fulfilled");
    }
    expect(secondResult.reason).toMatchObject({
      code: "VERSION_CONFLICT",
      state: { version: before.version + 1 },
    });

    const persisted = await readPersistedMatch(fixture.matchId);
    const firstValue = firstResult.value!;
    expect(persisted).toMatchObject({
      scoreA: firstValue.scoreA,
      scoreB: firstValue.scoreB,
      status: firstValue.status,
      winnerSide: firstValue.winnerSide,
      version: before.version + 1,
      currentServerParticipantId: firstValue.currentServerParticipantId,
      serveSequenceIndex: firstValue.serveSequenceIndex,
      eventLog: firstValue.eventLog,
      idempotencyKeys: firstValue.idempotencyKeys,
      initialServerParticipantId: before.initialServerParticipantId,
      playingElapsedMs: before.playingElapsedMs,
      playingSegmentStartedAt: before.playingSegmentStartedAt,
      judgeHistoryComplete: before.judgeHistoryComplete,
    });
    const eventLog = persisted.eventLog as Array<Record<string, unknown>>;
    const winnerStoredKey = scenario.first.kind === "correction"
      ? `manual-correction:${scenario.first.key}`
      : scenario.first.key;
    const loserStoredKey = scenario.second.kind === "correction"
      ? `manual-correction:${scenario.second.key}`
      : scenario.second.key;
    expect(eventLog.find((event) => event.idempotencyKey === winnerStoredKey)).toMatchObject({
      type: scenario.first.kind === "point"
        ? "point_awarded"
        : scenario.first.kind === "undo"
          ? "point_undone"
          : "manual_correction",
      occurredAt: clock.now().toISOString(),
      actorUserId: ACTOR,
      judgeSessionId: judgeSession!.id,
    });
    expect(eventLog.some((event) => event.idempotencyKey === loserStoredKey)).toBe(false);
    expect(persisted.idempotencyKeys).not.toContain(loserStoredKey);
    expect((await setup.getVisibleMatch(fixture.matchId, ACTOR))!.matchFacts).toEqual(beforeFacts);
  });

  it("rolls back score, event provenance, version, and clock after an injected post-update failure", async () => {
    const fixture = await launchGuestMatch(32405, 2);
    await setup.awardPoint({
      matchId: fixture.matchId,
      side: "A",
      expectedVersion: 0,
      idempotencyKey: fixtureUuid(32505),
      judgeUserId: ACTOR,
      authSessionId: AUTH_SESSION,
    });
    const before = await readPersistedMatch(fixture.matchId);
    const failureKey = fixtureUuid(32905);
    const trigger = postgres(databaseUrl, {
      max: 1,
      connection: { application_name: "gap032-post-update-failure" },
    });
    clients.push(trigger);
    await trigger.unsafe(`
      create or replace function gap032_fail_after_match_update()
      returns trigger language plpgsql as $$
      begin
        if NEW.idempotency_keys @> '["${failureKey}"]'::jsonb then
          raise exception 'GAP032 forced post-update failure';
        end if;
        return NEW;
      end;
      $$;
      create trigger gap032_fail_after_match_update_trigger
      after update on matches
      for each row execute function gap032_fail_after_match_update();
    `);

    clock.advanceMs(3_000);
    let injectedFailure: unknown;
    try {
      try {
        await setup.awardPoint({
          matchId: fixture.matchId,
          side: "A",
          expectedVersion: 1,
          idempotencyKey: failureKey,
          judgeUserId: ACTOR,
          authSessionId: AUTH_SESSION,
        });
      } catch (error) {
        injectedFailure = error;
      }
    } finally {
      await trigger.unsafe(`
        drop trigger if exists gap032_fail_after_match_update_trigger on matches;
        drop function if exists gap032_fail_after_match_update();
      `);
    }
    expect(injectedFailure).toBeDefined();
    expect(errorChainMessages(injectedFailure).join("\n"))
      .toContain("GAP032 forced post-update failure");

    const after = await readPersistedMatch(fixture.matchId);
    expect(after).toMatchObject({
      scoreA: before.scoreA,
      scoreB: before.scoreB,
      status: before.status,
      winnerSide: before.winnerSide,
      version: before.version,
      currentServerParticipantId: before.currentServerParticipantId,
      serveSequenceIndex: before.serveSequenceIndex,
      eventLog: before.eventLog,
      idempotencyKeys: before.idempotencyKeys,
      initialServerParticipantId: before.initialServerParticipantId,
      playingElapsedMs: before.playingElapsedMs,
      playingSegmentStartedAt: before.playingSegmentStartedAt,
      judgeHistoryComplete: before.judgeHistoryComplete,
      updatedAt: before.updatedAt,
    });
    expect((after.eventLog as Array<Record<string, unknown>>).some(
      (event) => event.idempotencyKey === failureKey,
    )).toBe(false);
    expect(after.idempotencyKeys).not.toContain(failureKey);
    expect((await setup.getVisibleMatch(fixture.matchId, ACTOR))!.matchFacts.playingClock)
      .toMatchObject({ state: "available", elapsedMs: 3_000, running: true });
  });
});
