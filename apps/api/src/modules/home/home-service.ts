import { desc, eq, inArray } from "drizzle-orm";
import { pickRival, type RankingScope } from "@tab10/shared";
import type { Clock } from "@tab10/test-utils";
import type { Db } from "../../db/client.js";
import { judgeSessions, users } from "../../db/schema.js";
import type { MatchService } from "../matches/match-service.js";
import type { TournamentService } from "../tournaments/tournament-service.js";

const TERMINAL_MATCH_STATUSES = new Set([
  "finished",
  "stopped",
  "cancelled",
  "voided",
]);
const RESULT_MATCH_STATUSES = new Set(["finished", "stopped"]);
const TERMINAL_TOURNAMENT_STATUSES = new Set([
  "finished",
  "stopped",
  "cancelled",
]);

type MatchDetail = NonNullable<
  Awaited<ReturnType<MatchService["getMatch"]>>
>;
type TournamentDetail = NonNullable<
  Awaited<ReturnType<TournamentService["get"]>>
>;

function durationSeconds(
  startedAt: Date | null,
  endedAt: Date | null,
): number | null {
  if (!startedAt || !endedAt) return null;
  return Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
}

function sideName(detail: MatchDetail, side: string) {
  return detail.participants
    .filter((participant) => participant.side === side)
    .map((participant) => participant.displayName)
    .join(" / ");
}

export class HomeService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly matches: MatchService,
    private readonly tournaments: TournamentService,
  ) {}

  async dashboard(
    actorUserId: string,
    rankingPeriod: Extract<RankingScope, "all_time" | "month">,
  ) {
    const [visibleMatches, visibleTournaments, rankings, allTimeRankings] =
      await Promise.all([
        this.matches.listMatches(actorUserId, 50),
        this.tournaments.list(actorUserId),
        this.matches.getRankings(rankingPeriod),
        rankingPeriod === "all_time"
          ? Promise.resolve(null)
          : this.matches.getRankings("all_time"),
      ]);
    const matchDetails = (
      await Promise.all(
        visibleMatches.map((match) => this.matches.getMatch(match.id)),
      )
    ).filter((match): match is MatchDetail => Boolean(match));
    const allTime = allTimeRankings ?? rankings;
    const actorRankIndex = allTime.findIndex(
      (entry) => entry.userId === actorUserId,
    );
    const actorRanking = actorRankIndex >= 0 ? allTime[actorRankIndex]! : null;

    const played = matchDetails.filter(
      (match) =>
        match.kind === "standalone" &&
        RESULT_MATCH_STATUSES.has(match.status) &&
        Boolean(match.winnerSide) &&
        match.participants.some(
          (participant) => participant.userId === actorUserId,
        ),
    );
    const opponents = new Map<
      string,
      { userId: string; displayName: string; matchCount: number; lastPlayedAt: number }
    >();
    let actorPoints = 0;
    let wins = 0;
    for (const match of played) {
      const actorParticipant = match.participants.find(
        (participant) => participant.userId === actorUserId,
      )!;
      if (actorParticipant.side === match.winnerSide) wins += 1;
      actorPoints += actorParticipant.side === "A" ? match.scoreA : match.scoreB;
      const occurredAt = (match.finishedAt ?? match.updatedAt).getTime();
      for (const opponent of match.participants) {
        if (!opponent.userId || opponent.userId === actorUserId) continue;
        if (opponent.side === actorParticipant.side) continue;
        const current = opponents.get(opponent.userId);
        opponents.set(opponent.userId, {
          userId: opponent.userId,
          displayName: opponent.displayName,
          matchCount: (current?.matchCount ?? 0) + 1,
          lastPlayedAt: Math.max(current?.lastPlayedAt ?? 0, occurredAt),
        });
      }
    }
    const rivalId = pickRival([...opponents.values()]);
    const rival = rivalId ? opponents.get(rivalId) ?? null : null;

    const activeMatch = matchDetails
      .filter(
        (match) =>
          match.kind === "standalone" &&
          !TERMINAL_MATCH_STATUSES.has(match.status),
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    const activeTournamentRow = [...visibleTournaments]
      .filter(
        (tournament) => !TERMINAL_TOURNAMENT_STATUSES.has(tournament.status),
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

    const recentMatches = await Promise.all(
      matchDetails
        .filter(
          (match) =>
            match.kind === "standalone" &&
            TERMINAL_MATCH_STATUSES.has(match.status),
        )
        .map((match) => this.matchCard(match, actorUserId)),
    );
    const recentTournamentRows = visibleTournaments.filter((tournament) =>
      TERMINAL_TOURNAMENT_STATUSES.has(tournament.status),
    );
    const recentTournaments = await Promise.all(
      recentTournamentRows.map(async (tournament) => {
        const detail = await this.tournaments.get(tournament.id);
        return detail ? this.tournamentCard(detail, actorUserId) : null;
      }),
    );
    const recentEvents = [...recentMatches, ...recentTournaments]
      .filter((event): event is NonNullable<typeof event> => Boolean(event))
      .sort(
        (a, b) =>
          new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
      )
      .slice(0, 5);

    const activeTournament = activeTournamentRow
      ? await this.tournaments.get(activeTournamentRow.id)
      : null;
    const myStats = {
      rank: actorRanking ? actorRankIndex + 1 : null,
      matchesPlayed: played.length,
      wins,
      losses: played.length - wins,
      winRate: played.length > 0 ? wins / played.length : 0,
      averagePoints:
        played.length > 0
          ? Math.round((actorPoints / played.length) * 10) / 10
          : 0,
      displayName: actorRanking?.displayName ?? "Игрок",
      avatarKey: actorRanking?.avatarKey ?? null,
      rival: rival
        ? {
            userId: rival.userId,
            displayName: rival.displayName,
            matchCount: rival.matchCount,
          }
        : null,
    };

    return {
      rankingPeriod,
      myStats,
      activeEvents: {
        match: activeMatch
          ? await this.matchCard(activeMatch, actorUserId)
          : null,
        tournament: activeTournament
          ? await this.tournamentCard(activeTournament, actorUserId)
          : null,
      },
      recentEvents,
      topRankings: rankings.slice(0, 3),
      // Compatibility for clients released before GAP-001.
      lastMatches: visibleMatches.slice(0, 5),
      hero: rankings[0]
        ? {
            type: "leader" as const,
            userId: rankings[0].userId,
            displayName: rankings[0].displayName,
            wins: rankings[0].wins,
            avatarKey: rankings[0].avatarKey ?? null,
          }
        : { type: "empty" as const },
    };
  }

  private async matchCard(match: MatchDetail, actorUserId: string) {
    const actorParticipant = match.participants.find(
      (participant) => participant.userId === actorUserId,
    );
    const judgeSession = await this.db.query.judgeSessions.findFirst({
      where: eq(judgeSessions.matchId, match.id),
      orderBy: [desc(judgeSessions.acquiredAt)],
    });
    const judge = judgeSession
      ? await this.db.query.users.findFirst({
          where: eq(users.id, judgeSession.userId),
        })
      : null;
    const judgeName = judge
      ? `${judge.lastName} ${judge.firstName}`.trim()
      : match.activeJudge?.displayName ?? null;
    const winnerName = match.winnerSide
      ? sideName(match, match.winnerSide)
      : null;
    return {
      type: "match" as const,
      id: match.id,
      title: match.title,
      status: match.status,
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      sideA: sideName(match, "A"),
      sideB: sideName(match, "B"),
      winnerName,
      durationSeconds: durationSeconds(
        match.startedAt,
        match.finishedAt ??
          (TERMINAL_MATCH_STATUSES.has(match.status) ? match.updatedAt : this.clock.now()),
      ),
      format: match.format,
      judgeName,
      userRole: actorParticipant
        ? ("participant" as const)
        : judgeSession?.userId === actorUserId || match.activeJudge?.userId === actorUserId
          ? ("judge" as const)
          : match.createdByUserId === actorUserId
            ? ("organizer" as const)
            : ("viewer" as const),
      occurredAt: (match.finishedAt ?? match.updatedAt).toISOString(),
    };
  }

  private async tournamentCard(
    tournament: TournamentDetail,
    actorUserId: string,
  ) {
    const matchIds = tournament.matches.map((match) => match.id);
    const [matchDetails, actorJudgeSessions] = await Promise.all([
      Promise.all(matchIds.map((id) => this.matches.getMatch(id))),
      matchIds.length > 0
        ? this.db.query.judgeSessions.findMany({
            where: inArray(judgeSessions.matchId, matchIds),
          })
        : Promise.resolve([]),
    ]);
    const winsByName = new Map<string, number>();
    for (const match of matchDetails) {
      if (!match?.winnerSide) continue;
      for (const participant of match.participants) {
        if (participant.side !== match.winnerSide) continue;
        winsByName.set(
          participant.displayName,
          (winsByName.get(participant.displayName) ?? 0) + 1,
        );
      }
    }
    const topThree = [...winsByName.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
      .slice(0, 3)
      .map(([name]) => name);
    const participated = tournament.participants.some(
      (participant) =>
        participant.userId === actorUserId &&
        (!participant.status || participant.status === "active"),
    );
    const judged = actorJudgeSessions.some(
      (session) => session.userId === actorUserId,
    );
    return {
      type: "tournament" as const,
      id: tournament.id,
      title: tournament.title,
      status: tournament.status,
      topThree,
      durationSeconds: durationSeconds(
        tournament.startedAt,
        tournament.finishedAt ??
          (TERMINAL_TOURNAMENT_STATUSES.has(tournament.status)
            ? tournament.updatedAt
            : this.clock.now()),
      ),
      userRole: participated
        ? ("participant" as const)
        : judged
          ? ("judge" as const)
          : tournament.createdByUserId === actorUserId
            ? ("organizer" as const)
            : ("viewer" as const),
      occurredAt: (tournament.finishedAt ?? tournament.updatedAt).toISOString(),
    };
  }
}
