import {
  isActivationSatisfied,
  resolveSource,
} from "./resolve.js";
import type {
  BracketGraphV2,
  BracketMatchNode,
  DerivedMatchState,
} from "./types.js";

export function deriveBracketMatchState(
  graph: BracketGraphV2,
  matchId: string,
): DerivedMatchState {
  const match = graph.matches.find((m) => m.id === matchId);
  if (!match) return "blocked";
  if (match.cancelled) return "cancelled";
  if (match.activationCondition && !isActivationSatisfied(graph, match)) {
    return "inactive";
  }
  if (match.winnerParticipantId) return "completed";

  const a = resolveSource(graph, match.sourceA);
  const b = resolveSource(graph, match.sourceB);

  if (a.kind === "structurally_empty" && b.kind === "structurally_empty") {
    return "structurally_empty";
  }
  if (
    (a.kind === "resolved" && b.kind === "structurally_empty") ||
    (b.kind === "resolved" && a.kind === "structurally_empty")
  ) {
    return "auto_advance_eligible";
  }
  if (a.kind === "resolved" && b.kind === "resolved") {
    if (a.participantId === b.participantId) return "blocked";
    return "ready";
  }
  return "blocked";
}

export function isPermanentlyBlocked(
  graph: BracketGraphV2,
  matchId: string,
): boolean {
  const state = deriveBracketMatchState(graph, matchId);
  if (state === "inactive" || state === "structurally_empty") return false;
  if (state === "completed" || state === "cancelled") return false;
  if (state === "ready" || state === "auto_advance_eligible") return false;
  // blocked: check if any ancestor can still produce
  return !canEverBecomeReady(graph, matchId, new Set());
}

function canEverBecomeReady(
  graph: BracketGraphV2,
  matchId: string,
  seen: Set<string>,
): boolean {
  if (seen.has(matchId)) return false;
  seen.add(matchId);
  const m = graph.matches.find((x) => x.id === matchId);
  if (!m) return false;
  const activation = m.activationCondition;
  if (activation && !isActivationSatisfied(graph, m)) {
    // Might activate later
    if (activation.type === "gf1_won_by_source_b") {
      const gf = graph.matches.find(
        (x) => x.id === activation.grandFinalMatchId,
      );
      return Boolean(gf && !gf.winnerParticipantId);
    }
    return false;
  }
  const state = deriveBracketMatchState(graph, matchId);
  if (
    state === "ready" ||
    state === "auto_advance_eligible" ||
    state === "completed"
  ) {
    return true;
  }
  for (const src of [m.sourceA, m.sourceB]) {
    if (src.type === "winner" || src.type === "loser") {
      if (canEverBecomeReady(graph, src.bracketMatchId, seen)) return true;
    }
    if (src.type === "seed" || src.type === "empty") {
      /* leaf */
    }
  }
  return false;
}

export function listReadyMatchIds(graph: BracketGraphV2): string[] {
  return graph.matches
    .filter((m) => deriveBracketMatchState(graph, m.id) === "ready")
    .map((m) => m.id);
}

export function getMatchSides(
  graph: BracketGraphV2,
  match: BracketMatchNode,
): {
  a: ReturnType<typeof resolveSource>;
  b: ReturnType<typeof resolveSource>;
} {
  return {
    a: resolveSource(graph, match.sourceA),
    b: resolveSource(graph, match.sourceB),
  };
}
