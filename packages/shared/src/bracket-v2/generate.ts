import {
  assertConstructionSupported,
  type BracketConstructionAlgorithm,
} from "./algorithm.js";
import { generateCompactSingleElimination } from "./generate-compact-se.js";
import { generateDoubleEliminationV2 } from "./generate-de.js";
import { generateSingleEliminationV2 } from "./generate-se.js";
import type { BracketGraphV2, GenerateBracketInput } from "./types.js";

/**
 * Topology-only generation (no validate / propagate). Prefer prepareBracketGraph.
 */
export function generateBracketGraph(
  input: GenerateBracketInput,
): BracketGraphV2 {
  assertConstructionSupported({
    format: input.format,
    constructionAlgorithm: input.constructionAlgorithm,
  });

  switch (input.constructionAlgorithm) {
    case "compact":
      return generateCompactSingleElimination({
        seedOrder: input.seedOrder,
        thirdPlaceEnabled: input.thirdPlaceEnabled,
      });
    case "power_of_two":
      return generatePowerOfTwoBracketGraph(input);
    default: {
      const _exhaustive: never = input.constructionAlgorithm;
      return _exhaustive;
    }
  }
}

export function generatePowerOfTwoBracketGraph(
  input: Pick<
    GenerateBracketInput,
    "seedOrder" | "format" | "thirdPlaceEnabled"
  >,
): BracketGraphV2 {
  if (input.format === "double_elimination") {
    return generateDoubleEliminationV2({ seedOrder: input.seedOrder });
  }
  return generateSingleEliminationV2({
    seedOrder: input.seedOrder,
    thirdPlaceEnabled: input.thirdPlaceEnabled,
  });
}

export type { BracketConstructionAlgorithm };
