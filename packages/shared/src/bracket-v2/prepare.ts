import { generateBracketGraph } from "./generate.js";
import { propagateByesFixpoint } from "./resolve.js";
import { validateBracketGraph } from "./validate.js";
import type { BracketGraphV2, GenerateBracketInput } from "./types.js";

/**
 * Shared pipeline for preview and started brackets.
 * 1. generate topology
 * 2. validate topology
 * 3–4. resolve empties + propagate auto-advances to fixpoint
 * 5. validate normalized
 * 6. return
 */
export function prepareBracketGraph(
  input: GenerateBracketInput,
): BracketGraphV2 {
  let graph = generateBracketGraph(input);
  validateBracketGraph(graph);
  graph = propagateByesFixpoint(graph);
  validateBracketGraph(graph);
  return graph;
}
