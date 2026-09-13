import {
  detectStoredConstructionAlgorithm,
  parseBracketJson,
  UnsupportedBracketVersionError,
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
      throw new UnsupportedBracketVersionError(parsed.schemaVersion);
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
  const indexFor = (reference: string) => {
    const explicit = /^seed:([1-9]\d*)$/.exec(reference);
    const node = graph.matches.find((m) => m.id === reference);
    const source = node && [node.sourceA, node.sourceB].find((src) => src.type === "seed");
    const index = explicit ? Number(explicit[1]) - 1 : source?.type === "seed" ? source.seed - 1 : -1;
    if (!Number.isInteger(index) || index < 0 || index >= seedOrder.length) {
      throw Object.assign(new Error("VALIDATION"), { code: "VALIDATION" });
    }
    return index;
  };
  const i = indexFor(matchIdA);
  const j = indexFor(matchIdB);
  const next = [...seedOrder];
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
