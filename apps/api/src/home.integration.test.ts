import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import { judgeSessions, matchParticipants, matches, tournaments, userStats } from "./db/schema.js";

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

  async function createFinishedMatch(index: number, actorWins = true) {
    const created = await services.matches.createMatch({
      createdByUserId: actor.id,
      title: `Очная игра ${index}`,
      format: "1v1",
      participants: [
        { side: "A", userId: actor.id },
        { side: "B", userId: rival.id },
      ],
    });
    const startedAt = new Date(Date.UTC(2026, 8, 1, 10, index));
    const finishedAt = new Date(startedAt.getTime() + 600_000);
    await db
      .update(matches)
      .set({
        status: "finished",
        scoreA: actorWins ? 11 : 7,
        scoreB: actorWins ? 7 : 11,
        winnerSide: actorWins ? "A" : "B",
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
      winnerSide: "A",
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

  it("AT-HOME-001/003: keeps a running game ahead of newer organizer work", async () => {
    const running = await services.matches.createMatch({
      createdByUserId: actor.id,
      title: "Игра сейчас",
      format: "1v1",
      participants: [{ side: "A", userId: actor.id }, { side: "B", userId: rival.id }],
    });
    await db.update(matches).set({ status: "in_progress" }).where(eq(matches.id, running!.id));
    for (let index = 0; index < 3; index += 1) {
      await services.matches.createMatch({
        createdByUserId: actor.id,
        title: `Организованная игра ${index}`,
        format: "1v1",
        participants: [
          { side: "A", userId: rival.id },
          { side: "B", guestFirstName: "Гость", guestLastName: String(index) },
        ],
      });
    }
    const response = await app.inject({ method: "GET", url: "/api/v1/home", cookies: { tab10_session: actor.cookie } });
    expect(response.statusCode).toBe(200);
    const tasks = response.json().currentTasks;
    expect(tasks).toHaveLength(4);
    expect(tasks[0]).toMatchObject({ id: running!.id, currentRoles: expect.arrayContaining(["player", "organizer"]) });
    expect(tasks.slice(1).every((task: { currentRoles: string[] }) => task.currentRoles.includes("organizer"))).toBe(true);
  });

  it("AT-HOME-001/003: player history and stats survive more than 50 newer club results", async () => {
    for (let index = 1; index <= 5; index += 1) await createFinishedMatch(index);
    for (let index = 0; index < 51; index += 1) {
      const foreign = await services.matches.createMatch({
        createdByUserId: rival.id,
        title: `Чужая игра ${index}`,
        format: "1v1",
        participants: [
          { side: "A", userId: rival.id },
          { side: "B", guestFirstName: "Гость", guestLastName: String(index) },
        ],
      });
      const at = new Date(Date.UTC(2026, 8, 8, 10, index));
      await db.update(matches).set({
        createdAt: at, updatedAt: at, finishedAt: at,
        status: "finished", scoreA: 11, scoreB: 5, winnerSide: "A",
      }).where(eq(matches.id, foreign!.id));
    }
    const getMatch = vi.spyOn(services.matches, "getMatch");
    const response = await app.inject({ method: "GET", url: "/api/v1/home?recentRole=player&notificationView=available", cookies: { tab10_session: actor.cookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.notificationView).toBe("available");
    expect(body.myStats).toMatchObject({ matchesPlayed: 5, wins: 5, losses: 0 });
    expect(body.recentEvents).toHaveLength(5);
    expect(body.recentEvents.every((event: { title: string }) => event.title.startsWith("Очная игра"))).toBe(true);
    expect(getMatch).toHaveBeenCalledTimes(5);
  });

  it("AT-HOME-001: full personal history keeps exact stats with bounded match details", async () => {
    for (let index = 1; index <= 55; index += 1) await createFinishedMatch(index, index % 5 !== 0);
    const getMatch = vi.spyOn(services.matches, "getMatch");
    const response = await app.inject({ method: "GET", url: "/api/v1/home?recentRole=player", cookies: { tab10_session: actor.cookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.myStats).toMatchObject({
      matchesPlayed: 55, wins: 44, losses: 11, winRate: 0.8,
      averagePoints: 10.2, rival: { userId: rival.id, matchCount: 55 },
    });
    expect(body.recentEvents).toHaveLength(5);
    expect(body.recentEvents.map((event: { title: string }) => event.title)).toEqual([
      "Очная игра 55", "Очная игра 54", "Очная игра 53", "Очная игра 52", "Очная игра 51",
    ]);
    expect(getMatch).toHaveBeenCalledTimes(5);
  });

  it("AT-HOME-001/003: summarizes a foreign active tournament for admin without loading every match detail", async () => {
    const tournament = await services.tournaments.create({
      createdByUserId: rival.id, title: "Большая чужая сетка", format: "single_elimination", organizerParticipates: false,
    });
    for (let index = 0; index < 16; index += 1) {
      await services.tournaments.addParticipant({
        tournamentId: tournament!.id, actorUserId: rival.id,
        guestFirstName: "Гость", guestLastName: String(index),
      });
    }
    await services.tournaments.generateBracket(tournament!.id, rival.id, { constructionAlgorithm: "compact", rng: () => 0.5 });
    const started = await services.tournaments.start(tournament!.id, rival.id);
    expect(started!.matches.length).toBeGreaterThanOrEqual(8);
    const firstWaiting = started!.matches.find((match) => match.status === "waiting");
    expect(firstWaiting).toBeDefined();
    await db.update(matches).set({ status: "finished", winnerSide: "A", scoreA: 11, scoreB: 7 }).where(eq(matches.id, firstWaiting!.id));
    const winningParticipant = (await db.query.matchParticipants.findMany({ where: eq(matchParticipants.matchId, firstWaiting!.id) }))
      .find((participant) => participant.side === "A");
    expect(winningParticipant).toBeDefined();
    const winnerName = [winningParticipant!.guestFirstName, winningParticipant!.guestLastName].filter(Boolean).join(" ");
    const getMatch = vi.spyOn(services.matches, "getMatch");
    const getTournament = vi.spyOn(services.tournaments, "get");
    const response = await app.inject({ method: "GET", url: "/api/v1/home", cookies: { tab10_session: adminCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().activeEvents.tournament).toMatchObject({
      id: tournament!.id, userRole: "viewer", topThree: expect.arrayContaining([winnerName]),
    });
    expect(response.json().currentTasks).toEqual([]);
    expect(getMatch).not.toHaveBeenCalled();
    expect(getTournament).toHaveBeenCalledTimes(1);
  });

  it("AT-HOME-001: tournament winners include registered and guest names without full match details", async () => {
    const tournament = await services.tournaments.create({
      createdByUserId: actor.id, title: "Смешанные результаты", format: "single_elimination", organizerParticipates: false,
    });
    const at = clock.now();
    const registeredWin = await db.insert(matches).values({
      title: "Победа участника", kind: "tournament", tournamentId: tournament!.id,
      createdByUserId: actor.id, status: "finished", format: "1v1", scoreA: 11, scoreB: 7,
      winnerSide: "A", startedAt: new Date(at.getTime() - 600_000), finishedAt: at,
    }).returning();
    const guestWin = await db.insert(matches).values({
      title: "Победа гостя", kind: "tournament", tournamentId: tournament!.id,
      createdByUserId: actor.id, status: "finished", format: "1v1", scoreA: 7, scoreB: 11,
      winnerSide: "B", startedAt: new Date(at.getTime() - 600_000), finishedAt: at,
    }).returning();
    await db.insert(matchParticipants).values([
      { matchId: registeredWin[0]!.id, side: "A", userId: actor.id },
      { matchId: registeredWin[0]!.id, side: "B", userId: rival.id },
      { matchId: guestWin[0]!.id, side: "A", userId: actor.id },
      { matchId: guestWin[0]!.id, side: "B", guestFirstName: "Гость", guestLastName: "Гостьев" },
    ]);
    await db.update(tournaments).set({ status: "finished", startedAt: new Date(at.getTime() - 600_000), finishedAt: at }).where(eq(tournaments.id, tournament!.id));
    const getMatch = vi.spyOn(services.matches, "getMatch");
    const response = await app.inject({ method: "GET", url: "/api/v1/home", cookies: { tab10_session: actor.cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().recentEvents[0]).toMatchObject({
      id: tournament!.id, topThree: expect.arrayContaining(["Игрок anna", "Гость Гостьев"]),
    });
    expect(getMatch).not.toHaveBeenCalled();
  });

  it("AT-HOME-003: current judge work ends after release and an active card drops historical judge attribution", async () => {
    const other = await createActiveUser("third");
    const created = await services.matches.createMatch({
      createdByUserId: rival.id,
      title: "Матч с временным судьёй",
      format: "1v1",
      participants: [{ side: "A", userId: rival.id }, { side: "B", userId: other.id }],
    });
    const acquired = await app.inject({ method: "POST", url: `/api/v1/matches/${created!.id}/judge/acquire`, cookies: { tab10_session: actor.cookie } });
    expect(acquired.statusCode).toBe(200);
    const during = await app.inject({ method: "GET", url: "/api/v1/home", cookies: { tab10_session: actor.cookie } });
    expect(during.statusCode).toBe(200);
    expect(during.json().currentTasks).toEqual([expect.objectContaining({ id: created!.id, currentRoles: ["current_judge"], userRole: "judge" })]);
    const released = await app.inject({ method: "POST", url: `/api/v1/matches/${created!.id}/judge/release`, cookies: { tab10_session: actor.cookie } });
    expect(released.statusCode).toBe(200);
    const actorAfter = await app.inject({ method: "GET", url: "/api/v1/home", cookies: { tab10_session: actor.cookie } });
    expect(actorAfter.statusCode).toBe(200);
    expect(actorAfter.json().currentTasks).toEqual([]);
    const organizerAfter = await app.inject({ method: "GET", url: "/api/v1/home", cookies: { tab10_session: rival.cookie } });
    expect(organizerAfter.statusCode).toBe(200);
    expect(organizerAfter.json().currentTasks[0]).toMatchObject({ id: created!.id, judgeName: null, currentRoles: expect.arrayContaining(["organizer"]) });
  });

  it("AT-HOME-003: a current tournament judge precedes participation without an active own game", async () => {
    const third = await createActiveUser("third");
    const fourth = await createActiveUser("fourth");
    const fifth = await createActiveUser("fifth");
    const sixth = await createActiveUser("sixth");
    const waiting = await services.tournaments.create({ createdByUserId: rival.id, title: "Ожидание раунда", format: "single_elimination", organizerParticipates: true });
    await services.tournaments.addParticipant({ tournamentId: waiting!.id, actorUserId: rival.id, userId: actor.id });
    await services.tournaments.addParticipant({ tournamentId: waiting!.id, actorUserId: rival.id, userId: fourth.id });
    await services.tournaments.generateBracket(waiting!.id, rival.id, { constructionAlgorithm: "compact", rng: () => 0.5 });
    await services.tournaments.start(waiting!.id, rival.id);

    const current = await services.tournaments.create({ createdByUserId: third.id, title: "Сужу сейчас", format: "single_elimination", organizerParticipates: true });
    await services.tournaments.addParticipant({ tournamentId: current!.id, actorUserId: third.id, userId: fifth.id });
    await services.tournaments.addParticipant({ tournamentId: current!.id, actorUserId: third.id, userId: sixth.id });
    await services.tournaments.generateBracket(current!.id, third.id, { constructionAlgorithm: "compact", rng: () => 0.5 });
    const started = await services.tournaments.start(current!.id, third.id);
    const match = started!.matches.find((row) => row.status === "waiting");
    expect(match).toBeDefined();
    const acquired = await app.inject({ method: "POST", url: `/api/v1/matches/${match!.id}/judge/acquire`, cookies: { tab10_session: actor.cookie } });
    expect(acquired.statusCode).toBe(200);
    const getMatch = vi.spyOn(services.matches, "getMatch");
    const response = await app.inject({ method: "GET", url: "/api/v1/home", cookies: { tab10_session: actor.cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().currentTasks.map((task: { id: string; hasCurrentMatch: boolean }) => [task.id, task.hasCurrentMatch])).toEqual([
      [current!.id, true], [waiting!.id, false],
    ]);
    expect(getMatch).not.toHaveBeenCalled();
    await db.update(judgeSessions).set({ expiresAt: new Date(clock.now().getTime() - 1) }).where(eq(judgeSessions.matchId, match!.id));
    const expired = await app.inject({ method: "GET", url: "/api/v1/home", cookies: { tab10_session: actor.cookie } });
    expect(expired.statusCode).toBe(200);
    expect(expired.json().currentTasks.map((task: { id: string }) => task.id)).toEqual([waiting!.id]);
  });
});
