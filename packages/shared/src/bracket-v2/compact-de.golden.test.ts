import { describe, expect, it } from "vitest";
import { generateCompactDoubleElimination } from "./generate-compact-de.js";
import { prepareBracketGraph } from "./prepare.js";
import {
  assertDeInvariants,
  simulateBracket,
} from "./simulate.js";
import { countCompetitiveMatchesPlayed } from "./validate.js";
import type { BracketMatchNode, ParticipantSource } from "./types.js";

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `p${i + 1}`);
}

function src(s: ParticipantSource): string {
  if (s.type === "seed") return `seed${s.seed}`;
  if (s.type === "winner") return `W(${s.bracketMatchId})`;
  if (s.type === "loser") return `L(${s.bracketMatchId})`;
  return "empty";
}

function matchSources(
  g: { matches: BracketMatchNode[] },
  id: string,
): [string, string] {
  const m = g.matches.find((x) => x.id === id);
  if (!m) throw new Error(`missing ${id}`);
  return [src(m.sourceA), src(m.sourceB)];
}

describe("compact DE exact golden topologies", () => {
  it("N=3", () => {
    const g = generateCompactDoubleElimination({ seedOrder: ids(3) });
    expect(g.constructionAlgorithm).toBe("compact");
    expect(g.format).toBe("double_elimination");
    expect(g.bracketSize).toBeUndefined();
    expect(g.thirdPlaceEnabled).toBe(false);

    expect(matchSources(g, "W0_0")).toEqual(["seed1", "seed2"]);
    expect(matchSources(g, "W0_1")).toEqual(["seed3", "empty"]);
    expect(matchSources(g, "W1_0")).toEqual(["W(W0_1)", "W(W0_0)"]);

    expect(matchSources(g, "L0_0")).toEqual(["L(W0_0)", "empty"]);
    expect(matchSources(g, "L1_0")).toEqual(["W(L0_0)", "L(W1_0)"]);

    expect(matchSources(g, "GF1")).toEqual(["W(W1_0)", "W(L1_0)"]);
    const gf2 = g.matches.find((m) => m.id === "GF2")!;
    expect(gf2.sourceA).toEqual({ type: "winner", bracketMatchId: "GF1" });
    expect(gf2.sourceB).toEqual({ type: "loser", bracketMatchId: "GF1" });
    expect(gf2.activationCondition).toEqual({
      type: "gf1_won_by_source_b",
      grandFinalMatchId: "GF1",
    });
  });

  it("N=5", () => {
    const g = generateCompactDoubleElimination({ seedOrder: ids(5) });
    expect(matchSources(g, "W0_0")).toEqual(["seed1", "seed2"]);
    expect(matchSources(g, "W0_1")).toEqual(["seed3", "seed4"]);
    expect(matchSources(g, "W0_2")).toEqual(["seed5", "empty"]);
    expect(matchSources(g, "W1_0")).toEqual(["W(W0_2)", "W(W0_0)"]);
    expect(matchSources(g, "W1_1")).toEqual(["W(W0_1)", "empty"]);
    expect(matchSources(g, "W2_0")).toEqual(["W(W1_1)", "W(W1_0)"]);

    expect(matchSources(g, "L0_0")).toEqual(["L(W0_0)", "L(W0_1)"]);
    expect(matchSources(g, "L1_0")).toEqual(["W(L0_0)", "L(W1_0)"]);
    expect(matchSources(g, "L2_0")).toEqual(["W(L1_0)", "L(W2_0)"]);

    expect(matchSources(g, "GF1")).toEqual(["W(W2_0)", "W(L2_0)"]);
  });

  it("N=6", () => {
    const g = generateCompactDoubleElimination({ seedOrder: ids(6) });
    expect(matchSources(g, "W0_0")).toEqual(["seed1", "seed2"]);
    expect(matchSources(g, "W0_1")).toEqual(["seed3", "seed4"]);
    expect(matchSources(g, "W0_2")).toEqual(["seed5", "seed6"]);
    expect(matchSources(g, "W1_0")).toEqual(["W(W0_0)", "W(W0_1)"]);
    expect(matchSources(g, "W1_1")).toEqual(["W(W0_2)", "empty"]);
    expect(matchSources(g, "W2_0")).toEqual(["W(W1_1)", "W(W1_0)"]);

    expect(matchSources(g, "L0_0")).toEqual(["L(W0_0)", "L(W0_1)"]);
    expect(matchSources(g, "L0_1")).toEqual(["L(W0_2)", "empty"]);
    expect(matchSources(g, "L1_0")).toEqual(["W(L0_1)", "W(L0_0)"]);
    expect(matchSources(g, "L1_1")).toEqual(["L(W1_0)", "empty"]);
    expect(matchSources(g, "L2_0")).toEqual(["W(L1_1)", "W(L1_0)"]);
    expect(matchSources(g, "L2_1")).toEqual(["L(W2_0)", "empty"]);
    expect(matchSources(g, "L3_0")).toEqual(["W(L2_1)", "W(L2_0)"]);

    expect(matchSources(g, "GF1")).toEqual(["W(W2_0)", "W(L3_0)"]);
  });

  it("N=7", () => {
    const g = generateCompactDoubleElimination({ seedOrder: ids(7) });
    expect(matchSources(g, "W0_0")).toEqual(["seed1", "seed2"]);
    expect(matchSources(g, "W0_1")).toEqual(["seed3", "seed4"]);
    expect(matchSources(g, "W0_2")).toEqual(["seed5", "seed6"]);
    expect(matchSources(g, "W0_3")).toEqual(["seed7", "empty"]);
    expect(matchSources(g, "W1_0")).toEqual(["W(W0_3)", "W(W0_0)"]);
    expect(matchSources(g, "W1_1")).toEqual(["W(W0_1)", "W(W0_2)"]);
    expect(matchSources(g, "W2_0")).toEqual(["W(W1_0)", "W(W1_1)"]);

    expect(matchSources(g, "L0_0")).toEqual(["L(W0_0)", "L(W0_1)"]);
    expect(matchSources(g, "L0_1")).toEqual(["L(W0_2)", "empty"]);
    expect(matchSources(g, "L1_0")).toEqual(["W(L0_1)", "W(L0_0)"]);
    expect(matchSources(g, "L1_1")).toEqual(["L(W1_0)", "L(W1_1)"]);
    expect(matchSources(g, "L2_0")).toEqual(["W(L1_0)", "W(L1_1)"]);
    expect(matchSources(g, "L2_1")).toEqual(["L(W2_0)", "empty"]);
    expect(matchSources(g, "L3_0")).toEqual(["W(L2_1)", "W(L2_0)"]);

    expect(matchSources(g, "GF1")).toEqual(["W(W2_0)", "W(L3_0)"]);
  });

  it("N=5 simulates with 2N-2 competitive without reset path dominance", () => {
    let g = prepareBracketGraph({
      seedOrder: ids(5),
      format: "double_elimination",
      constructionAlgorithm: "compact",
      thirdPlaceEnabled: false,
    });
    g = simulateBracket(g, "lowerSeed");
    assertDeInvariants(g, 5, "lowerSeed");
    expect(countCompetitiveMatchesPlayed(g)).toBeGreaterThanOrEqual(8);
  });
});
