import {
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

/** Swap seed participants between two V2 match nodes (pre-start edit). */
export function swapV2MatchSeeds(
  graph: BracketGraphV2,
  matchIdA: string,
  matchIdB: string,
): BracketGraphV2 {
  const a = graph.matches.find((m) => m.id === matchIdA);
  const b = graph.matches.find((m) => m.id === matchIdB);
  if (!a || !b) return graph;

  const seedsA: number[] = [];
  const seedsB: number[] = [];
  for (const src of [a.sourceA, a.sourceB]) {
    if (src.type === "seed") seedsA.push(src.seed);
  }
  for (const src of [b.sourceA, b.sourceB]) {
    if (src.type === "seed") seedsB.push(src.seed);
  }
  if (seedsA.length === 0 || seedsB.length === 0) return graph;

  const seedOrder = [...graph.seedOrder];
  const i = seedsA[0]! - 1;
  const j = seedsB[0]! - 1;
  if (i < 0 || j < 0 || i >= seedOrder.length || j >= seedOrder.length) {
    return graph;
  }
  const tmp = seedOrder[i]!;
  seedOrder[i] = seedOrder[j]!;
  seedOrder[j] = tmp;
  return { ...graph, seedOrder };
}
