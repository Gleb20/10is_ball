import { and, eq, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import {
  applyBracketResult,
  applyMatchResult,
  attachMatchId,
  detectStoredConstructionAlgorithm,
  getMatchSides,
  isBracketConstructionAlgorithm,
  isBracketGraphComplete,
  isTournamentComplete,
  listMatchPairs,
  listReadyMatchIds,
  pairNeedsMatch,
  parseBracketConstructionAlgorithm,
  prepareBracketGraph,
  propagateByesFixpoint,
  randomAvatarKey,
  resolveRequestedConstructionAlgorithm,
  seedParticipants,
  TOURNAMENT_INVITATION_TTL_MS,
  type Bracket,
  type BracketConstructionAlgorithm,
  type BracketGraphV2,
} from "@tab10/shared";
import { randomBytes } from "node:crypto";
import type { Clock } from "@tab10/test-utils";
import type { Db } from "../../db/client.js";
import {
  judgeSessions,
  matches,
  matchParticipants,
  notifications,
  teamMemberships,
  teams,
  tournamentInvitations,
  tournamentParticipants,
  tournaments,
  users,
  userStats,
} from "../../db/schema.js";
import type { MatchService } from "../matches/match-service.js";
import { markInvitationNotificationsRead } from "../notifications/notification-service.js";
import { loadTournamentBracket, swapSeedOrderByMatchIds } from "./bracket-load.js";

import { tournamentSummary } from "./tournament-summary.js";

type ActiveParticipant = typeof tournamentParticipants.$inferSelect;
const COMPLETED_TOURNAMENT_STATUSES = new Set([
  "finished",
  "stopped",
  "cancelled",
]);

function isActiveParticipant(p: { status?: string | null }): boolean {
  // Legacy rows / pre-migration Neon may omit status; treat as active.
  return !p.status || p.status === "active";
}

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

  private async closeInvitationNotifications(
    invitations: Array<{ id: string; invitedUserId: string }>,
    reasonCode: "event_cancelled" | "roster_closed",
    readAt: Date,
    db: Db,
  ) {
    for (const invitedUserId of new Set(
      invitations.map((invitation) => invitation.invitedUserId),
    )) {
      const invitationIds = invitations
        .filter((invitation) => invitation.invitedUserId === invitedUserId)
        .map((invitation) => invitation.id);
      await markInvitationNotificationsRead(db, {
        userId: invitedUserId,
        type: "tournament_invitation",
        invitationIds,
        readAt,
      });
      const idSet = new Set(invitationIds);
      const rows = await db.query.notifications.findMany({
        where: and(
          eq(notifications.userId, invitedUserId),
          eq(notifications.type, "tournament_invitation"),
        ),
      });
      for (const row of rows) {
        const payload = (row.payload ?? {}) as { invitationId?: string };
        if (!payload.invitationId || !idSet.has(payload.invitationId)) continue;
        await db
          .update(notifications)
          .set({ payload: { ...payload, reasonCode } })
          .where(eq(notifications.id, row.id));
      }
    }
  }

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
      try {
        const stats = await this.db.query.userStats.findFirst({
          where: eq(userStats.userId, input.createdByUserId),
        });
        await this.db.insert(tournamentParticipants).values({
          tournamentId: row.id,
          userId: input.createdByUserId,
          winsSnapshot: stats?.winsAllTime ?? 0,
          status: "active",
        });
      } catch (e) {
        // Avoid orphan collecting tournaments when roster insert fails
        // (e.g. Neon missing tournament_participants.status before migrate).
        await this.db.delete(tournaments).where(eq(tournaments.id, row.id));
        throw e;
      }
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
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      await db.select({ id: tournaments.id }).from(tournaments).where(eq(tournaments.id, tournamentId)).for("update");
    const t = await this.get(tournamentId, db);
    if (!t) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (t.createdByUserId !== actorUserId) {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
    if (
      t.status === "in_progress" ||
      t.status === "finished" ||
      t.status === "stopped" ||
      t.status === "cancelled"
    ) {
      throw Object.assign(new Error("TOURNAMENT_ALREADY_STARTED"), {
        code: "TOURNAMENT_ALREADY_STARTED",
      });
    }
    const invalidates = Boolean(t.bracketJson) && ((patch.format !== undefined && patch.format !== t.format) || (patch.organizerParticipates !== undefined && patch.organizerParticipates !== t.organizerParticipates));
    await db
      .update(tournaments)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.format !== undefined ? { format: patch.format, thirdPlaceEnabled: patch.format === "single_elimination" } : {}),
        ...(invalidates ? { status: "needs_regeneration" as const, bracketStateVersion: sql`${tournaments.bracketStateVersion} + 1` } : {}),
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

    if (patch.organizerParticipates === true) {
      const onRoster = t.participants.some(
        (p) => p.userId === actorUserId && isActiveParticipant(p),
      );
      if (!onRoster) {
        const stats = await db.query.userStats.findFirst({
          where: eq(userStats.userId, actorUserId),
        });
        const withdrawn = t.participants.find(
          (p) => p.userId === actorUserId && p.status === "withdrawn",
        );
        if (withdrawn) {
          await db
            .update(tournamentParticipants)
            .set({ status: "active" })
            .where(eq(tournamentParticipants.id, withdrawn.id));
        } else {
          await db.insert(tournamentParticipants).values({
            tournamentId,
            userId: actorUserId,
            winsSnapshot: stats?.winsAllTime ?? 0,
            status: "active",
          });
        }
      }
    } else if (patch.organizerParticipates === false) {
      const part = t.participants.find(
        (p) => p.userId === actorUserId && isActiveParticipant(p),
      );
      if (part) {
        await db
          .update(tournamentParticipants)
          .set({ status: "withdrawn" })
          .where(eq(tournamentParticipants.id, part.id));
      }
    }

    return this.get(tournamentId, db);
    });
  }

  playingParticipants(t: {
    participants: ActiveParticipant[];
    createdByUserId: string;
    organizerParticipates: boolean;
  }) {
    return t.participants.filter((p) => {
      if (!isActiveParticipant(p)) return false;
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
    actorUserId: string;
    userId?: string;
    guestFirstName?: string;
    guestLastName?: string;
  }) {
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      await db
        .select({ id: tournaments.id })
        .from(tournaments)
        .where(eq(tournaments.id, input.tournamentId))
        .for("update");
      const t = await this.get(input.tournamentId, db);
      if (!t) {
        throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      }
      if (t.createdByUserId !== input.actorUserId) {
        throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
      }
      const participant = await this.insertParticipant(t, input, db);
      if (participant?.userId && participant.userId !== t.createdByUserId) {
        const organizerTeams = await db
          .select({ teamId: teamMemberships.teamId })
          .from(teamMemberships)
          .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
          .where(and(
            eq(teamMemberships.userId, t.createdByUserId),
            isNull(teamMemberships.leftAt),
            eq(teams.status, "active"),
          ));
        if (organizerTeams.length > 0) {
          const teammate = await db.query.teamMemberships.findFirst({
            where: and(
              eq(teamMemberships.userId, participant.userId),
              inArray(
                teamMemberships.teamId,
                organizerTeams.map((team) => team.teamId),
              ),
              isNull(teamMemberships.leftAt),
            ),
          });
          if (teammate) {
            await db.insert(notifications).values({
              userId: participant.userId,
              type: "tournament_team_added",
              title: "Вы добавлены в турнир",
              body: `Участник вашей команды добавил вас в «${t.title}»`,
              payload: { tournamentId: t.id },
            });
          }
        }
      }
      return participant;
    });
  }

  private async insertParticipant(
    t: NonNullable<Awaited<ReturnType<TournamentService["get"]>>>,
    input: {
      tournamentId: string;
      userId?: string;
      guestFirstName?: string;
      guestLastName?: string;
    },
    db: Db = this.db,
  ) {
    if (t.status !== "collecting" && t.status !== "needs_regeneration") {
      throw Object.assign(new Error("INVALID_STATUS"), {
        code: "INVALID_STATUS",
        message: "Roster closed after bracket generation",
      });
    }
    const active = t.participants.filter((p) => isActiveParticipant(p));
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
      const stats = await db.query.userStats.findFirst({
        where: eq(userStats.userId, input.userId),
      });
      winsSnapshot = stats?.winsAllTime ?? 0;
    }
    const [row] = await db
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
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      await db
        .select({ id: tournaments.id })
        .from(tournaments)
        .where(eq(tournaments.id, input.tournamentId))
        .for("update");
      const t = await this.get(input.tournamentId, db);
      if (!t) {
        throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      }
      if (t.createdByUserId !== input.actorUserId) {
        throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
      }
      if (
        t.status !== "collecting" &&
        t.status !== "needs_regeneration" &&
        t.status !== "bracket_generated"
      ) {
        throw Object.assign(new Error("INVALID_STATUS"), {
          code: "INVALID_STATUS",
        });
      }
      const participant = t.participants.find(
        (entry) => entry.id === input.participantId,
      );
      if (!participant) {
        throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      }
      await db
        .update(tournamentParticipants)
        .set({ status: "withdrawn" })
        .where(
          and(
            eq(tournamentParticipants.id, input.participantId),
            eq(tournamentParticipants.tournamentId, input.tournamentId),
          ),
        );
      if (t.status === "bracket_generated") {
        await db
          .update(tournaments)
          .set({
            status: "needs_regeneration",
            updatedAt: this.clock.now(),
          })
          .where(eq(tournaments.id, input.tournamentId));
      }
      return { ok: true };
    });
  }

  async withdraw(input: {
    tournamentId: string;
    userId: string;
  }) {
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      await db
        .select({ id: tournaments.id })
        .from(tournaments)
        .where(eq(tournaments.id, input.tournamentId))
        .for("update");
      const t = await this.get(input.tournamentId, db);
      if (!t) {
        throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      }
      const part = t.participants.find(
        (p) => p.userId === input.userId && isActiveParticipant(p),
      );
      if (!part) {
        throw Object.assign(new Error("NOT_A_PARTICIPANT"), {
          code: "NOT_A_PARTICIPANT",
        });
      }
      if (
        t.status === "in_progress" ||
        t.status === "finished" ||
        t.status === "stopped" ||
        t.status === "cancelled"
      ) {
        throw Object.assign(new Error("INVALID_STATUS"), {
          code: "INVALID_STATUS",
        });
      }
      await db
        .update(tournamentParticipants)
        .set({ status: "withdrawn" })
        .where(eq(tournamentParticipants.id, part.id));
      if (t.status === "bracket_generated") {
        await db
          .update(tournaments)
          .set({
            status: "needs_regeneration",
            updatedAt: this.clock.now(),
          })
          .where(eq(tournaments.id, input.tournamentId));
      }
      return this.get(input.tournamentId, db);
    });
  }

  /** Organizer cancels a tournament that has not started yet. */
  async cancel(tournamentId: string, actorUserId: string) {
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      const [t] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, tournamentId))
        .for("update");
      if (!t) {
        throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      }
      if (t.createdByUserId !== actorUserId) {
        throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
      }
      if (
        t.status !== "collecting" &&
        t.status !== "bracket_generated" &&
        t.status !== "needs_regeneration"
      ) {
        throw Object.assign(new Error("INVALID_STATUS"), {
          code: "INVALID_STATUS",
        });
      }
      const now = this.clock.now();
      const cancelledInvites = await db
        .update(tournamentInvitations)
        .set({ status: "cancelled", respondedAt: now })
        .where(
          and(
            eq(tournamentInvitations.tournamentId, tournamentId),
            eq(tournamentInvitations.status, "pending"),
          ),
        )
        .returning({
          id: tournamentInvitations.id,
          invitedUserId: tournamentInvitations.invitedUserId,
        });
      await this.closeInvitationNotifications(
        cancelledInvites,
        "event_cancelled",
        now,
        db,
      );
      await db
        .update(tournaments)
        .set({
          status: "cancelled",
          bracketJson: null,
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(tournaments.id, tournamentId));
      return this.get(tournamentId, db);
    });
  }

  async get(id: string, db: Db = this.db) {
    const t = await db.query.tournaments.findFirst({
      where: eq(tournaments.id, id),
    });
    if (!t) return null;
    let participants = await db.query.tournamentParticipants.findMany({
      where: eq(tournamentParticipants.tournamentId, id),
    });

    // Heal older tournaments: organizerParticipates but missing from roster
    if (
      t.organizerParticipates &&
      (t.status === "collecting" || t.status === "needs_regeneration") &&
      !participants.some(
        (p) => p.userId === t.createdByUserId && isActiveParticipant(p),
      )
    ) {
      const stats = await db.query.userStats.findFirst({
        where: eq(userStats.userId, t.createdByUserId),
      });
      await db.insert(tournamentParticipants).values({
        tournamentId: id,
        userId: t.createdByUserId,
        winsSnapshot: stats?.winsAllTime ?? 0,
        status: "active",
      });
      participants = await db.query.tournamentParticipants.findMany({
        where: eq(tournamentParticipants.tournamentId, id),
      });
    }

    const userIds = participants
      .map((p) => p.userId)
      .filter((uid): uid is string => Boolean(uid));
    const userRows =
      userIds.length > 0
        ? await db.query.users.findMany({
            where: inArray(users.id, userIds),
          })
        : [];
    const usersById = new Map(userRows.map((u) => [u.id, u]));

    const tournamentMatches = await db.query.matches.findMany({
      where: eq(matches.tournamentId, id),
    });

    const invitations = await db.query.tournamentInvitations.findMany({
      where: eq(tournamentInvitations.tournamentId, id),
    });
    const inviteUserIds = [
      ...new Set(invitations.map((i) => i.invitedUserId)),
    ];
    const inviteUsers =
      inviteUserIds.length > 0
        ? await db.query.users.findMany({
            where: inArray(users.id, inviteUserIds),
          })
        : [];
    const inviteUsersById = new Map(inviteUsers.map((u) => [u.id, u]));

    return {
      ...t,
      summary: tournamentSummary(t, participants.map((p) => p.id), tournamentMatches, this.clock.now()),
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

  async getVisible(id: string, actorUserId: string) {
    const tournament = await this.db.query.tournaments.findFirst({
      where: eq(tournaments.id, id),
    });
    if (!tournament) return null;
    if (!COMPLETED_TOURNAMENT_STATUSES.has(tournament.status)) {
      const scope = await this.visibleActiveTournamentIds(actorUserId);
      if (
        tournament.createdByUserId !== actorUserId &&
        !scope.has(tournament.id)
      ) {
        throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
      }
    }
    return this.get(id);
  }

  /** Organizer removes a declined (or pending) invitation so they can re-invite. */
  async cancelInvitation(input: {
    tournamentId: string;
    invitationId: string;
    actorUserId: string;
  }) {
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      const [t] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, input.tournamentId))
        .for("update");
      if (!t) {
        throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      }
      if (t.createdByUserId !== input.actorUserId) {
        throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
      }
      const [inv] = await db
        .select()
        .from(tournamentInvitations)
        .where(
          and(
            eq(tournamentInvitations.id, input.invitationId),
            eq(tournamentInvitations.tournamentId, input.tournamentId),
          ),
        )
        .for("update");
      if (!inv) {
        throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      }
      if (inv.status === "cancelled") return { ok: true };
      if (inv.status !== "declined" && inv.status !== "pending") {
        throw Object.assign(new Error("INVALID_STATUS"), {
          code: "INVALID_STATUS",
        });
      }
      const now = this.clock.now();
      await db
        .update(tournamentInvitations)
        .set({ status: "cancelled", respondedAt: now })
        .where(eq(tournamentInvitations.id, inv.id));
      await markInvitationNotificationsRead(db, {
        userId: inv.invitedUserId,
        type: "tournament_invitation",
        invitationIds: [inv.id],
        readAt: now,
      });
      return { ok: true };
    });
  }

  async list(actorUserId: string) {
    const [rows, scopedActiveIds] = await Promise.all([
      this.db.query.tournaments.findMany(),
      this.visibleActiveTournamentIds(actorUserId),
    ]);
    return rows.filter(
      (tournament) =>
        COMPLETED_TOURNAMENT_STATUSES.has(tournament.status) ||
        tournament.createdByUserId === actorUserId ||
        scopedActiveIds.has(tournament.id),
    );
  }

  private async visibleActiveTournamentIds(actorUserId: string) {
    const [participantRows, judgeRows] = await Promise.all([
      this.db.query.tournamentParticipants.findMany({
        where: and(
          eq(tournamentParticipants.userId, actorUserId),
          eq(tournamentParticipants.status, "active"),
        ),
      }),
      this.db.query.judgeSessions.findMany({
        where: and(
          eq(judgeSessions.userId, actorUserId),
          isNull(judgeSessions.releasedAt),
          gt(judgeSessions.expiresAt, this.clock.now()),
        ),
      }),
    ]);
    const visible = new Set(
      participantRows.map((participant) => participant.tournamentId),
    );
    const judgedMatchIds = judgeRows.map((session) => session.matchId);
    if (judgedMatchIds.length === 0) return visible;
    const judgedMatches = await this.db.query.matches.findMany({
      where: inArray(matches.id, judgedMatchIds),
    });
    for (const match of judgedMatches) {
      if (match.tournamentId) visible.add(match.tournamentId);
    }
    return visible;
  }

  async invite(input: {
    tournamentId: string;
    invitedUserId: string;
    invitedByUserId: string;
  }) {
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      const [t] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, input.tournamentId))
        .for("update");
      if (!t) {
        throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      }
      if (t.createdByUserId !== input.invitedByUserId) {
        throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
      }
      if (t.status !== "collecting" && t.status !== "needs_regeneration") {
        throw Object.assign(new Error("INVALID_STATUS"), {
          code: "INVALID_STATUS",
        });
      }

      const activeParticipant = await db.query.tournamentParticipants.findFirst({
        where: and(
          eq(tournamentParticipants.tournamentId, input.tournamentId),
          eq(tournamentParticipants.userId, input.invitedUserId),
          eq(tournamentParticipants.status, "active"),
        ),
      });
      if (activeParticipant) {
        throw Object.assign(new Error("ALREADY_IN_TOURNAMENT"), {
          code: "ALREADY_IN_TOURNAMENT",
        });
      }

      const now = this.clock.now();
      const expired = await db
        .update(tournamentInvitations)
        .set({ status: "expired", respondedAt: now })
        .where(
          and(
            eq(tournamentInvitations.tournamentId, input.tournamentId),
            eq(tournamentInvitations.invitedUserId, input.invitedUserId),
            eq(tournamentInvitations.status, "pending"),
            lte(tournamentInvitations.expiresAt, now),
          ),
        )
        .returning({ id: tournamentInvitations.id });
      await markInvitationNotificationsRead(db, {
        userId: input.invitedUserId,
        type: "tournament_invitation",
        invitationIds: expired.map((invite) => invite.id),
        readAt: now,
      });
      const existing = await db.query.tournamentInvitations.findFirst({
        where: and(
          eq(tournamentInvitations.tournamentId, input.tournamentId),
          eq(tournamentInvitations.invitedUserId, input.invitedUserId),
          eq(tournamentInvitations.status, "pending"),
        ),
      });
      if (existing) return existing;

      const [invitation] = await db
        .insert(tournamentInvitations)
        .values({
          tournamentId: input.tournamentId,
          invitedUserId: input.invitedUserId,
          invitedByUserId: input.invitedByUserId,
          expiresAt: new Date(now.getTime() + TOURNAMENT_INVITATION_TTL_MS),
          status: "pending",
        })
        .returning();
      await db.insert(notifications).values({
        userId: input.invitedUserId,
        type: "tournament_invitation",
        title: "Приглашение в турнир",
        body: `Вас пригласили в турнир «${t.title}»`,
        payload: { invitationId: invitation!.id, tournamentId: t.id },
      });
      return invitation;
    });
  }

  async respondInvitation(input: {
    invitationId: string;
    userId: string;
    accept: boolean;
  }) {
    const invitation = await this.db.query.tournamentInvitations.findFirst({
      where: eq(tournamentInvitations.id, input.invitationId),
    });
    if (!invitation || invitation.invitedUserId !== input.userId) {
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    }

    const outcome = await this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      await db
        .select({ id: tournaments.id })
        .from(tournaments)
        .where(eq(tournaments.id, invitation.tournamentId))
        .for("update");
      const [inv] = await db
        .select()
        .from(tournamentInvitations)
        .where(eq(tournamentInvitations.id, input.invitationId))
        .for("update");
      if (!inv || inv.invitedUserId !== input.userId) {
        throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      }
      if (inv.status === "accepted" || inv.status === "declined") {
        return { kind: "responded" as const, status: inv.status };
      }
      const now = this.clock.now();
      if (
        inv.status === "expired" ||
        inv.status === "cancelled" ||
        inv.expiresAt.getTime() <= now.getTime()
      ) {
        if (inv.status === "pending") {
          await db
            .update(tournamentInvitations)
            .set({ status: "expired", respondedAt: now })
            .where(
              and(
                eq(tournamentInvitations.id, inv.id),
                eq(tournamentInvitations.status, "pending"),
              ),
            );
        }
        await markInvitationNotificationsRead(db, {
          userId: input.userId,
          type: "tournament_invitation",
          invitationIds: [inv.id],
          readAt: now,
        });
        return { kind: "expired" as const };
      }
      const tournament = await this.get(inv.tournamentId, db);
      if (!tournament) {
        throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      }
      if (
        tournament.status !== "collecting" &&
        tournament.status !== "needs_regeneration"
      ) {
        throw Object.assign(new Error("INVALID_STATUS"), {
          code: "INVALID_STATUS",
        });
      }

      const status = input.accept ? "accepted" : "declined";
      await db
        .update(tournamentInvitations)
        .set({ status, respondedAt: now })
        .where(
          and(
            eq(tournamentInvitations.id, inv.id),
            eq(tournamentInvitations.status, "pending"),
          ),
        );
      if (input.accept) {
        const alreadyActive = tournament.participants.some(
          (participant) =>
            participant.userId === input.userId && isActiveParticipant(participant),
        );
        if (!alreadyActive) {
          await this.insertParticipant(
            tournament,
            { tournamentId: inv.tournamentId, userId: input.userId },
            db,
          );
        }
      }
      await markInvitationNotificationsRead(db, {
        userId: input.userId,
        type: "tournament_invitation",
        invitationIds: [inv.id],
        readAt: now,
      });
      return { kind: "responded" as const, status };
    });
    if (outcome.kind === "expired") {
      throw Object.assign(new Error("EXPIRED"), { code: "EXPIRED" });
    }
    return { status: outcome.status };
  }

  async generateBracket(
    tournamentId: string,
    actorUserId: string,
    opts: {
      constructionAlgorithm?: unknown;
      rng?: () => number;
    } = {},
  ) {
    return this.db.transaction((transaction) =>
      this.generateBracketInTransaction(
        tournamentId,
        actorUserId,
        opts,
        transaction as unknown as Db,
      ),
    );
  }

  private async generateBracketInTransaction(
    tournamentId: string,
    actorUserId: string,
    opts: {
      constructionAlgorithm?: unknown;
      rng?: () => number;
    },
    db: Db,
  ) {
    const rng = opts.rng ?? Math.random;
    await db
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .for("update");
    const t = await this.get(tournamentId, db);
    if (!t) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (t.createdByUserId !== actorUserId) {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
    if (t.status !== "collecting" && t.status !== "needs_regeneration" && t.status !== "bracket_generated") {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "INVALID_STATUS" });
    }
    if (t.bracketJson) {
      loadTournamentBracket(t.bracketJson);
    }

    const playing = this.playingParticipants(t);
    if (playing.length < 3) {
      throw Object.assign(new Error("TOO_FEW"), { code: "TOO_FEW" });
    }
    if (playing.length === 2) {
      throw Object.assign(new Error("USE_MATCH"), { code: "USE_MATCH" });
    }

    let requestedAlgorithm: BracketConstructionAlgorithm | undefined;
    if (opts.constructionAlgorithm !== undefined) {
      requestedAlgorithm = parseBracketConstructionAlgorithm(
        opts.constructionAlgorithm,
      );
    }

    const hasExistingBracket = Boolean(t.bracketJson);
    let existingBracketAlgorithm: BracketConstructionAlgorithm | null = null;
    if (hasExistingBracket) {
      const detected = detectStoredConstructionAlgorithm(t.bracketJson);
      if (
        detected.kind === "algorithm" &&
        isBracketConstructionAlgorithm(detected.algorithm)
      ) {
        existingBracketAlgorithm = detected.algorithm;
      } else if (
        t.bracketConstructionAlgorithm &&
        isBracketConstructionAlgorithm(t.bracketConstructionAlgorithm)
      ) {
        existingBracketAlgorithm = t.bracketConstructionAlgorithm;
      } else if (detected.kind === "algorithm" && detected.algorithm === "legacy") {
        // Regenerate of legacy DE without explicit algo: require explicit choice
        if (requestedAlgorithm === undefined) {
          throw Object.assign(new Error("LEGACY_BRACKET_ALGORITHM_REQUIRED"), {
            code: "LEGACY_BRACKET_ALGORITHM_REQUIRED",
          });
        }
      }
    } else if (
      t.bracketConstructionAlgorithm &&
      isBracketConstructionAlgorithm(t.bracketConstructionAlgorithm)
    ) {
      existingBracketAlgorithm = t.bracketConstructionAlgorithm;
    }

    const constructionAlgorithm = resolveRequestedConstructionAlgorithm({
      requestedAlgorithm,
      existingBracketAlgorithm,
      hasExistingBracket,
    });

    // Preserve seed order on regenerate when participants already seeded
    const existingSeeds = playing
      .filter((p) => p.seed != null)
      .sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));
    const seeded =
      hasExistingBracket && existingSeeds.length === playing.length
        ? existingSeeds.map((p) => p.id)
        : seedParticipants(
            playing.map((p) => ({ id: p.id, wins: p.winsSnapshot })),
            rng,
          );

    const thirdPlaceEnabled =
      t.format === "double_elimination"
        ? false
        : (t.thirdPlaceEnabled ?? true);

    const format = t.format as "single_elimination" | "double_elimination";
    const bracket = prepareBracketGraph({
      seedOrder: seeded,
      format,
      constructionAlgorithm,
      thirdPlaceEnabled,
    });

    for (let i = 0; i < seeded.length; i += 1) {
      await db
        .update(tournamentParticipants)
        .set({ seed: i + 1 })
        .where(eq(tournamentParticipants.id, seeded[i]!));
    }

    // Expire pending invites (AT-TRN-004)
    const now = this.clock.now();
    const expiredInvites = await db
      .update(tournamentInvitations)
      .set({ status: "expired", respondedAt: now })
      .where(
        and(
          eq(tournamentInvitations.tournamentId, tournamentId),
          eq(tournamentInvitations.status, "pending"),
        ),
      )
      .returning({
        id: tournamentInvitations.id,
        invitedUserId: tournamentInvitations.invitedUserId,
      });
    await this.closeInvitationNotifications(
      expiredInvites,
      "roster_closed",
      now,
      db,
    );

    const [row] = await db
      .update(tournaments)
      .set({
        status: "bracket_generated",
        bracketJson: bracket,
        thirdPlaceEnabled,
        bracketConstructionAlgorithm: constructionAlgorithm,
        bracketStateVersion: sql`${tournaments.bracketStateVersion} + 1`,
        updatedAt: now,
      })
      .where(eq(tournaments.id, tournamentId))
      .returning();
    return {
      ...row,
      participants: t.participants,
      bracket,
      constructionAlgorithm,
    };
  }

  async dissolveBracket(tournamentId: string, actorUserId: string) {
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      await db
        .select({ id: tournaments.id })
        .from(tournaments)
        .where(eq(tournaments.id, tournamentId))
        .for("update");
      const t = await this.get(tournamentId, db);
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
    if (t.bracketJson) {
      loadTournamentBracket(t.bracketJson);
    }
    const [row] = await db
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
    });
  }

  async patchBracket(
    tournamentId: string,
    actorUserId: string,
    swaps: Array<{ slotIdA: string; slotIdB: string }>,
  ) {
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      await db.select({ id: tournaments.id }).from(tournaments).where(eq(tournaments.id, tournamentId)).for("update");
    const t = await this.get(tournamentId, db);
    if (!t) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (t.createdByUserId !== actorUserId) {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
    if (t.status !== "bracket_generated") {
      throw Object.assign(new Error("BRACKET_NOT_EDITABLE"), {
        code: "BRACKET_NOT_EDITABLE",
      });
    }
    this.assertBracketAlgorithmIntegrity(t);
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
      const [row] = await db
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

    // V2: apply seed swaps to seedOrder, then full regenerate with same algorithm
    let seedOrder = [...loaded.graph.seedOrder];
    for (const swap of swaps) {
      seedOrder = swapSeedOrderByMatchIds(loaded.graph, seedOrder, swap.slotIdA, swap.slotIdB);
    }
    const constructionAlgorithm = loaded.graph.constructionAlgorithm;
    const format = loaded.graph.format;
    const next = prepareBracketGraph({
      seedOrder,
      format,
      constructionAlgorithm,
      thirdPlaceEnabled: loaded.graph.thirdPlaceEnabled,
    });

    for (let i = 0; i < seedOrder.length; i += 1) {
      await db
        .update(tournamentParticipants)
        .set({ seed: i + 1 })
        .where(eq(tournamentParticipants.id, seedOrder[i]!));
    }

    const [row] = await db
      .update(tournaments)
      .set({
        bracketJson: next,
        bracketConstructionAlgorithm: constructionAlgorithm,
        bracketStateVersion: sql`${tournaments.bracketStateVersion} + 1`,
        updatedAt: this.clock.now(),
      })
      .where(eq(tournaments.id, tournamentId))
      .returning();
    return { ...row, bracket: next };
    });
  }

  /** Column vs JSON must agree for an unstarted live bracket. */
  private assertBracketAlgorithmIntegrity(t: {
    status: string;
    bracketJson: unknown;
    bracketConstructionAlgorithm: string | null;
  }) {
    if (!t.bracketJson) return;
    if (t.status !== "bracket_generated" && t.status !== "needs_regeneration") {
      return;
    }
    const detected = detectStoredConstructionAlgorithm(t.bracketJson);
    if (detected.kind !== "algorithm") return;
    if (detected.algorithm === "legacy") return;
    const col = t.bracketConstructionAlgorithm;
    if (col == null) return;
    if (col !== detected.algorithm) {
      throw Object.assign(new Error("BRACKET_ALGORITHM_MISMATCH"), {
        code: "BRACKET_ALGORITHM_MISMATCH",
      });
    }
  }

  async start(tournamentId: string, actorUserId: string) {
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      await db
        .select({ id: tournaments.id })
        .from(tournaments)
        .where(eq(tournaments.id, tournamentId))
        .for("update");
      const t = await this.get(tournamentId, db);
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

    this.assertBracketAlgorithmIntegrity(t);
    const loaded = loadTournamentBracket(t.bracketJson);
    const playing = this.playingParticipants(t);
    const userIds = [
      ...new Set([
        t.createdByUserId,
        ...playing.flatMap((participant) =>
          participant.userId ? [participant.userId] : [],
        ),
      ]),
    ].sort();
    for (const userId of userIds) {
      await db.execute(sql`select ${users.id} from ${users} where ${users.id} = ${userId} for update`);
    }
    await this.assertPlayersFree(playing.map((participant) => participant.id), db);
    const pendingNotifs: Array<{
      userId: string;
      matchId: string;
    }> = [];

    if (loaded.kind === "v1") {
      const bracket = await this.materializeReadyMatchesV1(t, loaded.bracket, {
        db,
        collectNotifs: pendingNotifs,
      });
      await db
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
        db,
        pendingNotifs,
      );
      const version = t.bracketStateVersion ?? 0;
      const updated = await db
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
      await db.insert(notifications).values({
        userId: n.userId,
        type: "tournament_match_ready",
        title: "Матч турнира готов",
        body: `Ваш матч в «${t.title}» можно судить`,
        payload: { tournamentId: t.id, matchId: n.matchId },
      });
    }

      return this.get(tournamentId, db);
    });
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

  async onMatchFinished(matchId: string, db: Db) {
    const match = await this.matchService.getMatch(matchId, db);
    if (!match || match.kind !== "tournament" || !match.tournamentId) return;
    if (match.status !== "finished" && match.status !== "stopped") return;

    await db.execute(
      sql`select ${tournaments.id} from ${tournaments} where ${tournaments.id} = ${match.tournamentId} for update`,
    );
    const t = await this.get(match.tournamentId, db);
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
        { db, collectNotifs: pendingNotifs },
      );

      const complete = isTournamentComplete(next);
      await db
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
          await db.insert(notifications).values({
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
        db,
        pendingNotifs,
      );
      const complete = isBracketGraphComplete(next);
      const champId = next.championParticipantId;
      const updated = await db
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
          await db.insert(notifications).values({
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
      await db.insert(notifications).values({
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
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      await db
        .select({ id: tournaments.id })
        .from(tournaments)
        .where(eq(tournaments.id, tournamentId))
        .for("update");
      const t = await this.get(tournamentId, db);
    if (!t) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (t.createdByUserId !== actorUserId) {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
    if (t.status !== "in_progress") {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "INVALID_STATUS" });
    }

    // Cancel unplayed tournament matches
    const now = this.clock.now();
      const activeMatches = await db
      .select({ id: matches.id })
      .from(matches)
      .where(and(eq(matches.tournamentId, tournamentId), or(eq(matches.status, "waiting"), eq(matches.status, "in_progress"), eq(matches.status, "pending_confirmation"))))
      .orderBy(matches.id)
      .for("update");
      const activeMatchIds = activeMatches.map((match) => match.id);
      await db
      .update(matches)
      .set({
        status: "cancelled",
        updatedAt: now,
        finishedAt: now,
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
      if (activeMatchIds.length > 0) {
        await db
          .update(judgeSessions)
          .set({ releasedAt: now })
          .where(
            and(
              inArray(judgeSessions.matchId, activeMatchIds),
              isNull(judgeSessions.releasedAt),
            ),
          );
      }

    await db
      .update(tournaments)
      .set({
        status: "stopped",
        stopReasonCode: reason?.code ?? "other",
        stopReasonText: reason?.text ?? null,
        finishedAt: now,
        updatedAt: now,
      })
      .where(eq(tournaments.id, tournamentId))
      .returning();
      const recipients = [...new Set(
        t.participants.flatMap((participant) =>
          participant.userId &&
          participant.userId !== actorUserId &&
          isActiveParticipant(participant)
            ? [participant.userId]
            : [],
        ),
      )];
      if (recipients.length > 0) {
        await db.insert(notifications).values(recipients.map((userId) => ({
          userId,
          type: "tournament_stopped",
          title: "Турнир остановлен",
          body: `Турнир «${t.title}» остановлен организатором`,
          payload: { tournamentId: t.id },
        })));
      }
      return this.get(tournamentId, db);
    });
  }

  /** Sum of game points scored by a tournament participant across finished matches (AT-TRN-013). */
  async participantPoints(tournamentId: string, tournamentParticipantId: string) {
    const t = await this.get(tournamentId);
    if (!t) return 0;
    return t.summary.results.find((row) => row.participantId === tournamentParticipantId)?.points ?? 0;
  }
}
