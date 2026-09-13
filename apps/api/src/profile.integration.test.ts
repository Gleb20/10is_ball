import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import {
  judgeSessions,
  matchParticipants,
  matches,
  teamMemberships,
  teams,
  tournamentParticipants,
  tournaments,
  userStats,
} from "./db/schema.js";

describe("GAP-002 profile contracts", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let db: Db;
  let close: () => Promise<void>;
  let admin: { id: string; cookie: string };
  let actor: { id: string; cookie: string; otherCookie: string };
  let rival: { id: string; cookie: string; otherCookie: string };

  beforeEach(async () => {
    const context = await createMigratedPgliteDb();
    db = context.db;
    close = context.close;
    const built = await buildApp({
      db,
      clock: new FakeClock(new Date("2026-09-07T12:00:00.000Z")),
    });
    app = built.app;
    services = built.services;

    const seeded = await services.auth.seedAdmin(
      "admin@tab10.local",
      "AdminPass1!",
    );
    const adminLogin = await login(
      "admin@tab10.local",
      "AdminPass1!",
      "Admin browser",
    );
    admin = { id: seeded.user.id, cookie: adminLogin };
    actor = await createActiveUser("Анна", "Профиль", "anna");
    rival = await createActiveUser("Борис", "Соперник", "boris");
  });

  afterEach(async () => {
    if (app) await app.close();
    if (close) await close();
  });

  async function login(email: string, password: string, userAgent: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "user-agent": userAgent },
      payload: { email, password },
    });
    expect(response.statusCode).toBe(200);
    return response.cookies.find((cookie) => cookie.name === "tab10_session")!
      .value;
  }

  async function createActiveUser(
    firstName: string,
    lastName: string,
    label: string,
  ) {
    const email = `${label}@profile.test`;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      cookies: { tab10_session: admin.cookie },
      payload: {
        email,
        firstName,
        lastName,
        birthDate: "1990-05-10",
        organizationText: "Депо",
        positionText: "Инженер",
      },
    });
    expect(created.statusCode).toBe(200);
    const temporaryPassword = created.json().temporaryPassword as string;
    const temporaryCookie = await login(
      email,
      temporaryPassword,
      `${label} first login`,
    );
    const changed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/first-change",
      cookies: { tab10_session: temporaryCookie },
      payload: { newPassword: "UserPass1!" },
    });
    expect(changed.statusCode).toBe(200);
    return {
      id: created.json().user.id as string,
      cookie: await login(email, "UserPass1!", `${label} desktop`),
      otherCookie: await login(email, "UserPass1!", `${label} mobile`),
    };
  }

  async function addResult(input: {
    title: string;
    opponentId: string;
    scoreA: number;
    scoreB: number;
    durationMinutes: number;
    day: number;
  }) {
    const [match] = await db
      .insert(matches)
      .values({
        title: input.title,
        kind: "standalone",
        status: "finished",
        format: "1v1",
        createdByUserId: actor.id,
        scoreA: input.scoreA,
        scoreB: input.scoreB,
        winnerSide: input.scoreA > input.scoreB ? "A" : "B",
        startedAt: new Date(`2026-09-0${input.day}T10:00:00.000Z`),
        finishedAt: new Date(
          Date.parse(`2026-09-0${input.day}T10:00:00.000Z`) +
            input.durationMinutes * 60_000,
        ),
        updatedAt: new Date(
          Date.parse(`2026-09-0${input.day}T10:00:00.000Z`) +
            input.durationMinutes * 60_000,
        ),
      })
      .returning();
    await db.insert(matchParticipants).values([
      { matchId: match!.id, side: "A", userId: actor.id },
      { matchId: match!.id, side: "B", userId: input.opponentId },
    ]);
    return match!;
  }

  async function seedProfileHistory() {
    const third = await createActiveUser("Вера", "Третья", "vera");
    const games = [
      await addResult({
        title: "Первая игра",
        opponentId: rival.id,
        scoreA: 11,
        scoreB: 7,
        durationMinutes: 10,
        day: 1,
      }),
      await addResult({
        title: "Долгая игра",
        opponentId: rival.id,
        scoreA: 8,
        scoreB: 11,
        durationMinutes: 20,
        day: 2,
      }),
      await addResult({
        title: "Лучшая победа",
        opponentId: rival.id,
        scoreA: 11,
        scoreB: 5,
        durationMinutes: 5,
        day: 3,
      }),
      await addResult({
        title: "Ещё одна победа",
        opponentId: third.id,
        scoreA: 11,
        scoreB: 9,
        durationMinutes: 15,
        day: 4,
      }),
    ];
    await db.insert(userStats).values([
      { userId: actor.id, winsAllTime: 3, lossesAllTime: 1 },
      { userId: rival.id, winsAllTime: 1, lossesAllTime: 2 },
      { userId: third.id, winsAllTime: 0, lossesAllTime: 1 },
    ]);

    const [team] = await db
      .insert(teams)
      .values({
        name: "Север",
        slug: "north-profile",
        captainUserId: actor.id,
      })
      .returning();
    await db.insert(teamMemberships).values({
      teamId: team!.id,
      userId: actor.id,
    });

    const [tournament] = await db
      .insert(tournaments)
      .values({
        title: "Кубок профиля",
        status: "finished",
        createdByUserId: actor.id,
        startedAt: new Date("2026-08-01T10:00:00.000Z"),
        finishedAt: new Date("2026-08-01T12:00:00.000Z"),
      })
      .returning();
    const [participant] = await db
      .insert(tournamentParticipants)
      .values({ tournamentId: tournament!.id, userId: actor.id })
      .returning();
    await db
      .update(tournaments)
      .set({ bracketJson: { championParticipantId: participant!.id } })
      .where(eq(tournaments.id, tournament!.id));

    const sessions = await app.inject({
      method: "GET",
      url: "/api/v1/auth/sessions",
      cookies: { tab10_session: actor.cookie },
    });
    const currentSession = sessions
      .json()
      .sessions.find((session: { current: boolean }) => session.current);
    await db.insert(judgeSessions).values({
      matchId: games[0]!.id,
      userId: actor.id,
      authSessionId: currentSession.id,
      expiresAt: new Date("2026-09-07T13:00:00.000Z"),
      releasedAt: new Date("2026-09-01T10:11:00.000Z"),
    });
  }

  it("PROFILE-001/002/005/006: returns complete own stats, facts, teams, and current identity", async () => {
    await seedProfileHistory();

    const renamed = await app.inject({
      method: "PATCH",
      url: "/api/v1/profile/me",
      cookies: { tab10_session: actor.cookie },
      payload: {
        firstName: "Анна-Мария",
        lastName: "Профиль",
        birthDate: "1991-06-11",
        organizationText: "Московский транспорт",
        positionText: "Старший инженер",
      },
    });
    expect(renamed.statusCode).toBe(200);
    expect(Object.keys(renamed.json().user).sort()).toEqual([
      "avatarKey",
      "birthDate",
      "email",
      "firstName",
      "id",
      "lastName",
      "mustChangePassword",
      "onboardingCompletedAt",
      "onboardingStep",
      "organizationText",
      "positionText",
      "role",
      "status",
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/profile/me",
      cookies: { tab10_session: actor.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().profile).toMatchObject({
      isOwn: true,
      canChallenge: false,
      identity: {
        id: actor.id,
        firstName: "Анна-Мария",
        lastName: "Профиль",
        email: "anna@profile.test",
        birthDate: "1991-06-11",
        organizationText: "Московский транспорт",
        positionText: "Старший инженер",
      },
      stats: {
        matchesPlayed: 4,
        wins: 3,
        losses: 1,
        winRate: 0.75,
        averagePoints: 10.3,
        tournamentsPlayed: 1,
        tournamentWins: 1,
        tournamentsCreated: 1,
        judgedMatches: 1,
        rank: 1,
      },
      facts: {
        longestMatch: { title: "Долгая игра", durationSeconds: 1200 },
        bestWinningScore: { title: "Лучшая победа", score: "11:5" },
        frequentOpponent: {
          userId: rival.id,
          displayName: "Соперник Борис",
          matchCount: 3,
        },
        rival: {
          userId: rival.id,
          displayName: "Соперник Борис",
          matchCount: 3,
        },
      },
      teams: [{ name: "Север", role: "captain" }],
      avatar: { key: expect.any(String), editable: false },
    });
  });

  it("PROFILE-001: counts played tournaments without withdrawn entries and awards wins only for finished champions", async () => {
    const tournamentFixtures = [
      {
        title: "Завершённая победа",
        status: "finished",
        participantStatus: "active",
        champion: true,
      },
      {
        title: "Остановленный турнир",
        status: "stopped",
        participantStatus: "active",
        champion: true,
      },
      {
        title: "Снятый до старта",
        status: "finished",
        participantStatus: "withdrawn",
        champion: false,
      },
      {
        title: "Техническое поражение",
        status: "finished",
        participantStatus: "forfeited",
        champion: false,
      },
    ] as const;

    for (const fixture of tournamentFixtures) {
      const [tournament] = await db
        .insert(tournaments)
        .values({
          title: fixture.title,
          status: fixture.status,
          createdByUserId: rival.id,
          finishedAt: new Date("2026-09-01T12:00:00.000Z"),
        })
        .returning();
      const [participant] = await db
        .insert(tournamentParticipants)
        .values({
          tournamentId: tournament!.id,
          userId: actor.id,
          status: fixture.participantStatus,
        })
        .returning();
      if (fixture.champion) {
        await db
          .update(tournaments)
          .set({ bracketJson: { championParticipantId: participant!.id } })
          .where(eq(tournaments.id, tournament!.id));
      }
    }

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/profile/me",
      cookies: { tab10_session: actor.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().profile.stats).toMatchObject({
      tournamentsPlayed: 3,
      tournamentWins: 1,
    });
  });

  it("PROFILE-005: public card omits private fields and keeps a blocked historical target non-challengeable", async () => {
    await services.auth.blockUser(admin.id, rival.id);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/players/${rival.id}`,
      cookies: { tab10_session: actor.cookie },
    });
    expect(response.statusCode).toBe(200);
    const profile = response.json().profile;
    expect(profile).toMatchObject({
      isOwn: false,
      canChallenge: false,
      identity: {
        id: rival.id,
        firstName: "Борис",
        lastName: "Соперник",
      },
    });
    expect(profile.identity).not.toHaveProperty("email");
    expect(profile.identity).not.toHaveProperty("birthDate");
    expect(JSON.stringify(profile)).not.toMatch(
      /password|tokenHash|lastLoginAt|blockedAt|uploadedAvatarPath/,
    );
  });

  it("PROFILE-003/004: rejects email and avatar mutation without changing identity", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/profile/me",
      cookies: { tab10_session: actor.cookie },
      payload: {
        firstName: "Подмена",
        email: "changed@profile.test",
        avatarKey: "avatar_10",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION");

    const own = await app.inject({
      method: "GET",
      url: "/api/v1/profile/me",
      cookies: { tab10_session: actor.cookie },
    });
    expect(own.json().profile.identity).toMatchObject({
      firstName: "Анна",
      email: "anna@profile.test",
      avatarKey: expect.any(String),
    });
  });

  it("PROFILE-003: rejects an impossible calendar date without changing the profile", async () => {
    const before = await app.inject({
      method: "GET",
      url: "/api/v1/profile/me",
      cookies: { tab10_session: actor.cookie },
    });
    expect(before.statusCode).toBe(200);
    const beforeBirthDate = before.json().profile.identity.birthDate;

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/profile/me",
      cookies: { tab10_session: actor.cookie },
      payload: { birthDate: "2026-02-30" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION");

    const own = await app.inject({
      method: "GET",
      url: "/api/v1/profile/me",
      cookies: { tab10_session: actor.cookie },
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().profile.identity.birthDate).toBe(beforeBirthDate);
  });

  it("AUTH-008: revokes another own session but never the current session", async () => {
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/auth/sessions",
      cookies: { tab10_session: actor.cookie },
    });
    const sessions = listed.json().sessions as Array<{
      id: string;
      current: boolean;
      createdAt: string;
      lastSeenAt: string;
    }>;
    expect(sessions).toHaveLength(3);
    expect(sessions.every((session) => session.createdAt && session.lastSeenAt)).toBe(
      true,
    );
    const current = sessions.find((session) => session.current)!;
    const other = sessions.find((session) => !session.current)!;

    const currentAttempt = await app.inject({
      method: "DELETE",
      url: `/api/v1/auth/sessions/${current.id}`,
      cookies: { tab10_session: actor.cookie },
    });
    expect(currentAttempt.statusCode).toBe(409);
    expect(currentAttempt.json().code).toBe("CURRENT_SESSION_FORBIDDEN");

    const revoked = await app.inject({
      method: "DELETE",
      url: `/api/v1/auth/sessions/${other.id}`,
      cookies: { tab10_session: actor.cookie },
    });
    expect(revoked.statusCode).toBe(200);
    const after = await app.inject({
      method: "GET",
      url: "/api/v1/auth/sessions",
      cookies: { tab10_session: actor.cookie },
    });
    expect(after.json().sessions).toHaveLength(2);
  });

  it("PROFILE-005: rejects a malformed public profile id as validation", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/players/not-a-uuid",
      cookies: { tab10_session: actor.cookie },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION");
  });

  it("AUTH-008: rejects a malformed session id without revoking any session", async () => {
    const before = await app.inject({
      method: "GET",
      url: "/api/v1/auth/sessions",
      cookies: { tab10_session: actor.cookie },
    });
    const beforeIds = before
      .json()
      .sessions.map((session: { id: string }) => session.id)
      .sort();

    const response = await app.inject({
      method: "DELETE",
      url: "/api/v1/auth/sessions/not-a-uuid",
      cookies: { tab10_session: actor.cookie },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION");

    const after = await app.inject({
      method: "GET",
      url: "/api/v1/auth/sessions",
      cookies: { tab10_session: actor.cookie },
    });
    expect(
      after.json().sessions.map((session: { id: string }) => session.id).sort(),
    ).toEqual(beforeIds);
  });

  it("PROFILE-005: a blocked actor cannot read another profile", async () => {
    await services.auth.blockUser(admin.id, actor.id);
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/players/${rival.id}`,
      cookies: { tab10_session: actor.cookie },
    });
    expect(response.statusCode).toBe(401);
  });
});
