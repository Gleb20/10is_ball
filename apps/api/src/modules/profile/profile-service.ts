import { and, count, eq, inArray, isNull, ne } from "drizzle-orm";
import { pickRival } from "@tab10/shared";
import type { Db } from "../../db/client.js";
import {
  judgeSessions,
  matchParticipants,
  matches,
  teamMemberships,
  teams,
  tournamentParticipants,
  tournaments,
  users,
} from "../../db/schema.js";
import type { MatchService } from "../matches/match-service.js";

const RESULT_STATUSES = ["finished", "stopped"] as const;
const TERMINAL_TOURNAMENT_STATUSES = ["finished", "stopped"] as const;

function durationSeconds(startedAt: Date | null, finishedAt: Date | null) {
  if (!startedAt || !finishedAt) return null;
  return Math.max(
    0,
    Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
  );
}

type OpponentFact = {
  userId: string;
  displayName: string;
  matchCount: number;
  lastPlayedAt: number;
};

export class ProfileService {
  constructor(
    private readonly db: Db,
    private readonly matchService: MatchService,
  ) {}

  async getProfile(actorUserId: string, targetUserId: string) {
    const target = await this.db.query.users.findFirst({
      where: eq(users.id, targetUserId),
    });
    if (!target) {
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    }

    const matchRows = await this.db
      .select({ participant: matchParticipants, match: matches })
      .from(matchParticipants)
      .innerJoin(matches, eq(matches.id, matchParticipants.matchId))
      .where(
        and(
          eq(matchParticipants.userId, targetUserId),
          inArray(matches.status, RESULT_STATUSES),
          ne(matches.kind, "tutorial"),
        ),
      );
    const resultRows = matchRows.filter(({ match }) => Boolean(match.winnerSide));
    const matchIds = resultRows.map(({ match }) => match.id);
    const allParticipants =
      matchIds.length > 0
        ? await this.db
            .select({
              matchId: matchParticipants.matchId,
              side: matchParticipants.side,
              userId: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
            })
            .from(matchParticipants)
            .innerJoin(users, eq(users.id, matchParticipants.userId))
            .where(inArray(matchParticipants.matchId, matchIds))
        : [];

    let wins = 0;
    let points = 0;
    const opponents = new Map<string, OpponentFact>();
    for (const { participant, match } of resultRows) {
      const won = participant.side === match.winnerSide;
      if (won) wins += 1;
      points += participant.side === "A" ? match.scoreA : match.scoreB;
      const occurredAt = (match.finishedAt ?? match.updatedAt).getTime();
      for (const opponent of allParticipants) {
        if (
          opponent.matchId !== match.id ||
          opponent.userId === targetUserId ||
          opponent.side === participant.side
        ) {
          continue;
        }
        const current = opponents.get(opponent.userId);
        opponents.set(opponent.userId, {
          userId: opponent.userId,
          displayName: `${opponent.lastName} ${opponent.firstName}`.trim(),
          matchCount: (current?.matchCount ?? 0) + 1,
          lastPlayedAt: Math.max(current?.lastPlayedAt ?? 0, occurredAt),
        });
      }
    }

    const opponentFacts = [...opponents.values()].sort(
      (a, b) =>
        b.matchCount - a.matchCount ||
        b.lastPlayedAt - a.lastPlayedAt ||
        a.displayName.localeCompare(b.displayName, "ru") ||
        a.userId.localeCompare(b.userId),
    );
    const rivalId = pickRival(opponentFacts);
    const rival = rivalId ? opponents.get(rivalId) ?? null : null;

    const longestMatch = resultRows
      .map(({ match }) => ({
        matchId: match.id,
        title: match.title,
        durationSeconds: durationSeconds(match.startedAt, match.finishedAt),
        occurredAt: (match.finishedAt ?? match.updatedAt).getTime(),
      }))
      .filter(
        (fact): fact is typeof fact & { durationSeconds: number } =>
          fact.durationSeconds !== null,
      )
      .sort(
        (a, b) =>
          b.durationSeconds - a.durationSeconds ||
          b.occurredAt - a.occurredAt ||
          a.matchId.localeCompare(b.matchId),
      )[0];
    const bestWinningScore = resultRows
      .filter(({ participant, match }) => participant.side === match.winnerSide)
      .map(({ participant, match }) => {
        const ownScore = participant.side === "A" ? match.scoreA : match.scoreB;
        const opponentScore = participant.side === "A" ? match.scoreB : match.scoreA;
        return {
          matchId: match.id,
          title: match.title,
          score: `${ownScore}:${opponentScore}`,
          margin: ownScore - opponentScore,
          occurredAt: (match.finishedAt ?? match.updatedAt).getTime(),
        };
      })
      .sort(
        (a, b) =>
          b.margin - a.margin ||
          b.occurredAt - a.occurredAt ||
          a.matchId.localeCompare(b.matchId),
      )[0];

    const tournamentRows = await this.db
      .select({ participant: tournamentParticipants, tournament: tournaments })
      .from(tournamentParticipants)
      .innerJoin(
        tournaments,
        eq(tournaments.id, tournamentParticipants.tournamentId),
      )
      .where(
        and(
          eq(tournamentParticipants.userId, targetUserId),
          ne(tournamentParticipants.status, "withdrawn"),
          inArray(tournaments.status, TERMINAL_TOURNAMENT_STATUSES),
        ),
      );
    const tournamentWins = tournamentRows.filter(({ participant, tournament }) => {
      const bracket = tournament.bracketJson as {
        championParticipantId?: string | null;
      } | null;
      return (
        tournament.status === "finished" &&
        bracket?.championParticipantId === participant.id
      );
    }).length;
    const [createdTournamentCount] = await this.db
      .select({ value: count() })
      .from(tournaments)
      .where(eq(tournaments.createdByUserId, targetUserId));
    const judgedRows = await this.db
      .select({ matchId: judgeSessions.matchId })
      .from(judgeSessions)
      .innerJoin(matches, eq(matches.id, judgeSessions.matchId))
      .where(
        and(eq(judgeSessions.userId, targetUserId), ne(matches.kind, "tutorial")),
      );
    const teamRows = await this.db
      .select({
        id: teams.id,
        name: teams.name,
        captainUserId: teams.captainUserId,
      })
      .from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
      .where(
        and(
          eq(teamMemberships.userId, targetUserId),
          isNull(teamMemberships.leftAt),
          eq(teams.status, "active"),
        ),
      );
    const ranking = await this.matchService.getRankings("all_time");
    const rankIndex = ranking.findIndex((entry) => entry.userId === targetUserId);
    const isOwn = actorUserId === targetUserId;
    const identity = {
      id: target.id,
      firstName: target.firstName,
      lastName: target.lastName,
      displayName: `${target.lastName} ${target.firstName}`.trim(),
      avatarKey: target.generatedAvatarKey ?? null,
      organizationText: target.organizationText ?? null,
      positionText: target.positionText ?? null,
      ...(isOwn
        ? { email: target.email, birthDate: target.birthDate ?? null }
        : {}),
    };

    return {
      isOwn,
      canChallenge: !isOwn && target.status === "active",
      identity,
      avatar: {
        key: target.generatedAvatarKey ?? null,
        editable: false,
      },
      stats: {
        matchesPlayed: resultRows.length,
        wins,
        losses: resultRows.length - wins,
        winRate: resultRows.length > 0 ? wins / resultRows.length : 0,
        averagePoints:
          resultRows.length > 0
            ? Math.round((points / resultRows.length) * 10) / 10
            : 0,
        tournamentsPlayed: tournamentRows.length,
        tournamentWins,
        tournamentsCreated: Number(createdTournamentCount?.value ?? 0),
        judgedMatches: new Set(judgedRows.map((row) => row.matchId)).size,
        rank: rankIndex >= 0 ? rankIndex + 1 : null,
      },
      facts: {
        longestMatch: longestMatch
          ? {
              matchId: longestMatch.matchId,
              title: longestMatch.title,
              durationSeconds: longestMatch.durationSeconds,
            }
          : null,
        bestWinningScore: bestWinningScore
          ? {
              matchId: bestWinningScore.matchId,
              title: bestWinningScore.title,
              score: bestWinningScore.score,
            }
          : null,
        frequentOpponent: opponentFacts[0]
          ? {
              userId: opponentFacts[0].userId,
              displayName: opponentFacts[0].displayName,
              matchCount: opponentFacts[0].matchCount,
            }
          : null,
        rival: rival
          ? {
              userId: rival.userId,
              displayName: rival.displayName,
              matchCount: rival.matchCount,
            }
          : null,
      },
      teams: teamRows.map((team) => ({
        id: team.id,
        name: team.name,
        role: team.captainUserId === targetUserId ? "captain" : "member",
      })),
    };
  }
}
