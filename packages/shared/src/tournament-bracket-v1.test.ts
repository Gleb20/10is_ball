import { describe, expect, it } from "vitest";
import {
  applyMatchResult,
  attachMatchId,
  generateDoubleEliminationBracket,
  generateSingleEliminationBracket,
  isTournamentComplete,
  listMatchPairs,
  pairNeedsMatch,
  seedParticipants,
} from "./tournament-bracket-v1.js";

describe("REQ_TRN__bracket_generation", () => {
  it("AT-TRN-005: seeds by wins descending", () => {
    const seeded = seedParticipants([
      { id: "a", wins: 1 },
      { id: "b", wins: 5 },
      { id: "c", wins: 3 },
    ]);
    expect(seeded).toEqual(["b", "c", "a"]);
  });

  it("AT-TRN-005: unranked shuffled via rng", () => {
    let i = 0;
    const seq = [0.9, 0.1, 0.5];
    const seeded = seedParticipants(
      [
        { id: "a", wins: 0 },
        { id: "b", wins: 0 },
        { id: "c", wins: 0 },
      ],
      () => seq[i++] ?? 0,
    );
    expect(seeded).toHaveLength(3);
    expect(new Set(seeded).size).toBe(3);
  });

  it("rejects fewer than 3 participants", () => {
    expect(() =>
      generateSingleEliminationBracket(["a", "b"], () => "x"),
    ).toThrow("PARTICIPANT_COUNT_INVALID");
  });

  it("creates compact bracket with one bye for 3 players", () => {
    let n = 0;
    const ids = () => `s_${++n}`;
    const bracket = generateSingleEliminationBracket(["p1", "p2", "p3"], ids);
    expect(bracket.size).toBe(3);
    expect(bracket.format).toBe("single_elimination");
    const r0Pairs = listMatchPairs(bracket).filter(
      (p) => p.side === "main" && p.round === 0,
    );
    const byePairs = r0Pairs.filter((p) => p.slotA.isBye || p.slotB.isBye);
    const playPairs = r0Pairs.filter(pairNeedsMatch);
    expect(byePairs).toHaveLength(1);
    expect(playPairs).toHaveLength(1);
    // Last in seed order gets the bye
    const byeAdvancer =
      byePairs[0]!.slotA.isBye
        ? byePairs[0]!.slotB.participantId
        : byePairs[0]!.slotA.participantId;
    expect(byeAdvancer).toBe("p3");
  });

  it("compact placement: N=5/6/7 one bye when odd", () => {
    function byeAdvancers(seeded: string[]) {
      let n = 0;
      const bracket = generateSingleEliminationBracket(
        seeded,
        () => `b_${++n}`,
      );
      const r0 = listMatchPairs(bracket).filter(
        (p) => p.side === "main" && p.round === 0,
      );
      const advancers: string[] = [];
      for (const p of r0) {
        if (p.slotA.isBye && p.slotB.participantId)
          advancers.push(p.slotB.participantId);
        if (p.slotB.isBye && p.slotA.participantId)
          advancers.push(p.slotA.participantId);
      }
      const playable = r0.filter(pairNeedsMatch).length;
      return { advancers: advancers.sort(), playable, size: bracket.size };
    }

    expect(byeAdvancers(["s1", "s2", "s3", "s4", "s5"])).toEqual({
      advancers: ["s5"],
      playable: 2,
      size: 5,
    });
    expect(byeAdvancers(["s1", "s2", "s3", "s4", "s5", "s6"])).toEqual({
      advancers: [],
      playable: 3,
      size: 6,
    });
    expect(
      byeAdvancers(["s1", "s2", "s3", "s4", "s5", "s6", "s7"]),
    ).toEqual({
      advancers: ["s7"],
      playable: 3,
      size: 7,
    });
  });

  it("N=5: R1 bye goes to a non-bye advancer so R0 bye plays a winner", () => {
    let n = 0;
    const bracket = generateSingleEliminationBracket(
      ["s1", "s2", "s3", "s4", "s5"],
      () => `b_${++n}`,
    );
    const r1 = listMatchPairs(bracket).filter(
      (p) => p.side === "main" && p.round === 1,
    );
    const playPair = r1.find((p) => !p.slotA.isBye && !p.slotB.isBye);
    expect(playPair).toBeTruthy();
    const playIds = [
      playPair!.slotA.participantId,
      playPair!.slotB.participantId,
    ];
    expect(playIds).toContain("s5");
  });

  it("SE with 4 players includes third_place slots", () => {
    let n = 0;
    const bracket = generateSingleEliminationBracket(
      ["a", "b", "c", "d"],
      () => `s_${++n}`,
    );
    expect(bracket.slots.some((s) => s.side === "third_place")).toBe(true);
  });

  it("AT-TRN-015: retired V1 DE generation fails closed", () => {
    expect(() =>
      generateDoubleEliminationBracket(
        ["a", "b", "c", "d"],
        () => "unused",
      ),
    ).toThrow(
      expect.objectContaining({
        code: "UNSUPPORTED_BRACKET_VERSION",
        schemaVersion: 1,
      }),
    );
  });

  it("AT-TRN-010 helpers: applyMatchResult advances winner", () => {
    let n = 0;
    let bracket = generateSingleEliminationBracket(
      ["a", "b", "c", "d"],
      () => `s_${++n}`,
    );
    const pairs = listMatchPairs(bracket).filter(pairNeedsMatch);
    expect(pairs.length).toBeGreaterThan(0);
    const pair = pairs[0]!;
    bracket = attachMatchId(bracket, [pair.slotA.id, pair.slotB.id], "m1");
    bracket = applyMatchResult(
      bracket,
      [pair.slotA.id, pair.slotB.id],
      pair.slotA.participantId!,
      pair.slotB.participantId!,
      "m1",
    );
    const target = bracket.slots.find((s) => s.id === pair.targetSlotId);
    expect(target?.participantId).toBe(pair.slotA.participantId);
    expect(isTournamentComplete(bracket)).toBe(false);
  });
});
