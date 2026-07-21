import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  buildRanking,
  calendarMonthStartUTC,
  calendarWeekStartUTC,
  createInitialScoreState,
  randomAvatarKey,
  reduceMatchEvent,
  toRankingEntry,
  type MatchEvent,
  type MatchRules,
  type RankingScope,
  type ServeRotationConfig,
  type Side,
} from "@tab10/shared";
import { randomBytes } from "node:crypto";
import type { Clock } from "@tab10/test-utils";
import type { Db } from "../../db/client.js";
import {
  judgeSessions,
  matchParticipants,
  matches,
  userStats,
  users,
} from "../../db/schema.js";

const JUDGE_TTL_MS = 120_000;
const STOP_REASON_CODES = ["injury", "time", "other"] as const;

export class MatchService {
  private onTournamentMatchFinished:
    | ((matchId: string) => Promise<void>)
    | null = null;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  setTournamentMatchFinishedHook(
    hook: (matchId: string) => Promise<void>,
  ) {
    this.onTournamentMatchFinished = hook;
  }

  /**
   * Create a match. Pass `db` to run inside an external transaction
   * (same executor as bracket materialize).
   */
  async createMatch(
    input: {
      createdByUserId: string;
      title: string;
      format: "1v1" | "2v2";
      pointsToWin?: number;
      mercyEnabled?: boolean;
      mercyPoints?: number | null;
      kind?: "standalone" | "tournament" | "tutorial";
      tournamentId?: string;
      tournamentSlotId?: string;
      tournamentBracketMatchId?: string;
      participants: Array<{
        side: Side;
        userId?: string;
        guestFirstName?: string;
        guestLastName?: string;
        guestAvatarKey?: string;
        isTutorialActor?: boolean;
      }>;
    },
    db: Db = this.db,
  ) {
    const [match] = await db
      .insert(matches)
      .values({
        title: input.title,
        format: input.format,
        pointsToWin: input.pointsToWin ?? 11,
        mercyEnabled: input.mercyEnabled ?? false,
        mercyPoints: input.mercyPoints ?? null,
        kind: input.kind ?? "standalone",
        createdByUserId: input.createdByUserId,
        tournamentId: input.tournamentId,
        tournamentSlotId: input.tournamentSlotId,
        tournamentBracketMatchId: input.tournamentBracketMatchId,
        status: "waiting",
      })
      .returning();

    for (const p of input.participants) {
      const isGuest = !p.userId && (p.guestFirstName || p.guestLastName);
      await db.insert(matchParticipants).values({
        matchId: match!.id,
        side: p.side,
        userId: p.userId,
        guestFirstName: p.guestFirstName,
        guestLastName: p.guestLastName,
        guestAvatarKey: isGuest
          ? (p.guestAvatarKey ?? randomAvatarKey(randomBytes(1)[0]!))
          : null,
        isTutorialActor: p.isTutorialActor ?? false,
      });
    }
    return this.getMatch(match!.id, db);
  }

  async getMatch(matchId: string, db: Db = this.db) {
    const match = await db.query.matches.findFirst({
      where: eq(matches.id, matchId),
    });
    if (!match) return null;
    const participants = await db.query.matchParticipants.findMany({
      where: eq(matchParticipants.matchId, matchId),
    });
    const userIds = participants
      .map((p) => p.userId)
      .filter((id): id is string => Boolean(id));
    const userRows =
      userIds.length > 0
        ? await this.db.query.users.findMany({
            where: inArray(users.id, userIds),
          })
        : [];
    const usersById = new Map(userRows.map((u) => [u.id, u]));
    const activeJudge = await this.getActiveJudge(matchId);
    return {
      ...match,
      participants: participants.map((p) => ({
        ...p,
        displayName: this.participantDisplayName(p, usersById),
        avatarKey: p.userId
          ? (usersById.get(p.userId)?.generatedAvatarKey ?? null)
          : (p.guestAvatarKey ?? null),
      })),
      activeJudge,
    };
  }

  private async getActiveJudge(
    matchId: string,
  ): Promise<{ userId: string; displayName: string } | null> {
    const now = this.clock.now();
    const session = await this.db.query.judgeSessions.findFirst({
      where: and(
        eq(judgeSessions.matchId, matchId),
        isNull(judgeSessions.releasedAt),
        sql`${judgeSessions.expiresAt} > ${now}`,
      ),
    });
    if (!session) return null;
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, session.userId),
    });
    if (!user) return null;
    return {
      userId: user.id,
      displayName: `${user.lastName} ${user.firstName}`.trim(),
    };
  }

  private participantDisplayName(
    p: typeof matchParticipants.$inferSelect,
    usersById: Map<string, typeof users.$inferSelect>,
  ): string {
    if (p.isTutorialActor) return "Призрачный Олег";
    if (p.userId) {
      const u = usersById.get(p.userId);
      if (u) return `${u.lastName} ${u.firstName}`.trim();
    }
    const guest = [p.guestFirstName, p.guestLastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (guest) return guest;
    return p.side === "A" ? "Сторона A" : "Сторона B";
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
    const sideA = participants
      .filter((p) => p.side === "A")
      .sort((a, b) => a.id.localeCompare(b.id));
    const sideB = participants
      .filter((p) => p.side === "B")
      .sort((a, b) => a.id.localeCompare(b.id));
    const order: string[] = [];
    const maxLen = Math.max(sideA.length, sideB.length);
    for (let i = 0; i < maxLen; i += 1) {
      if (sideA[i]) order.push(sideA[i]!.id);
      if (sideB[i]) order.push(sideB[i]!.id);
    }
    return {
      format: match.format,
      participantOrder: order.length > 0 ? order : participants.map((p) => p.id),
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
    if (
      detail.status !== "in_progress" &&
      detail.status !== "pending_confirmation"
    ) {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "INVALID_STATUS" });
    }

    const keys = new Set<string>(
      (detail.idempotencyKeys as string[]) ?? [],
    );
    if (keys.has(input.idempotencyKey)) {
      return detail;
    }

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
    if (!result.applied) {
      return detail;
    }

    const now = this.clock.now();
    const updated = await this.db
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
      .where(
        and(
          eq(matches.id, input.matchId),
          eq(matches.version, input.expectedVersion),
        ),
      )
      .returning();
    if (updated.length === 0) {
      const current = await this.getMatch(input.matchId);
      throw Object.assign(new Error("VERSION_CONFLICT"), {
        code: "VERSION_CONFLICT",
        state: current,
      });
    }
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

    const keys = new Set<string>((detail.idempotencyKeys as string[]) ?? []);
    if (keys.has(input.idempotencyKey)) {
      return detail;
    }

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
    if (!result.applied) {
      return detail;
    }
    const now = this.clock.now();
    const updated = await this.db
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
      .where(
        and(
          eq(matches.id, input.matchId),
          eq(matches.version, input.expectedVersion),
        ),
      )
      .returning();
    if (updated.length === 0) {
      const current = await this.getMatch(input.matchId);
      throw Object.assign(new Error("VERSION_CONFLICT"), {
        code: "VERSION_CONFLICT",
        state: current,
      });
    }
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
    if (detail.kind === "tournament" && this.onTournamentMatchFinished) {
      await this.onTournamentMatchFinished(input.matchId);
    }
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
    if (
      !STOP_REASON_CODES.includes(
        input.reasonCode as (typeof STOP_REASON_CODES)[number],
      )
    ) {
      throw Object.assign(new Error("VALIDATION"), {
        code: "VALIDATION",
        message: "reasonCode must be injury, time, or other",
      });
    }
    await this.assertCanManageMatch(detail, input.actorUserId);

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
    await this.releaseJudge(input.matchId, input.actorUserId, undefined, true);
    if (updated?.kind === "tournament" && this.onTournamentMatchFinished) {
      await this.onTournamentMatchFinished(input.matchId);
    }
    return updated;
  }

  async acquireJudge(input: {
    matchId: string;
    userId: string;
    authSessionId: string;
  }) {
    const detail = await this.getMatch(input.matchId);
    if (!detail) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (
      detail.status !== "waiting" &&
      detail.status !== "in_progress" &&
      detail.status !== "pending_confirmation"
    ) {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "INVALID_STATUS" });
    }
    const actor = await this.db.query.users.findFirst({
      where: eq(users.id, input.userId),
    });
    if (!actor || actor.status !== "active") {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }

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
    const otherDevice = await this.db.query.judgeSessions.findFirst({
      where: and(
        eq(judgeSessions.userId, input.userId),
        isNull(judgeSessions.releasedAt),
        ne(judgeSessions.authSessionId, input.authSessionId),
      ),
    });
    if (otherDevice) {
      throw Object.assign(new Error("JUDGE_OTHER_DEVICE"), {
        code: "JUDGE_OTHER_DEVICE",
      });
    }

    // One active judge session per user across matches
    const otherMatch = await this.db.query.judgeSessions.findFirst({
      where: and(
        eq(judgeSessions.userId, input.userId),
        isNull(judgeSessions.releasedAt),
        ne(judgeSessions.matchId, input.matchId),
        sql`${judgeSessions.expiresAt} > ${now}`,
      ),
    });
    if (otherMatch) {
      throw Object.assign(new Error("JUDGE_BUSY"), { code: "JUDGE_BUSY" });
    }

    const existing = await this.db.query.judgeSessions.findFirst({
      where: and(
        eq(judgeSessions.matchId, input.matchId),
        eq(judgeSessions.userId, input.userId),
        eq(judgeSessions.authSessionId, input.authSessionId),
        isNull(judgeSessions.releasedAt),
        sql`${judgeSessions.expiresAt} > ${now}`,
      ),
    });
    if (existing) return existing;

    const taken = await this.db.query.judgeSessions.findFirst({
      where: and(
        eq(judgeSessions.matchId, input.matchId),
        isNull(judgeSessions.releasedAt),
        sql`${judgeSessions.expiresAt} > ${now}`,
      ),
    });
    if (taken) {
      const currentJudge = await this.getActiveJudge(input.matchId);
      throw Object.assign(new Error("JUDGE_TAKEN"), {
        code: "JUDGE_TAKEN",
        currentJudge: currentJudge ?? undefined,
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
      const currentJudge = await this.getActiveJudge(input.matchId);
      throw Object.assign(new Error("JUDGE_TAKEN"), {
        code: "JUDGE_TAKEN",
        currentJudge: currentJudge ?? undefined,
      });
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
          sql`${judgeSessions.expiresAt} > ${now}`,
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

  async releaseJudge(
    matchId: string,
    userId?: string,
    authSessionId?: string,
    force = false,
  ) {
    if (!force && userId && authSessionId) {
      await this.assertActiveJudge(matchId, userId, authSessionId);
    } else if (!force && userId) {
      const detail = await this.getMatch(matchId);
      if (!detail || !this.isMatchParticipant(detail, userId)) {
        throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
      }
    }
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

  async judgeSetup(input: {
    matchId: string;
    userId: string;
    authSessionId: string;
    firstServerParticipantId?: string;
    swapSides?: boolean;
    displayFlipped?: boolean;
  }) {
    await this.assertActiveJudge(
      input.matchId,
      input.userId,
      input.authSessionId,
    );
    const detail = await this.getMatch(input.matchId);
    if (!detail) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });

    const totalPoints = detail.scoreA + detail.scoreB;
    if (totalPoints > 0 && input.swapSides) {
      throw Object.assign(new Error("INVALID_STATUS"), {
        code: "INVALID_STATUS",
        message: "Cannot swap sides after points scored",
      });
    }

    const now = this.clock.now();

    if (input.swapSides && totalPoints === 0) {
      for (const p of detail.participants) {
        const nextSide = p.side === "A" ? "B" : "A";
        await this.db
          .update(matchParticipants)
          .set({ side: nextSide })
          .where(eq(matchParticipants.id, p.id));
      }
    }

    const patch: Partial<typeof matches.$inferInsert> = { updatedAt: now };
    if (!detail.startedAt && totalPoints === 0) {
      patch.startedAt = now;
    }
    if (input.firstServerParticipantId) {
      const valid = detail.participants.some(
        (p) => p.id === input.firstServerParticipantId,
      );
      if (!valid) {
        throw Object.assign(new Error("VALIDATION"), {
          code: "VALIDATION",
          message: "Invalid first server participant",
        });
      }
      patch.currentServerParticipantId = input.firstServerParticipantId;
    }
    if (input.displayFlipped !== undefined) {
      patch.judgeDisplayFlipped = input.displayFlipped;
    }
    if (Object.keys(patch).length > 1) {
      await this.db
        .update(matches)
        .set(patch)
        .where(eq(matches.id, input.matchId));
    }

    return this.getMatch(input.matchId);
  }

  private isMatchParticipant(
    detail: NonNullable<Awaited<ReturnType<MatchService["getMatch"]>>>,
    userId: string,
  ): boolean {
    return (
      detail.createdByUserId === userId ||
      detail.participants.some((p) => p.userId === userId)
    );
  }

  private async assertCanManageMatch(
    detail: NonNullable<Awaited<ReturnType<MatchService["getMatch"]>>>,
    userId: string,
  ) {
    if (this.isMatchParticipant(detail, userId)) return;
    const now = this.clock.now();
    const judge = await this.db.query.judgeSessions.findFirst({
      where: and(
        eq(judgeSessions.matchId, detail.id),
        eq(judgeSessions.userId, userId),
        isNull(judgeSessions.releasedAt),
        sql`${judgeSessions.expiresAt} > ${now}`,
      ),
    });
    if (!judge) {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
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

  async getRankings(scope: RankingScope = "all_time") {
    const now = this.clock.now();
    const allUsers = await this.db.query.users.findMany();
    const activeUsers = allUsers.filter((u) => u.status === "active");

    if (scope === "all_time") {
      const stats = await this.db.query.userStats.findMany();
      const statsByUser = new Map(stats.map((s) => [s.userId, s]));
      const entries = activeUsers.map((u) => {
        const s = statsByUser.get(u.id);
        return toRankingEntry({
          userId: u.id,
          wins: s?.winsAllTime ?? 0,
          losses: s?.lossesAllTime ?? 0,
          displayName: `${u.lastName} ${u.firstName}`,
          status: u.status as "active" | "blocked",
          createdAt: u.createdAt,
          avatarKey: u.generatedAvatarKey ?? null,
        });
      });
      return buildRanking(entries);
    }

    const rangeStart =
      scope === "week"
        ? calendarWeekStartUTC(now)
        : calendarMonthStartUTC(now);
    const finished = await this.db.query.matches.findMany({
      where: and(
        inArray(matches.status, ["finished", "stopped"]),
        ne(matches.kind, "tutorial"),
        sql`${matches.finishedAt} >= ${rangeStart}`,
      ),
    });
    const matchIds = finished.map((m) => m.id);
    const participants =
      matchIds.length > 0
        ? await this.db.query.matchParticipants.findMany({
            where: inArray(matchParticipants.matchId, matchIds),
          })
        : [];
    const partsByMatch = new Map<string, typeof participants>();
    for (const p of participants) {
      const list = partsByMatch.get(p.matchId) ?? [];
      list.push(p);
      partsByMatch.set(p.matchId, list);
    }

    const agg = new Map<string, { wins: number; losses: number }>();
    for (const m of finished) {
      if (!m.winnerSide || !m.finishedAt) continue;
      const parts = partsByMatch.get(m.id) ?? [];
      for (const p of parts) {
        if (!p.userId || p.isTutorialActor) continue;
        const cur = agg.get(p.userId) ?? { wins: 0, losses: 0 };
        if (p.side === m.winnerSide) cur.wins += 1;
        else cur.losses += 1;
        agg.set(p.userId, cur);
      }
    }

    const entries = activeUsers
      .map((u) => {
        const a = agg.get(u.id) ?? { wins: 0, losses: 0 };
        if (a.wins + a.losses === 0) return null;
        return toRankingEntry({
          userId: u.id,
          wins: a.wins,
          losses: a.losses,
          displayName: `${u.lastName} ${u.firstName}`,
          status: u.status as "active" | "blocked",
          createdAt: u.createdAt,
          avatarKey: u.generatedAvatarKey ?? null,
        });
      })
      .filter(Boolean) as ReturnType<typeof toRankingEntry>[];

    return buildRanking(entries);
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
