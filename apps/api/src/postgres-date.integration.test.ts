import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import type { FastifyInstance } from "fastify";
import { applySchemaSql, createPostgresDb } from "./db/client.js";
import { buildApp, type AppServices } from "./app.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("postgres-js date comparisons (Neon / prod driver)", () => {
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
      await applySchemaSql(
        {
          exec: async (q) => {
            await sql.unsafe(q);
          },
        },
        { withPgcrypto: true },
      );
    } finally {
      await sql.end({ timeout: 5 });
    }

    const ctx = await createPostgresDb(databaseUrl!);
    close = ctx.close;
    const built = await buildApp({ db: ctx.db, clock: new FakeClock() });
    app = built.app;
    services = built.services;
    await services.auth.seedAdmin("admin@tab10.local", "AdminPass1!");

    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@tab10.local", password: "AdminPass1!" },
    });
    adminCookie = adminLogin.cookies.find((c) => c.name === "tab10_session")!
      .value;

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

    const a = await createUser(`pg-a-${suffix}@tab10.local`, "UserPass1!");
    const b = await createUser(`pg-b-${suffix}@tab10.local`, "UserPass1!");
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
});
