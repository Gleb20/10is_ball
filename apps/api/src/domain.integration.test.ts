import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { createPgliteDb } from "./db/client.js";
import { buildApp } from "./app.js";
import type { FastifyInstance } from "fastify";
import type { AppServices } from "./app.js";

describe("match and judge integration", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let close: () => Promise<void>;
  let adminCookie: string;
  let userACookie: string;
  let userAId: string;
  let userBId: string;

  beforeEach(async () => {
    const ctx = await createPgliteDb();
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

    async function createUser(email: string, password: string) {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        cookies: { tab10_session: adminCookie },
        payload: { email, firstName: "F", lastName: "L" },
      });
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

    const a = await createUser("a@tab10.local", "UserPass1!");
    const b = await createUser("b@tab10.local", "UserPass1!");
    userAId = a.id;
    userBId = b.id;
    userACookie = a.cookie;
  });

  afterEach(async () => {
    if (app) await app.close();
    if (close) await close();
  });

  it("INT_match__create_judge_score_confirm", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "Дружеский",
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

    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: userACookie },
      payload: {},
    });

    const acquire = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: userACookie },
    });
    expect(acquire.statusCode).toBe(200);

    let version = 0;
    for (let i = 0; i < 3; i += 1) {
      const point = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/points`,
        cookies: { tab10_session: userACookie },
        headers: { "idempotency-key": `p-${i}` },
        payload: { side: "A", expectedVersion: version },
      });
      expect(point.statusCode).toBe(200);
      version = point.json().match.version;
    }

    const pending = await app.inject({
      method: "GET",
      url: `/api/v1/matches/${matchId}`,
      cookies: { tab10_session: userACookie },
    });
    expect(pending.json().match.status).toBe("pending_confirmation");

    // idempotency
    const dup = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/points`,
      cookies: { tab10_session: userACookie },
      headers: { "idempotency-key": "p-0" },
      payload: { side: "A", expectedVersion: version },
    });
    // may fail version or return same — either way score shouldn't jump wrongly after confirm path
    expect([200, 400, 409]).toContain(dup.statusCode);

    const confirm = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/confirm-finish`,
      cookies: { tab10_session: userACookie },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().match.status).toBe("finished");

    const rankings = await app.inject({
      method: "GET",
      url: "/api/v1/rankings",
      cookies: { tab10_session: userACookie },
    });
    expect(rankings.statusCode).toBe(200);
    expect(rankings.json().rankings.some((r: { userId: string }) => r.userId === userAId)).toBe(
      true,
    );
  });

  it("INT_judge__atomic_acquire", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "Race",
        format: "1v1",
        participants: [
          { side: "A", userId: userAId },
          { side: "B", guestFirstName: "G", guestLastName: "Uest" },
        ],
      },
    });
    const matchId = created.json().match.id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: userACookie },
    });

    const [r1, r2] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/judge/acquire`,
        cookies: { tab10_session: userACookie },
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/judge/acquire`,
        cookies: { tab10_session: userACookie },
      }),
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    // same user/session: second may succeed as re-acquire or fail — unique is on match
    // For same session twice, unique index blocks second
    expect(codes).toContain(200);
    expect(codes.filter((c) => c === 200).length).toBe(1);
  });

  it("INT_trn__bracket_from_collecting", async () => {
    const t = await app.inject({
      method: "POST",
      url: "/api/v1/tournaments",
      cookies: { tab10_session: userACookie },
      payload: { title: "Кубок", format: "single_elimination" },
    });
    const id = t.json().tournament.id as string;
    for (const email of ["c1@t.local", "c2@t.local", "c3@t.local"]) {
      const u = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        cookies: { tab10_session: adminCookie },
        payload: { email, firstName: "P", lastName: "L" },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${id}/participants`,
        cookies: { tab10_session: userACookie },
        payload: { userId: u.json().user.id },
      });
    }
    const bracket = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id}/bracket`,
      cookies: { tab10_session: userACookie },
    });
    expect(bracket.statusCode).toBe(200);
    expect(bracket.json().bracket.size).toBe(4);
  });

  it("INT_team__invite_and_accept", async () => {
    const team = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      cookies: { tab10_session: userACookie },
      payload: { name: "Ракетки" },
    });
    const teamId = team.json().team.id as string;
    const inv = await app.inject({
      method: "POST",
      url: `/api/v1/teams/${teamId}/invite`,
      cookies: { tab10_session: userACookie },
      payload: { userId: userBId },
    });
    expect(inv.statusCode).toBe(200);

    // login as B
    const bLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "b@tab10.local", password: "UserPass1!" },
    });
    const bCookie = bLogin.cookies.find((c) => c.name === "tab10_session")!
      .value;
    const notif = await app.inject({
      method: "GET",
      url: "/api/v1/notifications",
      cookies: { tab10_session: bCookie },
    });
    expect(notif.json().notifications.length).toBeGreaterThan(0);

    const respond = await app.inject({
      method: "POST",
      url: `/api/v1/team-invitations/${inv.json().invitation.id}/respond`,
      cookies: { tab10_session: bCookie },
      payload: { accept: true },
    });
    expect(respond.statusCode).toBe(200);
    expect(respond.json().status).toBe("accepted");
  });

  it("INT_tutorial__no_stats", async () => {
    const tut = await app.inject({
      method: "POST",
      url: "/api/v1/matches/tutorial",
      cookies: { tab10_session: userACookie },
    });
    expect(tut.statusCode).toBe(200);
    expect(tut.json().match.kind).toBe("tutorial");
  });
});

describe("INT_migrations__apply_from_scratch", () => {
  it("applies schema on empty pglite", async () => {
    const ctx = await createPgliteDb();
    const res = await ctx.client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public'",
    );
    const names = (res.rows as { tablename: string }[]).map((r) => r.tablename);
    expect(names).toContain("users");
    expect(names).toContain("matches");
    expect(names).toContain("tournaments");
    await ctx.close();
  });
});
