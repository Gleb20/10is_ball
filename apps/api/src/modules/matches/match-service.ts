import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  createInitialScoreState,
  reduceMatchEvent,
  type MatchEvent,
  type MatchRules,
  type ServeRotationConfig,
  type Side,
} from "@tab10/shared";
import type { Clock } from "@tab10/test-utils";
import type { Db } from "../../db/client.js";
import {
  judgeSessions,
  matchParticipants,
  matches,
  userStats,
  } from "../../db/schema.js";

const JUDGE_TTL_MS = 120_000;

export class MatchService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async createMatch(input: {
    createdByUserId: string;
    title: string;
    format: "1v1" | "2v2";
    pointsToWin?: number;
    mercyEnabled?: boolean;
    mercyPoints?: number | null;
    kind?: "standalone" | "tournament" | "tutorial";
    participants: Array<{
      side: Side;
      userId?: string;
      guestFirstName?: string;
      guestLastName?: string;
      isTutorialActor?: boolean;
    }>;
  }) {
    const [match] = await this.db
      .insert(matches)
      .values({
        title: input.title,
        format: input.format,
        pointsToWin: input.pointsToWin ?? 11,
        mercyEnabled: input.mercyEnabled ?? false,
        mercyPoints: input.mercyPoints ?? null,
        kind: input.kind ?? "standalone",
        createdByUserId: input.createdByUserId,
        status: "waiting",
      })
      .returning();

    for (const p of input.participants) {
      await this.db.insert(matchParticipants).values({
        matchId: match!.id,
        side: p.side,
        userId: p.userId,
        guestFirstName: p.guestFirstName,
        guestLastName: p.guestLastName,
        isTutorialActor: p.isTutorialActor ?? false,
      });
    }
    return this.getMatch(match!.id);
  }

  async getMatch(matchId: string) {
    const match = await this.db.query.matches.findFirst({
      where: eq(matches.id, matchId),
    });
    if (!match) return null;
    const participants = await this.db.query.matchParticipants.findMany({
      where: eq(matchParticipants.matchId, matchId),
    });
    return { ...match, participants };
  }

  async listMatches(limit = 50) {
    return this.db.query.matches.findMany({
      orderBy: [desc(matches.createdAt)],
      limit,
    });
  }

  async startMatch(matchId: string, firstServerParticipantId?: string) {
    const detail = await this.getMatch(matchId);
    if (!detail) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (detail.status !== "waiting") {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "INVALID_STATUS" });
    }

    // AT-MATCH-011: player cannot start second active match
    for (const p of detail.participants) {
      if (!p.userId) continue;
      const active = await this.db
        .select({ id: matches.id })
        .from(matches)
        .innerJoin(
          matchParticipants,
          eq(matchParticipants.matchId, matches.id),
        )
        .where(
          and(
            eq(matchParticipants.userId, p.userId),
            inArray(matches.status, [
              "in_progress",
              "pending_confirmation",
            ]),
            ne(matches.id, matchId),
          ),
        )
        .limit(1);
      if (active.length > 0) {
        throw Object.assign(new Error("PLAYER_BUSY"), { code: "PLAYER_BUSY" });
      }
    }

    const serverId =
      firstServerParticipantId ?? detail.participants[0]?.id ?? null;
    const now = this.clock.now();
    await this.db
      .update(matches)
      .set({
        status: "in_progress",
        startedAt: now,
        currentServerParticipantId: serverId,
        updatedAt: now,
      })
      .where(eq(matches.id, matchId));
    return this.getMatch(matchId);
  }

  private rulesFrom(match: typeof matches.$inferSelect): MatchRules {
    return {
      pointsToWin: match.pointsToWin,
      mercyEnabled: match.mercyEnabled,
      mercyPoints: match.mercyPoints,
      format: match.format,
    };
  }

  private serveConfig(
    match: typeof matches.$inferSelect,
    participants: (typeof matchParticipants.$inferSelect)[],
  ): ServeRotationConfig {
    const order = participants
      .slice()
      .sort((a, b) => a.side.localeCompare(b.side) || a.id.localeCompare(b.id))
      .map((p) => p.id);
    return {
      format: match.format,
      participantOrder: order,
      firstServerId: match.currentServerParticipantId ?? order[0]!,
    };
  }

  async awardPoint(input: {
    matchId: string;
    side: Side;
    idempotencyKey: string;
    expectedVersion: number;
    judgeUserId: string;
    authSessionId: string;
  }) {
    await this.assertActiveJudge(
      input.matchId,
      input.judgeUserId,
      input.authSessionId,
    );
    const detail = await this.getMatch(input.matchId);
    if (!detail) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (detail.version !== input.expectedVersion) {
      throw Object.assign(new Error("VERSION_CONFLICT"), {
        code: "VERSION_CONFLICT",
        state: detail,
      });
    }

    const state = {
      scoreA: detail.scoreA,
      scoreB: detail.scoreB,
      deuceMode: detail.deuceMode,
      currentServerId: detail.currentServerParticipantId,
      serveSequenceIndex: detail.serveSequenceIndex,
      status: detail.status as
        | "in_progress"
        | "pending_confirmation"
        | "finished",
      proposedWinner: (detail.winnerSide as Side | null) ?? null,
      version: detail.version,
    };
    if (detail.status === "pending_confirmation") {
      state.proposedWinner = detail.winnerSide as Side;
    }

    const history = (detail.eventLog as MatchEvent[]) ?? [];
    const keys = new Set<string>(
      (detail.idempotencyKeys as string[]) ?? [],
    );
    const result = reduceMatchEvent(
      state,
      {
        type: "point_awarded",
        side: input.side,
        idempotencyKey: input.idempotencyKey,
      },
      this.rulesFrom(detail),
      this.serveConfig(detail, detail.participants),
      history,
      keys,
    );
    if (!result.ok) {
      throw Object.assign(new Error(result.code), { code: result.code });
    }

    const now = this.clock.now();
    await this.db
      .update(matches)
      .set({
        scoreA: result.state.scoreA,
        scoreB: result.state.scoreB,
        deuceMode: result.state.deuceMode,
        currentServerParticipantId: result.state.currentServerId,
        serveSequenceIndex: result.state.serveSequenceIndex,
        status: result.state.status,
        winnerSide: result.state.proposedWinner,
        version: result.state.version,
        eventLog: history,
        idempotencyKeys: [...keys],
        updatedAt: now,
      })
      .where(eq(matches.id, input.matchId));
    return this.getMatch(input.matchId);
  }

  async undoPoint(input: {
    matchId: string;
    idempotencyKey: string;
    expectedVersion: number;
    judgeUserId: string;
    authSessionId: string;
  }) {
    await this.assertActiveJudge(
      input.matchId,
      input.judgeUserId,
      input.authSessionId,
    );
    const detail = await this.getMatch(input.matchId);
    if (!detail) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (detail.version !== input.expectedVersion) {
      throw Object.assign(new Error("VERSION_CONFLICT"), {
        code: "VERSION_CONFLICT",
        state: detail,
      });
    }
    const state = {
      scoreA: detail.scoreA,
      scoreB: detail.scoreB,
      deuceMode: detail.deuceMode,
      currentServerId: detail.currentServerParticipantId,
      serveSequenceIndex: detail.serveSequenceIndex,
      status: detail.status as
        | "in_progress"
        | "pending_confirmation"
        | "finished",
      proposedWinner: (detail.winnerSide as Side | null) ?? null,
      version: detail.version,
    };
    const history = (detail.eventLog as MatchEvent[]) ?? [];
    const keys = new Set<string>((detail.idempotencyKeys as string[]) ?? []);
    const result = reduceMatchEvent(
      state,
      { type: "point_undone", idempotencyKey: input.idempotencyKey },
      this.rulesFrom(detail),
      this.serveConfig(detail, detail.participants),
      history,
      keys,
    );
    if (!result.ok) {
      throw Object.assign(new Error(result.code), { code: result.code });
    }
    const now = this.clock.now();
    await this.db
      .update(matches)
      .set({
        scoreA: result.state.scoreA,
        scoreB: result.state.scoreB,
        deuceMode: result.state.deuceMode,
        currentServerParticipantId: result.state.currentServerId,
        serveSequenceIndex: result.state.serveSequenceIndex,
        status: result.state.status,
        winnerSide: result.state.proposedWinner,
        version: result.state.version,
        eventLog: history,
        idempotencyKeys: [...keys],
        updatedAt: now,
      })
      .where(eq(matches.id, input.matchId));
    return this.getMatch(input.matchId);
  }

  async confirmFinish(input: {
    matchId: string;
    judgeUserId: string;
    authSessionId: string;
  }) {
    await this.assertActiveJudge(
      input.matchId,
      input.judgeUserId,
      input.authSessionId,
    );
    const detail = await this.getMatch(input.matchId);
    if (!detail) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    const history = (detail.eventLog as MatchEvent[]) ?? [];
    const keys = new Set<string>((detail.idempotencyKeys as string[]) ?? []);
    const state = {
      scoreA: detail.scoreA,
      scoreB: detail.scoreB,
      deuceMode: detail.deuceMode,
      currentServerId: detail.currentServerParticipantId,
      serveSequenceIndex: detail.serveSequenceIndex,
      status: detail.status as
        | "in_progress"
        | "pending_confirmation"
        | "finished",
      proposedWinner: detail.winnerSide as Side | null,
      version: detail.version,
    };
    const result = reduceMatchEvent(
      state,
      { type: "finish_confirmed" },
      this.rulesFrom(detail),
      this.serveConfig(detail, detail.participants),
      history,
      keys,
    );
    if (!result.ok) {
      throw Object.assign(new Error(result.code), { code: result.code });
    }
    const now = this.clock.now();
    await this.db
      .update(matches)
      .set({
        status: "finished",
        finishedAt: now,
        finishReason: detail.kind === "tutorial" ? "tutorial" : "normal",
        version: result.state.version,
        eventLog: history,
        updatedAt: now,
      })
      .where(eq(matches.id, input.matchId));

    if (detail.kind !== "tutorial") {
      await this.applyStats(detail);
    }
    await this.releaseJudge(input.matchId);
    return this.getMatch(input.matchId);
  }

  async revertFinish(input: {
    matchId: string;
    judgeUserId: string;
    authSessionId: string;
  }) {
    await this.assertActiveJudge(
      input.matchId,
      input.judgeUserId,
      input.authSessionId,
    );
    const detail = await this.getMatch(input.matchId);
    if (!detail) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    const history = (detail.eventLog as MatchEvent[]) ?? [];
    const keys = new Set<string>((detail.idempotencyKeys as string[]) ?? []);
    const state = {
      scoreA: detail.scoreA,
      scoreB: detail.scoreB,
      deuceMode: detail.deuceMode,
      currentServerId: detail.currentServerParticipantId,
      serveSequenceIndex: detail.serveSequenceIndex,
      status: detail.status as
        | "in_progress"
        | "pending_confirmation"
        | "finished",
      proposedWinner: detail.winnerSide as Side | null,
      version: detail.version,
    };
    const result = reduceMatchEvent(
      state,
      { type: "finish_reverted" },
      this.rulesFrom(detail),
      this.serveConfig(detail, detail.participants),
      history,
      keys,
    );
    if (!result.ok) {
      throw Object.assign(new Error(result.code), { code: result.code });
    }
    await this.db
      .update(matches)
      .set({
        status: "in_progress",
        winnerSide: null,
        version: result.state.version,
        updatedAt: this.clock.now(),
      })
      .where(eq(matches.id, input.matchId));
    return this.getMatch(input.matchId);
  }

  async stopMatch(input: {
    matchId: string;
    winnerSide: Side;
    reasonCode: string;
    reasonText?: string;
    actorUserId: string;
  }) {
    const detail = await this.getMatch(input.matchId);
    if (!detail) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (detail.status === "finished" || detail.status === "stopped") {
      throw Object.assign(new Error("MATCH_IMMUTABLE"), {
        code: "MATCH_IMMUTABLE",
      });
    }
    const now = this.clock.now();
    await this.db
      .update(matches)
      .set({
        status: "stopped",
        winnerSide: input.winnerSide,
        finishReason: "manual_stop",
        stopReasonCode: input.reasonCode,
        stopReasonText: input.reasonText,
        finishedAt: now,
        updatedAt: now,
        version: detail.version + 1,
      })
      .where(eq(matches.id, input.matchId));
    const updated = await this.getMatch(input.matchId);
    if (updated && updated.kind !== "tutorial") {
      await this.applyStats(updated);
    }
    await this.releaseJudge(input.matchId);
    return updated;
  }

  async acquireJudge(input: {
    matchId: string;
    userId: string;
    authSessionId: string;
  }) {
    const now = this.clock.now();
    // Expire stale
    await this.db
      .update(judgeSessions)
      .set({ releasedAt: now })
      .where(
        and(
          eq(judgeSessions.matchId, input.matchId),
          isNull(judgeSessions.releasedAt),
          sql`${judgeSessions.expiresAt} <= ${now}`,
        ),
      );

    // User cannot hold judge from another auth session
    const other = await this.db.query.judgeSessions.findFirst({
      where: and(
        eq(judgeSessions.userId, input.userId),
        isNull(judgeSessions.releasedAt),
        ne(judgeSessions.authSessionId, input.authSessionId),
      ),
    });
    if (other) {
      throw Object.assign(new Error("JUDGE_OTHER_DEVICE"), {
        code: "JUDGE_OTHER_DEVICE",
      });
    }

    try {
      const [row] = await this.db
        .insert(judgeSessions)
        .values({
          matchId: input.matchId,
          userId: input.userId,
          authSessionId: input.authSessionId,
          acquiredAt: now,
          lastHeartbeatAt: now,
          expiresAt: new Date(now.getTime() + JUDGE_TTL_MS),
        })
        .returning();
      return row;
    } catch {
      throw Object.assign(new Error("JUDGE_TAKEN"), { code: "JUDGE_TAKEN" });
    }
  }

  async heartbeatJudge(input: {
    matchId: string;
    userId: string;
    authSessionId: string;
  }) {
    const now = this.clock.now();
    const result = await this.db
      .update(judgeSessions)
      .set({
        lastHeartbeatAt: now,
        expiresAt: new Date(now.getTime() + JUDGE_TTL_MS),
      })
      .where(
        and(
          eq(judgeSessions.matchId, input.matchId),
          eq(judgeSessions.userId, input.userId),
          eq(judgeSessions.authSessionId, input.authSessionId),
          isNull(judgeSessions.releasedAt),
        ),
      )
      .returning();
    if (result.length === 0) {
      throw Object.assign(new Error("JUDGE_NOT_ACTIVE"), {
        code: "JUDGE_NOT_ACTIVE",
      });
    }
    return result[0];
  }

  async releaseJudge(matchId: string) {
    const now = this.clock.now();
    await this.db
      .update(judgeSessions)
      .set({ releasedAt: now })
      .where(
        and(eq(judgeSessions.matchId, matchId), isNull(judgeSessions.releasedAt)),
      );
  }

  async handoverJudge(input: {
    matchId: string;
    fromUserId: string;
    fromAuthSessionId: string;
    toUserId: string;
  }) {
    await this.assertActiveJudge(
      input.matchId,
      input.fromUserId,
      input.fromAuthSessionId,
    );
    await this.releaseJudge(input.matchId);
    // Reserve for target — they must acquire with their session; create notification path
    return { reservedForUserId: input.toUserId };
  }

  private async assertActiveJudge(
    matchId: string,
    userId: string,
    authSessionId: string,
  ) {
    const now = this.clock.now();
    const session = await this.db.query.judgeSessions.findFirst({
      where: and(
        eq(judgeSessions.matchId, matchId),
        eq(judgeSessions.userId, userId),
        eq(judgeSessions.authSessionId, authSessionId),
        isNull(judgeSessions.releasedAt),
      ),
    });
    if (!session || session.expiresAt.getTime() <= now.getTime()) {
      throw Object.assign(new Error("JUDGE_REQUIRED"), {
        code: "JUDGE_REQUIRED",
      });
    }
  }

  private async applyStats(
    match: NonNullable<Awaited<ReturnType<MatchService["getMatch"]>>>,
  ) {
    if (!match.winnerSide) return;
    const winners = match.participants.filter((p) => p.side === match.winnerSide);
    const losers = match.participants.filter((p) => p.side !== match.winnerSide);
    for (const w of winners) {
      if (!w.userId || w.isTutorialActor) continue;
      await this.bumpStats(w.userId, true);
    }
    for (const l of losers) {
      if (!l.userId || l.isTutorialActor) continue;
      await this.bumpStats(l.userId, false);
    }
  }

  private async bumpStats(userId: string, won: boolean) {
    const existing = await this.db.query.userStats.findFirst({
      where: eq(userStats.userId, userId),
    });
    const now = this.clock.now();
    if (!existing) {
      await this.db.insert(userStats).values({
        userId,
        winsAllTime: won ? 1 : 0,
        lossesAllTime: won ? 0 : 1,
        winsWeek: won ? 1 : 0,
        winsMonth: won ? 1 : 0,
        updatedAt: now,
      });
      return;
    }
    await this.db
      .update(userStats)
      .set({
        winsAllTime: existing.winsAllTime + (won ? 1 : 0),
        lossesAllTime: existing.lossesAllTime + (won ? 0 : 1),
        winsWeek: existing.winsWeek + (won ? 1 : 0),
        winsMonth: existing.winsMonth + (won ? 1 : 0),
        updatedAt: now,
      })
      .where(eq(userStats.userId, userId));
  }

  async getRankings(period: "all_time" | "week" | "month" = "all_time") {
    const stats = await this.db.query.userStats.findMany();
    const allUsers = await this.db.query.users.findMany();
    const byId = new Map(allUsers.map((u) => [u.id, u]));
    const entries = stats
      .map((s) => {
        const u = byId.get(s.userId);
        if (!u || u.status === "blocked") return null;
        const wins =
          period === "week"
            ? s.winsWeek
            : period === "month"
              ? s.winsMonth
              : s.winsAllTime;
        return {
          userId: s.userId,
          wins,
          losses: s.lossesAllTime,
          displayName: `${u.lastName} ${u.firstName}`,
          status: u.status as "active" | "blocked",
        };
      })
      .filter(Boolean);
    return entries.sort(
      (a, b) =>
        b!.wins - a!.wins ||
        a!.losses - b!.losses ||
        a!.displayName.localeCompare(b!.displayName, "ru"),
    );
  }

  async createTutorialMatch(userId: string) {
    return this.createMatch({
      createdByUserId: userId,
      title: "Обучение: Призрачный Олег",
      format: "1v1",
      kind: "tutorial",
      pointsToWin: 11,
      participants: [
        { side: "A", userId },
        {
          side: "B",
          guestFirstName: "Призрачный",
          guestLastName: "Олег",
          isTutorialActor: true,
        },
      ],
    });
  }
}
