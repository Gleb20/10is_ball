/**
 * Facade: V1 re-exports + V2 bracket engine.
 * Runtime routing by schemaVersion happens in parse (bracket-v2/parse).
 */
export * from "./tournament-bracket-v1.js";
export * from "./bracket-v2/index.js";
