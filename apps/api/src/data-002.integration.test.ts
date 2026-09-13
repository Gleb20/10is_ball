import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb } from "./db/client.js";

describe("DATA-002 atomic match completion", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let close: () => Promise<void>;
  let adminCookie: string;
  let organizerCookie: string;
  let organizerId: string;

  beforeEach(async () => {
    const ctx = await createMigratedPgliteDb();
    close = ctx.close;
    const built = await buildApp({ db: ctx.db, clock: new FakeClock() });
    app = built.app;
    services = built.services;

    await services.auth.seedAdmin("data-002-admin@tab10.test", "AdminPass1!");
    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "data-002-admin@tab10.test",
        password: "AdminPass1!",
      },
    });
    adminCookie = adminLogin.cookies.find(
      (cookie) => cookie.name === "tab10_session",
    )!.value;

    const organizer = await createUser("data-002-organizer@tab10.test");
    organizerCookie = organizer.cookie;
    organizerId = organizer.id;
  });

  afterEach(async () => {
    if (app) await app.close();
    if (close) await close();
  });

  async function createUser(email: string) {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      cookies: { tab10_session: adminCookie },
      payload: { email, firstName: "Data", lastName: "Atomic" },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().user.id as string;
    const temporaryPassword = created.json().temporaryPassword as string;
    const firstLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: temporaryPassword },
    });
    const firstCookie = firstLogin.cookies.find(
      (cookie) => cookie.name === "tab10_session",
    )!.value;
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
      cookie: login.cookies.find(
        (cookie) => cookie.name === "tab10_session",
      )!.value,
    };
  }

  it("rolls back finish and stats when tournament advancement fails", async () => {
    const tournamentResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tournaments",
      cookies: { tab10_session: organizerCookie },
      payload: {
        title: "Atomic tournament",
        format: "single_elimination",
        organizerParticipates: true,
        pointsToWin: 1,
        mercyEnabled: false,
      },
    });
    expect(tournamentResponse.statusCode).toBe(200);
    const tournamentId = tournamentResponse.json().tournament.id as string;

    for (const email of ["data-002-b@tab10.test", "data-002-c@tab10.test", "data-002-d@tab10.test"]) {
      const player = await createUser(email);
      const added = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tournamentId}/participants`,
        cookies: { tab10_session: organizerCookie },
        payload: { userId: player.id },
      });
      expect(added.statusCode).toBe(200);
    }

    const generated = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${tournamentId}/bracket`,
      cookies: { tab10_session: organizerCookie },
      payload: { constructionAlgorithm: "power_of_two" },
    });
    expect(generated.statusCode).toBe(200);
    const startedTournament = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${tournamentId}/start`,
      cookies: { tab10_session: organizerCookie },
    });
    expect(startedTournament.statusCode).toBe(200);
    const matchId = startedTournament.json().tournament.matches[0].id as string;

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/matches/${matchId}/start`,
          payload: { firstServerParticipantId: (await services.matches.getMatch(matchId))!.participants[0]!.id },
          cookies: { tab10_session: organizerCookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/matches/${matchId}/judge/acquire`,
          cookies: { tab10_session: organizerCookie },
        })
      ).statusCode,
    ).toBe(200);
    let version = 0;
    let status = "in_progress";
    for (let pointNo = 0; pointNo < 11 && status === "in_progress"; pointNo += 1) {
      const point = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/points`,
        cookies: { tab10_session: organizerCookie },
        headers: { "idempotency-key": `data-002-point-${pointNo}` },
        payload: { side: "A", expectedVersion: version },
      });
      expect(point.statusCode).toBe(200);
      version = point.json().match.version as number;
      status = point.json().match.status as string;
    }
    expect(status).toBe("pending_confirmation");
    const matchBeforeFailure = await services.matches.getMatch(matchId);
    const tournamentBeforeFailure = await services.tournaments.get(tournamentId);

    services.matches.setTournamentMatchFinishedHook(async () => {
      throw new Error("DATA_002_INJECTED_ADVANCEMENT_FAILURE");
    });
    const confirm = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/confirm-finish`,
      cookies: { tab10_session: organizerCookie },
    });
    expect(confirm.statusCode).toBe(500);

    const matchAfterFailure = await services.matches.getMatch(matchId);
    expect(matchAfterFailure?.status).toBe("pending_confirmation");
    expect(matchAfterFailure?.version).toBe(matchBeforeFailure?.version);
    expect(matchAfterFailure?.eventLog).toEqual(matchBeforeFailure?.eventLog);
    expect(matchAfterFailure?.activeJudge).not.toBeNull();
    const tournamentAfterFailure = await services.tournaments.get(tournamentId);
    expect(tournamentAfterFailure?.bracketStateVersion).toBe(
      tournamentBeforeFailure?.bracketStateVersion,
    );
    expect(tournamentAfterFailure?.bracketJson).toEqual(
      tournamentBeforeFailure?.bracketJson,
    );
    expect(
      tournamentAfterFailure?.matches.map((match) => match.id).sort(),
    ).toEqual(tournamentBeforeFailure?.matches.map((match) => match.id).sort());
    const rankings = await app.inject({
      method: "GET",
      url: "/api/v1/rankings",
      cookies: { tab10_session: organizerCookie },
    });
    const organizerStats = rankings
      .json()
      .rankings.find((row: { userId: string }) => row.userId === organizerId) as
      | { wins: number; losses: number }
      | undefined;
    expect(organizerStats).toMatchObject({ wins: 0, losses: 0 });
  });

  it("treats a same-judge confirmation replay as success without double stats", async () => {
    const opponent = await createUser("data-002-replay-opponent@tab10.test");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: organizerCookie },
      payload: {
        title: "Idempotent confirmation",
        format: "1v1",
        pointsToWin: 1,
        participants: [
          { side: "A", userId: organizerId },
          { side: "B", userId: opponent.id },
        ],
      },
    });
    expect(created.statusCode).toBe(200);
    const matchId = created.json().match.id as string;

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/matches/${matchId}/start`,
          payload: { firstServerParticipantId: (await services.matches.getMatch(matchId))!.participants[0]!.id },
          cookies: { tab10_session: organizerCookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/matches/${matchId}/judge/acquire`,
          cookies: { tab10_session: organizerCookie },
        })
      ).statusCode,
    ).toBe(200);
    let version = 0;
    let status = "in_progress";
    for (let pointNo = 0; pointNo < 11 && status === "in_progress"; pointNo += 1) {
      const point = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/points`,
        cookies: { tab10_session: organizerCookie },
        headers: { "idempotency-key": `data-002-replay-point-${pointNo}` },
        payload: { side: "A", expectedVersion: version },
      });
      expect(point.statusCode).toBe(200);
      version = point.json().match.version as number;
      status = point.json().match.status as string;
    }
    expect(status).toBe("pending_confirmation");

    let confirmedVersion: number | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const confirmed = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/confirm-finish`,
        cookies: { tab10_session: organizerCookie },
      });
      expect(confirmed.statusCode).toBe(200);
      expect(confirmed.json().match.status).toBe("finished");
      if (confirmedVersion === undefined) {
        confirmedVersion = confirmed.json().match.version as number;
      } else {
        expect(confirmed.json().match.version).toBe(confirmedVersion);
      }
    }

    const rankings = await app.inject({
      method: "GET",
      url: "/api/v1/rankings",
      cookies: { tab10_session: organizerCookie },
    });
    const winner = rankings
      .json()
      .rankings.find((row: { userId: string }) => row.userId === organizerId);
    const loser = rankings
      .json()
      .rankings.find((row: { userId: string }) => row.userId === opponent.id);
    expect(winner).toMatchObject({ wins: 1, losses: 0 });
    expect(loser).toMatchObject({ wins: 0, losses: 1 });
  });
});
