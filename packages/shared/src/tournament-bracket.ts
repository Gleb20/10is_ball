/**
 * Single / double elimination bracket helpers.
 * TOURNAMENT — Phase 6 domain.
 */

export type BracketSlot = {
  id: string;
  round: number;
  position: number;
  side: "main" | "losers" | "final";
  participantId: string | null;
  isBye: boolean;
  advancesToSlotId: string | null;
  loserToSlotId: string | null;
};

export type Bracket = {
  slots: BracketSlot[];
  size: number; // power of 2 >= participants
  format: "single_elimination" | "double_elimination";
};

function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Seed participants by wins (higher wins = better seed = lower seed number).
 * Returns ordered participant ids for bracket positions 0..n-1.
 */
export function seedParticipants(
  participants: { id: string; wins: number }[],
): string[] {
  return [...participants]
    .sort((a, b) => b.wins - a.wins || a.id.localeCompare(b.id))
    .map((p) => p.id);
}

/**
 * Classic single-elim pairing: seed 1 vs last, 2 vs last-1, etc. with byes.
 */
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

  // Round 0 (first round) positions
  const firstRound: BracketSlot[] = [];
  for (let i = 0; i < size; i += 1) {
    firstRound.push({
      id: idFactory(),
      round: 0,
      position: i,
      side: "main",
      participantId: null,
      isBye: false,
      advancesToSlotId: null,
      loserToSlotId: null,
    });
  }

  // Place seeds: standard bracket placement for power-of-2
  const placement = standardPlacement(size);
  for (let seed = 0; seed < seededIds.length; seed += 1) {
    const pos = placement[seed]!;
    firstRound[pos]!.participantId = seededIds[seed]!;
  }
  for (const slot of firstRound) {
    if (!slot.participantId) slot.isBye = true;
  }

  slots.push(...firstRound);

  // Build subsequent rounds
  let prevRound = firstRound;
  for (let r = 1; r <= rounds; r += 1) {
    const count = size / 2 ** r;
    const roundSlots: BracketSlot[] = [];
    for (let i = 0; i < count; i += 1) {
      roundSlots.push({
        id: idFactory(),
        round: r,
        position: i,
        side: "main",
        participantId: null,
        isBye: false,
        advancesToSlotId: null,
        loserToSlotId: null,
      });
    }
    for (let i = 0; i < prevRound.length; i += 2) {
      const a = prevRound[i]!;
      const b = prevRound[i + 1]!;
      const target = roundSlots[Math.floor(i / 2)]!;
      a.advancesToSlotId = target.id;
      b.advancesToSlotId = target.id;

      // Auto-advance bye
      if (a.isBye && !b.isBye && b.participantId) {
        target.participantId = b.participantId;
      } else if (b.isBye && !a.isBye && a.participantId) {
        target.participantId = a.participantId;
      } else if (a.isBye && b.isBye) {
        target.isBye = true;
      }
    }
    slots.push(...roundSlots);
    prevRound = roundSlots;
  }

  return { slots, size, format: "single_elimination" };
}

/** Returns bracket position (0-indexed) for each seed index. */
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

/**
 * Third-place match: losers of the two semi-final slots.
 * Decision Q1 default: always create for single elimination when size >= 4.
 */
export function thirdPlaceParticipantIds(
  bracket: Bracket,
): { semiLoserA: string | null; semiLoserB: string | null } | null {
  if (bracket.format !== "single_elimination" || bracket.size < 4) return null;
  const maxRound = Math.log2(bracket.size);
  const semis = bracket.slots.filter((s) => s.round === maxRound - 1);
  if (semis.length < 2) return null;
  // Placeholders — actual losers filled at runtime
  return { semiLoserA: null, semiLoserB: null };
}

/**
 * Double elimination: main bracket + losers bracket shell.
 * Simplified DE: loser of main round R goes to losers round R.
 */
export function generateDoubleEliminationBracket(
  seededIds: string[],
  idFactory: () => string,
): Bracket {
  const single = generateSingleEliminationBracket(seededIds, idFactory);
  // Add losers bracket slots mirroring first rounds
  const losers: BracketSlot[] = [];
  const firstMain = single.slots.filter((s) => s.round === 0 && s.side === "main");
  for (let i = 0; i < firstMain.length / 2; i += 1) {
    losers.push({
      id: idFactory(),
      round: 0,
      position: i,
      side: "losers",
      participantId: null,
      isBye: false,
      advancesToSlotId: null,
      loserToSlotId: null,
    });
  }
  // Wire losers destinations from first round pairs
  for (let i = 0; i < firstMain.length; i += 2) {
    const target = losers[Math.floor(i / 2)];
    if (target) {
      firstMain[i]!.loserToSlotId = target.id;
      firstMain[i + 1]!.loserToSlotId = target.id;
    }
  }

  const finalSlot: BracketSlot = {
    id: idFactory(),
    round: 0,
    position: 0,
    side: "final",
    participantId: null,
    isBye: false,
    advancesToSlotId: null,
    loserToSlotId: null,
  };

  return {
    slots: [...single.slots, ...losers, finalSlot],
    size: single.size,
    format: "double_elimination",
  };
}
