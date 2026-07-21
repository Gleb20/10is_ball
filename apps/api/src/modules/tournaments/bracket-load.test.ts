import { describe, expect, it } from "vitest";
import { generateSingleEliminationV2 } from "@tab10/shared";
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
      expect.objectContaining({ code: "BRACKET_UNSUPPORTED" }),
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
