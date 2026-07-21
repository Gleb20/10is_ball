import {
  detectStoredConstructionAlgorithm,
  parseBracketJson,
  type Bracket,
  type BracketGraphV2,
} from "@tab10/shared";

export type LoadedBracket =
  | { kind: "v1"; bracket: Bracket }
  | { kind: "v2"; graph: BracketGraphV2 };

export function loadTournamentBracket(raw: unknown): LoadedBracket {
  const parsed = parseBracketJson(raw);
  switch (parsed.kind) {
    case "missing":
      throw Object.assign(new Error("BRACKET_MISSING"), {
        code: "BRACKET_MISSING",
      });
    case "corrupt":
      throw Object.assign(new Error("BRACKET_CORRUPT"), {
        code: "BRACKET_CORRUPT",
        message: parsed.message,
      });
    case "unsupported":
      throw Object.assign(new Error("BRACKET_UNSUPPORTED"), {
        code: "BRACKET_UNSUPPORTED",
        schemaVersion: parsed.schemaVersion,
      });
    case "v1":
      return { kind: "v1", bracket: parsed.raw as Bracket };
    case "v2":
      return { kind: "v2", graph: parsed.graph };
    default: {
      const _exhaustive: never = parsed;
      return _exhaustive;
    }
  }
}

/**
 * Swap two seed participants referenced by V2 match node ids (pre-start edit).
 * Returns updated seedOrder; caller must regenerate the graph.
 */
export function swapSeedOrderByMatchIds(
  graph: BracketGraphV2,
  seedOrder: string[],
  matchIdA: string,
  matchIdB: string,
): string[] {
  const a = graph.matches.find((m) => m.id === matchIdA);
  const b = graph.matches.find((m) => m.id === matchIdB);
  if (!a || !b) return seedOrder;

  const seedsA: number[] = [];
  const seedsB: number[] = [];
  for (const src of [a.sourceA, a.sourceB]) {
    if (src.type === "seed") seedsA.push(src.seed);
  }
  for (const src of [b.sourceA, b.sourceB]) {
    if (src.type === "seed") seedsB.push(src.seed);
  }
  if (seedsA.length === 0 || seedsB.length === 0) return seedOrder;

  const next = [...seedOrder];
  const i = seedsA[0]! - 1;
  const j = seedsB[0]! - 1;
  if (i < 0 || j < 0 || i >= next.length || j >= next.length) {
    return seedOrder;
  }
  const tmp = next[i]!;
  next[i] = next[j]!;
  next[j] = tmp;
  return next;
}

export function readTournamentConstructionAlgorithm(input: {
  bracketJson: unknown;
  columnValue: string | null;
}): {
  algorithm: string | null;
  viewLabel: "compact" | "power_of_two" | "legacy" | null;
} {
  const detected = detectStoredConstructionAlgorithm(input.bracketJson);
  if (detected.kind === "algorithm") {
    return {
      algorithm:
        detected.algorithm === "legacy" ? null : detected.algorithm,
      viewLabel: detected.algorithm,
    };
  }
  if (
    input.columnValue === "compact" ||
    input.columnValue === "power_of_two"
  ) {
    return { algorithm: input.columnValue, viewLabel: input.columnValue };
  }
  return { algorithm: null, viewLabel: null };
}
