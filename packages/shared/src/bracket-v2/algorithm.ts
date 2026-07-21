/**
 * Bracket construction algorithms (product-facing choice).
 * "legacy" is read-only only — never accepted on generate.
 */

export const bracketConstructionAlgorithms = [
  "compact",
  "power_of_two",
] as const;

export type BracketConstructionAlgorithm =
  (typeof bracketConstructionAlgorithms)[number];

/** Read-only label for unclassifiable legacy DE graphs. */
export type BracketConstructionAlgorithmView =
  | BracketConstructionAlgorithm
  | "legacy";

export function isBracketConstructionAlgorithm(
  value: unknown,
): value is BracketConstructionAlgorithm {
  return (
    value === "compact" ||
    value === "power_of_two"
  );
}

export function parseBracketConstructionAlgorithm(
  value: unknown,
): BracketConstructionAlgorithm {
  if (isBracketConstructionAlgorithm(value)) return value;
  throw Object.assign(new Error("INVALID_BRACKET_CONSTRUCTION_ALGORITHM"), {
    code: "INVALID_BRACKET_CONSTRUCTION_ALGORITHM",
  });
}

/**
 * Resolve algorithm for generate:
 * - explicit request wins
 * - regenerate without body keeps existing bracket algorithm
 * - first generate defaults to compact
 */
export function resolveRequestedConstructionAlgorithm(input: {
  requestedAlgorithm: BracketConstructionAlgorithm | undefined;
  existingBracketAlgorithm: BracketConstructionAlgorithm | null;
  hasExistingBracket: boolean;
}): BracketConstructionAlgorithm {
  if (input.requestedAlgorithm !== undefined) {
    return input.requestedAlgorithm;
  }
  if (input.hasExistingBracket && input.existingBracketAlgorithm) {
    return input.existingBracketAlgorithm;
  }
  return "compact";
}

export function assertConstructionSupported(input: {
  format: "single_elimination" | "double_elimination";
  constructionAlgorithm: BracketConstructionAlgorithm;
}): void {
  if (
    input.format === "double_elimination" &&
    input.constructionAlgorithm === "compact"
  ) {
    throw Object.assign(new Error("COMPACT_DOUBLE_ELIMINATION_UNSUPPORTED"), {
      code: "COMPACT_DOUBLE_ELIMINATION_UNSUPPORTED",
    });
  }
}
