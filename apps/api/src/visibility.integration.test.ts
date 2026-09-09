import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import { matches, tournaments } from "./db/schema.js";

type SessionUser = { id: string; cookie: string };

describe("API event visibility", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let db: Db;
  let close: () => Promise<void>;
  let clock: FakeClock;
  let adminCookie: string;
  let organizer: SessionUser;
  let participant: SessionUser;
  let judge: SessionUser;
  let tournamentJudge: SessionUser;
  let outsider: SessionUser;

  beforeEach(async () => {
    const ctx = await createMigratedPgliteDb();
    db = ctx.db;
    close = ctx.close;
    clock = new FakeClock(new Date("2026-09-07T10:00:00.000Z"));
    const built = await buildApp({ db, clock });
    app = built.app;
    services = built.services;

    await services.auth.seedAdmin("admin@tab10.local", "AdminPass1!");
    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@tab10.local", password: "AdminPass1!" },
    });
    expect(adminLogin.statusCode).toBe(200);
    adminCookie = adminLogin.cookies.find(
      (cookie) => cookie.name === "tab10_session",
    )!.value;

    organizer = await createActiveUser("organizer");
    participant = await createActiveUser("participant");
    judge = await createActiveUser("judge");
    tournamentJudge = await createActiveUser("tournament-judge");
    outsider = await createActiveUser("outsider");
  });

  afterEach(async () => {
    if (app) await app.close();
    if (close) await close();
  });

  async function createActiveUser(label: string): Promise<SessionUser> {
    const email = `${label}@visibility.test`;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      cookies: { tab10_session: adminCookie },
      payload: { email, firstName: label, lastName: "Visibility" },
    });
    expect(created.statusCode).toBe(200);

    const temporaryLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email,
        password: created.json().temporaryPassword as string,
      },
    });
    expect(temporaryLogin.statusCode).toBe(200);
    const temporaryCookie = temporaryLogin.cookies.find(
      (cookie) => cookie.name === "tab10_session",
    )!.value;
    const password = "UserPass1!";
    const changed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/first-change",
      cookies: { tab10_session: temporaryCookie },
      payload: { newPassword: password },
    });
    expect(changed.statusCode).toBe(200);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    return {
      id: created.json().user.id as string,
      cookie: login.cookies.find(
        (cookie) => cookie.name === "tab10_session",
      )!.value,
    };
  }

  async function createActiveEvents() {
    const matchResponse = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: organizer.cookie },
      payload: {
        title: "Private active match",
        format: "1v1",
        participants: [
          { side: "A", userId: organizer.id },
          { side: "B", userId: participant.id },
        ],
      },
    });
    expect(matchResponse.statusCode).toBe(200);
    const matchId = matchResponse.json().match.id as string;

    const tournamentResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tournaments",
      cookies: { tab10_session: organizer.cookie },
      payload: {
        title: "Private active tournament",
        format: "single_elimination",
        organizerParticipates: false,
      },
    });
    expect(tournamentResponse.statusCode).toBe(200);
    const tournamentId = tournamentResponse.json().tournament.id as string;
    const added = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${tournamentId}/participants`,
      cookies: { tab10_session: organizer.cookie },
      payload: { userId: participant.id },
    });
    expect(added.statusCode).toBe(200);

    const tournamentMatch = await services.matches.createMatch({
      createdByUserId: organizer.id,
      title: "Tournament judge context",
      format: "1v1",
      kind: "tournament",
      tournamentId,
      tournamentBracketMatchId: "W0_0",
      participants: [
        { side: "A", userId: organizer.id },
        { side: "B", userId: participant.id },
      ],
    });
    expect(tournamentMatch).not.toBeNull();

    return {
      matchId,
      tournamentId,
      tournamentMatchId: tournamentMatch!.id,
    };
  }

  async function acquireJudge(matchId: string, actor: SessionUser) {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: actor.cookie },
    });
    expect(response.statusCode).toBe(200);
  }

  async function idsFromList(
    url: "/api/v1/matches" | "/api/v1/tournaments",
    cookie: string,
  ) {
    const response = await app.inject({
      method: "GET",
      url,
      cookies: { tab10_session: cookie },
    });
    expect(response.statusCode).toBe(200);
    const key = url.endsWith("matches") ? "matches" : "tournaments";
    return (response.json()[key] as Array<{ id: string }>).map((row) => row.id);
  }

  async function assertDetail(
    type: "matches" | "tournaments",
    id: string,
    cookie: string,
    expectedStatus: number,
  ) {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/${type}/${id}`,
      cookies: { tab10_session: cookie },
    });
    expect(response.statusCode).toBe(expectedStatus);
    if (expectedStatus === 403) {
      expect(response.json().code).toBe("FORBIDDEN");
    }
  }

  it("AT-VIS-001: list and detail scope active events to organizer, participant, and current active judge", async () => {
    const active = await createActiveEvents();
    await acquireJudge(active.matchId, judge);
    await acquireJudge(active.tournamentMatchId, tournamentJudge);

    for (const [role, actor] of [
      ["organizer", organizer],
      ["participant", participant],
    ] as const) {
      expect(
        await idsFromList("/api/v1/matches", actor.cookie),
        role,
      ).toContain(active.matchId);
      expect(
        await idsFromList("/api/v1/tournaments", actor.cookie),
        role,
      ).toContain(active.tournamentId);
      await assertDetail("matches", active.matchId, actor.cookie, 200);
      await assertDetail("tournaments", active.tournamentId, actor.cookie, 200);
    }

    expect(await idsFromList("/api/v1/matches", judge.cookie)).toContain(
      active.matchId,
    );
    await assertDetail("matches", active.matchId, judge.cookie, 200);
    expect(
      await idsFromList("/api/v1/tournaments", tournamentJudge.cookie),
    ).toContain(active.tournamentId);
    await assertDetail(
      "tournaments",
      active.tournamentId,
      tournamentJudge.cookie,
      200,
    );

    expect(await idsFromList("/api/v1/matches", outsider.cookie)).not.toContain(
      active.matchId,
    );
    expect(
      await idsFromList("/api/v1/tournaments", outsider.cookie),
    ).not.toContain(active.tournamentId);
    await assertDetail("matches", active.matchId, outsider.cookie, 403);
    await assertDetail("tournaments", active.tournamentId, outsider.cookie, 403);

    const home = await app.inject({
      method: "GET",
      url: "/api/v1/home",
      cookies: { tab10_session: outsider.cookie },
    });
    expect(home.statusCode).toBe(200);
    expect(
      (home.json().lastMatches as Array<{ id: string }>).map((row) => row.id),
    ).not.toContain(active.matchId);

    clock.advanceMs(120_001);
    expect(await idsFromList("/api/v1/matches", judge.cookie)).not.toContain(
      active.matchId,
    );
    expect(
      await idsFromList("/api/v1/tournaments", tournamentJudge.cookie),
    ).not.toContain(active.tournamentId);
    await assertDetail("matches", active.matchId, judge.cookie, 403);
    await assertDetail(
      "tournaments",
      active.tournamentId,
      tournamentJudge.cookie,
      403,
    );
  });

  it("AT-VIS-002/004: active users see completed history while blocked users and tutorial sharing remain isolated", async () => {
    const completed = await createActiveEvents();
    const terminalMatchIds = [completed.matchId];
    const terminalTournamentIds = [completed.tournamentId];
    await db
      .update(matches)
      .set({ status: "finished", finishedAt: clock.now() })
      .where(eq(matches.id, completed.matchId));
    await db
      .update(tournaments)
      .set({ status: "finished", finishedAt: clock.now() })
      .where(eq(tournaments.id, completed.tournamentId));

    for (const status of ["stopped", "cancelled"] as const) {
      const match = await services.matches.createMatch({
        createdByUserId: organizer.id,
        title: `${status} history match`,
        format: "1v1",
        participants: [
          { side: "A", userId: organizer.id },
          { side: "B", userId: participant.id },
        ],
      });
      await db
        .update(matches)
        .set({ status, finishedAt: clock.now() })
        .where(eq(matches.id, match!.id));
      terminalMatchIds.push(match!.id);

      const tournament = await services.tournaments.create({
        createdByUserId: organizer.id,
        title: `${status} history tournament`,
        format: "single_elimination",
        organizerParticipates: false,
      });
      await db
        .update(tournaments)
        .set({ status, finishedAt: clock.now() })
        .where(eq(tournaments.id, tournament!.id));
      terminalTournamentIds.push(tournament!.id);
    }

    const visibleMatchIds = await idsFromList(
      "/api/v1/matches",
      outsider.cookie,
    );
    const visibleTournamentIds = await idsFromList(
      "/api/v1/tournaments",
      outsider.cookie,
    );
    for (const matchId of terminalMatchIds) {
      expect(visibleMatchIds).toContain(matchId);
      await assertDetail("matches", matchId, outsider.cookie, 200);
    }
    for (const tournamentId of terminalTournamentIds) {
      expect(visibleTournamentIds).toContain(tournamentId);
      await assertDetail("tournaments", tournamentId, outsider.cookie, 200);
    }

    const tutorialResponse = await app.inject({
      method: "POST",
      url: "/api/v1/matches/tutorial",
      cookies: { tab10_session: organizer.cookie },
    });
    expect(tutorialResponse.statusCode).toBe(200);
    const tutorialId = tutorialResponse.json().match.id as string;
    await db
      .update(matches)
      .set({ status: "finished", finishedAt: clock.now() })
      .where(eq(matches.id, tutorialId));
    expect(await idsFromList("/api/v1/matches", organizer.cookie)).not.toContain(
      tutorialId,
    );
    await assertDetail("matches", tutorialId, organizer.cookie, 200);
    await assertDetail("matches", tutorialId, outsider.cookie, 403);
    const ownerHome = await app.inject({
      method: "GET",
      url: "/api/v1/home",
      cookies: { tab10_session: organizer.cookie },
    });
    expect(
      (ownerHome.json().lastMatches as Array<{ id: string }>).map(
        (row) => row.id,
      ),
    ).not.toContain(tutorialId);

    const blocked = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${outsider.id}/block`,
      cookies: { tab10_session: adminCookie },
    });
    expect(blocked.statusCode).toBe(200);
    for (const url of [
      "/api/v1/matches",
      `/api/v1/matches/${completed.matchId}`,
      "/api/v1/tournaments",
      `/api/v1/tournaments/${completed.tournamentId}`,
    ]) {
      const response = await app.inject({
        method: "GET",
        url,
        cookies: { tab10_session: outsider.cookie },
      });
      expect(response.statusCode, url).toBe(401);
      expect(response.json().code, url).toBe("UNAUTHORIZED");
    }
  });

  it("AT-VIS-001/002: list and detail require an authenticated active session", async () => {
    const events = await createActiveEvents();
    for (const url of [
      "/api/v1/matches",
      `/api/v1/matches/${events.matchId}`,
      "/api/v1/tournaments",
      `/api/v1/tournaments/${events.tournamentId}`,
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(401);
      expect(response.json().code, url).toBe("UNAUTHORIZED");
    }
  });
});
