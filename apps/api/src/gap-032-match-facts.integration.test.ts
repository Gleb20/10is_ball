import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import { authSessions, judgeSessions, matches, users } from "./db/schema.js";
import { hashToken } from "./modules/auth/auth-service.js";

const NOW = new Date("2026-10-03T15:00:00.000Z");
const ACTOR = "00000000-0000-4000-8000-000000032001";
const PLAYER_A = "00000000-0000-4000-8000-000000032002";
const PLAYER_B = "00000000-0000-4000-8000-000000032003";
const TARGET = "00000000-0000-4000-8000-000000032004";
const OUTSIDER = "00000000-0000-4000-8000-000000032005";
const ACTOR_SESSION = "00000000-0000-4000-8000-000000032011";
const ACTOR_OTHER_SESSION = "00000000-0000-4000-8000-000000032012";
const TARGET_SESSION = "00000000-0000-4000-8000-000000032013";
const OUTSIDER_SESSION = "00000000-0000-4000-8000-000000032014";
const REQUEST_ID = "00000000-0000-4000-8000-000000032101";

describe("GAP-032 authoritative match facts", () => {
  let db: Db;
  let app: FastifyInstance;
  let closeDb: () => Promise<void>;
  let clock: FakeClock;

  beforeEach(async () => {
    const context = await createMigratedPgliteDb();
    db = context.db;
    closeDb = context.close;
    clock = new FakeClock(NOW);
    const built = await buildApp({ db, clock, randomIndex: () => 0 });
    app = built.app;
    await db.insert(users).values([
      { id: ACTOR, email: "actor@gap032.test", passwordHash: "x", firstName: "Shared", lastName: "Phone", mustChangePassword: false },
      { id: PLAYER_A, email: "a@gap032.test", passwordHash: "x", firstName: "Player", lastName: "A", mustChangePassword: false },
      { id: PLAYER_B, email: "b@gap032.test", passwordHash: "x", firstName: "Player", lastName: "B", mustChangePassword: false },
      { id: TARGET, email: "target@gap032.test", passwordHash: "x", firstName: "Next", lastName: "Judge", mustChangePassword: false },
      { id: OUTSIDER, email: "outsider@gap032.test", passwordHash: "x", firstName: "Outside", lastName: "User", mustChangePassword: false },
    ]);
    const expiresAt = new Date("2026-10-04T15:00:00.000Z");
    await db.insert(authSessions).values([
      { id: ACTOR_SESSION, userId: ACTOR, tokenHash: hashToken("actor"), expiresAt },
      { id: ACTOR_OTHER_SESSION, userId: ACTOR, tokenHash: hashToken("actor-other"), expiresAt },
      { id: TARGET_SESSION, userId: TARGET, tokenHash: hashToken("target"), expiresAt },
      { id: OUTSIDER_SESSION, userId: OUTSIDER, tokenHash: hashToken("outsider"), expiresAt },
    ]);
  });

  afterEach(async () => {
    await app.close();
    await closeDb();
  });

  const request = (token: string, options: Parameters<FastifyInstance["inject"]>[0]) =>
    app.inject({ ...options, cookies: { tab10_session: token } });

  async function launch(requestId = REQUEST_ID) {
    const response = await request("actor", {
      method: "POST",
      url: "/api/v1/matches/launches",
      headers: { "idempotency-key": requestId },
      payload: {
        requestId,
        format: "1v1",
        pointsToWin: 2,
        mercyEnabled: false,
        firstServerMethod: "manual",
        firstServerSlot: "B1",
        roster: {
          A1: { userId: PLAYER_A },
          B1: { userId: PLAYER_B },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json().matchId as string;
  }

  async function detail(matchId: string, token = "actor") {
    return request(token, { method: "GET", url: `/api/v1/matches/${matchId}` });
  }

  async function point(matchId: string, token: string, side: "A" | "B", expectedVersion: number, key: string) {
    return request(token, {
      method: "POST",
      url: `/api/v1/matches/${matchId}/points`,
      headers: { "idempotency-key": key },
      payload: { side, expectedVersion },
    });
  }

  it("records server chronology and excludes pending-confirmation time from the playing clock", async () => {
    const matchId = await launch();
    const initial = await detail(matchId);
    const initialBody = initial.json().match;
    const sideA = initialBody.participants.find((participant: { side: string }) => participant.side === "A");
    const sideB = initialBody.participants.find((participant: { side: string }) => participant.side === "B");
    expect(initialBody.matchFacts).toEqual({
      initialServer: { state: "known", participantId: sideB.id },
      playingClock: { state: "available", elapsedMs: 0, running: true, asOf: NOW.toISOString() },
      judgeHistory: {
        state: "complete",
        sessions: [{
          id: expect.any(String),
          userId: ACTOR,
          displayName: "Phone Shared",
          startedAt: NOW.toISOString(),
          endedAt: null,
        }],
      },
    });

    clock.advanceMs(1_000);
    expect((await point(matchId, "actor", "A", 0, "00000000-0000-4000-8000-000000032201")).statusCode).toBe(200);
    clock.advanceMs(3_000);
    const winning = await point(matchId, "actor", "A", 1, "00000000-0000-4000-8000-000000032202");
    expect(winning.statusCode).toBe(200);
    expect(winning.json().match.status).toBe("pending_confirmation");
    expect(winning.json().match).not.toHaveProperty("matchFacts");

    clock.advanceMs(5_000);
    const frozen = (await detail(matchId)).json().match;
    expect(frozen.matchFacts.playingClock).toEqual({
      state: "available",
      elapsedMs: 4_000,
      running: false,
      asOf: "2026-10-03T15:00:09.000Z",
    });
    expect(frozen.eventLog).toEqual([
      expect.objectContaining({
        type: "point_awarded",
        occurredAt: "2026-10-03T15:00:01.000Z",
        actorUserId: ACTOR,
        judgeSessionId: frozen.matchFacts.judgeHistory.sessions[0].id,
      }),
      expect.objectContaining({
        type: "point_awarded",
        occurredAt: "2026-10-03T15:00:04.000Z",
        actorUserId: ACTOR,
        judgeSessionId: frozen.matchFacts.judgeHistory.sessions[0].id,
      }),
    ]);

    const undo = await request("actor", {
      method: "POST",
      url: `/api/v1/matches/${matchId}/undo`,
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000032203" },
      payload: { expectedVersion: 2 },
    });
    expect(undo.statusCode).toBe(200);
    clock.advanceMs(2_000);
    const resumed = (await detail(matchId)).json().match;
    expect(resumed.matchFacts.playingClock).toEqual({
      state: "available",
      elapsedMs: 6_000,
      running: true,
      asOf: "2026-10-03T15:00:11.000Z",
    });
    expect(resumed.eventLog.at(-1)).toMatchObject({
      type: "point_undone",
      occurredAt: "2026-10-03T15:00:09.000Z",
      actorUserId: ACTOR,
      judgeSessionId: resumed.matchFacts.judgeHistory.sessions[0].id,
      undonePoint: {
        type: "point_awarded",
        occurredAt: "2026-10-03T15:00:04.000Z",
      },
    });

    const correction = await request("actor", {
      method: "POST",
      url: `/api/v1/matches/${matchId}/manual-correction`,
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000032204" },
      payload: {
        scoreA: 2,
        scoreB: 0,
        currentServerParticipantId: sideA.id,
        expectedVersion: 3,
      },
    });
    expect(correction.statusCode).toBe(200);
    const corrected = (await detail(matchId)).json().match;
    expect(corrected.matchFacts.playingClock).toMatchObject({
      state: "available",
      elapsedMs: 6_000,
      running: false,
    });
    expect(corrected.eventLog.at(-1)).toMatchObject({
      type: "manual_correction",
      occurredAt: "2026-10-03T15:00:11.000Z",
      actorUserId: ACTOR,
      judgeSessionId: corrected.matchFacts.judgeHistory.sessions[0].id,
    });

    clock.advanceMs(5_000);
    const reverted = await request("actor", {
      method: "POST",
      url: `/api/v1/matches/${matchId}/revert-finish`,
      payload: {},
    });
    expect(reverted.statusCode).toBe(200);
    clock.advanceMs(2_000);
    expect((await detail(matchId)).json().match.matchFacts.playingClock).toEqual({
      state: "available",
      elapsedMs: 8_000,
      running: true,
      asOf: "2026-10-03T15:00:18.000Z",
    });
  });

  it("freezes or preserves the clock for stop, no-show, cancel, confirm and void", async () => {
    const stopId = await launch("00000000-0000-4000-8000-000000032111");
    clock.advanceMs(1_000);
    expect((await request("actor", {
      method: "POST",
      url: `/api/v1/matches/${stopId}/stop`,
      payload: { winnerSide: "A", reasonCode: "time" },
    })).statusCode).toBe(200);
    expect((await detail(stopId)).json().match.matchFacts.playingClock).toMatchObject({
      elapsedMs: 1_000,
      running: false,
    });

    const noShowId = await launch("00000000-0000-4000-8000-000000032112");
    clock.advanceMs(2_000);
    expect((await request("actor", {
      method: "POST",
      url: `/api/v1/matches/${noShowId}/no-show`,
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000032211" },
      payload: { absentSide: "B", expectedVersion: 0 },
    })).statusCode).toBe(200);
    expect((await detail(noShowId)).json().match.matchFacts.playingClock).toMatchObject({
      elapsedMs: 2_000,
      running: false,
    });

    const cancelId = await launch("00000000-0000-4000-8000-000000032113");
    clock.advanceMs(3_000);
    expect((await request("actor", {
      method: "POST",
      url: `/api/v1/matches/${cancelId}/cancel`,
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000032212" },
      payload: { expectedVersion: 0 },
    })).statusCode).toBe(200);
    expect((await detail(cancelId)).json().match.matchFacts.playingClock).toMatchObject({
      elapsedMs: 3_000,
      running: false,
    });

    const finishId = await launch("00000000-0000-4000-8000-000000032114");
    const finishDetail = (await detail(finishId)).json().match;
    const finishServer = finishDetail.participants[0].id as string;
    clock.advanceMs(4_000);
    expect((await request("actor", {
      method: "POST",
      url: `/api/v1/matches/${finishId}/manual-correction`,
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000032213" },
      payload: {
        scoreA: 2,
        scoreB: 0,
        currentServerParticipantId: finishServer,
        expectedVersion: 0,
      },
    })).statusCode).toBe(200);
    clock.advanceMs(10_000);
    expect((await request("actor", {
      method: "POST",
      url: `/api/v1/matches/${finishId}/confirm-finish`,
      payload: {},
    })).statusCode).toBe(200);
    const finished = (await detail(finishId)).json().match;
    expect(finished.matchFacts.playingClock).toMatchObject({
      elapsedMs: 4_000,
      running: false,
    });
    clock.advanceMs(3_000);
    expect((await request("actor", {
      method: "POST",
      url: `/api/v1/matches/${finishId}/void`,
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000032214" },
      payload: { expectedVersion: finished.version },
    })).statusCode).toBe(200);
    expect((await detail(finishId)).json().match.matchFacts.playingClock).toMatchObject({
      elapsedMs: 4_000,
      running: false,
    });
  });

  it("allows first-server setup only before the first scoring audit event", async () => {
    const matchId = await launch();
    const before = (await detail(matchId)).json().match;
    const sideA = before.participants.find((participant: { side: string }) => participant.side === "A");
    const sideB = before.participants.find((participant: { side: string }) => participant.side === "B");

    const setup = await request("actor", {
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/setup`,
      payload: { firstServerParticipantId: sideA.id },
    });
    expect(setup.statusCode).toBe(200);
    expect((await detail(matchId)).json().match.matchFacts.initialServer).toEqual({
      state: "known",
      participantId: sideA.id,
    });

    expect((await point(matchId, "actor", "A", 0, "00000000-0000-4000-8000-000000032205")).statusCode).toBe(200);
    const undo = await request("actor", {
      method: "POST",
      url: `/api/v1/matches/${matchId}/undo`,
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000032206" },
      payload: { expectedVersion: 1 },
    });
    expect(undo.statusCode).toBe(200);
    expect(undo.json().match).toMatchObject({ scoreA: 0, scoreB: 0 });

    const forbidden = await request("actor", {
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/setup`,
      payload: { firstServerParticipantId: sideB.id },
    });
    expect(forbidden.statusCode).toBe(400);
    expect((await detail(matchId)).json().match.matchFacts.initialServer).toEqual({
      state: "known",
      participantId: sideA.id,
    });
  });

  it("attributes a shared phone to its logged account and records only activated handover sessions", async () => {
    const matchId = await launch();
    const otherDevice = await request("actor-other", {
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      payload: {},
    });
    expect(otherDevice.statusCode).toBe(409);
    expect(otherDevice.json()).toMatchObject({ code: "JUDGE_OTHER_DEVICE" });

    clock.advanceMs(1_000);
    const offered = await request("actor", {
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/handover`,
      payload: { toUserId: TARGET },
    });
    expect(offered.statusCode).toBe(200);
    clock.advanceMs(1_000);
    const acquired = await request("target", {
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      payload: {},
    });
    expect(acquired.statusCode).toBe(200);
    clock.advanceMs(1_000);
    expect((await point(matchId, "target", "A", 0, "00000000-0000-4000-8000-000000032207")).statusCode).toBe(200);

    const body = (await detail(matchId)).json().match;
    expect(body.matchFacts.judgeHistory).toEqual({
      state: "complete",
      sessions: [
        expect.objectContaining({
          userId: ACTOR,
          startedAt: NOW.toISOString(),
          endedAt: "2026-10-03T15:00:01.000Z",
        }),
        expect.objectContaining({
          userId: TARGET,
          startedAt: "2026-10-03T15:00:02.000Z",
          endedAt: null,
        }),
      ],
    });
    const targetSession = body.matchFacts.judgeHistory.sessions[1];
    expect(body.eventLog.at(-1)).toMatchObject({
      actorUserId: TARGET,
      judgeSessionId: targetSession.id,
      occurredAt: "2026-10-03T15:00:03.000Z",
    });
    expect(JSON.stringify(body.matchFacts)).not.toContain(TARGET_SESSION);
  });

  it("keeps legacy facts unavailable and applies visibility before returning facts", async () => {
    const matchId = await launch();
    await db.execute(sql`
      update matches
      set initial_server_participant_id = null,
          playing_elapsed_ms = null,
          playing_segment_started_at = null,
          judge_history_complete = false,
          event_log = '[{"type":"point_awarded","side":"A","idempotencyKey":"legacy"}]'::jsonb
      where id = ${matchId}
    `);
    await db.execute(sql`
      update judge_sessions set activated_at = null where match_id = ${matchId}
    `);

    const mutableDb = db as unknown as {
      select: (...args: unknown[]) => unknown;
    };
    const originalSelect = mutableDb.select.bind(db);
    let factSelects = 0;
    mutableDb.select = (...args: unknown[]) => {
      factSelects += 1;
      return originalSelect(...args);
    };

    const visible = (await detail(matchId)).json().match;
    expect(visible.matchFacts).toEqual({
      initialServer: { state: "unavailable" },
      playingClock: { state: "unavailable" },
      judgeHistory: { state: "unavailable", sessions: [] },
    });
    expect(visible.eventLog[0]).not.toHaveProperty("occurredAt");
    expect(factSelects).toBe(1);

    const denied = await detail(matchId, "outsider");
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).not.toHaveProperty("match");
    expect(factSelects).toBe(1);

    const list = await request("actor", { method: "GET", url: "/api/v1/matches" });
    expect(list.statusCode).toBe(200);
    expect(list.json().matches.every((match: object) => !("matchFacts" in match))).toBe(true);
    expect(factSelects).toBe(1);
  });
});
