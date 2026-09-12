import { and, desc, eq, gt, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import {
  buildRanking,
  calendarMonthStartMoscow,
  calendarWeekStartMoscow,
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
  matchVoidAudits,
  matches,
  userStats,
  users,
} from "../../db/schema.js";

const JUDGE_TTL_MS = 120_000;
const STOP_REASON_CODES = ["injury", "time", "other"] as const;
const COMPLETED_MATCH_STATUSES = new Set([
  "finished",
  "stopped",
  "cancelled",
  "voided",
]);

type MatchParticipantInput = {
  side: Side;
  userId?: string;
  guestFirstName?: string;
  guestLastName?: string;
  guestAvatarKey?: string;
  isTutorialActor?: boolean;
};

type CreateMatchInput = {
  createdByUserId: string;
  title: string;
  format: "1v1" | "2v2";
  pointsToWin?: number;
  mercyEnabled?: boolean;
  mercyPoints?: number | null;
  source?: "manual" | "challenge" | "revenge" | "tutorial";
  kind?: "standalone" | "tournament" | "tutorial";
  tournamentId?: string;
  tournamentSlotId?: string;
  tournamentBracketMatchId?: string;
  participants: MatchParticipantInput[];
};

function validationError(message: string) {
  return Object.assign(new Error(message), { code: "VALIDATION" });
}

export class MatchService {
  private onTournamentMatchFinished:
    | ((matchId: string, db: Db) => Promise<void>)
    | null = null;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  setTournamentMatchFinishedHook(
    hook: (matchId: string, db: Db) => Promise<void>,
  ) {
    this.onTournamentMatchFinished = hook;
  }

  /**
   * Create a match. Pass `db` to run inside an external transaction
   * (same executor as bracket materialize).
   */
  async createMatch(
    input: CreateMatchInput,
    db?: Db,
  ) {
    this.assertValidCreateInput(input);

    const create = async (executor: Db) => {
      await this.assertActiveRegisteredParticipants(input.participants, executor);
      const [match] = await executor
        .insert(matches)
        .values({
          title: input.title.trim(),
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
        await executor.insert(matchParticipants).values({
          matchId: match!.id,
          side: p.side,
          userId: p.userId,
          guestFirstName: p.guestFirstName?.trim(),
          guestLastName: p.guestLastName?.trim(),
          guestAvatarKey: isGuest
            ? (p.guestAvatarKey ?? randomAvatarKey(randomBytes(1)[0]!))
            : null,
          isTutorialActor: p.isTutorialActor ?? false,
        });
      }
      return match!.id;
    };

    if (db && db !== this.db) {
      const matchId = await create(db);
      return this.getMatch(matchId, db);
    }

    const matchId = await this.db.transaction((tx) =>
      create(tx as unknown as Db),
    );
    return this.getMatch(matchId);
  }

  private assertValidCreateInput(input: CreateMatchInput) {
    const kind = input.kind ?? "standalone";
    const pointsToWin = input.pointsToWin ?? 11;
    const mercyEnabled = input.mercyEnabled ?? false;
    const mercyPoints = input.mercyPoints ?? null;
    if (!input.title?.trim() || input.title.trim().length > 200) {
      throw validationError("title must contain 1 to 200 characters");
    }
    if (input.format !== "1v1" && input.format !== "2v2") {
      throw validationError("format must be 1v1 or 2v2");
    }
    if (!Number.isInteger(pointsToWin) || pointsToWin < 1) {
      throw validationError("pointsToWin must be a positive integer");
    }
    if (
      mercyEnabled &&
      (!Number.isInteger(mercyPoints) || (mercyPoints ?? 0) < 1)
    ) {
      throw validationError("mercyPoints must be positive when mercy is enabled");
    }
    if (kind !== "standalone" && input.format !== "1v1") {
      throw validationError("tournament and tutorial matches must use 1v1");
    }

    const expectedPerSide = input.format === "1v1" ? 1 : 2;
    const sideA = input.participants.filter((p) => p.side === "A");
    const sideB = input.participants.filter((p) => p.side === "B");
    if (
      input.participants.some((p) => p.side !== "A" && p.side !== "B") ||
      sideA.length !== expectedPerSide ||
      sideB.length !== expectedPerSide
    ) {
      throw validationError(`format ${input.format} requires two complete sides`);
    }

    const registeredIds = new Set<string>();
    let tutorialActors = 0;
    for (const participant of input.participants) {
      const firstName = participant.guestFirstName?.trim() ?? "";
      const lastName = participant.guestLastName?.trim() ?? "";
      const hasGuestData = Boolean(firstName || lastName);
      if (participant.userId) {
        if (hasGuestData || participant.isTutorialActor) {
          throw validationError("registered participant cannot also be a guest");
        }
        if (registeredIds.has(participant.userId)) {
          throw validationError("registered participants must be distinct");
        }
        registeredIds.add(participant.userId);
      } else {
        if (!firstName || !lastName) {
          throw validationError("guest first and last name are required");
        }
        if (participant.isTutorialActor) tutorialActors += 1;
      }
    }

    if (kind === "standalone" && !registeredIds.has(input.createdByUserId)) {
      throw validationError("standalone creator must be a participant");
    }
    if (
      kind === "tutorial" &&
      (tutorialActors !== 1 || !registeredIds.has(input.createdByUserId))
    ) {
      throw validationError("tutorial requires creator and one tutorial actor");
    }
  }

  private async assertActiveRegisteredParticipants(
    participants: MatchParticipantInput[],
    db: Db,
  ) {
    const userIds = [
      ...new Set(
        participants
          .map((participant) => participant.userId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (userIds.length === 0) return;
    const rows = await db.query.users.findMany({
      where: inArray(users.id, userIds),
    });
    if (
      rows.length !== userIds.length ||
      rows.some((user) => user.status !== "active")
    ) {
      throw validationError("registered participants must exist and be active");
    }
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
        ? await db.query.users.findMany({
            where: inArray(users.id, userIds),
          })
        : [];
    const usersById = new Map(userRows.map((u) => [u.id, u]));
    const activeJudge = await this.getActiveJudge(matchId, db);
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

  async getVisibleMatch(matchId: string, actorUserId: string) {
    const detail = await this.getMatch(matchId);
    if (!detail) return null;
    if (!this.canViewMatch(detail, actorUserId)) {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
    return detail;
  }

  private canViewMatch(
    match: {
      kind: string;
      status: string;
      createdByUserId: string;
      participants: Array<{ userId: string | null }>;
      activeJudge: { userId: string } | null;
    },
    actorUserId: string,
  ) {
    const hasContextualAccess =
      match.createdByUserId === actorUserId ||
      match.participants.some((participant) => participant.userId === actorUserId) ||
      match.activeJudge?.userId === actorUserId;
    if (match.kind === "tutorial") return hasContextualAccess;
    return COMPLETED_MATCH_STATUSES.has(match.status) || hasContextualAccess;
  }

  private async getActiveJudge(
    matchId: string,
    db: Db = this.db,
  ): Promise<{ userId: string; displayName: string } | null> {
    const now = this.clock.now();
    const session = await db.query.judgeSessions.findFirst({
      where: and(
        eq(judgeSessions.matchId, matchId),
        isNull(judgeSessions.releasedAt),
        gt(judgeSessions.expiresAt, now),
      ),
    });
    if (!session) return null;
    const user = await db.query.users.findFirst({
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

  async listMatches(actorUserId: string, limit = 50) {
    const [rows, participantRows, judgeRows] = await Promise.all([
      this.db.query.matches.findMany({
        where: ne(matches.kind, "tutorial"),
        orderBy: [desc(matches.createdAt)],
      }),
      this.db.query.matchParticipants.findMany({
        where: eq(matchParticipants.userId, actorUserId),
      }),
      this.db.query.judgeSessions.findMany({
        where: and(
          eq(judgeSessions.userId, actorUserId),
          isNull(judgeSessions.releasedAt),
          gt(judgeSessions.expiresAt, this.clock.now()),
        ),
      }),
    ]);
    const participantMatchIds = new Set(
      participantRows.map((participant) => participant.matchId),
    );
    const judgedMatchIds = new Set(judgeRows.map((session) => session.matchId));
    return rows.filter((match) =>
      COMPLETED_MATCH_STATUSES.has(match.status) ||
      match.createdByUserId === actorUserId ||
      participantMatchIds.has(match.id) ||
      judgedMatchIds.has(match.id),
    ).slice(0, limit);
  }

  async startMatch(
    matchId: string,
    actorUserId: string,
    firstServerParticipantId?: string,
  ) {
    const detail = await this.getMatch(matchId);
    if (!detail) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (detail.createdByUserId !== actorUserId) {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
    if (detail.status !== "waiting") {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "INVALID_STATUS" });
    }

    const participantInputs: MatchParticipantInput[] = detail.participants.map(
      (participant) => ({
        side: participant.side as Side,
        userId: participant.userId ?? undefined,
        guestFirstName: participant.guestFirstName ?? undefined,
        guestLastName: participant.guestLastName ?? undefined,
        guestAvatarKey: participant.guestAvatarKey ?? undefined,
        isTutorialActor: participant.isTutorialActor,
      }),
    );
    this.assertValidCreateInput({
      createdByUserId: detail.createdByUserId,
      title: detail.title,
      format: detail.format,
      pointsToWin: detail.pointsToWin,
      mercyEnabled: detail.mercyEnabled,
      mercyPoints: detail.mercyPoints,
      kind: detail.kind,
      tournamentId: detail.tournamentId ?? undefined,
      tournamentSlotId: detail.tournamentSlotId ?? undefined,
      tournamentBracketMatchId:
        detail.tournamentBracketMatchId ?? undefined,
      participants: participantInputs,
    });
    await this.assertActiveRegisteredParticipants(participantInputs, this.db);
    if (
      firstServerParticipantId &&
      !detail.participants.some(
        (participant) => participant.id === firstServerParticipantId,
      )
    ) {
      throw validationError("first server must be a match participant");
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
    if (input.side !== "A" && input.side !== "B") {
      throw validationError("side must be A or B");
    }
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
      throw validationError("expectedVersion must be a non-negative integer");
    }
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
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
      throw validationError("expectedVersion must be a non-negative integer");
    }
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
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      const detail = await this.getMatch(input.matchId, db);
      if (!detail) {
        throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      }

      if (detail.status === "finished") {
        const replayJudge = await db.query.judgeSessions.findFirst({
          where: and(
            eq(judgeSessions.matchId, input.matchId),
            eq(judgeSessions.userId, input.judgeUserId),
            eq(judgeSessions.authSessionId, input.authSessionId),
          ),
        });
        if (!replayJudge) {
          throw Object.assign(new Error("JUDGE_REQUIRED"), {
            code: "JUDGE_REQUIRED",
          });
        }
        return detail;
      }

      await this.assertActiveJudge(
        input.matchId,
        input.judgeUserId,
        input.authSessionId,
        db,
      );
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
      const updated = await db
        .update(matches)
        .set({
          status: "finished",
          finishedAt: now,
          finishReason: detail.kind === "tutorial" ? "tutorial" : "normal",
          version: result.state.version,
          eventLog: history,
          updatedAt: now,
        })
        .where(
          and(
            eq(matches.id, input.matchId),
            eq(matches.status, "pending_confirmation"),
            eq(matches.version, detail.version),
          ),
        )
        .returning({ id: matches.id });

      if (updated.length === 0) {
        const current = await this.getMatch(input.matchId, db);
        if (current?.status === "finished") return current;
        throw Object.assign(new Error("VERSION_CONFLICT"), {
          code: "VERSION_CONFLICT",
          state: current,
        });
      }

      if (detail.kind !== "tutorial") {
        await this.applyStats(detail, db);
      }
      await this.releaseJudge(input.matchId, undefined, undefined, true, db);
      if (detail.kind === "tournament" && this.onTournamentMatchFinished) {
        await this.onTournamentMatchFinished(input.matchId, db);
      }
      return this.getMatch(input.matchId, db);
    });
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
    if (input.winnerSide !== "A" && input.winnerSide !== "B") {
      throw validationError("winnerSide must be A or B");
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
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      const detail = await this.getMatch(input.matchId, db);
      if (!detail) {
        throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      }
      if (detail.status === "finished" || detail.status === "stopped") {
        throw Object.assign(new Error("MATCH_IMMUTABLE"), {
          code: "MATCH_IMMUTABLE",
        });
      }
      if (
        detail.status !== "in_progress" &&
        detail.status !== "pending_confirmation"
      ) {
        throw Object.assign(new Error("MATCH_NOT_ACTIVE"), {
          code: "MATCH_NOT_ACTIVE",
        });
      }
      await this.assertCanStopMatch(detail, input.actorUserId, db);

      const now = this.clock.now();
      const updatedRows = await db
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
        .where(
          and(
            eq(matches.id, input.matchId),
            eq(matches.status, detail.status),
            eq(matches.version, detail.version),
          ),
        )
        .returning({ id: matches.id });
      if (updatedRows.length === 0) {
        const current = await this.getMatch(input.matchId, db);
        throw Object.assign(new Error("VERSION_CONFLICT"), {
          code: "VERSION_CONFLICT",
          state: current,
        });
      }
      const updated = await this.getMatch(input.matchId, db);
      if (updated && updated.kind !== "tutorial") {
        await this.applyStats(updated, db);
      }
      await this.releaseJudge(
        input.matchId,
        input.actorUserId,
        undefined,
        true,
        db,
      );
      if (updated?.kind === "tournament" && this.onTournamentMatchFinished) {
        await this.onTournamentMatchFinished(input.matchId, db);
      }
      return this.getMatch(input.matchId, db);
    });
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
          lte(judgeSessions.expiresAt, now),
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
        gt(judgeSessions.expiresAt, now),
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
        gt(judgeSessions.expiresAt, now),
      ),
    });
    if (existing) return existing;

    const taken = await this.db.query.judgeSessions.findFirst({
      where: and(
        eq(judgeSessions.matchId, input.matchId),
        isNull(judgeSessions.releasedAt),
        gt(judgeSessions.expiresAt, now),
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
          gt(judgeSessions.expiresAt, now),
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
    db: Db = this.db,
  ) {
    if (!force && userId && authSessionId) {
      await this.assertActiveJudge(matchId, userId, authSessionId, db);
    } else if (!force && userId) {
      const detail = await this.getMatch(matchId, db);
      if (!detail || !this.isMatchParticipant(detail, userId)) {
        throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
      }
    }
    const now = this.clock.now();
    await db
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

  private async assertCanStopMatch(
    detail: NonNullable<Awaited<ReturnType<MatchService["getMatch"]>>>,
    userId: string,
    db: Db = this.db,
  ) {
    if (detail.createdByUserId === userId) return;
    const now = this.clock.now();
    const judge = await db.query.judgeSessions.findFirst({
      where: and(
        eq(judgeSessions.matchId, detail.id),
        eq(judgeSessions.userId, userId),
        isNull(judgeSessions.releasedAt),
        gt(judgeSessions.expiresAt, now),
      ),
    });
    if (!judge) {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
  }

  private async assertCanCancelMatch(
    detail: NonNullable<Awaited<ReturnType<MatchService["getMatch"]>>>,
    userId: string,
    db: Db = this.db,
  ) {
    if (detail.createdByUserId === userId) return;
    const actor = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!actor || actor.status !== "active" || actor.role !== "admin") {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
  }

  private async assertCanVoidMatch(
    detail: NonNullable<Awaited<ReturnType<MatchService["getMatch"]>>>,
    userId: string,
    db: Db = this.db,
  ) {
    const actor = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (
      !actor ||
      actor.status !== "active" ||
      (detail.createdByUserId !== userId && actor.role !== "admin")
    ) {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
  }

  private async assertActiveJudge(
    matchId: string,
    userId: string,
    authSessionId: string,
    db: Db = this.db,
  ) {
    const now = this.clock.now();
    const session = await db.query.judgeSessions.findFirst({
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
    db: Db = this.db,
  ) {
    if (!match.winnerSide) return;
    const winners = match.participants.filter((p) => p.side === match.winnerSide);
    const losers = match.participants.filter((p) => p.side !== match.winnerSide);
    for (const w of winners) {
      if (!w.userId || w.isTutorialActor) continue;
      await this.bumpStats(w.userId, true, 1, db);
    }
    for (const l of losers) {
      if (!l.userId || l.isTutorialActor) continue;
      await this.bumpStats(l.userId, false, 1, db);
    }
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
        ? calendarWeekStartMoscow(now)
        : calendarMonthStartMoscow(now);
    const finished = await this.db.query.matches.findMany({
      where: and(
        inArray(matches.status, ["finished", "stopped"]),
        ne(matches.kind, "tutorial"),
        gte(matches.finishedAt, rangeStart),
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

  /** Creator/admin cancel of an active standalone match — frees MATCH-009. */
  async cancelMatch(input: {
    matchId: string;
    actorUserId: string;
    expectedVersion: number;
    idempotencyKey: string;
    reasonText?: string;
  }) {
    const detail = await this.getMatch(input.matchId);
    if (!detail) {
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    }
    if (detail.kind !== "standalone") {
      throw Object.assign(new Error("TOURNAMENT_MATCH_FORBIDDEN"), {
        code: "TOURNAMENT_MATCH_FORBIDDEN",
      });
    }
    await this.assertCanCancelMatch(detail, input.actorUserId);
    return this.cancelActiveStandaloneMatch({
      matchId: input.matchId,
      actorUserId: input.actorUserId,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      reasonText: input.reasonText,
      detail,
    });
  }

  /** Admin ops (D15): void active standalone match without stats. */
  async adminForceCloseMatch(input: {
    matchId: string;
    actorAdminId: string;
    expectedVersion: number;
    idempotencyKey: string;
    reasonText?: string;
  }) {
    const detail = await this.getMatch(input.matchId);
    if (!detail) {
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    }
    if (detail.kind !== "standalone") {
      throw Object.assign(new Error("TOURNAMENT_MATCH_FORBIDDEN"), {
        code: "TOURNAMENT_MATCH_FORBIDDEN",
      });
    }
    await this.assertCanCancelMatch(detail, input.actorAdminId);
    return this.cancelActiveStandaloneMatch({
      matchId: input.matchId,
      actorUserId: input.actorAdminId,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      reasonText: input.reasonText,
      detail,
    });
  }

  private async cancelActiveStandaloneMatch(input: {
    matchId: string;
    actorUserId: string;
    expectedVersion: number;
    idempotencyKey: string;
    reasonText?: string;
    detail: NonNullable<Awaited<ReturnType<MatchService["getMatch"]>>>;
  }) {
    const storedKey = `cancel:${input.actorUserId}:${input.idempotencyKey}`;
    const keys = new Set<string>(
      (input.detail.idempotencyKeys as string[]) ?? [],
    );
    if (keys.has(storedKey)) return input.detail;
    if (input.detail.version !== input.expectedVersion) {
      throw Object.assign(new Error("VERSION_CONFLICT"), {
        code: "VERSION_CONFLICT",
        state: input.detail,
      });
    }
    if (
      input.detail.status !== "waiting" &&
      input.detail.status !== "in_progress" &&
      input.detail.status !== "pending_confirmation"
    ) {
      throw Object.assign(new Error("MATCH_NOT_ACTIVE"), {
        code: "MATCH_NOT_ACTIVE",
      });
    }

    keys.add(storedKey);
    const now = this.clock.now();
    const updated = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(matches)
        .set({
          status: "cancelled",
          winnerSide: null,
          finishReason: "cancelled",
          stopReasonCode: "other",
          stopReasonText: input.reasonText ?? null,
          finishedAt: now,
          updatedAt: now,
          version: input.expectedVersion + 1,
          idempotencyKeys: [...keys],
        })
        .where(
          and(
            eq(matches.id, input.matchId),
            eq(matches.version, input.expectedVersion),
            inArray(matches.status, [
              "waiting",
              "in_progress",
              "pending_confirmation",
            ]),
          ),
        )
        .returning();
      if (rows.length === 0) return null;
      await tx
        .update(judgeSessions)
        .set({ releasedAt: now })
        .where(
          and(
            eq(judgeSessions.matchId, input.matchId),
            isNull(judgeSessions.releasedAt),
          ),
        );
      return this.getMatch(input.matchId, tx as unknown as Db);
    });
    if (updated) return updated;

    const current = await this.getMatch(input.matchId);
    const currentKeys = new Set<string>(
      (current?.idempotencyKeys as string[]) ?? [],
    );
    if (current && currentKeys.has(storedKey)) return current;
    throw Object.assign(new Error("VERSION_CONFLICT"), {
      code: "VERSION_CONFLICT",
      state: current,
    });
  }

  /** D19/D24/D33: soft-invalidate one terminal result and compensate it once. */
  async voidMatch(input: {
    matchId: string;
    actorUserId: string;
    expectedVersion: number;
    idempotencyKey: string;
    reasonText?: string;
  }) {
    return this.db.transaction(async (tx) => {
      const db = tx as unknown as Db;
      const detail = await this.getMatch(input.matchId, db);
      if (!detail) {
        throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      }
      if (detail.kind !== "standalone" && detail.kind !== "tournament") {
        throw Object.assign(new Error("TOURNAMENT_MATCH_FORBIDDEN"), {
          code: "TOURNAMENT_MATCH_FORBIDDEN",
        });
      }
      await this.assertCanVoidMatch(detail, input.actorUserId, db);

      const storedKey = `void:${input.actorUserId}:${input.idempotencyKey}`;
      const keys = new Set<string>((detail.idempotencyKeys as string[]) ?? []);
      if (keys.has(storedKey)) return detail;
      if (detail.version !== input.expectedVersion) {
        throw Object.assign(new Error("VERSION_CONFLICT"), {
          code: "VERSION_CONFLICT",
          state: detail,
        });
      }
      if (detail.status !== "finished" && detail.status !== "stopped") {
        throw Object.assign(new Error("MATCH_NOT_VOIDABLE"), {
          code: "MATCH_NOT_VOIDABLE",
        });
      }

      keys.add(storedKey);
      const now = this.clock.now();
      const compensationEntries = detail.participants
        .filter((participant) => participant.userId && !participant.isTutorialActor)
        .map((participant) => ({
          userId: participant.userId!,
          winsDelta: participant.side === detail.winnerSide ? -1 : 0,
          lossesDelta: participant.side === detail.winnerSide ? 0 : -1,
        }));
      const rows = await db
        .update(matches)
        .set({
          status: "voided",
          version: input.expectedVersion + 1,
          idempotencyKeys: [...keys],
          updatedAt: now,
        })
        .where(
          and(
            eq(matches.id, input.matchId),
            eq(matches.version, input.expectedVersion),
            inArray(matches.status, ["finished", "stopped"]),
          ),
        )
        .returning();
      if (rows.length === 0) {
        const current = await this.getMatch(input.matchId, db);
        const currentKeys = new Set<string>(
          (current?.idempotencyKeys as string[]) ?? [],
        );
        if (current && currentKeys.has(storedKey)) return current;
        throw Object.assign(new Error("VERSION_CONFLICT"), {
          code: "VERSION_CONFLICT",
          state: current,
        });
      }

      await this.reverseStats(detail, db);
      await db.insert(matchVoidAudits).values({
        matchId: input.matchId,
        actorUserId: input.actorUserId,
        idempotencyKey: input.idempotencyKey,
        priorStatus: detail.status,
        priorVersion: detail.version,
        priorResult: {
          scoreA: detail.scoreA,
          scoreB: detail.scoreB,
          winnerSide: detail.winnerSide,
          finishReason: detail.finishReason,
          stopReasonCode: detail.stopReasonCode,
          stopReasonText: detail.stopReasonText,
          startedAt: detail.startedAt?.toISOString() ?? null,
          finishedAt: detail.finishedAt?.toISOString() ?? null,
        },
        priorEventLog: detail.eventLog,
        reasonText: input.reasonText?.trim() || null,
        compensation: {
          applied: Boolean(detail.winnerSide),
          entries: compensationEntries,
          rankingScopes: ["all_time", "week", "month"],
          ...(detail.kind === "tournament"
            ? {
                tournamentPolicy: "preserve_bracket_and_downstream",
                tournamentId: detail.tournamentId,
                tournamentBracketMatchId: detail.tournamentBracketMatchId,
              }
            : {}),
        },
        createdAt: now,
      });

      return this.getMatch(input.matchId, db);
    });
  }

  /** Admin ops (D15 narrowed by D19/D24): purge non-finished standalone only. */
  async adminDeleteMatch(input: { matchId: string; actorAdminId: string }) {
    const detail = await this.getMatch(input.matchId);
    if (!detail) {
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    }
    if (detail.kind !== "standalone") {
      throw Object.assign(new Error("TOURNAMENT_MATCH_FORBIDDEN"), {
        code: "TOURNAMENT_MATCH_FORBIDDEN",
      });
    }

    if (
      detail.status === "finished" ||
      detail.status === "stopped" ||
      detail.status === "voided"
    ) {
      throw Object.assign(new Error("MATCH_IMMUTABLE"), {
        code: "MATCH_IMMUTABLE",
      });
    }

    await this.db.transaction(async (tx) => {
      await tx
        .delete(judgeSessions)
        .where(eq(judgeSessions.matchId, input.matchId));
      await tx
        .delete(matchParticipants)
        .where(eq(matchParticipants.matchId, input.matchId));
      await tx.delete(matches).where(eq(matches.id, input.matchId));
    });
    return { ok: true as const };
  }

  private async reverseStats(
    match: NonNullable<Awaited<ReturnType<MatchService["getMatch"]>>>,
    db: Db = this.db,
  ) {
    if (!match.winnerSide) return;
    const winners = match.participants.filter((p) => p.side === match.winnerSide);
    const losers = match.participants.filter((p) => p.side !== match.winnerSide);
    for (const w of winners) {
      if (!w.userId || w.isTutorialActor) continue;
      await this.bumpStats(w.userId, true, -1, db);
    }
    for (const l of losers) {
      if (!l.userId || l.isTutorialActor) continue;
      await this.bumpStats(l.userId, false, -1, db);
    }
  }

  private async bumpStats(
    userId: string,
    won: boolean,
    delta = 1,
    db: Db = this.db,
  ) {
    const now = this.clock.now();
    const winDelta = won ? delta : 0;
    const lossDelta = won ? 0 : delta;
    if (delta < 0) {
      await db
        .update(userStats)
        .set({
          winsAllTime: sql`greatest(0, ${userStats.winsAllTime} + ${winDelta})`,
          lossesAllTime: sql`greatest(0, ${userStats.lossesAllTime} + ${lossDelta})`,
          winsWeek: sql`greatest(0, ${userStats.winsWeek} + ${winDelta})`,
          winsMonth: sql`greatest(0, ${userStats.winsMonth} + ${winDelta})`,
          updatedAt: now,
        })
        .where(eq(userStats.userId, userId));
      return;
    }
    await db
      .insert(userStats)
      .values({
        userId,
        winsAllTime: winDelta,
        lossesAllTime: lossDelta,
        winsWeek: winDelta,
        winsMonth: winDelta,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userStats.userId,
        set: {
          winsAllTime: sql`${userStats.winsAllTime} + ${winDelta}`,
          lossesAllTime: sql`${userStats.lossesAllTime} + ${lossDelta}`,
          winsWeek: sql`${userStats.winsWeek} + ${winDelta}`,
          winsMonth: sql`${userStats.winsMonth} + ${winDelta}`,
          updatedAt: now,
        },
      });
  }
}
