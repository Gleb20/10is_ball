import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb } from "./db/client.js";

type SessionUser = { id: string; cookie: string };

describe("API ownership boundaries", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let close: () => Promise<void>;
  let adminCookie: string;
  let organizer: SessionUser;
  let participant: SessionUser;
  let judge: SessionUser;
  let outsider: SessionUser;

  beforeEach(async () => {
    const ctx = await createMigratedPgliteDb();
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
    adminCookie = adminLogin.cookies.find(
      (cookie) => cookie.name === "tab10_session",
    )!.value;

    organizer = await createActiveUser("organizer");
    participant = await createActiveUser("participant");
    judge = await createActiveUser("judge");
    outsider = await createActiveUser("outsider");
  });

  afterEach(async () => {
    if (app) await app.close();
    if (close) await close();
  });

  async function createActiveUser(label: string): Promise<SessionUser> {
    const email = `${label}@ownership.test`;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      cookies: { tab10_session: adminCookie },
      payload: { email, firstName: label, lastName: "Test" },
    });
    expect(created.statusCode).toBe(200);

    const id = created.json().user.id as string;
    const temporaryPassword = created.json().temporaryPassword as string;
    const temporaryLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: temporaryPassword },
    });
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
      id,
      cookie: login.cookies.find(
        (cookie) => cookie.name === "tab10_session",
      )!.value,
    };
  }

  async function createStandaloneMatch() {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: organizer.cookie },
      payload: {
        title: "Ownership match",
        format: "1v1",
        participants: [
          { side: "A", userId: organizer.id },
          { side: "B", userId: participant.id },
        ],
      },
    });
    expect(created.statusCode).toBe(200);
    const matchId = created.json().match.id as string;
    await acceptRequiredPlayerInvitations(matchId);
    return matchId;
  }

  async function acceptRequiredPlayerInvitations(matchId: string) {
    const match = await services.matches.getMatch(matchId);
    for (const invitation of match?.invitations ?? []) {
      if (invitation.kind === "player" && invitation.status === "pending") {
        await services.matches.respondInvitation(invitation.id, invitation.invitedUserId, true);
      }
    }
  }

  async function createTournament(createdBy = organizer) {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tournaments",
      cookies: { tab10_session: createdBy.cookie },
      payload: {
        title: "Ownership tournament",
        format: "single_elimination",
        organizerParticipates: true,
      },
    });
    expect(created.statusCode).toBe(200);
    return created.json().tournament as {
      id: string;
      participants: Array<{ id: string; userId: string | null; status: string }>;
    };
  }

  async function addTournamentParticipant(
    tournamentId: string,
    payload: { userId?: string; guestFirstName?: string; guestLastName?: string },
  ) {
    return app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${tournamentId}/participants`,
      cookies: { tab10_session: organizer.cookie },
      payload,
    });
  }

  it("AT-MATCH-START-001: only creator starts a valid match", async () => {
    const matchId = await createStandaloneMatch();
    const acquired = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: judge.cookie },
    });
    expect(acquired.statusCode).toBe(200);

    const unauthenticated = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      payload: { firstServerParticipantId: (await services.matches.getMatch(matchId))!.participants[0]!.id },
    });
    expect(unauthenticated.statusCode).toBe(401);

    const forbiddenActors = [
      ["participant", participant.cookie],
      ["active judge", judge.cookie],
      ["outsider", outsider.cookie],
      ["admin", adminCookie],
    ] as const;
    for (const [role, cookie] of forbiddenActors) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/start`,
        cookies: { tab10_session: cookie },
        payload: { firstServerParticipantId: (await services.matches.getMatch(matchId))!.participants[0]!.id },
      });
      expect(response.statusCode, role).toBe(403);
      expect(response.json().code, role).toBe("FORBIDDEN");

      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/matches/${matchId}`,
        cookies: { tab10_session: organizer.cookie },
      });
      expect(detail.json().match.status, role).toBe("waiting");
    }

    const started = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: organizer.cookie },
      payload: { firstServerParticipantId: (await services.matches.getMatch(matchId))!.participants[0]!.id },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().match.status).toBe("in_progress");
  });

  it("AT-TRN-016: roster and bracket mutations are organizer-only", async () => {
    const matchId = await createStandaloneMatch();
    const acquired = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: judge.cookie },
    });
    expect(acquired.statusCode).toBe(200);

    const tournament = await createTournament();
    expect(
      (await addTournamentParticipant(tournament.id, { userId: participant.id }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await addTournamentParticipant(tournament.id, {
          guestFirstName: "Seed",
          guestLastName: "Guest",
        })
      ).statusCode,
    ).toBe(200);

    const unauthenticatedAdd = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${tournament.id}/participants`,
      payload: { guestFirstName: "No", guestLastName: "Session" },
    });
    expect(unauthenticatedAdd.statusCode).toBe(401);

    const forbiddenActors = [
      ["participant", participant.cookie],
      ["active judge", judge.cookie],
      ["outsider", outsider.cookie],
      ["admin", adminCookie],
    ] as const;
    for (const [role, cookie] of forbiddenActors) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tournament.id}/participants`,
        cookies: { tab10_session: cookie },
        payload: { guestFirstName: role, guestLastName: "Forbidden" },
      });
      expect(response.statusCode, role).toBe(403);
      expect(response.json().code, role).toBe("FORBIDDEN");

      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/tournaments/${tournament.id}`,
        cookies: { tab10_session: organizer.cookie },
      });
      expect(detail.json().tournament.participants, role).toHaveLength(3);
      expect(detail.json().tournament.status, role).toBe("collecting");
    }

    for (const [role, cookie] of forbiddenActors) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tournament.id}/bracket`,
        cookies: { tab10_session: cookie },
        payload: {},
      });
      expect(response.statusCode, role).toBe(403);
      expect(response.json().code, role).toBe("FORBIDDEN");

      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/tournaments/${tournament.id}`,
        cookies: { tab10_session: organizer.cookie },
      });
      expect(detail.json().tournament.status, role).toBe("collecting");
    }

    const generated = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${tournament.id}/bracket`,
      cookies: { tab10_session: organizer.cookie },
      payload: {},
    });
    expect(generated.statusCode).toBe(200);
    const generatedVersion = generated.json().bracketStateVersion as number;

    for (const [role, cookie] of forbiddenActors) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tournament.id}/bracket`,
        cookies: { tab10_session: cookie },
        payload: {},
      });
      expect(response.statusCode, role).toBe(403);
      expect(response.json().code, role).toBe("FORBIDDEN");

      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/tournaments/${tournament.id}`,
        cookies: { tab10_session: organizer.cookie },
      });
      expect(detail.json().tournament.status, role).toBe("bracket_generated");
      expect(detail.json().tournament.bracketStateVersion, role).toBe(
        generatedVersion,
      );
    }

    const participantId = (generated.json().participants as Array<{
      id: string;
      userId: string | null;
    }>).find((entry) => entry.userId === participant.id)!.id;
    for (const [role, cookie] of forbiddenActors) {
      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/tournaments/${tournament.id}/participants/${participantId}`,
        cookies: { tab10_session: cookie },
      });
      expect(response.statusCode, role).toBe(403);
      expect(response.json().code, role).toBe("FORBIDDEN");
    }

    const beforeOwnerRemoval = await app.inject({
      method: "GET",
      url: `/api/v1/tournaments/${tournament.id}`,
      cookies: { tab10_session: organizer.cookie },
    });
    expect(beforeOwnerRemoval.json().tournament.status).toBe("bracket_generated");
    expect(
      (
        beforeOwnerRemoval.json().tournament.participants as Array<{
          id: string;
          status: string;
        }>
      ).find((entry) => entry.id === participantId)?.status,
    ).toBe("active");

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/tournaments/${tournament.id}/participants/${participantId}`,
      cookies: { tab10_session: organizer.cookie },
    });
    expect(removed.statusCode).toBe(200);
    const afterRemoval = await app.inject({
      method: "GET",
      url: `/api/v1/tournaments/${tournament.id}`,
      cookies: { tab10_session: organizer.cookie },
    });
    expect(afterRemoval.json().tournament.status).toBe("needs_regeneration");
  });

  it("AT-TRN-017: participant ID must belong to the route tournament", async () => {
    const routeTournament = await createTournament();
    expect(
      (
        await addTournamentParticipant(routeTournament.id, {
          guestFirstName: "Route",
          guestLastName: "One",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await addTournamentParticipant(routeTournament.id, {
          guestFirstName: "Route",
          guestLastName: "Two",
        })
      ).statusCode,
    ).toBe(200);
    const generated = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${routeTournament.id}/bracket`,
      cookies: { tab10_session: organizer.cookie },
      payload: {},
    });
    expect(generated.statusCode).toBe(200);

    const otherTournament = await createTournament(participant);
    const otherParticipantId = otherTournament.participants.find(
      (entry) => entry.userId === participant.id,
    )!.id;

    const mismatch = await app.inject({
      method: "DELETE",
      url: `/api/v1/tournaments/${routeTournament.id}/participants/${otherParticipantId}`,
      cookies: { tab10_session: organizer.cookie },
    });
    expect(mismatch.statusCode).toBe(404);
    expect(mismatch.json().code).toBe("NOT_FOUND");

    const routeAfter = await app.inject({
      method: "GET",
      url: `/api/v1/tournaments/${routeTournament.id}`,
      cookies: { tab10_session: organizer.cookie },
    });
    expect(routeAfter.json().tournament.status).toBe("bracket_generated");

    const otherAfter = await app.inject({
      method: "GET",
      url: `/api/v1/tournaments/${otherTournament.id}`,
      cookies: { tab10_session: participant.cookie },
    });
    const participantAfter = (
      otherAfter.json().tournament.participants as Array<{
        id: string;
        status: string;
      }>
    ).find((entry) => entry.id === otherParticipantId);
    expect(participantAfter?.status).toBe("active");
  });
});
