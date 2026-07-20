import { and, eq, isNull } from "drizzle-orm";
import {
  TEAM_INVITATION_TTL_MS,
  isInvitationExpired,
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
    const team = await this.get(input.teamId);
    if (!team) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (team.captainUserId !== input.invitedByUserId) {
      throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    }
    const now = this.clock.now();
    const [inv] = await this.db
      .insert(teamInvitations)
      .values({
        teamId: input.teamId,
        invitedUserId: input.invitedUserId,
        invitedByUserId: input.invitedByUserId,
        expiresAt: new Date(now.getTime() + TEAM_INVITATION_TTL_MS),
        status: "pending",
      })
      .returning();
    await this.db.insert(notifications).values({
      userId: input.invitedUserId,
      type: "team_invitation",
      title: "Приглашение в команду",
      body: `Вас пригласили в команду «${team.name}»`,
      payload: { invitationId: inv!.id, teamId: team.id },
    });
    return inv;
  }

  async respondInvitation(input: {
    invitationId: string;
    userId: string;
    accept: boolean;
  }) {
    const inv = await this.db.query.teamInvitations.findFirst({
      where: eq(teamInvitations.id, input.invitationId),
    });
    if (!inv || inv.invitedUserId !== input.userId) {
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    }
    const now = this.clock.now().getTime();
    if (
      inv.status !== "pending" ||
      isInvitationExpired(inv.createdAt.getTime(), now)
    ) {
      await this.db
        .update(teamInvitations)
        .set({ status: "expired" })
        .where(eq(teamInvitations.id, inv.id));
      throw Object.assign(new Error("EXPIRED"), { code: "EXPIRED" });
    }
    const status = input.accept ? "accepted" : "declined";
    await this.db
      .update(teamInvitations)
      .set({ status, respondedAt: this.clock.now() })
      .where(eq(teamInvitations.id, inv.id));
    if (input.accept) {
      await this.db.insert(teamMemberships).values({
        teamId: inv.teamId,
        userId: input.userId,
        joinedAt: this.clock.now(),
      });
    }
    return { status };
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
