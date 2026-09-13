import { describe, expect, it } from "vitest";
import {
  generateDoubleEliminationV2,
  generateSingleEliminationV2,
} from "@tab10/shared";
import {
  loadTournamentBracket,
  swapSeedOrderByMatchIds,
} from "./bracket-load.js";

describe("bracket-load", () => {
  it("missing / corrupt / unsupported / v1 / v2", () => {
    expect(() => loadTournamentBracket(null)).toThrow(
      expect.objectContaining({ code: "BRACKET_MISSING" }),
    );
    expect(() => loadTournamentBracket("x")).toThrow(
      expect.objectContaining({ code: "BRACKET_CORRUPT" }),
    );
    expect(() => loadTournamentBracket({ schemaVersion: 9 })).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_BRACKET_VERSION" }),
    );
    expect(() =>
      loadTournamentBracket({
        schemaVersion: 1,
        size: 5,
        slots: [],
        format: "double_elimination",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "UNSUPPORTED_BRACKET_VERSION",
        schemaVersion: 1,
      }),
    );
    const v1 = loadTournamentBracket({
      size: 4,
      slots: [],
      format: "single_elimination",
    });
    expect(v1.kind).toBe("v1");
    const g = generateSingleEliminationV2({
      seedOrder: ["a", "b", "c", "d"],
      thirdPlaceEnabled: false,
    });
    const v2 = loadTournamentBracket(g);
    expect(v2.kind).toBe("v2");
    if (v2.kind === "v2") {
      expect(v2.graph.constructionAlgorithm).toBe("power_of_two");
    }
    const v2DoubleElimination = loadTournamentBracket(
      generateDoubleEliminationV2({ seedOrder: ["a", "b", "c", "d"] }),
    );
    expect(v2DoubleElimination.kind).toBe("v2");
    if (v2DoubleElimination.kind === "v2") {
      expect(v2DoubleElimination.graph.format).toBe("double_elimination");
    }
  });

  it("swapSeedOrderByMatchIds swaps seedOrder entries", () => {
    const g = generateSingleEliminationV2({
      seedOrder: ["a", "b", "c", "d"],
      thirdPlaceEnabled: false,
    });
    const next = swapSeedOrderByMatchIds(g, g.seedOrder, "W0_0", "W0_1");
    expect(next[0]).not.toBe(g.seedOrder[0]);
  });
});

it("GAP-006 swaps either seed position, including a seed with a bye, and rejects invalid positions", () => {
  const graph = generateSingleEliminationV2({ seedOrder: ["a", "b", "c", "d", "e"], thirdPlaceEnabled: true });
  expect(swapSeedOrderByMatchIds(graph, graph.seedOrder, "seed:2", "seed:5")).toEqual(["a", "e", "c", "d", "b"]);
  expect(() => swapSeedOrderByMatchIds(graph, graph.seedOrder, "seed:0", "seed:1")).toThrow(expect.objectContaining({ code: "VALIDATION" }));
  expect(() => swapSeedOrderByMatchIds(graph, graph.seedOrder, "missing", "seed:1")).toThrow(expect.objectContaining({ code: "VALIDATION" }));
});
