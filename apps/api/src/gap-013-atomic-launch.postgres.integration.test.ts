import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MatchLaunchRequestSchema } from "@tab10/shared";
import { FakeClock } from "@tab10/test-utils";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { buildApp } from "./app.js";
import { createPostgresDb, type Db } from "./db/client.js";
import { runPostgresMigrations } from "./db/migrations.js";
import { resolveTestDatabaseUrl } from "./db/test-database-url.js";
import {
  authSessions,
  matchLaunchRequests,
  matches,
  users,
} from "./db/schema.js";
import * as schema from "./db/schema.js";

const databaseUrl = resolveTestDatabaseUrl(process.env, {
  required: process.env.REQUIRE_TEST_DATABASE_URL === "1",
});
const postgresSuite = databaseUrl ? describe : describe.skip;
const clock = new FakeClock(new Date("2026-10-03T12:00:00.000Z"));
const id = (suffix: number) =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const ADMIN = id(13999);

async function waitUntilBlocked(observer: postgres.Sql, applicationName: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
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
  throw new Error(`${applicationName} did not block on a database lock`);
}

postgresSuite.sequential("GAP-013 PostgreSQL atomic launch serialization", () => {
  const clients: postgres.Sql[] = [];
  const apps: Array<Awaited<ReturnType<typeof buildApp>>["app"]> = [];
  let db: Db;
  let closeDb: () => Promise<void>;

  function isolated(
    applicationName: string,
    randomIndex: (length: number) => number = () => 0,
  ) {
    const client = postgres(databaseUrl!, {
      max: 1,
      connection: { application_name: applicationName },
    });
    clients.push(client);
    return buildApp({
      db: drizzle(client, { schema }) as unknown as Db,
      clock,
      randomIndex,
    }).then((built) => {
      apps.push(built.app);
      return built;
    });
  }

  async function holdUser(userId: string) {
    const blocker = postgres(databaseUrl!, { max: 1 });
    const observer = postgres(databaseUrl!, { max: 1 });
    clients.push(blocker, observer);
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const heldReady = new Promise<void>((resolve) => { ready = resolve; });
    const held = blocker.begin(async (transaction) => {
      await transaction`select id from users where id = ${userId} for update`;
      ready();
      await gate;
    });
    await heldReady;
    return { observer, release, held };
  }

  async function pauseReceipts(advisoryKey: number) {
    const control = postgres(databaseUrl!, { max: 1 });
    const observer = postgres(databaseUrl!, { max: 1 });
    clients.push(control, observer);
    await control.unsafe(`
      CREATE OR REPLACE FUNCTION gap013_pause_receipt() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(${advisoryKey});
        RETURN NEW;
      END;
      $$;
      DROP TRIGGER IF EXISTS gap013_pause_receipt_trigger ON match_launch_requests;
      CREATE TRIGGER gap013_pause_receipt_trigger
        BEFORE INSERT ON match_launch_requests
        FOR EACH ROW EXECUTE FUNCTION gap013_pause_receipt();
    `);
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const heldReady = new Promise<void>((resolve) => { ready = resolve; });
    const held = control.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(${advisoryKey})`;
      ready();
      await gate;
    });
    await heldReady;
    return {
      observer,
      release,
      held,
      cleanup: () => control.unsafe(`
        DROP TRIGGER IF EXISTS gap013_pause_receipt_trigger ON match_launch_requests;
        DROP FUNCTION IF EXISTS gap013_pause_receipt();
      `),
    };
  }

  const sessionId = (actorSuffix: number) => id(actorSuffix + 10_000);
  const request = (
    requestSuffix: number,
    playerA: string,
    playerB: string,
    method: "manual" | "random" = "manual",
  ) => MatchLaunchRequestSchema.parse({
    requestId: id(requestSuffix),
    format: "1v1",
    firstServerMethod: method,
    ...(method === "manual" ? { firstServerSlot: "A1" } : {}),
    roster: { A1: { userId: playerA }, B1: { userId: playerB } },
  });

  beforeAll(async () => {
    const reset = postgres(databaseUrl!, { max: 1 });
    try {
      await reset.unsafe(
        "DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public",
      );
    } finally {
      await reset.end({ timeout: 5 });
    }
    await runPostgresMigrations(databaseUrl!, "apply");
    const context = await createPostgresDb(databaseUrl!);
    db = context.db;
    closeDb = context.close;

    const actorSuffixes = [
      13100, 13200, 13210,
      13400, 13410, 13420, 13430, 13440, 13450,
    ];
    const playerSuffixes = [
      13101, 13102,
      13201, 13202, 13203,
      13401, 13402, 13411, 13412, 13421, 13422,
      13431, 13432, 13441, 13442, 13451, 13452,
    ];
    const userIds = [ADMIN, ...actorSuffixes.map(id), ...playerSuffixes.map(id)];
    await db.insert(users).values(userIds.map((userId, index) => ({
      id: userId,
      email: `gap013-pg-${index}@test.local`,
      passwordHash: "x",
      firstName: `User${index}`,
      lastName: "GAP013",
      role: userId === ADMIN ? "admin" as const : "user" as const,
      mustChangePassword: false,
    })));
    await db.insert(authSessions).values(actorSuffixes.map((suffix) => ({
      id: sessionId(suffix),
      userId: id(suffix),
      tokenHash: `gap013-${suffix}`,
      expiresAt: new Date("2026-10-04T12:00:00.000Z"),
    })));
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await Promise.all(clients.map((client) => client.end({ timeout: 5 })));
    await closeDb?.();
  });

  it("serializes duplicate keys and invokes random selection once", async () => {
    const actor = id(13100);
    const launchRequest = request(13190, id(13101), id(13102), "random");
    const lock = await holdUser(actor);
    let randomCalls = 0;
    const first = await isolated("gap013_same_key_first", () => {
      randomCalls += 1;
      return 0;
    });
    const second = await isolated("gap013_same_key_second", () => {
      randomCalls += 1;
      return 1;
    });
    const input = { actorUserId: actor, authSessionId: sessionId(13100), request: launchRequest };
    const firstPromise = first.services.matches.launchMatch(input);
    await waitUntilBlocked(lock.observer, "gap013_same_key_first");
    const secondPromise = second.services.matches.launchMatch(input);
    await waitUntilBlocked(lock.observer, "gap013_same_key_second");
    lock.release();
    await lock.held;

    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);
    expect(secondResult).toEqual(firstResult);
    expect(randomCalls).toBe(1);
    expect(await db.query.matchLaunchRequests.findMany({
      where: eq(matchLaunchRequests.requestId, launchRequest.requestId),
    })).toHaveLength(1);
    expect(await db.query.matches.findMany({
      where: eq(matches.id, firstResult.matchId),
    })).toHaveLength(1);
  });

  it("uses stable UUID lock order for two actors sharing a player and rolls the loser back", async () => {
    const shared = id(13201);
    const lowActor = id(13200);
    const highActor = id(13210);
    const lowRequest = request(13290, shared, id(13202));
    const highRequest = request(13291, id(13203), shared);
    const lock = await holdUser(shared);
    const low = await isolated("gap013_shared_low_actor");
    const high = await isolated("gap013_shared_high_actor");
    const lowPromise = low.services.matches.launchMatch({
      actorUserId: lowActor,
      authSessionId: sessionId(13200),
      request: lowRequest,
    });
    const highPromise = high.services.matches.launchMatch({
      actorUserId: highActor,
      authSessionId: sessionId(13210),
      request: highRequest,
    });
    await waitUntilBlocked(lock.observer, "gap013_shared_low_actor");
    await waitUntilBlocked(lock.observer, "gap013_shared_high_actor");
    lock.release();
    await lock.held;

    const results = await Promise.allSettled([lowPromise, highPromise]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "PLAYER_BUSY" });
    expect(await db.query.matchLaunchRequests.findMany({
      where: inArray(matchLaunchRequests.requestId, [lowRequest.requestId, highRequest.requestId]),
    })).toHaveLength(1);
    const actorsWithMatches = await db.select({ actor: matches.createdByUserId })
      .from(matches)
      .where(inArray(matches.createdByUserId, [lowActor, highActor]));
    expect(actorsWithMatches).toHaveLength(1);
  });

  it("lets logout, block and role change win before launch with zero partial writes", async () => {
    const cases = [
      { kind: "logout", actor: 13400, players: [13401, 13402], request: 13490, code: "UNAUTHORIZED" },
      { kind: "block", actor: 13410, players: [13411, 13412], request: 13491, code: "FORBIDDEN" },
      { kind: "role", actor: 13420, players: [13421, 13422], request: 13492, code: "UNAUTHORIZED" },
    ] as const;

    for (const scenario of cases) {
      const actor = id(scenario.actor);
      const lock = await holdUser(actor);
      const mutator = await isolated(`gap013_${scenario.kind}_wins_mutator`);
      const launcher = await isolated(`gap013_${scenario.kind}_loses_launch`);
      let mutation: Promise<unknown>;
      if (scenario.kind === "logout") {
        await mutator.services.auth.logout(sessionId(scenario.actor));
        mutation = Promise.resolve();
      } else if (scenario.kind === "block") {
        mutation = mutator.services.auth.blockUser(ADMIN, actor);
        await waitUntilBlocked(lock.observer, `gap013_${scenario.kind}_wins_mutator`);
      } else {
        mutation = mutator.services.auth.updateAdminUser(ADMIN, actor, { role: "admin" });
        await waitUntilBlocked(lock.observer, `gap013_${scenario.kind}_wins_mutator`);
      }
      const launchRequest = request(
        scenario.request,
        id(scenario.players[0]),
        id(scenario.players[1]),
      );
      const launch = launcher.services.matches.launchMatch({
        actorUserId: actor,
        authSessionId: sessionId(scenario.actor),
        request: launchRequest,
      });
      await waitUntilBlocked(lock.observer, `gap013_${scenario.kind}_loses_launch`);
      lock.release();
      await lock.held;
      await mutation;
      await expect(launch).rejects.toMatchObject({ code: scenario.code });
      expect(await db.query.matchLaunchRequests.findMany({
        where: eq(matchLaunchRequests.requestId, launchRequest.requestId),
      })).toHaveLength(0);
      expect(await db.query.matches.findMany({
        where: eq(matches.createdByUserId, actor),
      })).toHaveLength(0);
    }
  });

  it("commits launch before logout, block and role change then preserves authoritative history", async () => {
    const cases = [
      { kind: "logout", actor: 13430, players: [13431, 13432], request: 13493, advisory: 134930 },
      { kind: "block", actor: 13440, players: [13441, 13442], request: 13494, advisory: 134940 },
      { kind: "role", actor: 13450, players: [13451, 13452], request: 13495, advisory: 134950 },
    ] as const;

    for (const scenario of cases) {
      const actor = id(scenario.actor);
      const launchRequest = request(
        scenario.request,
        id(scenario.players[0]),
        id(scenario.players[1]),
      );
      const pause = await pauseReceipts(scenario.advisory);
      const launcher = await isolated(`gap013_${scenario.kind}_wins_launch`);
      const mutator = await isolated(`gap013_${scenario.kind}_after_launch`);
      const launch = launcher.services.matches.launchMatch({
        actorUserId: actor,
        authSessionId: sessionId(scenario.actor),
        request: launchRequest,
      });
      await waitUntilBlocked(pause.observer, `gap013_${scenario.kind}_wins_launch`);
      const mutation = scenario.kind === "logout"
        ? mutator.services.auth.logout(sessionId(scenario.actor))
        : scenario.kind === "block"
          ? mutator.services.auth.blockUser(ADMIN, actor)
          : mutator.services.auth.updateAdminUser(ADMIN, actor, { role: "admin" });
      await waitUntilBlocked(pause.observer, `gap013_${scenario.kind}_after_launch`);
      pause.release();
      await pause.held;
      const launched = await launch;
      await mutation;
      await pause.cleanup();

      expect(await db.query.matchLaunchRequests.findFirst({
        where: eq(matchLaunchRequests.requestId, launchRequest.requestId),
      })).toMatchObject({ matchId: launched.matchId });
      expect(await db.query.matches.findFirst({
        where: eq(matches.id, launched.matchId),
      })).toMatchObject({ status: "in_progress", createdByUserId: actor });
      expect(await db.query.authSessions.findFirst({
        where: and(
          eq(authSessions.id, sessionId(scenario.actor)),
          eq(authSessions.userId, actor),
        ),
      })).toMatchObject({ revokedAt: expect.any(Date) });
    }
  });
});
