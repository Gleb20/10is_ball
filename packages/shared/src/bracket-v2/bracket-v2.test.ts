import { describe, expect, it } from "vitest";
import {
  applyBracketResult,
  buildDestinationIndex,
  deriveBracketMatchState,
  generateDoubleEliminationV2,
  generateSingleEliminationV2,
  isPermanentlyBlocked,
  isBracketGraphComplete,
  parseBracketJson,
  propagateByesFixpoint,
  resolveSource,
  simulateBracket,
  validateBracketGraph,
  type BracketGraphV2,
} from "./index.js";

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `p${i + 1}`);
}

describe("bracket-v2 SE", () => {
  it("N=5: Challonge placement — bye seeds 1–3, play 4 vs 5", () => {
    const g = generateSingleEliminationV2({
      seedOrder: ids(5),
      thirdPlaceEnabled: false,
    });
    expect(g.bracketSize).toBe(8);
    expect(g.participantCount).toBe(5);
    validateBracketGraph(g);
    const r0 = g.matches.filter((m) => m.id.startsWith("W0_"));
    const playable = r0.filter((m) => {
      const a = resolveSource(g, m.sourceA);
      const b = resolveSource(g, m.sourceB);
      return a.kind === "resolved" && b.kind === "resolved";
    });
    expect(playable).toHaveLength(1);
    const sides = [
      resolveSource(g, playable[0]!.sourceA),
      resolveSource(g, playable[0]!.sourceB),
    ]
      .filter((s) => s.kind === "resolved")
      .map((s) => (s as { participantId: string }).participantId)
      .sort();
    // seeds 4 and 5 → p4, p5
    expect(sides).toEqual(["p4", "p5"]);
  });

  it("N=5 completes with N-1 competitive matches", () => {
    let g = generateSingleEliminationV2({
      seedOrder: ids(5),
      thirdPlaceEnabled: false,
    });
    g = simulateBracket(g, "lowerSeed");
    expect(isBracketGraphComplete(g)).toBe(true);
    expect(g.championParticipantId).toBeTruthy();
    const competitive = g.matches.filter(
      (m) => m.winnerParticipantId && m.loserParticipantId,
    ).length;
    expect(competitive).toBe(4);
  });

  it("third place sources are semi losers (N=8)", () => {
    const g = generateSingleEliminationV2({
      seedOrder: ids(8),
      thirdPlaceEnabled: true,
    });
    const tp = g.matches.find((m) => m.id === "TP0_0")!;
    expect(tp.sourceA).toEqual({ type: "loser", bracketMatchId: "W1_0" });
    expect(tp.sourceB).toEqual({ type: "loser", bracketMatchId: "W1_1" });
  });
});

describe("bracket-v2 DE topology golden", () => {
  it("size 4 sources", () => {
    const g = generateDoubleEliminationV2({ seedOrder: ids(4) });
    validateBracketGraph(g);
    const byId = Object.fromEntries(g.matches.map((m) => [m.id, m]));
    expect(byId.W0_0!.sourceA).toEqual({ type: "seed", seed: 1 });
    expect(byId.L0_0!.sourceA).toEqual({ type: "loser", bracketMatchId: "W0_0" });
    expect(byId.L0_0!.sourceB).toEqual({ type: "loser", bracketMatchId: "W0_1" });
    expect(byId.L1_0!.sourceA).toEqual({ type: "winner", bracketMatchId: "L0_0" });
    expect(byId.L1_0!.sourceB).toEqual({ type: "loser", bracketMatchId: "W1_0" });
    expect(byId.GF1!.sourceA).toEqual({ type: "winner", bracketMatchId: "W1_0" });
    expect(byId.GF1!.sourceB).toEqual({ type: "winner", bracketMatchId: "L1_0" });
    expect(byId.GF2!.sourceA).toEqual({ type: "winner", bracketMatchId: "GF1" });
    expect(byId.GF2!.sourceB).toEqual({ type: "loser", bracketMatchId: "GF1" });
  });

  it("size 8 reverse drop L1", () => {
    const g = generateDoubleEliminationV2({ seedOrder: ids(8) });
    validateBracketGraph(g);
    const L1_0 = g.matches.find((m) => m.id === "L1_0")!;
    const L1_1 = g.matches.find((m) => m.id === "L1_1")!;
    expect(L1_0.sourceB).toEqual({ type: "loser", bracketMatchId: "W1_1" });
    expect(L1_1.sourceB).toEqual({ type: "loser", bracketMatchId: "W1_0" });
  });

  it("size 16 reverse drops", () => {
    const g = generateDoubleEliminationV2({ seedOrder: ids(16) });
    validateBracketGraph(g);
    expect(g.matches.find((m) => m.id === "L1_0")!.sourceB).toEqual({
      type: "loser",
      bracketMatchId: "W1_3",
    });
    expect(g.matches.find((m) => m.id === "L3_0")!.sourceB).toEqual({
      type: "loser",
      bracketMatchId: "W2_1",
    });
  });
});

describe("bracket-v2 GF2 activation", () => {
  function playUntilGf1(strategy: "alwaysA" | "alwaysB" | "lowerSeed") {
    let g = generateDoubleEliminationV2({ seedOrder: ids(4) });
    g = propagateByesFixpoint(g);
    // Manual sim until GF1 ready then one result
    g = simulateToMatch(g, "GF1", strategy);
    return g;
  }

  function simulateToMatch(
    graph: BracketGraphV2,
    stopBeforeId: string,
    strategy: "alwaysA" | "alwaysB" | "lowerSeed",
  ): BracketGraphV2 {
    let g = propagateByesFixpoint(graph);
    for (let i = 0; i < 50; i += 1) {
      g = propagateByesFixpoint(g);
      const ready = g.matches.filter(
        (m) => deriveBracketMatchState(g, m.id) === "ready",
      );
      if (ready.length === 0) break;
      const next = ready.sort((a, b) => a.displayNumber - b.displayNumber)[0]!;
      if (next.id === stopBeforeId) return g;
      const sides = {
        a: resolveSource(g, next.sourceA),
        b: resolveSource(g, next.sourceB),
      };
      if (sides.a.kind !== "resolved" || sides.b.kind !== "resolved") break;
      let winner = sides.a.participantId;
      if (strategy === "alwaysB") winner = sides.b.participantId;
      if (strategy === "lowerSeed") {
        const ia = g.seedOrder.indexOf(sides.a.participantId);
        const ib = g.seedOrder.indexOf(sides.b.participantId);
        winner = ia <= ib ? sides.a.participantId : sides.b.participantId;
      }
      const loser =
        winner === sides.a.participantId
          ? sides.b.participantId
          : sides.a.participantId;
      g = applyBracketResult(g, {
        bracketMatchId: next.id,
        winnerParticipantId: winner,
        loserParticipantId: loser,
      });
    }
    return g;
  }

  it("WB champion wins GF1 → GF2 inactive, tournament complete", () => {
    // alwaysA on GF1: sourceA is WB champ
    let g = playUntilGf1("lowerSeed");
    const gf1 = g.matches.find((m) => m.id === "GF1")!;
    expect(deriveBracketMatchState(g, "GF1")).toBe("ready");
    const a = resolveSource(g, gf1.sourceA);
    const b = resolveSource(g, gf1.sourceB);
    expect(a.kind).toBe("resolved");
    expect(b.kind).toBe("resolved");
    g = applyBracketResult(g, {
      bracketMatchId: "GF1",
      winnerParticipantId: (a as { participantId: string }).participantId,
      loserParticipantId: (b as { participantId: string }).participantId,
    });
    expect(deriveBracketMatchState(g, "GF2")).toBe("inactive");
    expect(isBracketGraphComplete(g)).toBe(true);
    expect(isPermanentlyBlocked(g, "GF2")).toBe(false);
  });

  it("LB champion wins GF1 → GF2 active with both finalists", () => {
    let g = playUntilGf1("lowerSeed");
    const gf1 = g.matches.find((m) => m.id === "GF1")!;
    const a = resolveSource(g, gf1.sourceA) as { participantId: string };
    const b = resolveSource(g, gf1.sourceB) as { participantId: string };
    g = applyBracketResult(g, {
      bracketMatchId: "GF1",
      winnerParticipantId: b.participantId,
      loserParticipantId: a.participantId,
    });
    expect(deriveBracketMatchState(g, "GF2")).toBe("ready");
    const gf2 = g.matches.find((m) => m.id === "GF2")!;
    const sA = resolveSource(g, gf2.sourceA);
    const sB = resolveSource(g, gf2.sourceB);
    expect(sA).toEqual({ kind: "resolved", participantId: b.participantId });
    expect(sB).toEqual({ kind: "resolved", participantId: a.participantId });
    expect(isBracketGraphComplete(g)).toBe(false);
  });
});

describe("bracket-v2 empty / bye resolution", () => {
  it("loser of auto-advanced WB is structurally_empty", () => {
    const g0 = generateDoubleEliminationV2({ seedOrder: ids(5) });
    const g = propagateByesFixpoint(g0);
    // Find auto-advanced W0 (one side empty)
    const auto = g.matches.find(
      (m) =>
        m.id.startsWith("W0_") &&
        m.winnerParticipantId &&
        !m.loserParticipantId,
    );
    expect(auto).toBeTruthy();
    const loserRes = resolveSource(g, {
      type: "loser",
      bracketMatchId: auto!.id,
    });
    expect(loserRes.kind).toBe("structurally_empty");
  });

  it("two structurally empty sources propagate emptiness", () => {
    let g = generateSingleEliminationV2({
      seedOrder: ids(3),
      thirdPlaceEnabled: false,
    });
    // Force a synthetic empty-empty by checking a bye-pad scenario:
    // After propagate, winner of empty-empty path should be empty
    g = propagateByesFixpoint(g);
    const emptyEmpty = g.matches.find((m) => {
      const a = resolveSource(g, m.sourceA);
      const b = resolveSource(g, m.sourceB);
      return a.kind === "structurally_empty" && b.kind === "structurally_empty";
    });
    // May not exist for N=3; create micro graph
    if (!emptyEmpty) {
      const micro: BracketGraphV2 = {
        schemaVersion: 2,
        format: "single_elimination",
        participantCount: 3,
        bracketSize: 4,
        seedOrder: ids(3),
        thirdPlaceEnabled: false,
        matches: [
          {
            id: "E0",
            stage: "winners",
            roundIndex: 0,
            orderInRound: 0,
            displayNumber: 1,
            sourceA: { type: "empty" },
            sourceB: { type: "empty" },
            winnerParticipantId: null,
            loserParticipantId: null,
            actualMatchId: null,
            cancelled: false,
            activationCondition: null,
          },
          {
            id: "E1",
            stage: "winners",
            roundIndex: 1,
            orderInRound: 0,
            displayNumber: 2,
            sourceA: { type: "winner", bracketMatchId: "E0" },
            sourceB: { type: "seed", seed: 1 },
            winnerParticipantId: null,
            loserParticipantId: null,
            actualMatchId: null,
            cancelled: false,
            activationCondition: null,
          },
        ],
        championParticipantId: null,
        runnerUpParticipantId: null,
        thirdPlaceParticipantId: null,
      };
      const w = resolveSource(micro, {
        type: "winner",
        bracketMatchId: "E0",
      });
      expect(w.kind).toBe("structurally_empty");
    }
  });
});

describe("bracket-v2 DE complete sims", () => {
  for (const n of [4, 5, 6, 7, 8, 9]) {
    it(`DE N=${n} completes (lowerSeed)`, () => {
      let g = generateDoubleEliminationV2({ seedOrder: ids(n) });
      g = simulateBracket(g, "lowerSeed");
      expect(isBracketGraphComplete(g)).toBe(true);
      expect(deriveBracketMatchState(g, "GF2")).not.toBe("blocked");
    });
  }
});

describe("parseBracketJson", () => {
  it("discriminates missing / v1 / v2 / unsupported / corrupt", () => {
    expect(parseBracketJson(null).kind).toBe("missing");
    expect(parseBracketJson({ slots: [] }).kind).toBe("v1");
    expect(parseBracketJson({ schemaVersion: 1 }).kind).toBe("v1");
    const g = generateSingleEliminationV2({ seedOrder: ids(4) });
    expect(parseBracketJson(g).kind).toBe("v2");
    expect(parseBracketJson({ schemaVersion: 99 }).kind).toBe("unsupported");
    expect(parseBracketJson({ schemaVersion: 2 }).kind).toBe("corrupt");
  });
});

describe("destinations index", () => {
  it("builds inverse without duplicate", () => {
    const g = generateDoubleEliminationV2({ seedOrder: ids(4) });
    const idx = buildDestinationIndex(g);
    expect(idx.winners.get("W0_0")?.bracketMatchId).toBe("W1_0");
    expect(idx.losers.get("W0_0")?.bracketMatchId).toBe("L0_0");
  });
});
