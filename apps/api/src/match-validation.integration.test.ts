import { FakeClock } from "@tab10/test-utils";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";

describe("DATA-001 match validation and invariants", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let db: Db;
  let sqlClient: { exec: (sql: string) => Promise<unknown> };
  let close: () => Promise<void>;
  let adminId: string;
  let userAId: string;
  let userBId: string;
  let userCId: string;
  let userACookie: string;

  beforeEach(async () => {
    const ctx = await createMigratedPgliteDb();
    db = ctx.db;
    sqlClient = ctx.client;
    close = ctx.close;
    const built = await buildApp({ db, clock: new FakeClock() });
    app = built.app;
    services = built.services;

    const seeded = await services.auth.seedAdmin(
      "admin@tab10.local",
      "AdminPass1!",
    );
    adminId = seeded.user.id;

    const createUser = async (email: string) => {
      const created = await services.auth.createUser({
        email,
        firstName: "Test",
        lastName: "Player",
        role: "user",
        issuedByAdminId: adminId,
      });
      return created.user.id;
    };

    userAId = await createUser("a@tab10.local");
    userBId = await createUser("b@tab10.local");
    userCId = await createUser("c@tab10.local");

    const login = async (userId: string, email: string) => {
      const reset = await services.auth.resetPassword(adminId, userId);
      const first = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: reset.temporaryPassword },
      });
      const firstCookie = first.cookies.find(
        (cookie) => cookie.name === "tab10_session",
      )!.value;
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/password/first-change",
        cookies: { tab10_session: firstCookie },
        payload: { newPassword: "UserPass1!" },
      });
      const second = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: "UserPass1!" },
      });
      return second.cookies.find((cookie) => cookie.name === "tab10_session")!
        .value;
    };

    userACookie = await login(userAId, "a@tab10.local");
  });

  afterEach(async () => {
    await app.close();
    await close();
  });

  const validCreate = () => ({
    title: "Validated match",
    format: "1v1",
    pointsToWin: 11,
    mercyEnabled: true,
    mercyPoints: 5,
    participants: [
      { side: "A", userId: userAId },
      { side: "B", userId: userBId },
    ],
  });

  async function expectNoMatches() {
    expect(await db.query.matches.findMany()).toHaveLength(0);
    expect(await db.query.matchParticipants.findMany()).toHaveLength(0);
  }

  async function acceptRequiredPlayerInvitations(matchId: string) {
    const match = await services.matches.getMatch(matchId);
    for (const invitation of match?.invitations ?? []) {
      if (invitation.kind === "player" && invitation.status === "pending") {
        await services.matches.respondInvitation(invitation.id, invitation.invitedUserId, true);
      }
    }
  }

  it("INT_match__malformed_create_payloads_are_rejected_without_writes", async () => {
    const cases: Array<{ name: string; payload: unknown }> = [
      { name: "null body", payload: null },
      { name: "array body", payload: [] },
      { name: "missing roster", payload: { title: "Missing", format: "1v1" } },
      {
        name: "wrong scalar types",
        payload: {
          ...validCreate(),
          pointsToWin: "11",
          mercyEnabled: "yes",
        },
      },
      {
        name: "unknown fields",
        payload: { ...validCreate(), status: "finished" },
      },
    ];

    for (const testCase of cases) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/matches",
        cookies: { tab10_session: userACookie },
        payload: testCase.payload,
      });
      expect(response.statusCode, testCase.name).toBe(400);
      expect(response.json().code, testCase.name).toBe("VALIDATION");
      await expectNoMatches();
    }

    const malformedJson = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userACookie },
      headers: { "content-type": "application/json" },
      payload: '{"title":',
    });
    expect(malformedJson.statusCode).toBe(400);
    expect(malformedJson.json().code).toBe("VALIDATION");
    await expectNoMatches();
  });

  it("INT_match__invalid_rosters_and_rules_are_rejected_without_writes", async () => {
    const cases: Array<{ name: string; payload: Record<string, unknown> }> = [
      { name: "empty roster", payload: { ...validCreate(), participants: [] } },
      {
        name: "one-sided roster",
        payload: {
          ...validCreate(),
          participants: [
            { side: "A", userId: userAId },
            { side: "A", userId: userBId },
          ],
        },
      },
      {
        name: "self versus self",
        payload: {
          ...validCreate(),
          participants: [
            { side: "A", userId: userAId },
            { side: "B", userId: userAId },
          ],
        },
      },
      {
        name: "creator absent",
        payload: {
          ...validCreate(),
          participants: [
            { side: "A", userId: userBId },
            { side: "B", userId: userCId },
          ],
        },
      },
      { name: "zero points", payload: { ...validCreate(), pointsToWin: 0 } },
      {
        name: "fractional points",
        payload: { ...validCreate(), pointsToWin: 10.5 },
      },
      {
        name: "enabled mercy without positive threshold",
        payload: { ...validCreate(), mercyPoints: 0 },
      },
    ];

    for (const testCase of cases) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/matches",
        cookies: { tab10_session: userACookie },
        payload: testCase.payload,
      });
      expect(response.statusCode, testCase.name).toBe(400);
      expect(response.json().code, testCase.name).toBe("VALIDATION");
      await expectNoMatches();
    }
  });

  it("INT_match__blocked_participant_is_rejected_without_writes", async () => {
    await services.auth.blockUser(adminId, userBId);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userACookie },
      payload: validCreate(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION");
    await expectNoMatches();
  });

  it("INT_match__participant_insert_failure_rolls_back_match_and_roster", async () => {
    await sqlClient.exec(`
      CREATE FUNCTION reject_test_participant() RETURNS trigger AS $$
      BEGIN
        IF NEW.user_id = '${userBId}'::uuid THEN
          RAISE EXCEPTION 'injected participant failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_test_participant
        BEFORE INSERT ON match_participants
        FOR EACH ROW EXECUTE FUNCTION reject_test_participant();
    `);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userACookie },
      payload: validCreate(),
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    await expectNoMatches();
  });

  it("INT_match__invalid_side_and_winner_leave_state_and_version_unchanged", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userACookie },
      payload: validCreate(),
    });
    expect(created.statusCode).toBe(200);
    const matchId = created.json().match.id as string;
    await acceptRequiredPlayerInvitations(matchId);

    const started = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: userACookie },
      payload: { firstServerParticipantId: (await services.matches.getMatch(matchId))!.participants[0]!.id },
    });
    expect(started.statusCode).toBe(200);
    const acquired = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: userACookie },
    });
    expect(acquired.statusCode).toBe(200);

    const before = await services.matches.getMatch(matchId);
    const invalidRequests = [
      {
        name: "point side",
        url: `/api/v1/matches/${matchId}/points`,
        headers: { "idempotency-key": "invalid-side" },
        payload: { side: "C", expectedVersion: before!.version },
      },
      {
        name: "stop winner",
        url: `/api/v1/matches/${matchId}/stop`,
        payload: { winnerSide: "C", reasonCode: "time" },
      },
      {
        name: "stop reason",
        url: `/api/v1/matches/${matchId}/stop`,
        payload: { winnerSide: "A", reasonCode: "invented" },
      },
    ];

    for (const testCase of invalidRequests) {
      const response = await app.inject({
        method: "POST",
        url: testCase.url,
        cookies: { tab10_session: userACookie },
        headers: testCase.headers,
        payload: testCase.payload,
      });
      expect(response.statusCode, testCase.name).toBe(400);
      expect(response.json().code, testCase.name).toBe("VALIDATION");
      const after = await services.matches.getMatch(matchId);
      expect(after, testCase.name).toMatchObject({
        status: before!.status,
        scoreA: before!.scoreA,
        scoreB: before!.scoreB,
        winnerSide: before!.winnerSide,
        version: before!.version,
        eventLog: before!.eventLog,
      });
    }
  });

  it("INT_match__start_revalidates_server_and_blocked_roster_without_writes", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userACookie },
      payload: validCreate(),
    });
    const matchId = created.json().match.id as string;
    await acceptRequiredPlayerInvitations(matchId);
    const before = await services.matches.getMatch(matchId);

    const invalidServer = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: userACookie },
      payload: {
        firstServerParticipantId: "00000000-0000-4000-8000-000000000000",
      },
    });
    expect(invalidServer.statusCode).toBe(400);
    expect(invalidServer.json().code).toBe("VALIDATION");
    expect(await services.matches.getMatch(matchId)).toMatchObject({
      status: before!.status,
      version: before!.version,
      startedAt: before!.startedAt,
    });

    await services.auth.blockUser(adminId, userBId);
    const blockedRoster = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: userACookie },
      payload: { firstServerParticipantId: (await services.matches.getMatch(matchId))!.participants[0]!.id },
    });
    expect(blockedRoster.statusCode).toBe(400);
    expect(blockedRoster.json().code).toBe("VALIDATION");
    expect(await services.matches.getMatch(matchId)).toMatchObject({
      status: before!.status,
      version: before!.version,
      startedAt: before!.startedAt,
    });
  });

  it("INT_match__cancelled_to_stopped_transition_is_rejected_without_side_effects", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userACookie },
      payload: validCreate(),
    });
    const matchId = created.json().match.id as string;
    const cancelled = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/cancel`,
      cookies: { tab10_session: userACookie },
      headers: {
        "idempotency-key": "00000000-0000-4000-8000-000000000100",
      },
      payload: { expectedVersion: created.json().match.version },
    });
    expect(cancelled.statusCode).toBe(200);
    const before = await services.matches.getMatch(matchId);

    const stopped = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/stop`,
      cookies: { tab10_session: userACookie },
      payload: { winnerSide: "A", reasonCode: "time" },
    });

    expect(stopped.statusCode).toBe(400);
    expect(stopped.json().code).toBe("MATCH_NOT_ACTIVE");
    expect(await services.matches.getMatch(matchId)).toMatchObject({
      status: "cancelled",
      winnerSide: null,
      scoreA: before!.scoreA,
      scoreB: before!.scoreB,
      version: before!.version,
      eventLog: before!.eventLog,
    });
  });
});
