import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";

const CREATOR_VOID_KEY = "00000000-0000-4000-8000-000000005001";
const ADMIN_VOID_KEY = "00000000-0000-4000-8000-000000005002";
const DENIED_VOID_KEY = "00000000-0000-4000-8000-000000005003";
const STALE_VOID_KEY = "00000000-0000-4000-8000-000000005004";
const TOURNAMENT_VOID_KEY = "00000000-0000-4000-8000-000000007001";

describe("DATA-005/007 result void", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let db: Db;
  let client: Awaited<ReturnType<typeof createMigratedPgliteDb>>["client"];
  let close: () => Promise<void>;
  let adminCookie: string;
  let creatorCookie: string;
  let participantCookie: string;
  let judgeCookie: string;
  let outsiderCookie: string;
  let creatorId: string;
  let participantId: string;

  beforeEach(async () => {
    const ctx = await createMigratedPgliteDb();
    db = ctx.db;
    client = ctx.client;
    close = ctx.close;
    const built = await buildApp({ db, clock: new FakeClock() });
    app = built.app;
    services = built.services;
    await services.auth.seedAdmin("admin@data005.local", "AdminPass1!");

    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@data005.local", password: "AdminPass1!" },
    });
    adminCookie = adminLogin.cookies.find(
      (cookie) => cookie.name === "tab10_session",
    )!.value;

    const creator = await createUser("creator@data005.local", "CreatorPass1!");
    const participant = await createUser(
      "participant@data005.local",
      "ParticipantPass1!",
    );
    const outsider = await createUser("outsider@data005.local", "OutsiderPass1!");
    const judge = await createUser("judge@data005.local", "JudgePass1!");
    creatorId = creator.id;
    creatorCookie = creator.cookie;
    participantId = participant.id;
    participantCookie = participant.cookie;
    outsiderCookie = outsider.cookie;
    judgeCookie = judge.cookie;
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
      payload: { email, firstName: "DATA", lastName: "005" },
    });
    const id = created.json().user.id as string;
    const initialLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: created.json().temporaryPassword as string },
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

  async function createStandalone() {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: creatorCookie },
      payload: {
        title: "DATA-005 result",
        format: "1v1",
        pointsToWin: 3,
        participants: [
          { side: "A", userId: creatorId },
          { side: "B", userId: participantId },
        ],
      },
    });
    expect(created.statusCode).toBe(200);
    const match = created.json().match as Record<string, unknown>;
    await acceptRequiredPlayerInvitations(String(match.id));
    return match;
  }

  async function acceptRequiredPlayerInvitations(matchId: string) {
    const match = await services.matches.getMatch(matchId);
    for (const invitation of match?.invitations ?? []) {
      if (invitation.kind === "player" && invitation.status === "pending") {
        await services.matches.respondInvitation(invitation.id, invitation.invitedUserId, true);
      }
    }
  }

  async function finishStandalone() {
    const created = await createStandalone();
    const matchId = String(created.id);
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: creatorCookie },
      payload: { firstServerParticipantId: (await services.matches.getMatch(matchId))!.participants[0]!.id },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: judgeCookie },
    });
    let version = Number(created.version);
    for (let point = 0; point < 3; point += 1) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/points`,
        cookies: { tab10_session: judgeCookie },
        headers: { "idempotency-key": `data-005-point-${point}` },
        payload: { side: "A", expectedVersion: version },
      });
      expect(response.statusCode).toBe(200);
      version = Number(response.json().match.version);
    }
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/confirm-finish`,
      cookies: { tab10_session: judgeCookie },
    });
    expect(confirmed.statusCode).toBe(200);
    return confirmed.json().match as Record<string, unknown>;
  }

  async function getMatch(matchId: string) {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/matches/${matchId}`,
      cookies: { tab10_session: creatorCookie },
    });
    expect(response.statusCode).toBe(200);
    return response.json().match as Record<string, unknown>;
  }

  async function voidRows(matchId: string) {
    return (
      await client.query<Record<string, unknown>>(
        "select * from match_void_audits where match_id = $1 order by created_at",
        [matchId],
      )
    ).rows;
  }

  it("AT-MATCH-VOID-001/002 and AT-ADM-MATCH-005: creator void preserves facts, compensates once, and rejects hard delete", async () => {
    const finished = await finishStandalone();
    const matchId = String(finished.id);
    for (const period of ["all_time", "week", "month"]) {
      const rankingBefore = await app.inject({
        method: "GET",
        url: `/api/v1/rankings?period=${period}`,
        cookies: { tab10_session: creatorCookie },
      });
      expect(
        rankingBefore
          .json()
          .rankings.find((entry: { userId: string }) => entry.userId === creatorId)
          .wins,
      ).toBe(1);
    }

    const hardDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/matches/${matchId}`,
      cookies: { tab10_session: adminCookie },
    });
    expect(hardDelete.statusCode).toBe(400);
    expect(hardDelete.json().code).toBe("MATCH_IMMUTABLE");

    const request = {
      method: "POST" as const,
      url: `/api/v1/matches/${matchId}/void`,
      cookies: { tab10_session: creatorCookie },
      headers: { "idempotency-key": CREATOR_VOID_KEY },
      payload: {
        expectedVersion: finished.version,
        reasonText: "Wrong winner confirmed",
      },
    };
    const voided = await app.inject(request);
    const replay = await app.inject(request);

    expect(voided.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().match).toEqual(voided.json().match);
    expect(voided.json().match).toMatchObject({
      status: "voided",
      version: Number(finished.version) + 1,
      scoreA: finished.scoreA,
      scoreB: finished.scoreB,
      winnerSide: finished.winnerSide,
      eventLog: finished.eventLog,
    });

    for (const period of ["all_time", "week", "month"]) {
      const rankingAfter = await app.inject({
        method: "GET",
        url: `/api/v1/rankings?period=${period}`,
        cookies: { tab10_session: creatorCookie },
      });
      const creatorStats = rankingAfter
        .json()
        .rankings.find((entry: { userId: string }) => entry.userId === creatorId);
      const participantStats = rankingAfter
        .json()
        .rankings.find((entry: { userId: string }) => entry.userId === participantId);
      expect(creatorStats?.wins ?? 0).toBe(0);
      expect(participantStats?.losses ?? 0).toBe(0);
    }

    const audit = await voidRows(matchId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_user_id: creatorId,
      prior_status: "finished",
      prior_version: finished.version,
      reason_text: "Wrong winner confirmed",
      idempotency_key: CREATOR_VOID_KEY,
    });
    expect(audit[0]?.prior_result).toMatchObject({
      scoreA: finished.scoreA,
      scoreB: finished.scoreB,
      winnerSide: finished.winnerSide,
    });
    expect(audit[0]?.prior_event_log).toEqual(finished.eventLog);
    expect(audit[0]?.compensation).toMatchObject({ applied: true });

    await expect(
      client.query("update match_void_audits set reason_text = 'tampered'"),
    ).rejects.toThrow();
    await expect(client.query("delete from match_void_audits")).rejects.toThrow();
    expect(await getMatch(matchId)).toMatchObject({ status: "voided" });
    const outsiderDetail = await app.inject({
      method: "GET",
      url: `/api/v1/matches/${matchId}`,
      cookies: { tab10_session: outsiderCookie },
    });
    expect(outsiderDetail.statusCode).toBe(200);
    expect(outsiderDetail.json().match.status).toBe("voided");

    const deleteVoided = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/matches/${matchId}`,
      cookies: { tab10_session: adminCookie },
    });
    expect(deleteVoided.statusCode).toBe(400);
    expect(deleteVoided.json().code).toBe("MATCH_IMMUTABLE");
  });

  it("AT-MATCH-VOID-002: an audit write failure rolls back status and stats compensation", async () => {
    const finished = await finishStandalone();
    const matchId = String(finished.id);
    await client.query(`
      create function reject_data_005_insert() returns trigger language plpgsql as $$
      begin
        raise exception 'injected DATA-005 audit failure';
      end;
      $$
    `);
    await client.query(`
      create trigger reject_data_005_insert
      before insert on match_void_audits
      for each row execute function reject_data_005_insert()
    `);

    const failed = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/void`,
      cookies: { tab10_session: creatorCookie },
      headers: { "idempotency-key": CREATOR_VOID_KEY },
      payload: { expectedVersion: finished.version },
    });

    expect(failed.statusCode).toBe(500);
    expect(await getMatch(matchId)).toEqual(finished);
    const ranking = await app.inject({
      method: "GET",
      url: "/api/v1/rankings",
      cookies: { tab10_session: creatorCookie },
    });
    expect(
      ranking
        .json()
        .rankings.find((entry: { userId: string }) => entry.userId === creatorId)
        .wins,
    ).toBe(1);
    expect(await voidRows(matchId)).toHaveLength(0);
  });

  it("AT-MATCH-VOID-001/002: concurrent replay of one key compensates and audits once", async () => {
    const finished = await finishStandalone();
    const matchId = String(finished.id);
    const request = () =>
      app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/void`,
        cookies: { tab10_session: creatorCookie },
        headers: { "idempotency-key": CREATOR_VOID_KEY },
        payload: { expectedVersion: finished.version },
      });

    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(responses[0]!.json().match).toEqual(responses[1]!.json().match);
    expect(await voidRows(matchId)).toHaveLength(1);
    const ranking = await app.inject({
      method: "GET",
      url: "/api/v1/rankings",
      cookies: { tab10_session: creatorCookie },
    });
    expect(
      ranking
        .json()
        .rankings.find((entry: { userId: string }) => entry.userId === creatorId)
        .wins,
    ).toBe(0);
  });

  it("AT-MATCH-VOID-003: participant, former judge, outsider, and stale creator leave match, stats, and audit unchanged", async () => {
    const finished = await finishStandalone();
    const matchId = String(finished.id);
    const before = await getMatch(matchId);

    for (const cookie of [participantCookie, judgeCookie, outsiderCookie]) {
      const denied = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/void`,
        cookies: { tab10_session: cookie },
        headers: { "idempotency-key": DENIED_VOID_KEY },
        payload: { expectedVersion: finished.version },
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().code).toBe("FORBIDDEN");
      expect(await getMatch(matchId)).toEqual(before);
      expect(await voidRows(matchId)).toHaveLength(0);
    }

    const stale = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/void`,
      cookies: { tab10_session: creatorCookie },
      headers: { "idempotency-key": STALE_VOID_KEY },
      payload: { expectedVersion: Number(finished.version) + 1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("VERSION_CONFLICT");
    expect(await getMatch(matchId)).toEqual(before);
    expect(await voidRows(matchId)).toHaveLength(0);
  });

  it("AT-MATCH-VOID-003: active admin may void a stopped standalone result without a reason", async () => {
    const created = await createStandalone();
    const matchId = String(created.id);
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: creatorCookie },
      payload: { firstServerParticipantId: (await services.matches.getMatch(matchId))!.participants[0]!.id },
    });
    const stopped = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/stop`,
      cookies: { tab10_session: creatorCookie },
      payload: { winnerSide: "B", reasonCode: "time" },
    });
    expect(stopped.statusCode).toBe(200);

    const hardDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/matches/${matchId}`,
      cookies: { tab10_session: adminCookie },
    });
    expect(hardDelete.statusCode).toBe(400);
    expect(hardDelete.json().code).toBe("MATCH_IMMUTABLE");

    const voided = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/void`,
      cookies: { tab10_session: adminCookie },
      headers: { "idempotency-key": ADMIN_VOID_KEY },
      payload: { expectedVersion: stopped.json().match.version },
    });

    expect(voided.statusCode).toBe(200);
    expect(voided.json().match.status).toBe("voided");
    expect(await voidRows(matchId)).toEqual([
      expect.objectContaining({
        prior_status: "stopped",
        reason_text: null,
        idempotency_key: ADMIN_VOID_KEY,
      }),
    ]);
  });

  it("DATA-007: tournament void compensates only the target result and preserves downstream history", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tournaments",
      cookies: { tab10_session: creatorCookie },
      payload: {
        title: "DATA-007 preserved bracket",
        format: "single_elimination",
        organizerParticipates: false,
        pointsToWin: 3,
        mercyEnabled: false,
      },
    });
    expect(created.statusCode).toBe(200);
    const tournamentId = created.json().tournament.id as string;
    for (const userId of [creatorId, participantId]) {
      const added = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tournamentId}/participants`,
        cookies: { tab10_session: creatorCookie },
        payload: { userId },
      });
      expect(added.statusCode).toBe(200);
    }
    for (const cookie of [outsiderCookie, judgeCookie]) {
      const me = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        cookies: { tab10_session: cookie },
      });
      const added = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tournamentId}/participants`,
        cookies: { tab10_session: creatorCookie },
        payload: { userId: me.json().user.id },
      });
      expect(added.statusCode).toBe(200);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/tournaments/${tournamentId}/bracket`,
          cookies: { tab10_session: creatorCookie },
        })
      ).statusCode,
    ).toBe(200);
    const started = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${tournamentId}/start`,
      cookies: { tab10_session: creatorCookie },
    });
    expect(started.statusCode).toBe(200);
    const targetId = started.json().tournament.matches[0].id as string;
    const startMatch = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${targetId}/start`,
      cookies: { tab10_session: creatorCookie },
      payload: { firstServerParticipantId: (await services.matches.getMatch(targetId))!.participants[0]!.id },
    });
    expect(startMatch.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/matches/${targetId}/judge/acquire`,
          cookies: { tab10_session: creatorCookie },
        })
      ).statusCode,
    ).toBe(200);
    let version = Number(startMatch.json().match.version);
    for (let point = 0; point < 3; point += 1) {
      const scored = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${targetId}/points`,
        cookies: { tab10_session: creatorCookie },
        headers: { "idempotency-key": `data-007-point-${point}` },
        payload: { side: "A", expectedVersion: version },
      });
      expect(scored.statusCode).toBe(200);
      version = Number(scored.json().match.version);
    }
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${targetId}/confirm-finish`,
      cookies: { tab10_session: creatorCookie },
    });
    expect(confirmed.statusCode).toBe(200);
    const finished = confirmed.json().match as {
      version: number;
      participants: Array<{ userId?: string; side: "A" | "B" }>;
      winnerSide: "A" | "B";
    };

    const snapshot = async () => ({
      tournament: (
        await client.query(
          "select bracket_json, bracket_state_version from tournaments where id = $1",
          [tournamentId],
        )
      ).rows,
      downstream: (
        await client.query(
          "select id, status, version, score_a, score_b, winner_side, tournament_bracket_match_id from matches where tournament_id = $1 and id <> $2 order by id",
          [tournamentId, targetId],
        )
      ).rows,
      notifications: (
        await client.query(
          "select id, user_id, type, title, body, payload, read_at, created_at from notifications order by id",
        )
      ).rows,
      stats: (
        await client.query(
          "select user_id, wins_all_time, losses_all_time from user_stats order by user_id",
        )
      ).rows,
    });
    const before = await snapshot();

    const voidRequest = {
      method: "POST",
      url: `/api/v1/matches/${targetId}/void`,
      cookies: { tab10_session: creatorCookie },
      headers: { "idempotency-key": TOURNAMENT_VOID_KEY },
      payload: {
        expectedVersion: finished.version,
        reasonText: "Tournament result corrected without bracket rewrite",
      },
    } as const;
    const voided = await app.inject(voidRequest);
    const replay = await app.inject(voidRequest);
    expect(voided.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().match).toEqual(voided.json().match);
    expect(voided.json().match.status).toBe("voided");
    const after = await snapshot();
    expect(after.tournament).toEqual(before.tournament);
    expect(after.downstream).toEqual(before.downstream);
    expect(after.notifications).toEqual(before.notifications);

    const affectedUsers = new Set(
      finished.participants
        .map((participant) => participant.userId)
        .filter((userId): userId is string => Boolean(userId)),
    );
    const beforeStats = new Map(
      before.stats.map((row) => [String(row.user_id), row]),
    );
    for (const row of after.stats) {
      const previous = beforeStats.get(String(row.user_id));
      expect(previous).toBeDefined();
      if (!affectedUsers.has(String(row.user_id))) {
        expect(row).toEqual(previous);
      }
    }
    expect(await voidRows(targetId)).toEqual([
      expect.objectContaining({
        prior_status: "finished",
        idempotency_key: TOURNAMENT_VOID_KEY,
      }),
    ]);
  });
});
