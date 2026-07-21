import type { BracketConstructionAlgorithmView } from "./algorithm.js";
import { isBracketConstructionAlgorithm } from "./algorithm.js";
import type { BracketGraphV2 } from "./types.js";

export type DetectedConstruction =
  | { kind: "algorithm"; algorithm: BracketConstructionAlgorithmView }
  | { kind: "missing" }
  | { kind: "corrupt"; message: string };

/** Normalize V2 graph read from JSON (inject missing constructionAlgorithm). */
export function normalizeV2Graph(raw: unknown): BracketGraphV2 {
  const obj = raw as Record<string, unknown>;
  const base = {
    schemaVersion: 2 as const,
    format: obj.format as BracketGraphV2["format"],
    participantCount: obj.participantCount as number,
    seedOrder: obj.seedOrder as string[],
    thirdPlaceEnabled: Boolean(obj.thirdPlaceEnabled),
    matches: obj.matches as BracketGraphV2["matches"],
    championParticipantId: (obj.championParticipantId as string | null) ?? null,
    runnerUpParticipantId: (obj.runnerUpParticipantId as string | null) ?? null,
    thirdPlaceParticipantId:
      (obj.thirdPlaceParticipantId as string | null) ?? null,
  };

  if (obj.constructionAlgorithm === "compact") {
    return {
      ...base,
      constructionAlgorithm: "compact",
    };
  }

  const bracketSize =
    typeof obj.bracketSize === "number"
      ? obj.bracketSize
      : (obj.participantCount as number);

  return {
    ...base,
    constructionAlgorithm: "power_of_two",
    bracketSize,
  };
}

/**
 * Detect construction algorithm for stored bracket without rewriting JSON.
 *
 * Rules:
 * - V2 with constructionAlgorithm → that value
 * - V2 without field → power_of_two
 * - V1 single_elimination → compact
 * - V1 double_elimination → legacy (do not guess)
 */
export function detectStoredConstructionAlgorithm(
  raw: unknown,
): DetectedConstruction {
  if (raw == null) return { kind: "missing" };
  if (typeof raw !== "object") {
    return { kind: "corrupt", message: "not an object" };
  }
  const obj = raw as Record<string, unknown>;

  if (!("schemaVersion" in obj)) {
    if (!Array.isArray(obj.slots)) {
      return { kind: "corrupt", message: "no schemaVersion and no slots" };
    }
    return detectV1Format(obj);
  }

  const v = obj.schemaVersion;
  if (v === 1) {
    return detectV1Format(obj);
  }

  if (v === 2) {
    if ("constructionAlgorithm" in obj) {
      const alg = obj.constructionAlgorithm;
      if (isBracketConstructionAlgorithm(alg)) {
        return { kind: "algorithm", algorithm: alg };
      }
      return {
        kind: "corrupt",
        message: `unknown constructionAlgorithm ${String(alg)}`,
      };
    }
    return { kind: "algorithm", algorithm: "power_of_two" };
  }

  if (typeof v === "number" && v > 2) {
    return {
      kind: "corrupt",
      message: `unsupported schema ${v}`,
    };
  }
  return { kind: "corrupt", message: `bad schemaVersion ${String(v)}` };
}

function detectV1Format(obj: Record<string, unknown>): DetectedConstruction {
  const format = obj.format;
  if (format === "single_elimination") {
    return { kind: "algorithm", algorithm: "compact" };
  }
  if (format === "double_elimination") {
    return { kind: "algorithm", algorithm: "legacy" };
  }
  return { kind: "corrupt", message: "v1 missing format" };
}
