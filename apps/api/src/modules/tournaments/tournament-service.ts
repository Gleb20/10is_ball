import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import {
  applyBracketResult,
  applyMatchResult,
  attachMatchId,
  generateDoubleEliminationV2,
  generateSingleEliminationV2,
  getMatchSides,
  isBracketGraphComplete,
  isInvitationExpired,
  isTournamentComplete,
  listMatchPairs,
  listReadyMatchIds,
  pairNeedsMatch,
  propagateByesFixpoint,
  randomAvatarKey,
  seedParticipants,
  TOURNAMENT_INVITATION_TTL_MS,
  type Bracket,
  type BracketGraphV2,
} from "@tab10/shared";
import { randomBytes } from "node:crypto";
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
import { loadTournamentBracket, swapV2MatchSeeds } from "./bracket-load.js";

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
    const thirdPlaceEnabled =
      input.format === "double_elimination" ? false : true;
    const [row] = await this.db
      .insert(tournaments)
      .values({
        title: input.title,
        format: input.format,
        createdByUserId: input.createdByUserId,
        defaultJudgeUserId: input.defaultJudgeUserId ?? input.createdByUserId,
        organizerParticipates,
        thirdPlaceEnabled,
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

    const invitations = await this.db.query.tournamentInvitations.findMany({
      where: eq(tournamentInvitations.tournamentId, id),
    });
    const inviteUserIds = [
      ...new Set(invitations.map((i) => i.invitedUserId)),
    ];
    const inviteUsers =
      inviteUserIds.length > 0
        ? await this.db.query.users.findMany({
            where: inArray(users.id, inviteUserIds),
          })
        : [];
    const inviteUsersById = new Map(inviteUsers.map((u) => [u.id, u]));

    return {
      ...t,
      participants: participants.map((p) => ({
        ...p,
        displayName: participantDisplayName(p, usersById),
        avatarKey: p.userId
          ? (usersById.get(p.userId)?.generatedAvatarKey ?? null)
          : (p.guestAvatarKey ?? null),
      })),
      invitations: invitations
        .filter((i) => i.status === "pending" || i.status === "declined")
        .map((i) => {
          const u = inviteUsersById.get(i.invitedUserId);
          return {
            id: i.id,
            status: i.status,
            invitedUserId: i.invitedUserId,
            displayName: u
              ? `${u.lastName} ${u.firstName}`.trim()
              : "Игрок",
            avatarKey: u?.generatedAvatarKey ?? null,
            expiresAt: i.expiresAt,
            respondedAt: i.respondedAt,
          };
        }),
      matches: tournamentMatches,
    };
  }

  /** Organizer removes a declined (or pending) invitation so they can re-invite. */
  async cancelInvitation(input: {
    tournamentId: string;
    invitationId: string;
    actorUserId: string;
  }) {
    const t = await this.get(input.tournamentId);
    if (!t) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (t.createdByUserId !== input.actorUserId) {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
    const inv = await this.db.query.tournamentInvitations.findFirst({
      where: and(
        eq(tournamentInvitations.id, input.invitationId),
        eq(tournamentInvitations.tournamentId, input.tournamentId),
      ),
    });
    if (!inv) {
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    }
    if (inv.status !== "declined" && inv.status !== "pending") {
      throw Object.assign(new Error("INVALID_STATUS"), {
        code: "INVALID_STATUS",
      });
    }
    await this.db
      .delete(tournamentInvitations)
      .where(eq(tournamentInvitations.id, inv.id));
    return { ok: true };
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
    // Mark related notifications read so home badge stays in sync
    const userNotifs = await this.db.query.notifications.findMany({
      where: eq(notifications.userId, input.userId),
    });
    const readAt = this.clock.now();
    for (const n of userNotifs) {
      const payload = (n.payload ?? {}) as { invitationId?: string };
      if (
        n.type === "tournament_invitation" &&
        payload.invitationId === inv.id &&
        !n.readAt
      ) {
        await this.db
          .update(notifications)
          .set({ readAt })
          .where(eq(notifications.id, n.id));
      }
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

    const thirdPlaceEnabled =
      t.format === "double_elimination"
        ? false
        : (t.thirdPlaceEnabled ?? true);

    const bracket: BracketGraphV2 =
      t.format === "double_elimination"
        ? generateDoubleEliminationV2({ seedOrder: seeded })
        : generateSingleEliminationV2({
            seedOrder: seeded,
            thirdPlaceEnabled,
          });

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
        thirdPlaceEnabled,
        bracketStateVersion: sql`${tournaments.bracketStateVersion} + 1`,
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
        bracketStateVersion: sql`${tournaments.bracketStateVersion} + 1`,
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
    const loaded = loadTournamentBracket(t.bracketJson);

    if (loaded.kind === "v1") {
      const bracket = loaded.bracket;
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
        .set({
          bracketJson: next,
          bracketStateVersion: sql`${tournaments.bracketStateVersion} + 1`,
          updatedAt: this.clock.now(),
        })
        .where(eq(tournaments.id, tournamentId))
        .returning();
      return { ...row, bracket: next };
    }

    let next = loaded.graph;
    for (const swap of swaps) {
      next = swapV2MatchSeeds(next, swap.slotIdA, swap.slotIdB);
    }
    const [row] = await this.db
      .update(tournaments)
      .set({
        bracketJson: next,
        bracketStateVersion: sql`${tournaments.bracketStateVersion} + 1`,
        updatedAt: this.clock.now(),
      })
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

    const loaded = loadTournamentBracket(t.bracketJson);
    const pendingNotifs: Array<{
      userId: string;
      matchId: string;
    }> = [];

    if (loaded.kind === "v1") {
      const bracket = await this.materializeReadyMatchesV1(t, loaded.bracket, {
        collectNotifs: pendingNotifs,
      });
      await this.db
        .update(tournaments)
        .set({
          status: "in_progress",
          startedAt: this.clock.now(),
          bracketJson: bracket,
          bracketStateVersion: sql`${tournaments.bracketStateVersion} + 1`,
          updatedAt: this.clock.now(),
        })
        .where(eq(tournaments.id, tournamentId));
    } else {
      const graph = await this.materializeReadyMatchesV2(
        t,
        loaded.graph,
        this.db,
        pendingNotifs,
      );
      const version = t.bracketStateVersion ?? 0;
      const updated = await this.db
        .update(tournaments)
        .set({
          status: "in_progress",
          startedAt: this.clock.now(),
          bracketJson: graph,
          bracketStateVersion: version + 1,
          updatedAt: this.clock.now(),
        })
        .where(
          and(
            eq(tournaments.id, tournamentId),
            eq(tournaments.bracketStateVersion, version),
          ),
        )
        .returning();
      if (updated.length === 0) {
        throw Object.assign(new Error("BRACKET_VERSION_CONFLICT"), {
          code: "BRACKET_VERSION_CONFLICT",
        });
      }
    }

    for (const n of pendingNotifs) {
      await this.db.insert(notifications).values({
        userId: n.userId,
        type: "tournament_match_ready",
        title: "Матч турнира готов",
        body: `Ваш матч в «${t.title}» можно судить`,
        payload: { tournamentId: t.id, matchId: n.matchId },
      });
    }

    return this.get(tournamentId);
  }

  private async materializeReadyMatchesV1(
    t: NonNullable<Awaited<ReturnType<TournamentService["get"]>>>,
    bracket: Bracket,
    opts?: {
      db?: Db;
      collectNotifs?: Array<{ userId: string; matchId: string }>;
    },
  ): Promise<Bracket> {
    const db = opts?.db ?? this.db;
    let next = bracket;
    const partsById = new Map(t.participants.map((p) => [p.id, p]));
    const pairs = listMatchPairs(next).filter(pairNeedsMatch);

    for (const pair of pairs) {
      await this.assertPlayersFree(
        [pair.slotA.participantId!, pair.slotB.participantId!],
        db,
      );
      const pA = partsById.get(pair.slotA.participantId!);
      const pB = partsById.get(pair.slotB.participantId!);
      if (!pA || !pB) continue;

      const match = await this.matchService.createMatch(
        {
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
        },
        db,
      );

      next = attachMatchId(next, [pair.slotA.id, pair.slotB.id], match!.id);

      for (const p of [pA, pB]) {
        if (p.userId) {
          if (opts?.collectNotifs) {
            opts.collectNotifs.push({ userId: p.userId, matchId: match!.id });
          } else {
            await db.insert(notifications).values({
              userId: p.userId,
              type: "tournament_match_ready",
              title: "Матч турнира готов",
              body: `Ваш матч в «${t.title}» можно судить`,
              payload: { tournamentId: t.id, matchId: match!.id },
            });
          }
        }
      }
    }

    if (!opts?.db) {
      await this.db
        .update(tournaments)
        .set({ bracketJson: next, updatedAt: this.clock.now() })
        .where(eq(tournaments.id, t.id));
    }

    return next;
  }

  private async materializeReadyMatchesV2(
    t: NonNullable<Awaited<ReturnType<TournamentService["get"]>>>,
    graph: BracketGraphV2,
    db: Db,
    collectNotifs: Array<{ userId: string; matchId: string }>,
  ): Promise<BracketGraphV2> {
    let next = propagateByesFixpoint(graph);
    const partsById = new Map(t.participants.map((p) => [p.id, p]));

    // Idempotent: skip nodes that already have actualMatchId
    const readyIds = listReadyMatchIds(next).filter((id) => {
      const m = next.matches.find((x) => x.id === id);
      return Boolean(m && !m.actualMatchId);
    });

    for (const matchId of readyIds) {
      const node = next.matches.find((m) => m.id === matchId)!;
      const sides = getMatchSides(next, node);
      if (sides.a.kind !== "resolved" || sides.b.kind !== "resolved") continue;

      await this.assertPlayersFree(
        [sides.a.participantId, sides.b.participantId],
        db,
      );
      const pA = partsById.get(sides.a.participantId);
      const pB = partsById.get(sides.b.participantId);
      if (!pA || !pB) continue;

      const match = await this.matchService.createMatch(
        {
          createdByUserId: t.createdByUserId,
          title: `${t.title} · ${node.stage} ${node.id}`,
          format: "1v1",
          pointsToWin: t.pointsToWin,
          mercyEnabled: t.mercyEnabled,
          mercyPoints: t.mercyPoints,
          kind: "tournament",
          tournamentId: t.id,
          tournamentSlotId: node.id,
          tournamentBracketMatchId: node.id,
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
        },
        db,
      );

      next = {
        ...next,
        matches: next.matches.map((m) =>
          m.id === node.id ? { ...m, actualMatchId: match!.id } : m,
        ),
      };

      for (const p of [pA, pB]) {
        if (p.userId) {
          collectNotifs.push({ userId: p.userId, matchId: match!.id });
        }
      }
    }

    return next;
  }

  private async assertPlayersFree(
    participantIds: string[],
    db: Db = this.db,
  ) {
    const parts = await db.query.tournamentParticipants.findMany({
      where: inArray(tournamentParticipants.id, participantIds),
    });
    const userIds = parts
      .map((p) => p.userId)
      .filter((id): id is string => Boolean(id));
    if (userIds.length === 0) return;

    const active = await db
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

    let loaded;
    try {
      loaded = loadTournamentBracket(t.bracketJson);
    } catch {
      return;
    }

    const winnerSide = match.winnerSide as "A" | "B" | null;
    if (!winnerSide) return;

    const winnerPart = match.participants.find((p) => p.side === winnerSide);
    const loserPart = match.participants.find((p) => p.side !== winnerSide);
    if (!winnerPart || !loserPart) return;

    const pendingNotifs: Array<{ userId: string; matchId: string }> = [];

    if (loaded.kind === "v1") {
      if (!match.tournamentSlotId) return;
      const slotIds = match.tournamentSlotId.split(",") as [string, string];
      const bracket = loaded.bracket;
      const slotA = bracket.slots.find((s) => s.id === slotIds[0]);
      const slotB = bracket.slots.find((s) => s.id === slotIds[1]);
      if (!slotA || !slotB) return;

      const winnerTournamentParticipantId = this.resolveTournamentParticipant(
        slotA,
        slotB,
        winnerPart,
        t.participants,
      );
      const loserTournamentParticipantId = this.resolveTournamentParticipant(
        slotA,
        slotB,
        loserPart,
        t.participants,
      );
      if (!winnerTournamentParticipantId || !loserTournamentParticipantId) {
        return;
      }

      let next = applyMatchResult(
        bracket,
        slotIds,
        winnerTournamentParticipantId,
        loserTournamentParticipantId,
        matchId,
      );

      next = await this.materializeReadyMatchesV1(
        { ...t, bracketJson: next },
        next,
        { collectNotifs: pendingNotifs },
      );

      const complete = isTournamentComplete(next);
      await this.db
        .update(tournaments)
        .set({
          bracketJson: next,
          bracketStateVersion: sql`${tournaments.bracketStateVersion} + 1`,
          ...(complete
            ? {
                status: "finished",
                finishedAt: this.clock.now(),
              }
            : {}),
          updatedAt: this.clock.now(),
        })
        .where(eq(tournaments.id, t.id));

      if (complete && next.championParticipantId) {
        const champ = t.participants.find(
          (p) => p.id === next.championParticipantId,
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
    } else {
      const bracketMatchId =
        match.tournamentBracketMatchId ?? match.tournamentSlotId;
      if (!bracketMatchId) return;

      const node = loaded.graph.matches.find((m) => m.id === bracketMatchId);
      if (!node) return;

      const sides = getMatchSides(loaded.graph, node);
      if (sides.a.kind !== "resolved" || sides.b.kind !== "resolved") return;

      const winnerTournamentParticipantId =
        winnerSide === "A" ? sides.a.participantId : sides.b.participantId;
      const loserTournamentParticipantId =
        winnerSide === "A" ? sides.b.participantId : sides.a.participantId;

      let next = applyBracketResult(loaded.graph, {
        bracketMatchId,
        winnerParticipantId: winnerTournamentParticipantId,
        loserParticipantId: loserTournamentParticipantId,
        actualMatchId: matchId,
      });

      const version = t.bracketStateVersion ?? 0;
      next = await this.materializeReadyMatchesV2(
        { ...t, bracketJson: next },
        next,
        this.db,
        pendingNotifs,
      );
      const complete = isBracketGraphComplete(next);
      const champId = next.championParticipantId;
      const updated = await this.db
        .update(tournaments)
        .set({
          bracketJson: next,
          bracketStateVersion: version + 1,
          ...(complete
            ? {
                status: "finished",
                finishedAt: this.clock.now(),
              }
            : {}),
          updatedAt: this.clock.now(),
        })
        .where(
          and(
            eq(tournaments.id, t.id),
            eq(tournaments.bracketStateVersion, version),
          ),
        )
        .returning();
      if (updated.length === 0) {
        throw Object.assign(new Error("BRACKET_VERSION_CONFLICT"), {
          code: "BRACKET_VERSION_CONFLICT",
        });
      }

      if (complete && champId) {
        const champ = t.participants.find((p) => p.id === champId);
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

    for (const n of pendingNotifs) {
      await this.db.insert(notifications).values({
        userId: n.userId,
        type: "tournament_match_ready",
        title: "Матч турнира готов",
        body: `Ваш матч в «${t.title}» можно судить`,
        payload: { tournamentId: t.id, matchId: n.matchId },
      });
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
