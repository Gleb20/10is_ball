import { and, eq, inArray, ne, or } from "drizzle-orm";
import {
  applyMatchResult,
  attachMatchId,
  generateDoubleEliminationBracket,
  generateSingleEliminationBracket,
  isInvitationExpired,
  isTournamentComplete,
  listMatchPairs,
  pairNeedsMatch,
  randomAvatarKey,
  seedParticipants,
  TOURNAMENT_INVITATION_TTL_MS,
  type Bracket,
} from "@tab10/shared";
import { randomBytes, randomUUID } from "node:crypto";
import type { Clock } from "@tab10/test-utils";
import type { Db } from "../../db/client.js";
import {
  matches,
  matchParticipants,
  notifications,
  tournamentInvitations,
  tournamentParticipants,
  tournaments,
  users,
  userStats,
} from "../../db/schema.js";
import type { MatchService } from "../matches/match-service.js";

type ActiveParticipant = typeof tournamentParticipants.$inferSelect;

function participantDisplayName(
  p: ActiveParticipant,
  usersById: Map<string, { firstName: string; lastName: string }>,
): string {
  if (p.userId) {
    const u = usersById.get(p.userId);
    if (u) return `${u.lastName} ${u.firstName}`.trim();
  }
  const guest = [p.guestFirstName, p.guestLastName].filter(Boolean).join(" ");
  return guest || "Участник";
}

export class TournamentService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly matchService: MatchService,
  ) {}

  async create(input: {
    title: string;
    format: "single_elimination" | "double_elimination";
    createdByUserId: string;
    defaultJudgeUserId?: string;
    organizerParticipates?: boolean;
    pointsToWin?: number;
    mercyEnabled?: boolean;
    mercyPoints?: number | null;
  }) {
    const organizerParticipates = input.organizerParticipates ?? true;
    const [row] = await this.db
      .insert(tournaments)
      .values({
        title: input.title,
        format: input.format,
        createdByUserId: input.createdByUserId,
        defaultJudgeUserId: input.defaultJudgeUserId ?? input.createdByUserId,
        organizerParticipates,
        pointsToWin: input.pointsToWin ?? 11,
        mercyEnabled: input.mercyEnabled ?? true,
        mercyPoints:
          input.mercyPoints !== undefined
            ? input.mercyPoints
            : (input.pointsToWin ?? 11) === 21
              ? 10
              : 5,
        status: "collecting",
      })
      .returning();

    if (organizerParticipates && row) {
      const stats = await this.db.query.userStats.findFirst({
        where: eq(userStats.userId, input.createdByUserId),
      });
      await this.db.insert(tournamentParticipants).values({
        tournamentId: row.id,
        userId: input.createdByUserId,
        winsSnapshot: stats?.winsAllTime ?? 0,
        status: "active",
      });
    }
    return this.get(row!.id);
  }

  async patch(
    tournamentId: string,
    actorUserId: string,
    patch: {
      title?: string;
      format?: "single_elimination" | "double_elimination";
      organizerParticipates?: boolean;
      pointsToWin?: number;
      mercyEnabled?: boolean;
      mercyPoints?: number | null;
    },
  ) {
    const t = await this.get(tournamentId);
    if (!t) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (t.createdByUserId !== actorUserId) {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
    if (
      t.status === "in_progress" ||
      t.status === "finished" ||
      t.status === "stopped"
    ) {
      throw Object.assign(new Error("TOURNAMENT_ALREADY_STARTED"), {
        code: "TOURNAMENT_ALREADY_STARTED",
      });
    }
    const [row] = await this.db
      .update(tournaments)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.format !== undefined ? { format: patch.format } : {}),
        ...(patch.organizerParticipates !== undefined
          ? { organizerParticipates: patch.organizerParticipates }
          : {}),
        ...(patch.pointsToWin !== undefined
          ? { pointsToWin: patch.pointsToWin }
          : {}),
        ...(patch.mercyEnabled !== undefined
          ? { mercyEnabled: patch.mercyEnabled }
          : {}),
        ...(patch.mercyPoints !== undefined
          ? { mercyPoints: patch.mercyPoints }
          : {}),
        updatedAt: this.clock.now(),
      })
      .where(eq(tournaments.id, tournamentId))
      .returning();
    return row;
  }

  playingParticipants(t: {
    participants: ActiveParticipant[];
    createdByUserId: string;
    organizerParticipates: boolean;
  }) {
    return t.participants.filter((p) => {
      if (p.status && p.status !== "active") return false;
      if (
        !t.organizerParticipates &&
        p.userId &&
        p.userId === t.createdByUserId
      ) {
        return false;
      }
      return true;
    });
  }

  async addParticipant(input: {
    tournamentId: string;
    userId?: string;
    guestFirstName?: string;
    guestLastName?: string;
  }) {
    const t = await this.get(input.tournamentId);
    if (!t) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (t.status !== "collecting" && t.status !== "needs_regeneration") {
      throw Object.assign(new Error("INVALID_STATUS"), {
        code: "INVALID_STATUS",
        message: "Roster closed after bracket generation",
      });
    }
    const active = t.participants.filter((p) => p.status === "active");
    if (active.length >= 64) {
      throw Object.assign(new Error("TOO_MANY"), { code: "TOO_MANY" });
    }
    if (
      input.userId &&
      active.some((p) => p.userId === input.userId)
    ) {
      throw Object.assign(new Error("ALREADY_IN_TOURNAMENT"), {
        code: "ALREADY_IN_TOURNAMENT",
      });
    }
    let winsSnapshot = 0;
    if (input.userId) {
      const stats = await this.db.query.userStats.findFirst({
        where: eq(userStats.userId, input.userId),
      });
      winsSnapshot = stats?.winsAllTime ?? 0;
    }
    const [row] = await this.db
      .insert(tournamentParticipants)
      .values({
        tournamentId: input.tournamentId,
        userId: input.userId,
        guestFirstName: input.guestFirstName,
        guestLastName: input.guestLastName,
        guestAvatarKey:
          !input.userId && (input.guestFirstName || input.guestLastName)
            ? randomAvatarKey(randomBytes(1)[0]!)
            : null,
        winsSnapshot,
        status: "active",
      })
      .returning();
    return row;
  }

  async removeParticipant(input: {
    tournamentId: string;
    participantId: string;
    actorUserId: string;
  }) {
    const t = await this.get(input.tournamentId);
    if (!t) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (t.createdByUserId !== input.actorUserId) {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
    if (
      t.status !== "collecting" &&
      t.status !== "needs_regeneration" &&
      t.status !== "bracket_generated"
    ) {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "INVALID_STATUS" });
    }
    await this.db
      .update(tournamentParticipants)
      .set({ status: "withdrawn" })
      .where(eq(tournamentParticipants.id, input.participantId));
    if (t.status === "bracket_generated") {
      await this.db
        .update(tournaments)
        .set({
          status: "needs_regeneration",
          updatedAt: this.clock.now(),
        })
        .where(eq(tournaments.id, input.tournamentId));
    }
    return { ok: true };
  }

  async withdraw(input: {
    tournamentId: string;
    userId: string;
  }) {
    const t = await this.get(input.tournamentId);
    if (!t) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    const part = t.participants.find(
      (p) => p.userId === input.userId && p.status === "active",
    );
    if (!part) {
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    }
    if (
      t.status === "in_progress" ||
      t.status === "finished" ||
      t.status === "stopped"
    ) {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "INVALID_STATUS" });
    }
    await this.db
      .update(tournamentParticipants)
      .set({ status: "withdrawn" })
      .where(eq(tournamentParticipants.id, part.id));
    if (t.status === "bracket_generated") {
      await this.db
        .update(tournaments)
        .set({
          status: "needs_regeneration",
          updatedAt: this.clock.now(),
        })
        .where(eq(tournaments.id, input.tournamentId));
    }
    return this.get(input.tournamentId);
  }

  async get(id: string) {
    const t = await this.db.query.tournaments.findFirst({
      where: eq(tournaments.id, id),
    });
    if (!t) return null;
    let participants = await this.db.query.tournamentParticipants.findMany({
      where: eq(tournamentParticipants.tournamentId, id),
    });

    // Heal older tournaments: organizerParticipates but missing from roster
    if (
      t.organizerParticipates &&
      (t.status === "collecting" || t.status === "needs_regeneration") &&
      !participants.some(
        (p) => p.userId === t.createdByUserId && p.status === "active",
      )
    ) {
      const stats = await this.db.query.userStats.findFirst({
        where: eq(userStats.userId, t.createdByUserId),
      });
      await this.db.insert(tournamentParticipants).values({
        tournamentId: id,
        userId: t.createdByUserId,
        winsSnapshot: stats?.winsAllTime ?? 0,
        status: "active",
      });
      participants = await this.db.query.tournamentParticipants.findMany({
        where: eq(tournamentParticipants.tournamentId, id),
      });
    }

    const userIds = participants
      .map((p) => p.userId)
      .filter((uid): uid is string => Boolean(uid));
    const userRows =
      userIds.length > 0
        ? await this.db.query.users.findMany({
            where: inArray(users.id, userIds),
          })
        : [];
    const usersById = new Map(userRows.map((u) => [u.id, u]));

    const tournamentMatches = await this.db.query.matches.findMany({
      where: eq(matches.tournamentId, id),
    });

    return {
      ...t,
      participants: participants.map((p) => ({
        ...p,
        displayName: participantDisplayName(p, usersById),
        avatarKey: p.userId
          ? (usersById.get(p.userId)?.generatedAvatarKey ?? null)
          : (p.guestAvatarKey ?? null),
      })),
      matches: tournamentMatches,
    };
  }

  async list() {
    return this.db.query.tournaments.findMany();
  }

  async invite(input: {
    tournamentId: string;
    invitedUserId: string;
    invitedByUserId: string;
  }) {
    const t = await this.get(input.tournamentId);
    if (!t) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (t.createdByUserId !== input.invitedByUserId) {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
    if (t.status !== "collecting" && t.status !== "needs_regeneration") {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "INVALID_STATUS" });
    }
    const now = this.clock.now();
    const [inv] = await this.db
      .insert(tournamentInvitations)
      .values({
        tournamentId: input.tournamentId,
        invitedUserId: input.invitedUserId,
        invitedByUserId: input.invitedByUserId,
        expiresAt: new Date(now.getTime() + TOURNAMENT_INVITATION_TTL_MS),
        status: "pending",
      })
      .returning();
    await this.db.insert(notifications).values({
      userId: input.invitedUserId,
      type: "tournament_invitation",
      title: "Приглашение в турнир",
      body: `Вас пригласили в турнир «${t.title}»`,
      payload: { invitationId: inv!.id, tournamentId: t.id },
    });
    return inv;
  }

  async respondInvitation(input: {
    invitationId: string;
    userId: string;
    accept: boolean;
  }) {
    const inv = await this.db.query.tournamentInvitations.findFirst({
      where: eq(tournamentInvitations.id, input.invitationId),
    });
    if (!inv || inv.invitedUserId !== input.userId) {
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    }
    const now = this.clock.now().getTime();
    if (
      inv.status !== "pending" ||
      isInvitationExpired(
        inv.createdAt.getTime(),
        now,
        TOURNAMENT_INVITATION_TTL_MS,
      )
    ) {
      await this.db
        .update(tournamentInvitations)
        .set({ status: "expired" })
        .where(eq(tournamentInvitations.id, inv.id));
      throw Object.assign(new Error("EXPIRED"), { code: "EXPIRED" });
    }
    const status = input.accept ? "accepted" : "declined";
    await this.db
      .update(tournamentInvitations)
      .set({ status, respondedAt: this.clock.now() })
      .where(eq(tournamentInvitations.id, inv.id));
    if (input.accept) {
      await this.addParticipant({
        tournamentId: inv.tournamentId,
        userId: input.userId,
      });
    }
    return { status };
  }

  async generateBracket(tournamentId: string, rng: () => number = Math.random) {
    const t = await this.get(tournamentId);
    if (!t) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (t.status !== "collecting" && t.status !== "needs_regeneration") {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "INVALID_STATUS" });
    }
    const playing = this.playingParticipants(t);
    if (playing.length < 3) {
      throw Object.assign(new Error("TOO_FEW"), { code: "TOO_FEW" });
    }
    if (playing.length === 2) {
      throw Object.assign(new Error("USE_MATCH"), { code: "USE_MATCH" });
    }
    const seeded = seedParticipants(
      playing.map((p) => ({ id: p.id, wins: p.winsSnapshot })),
      rng,
    );
    const bracket =
      t.format === "double_elimination"
        ? generateDoubleEliminationBracket(seeded, () => randomUUID())
        : generateSingleEliminationBracket(seeded, () => randomUUID());

    for (let i = 0; i < seeded.length; i += 1) {
      await this.db
        .update(tournamentParticipants)
        .set({ seed: i + 1 })
        .where(eq(tournamentParticipants.id, seeded[i]!));
    }

    // Expire pending invites (AT-TRN-004)
    await this.db
      .update(tournamentInvitations)
      .set({ status: "expired" })
      .where(
        and(
          eq(tournamentInvitations.tournamentId, tournamentId),
          eq(tournamentInvitations.status, "pending"),
        ),
      );

    const [row] = await this.db
      .update(tournaments)
      .set({
        status: "bracket_generated",
        bracketJson: bracket,
        updatedAt: this.clock.now(),
      })
      .where(eq(tournaments.id, tournamentId))
      .returning();
    return { ...row, participants: t.participants, bracket };
  }

  async dissolveBracket(tournamentId: string, actorUserId: string) {
    const t = await this.get(tournamentId);
    if (!t) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (t.createdByUserId !== actorUserId) {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
    if (
      t.status !== "bracket_generated" &&
      t.status !== "needs_regeneration"
    ) {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "INVALID_STATUS" });
    }
    const [row] = await this.db
      .update(tournaments)
      .set({
        status: "collecting",
        bracketJson: null,
        updatedAt: this.clock.now(),
      })
      .where(eq(tournaments.id, tournamentId))
      .returning();
    return row;
  }

  async patchBracket(
    tournamentId: string,
    actorUserId: string,
    swaps: Array<{ slotIdA: string; slotIdB: string }>,
  ) {
    const t = await this.get(tournamentId);
    if (!t) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (t.createdByUserId !== actorUserId) {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
    if (t.status !== "bracket_generated") {
      throw Object.assign(new Error("BRACKET_NOT_EDITABLE"), {
        code: "BRACKET_NOT_EDITABLE",
      });
    }
    const bracket = t.bracketJson as Bracket;
    if (!bracket?.slots) {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "INVALID_STATUS" });
    }
    const slots = bracket.slots.map((s) => ({ ...s }));
    const byId = new Map(slots.map((s) => [s.id, s]));
    for (const swap of swaps) {
      const a = byId.get(swap.slotIdA);
      const b = byId.get(swap.slotIdB);
      if (!a || !b) continue;
      const tmp = a.participantId;
      a.participantId = b.participantId;
      b.participantId = tmp;
      const byeA = a.isBye;
      a.isBye = b.isBye;
      b.isBye = byeA;
    }
    const next = { ...bracket, slots };
    const [row] = await this.db
      .update(tournaments)
      .set({ bracketJson: next, updatedAt: this.clock.now() })
      .where(eq(tournaments.id, tournamentId))
      .returning();
    return { ...row, bracket: next };
  }

  async start(tournamentId: string, actorUserId: string) {
    const t = await this.get(tournamentId);
    if (!t) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (t.createdByUserId !== actorUserId) {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
    if (t.status === "needs_regeneration") {
      throw Object.assign(new Error("BRACKET_REGEN_REQUIRED"), {
        code: "BRACKET_REGEN_REQUIRED",
      });
    }
    if (t.status !== "bracket_generated") {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "INVALID_STATUS" });
    }
    let bracket = t.bracketJson as Bracket;
    if (!bracket) {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "INVALID_STATUS" });
    }

    bracket = await this.materializeReadyMatches(t, bracket);

    const [row] = await this.db
      .update(tournaments)
      .set({
        status: "in_progress",
        startedAt: this.clock.now(),
        bracketJson: bracket,
        updatedAt: this.clock.now(),
      })
      .where(eq(tournaments.id, tournamentId))
      .returning();
    return this.get(tournamentId);
  }

  private async materializeReadyMatches(
    t: NonNullable<Awaited<ReturnType<TournamentService["get"]>>>,
    bracket: Bracket,
  ): Promise<Bracket> {
    let next = bracket;
    const partsById = new Map(t.participants.map((p) => [p.id, p]));
    const pairs = listMatchPairs(next).filter(pairNeedsMatch);

    for (const pair of pairs) {
      await this.assertPlayersFree([
        pair.slotA.participantId!,
        pair.slotB.participantId!,
      ]);
      const pA = partsById.get(pair.slotA.participantId!);
      const pB = partsById.get(pair.slotB.participantId!);
      if (!pA || !pB) continue;

      const match = await this.matchService.createMatch({
        createdByUserId: t.createdByUserId,
        title: `${t.title} · ${pair.side} R${pair.round}`,
        format: "1v1",
        pointsToWin: t.pointsToWin,
        mercyEnabled: t.mercyEnabled,
        mercyPoints: t.mercyPoints,
        kind: "tournament",
        tournamentId: t.id,
        tournamentSlotId: `${pair.slotA.id},${pair.slotB.id}`,
        participants: [
          {
            side: "A",
            userId: pA.userId ?? undefined,
            guestFirstName: pA.guestFirstName ?? undefined,
            guestLastName: pA.guestLastName ?? undefined,
            guestAvatarKey: pA.guestAvatarKey ?? undefined,
          },
          {
            side: "B",
            userId: pB.userId ?? undefined,
            guestFirstName: pB.guestFirstName ?? undefined,
            guestLastName: pB.guestLastName ?? undefined,
            guestAvatarKey: pB.guestAvatarKey ?? undefined,
          },
        ],
      });

      next = attachMatchId(next, [pair.slotA.id, pair.slotB.id], match!.id);

      // Notify participants with user accounts
      for (const p of [pA, pB]) {
        if (p.userId) {
          await this.db.insert(notifications).values({
            userId: p.userId,
            type: "tournament_match_ready",
            title: "Матч турнира готов",
            body: `Ваш матч в «${t.title}» можно судить`,
            payload: { tournamentId: t.id, matchId: match!.id },
          });
        }
      }
    }

    await this.db
      .update(tournaments)
      .set({ bracketJson: next, updatedAt: this.clock.now() })
      .where(eq(tournaments.id, t.id));

    return next;
  }

  private async assertPlayersFree(participantIds: string[]) {
    const parts = await this.db.query.tournamentParticipants.findMany({
      where: inArray(tournamentParticipants.id, participantIds),
    });
    const userIds = parts
      .map((p) => p.userId)
      .filter((id): id is string => Boolean(id));
    if (userIds.length === 0) return;

    const active = await this.db
      .select({ id: matches.id })
      .from(matches)
      .innerJoin(matchParticipants, eq(matchParticipants.matchId, matches.id))
      .where(
        and(
          inArray(matchParticipants.userId, userIds),
          or(
            eq(matches.status, "waiting"),
            eq(matches.status, "in_progress"),
            eq(matches.status, "pending_confirmation"),
          ),
          ne(matches.kind, "tutorial"),
        ),
      )
      .limit(1);
    if (active.length > 0) {
      throw Object.assign(new Error("PLAYER_ALREADY_IN_ACTIVE_MATCH"), {
        code: "PLAYER_ALREADY_IN_ACTIVE_MATCH",
      });
    }
  }

  async onMatchFinished(matchId: string) {
    const match = await this.matchService.getMatch(matchId);
    if (!match || match.kind !== "tournament" || !match.tournamentId) return;
    if (match.status !== "finished" && match.status !== "stopped") return;

    const t = await this.get(match.tournamentId);
    if (!t || t.status !== "in_progress") return;
    let bracket = t.bracketJson as Bracket;
    if (!bracket || !match.tournamentSlotId) return;

    const slotIds = match.tournamentSlotId.split(",") as [string, string];
    const winnerSide = match.winnerSide as "A" | "B" | null;
    if (!winnerSide) return;

    const winnerPart = match.participants.find((p) => p.side === winnerSide);
    const loserPart = match.participants.find((p) => p.side !== winnerSide);
    if (!winnerPart || !loserPart) return;

    // Map match participants back to tournament participant ids via slot
    const slotA = bracket.slots.find((s) => s.id === slotIds[0]);
    const slotB = bracket.slots.find((s) => s.id === slotIds[1]);
    if (!slotA || !slotB) return;

    const winnerTournamentParticipantId =
      this.resolveTournamentParticipant(
        slotA,
        slotB,
        winnerPart,
        t.participants,
      );
    const loserTournamentParticipantId =
      this.resolveTournamentParticipant(
        slotA,
        slotB,
        loserPart,
        t.participants,
      );
    if (!winnerTournamentParticipantId || !loserTournamentParticipantId) return;

    bracket = applyMatchResult(
      bracket,
      slotIds,
      winnerTournamentParticipantId,
      loserTournamentParticipantId,
      matchId,
    );

    bracket = await this.materializeReadyMatches(
      { ...t, bracketJson: bracket },
      bracket,
    );

    const complete = isTournamentComplete(bracket);
    await this.db
      .update(tournaments)
      .set({
        bracketJson: bracket,
        ...(complete
          ? {
              status: "finished",
              finishedAt: this.clock.now(),
            }
          : {}),
        updatedAt: this.clock.now(),
      })
      .where(eq(tournaments.id, t.id));

    if (complete && bracket.championParticipantId) {
      const champ = t.participants.find(
        (p) => p.id === bracket.championParticipantId,
      );
      if (champ?.userId) {
        await this.db.insert(notifications).values({
          userId: champ.userId,
          type: "tournament_finished",
          title: "Турнир завершён",
          body: `Вы победили в «${t.title}»`,
          payload: { tournamentId: t.id },
        });
      }
    }
  }

  private resolveTournamentParticipant(
    slotA: { participantId: string | null },
    slotB: { participantId: string | null },
    matchPart: {
      userId: string | null;
      guestFirstName: string | null;
      guestLastName: string | null;
    },
    all: ActiveParticipant[],
  ): string | null {
    for (const slotId of [slotA.participantId, slotB.participantId]) {
      if (!slotId) continue;
      const tp = all.find((p) => p.id === slotId);
      if (!tp) continue;
      if (matchPart.userId && tp.userId === matchPart.userId) return tp.id;
      if (
        !matchPart.userId &&
        tp.guestFirstName === matchPart.guestFirstName &&
        tp.guestLastName === matchPart.guestLastName
      ) {
        return tp.id;
      }
    }
    return slotA.participantId;
  }

  async stop(
    tournamentId: string,
    actorUserId: string,
    reason?: { code?: string; text?: string },
  ) {
    const t = await this.get(tournamentId);
    if (!t) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (t.createdByUserId !== actorUserId) {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
    if (t.status !== "in_progress") {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "INVALID_STATUS" });
    }

    // Cancel unplayed tournament matches
    await this.db
      .update(matches)
      .set({
        status: "cancelled",
        updatedAt: this.clock.now(),
        finishedAt: this.clock.now(),
      })
      .where(
        and(
          eq(matches.tournamentId, tournamentId),
          or(
            eq(matches.status, "waiting"),
            eq(matches.status, "in_progress"),
            eq(matches.status, "pending_confirmation"),
          ),
        ),
      );

    const [row] = await this.db
      .update(tournaments)
      .set({
        status: "stopped",
        stopReasonCode: reason?.code ?? "other",
        stopReasonText: reason?.text ?? null,
        finishedAt: this.clock.now(),
        updatedAt: this.clock.now(),
      })
      .where(eq(tournaments.id, tournamentId))
      .returning();
    return row;
  }

  /** Sum of game points scored by a tournament participant across finished matches (AT-TRN-013). */
  async participantPoints(tournamentId: string, tournamentParticipantId: string) {
    const t = await this.get(tournamentId);
    if (!t) return 0;
    const part = t.participants.find((p) => p.id === tournamentParticipantId);
    if (!part) return 0;
    let total = 0;
    for (const m of t.matches ?? []) {
      if (m.status !== "finished" && m.status !== "stopped") continue;
      const detail = await this.matchService.getMatch(m.id);
      if (!detail) continue;
      for (const mp of detail.participants) {
        const sameUser = part.userId && mp.userId === part.userId;
        const sameGuest =
          !part.userId &&
          mp.guestFirstName === part.guestFirstName &&
          mp.guestLastName === part.guestLastName;
        if (sameUser || sameGuest) {
          total += mp.side === "A" ? detail.scoreA : detail.scoreB;
        }
      }
    }
    return total;
  }
}
