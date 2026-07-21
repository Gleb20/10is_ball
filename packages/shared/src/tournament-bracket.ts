/**
 * Single / double elimination bracket helpers.
 * TOURNAMENT — Phase 6 domain.
 */

export type BracketSlot = {
  id: string;
  round: number;
  position: number;
  side: "main" | "losers" | "final" | "final_reset" | "third_place";
  participantId: string | null;
  isBye: boolean;
  advancesToSlotId: string | null;
  loserToSlotId: string | null;
  /** Linked playable match (when both sides of a pair are ready). */
  matchId: string | null;
  winnerParticipantId: string | null;
};

export type Bracket = {
  slots: BracketSlot[];
  size: number;
  format: "single_elimination" | "double_elimination";
  thirdPlaceSlotId: string | null;
  championParticipantId: string | null;
};

export type MatchPair = {
  slotA: BracketSlot;
  slotB: BracketSlot;
  targetSlotId: string | null;
  side: BracketSlot["side"];
  round: number;
};

function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function emptySlot(
  partial: Omit<BracketSlot, "matchId" | "winnerParticipantId"> &
    Partial<Pick<BracketSlot, "matchId" | "winnerParticipantId">>,
): BracketSlot {
  return {
    matchId: null,
    winnerParticipantId: null,
    ...partial,
  };
}

/**
 * Seed by wins desc. Equal wins (incl. 0 / unranked) shuffled via rng for AT-TRN-005.
 */
export function seedParticipants(
  participants: { id: string; wins: number }[],
  rng: () => number = Math.random,
): string[] {
  const ranked = participants.filter((p) => p.wins > 0);
  const unranked = participants.filter((p) => p.wins <= 0);
  ranked.sort((a, b) => b.wins - a.wins || a.id.localeCompare(b.id));
  const shuffledUnranked = [...unranked];
  for (let i = shuffledUnranked.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffledUnranked[i]!;
    shuffledUnranked[i] = shuffledUnranked[j]!;
    shuffledUnranked[j] = tmp;
  }
  return [...ranked, ...shuffledUnranked].map((p) => p.id);
}

/** Classic single-elim pairing with byes + optional third-place slot. */
export function generateSingleEliminationBracket(
  seededIds: string[],
  idFactory: () => string,
): Bracket {
  if (seededIds.length < 3 || seededIds.length > 64) {
    throw new Error("PARTICIPANT_COUNT_INVALID");
  }
  const size = nextPowerOf2(seededIds.length);
  const rounds = Math.log2(size);
  const slots: BracketSlot[] = [];

  const firstRound: BracketSlot[] = [];
  for (let i = 0; i < size; i += 1) {
    firstRound.push(
      emptySlot({
        id: idFactory(),
        round: 0,
        position: i,
        side: "main",
        participantId: null,
        isBye: false,
        advancesToSlotId: null,
        loserToSlotId: null,
      }),
    );
  }

  const placement = standardPlacement(size);
  for (let seed = 0; seed < seededIds.length; seed += 1) {
    const pos = placement[seed]!;
    firstRound[pos]!.participantId = seededIds[seed]!;
  }
  for (const slot of firstRound) {
    if (!slot.participantId) slot.isBye = true;
  }
  slots.push(...firstRound);

  let prevRound = firstRound;
  for (let r = 1; r <= rounds; r += 1) {
    const count = size / 2 ** r;
    const roundSlots: BracketSlot[] = [];
    for (let i = 0; i < count; i += 1) {
      roundSlots.push(
        emptySlot({
          id: idFactory(),
          round: r,
          position: i,
          side: "main",
          participantId: null,
          isBye: false,
          advancesToSlotId: null,
          loserToSlotId: null,
        }),
      );
    }
    for (let i = 0; i < prevRound.length; i += 2) {
      const a = prevRound[i]!;
      const b = prevRound[i + 1]!;
      const target = roundSlots[Math.floor(i / 2)]!;
      a.advancesToSlotId = target.id;
      b.advancesToSlotId = target.id;

      if (a.isBye && !b.isBye && b.participantId) {
        target.participantId = b.participantId;
        a.winnerParticipantId = b.participantId;
      } else if (b.isBye && !a.isBye && a.participantId) {
        target.participantId = a.participantId;
        b.winnerParticipantId = a.participantId;
      } else if (a.isBye && b.isBye) {
        target.isBye = true;
      }
    }
    slots.push(...roundSlots);
    prevRound = roundSlots;
  }

  let thirdPlaceSlotId: string | null = null;
  if (size >= 4) {
    const third = emptySlot({
      id: idFactory(),
      round: 0,
      position: 0,
      side: "third_place",
      participantId: null,
      isBye: false,
      advancesToSlotId: null,
      loserToSlotId: null,
    });
    // dual-slot third place: store placeholder B as second slot
    const thirdB = emptySlot({
      id: idFactory(),
      round: 0,
      position: 1,
      side: "third_place",
      participantId: null,
      isBye: false,
      advancesToSlotId: null,
      loserToSlotId: null,
    });
    thirdPlaceSlotId = third.id;
    const semis = slots.filter(
      (s) => s.side === "main" && s.round === rounds - 1,
    );
    for (const semi of semis) {
      // losers of semis feed third-place slots (A then B)
      if (!semi.loserToSlotId) {
        semi.loserToSlotId =
          semis.indexOf(semi) === 0 ? third.id : thirdB.id;
      }
    }
    if (semis[0]) semis[0].loserToSlotId = third.id;
    if (semis[1]) semis[1].loserToSlotId = thirdB.id;
    slots.push(third, thirdB);
  }

  return {
    slots,
    size,
    format: "single_elimination",
    thirdPlaceSlotId,
    championParticipantId: null,
  };
}

function standardPlacement(size: number): number[] {
  if (size === 1) return [0];
  if (size === 2) return [0, 1];
  const half = standardPlacement(size / 2);
  const result: number[] = [];
  for (const pos of half) {
    result.push(pos);
    result.push(size - 1 - pos);
  }
  return result;
}

export function thirdPlaceParticipantIds(
  bracket: Bracket,
): { semiLoserA: string | null; semiLoserB: string | null } | null {
  if (bracket.format !== "single_elimination" || bracket.size < 4) return null;
  const thirds = bracket.slots
    .filter((s) => s.side === "third_place")
    .sort((a, b) => a.position - b.position);
  if (thirds.length < 2) return null;
  return {
    semiLoserA: thirds[0]!.participantId,
    semiLoserB: thirds[1]!.participantId,
  };
}

/**
 * Double elimination (Challonge-style):
 * - Winners bracket = SE without third-place / terminal champion slot
 * - Losers: alternating drop-in rounds + internal rounds
 * - Grand Final + optional final_reset slots (filled when LB champ wins GF1)
 */
export function generateDoubleEliminationBracket(
  seededIds: string[],
  idFactory: () => string,
): Bracket {
  const single = generateSingleEliminationBracket(seededIds, idFactory);
  const size = single.size;
  const wbDepth = Math.log2(size); // rounds of WB matches: 0..wbDepth-1

  // Keep WB match rounds only (drop SE champion resting slot at round wbDepth)
  const mainSlots = single.slots
    .filter((s) => s.side === "main" && s.round < wbDepth)
    .map((s) => ({
      ...s,
      loserToSlotId: null as string | null,
    }));

  // Clear advances on last WB round — will point to GF
  for (const s of mainSlots) {
    if (s.round === wbDepth - 1) s.advancesToSlotId = null;
  }

  const lbRoundCount = 2 * (wbDepth - 1);
  const losersByRound: BracketSlot[][] = [];

  for (let lr = 0; lr < lbRoundCount; lr += 1) {
    const matchCount = Math.ceil(
      size / 2 ** (Math.floor(lr / 2) + 2),
    );
    const roundSlots: BracketSlot[] = [];
    for (let i = 0; i < matchCount * 2; i += 1) {
      roundSlots.push(
        emptySlot({
          id: idFactory(),
          round: lr,
          position: i,
          side: "losers",
          participantId: null,
          isBye: false,
          advancesToSlotId: null,
          loserToSlotId: null,
        }),
      );
    }
    losersByRound.push(roundSlots);
  }

  // Wire LB advances: each pair → next round (or GF later)
  for (let lr = 0; lr < lbRoundCount; lr += 1) {
    const roundSlots = losersByRound[lr]!;
    const next = losersByRound[lr + 1];
    for (let i = 0; i + 1 < roundSlots.length; i += 2) {
      const a = roundSlots[i]!;
      const b = roundSlots[i + 1]!;
      if (next) {
        // Even→odd (drop-in) rounds: winners go to even positions of next
        // Odd→even (internal) rounds: winners fill next pair in order
        const matchIndex = Math.floor(i / 2);
        if (lr % 2 === 0 && next.length === roundSlots.length) {
          // same match count: survivor vs drop — advance to even slot of same match index
          const target = next[matchIndex * 2];
          if (target) {
            a.advancesToSlotId = target.id;
            b.advancesToSlotId = target.id;
          }
        } else {
          const target = next[matchIndex];
          // when next is half size, each match feeds one slot of next pair
          const dest =
            next.length === roundSlots.length / 2
              ? next[matchIndex]
              : next[matchIndex * 2];
          const t = dest ?? target;
          if (t) {
            a.advancesToSlotId = t.id;
            b.advancesToSlotId = t.id;
          }
        }
      }
    }
  }

  // WB R0 losers → LB R0 (one loser per WB match → distinct LB slots)
  const wb0 = mainSlots.filter((s) => s.round === 0).sort((a, b) => a.position - b.position);
  const lb0 = losersByRound[0] ?? [];
  for (let m = 0; m < wb0.length / 2; m += 1) {
    const target = lb0[m];
    if (!target) continue;
    wb0[m * 2]!.loserToSlotId = target.id;
    wb0[m * 2 + 1]!.loserToSlotId = target.id;
  }

  // WB later rounds drop into odd LB rounds (1, 3, …)
  for (let wr = 1; wr < wbDepth; wr += 1) {
    const lbRoundIndex = wr * 2 - 1; // WB1 → LB1, WB2 → LB3, …
    const lbRound = losersByRound[lbRoundIndex];
    if (!lbRound) continue;
    const wbRound = mainSlots
      .filter((s) => s.round === wr)
      .sort((a, b) => a.position - b.position);
    for (let m = 0; m < wbRound.length / 2; m += 1) {
      // Drop into odd position of match m (even = LB survivor)
      const dropSlot = lbRound[m * 2 + 1] ?? lbRound[m * 2];
      if (!dropSlot) continue;
      wbRound[m * 2]!.loserToSlotId = dropSlot.id;
      wbRound[m * 2 + 1]!.loserToSlotId = dropSlot.id;
    }
  }

  const finalA = emptySlot({
    id: idFactory(),
    round: 0,
    position: 0,
    side: "final",
    participantId: null,
    isBye: false,
    advancesToSlotId: null,
    loserToSlotId: null,
  });
  const finalB = emptySlot({
    id: idFactory(),
    round: 0,
    position: 1,
    side: "final",
    participantId: null,
    isBye: false,
    advancesToSlotId: null,
    loserToSlotId: null,
  });
  // Pre-create reset slots (filled only if LB wins GF1)
  const resetA = emptySlot({
    id: idFactory(),
    round: 0,
    position: 0,
    side: "final_reset",
    participantId: null,
    isBye: false,
    advancesToSlotId: null,
    loserToSlotId: null,
  });
  const resetB = emptySlot({
    id: idFactory(),
    round: 0,
    position: 1,
    side: "final_reset",
    participantId: null,
    isBye: false,
    advancesToSlotId: null,
    loserToSlotId: null,
  });

  // WB final winners → GF A
  for (const s of mainSlots.filter((x) => x.round === wbDepth - 1)) {
    s.advancesToSlotId = finalA.id;
  }
  // LB final winners → GF B
  const lastLb = losersByRound[lbRoundCount - 1] ?? [];
  for (const s of lastLb) {
    s.advancesToSlotId = finalB.id;
  }

  return {
    slots: [
      ...mainSlots,
      ...losersByRound.flat(),
      finalA,
      finalB,
      resetA,
      resetB,
    ],
    size,
    format: "double_elimination",
    thirdPlaceSlotId: null,
    championParticipantId: null,
  };
}

/** Pairs of sibling slots that share the same advancesTo (or third/final pair). */
export function listMatchPairs(bracket: Bracket): MatchPair[] {
  const pairs: MatchPair[] = [];
  const byKey = new Map<string, BracketSlot[]>();

  for (const slot of bracket.slots) {
    if (
      slot.side === "third_place" ||
      slot.side === "final" ||
      slot.side === "final_reset"
    ) {
      const key = `${slot.side}:${slot.round}`;
      const list = byKey.get(key) ?? [];
      list.push(slot);
      byKey.set(key, list);
      continue;
    }
    if (!slot.advancesToSlotId) continue;
    const key = `adv:${slot.advancesToSlotId}`;
    const list = byKey.get(key) ?? [];
    list.push(slot);
    byKey.set(key, list);
  }

  for (const [, group] of byKey) {
    const sorted = [...group].sort((a, b) => a.position - b.position);
    for (let i = 0; i + 1 < sorted.length; i += 2) {
      const a = sorted[i]!;
      const b = sorted[i + 1]!;
      pairs.push({
        slotA: a,
        slotB: b,
        targetSlotId: a.advancesToSlotId,
        side: a.side,
        round: a.round,
      });
    }
  }
  return pairs;
}

export function pairNeedsMatch(pair: MatchPair): boolean {
  if (pair.slotA.matchId || pair.slotB.matchId) return false;
  if (pair.slotA.isBye || pair.slotB.isBye) return false;
  return Boolean(pair.slotA.participantId && pair.slotB.participantId);
}

export function applyMatchResult(
  bracket: Bracket,
  slotIds: [string, string],
  winnerParticipantId: string,
  loserParticipantId: string,
  matchId: string,
): Bracket {
  const slots = bracket.slots.map((s) => ({ ...s }));
  const byId = new Map(slots.map((s) => [s.id, s]));

  for (const id of slotIds) {
    const slot = byId.get(id);
    if (!slot) continue;
    slot.matchId = matchId;
    slot.winnerParticipantId = winnerParticipantId;
  }

  const slotA = byId.get(slotIds[0]);
  const advanceId = slotA?.advancesToSlotId;
  if (advanceId) {
    const target = byId.get(advanceId);
    if (target && !target.participantId) {
      target.participantId = winnerParticipantId;
    }
  }

  const loserDest =
    slotA?.loserToSlotId ?? byId.get(slotIds[1])?.loserToSlotId;
  if (loserDest) {
    const dest = byId.get(loserDest);
    if (dest && !dest.participantId) {
      dest.participantId = loserParticipantId;
    }
  }

  // Also set loser destination from the losing slot's loserToSlotId
  for (const id of slotIds) {
    const slot = byId.get(id);
    if (!slot || slot.participantId === winnerParticipantId) continue;
    if (slot.loserToSlotId) {
      const dest = byId.get(slot.loserToSlotId);
      if (dest && !dest.participantId) {
        dest.participantId = loserParticipantId;
      }
    }
  }

  let championParticipantId = bracket.championParticipantId;
  if (bracket.format === "single_elimination") {
    const maxRound = Math.log2(bracket.size);
    const finalSlot = slots.find(
      (s) => s.side === "main" && s.round === maxRound,
    );
    const feeders = slots.filter((s) => s.advancesToSlotId === finalSlot?.id);
    if (
      finalSlot &&
      feeders.some((s) => slotIds.includes(s.id)) &&
      feeders.every((s) => s.winnerParticipantId || s.matchId)
    ) {
      championParticipantId = winnerParticipantId;
      finalSlot.participantId = winnerParticipantId;
      finalSlot.winnerParticipantId = winnerParticipantId;
      finalSlot.matchId = matchId;
    }
  }

  // DE champion / Challonge GF reset
  if (bracket.format === "double_elimination") {
    const playedReset = slotIds.some(
      (id) => byId.get(id)?.side === "final_reset",
    );
    const playedFinal = slotIds.some((id) => byId.get(id)?.side === "final");
    if (playedReset) {
      championParticipantId = winnerParticipantId;
    } else if (playedFinal) {
      const gf = slots.filter((s) => s.side === "final");
      const wbChampSlot = gf.find((s) => s.position === 0);
      const lbChampSlot = gf.find((s) => s.position === 1);
      if (winnerParticipantId === wbChampSlot?.participantId) {
        // WB undefeated wins GF1 → tournament over
        championParticipantId = winnerParticipantId;
      } else {
        // LB champ won GF1 → bracket reset
        const reset = slots.filter((s) => s.side === "final_reset");
        const rA = reset.find((s) => s.position === 0);
        const rB = reset.find((s) => s.position === 1);
        if (rA && rB) {
          rA.participantId =
            wbChampSlot?.participantId ?? winnerParticipantId;
          rB.participantId =
            lbChampSlot?.participantId ?? loserParticipantId;
          // Ensure both finalists are present (swap if needed)
          if (
            rA.participantId &&
            rB.participantId &&
            rA.participantId === rB.participantId
          ) {
            rA.participantId = wbChampSlot?.participantId ?? null;
            rB.participantId = lbChampSlot?.participantId ?? null;
          }
        }
      }
    }
  }

  return {
    ...bracket,
    slots,
    championParticipantId,
  };
}

export function isTournamentComplete(bracket: Bracket): boolean {
  return Boolean(bracket.championParticipantId);
}

export function attachMatchId(
  bracket: Bracket,
  slotIds: [string, string],
  matchId: string,
): Bracket {
  return {
    ...bracket,
    slots: bracket.slots.map((s) =>
      slotIds.includes(s.id) ? { ...s, matchId } : s,
    ),
  };
}
