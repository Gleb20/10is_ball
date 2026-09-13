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
type NamedConnection = { client: Sql; db: Db; service: MatchService };

function namedConnection(name: string): NamedConnection {
  const client = postgres(databaseUrl!, {
    max: 1,
    connection: { application_name: name },
  });
  const db = drizzle(client, { schema }) as unknown as Db;
  return { client, db, service: new MatchService(db, clock) };
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
