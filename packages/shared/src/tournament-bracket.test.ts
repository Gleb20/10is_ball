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
} from "./tournament-bracket.js";

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

  it("creates power-of-2 bracket with byes for 3 players", () => {
    let n = 0;
    const ids = () => `s_${++n}`;
    const bracket = generateSingleEliminationBracket(["p1", "p2", "p3"], ids);
    expect(bracket.size).toBe(4);
    expect(bracket.format).toBe("single_elimination");
    const first = bracket.slots.filter((s) => s.round === 0 && s.side === "main");
    expect(first.filter((s) => s.isBye).length).toBe(1);
    expect(first.filter((s) => s.participantId).length).toBe(3);
  });

  it("SE size>=4 includes third_place slots", () => {
    let n = 0;
    const bracket = generateSingleEliminationBracket(
      ["a", "b", "c", "d"],
      () => `s_${++n}`,
    );
    expect(bracket.slots.some((s) => s.side === "third_place")).toBe(true);
  });

  it("double elimination adds losers, final, and final_reset slots", () => {
    let n = 0;
    const bracket = generateDoubleEliminationBracket(
      ["a", "b", "c", "d"],
      () => `d_${++n}`,
    );
    expect(bracket.format).toBe("double_elimination");
    expect(bracket.slots.some((s) => s.side === "losers")).toBe(true);
    expect(bracket.slots.some((s) => s.side === "final")).toBe(true);
    expect(bracket.slots.some((s) => s.side === "final_reset")).toBe(true);
    expect(bracket.slots.some((s) => s.side === "third_place")).toBe(false);
  });

  it("DE 4-player: WB win in GF sets champion without reset", () => {
    let n = 0;
    let bracket = generateDoubleEliminationBracket(
      ["a", "b", "c", "d"],
      () => `d_${++n}`,
    );
    let matchN = 0;
    // Play until GF ready then WB wins
    for (let guard = 0; guard < 20; guard += 1) {
      const ready = listMatchPairs(bracket).filter(pairNeedsMatch);
      if (ready.length === 0) break;
      const pair = ready[0]!;
      const mid = `m_${++matchN}`;
      bracket = attachMatchId(bracket, [pair.slotA.id, pair.slotB.id], mid);
      const winner = pair.slotA.participantId!;
      const loser = pair.slotB.participantId!;
      bracket = applyMatchResult(
        bracket,
        [pair.slotA.id, pair.slotB.id],
        winner,
        loser,
        mid,
      );
      if (pair.side === "final") {
        const wb = bracket.slots.find(
          (s) => s.side === "final" && s.position === 0,
        );
        // Force WB champion win path if A was LB
        if (wb?.participantId && winner !== wb.participantId) {
          bracket = {
            ...bracket,
            slots: bracket.slots.map((s) =>
              s.matchId === mid
                ? { ...s, winnerParticipantId: wb.participantId }
                : s,
            ),
            championParticipantId: wb.participantId,
          };
        }
        break;
      }
    }
    // Simpler explicit path: finish all non-final, then GF
    n = 0;
    bracket = generateDoubleEliminationBracket(
      ["a", "b", "c", "d"],
      () => `e_${++n}`,
    );
    matchN = 0;
    while (!isTournamentComplete(bracket) && matchN < 30) {
      const ready = listMatchPairs(bracket).filter(pairNeedsMatch);
      if (ready.length === 0) break;
      // Prefer non-reset matches; on GF pick WB side winner
      const pair =
        ready.find((p) => p.side !== "final_reset") ?? ready[0]!;
      const mid = `mx_${++matchN}`;
      bracket = attachMatchId(bracket, [pair.slotA.id, pair.slotB.id], mid);
      let winner = pair.slotA.participantId!;
      let loser = pair.slotB.participantId!;
      if (pair.side === "final") {
        const wbId = bracket.slots.find(
          (s) => s.side === "final" && s.position === 0,
        )?.participantId;
        if (wbId && pair.slotB.participantId === wbId) {
          winner = pair.slotB.participantId!;
          loser = pair.slotA.participantId!;
        } else if (wbId) {
          winner = wbId;
          loser =
            pair.slotA.participantId === wbId
              ? pair.slotB.participantId!
              : pair.slotA.participantId!;
        }
      }
      bracket = applyMatchResult(
        bracket,
        [pair.slotA.id, pair.slotB.id],
        winner,
        loser,
        mid,
      );
    }
    expect(isTournamentComplete(bracket)).toBe(true);
    expect(
      bracket.slots
        .filter((s) => s.side === "final_reset")
        .every((s) => !s.participantId),
    ).toBe(true);
  });

  it("DE 4-player: LB win in GF fills reset slots", () => {
    let n = 0;
    let bracket = generateDoubleEliminationBracket(
      ["a", "b", "c", "d"],
      () => `f_${++n}`,
    );
    let matchN = 0;
    while (matchN < 30) {
      const ready = listMatchPairs(bracket).filter(pairNeedsMatch);
      if (ready.length === 0) break;
      const gf = ready.find((p) => p.side === "final");
      const pair = gf ?? ready[0]!;
      const mid = `fr_${++matchN}`;
      bracket = attachMatchId(bracket, [pair.slotA.id, pair.slotB.id], mid);
      let winner = pair.slotA.participantId!;
      let loser = pair.slotB.participantId!;
      if (pair.side === "final") {
        const lbId = bracket.slots.find(
          (s) => s.side === "final" && s.position === 1,
        )?.participantId;
        if (lbId) {
          winner = lbId;
          loser =
            pair.slotA.participantId === lbId
              ? pair.slotB.participantId!
              : pair.slotA.participantId!;
        }
        bracket = applyMatchResult(
          bracket,
          [pair.slotA.id, pair.slotB.id],
          winner,
          loser,
          mid,
        );
        expect(isTournamentComplete(bracket)).toBe(false);
        const reset = bracket.slots.filter((s) => s.side === "final_reset");
        expect(reset.every((s) => Boolean(s.participantId))).toBe(true);
        // Play reset
        const resetPair = listMatchPairs(bracket).find(
          (p) => p.side === "final_reset" && pairNeedsMatch(p),
        );
        expect(resetPair).toBeTruthy();
        const mid2 = `fr_${++matchN}`;
        bracket = attachMatchId(
          bracket,
          [resetPair!.slotA.id, resetPair!.slotB.id],
          mid2,
        );
        bracket = applyMatchResult(
          bracket,
          [resetPair!.slotA.id, resetPair!.slotB.id],
          resetPair!.slotA.participantId!,
          resetPair!.slotB.participantId!,
          mid2,
        );
        expect(isTournamentComplete(bracket)).toBe(true);
        return;
      }
      bracket = applyMatchResult(
        bracket,
        [pair.slotA.id, pair.slotB.id],
        winner,
        loser,
        mid,
      );
    }
    throw new Error("GF never reached");
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
