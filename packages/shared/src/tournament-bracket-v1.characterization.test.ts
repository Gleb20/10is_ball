import { describe, expect, it } from "vitest";
import {
  applyMatchResult,
  attachMatchId,
  generateSingleEliminationBracket,
  isTournamentComplete,
  listMatchPairs,
  pairNeedsMatch,
  thirdPlaceParticipantIds,
  type Bracket,
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

  it("AT-TRN-015: V1 DE N=5 is rejected before the known hang path traverses slots", () => {
    let slotTraversalCount = 0;
    const slots = new Proxy([], {
      get(target, property, receiver) {
        if (
          property === Symbol.iterator ||
          property === "map" ||
          property === "filter" ||
          property === "find"
        ) {
          slotTraversalCount += 1;
          throw new Error("KNOWN_V1_DE_HANG_PATH_ENTERED");
        }
        return Reflect.get(target, property, receiver);
      },
    }) as Bracket["slots"];
    const bracket: Bracket = {
      slots,
      size: 5,
      format: "double_elimination",
      thirdPlaceSlotId: null,
      championParticipantId: null,
    };

    const entryPoints = [
      () => listMatchPairs(bracket),
      () => attachMatchId(bracket, ["a", "b"], "match"),
      () => applyMatchResult(bracket, ["a", "b"], "p1", "p2", "match"),
      () => isTournamentComplete(bracket),
      () => thirdPlaceParticipantIds(bracket),
    ];

    for (const enterLegacyLifecycle of entryPoints) {
      expect(enterLegacyLifecycle).toThrow(
        expect.objectContaining({
          code: "UNSUPPORTED_BRACKET_VERSION",
          schemaVersion: 1,
        }),
      );
    }
    expect(slotTraversalCount).toBe(0);
  });
});
