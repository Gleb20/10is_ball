import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb } from "./db/client.js";

const CREATOR_CANCEL_KEY = "00000000-0000-4000-8000-000000000001";
const ADMIN_CANCEL_KEY = "00000000-0000-4000-8000-000000000002";
const STALE_CANCEL_KEY = "00000000-0000-4000-8000-000000000003";
const FORCE_CLOSE_KEY = "00000000-0000-4000-8000-000000000004";
const TEST_CLEANUP_KEY = "00000000-0000-4000-8000-000000000005";
const CONCURRENT_CANCEL_KEY_A = "00000000-0000-4000-8000-000000000006";
const CONCURRENT_CANCEL_KEY_B = "00000000-0000-4000-8000-000000000007";

type MatchSnapshot = {
  status: unknown;
  version: unknown;
  scoreA: unknown;
  scoreB: unknown;
  winnerSide: unknown;
  eventLog: unknown;
  activeJudge: unknown;
};

function snapshot(match: Record<string, unknown>): MatchSnapshot {
  return {
    status: match.status,
    version: match.version,
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    winnerSide: match.winnerSide,
    eventLog: match.eventLog,
    activeJudge: match.activeJudge,
  };
}

describe("BUG-002 match action authorization", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let close: () => Promise<void>;
  let adminCookie: string;
  let creatorCookie: string;
  let participantCookie: string;
  let creatorId: string;
  let participantId: string;

  beforeEach(async () => {
    const ctx = await createMigratedPgliteDb();
    close = ctx.close;
    const built = await buildApp({ db: ctx.db, clock: new FakeClock() });
    app = built.app;
    services = built.services;
    await services.auth.seedAdmin("admin@bug002.local", "AdminPass1!");

    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@bug002.local", password: "AdminPass1!" },
    });
    adminCookie = adminLogin.cookies.find(
      (cookie) => cookie.name === "tab10_session",
    )!.value;

    const creator = await createUser("creator@bug002.local", "CreatorPass1!");
    const participant = await createUser(
      "participant@bug002.local",
      "ParticipantPass1!",
    );
    creatorId = creator.id;
    creatorCookie = creator.cookie;
    participantId = participant.id;
    participantCookie = participant.cookie;
  });

  afterEach(async () => {
    if (app) await app.close();
    if (close) await close();
  });

  async function createUser(email: string, password: string) {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      cookies: { tab10_session: adminCookie },
      payload: { email, firstName: "Test", lastName: "User" },
    });
    const id = created.json().user.id as string;
    const initialLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email,
        password: created.json().temporaryPassword as string,
      },
    });
    const temporaryCookie = initialLogin.cookies.find(
      (cookie) => cookie.name === "tab10_session",
    )!.value;
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/first-change",
      cookies: { tab10_session: temporaryCookie },
      payload: { newPassword: password },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
    });
    return {
      id,
      cookie: login.cookies.find(
        (cookie) => cookie.name === "tab10_session",
      )!.value,
    };
  }

  async function createStandalone(options?: { participant?: boolean }) {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: creatorCookie },
      payload: {
        title: "BUG-002 authorization fixture",
        format: "1v1",
        participants: [
          { side: "A", userId: creatorId },
          options?.participant
            ? { side: "B", userId: participantId }
            : { side: "B", guestFirstName: "Guest", guestLastName: "Player" },
        ],
      },
    });
    expect(created.statusCode).toBe(200);
    return created.json().match as Record<string, unknown>;
  }

  async function getMatch(matchId: string) {
    const result = await app.inject({
      method: "GET",
      url: `/api/v1/matches/${matchId}`,
      cookies: { tab10_session: creatorCookie },
    });
    expect(result.statusCode).toBe(200);
    return result.json().match as Record<string, unknown>;
  }

  it("AT-MATCH-START-001: participant or outsider cannot start and state is unchanged", async () => {
    for (const participant of [true, false]) {
      const match = await createStandalone({ participant });
      const before = snapshot(match);
      const denied = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${String(match.id)}/start`,
        cookies: { tab10_session: participantCookie },
        payload: { firstServerParticipantId: (await services.matches.getMatch(String(match.id)))!.participants[0]!.id },
      });
      const after = snapshot(await getMatch(String(match.id)));

      expect(denied.statusCode).toBe(403);
      expect(denied.json().code).toBe("FORBIDDEN");
      expect(after).toEqual(before);
    }
  });

  it("AT-MATCH-STOP-001/002: participant is denied without side effects while current judge may stop", async () => {
    const participantMatch = await createStandalone({ participant: true });
    const participantMatchId = String(participantMatch.id);
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${participantMatchId}/start`,
      cookies: { tab10_session: creatorCookie },
      payload: { firstServerParticipantId: (await services.matches.getMatch(participantMatchId))!.participants[0]!.id },
    });
    const before = snapshot(await getMatch(participantMatchId));
    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${participantMatchId}/stop`,
      cookies: { tab10_session: participantCookie },
      payload: { winnerSide: "A", reasonCode: "injury" },
    });
    const after = snapshot(await getMatch(participantMatchId));

    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe("FORBIDDEN");
    expect(after).toEqual(before);

    const cleanup = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${participantMatchId}/cancel`,
      cookies: { tab10_session: creatorCookie },
      headers: { "idempotency-key": TEST_CLEANUP_KEY },
      payload: { expectedVersion: after.version },
    });
    expect(cleanup.statusCode).toBe(200);

    const judgedMatch = await createStandalone();
    const judgedMatchId = String(judgedMatch.id);
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${judgedMatchId}/start`,
      cookies: { tab10_session: creatorCookie },
      payload: { firstServerParticipantId: (await services.matches.getMatch(judgedMatchId))!.participants[0]!.id },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${judgedMatchId}/judge/acquire`,
      cookies: { tab10_session: participantCookie },
    });
    const stopped = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${judgedMatchId}/stop`,
      cookies: { tab10_session: participantCookie },
      payload: { winnerSide: "B", reasonCode: "time" },
    });

    expect(stopped.statusCode).toBe(200);
    expect(stopped.json().match.status).toBe("stopped");
    expect(stopped.json().match.winnerSide).toBe("B");
  });

  it("AT-MATCH-CANCEL-002: participant and current judge are denied without mutation", async () => {
    const participantMatch = await createStandalone({ participant: true });
    const participantMatchId = String(participantMatch.id);
    const participantBefore = snapshot(participantMatch);
    const participantDenied = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${participantMatchId}/cancel`,
      cookies: { tab10_session: participantCookie },
      headers: { "idempotency-key": STALE_CANCEL_KEY },
      payload: { expectedVersion: participantMatch.version },
    });
    const participantAfter = snapshot(await getMatch(participantMatchId));

    expect(participantDenied.statusCode).toBe(403);
    expect(participantDenied.json().code).toBe("FORBIDDEN");
    expect(participantAfter).toEqual(participantBefore);

    const outsiderMatch = await createStandalone();
    const outsiderMatchId = String(outsiderMatch.id);
    const outsiderBefore = snapshot(outsiderMatch);
    const outsiderDenied = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${outsiderMatchId}/cancel`,
      cookies: { tab10_session: participantCookie },
      headers: { "idempotency-key": STALE_CANCEL_KEY },
      payload: { expectedVersion: outsiderMatch.version },
    });
    const outsiderAfter = snapshot(await getMatch(outsiderMatchId));

    expect(outsiderDenied.statusCode).toBe(403);
    expect(outsiderDenied.json().code).toBe("FORBIDDEN");
    expect(outsiderAfter).toEqual(outsiderBefore);

    const judgedMatch = await createStandalone();
    const judgedMatchId = String(judgedMatch.id);
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${judgedMatchId}/start`,
      cookies: { tab10_session: creatorCookie },
      payload: { firstServerParticipantId: (await services.matches.getMatch(judgedMatchId))!.participants[0]!.id },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${judgedMatchId}/judge/acquire`,
      cookies: { tab10_session: participantCookie },
    });
    const judgeBefore = snapshot(await getMatch(judgedMatchId));
    const judgeDenied = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${judgedMatchId}/cancel`,
      cookies: { tab10_session: participantCookie },
      headers: { "idempotency-key": STALE_CANCEL_KEY },
      payload: { expectedVersion: judgeBefore.version },
    });
    const judgeAfter = snapshot(await getMatch(judgedMatchId));

    expect(judgeDenied.statusCode).toBe(403);
    expect(judgeDenied.json().code).toBe("FORBIDDEN");
    expect(judgeAfter).toEqual(judgeBefore);
  });

  it("AT-MATCH-CANCEL-001/004: creator cancel is idempotent and stale or malformed requests do not mutate", async () => {
    const match = await createStandalone();
    const matchId = String(match.id);
    const before = snapshot(match);
    const missingKey = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/cancel`,
      cookies: { tab10_session: creatorCookie },
      payload: { expectedVersion: match.version },
    });
    const afterMissingKey = snapshot(await getMatch(matchId));

    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json().code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(afterMissingKey).toEqual(before);

    const invalidKey = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/cancel`,
      cookies: { tab10_session: creatorCookie },
      headers: { "idempotency-key": "not-a-uuid" },
      payload: { expectedVersion: match.version },
    });
    const afterInvalidKey = snapshot(await getMatch(matchId));

    expect(invalidKey.statusCode).toBe(400);
    expect(invalidKey.json().code).toBe("VALIDATION");
    expect(afterInvalidKey).toEqual(before);

    const stale = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/cancel`,
      cookies: { tab10_session: creatorCookie },
      headers: { "idempotency-key": STALE_CANCEL_KEY },
      payload: { expectedVersion: Number(match.version) + 1 },
    });
    const afterStale = snapshot(await getMatch(matchId));

    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("VERSION_CONFLICT");
    expect(afterStale).toEqual(before);

    const cancelled = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/cancel`,
      cookies: { tab10_session: creatorCookie },
      headers: { "idempotency-key": CREATOR_CANCEL_KEY },
      payload: {
        expectedVersion: match.version,
        reasonText: "Created by mistake",
      },
    });
    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/cancel`,
      cookies: { tab10_session: creatorCookie },
      headers: { "idempotency-key": CREATOR_CANCEL_KEY },
      payload: {
        expectedVersion: match.version,
        reasonText: "Created by mistake",
      },
    });

    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().match).toEqual(replay.json().match);
    expect(cancelled.json().match.status).toBe("cancelled");
    expect(cancelled.json().match.version).toBe(Number(match.version) + 1);
    expect(cancelled.json().match.stopReasonText).toBe("Created by mistake");
  });

  it("AT-MATCH-CANCEL-002/004: active admin may cancel and force-close retry is idempotent", async () => {
    const adminCancelledMatch = await createStandalone();
    const adminCancelled = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${String(adminCancelledMatch.id)}/cancel`,
      cookies: { tab10_session: adminCookie },
      headers: { "idempotency-key": ADMIN_CANCEL_KEY },
      payload: { expectedVersion: adminCancelledMatch.version },
    });

    expect(adminCancelled.statusCode).toBe(200);
    expect(adminCancelled.json().match.status).toBe("cancelled");

    const forceClosedMatch = await createStandalone();
    const forceClosedMatchId = String(forceClosedMatch.id);
    const forceClosed = await app.inject({
      method: "POST",
      url: `/api/v1/admin/matches/${forceClosedMatchId}/force-close`,
      cookies: { tab10_session: adminCookie },
      headers: { "idempotency-key": FORCE_CLOSE_KEY },
      payload: {
        expectedVersion: forceClosedMatch.version,
        reasonText: "Unstick player",
      },
    });
    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/admin/matches/${forceClosedMatchId}/force-close`,
      cookies: { tab10_session: adminCookie },
      headers: { "idempotency-key": FORCE_CLOSE_KEY },
      payload: {
        expectedVersion: forceClosedMatch.version,
        reasonText: "Unstick player",
      },
    });

    expect(forceClosed.statusCode).toBe(200);
    expect(forceClosed.json().match).toEqual(replay.json().match);
    expect(forceClosed.json().match.status).toBe("cancelled");
  });

  it("AT-MATCH-CANCEL-004: concurrent keys apply cancel once and release the judge atomically", async () => {
    const match = await createStandalone({ participant: true });
    const matchId = String(match.id);
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: creatorCookie },
      payload: { firstServerParticipantId: (await services.matches.getMatch(matchId))!.participants[0]!.id },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: participantCookie },
    });
    const before = await getMatch(matchId);

    const requests = [CONCURRENT_CANCEL_KEY_A, CONCURRENT_CANCEL_KEY_B].map(
      (idempotencyKey) =>
        app.inject({
          method: "POST",
          url: `/api/v1/matches/${matchId}/cancel`,
          cookies: { tab10_session: creatorCookie },
          headers: { "idempotency-key": idempotencyKey },
          payload: { expectedVersion: before.version },
        }),
    );
    const results = await Promise.all(requests);
    const after = await getMatch(matchId);

    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    expect(after.status).toBe("cancelled");
    expect(after.version).toBe(Number(before.version) + 1);
    expect(after.activeJudge).toBeNull();
  });
});
