import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import { matches, tournaments, userStats } from "./db/schema.js";

describe("AT-HOME dashboard", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let db: Db;
  let close: () => Promise<void>;
  let clock: FakeClock;
  let adminCookie: string;
  let actor: { id: string; cookie: string };
  let rival: { id: string; cookie: string };

  beforeEach(async () => {
    const ctx = await createMigratedPgliteDb();
    db = ctx.db;
    close = ctx.close;
    clock = new FakeClock(new Date("2026-09-07T10:00:00.000Z"));
    const built = await buildApp({ db, clock });
    app = built.app;
    services = built.services;
    await services.auth.seedAdmin("admin@tab10.local", "AdminPass1!");
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@tab10.local", password: "AdminPass1!" },
    });
    adminCookie = login.cookies.find((c) => c.name === "tab10_session")!.value;
    actor = await createActiveUser("anna");
    rival = await createActiveUser("boris");
  });

  afterEach(async () => {
    if (app) await app.close();
    if (close) await close();
  });

  async function createActiveUser(label: string) {
    const email = `${label}@home.test`;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      cookies: { tab10_session: adminCookie },
      payload: { email, firstName: label, lastName: "Игрок" },
    });
    const temporary = created.json().temporaryPassword as string;
    const firstLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: temporary },
    });
    const temporaryCookie = firstLogin.cookies.find(
      (c) => c.name === "tab10_session",
    )!.value;
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/first-change",
      cookies: { tab10_session: temporaryCookie },
      payload: { newPassword: "UserPass1!" },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: "UserPass1!" },
    });
    return {
      id: created.json().user.id as string,
      cookie: login.cookies.find((c) => c.name === "tab10_session")!.value,
    };
  }

  async function createFinishedMatch(index: number) {
    const created = await services.matches.createMatch({
      createdByUserId: actor.id,
      title: `Очная игра ${index}`,
      format: "1v1",
      participants: [
        { side: "A", userId: actor.id },
        { side: "B", userId: rival.id },
      ],
    });
    const startedAt = new Date(`2026-09-0${index}T10:00:00.000Z`);
    const finishedAt = new Date(`2026-09-0${index}T10:10:00.000Z`);
    await db
      .update(matches)
      .set({
        status: "finished",
        scoreA: 11,
        scoreB: 7 + index,
        winnerSide: "A",
        startedAt,
        finishedAt,
        updatedAt: finishedAt,
      })
      .where(eq(matches.id, created!.id));
    return created!.id;
  }

  it("AT-HOME-001/002: returns active top-level events, complete hero, rival, recent feed, and month top-3", async () => {
    await createFinishedMatch(1);
    await createFinishedMatch(2);
    await createFinishedMatch(3);
    await db.insert(userStats).values([
      { userId: actor.id, winsAllTime: 3, lossesAllTime: 0, winsMonth: 3 },
      { userId: rival.id, winsAllTime: 0, lossesAllTime: 3, winsMonth: 0 },
    ]);

    const activeMatch = await services.matches.createMatch({
      createdByUserId: actor.id,
      title: "Матч сейчас",
      format: "1v1",
      participants: [
        { side: "A", userId: actor.id },
        { side: "B", userId: rival.id },
      ],
    });
    const activeTournament = await services.tournaments.create({
      createdByUserId: actor.id,
      title: "Кубок сейчас",
      format: "single_elimination",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/home?period=month",
      cookies: { tab10_session: actor.cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.rankingPeriod).toBe("month");
    expect(body.myStats).toMatchObject({
      matchesPlayed: 3,
      wins: 3,
      losses: 0,
      winRate: 1,
      averagePoints: 11,
      rival: { userId: rival.id, matchCount: 3 },
    });
    expect(body.activeEvents.match.id).toBe(activeMatch!.id);
    expect(body.activeEvents.tournament.id).toBe(activeTournament!.id);
    expect(body.recentEvents).toHaveLength(3);
    expect(body.recentEvents[0]).toMatchObject({
      type: "match",
      title: "Очная игра 3",
      durationSeconds: 600,
      userRole: "participant",
    });
    expect(body.topRankings).toHaveLength(2);
  });

  it("AT-HOME-002: exposes explicit empty collections without inventing a rival", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/home",
      cookies: { tab10_session: actor.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      rankingPeriod: "all_time",
      activeEvents: { match: null, tournament: null },
      recentEvents: [],
      myStats: { matchesPlayed: 0, rival: null },
    });
  });
});
