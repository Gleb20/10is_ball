import type {
  BracketGraphV2,
  BracketMatchNode,
  ParticipantSource,
} from "./types.js";

function isEmpty(src: ParticipantSource): boolean {
  return src.type === "empty";
}

function isAutoAdvanceNode(m: BracketMatchNode): boolean {
  const aEmpty = isEmpty(m.sourceA);
  const bEmpty = isEmpty(m.sourceB);
  return (aEmpty && !bEmpty) || (bEmpty && !aEmpty);
}

/**
 * Walk through auto-advance nodes until a match with two competing sources.
 * Used for third-place feeders (paths that form the final), not roundIndex semis.
 */
export function findLastCompetitiveMatchOnPath(
  graph: BracketGraphV2,
  source: ParticipantSource,
  visiting: Set<string> = new Set(),
): BracketMatchNode | null {
  if (source.type !== "winner" && source.type !== "loser") {
    return null;
  }
  if (visiting.has(source.bracketMatchId)) return null;
  visiting.add(source.bracketMatchId);

  const match = graph.matches.find((m) => m.id === source.bracketMatchId);
  if (!match) return null;

  if (isAutoAdvanceNode(match)) {
    const nonEmpty = isEmpty(match.sourceA) ? match.sourceB : match.sourceA;
    return findLastCompetitiveMatchOnPath(graph, nonEmpty, visiting);
  }

  // Two non-empty sources → competitive
  if (!isEmpty(match.sourceA) && !isEmpty(match.sourceB)) {
    return match;
  }
  return null;
}

export function findChampionshipFinal(
  graph: BracketGraphV2,
): BracketMatchNode | null {
  if (graph.format !== "single_elimination") return null;
  const winners = graph.matches.filter((m) => m.stage === "winners");
  if (winners.length === 0) return null;
  const maxRound = Math.max(...winners.map((m) => m.roundIndex));
  return winners.find((m) => m.roundIndex === maxRound) ?? null;
}

/** Third-place sources from the two competitive feeders into the final. */
export function thirdPlaceSourcesFromFinal(
  graph: BracketGraphV2,
): { sourceA: ParticipantSource; sourceB: ParticipantSource } | null {
  const final = findChampionshipFinal(graph);
  if (!final) return null;
  const left = findLastCompetitiveMatchOnPath(graph, final.sourceA);
  const right = findLastCompetitiveMatchOnPath(graph, final.sourceB);
  if (!left || !right || left.id === right.id) return null;
  return {
    sourceA: { type: "loser", bracketMatchId: left.id },
    sourceB: { type: "loser", bracketMatchId: right.id },
  };
}
