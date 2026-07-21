import { nextPowerOf2 } from "./seed.js";
import { deriveBracketMatchState, isPermanentlyBlocked } from "./derive-state.js";
import type { BracketGraphV2 } from "./types.js";

export class BracketValidationError extends Error {
  constructor(
    message: string,
    readonly nodeId?: string,
    readonly invariant?: string,
  ) {
    super(message);
    this.name = "BracketValidationError";
  }
}

export function validateBracketGraph(graph: BracketGraphV2): void {
  if (graph.schemaVersion !== 2) {
    throw new BracketValidationError("schemaVersion must be 2", undefined, "schema");
  }
  if (
    graph.constructionAlgorithm !== "compact" &&
    graph.constructionAlgorithm !== "power_of_two"
  ) {
    throw new BracketValidationError(
      "invalid constructionAlgorithm",
      undefined,
      "construction_algorithm",
    );
  }
  if (graph.constructionAlgorithm === "compact") {
    if (graph.bracketSize !== undefined) {
      throw new BracketValidationError(
        "compact must not set bracketSize",
        undefined,
        "compact_no_bracket_size",
      );
    }
    if (graph.format === "double_elimination") {
      throw new BracketValidationError(
        "compact double elimination unsupported",
        undefined,
        "compact_de",
      );
    }
  }
  if (graph.constructionAlgorithm === "power_of_two") {
    if (
      typeof graph.bracketSize !== "number" ||
      graph.bracketSize !== nextPowerOf2(graph.participantCount)
    ) {
      throw new BracketValidationError(
        "power_of_two requires bracketSize = nextPowerOfTwo(N)",
        undefined,
        "po2_bracket_size",
      );
    }
  }
  const ids = new Set<string>();
  for (const m of graph.matches) {
    if (ids.has(m.id)) {
      throw new BracketValidationError(`Duplicate match id ${m.id}`, m.id, "unique_id");
    }
    ids.add(m.id);
  }

  if (graph.format === "double_elimination" && graph.thirdPlaceEnabled) {
    throw new BracketValidationError(
      "DE must not enable third place",
      undefined,
      "de_no_third",
    );
  }

  const seedSeen = new Set<number>();
  for (const m of graph.matches) {
    for (const src of [m.sourceA, m.sourceB]) {
      if (src.type === "seed") {
        if (seedSeen.has(src.seed)) {
          throw new BracketValidationError(
            `Duplicate seed ${src.seed}`,
            m.id,
            "seed_unique",
          );
        }
        seedSeen.add(src.seed);
      }
      if (src.type === "winner" || src.type === "loser") {
        if (!ids.has(src.bracketMatchId)) {
          throw new BracketValidationError(
            `Missing source match ${src.bracketMatchId}`,
            m.id,
            "source_exists",
          );
        }
      }
    }
  }

  // Every participant seed 1..N exactly once among seeds that exist
  for (let s = 1; s <= graph.participantCount; s += 1) {
    if (!seedSeen.has(s)) {
      throw new BracketValidationError(
        `Missing seed ${s}`,
        undefined,
        "seed_complete",
      );
    }
  }

  // SE: loser destinations only into third_place
  if (graph.format === "single_elimination") {
    for (const m of graph.matches) {
      if (m.stage === "third_place") continue;
      // no explicit loser dest stored — enforced by generate
    }
  }

  // GF2 activation shape
  const gf2 = graph.matches.find((m) => m.id === "GF2");
  if (graph.format === "double_elimination") {
    if (!gf2?.activationCondition) {
      throw new BracketValidationError("GF2 needs activationCondition", "GF2");
    }
    if (gf2.sourceA.type !== "winner" || gf2.sourceA.bracketMatchId !== "GF1") {
      throw new BracketValidationError("GF2.sourceA must be winner(GF1)", "GF2");
    }
    if (gf2.sourceB.type !== "loser" || gf2.sourceB.bracketMatchId !== "GF1") {
      throw new BracketValidationError("GF2.sourceB must be loser(GF1)", "GF2");
    }
  }

  detectCycles(graph);
}

function detectCycles(graph: BracketGraphV2): void {
  const visiting = new Set<string>();
  const done = new Set<string>();
  const byId = new Map(graph.matches.map((m) => [m.id, m]));

  function dfs(id: string): void {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      throw new BracketValidationError(`Cycle at ${id}`, id, "cycle");
    }
    visiting.add(id);
    const m = byId.get(id);
    if (m) {
      for (const src of [m.sourceA, m.sourceB]) {
        if (src.type === "winner" || src.type === "loser") {
          dfs(src.bracketMatchId);
        }
      }
    }
    visiting.delete(id);
    done.add(id);
  }

  for (const m of graph.matches) dfs(m.id);
}

export function isBracketGraphComplete(graph: BracketGraphV2): boolean {
  if (graph.format === "single_elimination") {
    if (!graph.championParticipantId) return false;
    if (graph.thirdPlaceEnabled) {
      const tp = graph.matches.find((m) => m.stage === "third_place");
      if (tp && !tp.winnerParticipantId && !tp.cancelled) {
        const st = deriveBracketMatchState(graph, tp.id);
        if (st !== "structurally_empty") return false;
      }
    }
    return true;
  }

  // DE
  const gf1 = graph.matches.find((m) => m.id === "GF1");
  const gf2 = graph.matches.find((m) => m.id === "GF2");
  if (!gf1?.winnerParticipantId) return false;

  const gf2State = gf2 ? deriveBracketMatchState(graph, gf2.id) : "inactive";
  if (gf2State === "inactive") {
    // WB champ won GF1
    return Boolean(graph.championParticipantId);
  }
  if (gf2State === "completed") {
    return Boolean(graph.championParticipantId);
  }
  // active but not finished
  return false;
}

export function hasPermanentlyBlockedNodes(graph: BracketGraphV2): boolean {
  return graph.matches.some((m) => isPermanentlyBlocked(graph, m.id));
}

export function countCompetitiveMatchesPlayed(graph: BracketGraphV2): number {
  return graph.matches.filter(
    (m) =>
      m.winnerParticipantId &&
      m.loserParticipantId &&
      !m.cancelled,
  ).length;
}
