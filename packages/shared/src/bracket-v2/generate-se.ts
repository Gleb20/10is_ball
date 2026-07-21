import { nextPowerOf2, seedAtPosition } from "./seed.js";
import type {
  BracketGraphV2,
  BracketMatchNode,
  ParticipantSource,
} from "./types.js";

function node(
  partial: Omit<BracketMatchNode, "winnerParticipantId" | "loserParticipantId" | "actualMatchId" | "cancelled" | "activationCondition"> &
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

/**
 * Single elimination, pad to bracketSize = nextPowerOf2(N).
 * BYE only as structurally empty R0 seeds; third place from semis when enabled.
 */
export function generateSingleEliminationV2(input: {
  seedOrder: string[];
  thirdPlaceEnabled?: boolean;
}): BracketGraphV2 {
  const seedOrder = [...input.seedOrder];
  const participantCount = seedOrder.length;
  if (participantCount < 3 || participantCount > 64) {
    throw new Error("PARTICIPANT_COUNT_INVALID");
  }
  const thirdPlaceEnabled = input.thirdPlaceEnabled ?? true;
  const bracketSize = nextPowerOf2(participantCount);
  const wbDepth = Math.log2(bracketSize);
  const matches: BracketMatchNode[] = [];
  let display = 1;

  // R0
  const r0Count = bracketSize / 2;
  for (let m = 0; m < r0Count; m += 1) {
    const posA = m * 2;
    const posB = m * 2 + 1;
    matches.push(
      node({
        id: `W0_${m}`,
        stage: "winners",
        roundIndex: 0,
        orderInRound: m,
        displayNumber: display++,
        sourceA: seedAtPosition(seedOrder, bracketSize, posA),
        sourceB: seedAtPosition(seedOrder, bracketSize, posB),
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

  if (thirdPlaceEnabled && bracketSize >= 4) {
    const semiRound = wbDepth - 2;
    if (semiRound >= 0) {
      matches.push(
        node({
          id: "TP0_0",
          stage: "third_place",
          roundIndex: 0,
          orderInRound: 0,
          displayNumber: display++,
          sourceA: {
            type: "loser",
            bracketMatchId: `W${semiRound}_0`,
          },
          sourceB: {
            type: "loser",
            bracketMatchId: `W${semiRound}_1`,
          },
        }),
      );
    }
  }

  return {
    schemaVersion: 2,
    format: "single_elimination",
    participantCount,
    bracketSize,
    seedOrder,
    thirdPlaceEnabled,
    matches,
    championParticipantId: null,
    runnerUpParticipantId: null,
    thirdPlaceParticipantId: null,
  };
}

export function sourceLabel(s: ParticipantSource): string {
  if (s.type === "seed") return `seed(${s.seed})`;
  if (s.type === "winner") return `W(${s.bracketMatchId})`;
  if (s.type === "loser") return `L(${s.bracketMatchId})`;
  return "empty";
}
