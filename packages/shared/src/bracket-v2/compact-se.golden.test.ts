import { describe, expect, it } from "vitest";
import { prepareBracketGraph } from "./prepare.js";
import { generateCompactSingleElimination } from "./generate-compact-se.js";
import { thirdPlaceSourcesFromFinal } from "./third-place.js";
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

describe("compact SE exact golden topologies", () => {
  it("N=3", () => {
    const g = generateCompactSingleElimination({
      seedOrder: ids(3),
      thirdPlaceEnabled: false,
    });
    expect(g.constructionAlgorithm).toBe("compact");
    expect(g.bracketSize).toBeUndefined();
    expect(matchSources(g, "W0_0")).toEqual(["seed1", "seed2"]);
    expect(matchSources(g, "W0_1")).toEqual(["seed3", "empty"]);
    expect(matchSources(g, "W1_0")).toEqual(["W(W0_1)", "W(W0_0)"]);
  });

  it("N=5", () => {
    const g = generateCompactSingleElimination({
      seedOrder: ids(5),
      thirdPlaceEnabled: true,
    });
    expect(matchSources(g, "W0_0")).toEqual(["seed1", "seed2"]);
    expect(matchSources(g, "W0_1")).toEqual(["seed3", "seed4"]);
    expect(matchSources(g, "W0_2")).toEqual(["seed5", "empty"]);
    expect(matchSources(g, "W1_0")).toEqual(["W(W0_2)", "W(W0_0)"]);
    expect(matchSources(g, "W1_1")).toEqual(["W(W0_1)", "empty"]);
    expect(matchSources(g, "W2_0")).toEqual(["W(W1_1)", "W(W1_0)"]);

    const tp = thirdPlaceSourcesFromFinal(g);
    expect(tp).not.toBeNull();
    const feeders = new Set([
      tp!.sourceA.type === "loser" ? tp!.sourceA.bracketMatchId : "",
      tp!.sourceB.type === "loser" ? tp!.sourceB.bracketMatchId : "",
    ]);
    expect(feeders).toEqual(new Set(["W1_0", "W0_1"]));
  });

  it("N=6", () => {
    const g = generateCompactSingleElimination({
      seedOrder: ids(6),
      thirdPlaceEnabled: false,
    });
    expect(matchSources(g, "W0_0")).toEqual(["seed1", "seed2"]);
    expect(matchSources(g, "W0_1")).toEqual(["seed3", "seed4"]);
    expect(matchSources(g, "W0_2")).toEqual(["seed5", "seed6"]);
    expect(matchSources(g, "W1_0")).toEqual(["W(W0_0)", "W(W0_1)"]);
    expect(matchSources(g, "W1_1")).toEqual(["W(W0_2)", "empty"]);
    expect(matchSources(g, "W2_0")).toEqual(["W(W1_1)", "W(W1_0)"]);
  });

  it("N=7", () => {
    const g = generateCompactSingleElimination({
      seedOrder: ids(7),
      thirdPlaceEnabled: false,
    });
    expect(matchSources(g, "W0_0")).toEqual(["seed1", "seed2"]);
    expect(matchSources(g, "W0_1")).toEqual(["seed3", "seed4"]);
    expect(matchSources(g, "W0_2")).toEqual(["seed5", "seed6"]);
    expect(matchSources(g, "W0_3")).toEqual(["seed7", "empty"]);
    expect(matchSources(g, "W1_0")).toEqual(["W(W0_3)", "W(W0_0)"]);
    expect(matchSources(g, "W1_1")).toEqual(["W(W0_1)", "W(W0_2)"]);
    expect(matchSources(g, "W2_0")).toEqual(["W(W1_0)", "W(W1_1)"]);
  });

  it("N=5 topology differs from power_of_two", () => {
    const compact = prepareBracketGraph({
      seedOrder: ids(5),
      format: "single_elimination",
      constructionAlgorithm: "compact",
      thirdPlaceEnabled: false,
    });
    const po2 = prepareBracketGraph({
      seedOrder: ids(5),
      format: "single_elimination",
      constructionAlgorithm: "power_of_two",
      thirdPlaceEnabled: false,
    });
    expect(compact.matches.map((m) => m.id).sort()).not.toEqual(
      po2.matches.map((m) => m.id).sort(),
    );
    expect(po2.constructionAlgorithm).toBe("power_of_two");
    if (po2.constructionAlgorithm === "power_of_two") {
      expect(po2.bracketSize).toBe(8);
    }
  });
});
