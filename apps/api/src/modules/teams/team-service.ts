import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, isNull, lte } from "drizzle-orm";
import {
  TEAM_INVITATION_TTL_MS,
  selectNewCaptain,
} from "@tab10/shared";
import type { Clock } from "@tab10/test-utils";
import type { Db } from "../../db/client.js";
import {
  notifications,
  teamInvitations,
  teamMemberships,
  teams,
  users,
} from "../../db/schema.js";
import { markInvitationNotificationsRead } from "../notifications/notification-service.js";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "team"
  );
}

function domainError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

export class TeamService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  private async lockActiveUser(db: Db, userId: string, errorCode: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!user || user.status !== "active") throw domainError(errorCode);
    return user;
  }

  async create(input: {
    name: string;
    captainUserId: string;
    slogan?: string;
    welcomeText?: string;
  }) {
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      await this.lockActiveUser(db, input.captainUserId, "USER_NOT_FOUND");
      const [team] = await db
        .insert(teams)
        .values({
          name: input.name,
          slug: `${slugify(input.name)}-${randomUUID()}`,
          captainUserId: input.captainUserId,
          slogan: input.slogan,
          welcomeText: input.welcomeText,
        })
        .returning();
      await db.insert(teamMemberships).values({
        teamId: team!.id,
        userId: input.captainUserId,
        joinedAt: this.clock.now(),
      });
      return team;
    });
  }

  async get(teamId: string) {
    const team = await this.db.query.teams.findFirst({
      where: eq(teams.id, teamId),
    });
    if (!team) return null;
    const members = await this.db.query.teamMemberships.findMany({
      where: and(
        eq(teamMemberships.teamId, teamId),
        isNull(teamMemberships.leftAt),
      ),
    });
    return { ...team, members };
  }

  async getForUser(teamId: string, actorId: string) {
    const team = await this.db.query.teams.findFirst({ where: eq(teams.id, teamId) });
    if (!team) throw domainError("NOT_FOUND");
    const membership = await this.db.query.teamMemberships.findFirst({
      where: and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, actorId)),
    });
    const invitation = await this.db.query.teamInvitations.findFirst({
      where: and(
        eq(teamInvitations.teamId, teamId),
        eq(teamInvitations.invitedUserId, actorId),
        eq(teamInvitations.status, "pending"),
        gt(teamInvitations.expiresAt, this.clock.now()),
      ),
    });
    if (!membership && !invitation) throw domainError("FORBIDDEN");
    const rows = await this.db
      .select({
        id: teamMemberships.id,
        userId: teamMemberships.userId,
        joinedAt: teamMemberships.joinedAt,
        firstName: users.firstName,
        lastName: users.lastName,
        avatarKey: users.generatedAvatarKey,
      })
      .from(teamMemberships)
      .innerJoin(users, eq(users.id, teamMemberships.userId))
      .where(and(eq(teamMemberships.teamId, teamId), isNull(teamMemberships.leftAt), eq(users.status, "active")))
      .orderBy(asc(teamMemberships.joinedAt), asc(teamMemberships.userId));
    const members = rows.map(({ firstName, lastName, ...member }) => ({
      ...member,
      displayName: `${lastName} ${firstName}`.trim(),
    }));
    const result = {
      ...team,
      members,
      isMember: members.some((member) => member.userId === actorId),
      isCaptain: team.captainUserId === actorId,
    };
    if (team.captainUserId !== actorId) return result;
    const invitations = await this.db
      .select({
        id: teamInvitations.id,
        invitedUserId: teamInvitations.invitedUserId,
        status: teamInvitations.status,
        expiresAt: teamInvitations.expiresAt,
        respondedAt: teamInvitations.respondedAt,
        createdAt: teamInvitations.createdAt,
        firstName: users.firstName,
        lastName: users.lastName,
        avatarKey: users.generatedAvatarKey,
      })
      .from(teamInvitations)
      .innerJoin(users, eq(users.id, teamInvitations.invitedUserId))
      .where(eq(teamInvitations.teamId, teamId))
      .orderBy(asc(teamInvitations.createdAt));
    return {
      ...result,
      invitations: invitations.map(({ firstName, lastName, ...pending }) => ({
        ...pending,
        displayName: `${lastName} ${firstName}`.trim(),
      })),
    };
  }

  private async lockActiveTeam(db: Db, teamId: string) {
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).for("update");
    if (!team) throw domainError("NOT_FOUND");
    if (team.status !== "active") throw domainError("TEAM_ARCHIVED");
    return team;
  }

  private async assertCaptain(db: Db, teamId: string, actorId: string) {
    const team = await this.lockActiveTeam(db, teamId);
    if (team.captainUserId !== actorId) throw domainError("FORBIDDEN");
    return team;
  }

  async update(teamId: string, actorId: string, patch: { name?: string; slogan?: string; welcomeText?: string }) {
    await this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      await this.assertCaptain(db, teamId, actorId);
      await db.update(teams).set({ ...patch, updatedAt: this.clock.now() }).where(eq(teams.id, teamId));
    });
    return this.getForUser(teamId, actorId);
  }

  async transferCaptain(teamId: string, actorId: string, targetUserId: string) {
    await this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      await this.assertCaptain(db, teamId, actorId);
      if (targetUserId === actorId) return;
      const [target] = await db
        .select({ id: teamMemberships.id, status: users.status })
        .from(teamMemberships)
        .innerJoin(users, eq(users.id, teamMemberships.userId))
        .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, targetUserId), isNull(teamMemberships.leftAt)));
      if (!target || target.status !== "active") throw domainError("MEMBER_NOT_FOUND");
      await db.update(teams).set({ captainUserId: targetUserId, updatedAt: this.clock.now() }).where(eq(teams.id, teamId));
    });
    return this.getForUser(teamId, actorId);
  }

  async removeMember(teamId: string, actorId: string, userId: string) {
    await this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      await this.assertCaptain(db, teamId, actorId);
      if (userId === actorId) throw domainError("CAPTAIN_TRANSFER_REQUIRED");
      const changed = await db.update(teamMemberships).set({ leftAt: this.clock.now(), leaveReason: "removed" }).where(
        and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId), isNull(teamMemberships.leftAt)),
      ).returning({ id: teamMemberships.id });
      if (changed.length === 0) throw domainError("MEMBER_NOT_FOUND");
    });
    return this.getForUser(teamId, actorId);
  }

  async leave(teamId: string, actorId: string) {
    await this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      const team = await this.lockActiveTeam(db, teamId);
      if (team.captainUserId === actorId) throw domainError("CAPTAIN_TRANSFER_REQUIRED");
      const changed = await db.update(teamMemberships).set({ leftAt: this.clock.now(), leaveReason: "left" }).where(
        and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, actorId), isNull(teamMemberships.leftAt)),
      ).returning({ id: teamMemberships.id });
      if (changed.length === 0) throw domainError("MEMBER_NOT_FOUND");
    });
    return this.getForUser(teamId, actorId);
  }

  async invite(input: {
    teamId: string;
    invitedUserId: string;
    invitedByUserId: string;
  }) {
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      await this.lockActiveUser(db, input.invitedUserId, "USER_NOT_FOUND");
      const team = await this.assertCaptain(db, input.teamId, input.invitedByUserId);

      const activeMembership = await db.query.teamMemberships.findFirst({
        where: and(
          eq(teamMemberships.teamId, input.teamId),
          eq(teamMemberships.userId, input.invitedUserId),
          isNull(teamMemberships.leftAt),
        ),
      });
      if (activeMembership) {
        throw domainError("ALREADY_IN_TEAM");
      }

      const now = this.clock.now();
      const expired = await db
        .update(teamInvitations)
        .set({ status: "expired", respondedAt: now })
        .where(
          and(
            eq(teamInvitations.teamId, input.teamId),
            eq(teamInvitations.invitedUserId, input.invitedUserId),
            eq(teamInvitations.status, "pending"),
            lte(teamInvitations.expiresAt, now),
          ),
        )
        .returning({ id: teamInvitations.id });
      await markInvitationNotificationsRead(db, {
        userId: input.invitedUserId,
        type: "team_invitation",
        invitationIds: expired.map((invite) => invite.id),
        readAt: now,
      });

      const existing = await db.query.teamInvitations.findFirst({
        where: and(
          eq(teamInvitations.teamId, input.teamId),
          eq(teamInvitations.invitedUserId, input.invitedUserId),
          eq(teamInvitations.status, "pending"),
        ),
      });
      if (existing) return existing;

      const [invitation] = await db
        .insert(teamInvitations)
        .values({
          teamId: input.teamId,
          invitedUserId: input.invitedUserId,
          invitedByUserId: input.invitedByUserId,
          expiresAt: new Date(now.getTime() + TEAM_INVITATION_TTL_MS),
          status: "pending",
        })
        .returning();
      await db.insert(notifications).values({
        userId: input.invitedUserId,
        type: "team_invitation",
        title: "Приглашение в команду",
        body: `Вас пригласили в команду «${team.name}»`,
        payload: { invitationId: invitation!.id, teamId: team.id },
      });
      return invitation;
    });
  }

  async respondInvitation(input: {
    invitationId: string;
    userId: string;
    accept: boolean;
  }) {
    const invitation = await this.db.query.teamInvitations.findFirst({
      where: eq(teamInvitations.id, input.invitationId),
    });
    if (!invitation || invitation.invitedUserId !== input.userId) {
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    }

    const outcome = await this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      await this.lockActiveUser(db, input.userId, "FORBIDDEN");
      const [team] = await db
        .select()
        .from(teams)
        .where(eq(teams.id, invitation.teamId))
        .for("update");
      const [inv] = await db
        .select()
        .from(teamInvitations)
        .where(eq(teamInvitations.id, input.invitationId))
        .for("update");
      if (!team || !inv || inv.invitedUserId !== input.userId) {
        throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      }
      if (inv.status === "accepted" || inv.status === "declined") {
        return { kind: "responded" as const, status: inv.status, teamId: inv.teamId };
      }
      const now = this.clock.now();
      if (
        team.status !== "active" ||
        inv.status === "expired" ||
        inv.status === "cancelled" ||
        inv.expiresAt.getTime() <= now.getTime()
      ) {
        if (inv.status === "pending") {
          await db
            .update(teamInvitations)
            .set({ status: team.status === "active" ? "expired" : "cancelled", respondedAt: now })
            .where(
              and(
                eq(teamInvitations.id, inv.id),
                eq(teamInvitations.status, "pending"),
              ),
            );
        }
        await markInvitationNotificationsRead(db, {
          userId: input.userId,
          type: "team_invitation",
          invitationIds: [inv.id],
          readAt: now,
        });
        return { kind: "expired" as const };
      }

      const status = input.accept ? "accepted" : "declined";
      await db
        .update(teamInvitations)
        .set({ status, respondedAt: now })
        .where(
          and(
            eq(teamInvitations.id, inv.id),
            eq(teamInvitations.status, "pending"),
          ),
        );
      if (input.accept) {
        const activeMembership = await db.query.teamMemberships.findFirst({
          where: and(
            eq(teamMemberships.teamId, inv.teamId),
            eq(teamMemberships.userId, input.userId),
            isNull(teamMemberships.leftAt),
          ),
        });
        if (!activeMembership) {
          await db.insert(teamMemberships).values({
            teamId: inv.teamId,
            userId: input.userId,
            joinedAt: now,
          });
        }
      }
      await markInvitationNotificationsRead(db, {
        userId: input.userId,
        type: "team_invitation",
        invitationIds: [inv.id],
        readAt: now,
      });
      return { kind: "responded" as const, status, teamId: inv.teamId };
    });
    if (outcome.kind === "expired") {
      throw Object.assign(new Error("EXPIRED"), { code: "EXPIRED" });
    }
    return { status: outcome.status, teamId: outcome.teamId };
  }

  private async cancelPendingInvitations(db: Db, teamId: string, now: Date) {
    const cancelled = await db
      .update(teamInvitations)
      .set({ status: "cancelled", respondedAt: now })
      .where(and(eq(teamInvitations.teamId, teamId), eq(teamInvitations.status, "pending")))
      .returning({ id: teamInvitations.id, userId: teamInvitations.invitedUserId });
    for (const item of cancelled) {
      await markInvitationNotificationsRead(db, {
        userId: item.userId,
        type: "team_invitation",
        invitationIds: [item.id],
        readAt: now,
      });
    }
  }

  private async transferCaptainOnBlockLocked(blockedUserId: string, db: Db) {
    const candidates = await db
      .select({ id: teams.id })
      .from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
      .where(and(eq(teamMemberships.userId, blockedUserId), isNull(teamMemberships.leftAt), eq(teams.status, "active")))
      .orderBy(asc(teams.id));
    for (const candidate of candidates) {
      const [team] = await db.select().from(teams).where(eq(teams.id, candidate.id)).for("update");
      if (!team || team.status !== "active" || team.captainUserId !== blockedUserId) continue;
      const members = await db
        .select({ userId: teamMemberships.userId, joinedAt: teamMemberships.joinedAt, status: users.status })
        .from(teamMemberships)
        .innerJoin(users, eq(users.id, teamMemberships.userId))
        .where(and(eq(teamMemberships.teamId, team.id), isNull(teamMemberships.leftAt)));
      const next = selectNewCaptain(
        members.map((member) => ({ userId: member.userId, joinedAt: member.joinedAt.getTime(), status: member.status })),
        blockedUserId,
      );
      const now = this.clock.now();
      if (!next) {
        await db.update(teams).set({ status: "archived", archivedAt: now, updatedAt: now }).where(eq(teams.id, team.id));
        await this.cancelPendingInvitations(db, team.id, now);
        continue;
      }
      await db.update(teams).set({ captainUserId: next, updatedAt: now }).where(eq(teams.id, team.id));
      await db.insert(notifications).values({
        userId: next,
        type: "captain_assigned",
        title: "Вы капитан",
        body: `Вы стали капитаном команды «${team.name}»`,
        payload: { teamId: team.id },
      });
    }
  }

  async transferCaptainOnBlock(blockedUserId: string, transactionDb?: Db) {
    if (transactionDb) return this.transferCaptainOnBlockLocked(blockedUserId, transactionDb);
    return this.db.transaction((transaction) =>
      this.transferCaptainOnBlockLocked(blockedUserId, transaction as unknown as Db),
    );
  }

  async listForUser(userId: string) {
    const memberships = await this.db
      .select({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
      .where(and(eq(teamMemberships.userId, userId), isNull(teamMemberships.leftAt), eq(teams.status, "active")))
      .orderBy(asc(teams.createdAt));
    return Promise.all(memberships.map((membership) => this.getForUser(membership.teamId, userId)));
  }

  /** Auto-add teammate user ids for match/tournament participant pickers. */
  async teammateIds(userId: string): Promise<string[]> {
    const myTeams = await this.listForUser(userId);
    const ids = new Set<string>();
    for (const t of myTeams) {
      for (const m of t.members) {
        if (m.userId !== userId) ids.add(m.userId);
      }
    }
    return [...ids];
  }
}
