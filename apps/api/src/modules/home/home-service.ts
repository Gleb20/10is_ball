import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { pickRival, type RankingScope } from "@tab10/shared";
import type { Clock } from "@tab10/test-utils";
import type { Db } from "../../db/client.js";
import { judgeSessions, matchParticipants, tournamentParticipants, users } from "../../db/schema.js";
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

type CurrentRole = "player" | "current_judge" | "organizer";

function currentTaskPriority(event: { type: "match" | "tournament"; status: string; currentRoles: CurrentRole[]; hasCurrentMatch?: boolean }) {
  const live = event.status === "in_progress" || event.status === "pending_confirmation";
  const playingOrJudging = event.currentRoles.includes("player") || event.currentRoles.includes("current_judge");
  if (live && event.type === "match" && playingOrJudging) return 0;
  if (event.type === "tournament" && event.hasCurrentMatch) return 1;
  if (event.type === "match" && playingOrJudging) return 2;
  if (live && event.type === "match") return 3;
  if (live) return 4;
  if (event.type === "match") return 5;
  return 6;
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
    recentRole: "all" | "player" = "all",
  ) {
    const [visibleMatches, visibleTournaments, actorParticipantRows, actorTournamentRows, actorCurrentJudgeRows, rankings, allTimeRankings] =
      await Promise.all([
        // MatchService applies actor visibility before its limit. The returned
        // rows let Home select detail IDs without materializing club history.
        this.matches.listMatches(actorUserId, Number.MAX_SAFE_INTEGER),
        this.tournaments.list(actorUserId),
        this.db.query.matchParticipants.findMany({ where: eq(matchParticipants.userId, actorUserId) }),
        this.db.query.tournamentParticipants.findMany({ where: eq(tournamentParticipants.userId, actorUserId) }),
        this.db.query.judgeSessions.findMany({ where: and(
          eq(judgeSessions.userId, actorUserId), isNull(judgeSessions.releasedAt),
          isNull(judgeSessions.reservedForUserId), gt(judgeSessions.expiresAt, this.clock.now()),
        ) }),
        this.matches.getRankings(rankingPeriod),
        rankingPeriod === "all_time"
          ? Promise.resolve(null)
          : this.matches.getRankings("all_time"),
      ]);
    const actorMatchIds = new Set(actorParticipantRows.map((row) => row.matchId));
    const standaloneRows = visibleMatches.filter((match) => match.kind === "standalone");
    const activeMatchRows = standaloneRows.filter((match) => !TERMINAL_MATCH_STATUSES.has(match.status));
    const activeTournamentRow = [...visibleTournaments]
      .filter((tournament) => !TERMINAL_TOURNAMENT_STATUSES.has(tournament.status))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    const playerTournamentIds = new Set(actorTournamentRows.map((participant) => participant.tournamentId));
    const activePlayerTournamentIds = new Set(actorTournamentRows
      .filter((participant) => !participant.status || participant.status === "active")
      .map((participant) => participant.tournamentId));
    const activeJudgeMatchIds = new Set(actorCurrentJudgeRows.map((session) => session.matchId));
    const activeJudgeTournamentIds = new Set(visibleMatches
      .filter((match) => match.tournamentId && !TERMINAL_MATCH_STATUSES.has(match.status) && activeJudgeMatchIds.has(match.id))
      .map((match) => match.tournamentId!));
    const ownActiveTournamentRows = visibleTournaments.filter((tournament) =>
      !TERMINAL_TOURNAMENT_STATUSES.has(tournament.status) && (
        tournament.createdByUserId === actorUserId ||
        activePlayerTournamentIds.has(tournament.id) || activeJudgeTournamentIds.has(tournament.id)
      ));
    const recentCandidates = [
      ...standaloneRows
        .filter((match) => TERMINAL_MATCH_STATUSES.has(match.status) && (recentRole === "all" || actorMatchIds.has(match.id)))
        .map((match) => ({ type: "match" as const, match, occurredAt: (match.finishedAt ?? match.updatedAt).getTime() })),
      ...visibleTournaments
        .filter((tournament) => TERMINAL_TOURNAMENT_STATUSES.has(tournament.status) && (recentRole === "all" || playerTournamentIds.has(tournament.id)))
        .map((tournament) => ({ type: "tournament" as const, tournament, occurredAt: (tournament.finishedAt ?? tournament.updatedAt).getTime() })),
    ].sort((a, b) => b.occurredAt - a.occurredAt || a.type.localeCompare(b.type) || (a.type === "match" ? a.match.id : a.tournament.id).localeCompare(b.type === "match" ? b.match.id : b.tournament.id));
    const detailIds = new Set([
      ...activeMatchRows.map((match) => match.id),
      ...recentCandidates.slice(0, 5).filter((candidate) => candidate.type === "match").map((candidate) => candidate.match.id),
    ]);
    const details = await Promise.all([...detailIds].map((id) => this.matches.getMatch(id)));
    const detailById = new Map(details.filter((detail): detail is MatchDetail => Boolean(detail)).map((detail) => [detail.id, detail]));
    const actorParticipantsByMatch = new Map(actorParticipantRows.map((row) => [row.matchId, row]));
    const played = standaloneRows.filter((match) =>
      RESULT_MATCH_STATUSES.has(match.status) && Boolean(match.winnerSide) && actorParticipantsByMatch.has(match.id),
    );
    const registeredOpponents = played.length > 0
      ? await this.db.select({
          matchId: matchParticipants.matchId,
          side: matchParticipants.side,
          userId: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        }).from(matchParticipants)
          .innerJoin(users, eq(users.id, matchParticipants.userId))
          .where(inArray(matchParticipants.matchId, played.map((match) => match.id)))
      : [];
    const opponentsByMatch = new Map<string, typeof registeredOpponents>();
    for (const opponent of registeredOpponents) {
      const list = opponentsByMatch.get(opponent.matchId) ?? [];
      list.push(opponent);
      opponentsByMatch.set(opponent.matchId, list);
    }
    const allTime = allTimeRankings ?? rankings;
    const actorRankIndex = allTime.findIndex(
      (entry) => entry.userId === actorUserId,
    );
    const actorRanking = actorRankIndex >= 0 ? allTime[actorRankIndex]! : null;

    const opponents = new Map<
      string,
      { userId: string; displayName: string; matchCount: number; lastPlayedAt: number }
    >();
    let actorPoints = 0;
    let wins = 0;
    for (const match of played) {
      const actorParticipant = actorParticipantsByMatch.get(match.id)!;
      if (actorParticipant.side === match.winnerSide) wins += 1;
      actorPoints += actorParticipant.side === "A" ? match.scoreA : match.scoreB;
      const occurredAt = (match.finishedAt ?? match.updatedAt).getTime();
      for (const opponent of opponentsByMatch.get(match.id) ?? []) {
        if (opponent.userId === actorUserId) continue;
        if (opponent.side === actorParticipant.side) continue;
        const current = opponents.get(opponent.userId);
        opponents.set(opponent.userId, {
          userId: opponent.userId,
          displayName: `${opponent.lastName} ${opponent.firstName}`.trim(),
          matchCount: (current?.matchCount ?? 0) + 1,
          lastPlayedAt: Math.max(current?.lastPlayedAt ?? 0, occurredAt),
        });
      }
    }
    const rivalId = pickRival([...opponents.values()]);
    const rival = rivalId ? opponents.get(rivalId) ?? null : null;

    const activeMatch = [...activeMatchRows]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((match) => detailById.get(match.id))
      .find((match): match is MatchDetail => Boolean(match));
    const recentEvents = (
      await Promise.all(recentCandidates.slice(0, 5).map(async (candidate) => {
        if (candidate.type === "match") {
          const detail = detailById.get(candidate.match.id);
          return detail ? this.matchCard(detail, actorUserId) : null;
        }
        const detail = await this.tournaments.get(candidate.tournament.id);
        return detail ? this.tournamentCard(detail, actorUserId) : null;
      }))
    ).filter((event): event is NonNullable<typeof event> => Boolean(event));

    const currentMatchCards = await Promise.all(
      activeMatchRows
        .map((match) => detailById.get(match.id))
        .filter((match): match is MatchDetail => Boolean(match))
        .map((match) => this.matchCard(match, actorUserId)),
    );
    const currentTournamentCards = await Promise.all(
      ownActiveTournamentRows
        .map(async (tournament) => {
          const detail = await this.tournaments.get(tournament.id);
          return detail ? this.tournamentCard(detail, actorUserId) : null;
        }),
    );
    const currentTasks = [...currentMatchCards, ...currentTournamentCards]
      .filter((event): event is NonNullable<typeof event> => event !== null && event.currentRoles.length > 0)
      .sort((a, b) => currentTaskPriority(a) - currentTaskPriority(b) ||
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() ||
        a.id.localeCompare(b.id));
    let activeTournamentCard = activeTournamentRow
      ? currentTournamentCards.find((card) => card?.id === activeTournamentRow.id) ?? null
      : null;
    if (activeTournamentRow && !activeTournamentCard) {
      // Preserve the legacy activeEvents projection for the one selected event,
      // without turning the rest of the admin catalog into personal tasks.
      const detail = await this.tournaments.get(activeTournamentRow.id);
      activeTournamentCard = detail ? await this.tournamentCard(detail, actorUserId) : null;
    }
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
      recentRole,
      myStats,
      currentTasks,
      activeEvents: {
        match: activeMatch
          ? await this.matchCard(activeMatch, actorUserId)
          : null,
        tournament: activeTournamentCard,
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
    const terminal = TERMINAL_MATCH_STATUSES.has(match.status);
    const judgeSession = terminal ? await this.db.query.judgeSessions.findFirst({
      where: eq(judgeSessions.matchId, match.id),
      orderBy: [desc(judgeSessions.acquiredAt)],
    }) : null;
    const judge = judgeSession
      ? await this.db.query.users.findFirst({
          where: eq(users.id, judgeSession.userId),
        })
      : null;
    const judgeName = terminal
      ? judge ? `${judge.lastName} ${judge.firstName}`.trim() : null
      : match.activeJudge?.displayName ?? null;
    const currentRoles: CurrentRole[] = terminal ? [] : [
      ...(actorParticipant ? ["player" as const] : []),
      ...(match.activeJudge?.userId === actorUserId ? ["current_judge" as const] : []),
      ...(match.createdByUserId === actorUserId ? ["organizer" as const] : []),
    ];
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
      winnerSide: match.winnerSide === "A" || match.winnerSide === "B" ? match.winnerSide : null,
      durationSeconds: durationSeconds(
        match.startedAt,
        match.finishedAt ??
          (TERMINAL_MATCH_STATUSES.has(match.status) ? match.updatedAt : this.clock.now()),
      ),
      format: match.format,
      judgeName,
      currentRoles,
      updatedAt: match.updatedAt.toISOString(),
      userRole: actorParticipant
        ? ("participant" as const)
        : match.activeJudge?.userId === actorUserId || (terminal && judgeSession?.userId === actorUserId)
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
    const [participantRows, sessionRows] = await Promise.all([
      matchIds.length > 0
        ? this.db.query.matchParticipants.findMany({
            where: inArray(matchParticipants.matchId, matchIds),
          })
        : Promise.resolve([]),
      matchIds.length > 0
        ? this.db.query.judgeSessions.findMany({
            where: inArray(judgeSessions.matchId, matchIds),
          })
        : Promise.resolve([]),
    ]);
    const registeredIds = [...new Set(participantRows.map((row) => row.userId).filter((id): id is string => Boolean(id)))];
    const registered = registeredIds.length > 0
      ? await this.db.query.users.findMany({ where: inArray(users.id, registeredIds) })
      : [];
    const usersById = new Map(registered.map((user) => [user.id, user]));
    const participantsByMatch = new Map<string, typeof participantRows>();
    for (const row of participantRows) {
      const group = participantsByMatch.get(row.matchId) ?? [];
      group.push(row);
      participantsByMatch.set(row.matchId, group);
    }
    const matchById = new Map(tournament.matches.map((match) => [match.id, match]));
    const activeJudgeMatchIds = new Set(sessionRows
      .filter((session) => session.userId === actorUserId && session.releasedAt === null &&
        session.reservedForUserId === null && session.expiresAt > this.clock.now())
      .map((session) => session.matchId));
    const displayName = (participant: (typeof participantRows)[number]) => {
      if (participant.isTutorialActor) return "Призрачный Олег";
      const user = participant.userId ? usersById.get(participant.userId) : null;
      if (user) return `${user.lastName} ${user.firstName}`.trim();
      const guest = [participant.guestFirstName, participant.guestLastName].filter(Boolean).join(" ").trim();
      return guest || (participant.side === "A" ? "Сторона A" : "Сторона B");
    };
    const winsByName = new Map<string, number>();
    for (const match of tournament.matches) {
      if (!match.winnerSide) continue;
      for (const participant of participantsByMatch.get(match.id) ?? []) {
        if (participant.side !== match.winnerSide) continue;
        const name = displayName(participant);
        winsByName.set(
          name,
          (winsByName.get(name) ?? 0) + 1,
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
    const judged = sessionRows.some(
      (session) => session.userId === actorUserId,
    );
    const terminal = TERMINAL_TOURNAMENT_STATUSES.has(tournament.status);
    const currentJudge = [...activeJudgeMatchIds].some((id) =>
      !TERMINAL_MATCH_STATUSES.has(matchById.get(id)?.status ?? "finished"),
    );
    const hasCurrentMatch = tournament.matches.some((match) =>
      !TERMINAL_MATCH_STATUSES.has(match.status) && (
        activeJudgeMatchIds.has(match.id) ||
        ((match.status === "in_progress" || match.status === "pending_confirmation") &&
          (participantsByMatch.get(match.id) ?? []).some((participant) => participant.userId === actorUserId))
      ),
    );
    const currentRoles: CurrentRole[] = terminal ? [] : [
      ...(participated ? ["player" as const] : []),
      ...(currentJudge ? ["current_judge" as const] : []),
      ...(tournament.createdByUserId === actorUserId ? ["organizer" as const] : []),
    ];
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
      currentRoles,
      hasCurrentMatch: !terminal && hasCurrentMatch,
      updatedAt: tournament.updatedAt.toISOString(),
      userRole: participated
        ? ("participant" as const)
        : currentJudge || (terminal && judged)
          ? ("judge" as const)
          : tournament.createdByUserId === actorUserId
            ? ("organizer" as const)
            : ("viewer" as const),
      occurredAt: (tournament.finishedAt ?? tournament.updatedAt).toISOString(),
    };
  }
}
