import type {
  BracketGraphV2,
  BracketMatchNode,
  ParticipantSource,
  SourceResolution,
} from "./types.js";

function byId(graph: BracketGraphV2): Map<string, BracketMatchNode> {
  return new Map(graph.matches.map((m) => [m.id, m]));
}

/**
 * Resolve one source without caching participants on the node.
 */
export function resolveSource(
  graph: BracketGraphV2,
  source: ParticipantSource,
  visiting: Set<string> = new Set(),
): SourceResolution {
  if (source.type === "empty") {
    return { kind: "structurally_empty" };
  }
  if (source.type === "seed") {
    const pid = graph.seedOrder[source.seed - 1];
    if (!pid) return { kind: "structurally_empty" };
    return { kind: "resolved", participantId: pid };
  }

  const key = `${source.type}:${source.bracketMatchId}`;
  if (visiting.has(key)) return { kind: "pending" };
  visiting.add(key);

  const match = byId(graph).get(source.bracketMatchId);
  if (!match) return { kind: "pending" };

  // Inactive conditional match → pending for dependents that need a result
  if (match.activationCondition && !isActivationSatisfied(graph, match)) {
    visiting.delete(key);
    return { kind: "pending" };
  }

  if (match.cancelled) {
    visiting.delete(key);
    return { kind: "pending" };
  }

  if (source.type === "winner") {
    if (match.winnerParticipantId) {
      visiting.delete(key);
      return { kind: "resolved", participantId: match.winnerParticipantId };
    }
    // Auto-advance / structural empty of feeder
    const a = resolveSource(graph, match.sourceA, visiting);
    const b = resolveSource(graph, match.sourceB, visiting);
    if (
      a.kind === "structurally_empty" &&
      b.kind === "structurally_empty"
    ) {
      visiting.delete(key);
      return { kind: "structurally_empty" };
    }
    if (a.kind === "resolved" && b.kind === "structurally_empty") {
      visiting.delete(key);
      return a;
    }
    if (b.kind === "resolved" && a.kind === "structurally_empty") {
      visiting.delete(key);
      return b;
    }
    visiting.delete(key);
    return { kind: "pending" };
  }

  // loser
  if (match.loserParticipantId) {
    visiting.delete(key);
    return { kind: "resolved", participantId: match.loserParticipantId };
  }
  const a = resolveSource(graph, match.sourceA, visiting);
  const b = resolveSource(graph, match.sourceB, visiting);
  // Auto-advanced match has no loser
  if (
    (a.kind === "resolved" && b.kind === "structurally_empty") ||
    (b.kind === "resolved" && a.kind === "structurally_empty")
  ) {
    visiting.delete(key);
    return { kind: "structurally_empty" };
  }
  if (a.kind === "structurally_empty" && b.kind === "structurally_empty") {
    visiting.delete(key);
    return { kind: "structurally_empty" };
  }
  visiting.delete(key);
  return { kind: "pending" };
}

export function isActivationSatisfied(
  graph: BracketGraphV2,
  match: BracketMatchNode,
): boolean {
  const cond = match.activationCondition;
  if (!cond) return true;
  if (cond.type === "gf1_won_by_source_b") {
    const gf = byId(graph).get(cond.grandFinalMatchId);
    if (!gf?.winnerParticipantId) return false;
    const sideB = resolveSource(graph, gf.sourceB);
    return (
      sideB.kind === "resolved" &&
      sideB.participantId === gf.winnerParticipantId
    );
  }
  return true;
}

/** Apply auto-advances to fixpoint (writes winner on nodes that auto-advance). */
export function propagateByesFixpoint(graph: BracketGraphV2): BracketGraphV2 {
  let changed = true;
  let current = graph;
  let guard = 0;
  while (changed && guard < 10_000) {
    guard += 1;
    changed = false;
    const nextMatches = current.matches.map((m) => ({ ...m }));
    const nextGraph = { ...current, matches: nextMatches };

    for (const m of nextMatches) {
      if (m.cancelled || m.winnerParticipantId) continue;
      if (m.activationCondition && !isActivationSatisfied(nextGraph, m)) {
        continue;
      }
      const a = resolveSource(nextGraph, m.sourceA);
      const b = resolveSource(nextGraph, m.sourceB);
      if (a.kind === "resolved" && b.kind === "structurally_empty") {
        m.winnerParticipantId = a.participantId;
        m.loserParticipantId = null;
        changed = true;
      } else if (b.kind === "resolved" && a.kind === "structurally_empty") {
        m.winnerParticipantId = b.participantId;
        m.loserParticipantId = null;
        changed = true;
      }
    }
    current = nextGraph;
  }
  return current;
}
