import { describe, expect, it } from "vitest";
import {
  generateDoubleEliminationBracket,
  generateSingleEliminationBracket,
  seedParticipants,
} from "./tournament-bracket.js";

describe("REQ_TRN__bracket_generation", () => {
  it("AT-TRN: seeds by wins descending", () => {
    const seeded = seedParticipants([
      { id: "a", wins: 1 },
      { id: "b", wins: 5 },
      { id: "c", wins: 3 },
    ]);
    expect(seeded).toEqual(["b", "c", "a"]);
  });

  it("rejects fewer than 3 participants", () => {
    expect(() =>
      generateSingleEliminationBracket(["a", "b"], () => "x"),
    ).toThrow("PARTICIPANT_COUNT_INVALID");
  });

  it("creates power-of-2 bracket with byes for 3 players", () => {
    let n = 0;
    const ids = () => `s_${++n}`;
    const bracket = generateSingleEliminationBracket(
      ["p1", "p2", "p3"],
      ids,
    );
    expect(bracket.size).toBe(4);
    expect(bracket.format).toBe("single_elimination");
    const first = bracket.slots.filter((s) => s.round === 0);
    expect(first.filter((s) => s.isBye).length).toBe(1);
    expect(first.filter((s) => s.participantId).length).toBe(3);
  });

  it("double elimination adds losers and final slots", () => {
    let n = 0;
    const bracket = generateDoubleEliminationBracket(
      ["a", "b", "c", "d"],
      () => `d_${++n}`,
    );
    expect(bracket.format).toBe("double_elimination");
    expect(bracket.slots.some((s) => s.side === "losers")).toBe(true);
    expect(bracket.slots.some((s) => s.side === "final")).toBe(true);
  });
});
