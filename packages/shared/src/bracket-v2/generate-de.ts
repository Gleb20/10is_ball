import { nextPowerOf2, seedAtPosition } from "./seed.js";
import type { BracketGraphV2, BracketMatchNode } from "./types.js";

function node(
  partial: Omit<
    BracketMatchNode,
    | "winnerParticipantId"
    | "loserParticipantId"
    | "actualMatchId"
    | "cancelled"
    | "activationCondition"
  > &
    Partial<
      Pick<
        BracketMatchNode,
        | "winnerParticipantId"
        | "loserParticipantId"
        | "actualMatchId"
        | "cancelled"
        | "activationCondition"
      >
    >,
): BracketMatchNode {
  return {
    winnerParticipantId: null,
    loserParticipantId: null,
    actualMatchId: null,
    cancelled: false,
    activationCondition: null,
    ...partial,
  };
}

function lbMatchCount(bracketSize: number, lr: number): number {
  return bracketSize / 2 ** (Math.floor(lr / 2) + 2);
}

/**
 * Challonge-inspired canonical double-elimination topology.
 * No third-place / placement matches (product diff from Challonge).
 */
export function generateDoubleEliminationV2(input: {
  seedOrder: string[];
}): BracketGraphV2 {
  const seedOrder = [...input.seedOrder];
  const participantCount = seedOrder.length;
  if (participantCount < 3 || participantCount > 64) {
    throw new Error("PARTICIPANT_COUNT_INVALID");
  }
  const bracketSize = nextPowerOf2(participantCount);
  const wbDepth = Math.log2(bracketSize);
  const lbRounds = 2 * (wbDepth - 1);
  const matches: BracketMatchNode[] = [];
  let display = 1;

  // Winners bracket
  const r0Count = bracketSize / 2;
  for (let m = 0; m < r0Count; m += 1) {
    matches.push(
      node({
        id: `W0_${m}`,
        stage: "winners",
        roundIndex: 0,
        orderInRound: m,
        displayNumber: display++,
        sourceA: seedAtPosition(seedOrder, bracketSize, m * 2),
        sourceB: seedAtPosition(seedOrder, bracketSize, m * 2 + 1),
      }),
    );
  }
  for (let r = 1; r < wbDepth; r += 1) {
    const count = bracketSize / 2 ** (r + 1);
    for (let m = 0; m < count; m += 1) {
      matches.push(
        node({
          id: `W${r}_${m}`,
          stage: "winners",
          roundIndex: r,
          orderInRound: m,
          displayNumber: display++,
          sourceA: { type: "winner", bracketMatchId: `W${r - 1}_${m * 2}` },
          sourceB: {
            type: "winner",
            bracketMatchId: `W${r - 1}_${m * 2 + 1}`,
          },
        }),
      );
    }
  }

  // Losers bracket
  for (let lr = 0; lr < lbRounds; lr += 1) {
    const M = lbMatchCount(bracketSize, lr);
    for (let m = 0; m < M; m += 1) {
      let sourceA: BracketMatchNode["sourceA"];
      let sourceB: BracketMatchNode["sourceB"];

      if (lr === 0) {
        // Minor from WB0 losers
        sourceA = { type: "loser", bracketMatchId: `W0_${m * 2}` };
        sourceB = { type: "loser", bracketMatchId: `W0_${m * 2 + 1}` };
      } else if (lr % 2 === 1) {
        // Drop-in: A = winner of previous LB; B = WB loser reversed
        const w = (lr + 1) / 2; // WB round feeding this drop-in
        sourceA = { type: "winner", bracketMatchId: `L${lr - 1}_${m}` };
        sourceB = {
          type: "loser",
          bracketMatchId: `W${w}_${M - 1 - m}`,
        };
      } else {
        // Minor consolidation from previous drop-in
        sourceA = { type: "winner", bracketMatchId: `L${lr - 1}_${m * 2}` };
        sourceB = {
          type: "winner",
          bracketMatchId: `L${lr - 1}_${m * 2 + 1}`,
        };
      }

      matches.push(
        node({
          id: `L${lr}_${m}`,
          stage: "losers",
          roundIndex: lr,
          orderInRound: m,
          displayNumber: display++,
          sourceA,
          sourceB,
        }),
      );
    }
  }

  const wbFinal = `W${wbDepth - 1}_0`;
  const lbFinal = `L${lbRounds - 1}_0`;

  matches.push(
    node({
      id: "GF1",
      stage: "grand_final",
      roundIndex: 0,
      orderInRound: 0,
      displayNumber: display++,
      sourceA: { type: "winner", bracketMatchId: wbFinal },
      sourceB: { type: "winner", bracketMatchId: lbFinal },
    }),
  );

  matches.push(
    node({
      id: "GF2",
      stage: "grand_final_reset",
      roundIndex: 0,
      orderInRound: 0,
      displayNumber: display++,
      sourceA: { type: "winner", bracketMatchId: "GF1" },
      sourceB: { type: "loser", bracketMatchId: "GF1" },
      activationCondition: {
        type: "gf1_won_by_source_b",
        grandFinalMatchId: "GF1",
      },
    }),
  );

  return {
    schemaVersion: 2,
    constructionAlgorithm: "power_of_two",
    format: "double_elimination",
    participantCount,
    bracketSize,
    seedOrder,
    thirdPlaceEnabled: false,
    matches,
    championParticipantId: null,
    runnerUpParticipantId: null,
    thirdPlaceParticipantId: null,
  };
}
