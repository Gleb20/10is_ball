import { getMatchSides, listMatchPairs, parseBracketJson, type Bracket } from "@tab10/shared";

type Match = { id: string; tournamentSlotId: string | null; status: string; scoreA: number; scoreB: number };
type Tournament = { status: string; startedAt: Date | null; finishedAt: Date | null; bracketJson: unknown };

/** Read projection only: bracket determines places; non-void terminal matches determine statistics. */
export function tournamentSummary(tournament: Tournament, participantIds: string[], matches: Match[], now: Date) {
  const results = participantIds.map((participantId) => ({ participantId, points: 0, playedMatches: 0, place: null as number | null }));
  const byId = new Map(results.map((row) => [row.participantId, row]));
  const sidesBySlot = new Map<string, { a: string | null; b: string | null }>();
  const elimination = new Map<string, number>();
  let champion: string | null = null;
  let runnerUp: string | null = null;
  let third: string | null = null;
  let fourth: string | null = null;
  const parsed = parseBracketJson(tournament.bracketJson);
  if (parsed.kind === "v2") {
    const graph = parsed.graph;
    champion = graph.championParticipantId;
    runnerUp = graph.runnerUpParticipantId;
    third = graph.thirdPlaceParticipantId;
    for (const node of graph.matches) {
      const sides = getMatchSides(graph, node);
      sidesBySlot.set(node.id, { a: sides.a.kind === "resolved" ? sides.a.participantId : null, b: sides.b.kind === "resolved" ? sides.b.participantId : null });
      if (node.stage === "third_place") { fourth = node.loserParticipantId; continue; }
      if (node.loserParticipantId && (graph.format === "single_elimination" || node.stage !== "winners")) {
        const stage = node.stage === "grand_final_reset" ? 3 : node.stage === "grand_final" ? 2 : 1;
        elimination.set(node.loserParticipantId, stage * 10000 + node.roundIndex);
      }
    }
  } else if (parsed.kind === "v1") {
    const bracket = parsed.raw as Bracket;
    champion = bracket.championParticipantId;
    for (const pair of listMatchPairs(bracket)) {
      const { slotA: a, slotB: b } = pair;
      sidesBySlot.set(`${a.id},${b.id}`, { a: a.participantId, b: b.participantId });
      const winner = a.winnerParticipantId ?? b.winnerParticipantId;
      const loser = winner && a.participantId && b.participantId ? (winner === a.participantId ? b.participantId : a.participantId) : null;
      if (pair.side === "third_place") { third = winner; fourth = loser; }
      else if (loser) { elimination.set(loser, pair.round); if (winner === champion) runnerUp = loser; }
    }
  }
  if (tournament.status === "finished" && champion && byId.has(champion)) {
    byId.get(champion)!.place = 1;
    if (runnerUp && byId.has(runnerUp)) byId.get(runnerUp)!.place = 2;
    if (third && byId.has(third)) byId.get(third)!.place = 3;
    if (fourth && byId.has(fourth)) byId.get(fourth)!.place = 4;
    const remaining = results.filter((row) => row.place === null && elimination.has(row.participantId));
    remaining.sort((a, b) => elimination.get(b.participantId)! - elimination.get(a.participantId)!);
    let priorRound: number | undefined;
    const placedCount = results.filter((row) => row.place !== null).length;
    let place = placedCount;
    remaining.forEach((row, index) => {
      const round = elimination.get(row.participantId)!;
      if (round !== priorRound) place = placedCount + index + 1;
      row.place = place; priorRound = round;
    });
  }
  let playedMatchCount = 0;
  const matchParticipants = matches.map((match) => {
    const sides = match.tournamentSlotId ? sidesBySlot.get(match.tournamentSlotId) : undefined;
    if (match.status === "finished" || match.status === "stopped") {
      playedMatchCount += 1;
      for (const [participantId, score] of [[sides?.a, match.scoreA], [sides?.b, match.scoreB]] as const) {
        const row = participantId ? byId.get(participantId) : undefined;
        if (row) { row.points += score; row.playedMatches += 1; }
      }
    }
    return { matchId: match.id, participantIds: [sides?.a, sides?.b].filter((id): id is string => Boolean(id)) };
  });
  results.sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity) || b.points - a.points || a.participantId.localeCompare(b.participantId));
  return {
    durationSeconds: tournament.startedAt ? Math.max(0, Math.floor(((tournament.finishedAt ?? now).getTime() - tournament.startedAt.getTime()) / 1000)) : null,
    playedMatchCount,
    results,
    top3: results.filter((row) => row.place !== null && row.place <= 3).map((row) => row.participantId),
    matchParticipants,
  };
}
