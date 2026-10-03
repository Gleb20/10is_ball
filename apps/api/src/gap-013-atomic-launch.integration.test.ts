import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MatchLaunchRequestSchema } from "@tab10/shared";
import { FakeClock } from "@tab10/test-utils";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import {
  authSessions,
  judgeSessions,
  matchLaunchRequests,
  matchParticipants,
  matches,
  users,
} from "./db/schema.js";
import { hashToken } from "./modules/auth/auth-service.js";

const NOW = new Date("2026-10-03T12:34:56.000Z");
const ACTOR = "00000000-0000-4000-8000-000000013001";
const PLAYER_A = "00000000-0000-4000-8000-000000013002";
const PLAYER_B = "00000000-0000-4000-8000-000000013003";
const PLAYER_C = "00000000-0000-4000-8000-000000013004";
const OUTSIDER = "00000000-0000-4000-8000-000000013005";
const ACTOR_SESSION = "00000000-0000-4000-8000-000000013011";
const OUTSIDER_SESSION = "00000000-0000-4000-8000-000000013012";
const EXPIRED_SESSION = "00000000-0000-4000-8000-000000013014";
const REQUEST_ID = "00000000-0000-4000-8000-000000013101";

function launchPayload(overrides: Record<string, unknown> = {}) {
  return {
    requestId: REQUEST_ID,
    format: "1v1",
    pointsToWin: 12,
    mercyEnabled: true,
    firstServerMethod: "manual",
    firstServerSlot: "B1",
    roster: {
      A1: { userId: PLAYER_A },
      B1: { userId: PLAYER_B },
    },
    ...overrides,
  };
}

describe("GAP-013 atomic match launch", () => {
  let db: Db;
  let app: FastifyInstance;
  let services: AppServices;
  let closeDb: () => Promise<void>;
  let randomCalls: number;

  beforeEach(async () => {
    const context = await createMigratedPgliteDb();
    db = context.db;
    closeDb = context.close;
    randomCalls = 0;
    const built = await buildApp({
      db,
      clock: new FakeClock(NOW),
      randomIndex: () => {
        randomCalls += 1;
        return 2;
      },
    });
    app = built.app;
    services = built.services;
    await db.insert(users).values([
      { id: ACTOR, email: "actor@gap013.test", passwordHash: "x", firstName: "Launch", lastName: "Actor", mustChangePassword: false },
      { id: PLAYER_A, email: "a@gap013.test", passwordHash: "x", firstName: "Player", lastName: "A", mustChangePassword: false },
      { id: PLAYER_B, email: "b@gap013.test", passwordHash: "x", firstName: "Player", lastName: "B", mustChangePassword: false },
      { id: PLAYER_C, email: "c@gap013.test", passwordHash: "x", firstName: "Player", lastName: "C", mustChangePassword: false },
      { id: OUTSIDER, email: "outsider@gap013.test", passwordHash: "x", firstName: "Other", lastName: "Actor", mustChangePassword: false },
    ]);
    await db.insert(authSessions).values([
      { id: ACTOR_SESSION, userId: ACTOR, tokenHash: hashToken("actor"), expiresAt: new Date("2026-10-04T12:34:56.000Z") },
      { id: OUTSIDER_SESSION, userId: OUTSIDER, tokenHash: hashToken("outsider"), expiresAt: new Date("2026-10-04T12:34:56.000Z") },
      { id: EXPIRED_SESSION, userId: ACTOR, tokenHash: hashToken("expired"), expiresAt: new Date("2026-10-02T12:34:56.000Z") },
    ]);
  });

  afterEach(async () => {
    await app.close();
    await closeDb();
  });

  const post = (
    payload: Record<string, unknown>,
    requestId = REQUEST_ID,
    token = "actor",
  ) =>
    app.inject({
      method: "POST",
      url: "/api/v1/matches/launches",
      cookies: { tab10_session: token },
      headers: { "idempotency-key": requestId },
      payload,
    });

  it("atomically creates, judges and starts a creator-outside-roster match", async () => {
    const response = await post(launchPayload({ title: "  Named match  " }));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      requestId: REQUEST_ID,
      matchId: expect.any(String),
    });
    const matchId = response.json().matchId as string;
    const detail = await services.matches.getMatch(matchId);
    const server = detail?.participants.find((participant) => participant.userId === PLAYER_B);
    expect(detail).toMatchObject({
      id: matchId,
      title: "Named match",
      createdByUserId: ACTOR,
      status: "in_progress",
      pointsToWin: 12,
      mercyEnabled: true,
      mercyPoints: 5,
      startedAt: NOW,
      currentServerParticipantId: server?.id,
      activeJudge: { userId: ACTOR },
    });
    expect(detail?.invitations).toEqual([]);
    expect(await db.query.judgeSessions.findFirst({
      where: and(
        eq(judgeSessions.matchId, matchId),
        isNull(judgeSessions.releasedAt),
      ),
    })).toMatchObject({ userId: ACTOR, authSessionId: ACTOR_SESSION });

    const [receipt] = await db.select().from(matchLaunchRequests);
    expect(receipt).toMatchObject({
      actorUserId: ACTOR,
      requestId: REQUEST_ID,
      originatingAuthSessionId: ACTOR_SESSION,
      matchId,
      initialServerParticipantId: server?.id,
      slotMap: { A1: expect.any(String), B1: server?.id },
      createdAt: NOW,
    });
    expect(randomCalls).toBe(0);

    const outcome = await app.inject({
      method: "GET",
      url: `/api/v1/matches/launches/${REQUEST_ID}`,
      cookies: { tab10_session: "actor" },
    });
    expect(outcome.statusCode).toBe(200);
    expect(outcome.headers["cache-control"]).toBe("no-store");
    expect(outcome.json()).toEqual({ outcome: "committed", matchId });

    const hidden = await app.inject({
      method: "GET",
      url: `/api/v1/matches/launches/${REQUEST_ID}`,
      cookies: { tab10_session: "outsider" },
    });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json()).toEqual({ outcome: "unknown" });
  });

  it("uses one server timestamp for the default title and startedAt", async () => {
    const response = await post(launchPayload());
    const detail = await services.matches.getMatch(response.json().matchId as string);
    expect(detail).toMatchObject({
      title: "Матч 03.10, 15:34",
      startedAt: NOW,
    });
  });

  it("maps random selection through canonical slots once and replays without randomness", async () => {
    const payload = launchPayload({
      format: "2v2",
      firstServerMethod: "random",
      firstServerSlot: undefined,
      roster: {
        A1: { userId: PLAYER_A },
        A2: { guestFirstName: "Ada", guestLastName: "Lovelace" },
        B1: { userId: PLAYER_B },
        B2: { userId: PLAYER_C },
      },
    });
    const first = await post(payload);
    const replay = await post(payload);
    expect(replay.json()).toEqual(first.json());
    expect(randomCalls).toBe(1);
    const detail = await services.matches.getMatch(first.json().matchId as string);
    expect(detail?.participants.find((participant) => participant.id === detail.currentServerParticipantId)?.userId)
      .toBe(PLAYER_B);
  });

  it("conflicts on a changed fingerprint and never transfers judge ownership on reauthenticated replay", async () => {
    const payload = launchPayload();
    const first = await post(payload);
    const changed = await post(launchPayload({ pointsToWin: 21 }));
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const reauthenticatedSession = "00000000-0000-4000-8000-000000013013";
    await db.insert(authSessions).values({
      id: reauthenticatedSession,
      userId: ACTOR,
      tokenHash: hashToken("actor-new"),
      expiresAt: new Date("2026-10-04T12:34:56.000Z"),
    });
    await db.update(authSessions)
      .set({ revokedAt: NOW, revokeReason: "logout" })
      .where(eq(authSessions.id, ACTOR_SESSION));

    const replay = await post(payload, REQUEST_ID, "actor-new");
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    const active = await db.query.judgeSessions.findFirst({
      where: and(
        eq(judgeSessions.matchId, first.json().matchId as string),
        isNull(judgeSessions.releasedAt),
      ),
    });
    expect(active).toMatchObject({ authSessionId: ACTOR_SESSION });

    const outcome = await app.inject({
      method: "GET",
      url: `/api/v1/matches/launches/${REQUEST_ID}`,
      cookies: { tab10_session: "actor-new" },
    });
    expect(outcome.json()).toEqual({
      outcome: "committed",
      matchId: first.json().matchId,
    });
  });

  it("rejects mismatched request identity and rolls back post-create failures", async () => {
    const mismatched = await post(
      launchPayload(),
      "00000000-0000-4000-8000-000000013102",
    );
    expect(mismatched.statusCode).toBe(400);

    const waiting = await services.matches.createMatch({
      createdByUserId: ACTOR,
      title: "Existing judge work",
      format: "1v1",
      firstServerMethod: "manual",
      participants: [
        { side: "A", userId: PLAYER_A },
        { side: "B", userId: PLAYER_B },
      ],
    });
    await services.matches.acquireJudge({
      matchId: waiting!.id,
      userId: ACTOR,
      authSessionId: ACTOR_SESSION,
    });
    const beforeMatches = await db.select().from(matches);
    const beforeParticipants = await db.select().from(matchParticipants);

    const failed = await post(launchPayload({
      requestId: "00000000-0000-4000-8000-000000013103",
    }), "00000000-0000-4000-8000-000000013103");
    expect(failed.statusCode).toBe(400);
    expect(failed.json()).toMatchObject({ code: "JUDGE_BUSY" });
    expect(await db.select().from(matches)).toHaveLength(beforeMatches.length);
    expect(await db.select().from(matchParticipants)).toHaveLength(beforeParticipants.length);
    expect(await db.select().from(matchLaunchRequests)).toEqual([]);
    expect(await db.select().from(judgeSessions).where(and(
      ne(judgeSessions.matchId, waiting!.id),
      isNull(judgeSessions.releasedAt),
    ))).toEqual([]);
  });

  it("rejects an expired session without writes and rolls back a start-stage failure", async () => {
    const expired = await post(launchPayload(), REQUEST_ID, "expired");
    expect(expired.statusCode).toBe(401);
    expect(await db.select().from(matches)).toEqual([]);
    expect(await db.select().from(matchLaunchRequests)).toEqual([]);

    const failing = await buildApp({
      db,
      clock: new FakeClock(NOW),
      randomIndex: () => {
        throw new Error("RNG_FAIL");
      },
    });
    try {
      const request = MatchLaunchRequestSchema.parse(launchPayload({
        requestId: "00000000-0000-4000-8000-000000013104",
        firstServerMethod: "random",
        firstServerSlot: undefined,
      }));
      await expect(failing.services.matches.launchMatch({
        actorUserId: ACTOR,
        authSessionId: ACTOR_SESSION,
        request,
      })).rejects.toThrow("RNG_FAIL");
    } finally {
      await failing.app.close();
    }
    expect(await db.select().from(matches)).toEqual([]);
    expect(await db.select().from(matchParticipants)).toEqual([]);
    expect(await db.select().from(judgeSessions)).toEqual([]);
    expect(await db.select().from(matchLaunchRequests)).toEqual([]);
  });

  it("keeps the immutable receipt after eligible hard purge", async () => {
    const payload = launchPayload();
    const launched = await post(payload);
    const matchId = launched.json().matchId as string;
    await db.update(matches).set({ status: "waiting" }).where(eq(matches.id, matchId));
    await services.matches.adminDeleteMatch({ matchId, actorAdminId: ACTOR });

    expect(await services.matches.getMatch(matchId)).toBeNull();
    const terminal = await app.inject({
      method: "GET",
      url: `/api/v1/matches/${matchId}`,
      cookies: { tab10_session: "actor" },
    });
    expect(terminal.statusCode).toBe(404);
    const replay = await post(payload);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ requestId: REQUEST_ID, matchId });
    expect(await db.select().from(matchLaunchRequests)).toHaveLength(1);
    expect(await db.select().from(matches)).toEqual([]);
  });
});
