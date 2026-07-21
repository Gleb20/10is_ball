import { thirdPlaceSourcesFromFinal } from "./third-place.js";
import type {
  BracketMatchNode,
  CompactBracketGraphV2,
  CompactEntry,
  ParticipantSource,
} from "./types.js";

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

/**
 * Compact single-elimination V2: build by actual entry count (no pad-to-Po2).
 * Odd rounds: exactly one auto-advance; prefer path that did not receive bye
 * in the previous round (last candidate; fallback last entry).
 */
export function generateCompactSingleElimination(input: {
  seedOrder: string[];
  thirdPlaceEnabled?: boolean;
}): CompactBracketGraphV2 {
  const seedOrder = [...input.seedOrder];
  const participantCount = seedOrder.length;
  if (participantCount < 3 || participantCount > 64) {
    throw new Error("PARTICIPANT_COUNT_INVALID");
  }
  const wantThirdPlace =
    (input.thirdPlaceEnabled ?? true) && participantCount >= 4;

  const matches: BracketMatchNode[] = [];
  let display = 1;
  let roundIndex = 0;

  let entries: CompactEntry[] = seedOrder.map((_, i) => ({
    source: { type: "seed", seed: i + 1 } satisfies ParticipantSource,
    receivedByeInPreviousRound: false,
    stableOrder: i,
  }));

  while (entries.length > 1) {
    const n = entries.length;
    let byeEntry: CompactEntry | null = null;
    let playEntries = entries;

    if (n % 2 === 1) {
      const eligible = entries.filter((e) => !e.receivedByeInPreviousRound);
      const pool = eligible.length > 0 ? eligible : entries;
      byeEntry = pool[pool.length - 1]!;
      playEntries = entries.filter((e) => e !== byeEntry);
    }

    const competitiveWinners: CompactEntry[] = [];
    const matchCount = playEntries.length / 2;
    for (let m = 0; m < matchCount; m += 1) {
      const a = playEntries[m * 2]!;
      const b = playEntries[m * 2 + 1]!;
      const orderInRound = m;
      const id = `W${roundIndex}_${orderInRound}`;
      matches.push(
        node({
          id,
          stage: "winners",
          roundIndex,
          orderInRound,
          displayNumber: display++,
          sourceA: a.source,
          sourceB: b.source,
        }),
      );
      competitiveWinners.push({
        source: { type: "winner", bracketMatchId: id },
        receivedByeInPreviousRound: false,
        stableOrder: competitiveWinners.length,
      });
    }

    let nextEntries: CompactEntry[];
    if (byeEntry) {
      const orderInRound = matchCount;
      const id = `W${roundIndex}_${orderInRound}`;
      matches.push(
        node({
          id,
          stage: "winners",
          roundIndex,
          orderInRound,
          displayNumber: display++,
          sourceA: byeEntry.source,
          sourceB: { type: "empty" },
        }),
      );
      nextEntries = [
        {
          source: { type: "winner", bracketMatchId: id },
          receivedByeInPreviousRound: true,
          stableOrder: 0,
        },
        ...competitiveWinners.map((e, i) => ({
          ...e,
          stableOrder: i + 1,
        })),
      ];
    } else {
      nextEntries = competitiveWinners;
    }

    if (nextEntries.length === 1) break;

    entries = nextEntries;
    roundIndex += 1;
  }

  let graph: CompactBracketGraphV2 = {
    schemaVersion: 2,
    constructionAlgorithm: "compact",
    format: "single_elimination",
    participantCount,
    seedOrder,
    thirdPlaceEnabled: wantThirdPlace,
    matches,
    championParticipantId: null,
    runnerUpParticipantId: null,
    thirdPlaceParticipantId: null,
  };

  if (wantThirdPlace) {
    const tp = thirdPlaceSourcesFromFinal(graph);
    if (tp) {
      matches.push(
        node({
          id: "TP0_0",
          stage: "third_place",
          roundIndex: 0,
          orderInRound: 0,
          displayNumber: display++,
          sourceA: tp.sourceA,
          sourceB: tp.sourceB,
        }),
      );
      graph = { ...graph, matches: [...matches] };
    } else {
      graph = { ...graph, thirdPlaceEnabled: false };
    }
  }

  return graph;
}
