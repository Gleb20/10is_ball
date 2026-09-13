import { and, asc, eq, isNull } from "drizzle-orm";
import { teamAggregateWins, type RankingScope } from "@tab10/shared";
import type { Db } from "../../db/client.js";
import { teamMemberships, teams, users } from "../../db/schema.js";
import type { MatchService } from "../matches/match-service.js";

type PublicRankingRow = {
  userId: string;
  displayName: string;
  wins: number;
  losses: number;
  matchesPlayed: number;
  winRate: number;
  avatarKey: string | null;
};

function publicRankingRow(entry: {
  userId: string;
  displayName: string;
  wins: number;
  losses: number;
  matchesPlayed: number;
  winRate: number;
  avatarKey?: string | null;
}): PublicRankingRow {
  return {
    userId: entry.userId,
    displayName: entry.displayName,
    wins: entry.wins,
    losses: entry.losses,
    matchesPlayed: entry.matchesPlayed,
    winRate: entry.winRate,
    avatarKey: entry.avatarKey ?? null,
  };
}

export class RankingService {
  constructor(
    private readonly db: Db,
    private readonly matches: MatchService,
  ) {}

  private async availableTeams(actorUserId: string) {
    return this.db
      .select({ id: teams.id, name: teams.name })
      .from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
      .where(
        and(
          eq(teamMemberships.userId, actorUserId),
          isNull(teamMemberships.leftAt),
          eq(teams.status, "active"),
        ),
      )
      .orderBy(asc(teams.name), asc(teams.id));
  }

  private async selectedTeam(actorUserId: string, teamId: string) {
    const [team] = await this.db
      .select({ id: teams.id, name: teams.name })
      .from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
      .where(
        and(
          eq(teamMemberships.userId, actorUserId),
          eq(teamMemberships.teamId, teamId),
          isNull(teamMemberships.leftAt),
          eq(teams.status, "active"),
        ),
      )
      .limit(1);
    if (!team) {
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    }
    return team;
  }

  private async activeMemberIds(teamId: string) {
    const rows = await this.db
      .select({ userId: teamMemberships.userId })
      .from(teamMemberships)
      .innerJoin(users, eq(users.id, teamMemberships.userId))
      .where(
        and(
          eq(teamMemberships.teamId, teamId),
          isNull(teamMemberships.leftAt),
          eq(users.status, "active"),
        ),
      );
    return new Set(rows.map((row) => row.userId));
  }

  async list(input: {
    actorUserId: string;
    scope: RankingScope;
    teamId?: string;
  }) {
    const availableTeams = await this.availableTeams(input.actorUserId);
    if (!input.teamId) {
      const entries = await this.matches.getRankings(input.scope);
      return {
        scope: input.scope,
        team: null,
        availableTeams,
        rankings: entries.map(publicRankingRow),
      };
    }

    const team = await this.selectedTeam(input.actorUserId, input.teamId);
    const memberIds = await this.activeMemberIds(team.id);
    const periodEntries = await this.matches.getRankings(input.scope, memberIds);
    const allTimeEntries =
      input.scope === "all_time"
        ? periodEntries
        : await this.matches.getRankings("all_time", memberIds);
    return {
      scope: input.scope,
      team: {
        ...team,
        activeMemberCount: memberIds.size,
        winsAllTime: teamAggregateWins(allTimeEntries.map((entry) => entry.wins)),
      },
      availableTeams,
      rankings: periodEntries.map(publicRankingRow),
    };
  }

}
