import { and, eq, isNull, lte } from "drizzle-orm";
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

export class TeamService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async create(input: {
    name: string;
    captainUserId: string;
    slogan?: string;
    welcomeText?: string;
  }) {
    const base = slugify(input.name);
    const slug = `${base}-${Date.now().toString(36)}`;
    const [team] = await this.db
      .insert(teams)
      .values({
        name: input.name,
        slug,
        captainUserId: input.captainUserId,
        slogan: input.slogan,
        welcomeText: input.welcomeText,
      })
      .returning();
    await this.db.insert(teamMemberships).values({
      teamId: team!.id,
      userId: input.captainUserId,
      joinedAt: this.clock.now(),
    });
    return team;
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

  async invite(input: {
    teamId: string;
    invitedUserId: string;
    invitedByUserId: string;
  }) {
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      const [team] = await db
        .select()
        .from(teams)
        .where(eq(teams.id, input.teamId))
        .for("update");
      if (!team) {
        throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      }
      if (team.captainUserId !== input.invitedByUserId) {
        throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
      }

      const activeMembership = await db.query.teamMemberships.findFirst({
        where: and(
          eq(teamMemberships.teamId, input.teamId),
          eq(teamMemberships.userId, input.invitedUserId),
          isNull(teamMemberships.leftAt),
        ),
      });
      if (activeMembership) {
        throw Object.assign(new Error("ALREADY_IN_TEAM"), {
          code: "ALREADY_IN_TEAM",
        });
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
      await db
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.id, invitation.teamId))
        .for("update");
      const [inv] = await db
        .select()
        .from(teamInvitations)
        .where(eq(teamInvitations.id, input.invitationId))
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
            .update(teamInvitations)
            .set({ status: "expired", respondedAt: now })
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
      return { kind: "responded" as const, status };
    });
    if (outcome.kind === "expired") {
      throw Object.assign(new Error("EXPIRED"), { code: "EXPIRED" });
    }
    return { status: outcome.status };
  }

  async transferCaptainOnBlock(blockedUserId: string) {
    const captained = await this.db.query.teams.findMany({
      where: and(
        eq(teams.captainUserId, blockedUserId),
        eq(teams.status, "active"),
      ),
    });
    for (const team of captained) {
      const members = await this.db.query.teamMemberships.findMany({
        where: and(
          eq(teamMemberships.teamId, team.id),
          isNull(teamMemberships.leftAt),
        ),
      });
      const userRows = await Promise.all(
        members.map(async (m) => {
          const u = await this.db.query.users.findFirst({
            where: eq(users.id, m.userId),
          });
          return {
            userId: m.userId,
            joinedAt: m.joinedAt.getTime(),
            status: (u?.status ?? "blocked") as "active" | "blocked",
          };
        }),
      );
      const next = selectNewCaptain(userRows, blockedUserId);
      if (next) {
        await this.db
          .update(teams)
          .set({ captainUserId: next, updatedAt: this.clock.now() })
          .where(eq(teams.id, team.id));
        await this.db.insert(notifications).values({
          userId: next,
          type: "captain_assigned",
          title: "Вы капитан",
          body: `Вы стали капитаном команды «${team.name}»`,
          payload: { teamId: team.id },
        });
      }
    }
  }

  async listForUser(userId: string) {
    const memberships = await this.db.query.teamMemberships.findMany({
      where: and(
        eq(teamMemberships.userId, userId),
        isNull(teamMemberships.leftAt),
      ),
    });
    const result = [];
    for (const m of memberships) {
      const t = await this.get(m.teamId);
      if (t) result.push(t);
    }
    return result;
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
