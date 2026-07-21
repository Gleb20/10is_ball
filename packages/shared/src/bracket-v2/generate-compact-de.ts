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

function isEmpty(src: ParticipantSource): boolean {
  return src.type === "empty";
}

function isCompetitive(m: BracketMatchNode): boolean {
  return !isEmpty(m.sourceA) && !isEmpty(m.sourceB);
}

/**
 * Compact-pairing one round of entries → match nodes + next-round entries.
 * Same bye rules as compact SE (CompactEntry path history).
 */
function pairCompactRound(
  entries: CompactEntry[],
  stage: "winners" | "losers",
  roundIndex: number,
  idPrefix: string,
  displayStart: number,
): {
  matches: BracketMatchNode[];
  nextEntries: CompactEntry[];
  display: number;
} {
  const matches: BracketMatchNode[] = [];
  let display = displayStart;
  const n = entries.length;
  if (n <= 1) {
    return { matches, nextEntries: entries, display };
  }

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
    const id = `${idPrefix}${roundIndex}_${orderInRound}`;
    matches.push(
      node({
        id,
        stage,
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
    const id = `${idPrefix}${roundIndex}_${orderInRound}`;
    matches.push(
      node({
        id,
        stage,
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

  return { matches, nextEntries, display };
}

function buildCompactWinnersBracket(
  seedOrder: string[],
  displayStart: number,
): {
  matches: BracketMatchNode[];
  display: number;
  finalMatchId: string;
  maxRound: number;
} {
  const matches: BracketMatchNode[] = [];
  let display = displayStart;
  let roundIndex = 0;
  let entries: CompactEntry[] = seedOrder.map((_, i) => ({
    source: { type: "seed", seed: i + 1 } satisfies ParticipantSource,
    receivedByeInPreviousRound: false,
    stableOrder: i,
  }));

  while (entries.length > 1) {
    const result = pairCompactRound(
      entries,
      "winners",
      roundIndex,
      "W",
      display,
    );
    matches.push(...result.matches);
    display = result.display;
    if (result.nextEntries.length === 1) {
      const sole = result.nextEntries[0]!;
      if (sole.source.type !== "winner") {
        throw new Error("WB_FINAL_INVALID");
      }
      return {
        matches,
        display,
        finalMatchId: sole.source.bracketMatchId,
        maxRound: roundIndex,
      };
    }
    entries = result.nextEntries;
    roundIndex += 1;
  }

  throw new Error("WB_EMPTY");
}

/**
 * Compact double-elimination V2.
 * WB = compact SE (no third place). LB = phased compact pairing of
 * competitive WB loser drops (auto-advance WB losers excluded).
 */
export function generateCompactDoubleElimination(input: {
  seedOrder: string[];
}): CompactBracketGraphV2 {
  const seedOrder = [...input.seedOrder];
  const participantCount = seedOrder.length;
  if (participantCount < 3 || participantCount > 64) {
    throw new Error("PARTICIPANT_COUNT_INVALID");
  }

  const matches: BracketMatchNode[] = [];
  let display = 1;

  const wb = buildCompactWinnersBracket(seedOrder, display);
  matches.push(...wb.matches);
  display = wb.display;

  const wbByRound = new Map<number, BracketMatchNode[]>();
  for (const m of wb.matches) {
    const list = wbByRound.get(m.roundIndex) ?? [];
    list.push(m);
    wbByRound.set(m.roundIndex, list);
  }
  const wbRounds = [...wbByRound.keys()].sort((a, b) => a - b);
  const finalRound = Math.max(...wbRounds);
  const wbFinalId = wb.finalMatchId;

  // Competitive drops per WB round (exclude final — handled last)
  function competitiveDrops(round: number): CompactEntry[] {
    const roundMatches = (wbByRound.get(round) ?? [])
      .filter(isCompetitive)
      .sort((a, b) => a.orderInRound - b.orderInRound);
    return roundMatches.map((m, i) => ({
      source: { type: "loser", bracketMatchId: m.id } as ParticipantSource,
      receivedByeInPreviousRound: false,
      stableOrder: i,
    }));
  }

  let lbSurvivors: CompactEntry[] = [];
  let lbRoundIndex = 0;

  // Phases: for each WB round before final, pair (survivors ∪ drops)
  for (const wr of wbRounds) {
    if (wr === finalRound) break;
    const drops = competitiveDrops(wr);
    const entries: CompactEntry[] = [
      ...lbSurvivors.map((e, i) => ({ ...e, stableOrder: i })),
      ...drops.map((e, i) => ({
        ...e,
        receivedByeInPreviousRound: false,
        stableOrder: lbSurvivors.length + i,
      })),
    ];
    if (entries.length === 0) continue;
    if (entries.length === 1) {
      // Single pending path — create auto-advance node so topology is explicit
      const id = `L${lbRoundIndex}_0`;
      matches.push(
        node({
          id,
          stage: "losers",
          roundIndex: lbRoundIndex,
          orderInRound: 0,
          displayNumber: display++,
          sourceA: entries[0]!.source,
          sourceB: { type: "empty" },
        }),
      );
      lbSurvivors = [
        {
          source: { type: "winner", bracketMatchId: id },
          receivedByeInPreviousRound: true,
          stableOrder: 0,
        },
      ];
      lbRoundIndex += 1;
      continue;
    }

    const result = pairCompactRound(
      entries,
      "losers",
      lbRoundIndex,
      "L",
      display,
    );
    matches.push(...result.matches);
    display = result.display;
    lbSurvivors = result.nextEntries;
    lbRoundIndex += 1;
  }

  // Drop WB final loser into LB, then compact-pair until one champion
  const finalDrop: CompactEntry = {
    source: { type: "loser", bracketMatchId: wbFinalId },
    receivedByeInPreviousRound: false,
    stableOrder: lbSurvivors.length,
  };
  let entries: CompactEntry[] = [
    ...lbSurvivors.map((e, i) => ({ ...e, stableOrder: i })),
    { ...finalDrop, stableOrder: lbSurvivors.length },
  ];

  while (entries.length > 1) {
    const result = pairCompactRound(
      entries,
      "losers",
      lbRoundIndex,
      "L",
      display,
    );
    matches.push(...result.matches);
    display = result.display;
    entries = result.nextEntries;
    lbRoundIndex += 1;
  }

  const lbFinalId =
    entries[0]?.source.type === "winner"
      ? entries[0].source.bracketMatchId
      : (() => {
          throw new Error("LB_FINAL_MISSING");
        })();

  matches.push(
    node({
      id: "GF1",
      stage: "grand_final",
      roundIndex: 0,
      orderInRound: 0,
      displayNumber: display++,
      sourceA: { type: "winner", bracketMatchId: wbFinalId },
      sourceB: { type: "winner", bracketMatchId: lbFinalId },
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
    constructionAlgorithm: "compact",
    format: "double_elimination",
    participantCount,
    seedOrder,
    thirdPlaceEnabled: false,
    matches,
    championParticipantId: null,
    runnerUpParticipantId: null,
    thirdPlaceParticipantId: null,
  };
}
