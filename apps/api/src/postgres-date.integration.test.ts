import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import type { FastifyInstance } from "fastify";
import { createPostgresDb } from "./db/client.js";
import { runPostgresMigrations } from "./db/migrations.js";
import { resolveTestDatabaseUrl } from "./db/test-database-url.js";
import { buildApp, type AppServices } from "./app.js";

const databaseUrl = resolveTestDatabaseUrl(process.env, {
  required: process.env.REQUIRE_TEST_DATABASE_URL === "1",
});
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("critical flows on a dedicated PostgreSQL test DB", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let close: () => Promise<void>;
  let adminCookie: string;
  let userACookie: string;
  let userBId: string;
  let userAId: string;

  beforeEach(async () => {
    const postgres = (await import("postgres")).default;
    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      // resolveTestDatabaseUrl has already restricted this to an explicit,
      // loopback-only, test-named database with DATABASE_URL unset.
      await sql.unsafe(`
        DROP SCHEMA IF EXISTS drizzle CASCADE;
        DROP SCHEMA public CASCADE;
        CREATE SCHEMA public
      `);
    } finally {
      await sql.end({ timeout: 5 });
    }
    await runPostgresMigrations(databaseUrl!, "apply");

    const ctx = await createPostgresDb(databaseUrl!);
    close = ctx.close;
    const built = await buildApp({ db: ctx.db, clock: new FakeClock() });
    app = built.app;
    services = built.services;

    const adminEmail = "pg-admin@tab10.test";
    const adminPassword = "PgAdminTest2!";
    await services.auth.seedAdmin(adminEmail, adminPassword);

    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: adminEmail, password: adminPassword },
    });
    expect(adminLogin.statusCode).toBe(200);
    adminCookie = adminLogin.cookies.find((c) => c.name === "tab10_session")!
      .value;

    async function createUser(email: string, password: string) {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        cookies: { tab10_session: adminCookie },
        payload: { email, firstName: "Pg", lastName: "Test" },
      });
      expect(created.statusCode).toBe(200);
      const temp = created.json().temporaryPassword as string;
      const id = created.json().user.id as string;
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: temp },
      });
      const cookie = login.cookies.find((c) => c.name === "tab10_session")!
        .value;
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/password/first-change",
        cookies: { tab10_session: cookie },
        payload: { newPassword: password },
      });
      const login2 = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password },
      });
      return {
        id,
        cookie: login2.cookies.find((c) => c.name === "tab10_session")!.value,
      };
    }

    const a = await createUser("pg-a@tab10.test", "UserPass1!");
    const b = await createUser("pg-b@tab10.test", "UserPass1!");
    userAId = a.id;
    userBId = b.id;
    userACookie = a.cookie;
  });

  afterEach(async () => {
    if (app) await app.close();
    if (close) await close();
  });

  it("POST/GET match and week rankings do not throw on Date params", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "Postgres smoke",
        format: "1v1",
        participants: [
          { side: "A", userId: userAId },
          { side: "B", userId: userBId },
        ],
      },
    });
    expect(created.statusCode).toBe(200);
    const matchId = created.json().match.id as string;

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/matches/${matchId}`,
      cookies: { tab10_session: userACookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().match.activeJudge).toBeNull();

    const weekRankings = await app.inject({
      method: "GET",
      url: "/api/v1/rankings?period=week",
      cookies: { tab10_session: userACookie },
    });
    expect(weekRankings.statusCode).toBe(200);
  });

  it("AT-MATCH-007/011: serializes concurrent point updates and applies winner stats once", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "Postgres concurrent score",
        format: "1v1",
        pointsToWin: 3,
        participants: [
          { side: "A", userId: userAId },
          { side: "B", userId: userBId },
        ],
      },
    });
    expect(created.statusCode).toBe(200);
    const matchId = created.json().match.id as string;

    const started = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: userACookie },
    });
    expect(started.statusCode).toBe(200);
    const acquire = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: userACookie },
    });
    expect(acquire.statusCode).toBe(200);

    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/points`,
        cookies: { tab10_session: userACookie },
        headers: { "idempotency-key": "pg-race-a" },
        payload: { side: "A", expectedVersion: 0 },
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/points`,
        cookies: { tab10_session: userACookie },
        headers: { "idempotency-key": "pg-race-b" },
        payload: { side: "A", expectedVersion: 0 },
      }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);

    const accepted = first.statusCode === 200 ? first : second;
    let version = accepted.json().match.version as number;
    for (let point = 1; point < 3; point += 1) {
      const scored = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/points`,
        cookies: { tab10_session: userACookie },
        headers: { "idempotency-key": `pg-after-race-${point}` },
        payload: { side: "A", expectedVersion: version },
      });
      expect(scored.statusCode).toBe(200);
      version = scored.json().match.version as number;
    }

    const confirm = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/confirm-finish`,
      cookies: { tab10_session: userACookie },
    });
    expect(confirm.statusCode).toBe(200);

    const rankings = await app.inject({
      method: "GET",
      url: "/api/v1/rankings",
      cookies: { tab10_session: userACookie },
    });
    const winner = rankings
      .json()
      .rankings.find((row: { userId: string }) => row.userId === userAId);
    expect(winner?.wins).toBe(1);
  });

  it("AT-TRN-010: materializes and advances a four-player bracket on PostgreSQL", async () => {
    const tournament = await app.inject({
      method: "POST",
      url: "/api/v1/tournaments",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "Postgres bracket advancement",
        format: "single_elimination",
        organizerParticipates: true,
        pointsToWin: 3,
        mercyEnabled: false,
      },
    });
    expect(tournament.statusCode).toBe(200);
    const tournamentId = tournament.json().tournament.id as string;

    const extraUserIds = [userBId];
    for (const email of ["pg-c@tab10.test", "pg-d@tab10.test"]) {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        cookies: { tab10_session: adminCookie },
        payload: { email, firstName: "Pg", lastName: "Bracket" },
      });
      expect(created.statusCode).toBe(200);
      extraUserIds.push(created.json().user.id as string);
    }
    for (const userId of extraUserIds) {
      const added = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tournamentId}/participants`,
        cookies: { tab10_session: userACookie },
        payload: { userId },
      });
      expect(added.statusCode).toBe(200);
    }

    const generated = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${tournamentId}/bracket`,
      cookies: { tab10_session: userACookie },
      payload: { constructionAlgorithm: "power_of_two" },
    });
    expect(generated.statusCode).toBe(200);
    expect(generated.json().bracket.schemaVersion).toBe(2);

    const started = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${tournamentId}/start`,
      cookies: { tab10_session: userACookie },
    });
    expect(started.statusCode).toBe(200);
    const firstRound = started.json().tournament.matches as Array<{
      id: string;
      status: string;
    }>;
    expect(firstRound).toHaveLength(2);

    for (const match of firstRound) {
      const matchStarted = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${match.id}/start`,
        cookies: { tab10_session: userACookie },
      });
      expect(matchStarted.statusCode).toBe(200);
      const acquired = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${match.id}/judge/acquire`,
        cookies: { tab10_session: userACookie },
      });
      expect(acquired.statusCode).toBe(200);
      let version = 0;
      for (let point = 0; point < 3; point += 1) {
        const scored = await app.inject({
          method: "POST",
          url: `/api/v1/matches/${match.id}/points`,
          cookies: { tab10_session: userACookie },
          headers: { "idempotency-key": `pg-bracket-${match.id}-${point}` },
          payload: { side: "A", expectedVersion: version },
        });
        expect(scored.statusCode).toBe(200);
        version = scored.json().match.version as number;
      }
      const confirmed = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${match.id}/confirm-finish`,
        cookies: { tab10_session: userACookie },
      });
      expect(confirmed.statusCode).toBe(200);
    }

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/tournaments/${tournamentId}`,
      cookies: { tab10_session: userACookie },
    });
    expect(detail.statusCode).toBe(200);
    const matches = detail.json().tournament.matches as Array<{
      status: string;
    }>;
    // Single-elimination tournaments enable the third-place match by default,
    // so completing both semi-finals materializes both the final and bronze match.
    expect(matches).toHaveLength(4);
    expect(matches.filter((match) => match.status === "finished")).toHaveLength(2);
    expect(matches.filter((match) => match.status === "waiting")).toHaveLength(2);
  });
});
