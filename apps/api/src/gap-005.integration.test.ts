import { FakeClock } from "@tab10/test-utils";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";

describe("GAP-005 match and judge completion slice", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let db: Db;
  let close: () => Promise<void>;
  let adminCookie: string;
  let userA: { id: string; cookie: string };
  let userB: { id: string; cookie: string };
  let userC: { id: string; cookie: string };
  let userD: { id: string; cookie: string };

  beforeEach(async () => {
    const context = await createMigratedPgliteDb();
    db = context.db;
    close = context.close;
    const built = await buildApp({
      db,
      clock: new FakeClock(new Date("2026-09-07T12:00:00.000Z")),
      randomIndex: () => 2,
    });
    app = built.app;
    services = built.services;
    await services.auth.seedAdmin("admin@tab10.local", "AdminPass1!");
    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@tab10.local", password: "AdminPass1!" },
    });
    adminCookie = adminLogin.cookies.find((cookie) => cookie.name === "tab10_session")!.value;

    async function createUser(index: number) {
      const email = `gap005-${index}@tab10.local`;
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        cookies: { tab10_session: adminCookie },
        payload: { email, firstName: `Player${index}`, lastName: "GAP005" },
      });
      const id = created.json().user.id as string;
      const temporaryPassword = created.json().temporaryPassword as string;
      const firstLogin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: temporaryPassword },
      });
      const firstCookie = firstLogin.cookies.find((cookie) => cookie.name === "tab10_session")!.value;
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
        cookie: login.cookies.find((cookie) => cookie.name === "tab10_session")!.value,
      };
    }

    [userA, userB, userC, userD] = await Promise.all([
      createUser(1),
      createUser(2),
      createUser(3),
      createUser(4),
    ]);
  });

  afterEach(async () => {
    if (app) await app.close();
    if (close) await close();
  });

  async function createMatch(payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userA.cookie },
      payload,
    });
  }

  it("AT-MATCH-013: persists complete 2v2 custom rules and random first-server mode", async () => {
    const created = await createMatch({
      title: "Полный парный матч",
      format: "2v2",
      pointsToWin: 15,
      mercyEnabled: true,
      mercyPoints: 7,
      firstServerMethod: "random",
      source: "revenge",
      participants: [
        { side: "A", userId: userA.id },
        { side: "A", userId: userB.id },
        { side: "B", userId: userC.id },
        { side: "B", userId: userD.id },
      ],
    });

    expect(created.statusCode).toBe(200);
    expect(created.json().match).toMatchObject({
      format: "2v2",
      pointsToWin: 15,
      mercyEnabled: true,
      mercyPoints: 7,
      firstServerMethod: "random",
      source: "revenge",
    });

    const started = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${created.json().match.id}/start`,
      cookies: { tab10_session: userA.cookie },
      payload: {},
    });
    const participants = started.json().match.participants as Array<{ id: string }>;
    expect(started.statusCode).toBe(200);
    expect(started.json().match.currentServerParticipantId).toBe(participants[2]!.id);
    expect(started.json().match.startedAt).toBeTruthy();
  });

  it("JUDGE-001: nonparticipant setup does not start the timer before creator start", async () => {
    const created = await createMatch({ title: "Подготовка", format: "1v1", participants: [{ side: "A", userId: userA.id }, { side: "B", userId: userB.id }] });
    const match = created.json().match;
    expect((await app.inject({ method: "POST", url: `/api/v1/matches/${match.id}/judge/acquire`, cookies: { tab10_session: userC.cookie } })).statusCode).toBe(200);
    const setup = await app.inject({ method: "POST", url: `/api/v1/matches/${match.id}/judge/setup`, cookies: { tab10_session: userC.cookie }, payload: { firstServerParticipantId: match.participants[0].id } });
    expect(setup.statusCode).toBe(200);
    expect(setup.json().match).toMatchObject({ status: "waiting", startedAt: null, activeJudge: { userId: userC.id } });
    const started = await app.inject({ method: "POST", url: `/api/v1/matches/${match.id}/start`, cookies: { tab10_session: userA.cookie }, payload: { firstServerParticipantId: match.participants[0].id } });
    expect(started.statusCode).toBe(200);
    expect(started.json().match.startedAt).toBeTruthy();
    expect(started.json().match.activeJudge.userId).toBe(userC.id);
  });

  it("MATCH-005: manual first-server mode cannot start without a roster participant", async () => {
    const created = await createMatch({
      title: "Ручная подача",
      format: "1v1",
      firstServerMethod: "manual",
      participants: [
        { side: "A", userId: userA.id },
        { side: "B", userId: userB.id },
      ],
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${created.json().match.id}/start`,
      cookies: { tab10_session: userA.cookie },
      payload: {},
    });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().code).toBe("VALIDATION");
    expect(await services.matches.getMatch(created.json().match.id)).toMatchObject({
      status: "waiting",
      currentServerParticipantId: null,
    });
  });

  it("AT-MATCH-003/005: keeps the original serve anchor through points, correction and undo", async () => {
    const created = await createMatch({
      title: "Ротация подачи",
      format: "1v1",
      firstServerMethod: "manual",
      participants: [
        { side: "A", userId: userA.id },
        { side: "B", userId: userB.id },
      ],
    });
    const match = created.json().match;
    const [sideA, sideB] = match.participants as Array<{ id: string; side: "A" | "B" }>;
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/start`,
      cookies: { tab10_session: userA.cookie },
      payload: { firstServerParticipantId: sideA!.id },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/judge/acquire`,
      cookies: { tab10_session: userA.cookie },
    });

    let version = 0;
    for (const key of ["601", "602", "603"]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${match.id}/points`,
        cookies: { tab10_session: userA.cookie },
        headers: { "idempotency-key": `00000000-0000-4000-8000-000000000${key}` },
        payload: { side: "A", expectedVersion: version },
      });
      expect(response.statusCode, response.body).toBe(200);
      version = response.json().match.version;
    }
    expect((await services.matches.getMatch(match.id))?.currentServerParticipantId).toBe(sideB!.id);

    const corrected = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/manual-correction`,
      cookies: { tab10_session: userA.cookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000604" },
      payload: {
        scoreA: 2,
        scoreB: 1,
        currentServerParticipantId: sideA!.id,
        expectedVersion: version,
      },
    });
    expect(corrected.statusCode, corrected.body).toBe(200);
    const afterCorrection = corrected.json().match;
    const pointAfterCorrection = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/points`,
      cookies: { tab10_session: userA.cookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000605" },
      payload: { side: "A", expectedVersion: afterCorrection.version },
    });
    expect(pointAfterCorrection.statusCode, pointAfterCorrection.body).toBe(200);
    expect(pointAfterCorrection.json().match.currentServerParticipantId).toBe(sideB!.id);

    const undone = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/undo`,
      cookies: { tab10_session: userA.cookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000606" },
      payload: { expectedVersion: pointAfterCorrection.json().match.version },
    });
    expect(undone.statusCode, undone.body).toBe(200);
    expect(undone.json().match).toMatchObject({
      scoreA: 2,
      scoreB: 1,
      currentServerParticipantId: sideA!.id,
    });
  });

  it("JUDGE-011: judge setup cannot bypass audited server correction after a point", async () => {
    const created = await createMatch({
      title: "Защита коррекции подачи",
      format: "1v1",
      participants: [
        { side: "A", userId: userA.id },
        { side: "B", userId: userB.id },
      ],
    });
    const match = created.json().match;
    const participants = match.participants as Array<{ id: string }>;
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/start`,
      cookies: { tab10_session: userA.cookie },
      payload: { firstServerParticipantId: participants[0]!.id },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/judge/acquire`,
      cookies: { tab10_session: userA.cookie },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/points`,
      cookies: { tab10_session: userA.cookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000607" },
      payload: { side: "A", expectedVersion: 0 },
    });
    const before = await services.matches.getMatch(match.id);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/judge/setup`,
      cookies: { tab10_session: userA.cookie },
      payload: { firstServerParticipantId: participants[1]!.id },
    });

    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().code).toBe("INVALID_STATUS");
    expect(await services.matches.getMatch(match.id)).toMatchObject({
      version: before!.version,
      currentServerParticipantId: before!.currentServerParticipantId,
      eventLog: before!.eventLog,
    });
  });

  it("AT-MATCH-010: no-show records a winner and reason without inventing score", async () => {
    const created = await createMatch({
      title: "Неявка",
      format: "1v1",
      participants: [
        { side: "A", userId: userA.id },
        { side: "B", userId: userB.id },
      ],
    });
    const match = created.json().match;
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/no-show`,
      cookies: { tab10_session: userA.cookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000501" },
      payload: { absentSide: "A", expectedVersion: match.version, reasonText: "Не вышли к столу" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().match).toMatchObject({
      status: "stopped",
      winnerSide: "B",
      finishReason: "no_show",
      stopReasonText: "Не вышли к столу",
      scoreA: 0,
      scoreB: 0,
    });
    expect((await db.query.userStats.findFirst({ where: (row, { eq }) => eq(row.userId, userB.id) }))?.winsAllTime).toBe(1);

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/no-show`,
      cookies: { tab10_session: userA.cookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000501" },
      payload: { absentSide: "A", expectedVersion: match.version, reasonText: "Не вышли к столу" },
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().match.version).toBe(response.json().match.version);
    expect((await db.query.userStats.findFirst({ where: (row, { eq }) => eq(row.userId, userB.id) }))?.winsAllTime).toBe(1);

    const differentKey = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/no-show`,
      cookies: { tab10_session: userA.cookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000502" },
      payload: { absentSide: "A", expectedVersion: match.version },
    });
    expect(differentKey.statusCode, differentKey.body).toBe(400);
    expect(differentKey.json().code).toBe("MATCH_NOT_ACTIVE");
  });

  it("AT-MATCH-010: rolls back no-show state and side effects when progression fails", async () => {
    const tournament = await services.tournaments.create({
      createdByUserId: userA.id,
      title: "Кубок отката",
      format: "single_elimination",
    });
    const match = await services.matches.createMatch({
      createdByUserId: userA.id,
      title: "Откат неявки",
      format: "1v1",
      kind: "tournament",
      tournamentId: tournament!.id,
      tournamentSlotId: crypto.randomUUID(),
      tournamentBracketMatchId: "r1-m1",
      participants: [
        { side: "A", userId: userA.id },
        { side: "B", userId: userB.id },
      ],
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match!.id}/start`,
      cookies: { tab10_session: userA.cookie },
      payload: { firstServerParticipantId: match!.participants[0]!.id },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match!.id}/judge/acquire`,
      cookies: { tab10_session: userA.cookie },
    });
    const before = await services.matches.getMatch(match!.id);
    services.matches.setTournamentMatchFinishedHook(async () => {
      throw new Error("injected progression failure");
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match!.id}/no-show`,
      cookies: { tab10_session: userA.cookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000511" },
      payload: { absentSide: "A", expectedVersion: before!.version },
    });
    expect(response.statusCode).toBe(500);
    expect(await services.matches.getMatch(match!.id)).toMatchObject({
      status: "in_progress",
      winnerSide: null,
      version: before!.version,
      activeJudge: { userId: userA.id },
    });
    expect(await db.query.userStats.findFirst({ where: (row, { eq }) => eq(row.userId, userB.id) })).toBeUndefined();
  });

  it("AT-JUDGE-004: handover reserves for target and target atomically acquires", async () => {
    const created = await createMatch({
      title: "Передача судьи",
      format: "1v1",
      participants: [
        { side: "A", userId: userA.id },
        { side: "B", userId: userB.id },
      ],
    });
    const matchId = created.json().match.id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: userA.cookie },
      payload: {
        firstServerParticipantId: created.json().match.participants[0].id,
      },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: userA.cookie },
    });
    const originalSession = await db.query.judgeSessions.findFirst({
      where: (row, { and, eq, isNull }) => and(
        eq(row.matchId, matchId),
        eq(row.userId, userA.id),
        isNull(row.releasedAt),
      ),
    });

    const handover = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/handover`,
      cookies: { tab10_session: userA.cookie },
      payload: { toUserId: userC.id },
    });
    expect(handover.statusCode).toBe(200);
    expect(handover.json().reservation).toMatchObject({ userId: userC.id });

    const reservedTargetDetail = await app.inject({
      method: "GET",
      url: `/api/v1/matches/${matchId}`,
      cookies: { tab10_session: userC.cookie },
    });
    expect(reservedTargetDetail.statusCode).toBe(200);
    expect(reservedTargetDetail.json().match.judgeReservation).toMatchObject({ userId: userC.id });
    const reservedTargetList = await app.inject({
      method: "GET",
      url: "/api/v1/matches",
      cookies: { tab10_session: userC.cookie },
    });
    expect(reservedTargetList.json().matches).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: matchId })]),
    );

    const oldJudgePoint = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/points`,
      cookies: { tab10_session: userA.cookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000503" },
      payload: { side: "A", expectedVersion: 0 },
    });
    expect(oldJudgePoint.statusCode, oldJudgePoint.body).toBe(400);

    const outsiderAcquire = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: userD.cookie },
    });
    expect(outsiderAcquire.statusCode).toBe(409);
    expect(outsiderAcquire.json().code).toBe("JUDGE_RESERVED");

    const targetAcquire = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: userC.cookie },
    });
    expect(targetAcquire.statusCode).toBe(200);
    expect((await services.matches.getMatch(matchId))?.activeJudge?.userId).toBe(userC.id);
    const sessionRows = await db.query.judgeSessions.findMany({
      where: (row, { eq }) => eq(row.matchId, matchId),
    });
    expect(sessionRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: originalSession!.id, userId: userA.id, releasedAt: expect.any(Date) }),
      expect.objectContaining({ userId: userC.id, releasedAt: null, reservedForUserId: null }),
    ]));
  });

  it("AT-JUDGE-004: a former judge loses active-match visibility and stop authority after handover", async () => {
    const created = await createMatch({
      title: "Передача полномочий",
      format: "1v1",
      participants: [
        { side: "A", userId: userA.id },
        { side: "B", userId: userB.id },
      ],
    });
    const matchId = created.json().match.id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: userA.cookie },
      payload: { firstServerParticipantId: created.json().match.participants[0].id },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: userD.cookie },
    });
    const handover = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/handover`,
      cookies: { tab10_session: userD.cookie },
      payload: { toUserId: userC.id },
    });
    expect(handover.statusCode, handover.body).toBe(200);

    const formerJudgeList = await app.inject({
      method: "GET",
      url: "/api/v1/matches",
      cookies: { tab10_session: userD.cookie },
    });
    expect(formerJudgeList.json().matches).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: matchId })]),
    );
    const stop = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/stop`,
      cookies: { tab10_session: userD.cookie },
      payload: { winnerSide: "A", reasonCode: "time" },
    });
    expect(stop.statusCode, stop.body).toBe(403);
    expect(await services.matches.getMatch(matchId)).toMatchObject({
      status: "in_progress",
      judgeReservation: { userId: userC.id },
    });
  });

  it("MATCH-010: only the judge session that confirmed may replay confirmation after handover", async () => {
    const created = await createMatch({
      title: "Подтверждение после передачи",
      format: "1v1",
      participants: [
        { side: "A", userId: userA.id },
        { side: "B", userId: userB.id },
      ],
    });
    const match = created.json().match;
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/start`,
      cookies: { tab10_session: userA.cookie },
      payload: { firstServerParticipantId: match.participants[0].id },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/judge/acquire`,
      cookies: { tab10_session: userD.cookie },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/judge/handover`,
      cookies: { tab10_session: userD.cookie },
      payload: { toUserId: userC.id },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/judge/acquire`,
      cookies: { tab10_session: userC.cookie },
    });
    const released = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/judge/release`,
      cookies: { tab10_session: userC.cookie },
    });
    expect(released.statusCode, released.body).toBe(200);
    const reacquired = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/judge/acquire`,
      cookies: { tab10_session: userC.cookie },
    });
    expect(reacquired.statusCode, reacquired.body).toBe(200);
    const corrected = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/manual-correction`,
      cookies: { tab10_session: userC.cookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000621" },
      payload: {
        scoreA: 11,
        scoreB: 9,
        currentServerParticipantId: match.participants[0].id,
        expectedVersion: 0,
      },
    });
    expect(corrected.statusCode, corrected.body).toBe(200);
    expect(corrected.json().match.status).toBe("pending_confirmation");

    const confirmed = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/confirm-finish`,
      cookies: { tab10_session: userC.cookie },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);

    const sameSessionReplay = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/confirm-finish`,
      cookies: { tab10_session: userC.cookie },
    });
    expect(sameSessionReplay.statusCode, sameSessionReplay.body).toBe(200);

    const formerJudgeReplay = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${match.id}/confirm-finish`,
      cookies: { tab10_session: userD.cookie },
    });
    expect(formerJudgeReplay.statusCode, formerJudgeReplay.body).toBe(400);
    expect(formerJudgeReplay.json().code).toBe("JUDGE_REQUIRED");
  });

  it("JUDGE-004/007: one target cannot hold reservations for two matches", async () => {
    const first = await createMatch({
      title: "Передача один",
      format: "1v1",
      participants: [
        { side: "A", userId: userA.id },
        { side: "B", userId: userD.id },
      ],
    });
    const second = await createMatch({
      title: "Передача два",
      format: "1v1",
      participants: [
        { side: "A", userId: userA.id },
        { side: "B", userId: userD.id },
      ],
    });
    const firstId = first.json().match.id as string;
    const secondId = second.json().match.id as string;
    await app.inject({ method: "POST", url: `/api/v1/matches/${firstId}/judge/acquire`, cookies: { tab10_session: userA.cookie } });
    await app.inject({ method: "POST", url: `/api/v1/matches/${secondId}/judge/acquire`, cookies: { tab10_session: userB.cookie } });

    const reserved = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${firstId}/judge/handover`,
      cookies: { tab10_session: userA.cookie },
      payload: { toUserId: userC.id },
    });
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${secondId}/judge/handover`,
      cookies: { tab10_session: userB.cookie },
      payload: { toUserId: userC.id },
    });

    expect(reserved.statusCode).toBe(200);
    expect(rejected.statusCode, rejected.body).toBe(400);
    expect(rejected.json().code).toBe("JUDGE_BUSY");
    expect((await services.matches.getMatch(firstId))?.judgeReservation?.userId).toBe(userC.id);
    expect((await services.matches.getMatch(secondId))?.activeJudge?.userId).toBe(userB.id);
  });

  it("JUDGE-011/012: manual correction is judge-only, versioned and audit-only in clean point history", async () => {
    const created = await createMatch({
      title: "Коррекция",
      format: "1v1",
      pointsToWin: 11,
      participants: [
        { side: "A", userId: userA.id },
        { side: "B", userId: userB.id },
      ],
    });
    const matchId = created.json().match.id as string;
    const participants = created.json().match.participants as Array<{ id: string; side: string }>;
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: userA.cookie },
      payload: { firstServerParticipantId: participants[0]!.id },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: userA.cookie },
    });

    const forbidden = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/manual-correction`,
      cookies: { tab10_session: userB.cookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000601" },
      payload: { scoreA: 4, scoreB: 2, currentServerParticipantId: participants[1]!.id, expectedVersion: 0 },
    });
    expect(forbidden.statusCode, forbidden.body).toBe(400);

    const corrected = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/manual-correction`,
      cookies: { tab10_session: userA.cookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000602" },
      payload: { scoreA: 4, scoreB: 2, currentServerParticipantId: participants[1]!.id, expectedVersion: 0 },
    });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.json().match).toMatchObject({
      scoreA: 4,
      scoreB: 2,
      currentServerParticipantId: participants[1]!.id,
      version: 1,
    });
    expect(corrected.json().match.eventLog).toContainEqual(expect.objectContaining({
      type: "manual_correction",
      from: expect.objectContaining({ scoreA: 0, scoreB: 0 }),
      to: expect.objectContaining({ scoreA: 4, scoreB: 2 }),
    }));

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/manual-correction`,
      cookies: { tab10_session: userA.cookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000602" },
      payload: { scoreA: 4, scoreB: 2, currentServerParticipantId: participants[1]!.id, expectedVersion: 0 },
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().match.version).toBe(1);
    expect(replay.json().match.eventLog.filter((event: { type: string }) => event.type === "manual_correction")).toHaveLength(1);

    const competing = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/manual-correction`,
      cookies: { tab10_session: userA.cookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000603" },
      payload: { scoreA: 6, scoreB: 3, currentServerParticipantId: participants[0]!.id, expectedVersion: 0 },
    });
    expect(competing.statusCode).toBe(409);
    expect(competing.json().code).toBe("VERSION_CONFLICT");

    const award = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/points`,
      cookies: { tab10_session: userA.cookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000604" },
      payload: { side: "B", expectedVersion: 1 },
    });
    expect(award.statusCode, award.body).toBe(200);
    expect(award.json().match).toMatchObject({ scoreA: 4, scoreB: 3, version: 2 });

    const undo = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/undo`,
      cookies: { tab10_session: userA.cookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000605" },
      payload: { expectedVersion: 2 },
    });
    expect(undo.statusCode, undo.body).toBe(200);
    expect(undo.json().match).toMatchObject({ scoreA: 4, scoreB: 2, version: 3 });
    expect(undo.json().match.eventLog).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "manual_correction" }),
      expect.objectContaining({
        type: "point_undone",
        undonePoint: expect.objectContaining({
          type: "point_awarded",
          idempotencyKey: "00000000-0000-4000-8000-000000000604",
        }),
      }),
    ]));
    expect(undo.json().match.eventLog).not.toContainEqual(
      expect.objectContaining({ type: "point_awarded" }),
    );

    const secondAward = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/points`,
      cookies: { tab10_session: userA.cookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000606" },
      payload: { side: "A", expectedVersion: 3 },
    });
    expect(secondAward.statusCode, secondAward.body).toBe(200);
    const secondUndo = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/undo`,
      cookies: { tab10_session: userA.cookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000607" },
      payload: { expectedVersion: 4 },
    });
    expect(secondUndo.statusCode, secondUndo.body).toBe(200);
    expect(secondUndo.json().match).toMatchObject({ scoreA: 4, scoreB: 2, version: 5 });
    expect(secondUndo.json().match.eventLog.filter(
      (event: { type: string }) => event.type === "point_undone",
    )).toHaveLength(2);
  });
});
