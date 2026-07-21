import { normalizeV2Graph } from "./legacy.js";
import type { BracketGraphV2 } from "./types.js";

export type ParseResult =
  | { kind: "missing" }
  | { kind: "v1"; raw: unknown }
  | { kind: "v2"; graph: BracketGraphV2 }
  | { kind: "unsupported"; schemaVersion: number }
  | { kind: "corrupt"; message: string };

export function parseBracketJson(raw: unknown): ParseResult {
  if (raw == null) return { kind: "missing" };
  if (typeof raw !== "object") {
    return { kind: "corrupt", message: "not an object" };
  }
  const obj = raw as Record<string, unknown>;
  if (!("schemaVersion" in obj)) {
    // Legacy slot graph
    if (Array.isArray(obj.slots)) return { kind: "v1", raw };
    return { kind: "corrupt", message: "no schemaVersion and no slots" };
  }
  const v = obj.schemaVersion;
  if (v === 1) return { kind: "v1", raw };
  if (v === 2) {
    if (!Array.isArray(obj.matches) || !Array.isArray(obj.seedOrder)) {
      return { kind: "corrupt", message: "v2 missing matches/seedOrder" };
    }
    if (
      "constructionAlgorithm" in obj &&
      obj.constructionAlgorithm !== "compact" &&
      obj.constructionAlgorithm !== "power_of_two"
    ) {
      return {
        kind: "corrupt",
        message: `unknown constructionAlgorithm ${String(obj.constructionAlgorithm)}`,
      };
    }
    const graph = normalizeV2Graph(obj);
    return { kind: "v2", graph };
  }
  if (typeof v === "number" && v > 2) {
    return { kind: "unsupported", schemaVersion: v };
  }
  return { kind: "corrupt", message: `bad schemaVersion ${String(v)}` };
}
