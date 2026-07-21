import { describe, expect, it } from "vitest";
import {
  assertDeInvariants,
  assertSeInvariants,
  countCompetitiveMatchesPlayed,
  generateDoubleEliminationV2,
  generateSingleEliminationV2,
  prepareBracketGraph,
  simulateBracket,
  type WinnerStrategy,
} from "./index.js";

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `s${i + 1}`);
}

const strategies: WinnerStrategy[] = [
  "alwaysA",
  "alwaysB",
  "lowerSeed",
  "higherSeed",
];

describe("bracket-v2 property N=3..64", () => {
  for (let n = 3; n <= 64; n += 1) {
    for (const strategy of strategies) {
      it(`SE Po2 n=${n} ${strategy}`, () => {
        let g = generateSingleEliminationV2({
          seedOrder: ids(n),
          thirdPlaceEnabled: false,
        });
        g = simulateBracket(g, strategy);
        assertSeInvariants(g, n);
        expect(countCompetitiveMatchesPlayed(g)).toBe(n - 1);
      });
    }
  }

  for (let n = 3; n <= 64; n += 1) {
    it(`SE compact n=${n} lowerSeed`, () => {
      let g = prepareBracketGraph({
        seedOrder: ids(n),
        format: "single_elimination",
        constructionAlgorithm: "compact",
        thirdPlaceEnabled: false,
      });
      g = simulateBracket(g, "lowerSeed");
      assertSeInvariants(g, n);
      expect(countCompetitiveMatchesPlayed(g)).toBe(n - 1);
      expect(g.constructionAlgorithm).toBe("compact");
      expect(g.bracketSize).toBeUndefined();
    });
  }

  // DE property: sample denser near small N, then step
  const deNs = [
    ...Array.from({ length: 14 }, (_, i) => i + 3), // 3..16
    24, 32, 48, 64,
  ];
  for (const n of deNs) {
    for (const strategy of ["lowerSeed", "alwaysA", "alwaysB"] as const) {
      it(`DE n=${n} ${strategy}`, () => {
        let g = generateDoubleEliminationV2({ seedOrder: ids(n) });
        g = simulateBracket(g, strategy);
        assertDeInvariants(g, n, strategy);
      });
    }
  }

  it("seeded rng DE n=8", () => {
    let i = 0;
    const seq = [0.1, 0.9, 0.2, 0.8, 0.3, 0.7, 0.4, 0.6, 0.15, 0.85, 0.25];
    let g = generateDoubleEliminationV2({ seedOrder: ids(8) });
    g = simulateBracket(g, {
      type: "rng",
      next: () => seq[i++ % seq.length]!,
    });
    assertDeInvariants(g, 8, "lowerSeed");
  });
});
