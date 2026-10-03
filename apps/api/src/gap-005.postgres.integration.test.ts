import { FakeClock } from "@tab10/test-utils";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppServices } from "./app.js";
import { createPostgresDb, type Db } from "./db/client.js";
import { runPostgresMigrations } from "./db/migrations.js";
import * as schema from "./db/schema.js";
import { MatchService } from "./modules/matches/match-service.js";
import { resolveTestDatabaseUrl } from "./db/test-database-url.js";

const databaseUrl = resolveTestDatabaseUrl(process.env, { required: true });
const clock = new FakeClock(new Date("2026-09-07T12:00:00.000Z"));

type UserFixture = { id: string; cookie: string };
type NamedConnection = {
  applicationName: string;
  client: Sql;
  db: Db;
  service: MatchService;
};

type ScoreMutation =
  | { kind: "point"; key: string; side: "A" | "B" }
  | {
      kind: "correction";
      key: string;
      scoreA: number;
      scoreB: number;
      serverIndex: number;
    };

function namedConnection(name: string): NamedConnection {
  const client = postgres(databaseUrl!, {
    max: 1,
    connection: { application_name: name },
  });
  const db = drizzle(client, { schema }) as unknown as Db;
  return {
    applicationName: name,
    client,
    db,
    service: new MatchService(db, clock),
  };
}

async function acceptRequiredPlayerInvitations(service: MatchService, matchId: string) {
  const match = await service.getMatch(matchId);
  for (const invitation of match?.invitations ?? []) {
    if (invitation.kind === "player" && invitation.status === "pending") {
      await service.respondInvitation(invitation.id, invitation.invitedUserId, true);
    }
  }
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

describe("GAP-005 PostgreSQL judge serialization", () => {
  let services: AppServices;
  let db: Db;
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof buildApp>>["app"];
  let userA: UserFixture;
  let userB: UserFixture;
  let userC: UserFixture;
  const extraClients: Sql[] = [];

  beforeEach(async () => {
    const reset = postgres(databaseUrl!, { max: 1 });
    try {
      await reset.unsafe(`
        DROP SCHEMA IF EXISTS drizzle CASCADE;
        DROP SCHEMA public CASCADE;
        CREATE SCHEMA public
      `);
    } finally {
      await reset.end({ timeout: 5 });
    }
    await runPostgresMigrations(databaseUrl!, "apply");
    const context = await createPostgresDb(databaseUrl!);
    db = context.db;
    close = context.close;
    const built = await buildApp({ db, clock });
    app = built.app;
    services = built.services;
    await services.auth.seedAdmin("gap005-pg-admin@tab10.test", "AdminPass1!");
    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "gap005-pg-admin@tab10.test", password: "AdminPass1!" },
    });
    const adminCookie = adminLogin.cookies.find((entry) => entry.name === "tab10_session")!.value;

    async function createUser(index: number): Promise<UserFixture> {
      const email = `gap005-pg-${index}@tab10.test`;
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        cookies: { tab10_session: adminCookie },
        payload: { email, firstName: `PG${index}`, lastName: "Judge" },
      });
      const id = created.json().user.id as string;
      const firstLogin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: created.json().temporaryPassword },
      });
      const firstCookie = firstLogin.cookies.find((entry) => entry.name === "tab10_session")!.value;
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/password/first-change",
        cookies: { tab10_session: firstCookie },
        payload: { newPassword: "UserPass1!" },
      });
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: "UserPass1!" },
      });
      return {
        id,
        cookie: login.cookies.find((entry) => entry.name === "tab10_session")!.value,
      };
    }

    [userA, userB, userC] = await Promise.all([createUser(1), createUser(2), createUser(3)]);
  });

  afterEach(async () => {
    await Promise.all(extraClients.splice(0).map((client) => client.end({ timeout: 5 })));
    if (app) await app.close();
    if (close) await close();
  });

  async function createJudgedMatch() {
    const match = await services.matches.createMatch({
      createdByUserId: userA.id,
      title: "PostgreSQL race",
      format: "1v1",
      participants: [
        { side: "A", userId: userA.id },
        { side: "B", userId: userB.id },
      ],
    });
    await acceptRequiredPlayerInvitations(services.matches, match!.id);
    await services.matches.startMatch(match!.id, userA.id, match!.participants[0]!.id);
    const session = await services.matches.acquireJudge({
      matchId: match!.id,
      userId: userA.id,
      authSessionId: (await db.query.authSessions.findMany({
        where: (row, { and, eq, isNull }) => and(eq(row.userId, userA.id), isNull(row.revokedAt)),
        orderBy: (row, { desc }) => [desc(row.createdAt)],
      }))[0]!.id,
    });
    return { match: (await services.matches.getMatch(match!.id))!, session: session! };
  }

  async function runScoreMutation(
    connection: NamedConnection,
    fixture: Awaited<ReturnType<typeof createJudgedMatch>>,
    expectedVersion: number,
    mutation: ScoreMutation,
  ) {
    if (mutation.kind === "point") {
      return connection.service.awardPoint({
        matchId: fixture.match.id,
        side: mutation.side,
        idempotencyKey: mutation.key,
        expectedVersion,
        judgeUserId: userA.id,
        authSessionId: fixture.session.authSessionId,
      });
    }
    return connection.service.manualCorrection({
      matchId: fixture.match.id,
      scoreA: mutation.scoreA,
      scoreB: mutation.scoreB,
      currentServerParticipantId: fixture.match.participants[mutation.serverIndex]!.id,
      idempotencyKey: mutation.key,
      expectedVersion,
      judgeUserId: userA.id,
      authSessionId: fixture.session.authSessionId,
    });
  }

  async function runOrderedMatchOperations<TFirst, TSecond>(
    matchId: string,
    first: { connection: NamedConnection; run: () => Promise<TFirst> },
    second: { connection: NamedConnection; run: () => Promise<TSecond> },
  ): Promise<[
    PromiseSettledResult<TFirst>,
    PromiseSettledResult<TSecond>,
  ]> {
    const blocker = postgres(databaseUrl!, { max: 1 });
    const observer = postgres(databaseUrl!, { max: 1 });
    extraClients.push(blocker, observer, first.connection.client, second.connection.client);

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

    let firstPromise: Promise<TFirst> | undefined;
    let secondPromise: Promise<TSecond> | undefined;
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
      throw new Error("both ordered operations must reach the PostgreSQL lock barrier");
    }
    return outcomes as [
      PromiseSettledResult<TFirst>,
      PromiseSettledResult<TSecond>,
    ];
  }

  async function readPersistedMatch(matchId: string) {
    const row = await db.query.matches.findFirst({
      where: (match, { eq }) => eq(match.id, matchId),
    });
    expect(row).toBeDefined();
    return row!;
  }

  it("AT-MATCH-011 serializes starts for two matches sharing one player", async () => {
    const first = await services.matches.createMatch({
      createdByUserId: userA.id,
      title: "Shared player first",
      format: "1v1",
      participants: [
        { side: "A", userId: userA.id },
        { side: "B", userId: userB.id },
      ],
    });
    const second = await services.matches.createMatch({
      createdByUserId: userC.id,
      title: "Shared player second",
      format: "1v1",
      participants: [
        { side: "A", userId: userC.id },
        { side: "B", userId: userB.id },
      ],
    });
    await Promise.all([
      acceptRequiredPlayerInvitations(services.matches, first!.id),
      acceptRequiredPlayerInvitations(services.matches, second!.id),
    ]);
    const left = namedConnection("gap005-start-left");
    const right = namedConnection("gap005-start-right");
    extraClients.push(left.client, right.client);

    const results = await Promise.allSettled([
      left.service.startMatch(first!.id, userA.id, first!.participants[0]!.id),
      right.service.startMatch(second!.id, userC.id, second!.participants[0]!.id),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as { code?: string }).code).toBe("PLAYER_BUSY");
    const states = await Promise.all([
      services.matches.getMatch(first!.id),
      services.matches.getMatch(second!.id),
    ]);
    expect(states.map((match) => match!.status).sort()).toEqual(["in_progress", "waiting"]);
  });

  it.each(["point", "undo", "correction"] as const)(
    "serializes handover ahead of an in-flight old-judge %s mutation",
    async (mutation) => {
      const fixture = await createJudgedMatch();
      if (mutation === "undo") {
        await services.matches.awardPoint({
          matchId: fixture.match.id,
          side: "A",
          idempotencyKey: crypto.randomUUID(),
          expectedVersion: 0,
          judgeUserId: userA.id,
          authSessionId: fixture.session.authSessionId,
        });
      }
      const before = (await services.matches.getMatch(fixture.match.id))!;
      const blocker = postgres(databaseUrl!, { max: 1 });
      const observer = postgres(databaseUrl!, { max: 1 });
      const handover = namedConnection(`gap005-handover-${mutation}`);
      const oldJudge = namedConnection(`gap005-old-judge-${mutation}`);
      extraClients.push(blocker, observer, handover.client, oldJudge.client);

      let releaseBlocker!: () => void;
      const blockerGate = new Promise<void>((resolve) => { releaseBlocker = resolve; });
      let rowLocked!: () => void;
      const rowLockedGate = new Promise<void>((resolve) => { rowLocked = resolve; });
      const blockerPromise = blocker.begin(async (transaction) => {
        await transaction`select id from matches where id = ${fixture.match.id} for update`;
        rowLocked();
        await blockerGate;
      });
      await rowLockedGate;

      const handoverPromise = handover.service.handoverJudge({
        matchId: fixture.match.id,
        fromUserId: userA.id,
        fromAuthSessionId: fixture.session.authSessionId,
        toUserId: userC.id,
      });
      await waitUntilBlocked(observer, `gap005-handover-${mutation}`);

      const mutationPromise = mutation === "point"
        ? oldJudge.service.awardPoint({
            matchId: fixture.match.id,
            side: "A",
            idempotencyKey: crypto.randomUUID(),
            expectedVersion: before.version,
            judgeUserId: userA.id,
            authSessionId: fixture.session.authSessionId,
          })
        : mutation === "undo"
          ? oldJudge.service.undoPoint({
              matchId: fixture.match.id,
              idempotencyKey: crypto.randomUUID(),
              expectedVersion: before.version,
              judgeUserId: userA.id,
              authSessionId: fixture.session.authSessionId,
            })
          : oldJudge.service.manualCorrection({
              matchId: fixture.match.id,
              scoreA: 4,
              scoreB: 2,
              currentServerParticipantId: before.participants[1]!.id,
              idempotencyKey: crypto.randomUUID(),
              expectedVersion: before.version,
              judgeUserId: userA.id,
              authSessionId: fixture.session.authSessionId,
            });
      await waitUntilBlocked(observer, `gap005-old-judge-${mutation}`);
      releaseBlocker();

      await expect(handoverPromise).resolves.toMatchObject({ userId: userC.id });
      await expect(mutationPromise).rejects.toMatchObject({ code: "JUDGE_REQUIRED" });
      await blockerPromise;
      expect(await services.matches.getMatch(fixture.match.id)).toMatchObject({
        scoreA: before.scoreA,
        scoreB: before.scoreB,
        version: before.version,
        activeJudge: null,
        judgeReservation: { userId: userC.id },
      });
    },
  );

  it.each([
    { name: "original point before new point", kind: "point", first: "original" },
    { name: "new point before original point", kind: "point", first: "new" },
    { name: "original correction before new correction", kind: "correction", first: "original" },
    { name: "new correction before original correction", kind: "correction", first: "new" },
    { name: "correction before point", kind: "mixed", first: "original" },
    { name: "point before correction", kind: "mixed", first: "new" },
  ] as const)("serializes controlled CAS order: $name", async ({ kind, first }) => {
    const fixture = await createJudgedMatch();
    const expectedVersion = fixture.match.version;
    const original: ScoreMutation = kind === "point"
      ? { kind: "point", key: "stage4-point-original", side: "A" }
      : {
          kind: "correction",
          key: "stage4-correction-original",
          scoreA: 4,
          scoreB: 2,
          serverIndex: 1,
        };
    const newer: ScoreMutation = kind === "correction"
      ? {
          kind: "correction",
          key: "stage4-correction-new",
          scoreA: 6,
          scoreB: 3,
          serverIndex: 0,
        }
      : { kind: "point", key: "stage4-point-new", side: "B" };
    const firstMutation = first === "original" ? original : newer;
    const secondMutation = first === "original" ? newer : original;
    const firstConnection = namedConnection(`stage4-cas-first-${kind}-${first}`);
    const secondConnection = namedConnection(`stage4-cas-second-${kind}-${first}`);

    const [firstResult, secondResult] = await runOrderedMatchOperations(
      fixture.match.id,
      {
        connection: firstConnection,
        run: () => runScoreMutation(firstConnection, fixture, expectedVersion, firstMutation),
      },
      {
        connection: secondConnection,
        run: () => runScoreMutation(secondConnection, fixture, expectedVersion, secondMutation),
      },
    );

    if (firstResult.status !== "fulfilled") throw firstResult.reason;
    expect(secondResult.status).toBe("rejected");
    if (secondResult.status !== "rejected") throw new Error("second CAS mutation unexpectedly fulfilled");
    const storedKey = firstMutation.kind === "correction"
      ? `manual-correction:${firstMutation.key}`
      : firstMutation.key;
    const expectedScore = firstMutation.kind === "correction"
      ? { scoreA: firstMutation.scoreA, scoreB: firstMutation.scoreB }
      : {
          scoreA: firstMutation.side === "A" ? 1 : 0,
          scoreB: firstMutation.side === "B" ? 1 : 0,
        };
    const expectedEvent = firstMutation.kind === "correction"
      ? { type: "manual_correction", idempotencyKey: storedKey }
      : { type: "point_awarded", idempotencyKey: storedKey, side: firstMutation.side };
    expect(secondResult.reason).toMatchObject({
      code: "VERSION_CONFLICT",
      state: {
        ...expectedScore,
        version: expectedVersion + 1,
        idempotencyKeys: [storedKey],
      },
    });
    expect(firstResult.value).toMatchObject({
      ...expectedScore,
      version: expectedVersion + 1,
      idempotencyKeys: [storedKey],
      eventLog: [expect.objectContaining(expectedEvent)],
    });
    expect(await readPersistedMatch(fixture.match.id)).toMatchObject({
      ...expectedScore,
      version: expectedVersion + 1,
      idempotencyKeys: [storedKey],
      eventLog: [expect.objectContaining(expectedEvent)],
    });
  });

  it.each([
    { name: "point waits before finish", first: "mutation", mutation: "point" },
    { name: "correction waits before finish", first: "mutation", mutation: "correction" },
    { name: "finish waits before point", first: "finish", mutation: "point" },
    { name: "finish waits before correction", first: "finish", mutation: "correction" },
  ] as const)("serializes scoring and finish: $name", async ({ first, mutation }) => {
    const fixture = await createJudgedMatch();
    const seedKey = "stage4-finish-seed";
    const seeded = await services.matches.manualCorrection({
      matchId: fixture.match.id,
      scoreA: 11,
      scoreB: 0,
      currentServerParticipantId: fixture.match.participants[0]!.id,
      idempotencyKey: seedKey,
      expectedVersion: fixture.match.version,
      judgeUserId: userA.id,
      authSessionId: fixture.session.authSessionId,
    });
    expect(seeded).toMatchObject({ status: "pending_confirmation", version: 1 });
    const scoring: ScoreMutation = mutation === "point"
      ? { kind: "point", key: "stage4-finish-point", side: "B" }
      : {
          kind: "correction",
          key: "stage4-finish-correction",
          scoreA: 8,
          scoreB: 6,
          serverIndex: 1,
        };
    const scoringConnection = namedConnection(`stage4-finish-score-${first}-${mutation}`);
    const finishConnection = namedConnection(`stage4-finish-confirm-${first}-${mutation}`);
    const scoreOperation = {
      connection: scoringConnection,
      run: () => runScoreMutation(scoringConnection, fixture, 1, scoring),
    };
    const finishOperation = {
      connection: finishConnection,
      run: () => finishConnection.service.confirmFinish({
        matchId: fixture.match.id,
        judgeUserId: userA.id,
        authSessionId: fixture.session.authSessionId,
      }),
    };

    const [firstResult, secondResult] = first === "mutation"
      ? await runOrderedMatchOperations(fixture.match.id, scoreOperation, finishOperation)
      : await runOrderedMatchOperations(fixture.match.id, finishOperation, scoreOperation);
    const scoreResult = first === "mutation" ? firstResult : secondResult;
    const finishResult = first === "mutation" ? secondResult : firstResult;
    const persisted = await readPersistedMatch(fixture.match.id);
    const seedStoredKey = `manual-correction:${seedKey}`;

    if (first === "mutation" && mutation === "correction") {
      expect(scoreResult.status).toBe("fulfilled");
      expect(finishResult.status).toBe("rejected");
      if (scoreResult.status !== "fulfilled" || finishResult.status !== "rejected") {
        throw new Error("correction-first finish ordering did not settle as expected");
      }
      expect(scoreResult.value).toMatchObject({ scoreA: 8, scoreB: 6, version: 2 });
      expect(finishResult.reason).toMatchObject({ code: "INVALID_STATUS" });
      expect(persisted).toMatchObject({
        status: "in_progress",
        scoreA: 8,
        scoreB: 6,
        version: 2,
        idempotencyKeys: [seedStoredKey, "manual-correction:stage4-finish-correction"],
        eventLog: [
          expect.objectContaining({ type: "manual_correction", idempotencyKey: seedStoredKey }),
          expect.objectContaining({
            type: "manual_correction",
            idempotencyKey: "manual-correction:stage4-finish-correction",
          }),
        ],
      });
      return;
    }

    expect(finishResult.status).toBe("fulfilled");
    expect(scoreResult.status).toBe("rejected");
    if (finishResult.status !== "fulfilled" || scoreResult.status !== "rejected") {
      throw new Error("finish-winning ordering did not settle as expected");
    }
    expect(finishResult.value).toMatchObject({ status: "finished", version: 2 });
    expect(scoreResult.reason).toMatchObject({
      code: first === "finish" ? "JUDGE_REQUIRED" : "FINISH_PENDING",
    });
    expect(persisted).toMatchObject({
      status: "finished",
      scoreA: 11,
      scoreB: 0,
      version: 2,
      eventLog: [
        expect.objectContaining({ type: "manual_correction", idempotencyKey: seedStoredKey }),
      ],
    });
    const persistedKeys = persisted.idempotencyKeys as string[];
    expect(persistedKeys).toHaveLength(2);
    expect(persistedKeys).toContain(seedStoredKey);
    expect(persistedKeys.filter((key) => key.startsWith("finish-confirmed:"))).toHaveLength(1);
    expect(persistedKeys).not.toContain(scoring.key);
    expect(persistedKeys).not.toContain(`manual-correction:${scoring.key}`);
  });

  it.each(["point", "correction"] as const)(
    "serializes an in-flight %s ahead of handover",
    async (mutation) => {
      const fixture = await createJudgedMatch();
      const before = (await services.matches.getMatch(fixture.match.id))!;
      const scoring = namedConnection(`stage4-${mutation}-before-handover`);
      const handover = namedConnection(`stage4-handover-after-${mutation}`);
      const scoreMutation: ScoreMutation = mutation === "point"
        ? { kind: "point", key: "stage4-point-before-handover", side: "A" }
        : {
            kind: "correction",
            key: "stage4-correction-before-handover",
            scoreA: 4,
            scoreB: 2,
            serverIndex: 1,
          };

      const [scoreResult, handoverResult] = await runOrderedMatchOperations(
        fixture.match.id,
        {
          connection: scoring,
          run: () => runScoreMutation(scoring, fixture, before.version, scoreMutation),
        },
        {
          connection: handover,
          run: () => handover.service.handoverJudge({
            matchId: fixture.match.id,
            fromUserId: userA.id,
            fromAuthSessionId: fixture.session.authSessionId,
            toUserId: userC.id,
          }),
        },
      );

      if (scoreResult.status !== "fulfilled") throw scoreResult.reason;
      if (handoverResult.status !== "fulfilled") throw handoverResult.reason;
      const expectedScore = mutation === "point"
        ? { scoreA: 1, scoreB: 0 }
        : { scoreA: 4, scoreB: 2 };
      const storedKey = mutation === "point"
        ? scoreMutation.key
        : `manual-correction:${scoreMutation.key}`;
      const expectedEvent = mutation === "point"
        ? { type: "point_awarded", idempotencyKey: storedKey, side: "A" }
        : { type: "manual_correction", idempotencyKey: storedKey };
      expect(scoreResult.value).toMatchObject({ ...expectedScore, version: 1 });
      expect(handoverResult.value).toMatchObject({ userId: userC.id });
      expect(await services.matches.getMatch(fixture.match.id)).toMatchObject({
        ...expectedScore,
        version: 1,
        activeJudge: null,
        judgeReservation: { userId: userC.id },
      });
      expect(await readPersistedMatch(fixture.match.id)).toMatchObject({
        ...expectedScore,
        version: 1,
        idempotencyKeys: [storedKey],
        eventLog: [expect.objectContaining(expectedEvent)],
      });
    },
  );

  it("serializes parallel reservations for one target across two matches", async () => {
    const first = await services.matches.createMatch({
      createdByUserId: userA.id,
      title: "Reservation race A",
      format: "1v1",
      participants: [
        { side: "A", userId: userA.id },
        { side: "B", userId: userC.id },
      ],
    });
    const second = await services.matches.createMatch({
      createdByUserId: userA.id,
      title: "Reservation race B",
      format: "1v1",
      participants: [
        { side: "A", userId: userA.id },
        { side: "B", userId: userC.id },
      ],
    });
    const activeSessions = await db.query.authSessions.findMany({
      where: (row, { and, inArray, isNull }) => and(
        inArray(row.userId, [userA.id, userB.id]),
        isNull(row.revokedAt),
      ),
      orderBy: (row, { desc }) => [desc(row.createdAt)],
    });
    const sessionByUser = new Map(activeSessions.map((session) => [session.userId, session.id]));
    await services.matches.acquireJudge({
      matchId: first!.id,
      userId: userA.id,
      authSessionId: sessionByUser.get(userA.id)!,
    });
    await services.matches.acquireJudge({
      matchId: second!.id,
      userId: userB.id,
      authSessionId: sessionByUser.get(userB.id)!,
    });
    const left = namedConnection("gap005-reservation-left");
    const right = namedConnection("gap005-reservation-right");
    extraClients.push(left.client, right.client);

    const results = await Promise.allSettled([
      left.service.handoverJudge({
        matchId: first!.id,
        fromUserId: userA.id,
        fromAuthSessionId: sessionByUser.get(userA.id)!,
        toUserId: userC.id,
      }),
      right.service.handoverJudge({
        matchId: second!.id,
        fromUserId: userB.id,
        fromAuthSessionId: sessionByUser.get(userB.id)!,
        toUserId: userC.id,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({ code: "JUDGE_BUSY" });
    const reservations = await db.query.judgeSessions.findMany({
      where: (row, { and, eq, isNull }) => and(
        eq(row.reservedForUserId, userC.id),
        isNull(row.releasedAt),
      ),
    });
    expect(reservations).toHaveLength(1);
  });
});
