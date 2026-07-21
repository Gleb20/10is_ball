import { describe, expect, it } from "vitest";
import {
  generateSingleEliminationBracket,
  listMatchPairs,
  pairNeedsMatch,
} from "./tournament-bracket-v1.js";

/**
 * Characterization of current V1 compact SE (not Challonge target).
 * Keep green — documents legacy behavior for migration.
 */
describe("V1 characterization (legacy compact SE)", () => {
  it("N=5 produces size=5 and one R0 bye (compact), not Challonge 8", () => {
    let n = 0;
    const b = generateSingleEliminationBracket(
      ["a", "b", "c", "d", "e"],
      () => `id_${++n}`,
    );
    expect(b.size).toBe(5);
    const r0 = listMatchPairs(b).filter(
      (p) => p.side === "main" && p.round === 0,
    );
    const byes = r0.filter((p) => p.slotA.isBye || p.slotB.isBye);
    expect(byes.length).toBe(1);
    expect(r0.filter(pairNeedsMatch).length).toBe(2);
  });

  it.todo(
    "V1 DE N=5 full playability — known hang; covered by V2 simulate tests",
  );
});
