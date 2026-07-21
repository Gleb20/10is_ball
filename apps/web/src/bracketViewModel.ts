import {
  listMatchPairs,
  type Bracket,
  type BracketSlot,
  type MatchPair,
} from "@tab10/shared";

export type BracketMatchLike = {
  id: string;
  status?: string;
  scoreA?: number | null;
  scoreB?: number | null;
  title?: string;
};

/** Outcome badge / connector for a decided player row. */
export type PlayerFate =
  | "advance"
  | "drop"
  | "eliminated"
  | null;

export type BracketCardSide = {
  slotId: string;
  participantId: string | null;
  displayName: string;
  avatarKey?: string | null;
  seed?: number | null;
  isBye: boolean;
  isWinner: boolean;
  /** advance → curved connector; drop → ↓ to LB/3rd; eliminated → ✕ */
  fate: PlayerFate;
};

export type BracketCard = {
  key: string;
  side: MatchPair["side"];
  round: number;
  matchId: string | null;
  status: string | null;
  scoreLabel: string | null;
  slotA: BracketCardSide;
  slotB: BracketCardSide;
  cta: "judge" | "open" | "bye" | "pending";
  autoAdvanceName: string | null;
  pairIndex: number;
  pairsInRound: number;
  decided: boolean;
  /** Next-match card key within the same band (winner path target). */
  feedsToCardKey: string | null;
  /** Which side won (for SVG path start). */
  winnerSide: "a" | "b" | null;
};

export type BracketRoundColumn = {
  key: string;
  label: string;
  side: MatchPair["side"];
  round: number;
  cards: BracketCard[];
};

export type BracketBand = {
  id: "winners" | "losers" | "grand_final" | "third";
  title: string;
  columns: BracketRoundColumn[];
};

export type BracketViewModel = {
  bands: BracketBand[];
  championName: string | null;
  championAvatarKey: string | null;
};

function nameFor(
  participantId: string | null | undefined,
  names: Map<string, string>,
): string {
  if (!participantId) return "—";
  return names.get(participantId) ?? "Участник";
}

function avatarFor(
  participantId: string | null | undefined,
  avatars: Map<string, string | null>,
): string | null {
  if (!participantId) return null;
  return avatars.get(participantId) ?? null;
}

function seedFor(
  participantId: string | null | undefined,
  seeds: Map<string, number | null>,
): number | null {
  if (!participantId) return null;
  return seeds.get(participantId) ?? null;
}

/** Challonge-style round label for a main/winners column. */
export function challongeRoundLabel(
  bracketSize: number,
  round: number,
  side: string,
): string {
  if (side === "final") return "Гранд-финал";
  if (side === "final_reset") return "Гранд-финал (reset)";
  if (side === "third_place") return "За 3-е место";
  if (side === "losers") return `Losers · R${round + 1}`;

  // Compact SE: size may not be power-of-2 — prefer simple labels
  const pow2 = bracketSize > 0 && (bracketSize & (bracketSize - 1)) === 0;
  if (!pow2) {
    const matchesInRound = Math.max(1, Math.ceil(bracketSize / 2 ** (round + 1)));
    if (matchesInRound <= 1) return "Финал";
    return `Раунд ${round + 1}`;
  }

  const matchesInRound = bracketSize / 2 ** (round + 1);
  if (matchesInRound <= 1) return "Финал";
  if (matchesInRound === 2) return "1/2";
  if (matchesInRound === 4) return "1/4";
  if (matchesInRound === 8) return "1/8";
  if (matchesInRound === 16) return "1/16";
  return `Раунд ${round + 1}`;
}

/**
 * Decide fate for one side of a decided match.
 * - Winner with next slot → advance (connector)
 * - Loser with loserTo (LB / 3rd) → drop (↓)
 * - Loser with nowhere → eliminated (✕)
 */
export function resolvePlayerFate(
  slot: BracketSlot,
  isWinner: boolean,
  decided: boolean,
  slotsById: Map<string, BracketSlot>,
): PlayerFate {
  if (!decided || slot.isBye) return null;
  if (isWinner) {
    return slot.advancesToSlotId ? "advance" : null;
  }
  // Loser of a decided match
  const destId = slot.loserToSlotId;
  if (!destId) return "eliminated";
  const dest = slotsById.get(destId);
  if (!dest) return "eliminated";
  // Further match via loserTo = drop (LB or 3rd-place)
  return "drop";
}

function cardFromPair(
  pair: MatchPair,
  names: Map<string, string>,
  avatars: Map<string, string | null>,
  seeds: Map<string, number | null>,
  matchesById: Map<string, BracketMatchLike>,
  slotsById: Map<string, BracketSlot>,
): BracketCard {
  const matchId = pair.slotA.matchId ?? pair.slotB.matchId ?? null;
  const match = matchId ? matchesById.get(matchId) : undefined;
  const status = match?.status ?? null;
  const hasBye = pair.slotA.isBye || pair.slotB.isBye;
  const scoreLabel =
    match &&
    (status === "finished" ||
      status === "stopped" ||
      status === "in_progress" ||
      status === "pending_confirmation")
      ? `${match.scoreA ?? 0}:${match.scoreB ?? 0}`
      : null;

  const winnerId =
    pair.slotA.winnerParticipantId ??
    pair.slotB.winnerParticipantId ??
    null;

  let cta: BracketCard["cta"] = "pending";
  let autoAdvanceName: string | null = null;
  if (hasBye && !matchId) {
    cta = "bye";
    const named = pair.slotA.isBye
      ? pair.slotB.participantId
      : pair.slotA.participantId;
    autoAdvanceName = named ? nameFor(named, names) : null;
  } else if (matchId && (status === "finished" || status === "stopped"))
    cta = "open";
  else if (matchId) cta = "judge";

  const decided = Boolean(winnerId) || cta === "bye" || cta === "open";
  const aWinner = Boolean(
    winnerId && pair.slotA.participantId === winnerId,
  );
  const bWinner = Boolean(
    winnerId && pair.slotB.participantId === winnerId,
  );
  // Bye auto-advance: non-bye side is the "winner"
  const aAdvanceBye =
    cta === "bye" && !pair.slotA.isBye && Boolean(pair.slotA.participantId);
  const bAdvanceBye =
    cta === "bye" && !pair.slotB.isBye && Boolean(pair.slotB.participantId);

  const slotAIsWinner = aWinner || aAdvanceBye;
  const slotBIsWinner = bWinner || bAdvanceBye;

  let winnerSide: BracketCard["winnerSide"] = null;
  if (slotAIsWinner) winnerSide = "a";
  else if (slotBIsWinner) winnerSide = "b";

  return {
    key: `${pair.side}-${pair.round}-${pair.slotA.id}-${pair.slotB.id}`,
    side: pair.side,
    round: pair.round,
    matchId,
    status,
    scoreLabel,
    slotA: {
      slotId: pair.slotA.id,
      participantId: pair.slotA.participantId,
      displayName: pair.slotA.isBye
        ? "—"
        : nameFor(pair.slotA.participantId, names),
      avatarKey: pair.slotA.isBye
        ? null
        : avatarFor(pair.slotA.participantId, avatars),
      seed: seedFor(pair.slotA.participantId, seeds),
      isBye: pair.slotA.isBye,
      isWinner: slotAIsWinner,
      fate: resolvePlayerFate(
        pair.slotA,
        slotAIsWinner,
        decided,
        slotsById,
      ),
    },
    slotB: {
      slotId: pair.slotB.id,
      participantId: pair.slotB.participantId,
      displayName: pair.slotB.isBye
        ? "—"
        : nameFor(pair.slotB.participantId, names),
      avatarKey: pair.slotB.isBye
        ? null
        : avatarFor(pair.slotB.participantId, avatars),
      seed: seedFor(pair.slotB.participantId, seeds),
      isBye: pair.slotB.isBye,
      isWinner: slotBIsWinner,
      fate: resolvePlayerFate(
        pair.slotB,
        slotBIsWinner,
        decided,
        slotsById,
      ),
    },
    cta,
    autoAdvanceName,
    pairIndex: 0,
    pairsInRound: 1,
    decided,
    feedsToCardKey: null,
    winnerSide,
  };
}

function columnsForSide(
  side: MatchPair["side"] | "final" | "final_reset",
  cards: BracketCard[],
  bracketSize: number,
): BracketRoundColumn[] {
  const rounds = [
    ...new Set(cards.filter((c) => c.side === side).map((c) => c.round)),
  ].sort((a, b) => a - b);
  return rounds.map((round) => {
    const roundCards = cards
      .filter((c) => c.side === side && c.round === round)
      .map((c, i, arr) => ({
        ...c,
        pairIndex: i,
        pairsInRound: arr.length,
      }));
    return {
      key: `${side}:${round}`,
      label: challongeRoundLabel(bracketSize, round, side),
      side: side as MatchPair["side"],
      round,
      cards: roundCards,
    };
  });
}

function wireFeedsToCardKeys(
  columns: BracketRoundColumn[],
  slotsById: Map<string, BracketSlot>,
): BracketRoundColumn[] {
  const cardBySlotId = new Map<string, string>();
  for (const col of columns) {
    for (const card of col.cards) {
      cardBySlotId.set(card.slotA.slotId, card.key);
      cardBySlotId.set(card.slotB.slotId, card.key);
    }
  }

  return columns.map((col) => ({
    ...col,
    cards: col.cards.map((card) => {
      const winnerSlot =
        card.winnerSide === "a"
          ? slotsById.get(card.slotA.slotId)
          : card.winnerSide === "b"
            ? slotsById.get(card.slotB.slotId)
            : null;
      const advanceId = winnerSlot?.advancesToSlotId ?? null;
      const feedsToCardKey = advanceId
        ? (cardBySlotId.get(advanceId) ?? null)
        : null;
      // Only connect within this band's columns
      const inBand = feedsToCardKey
        ? columns.some((c) => c.cards.some((x) => x.key === feedsToCardKey))
        : false;
      return {
        ...card,
        feedsToCardKey: inBand ? feedsToCardKey : null,
        // Winner without in-band next: clear advance fate if champion/band end
        slotA:
          card.slotA.fate === "advance" &&
          card.winnerSide === "a" &&
          !inBand
            ? { ...card.slotA, fate: null }
            : card.slotA,
        slotB:
          card.slotB.fate === "advance" &&
          card.winnerSide === "b" &&
          !inBand
            ? { ...card.slotB, fate: null }
            : card.slotB,
      };
    }),
  }));
}

/** Resolve «A vs B» from tournamentSlotId + bracket participant names. */
export function liveMatchVersusLabel(
  match: {
    tournamentSlotId?: string | null;
    title?: string;
  },
  bracket: Bracket | null | undefined,
  names: Map<string, string>,
): string {
  const slotIds = String(match.tournamentSlotId ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (bracket && slotIds.length >= 2) {
    const a = bracket.slots.find((s) => s.id === slotIds[0]);
    const b = bracket.slots.find((s) => s.id === slotIds[1]);
    const nameA = a?.participantId
      ? nameFor(a.participantId, names)
      : a?.isBye
        ? "BYE"
        : "—";
    const nameB = b?.participantId
      ? nameFor(b.participantId, names)
      : b?.isBye
        ? "BYE"
        : "—";
    if (nameA !== "—" || nameB !== "—") {
      return `${nameA} vs ${nameB}`;
    }
  }
  return match.title?.trim() || "Матч";
}

/** Pure view-model for Challonge-lite CSS tournament bracket. */
export function buildBracketViewModel(
  bracket: Bracket,
  names: Map<string, string> | Record<string, string>,
  matches: BracketMatchLike[],
  opts?: {
    avatars?: Map<string, string | null> | Record<string, string | null>;
    seeds?: Map<string, number | null> | Record<string, number | null>;
  },
): BracketViewModel {
  const nameMap =
    names instanceof Map ? names : new Map(Object.entries(names));
  const avatarMap =
    opts?.avatars instanceof Map
      ? opts.avatars
      : new Map(Object.entries(opts?.avatars ?? {}));
  const seedMap =
    opts?.seeds instanceof Map
      ? opts.seeds
      : new Map(Object.entries(opts?.seeds ?? {}));
  const matchesById = new Map(matches.map((m) => [m.id, m]));
  const slotsById = new Map(bracket.slots.map((s) => [s.id, s]));
  const pairs = listMatchPairs(bracket);
  const cards = pairs.map((p) =>
    cardFromPair(p, nameMap, avatarMap, seedMap, matchesById, slotsById),
  );

  const bands: BracketBand[] = [];

  const mainCols = wireFeedsToCardKeys(
    columnsForSide("main", cards, bracket.size),
    slotsById,
  );
  if (mainCols.length) {
    bands.push({
      id: "winners",
      title: "Победители",
      columns: mainCols,
    });
  }

  const loserCols = wireFeedsToCardKeys(
    columnsForSide("losers", cards, bracket.size),
    slotsById,
  );
  if (loserCols.length) {
    bands.push({
      id: "losers",
      title: "Проигравшие",
      columns: loserCols,
    });
  }

  const gfCols = wireFeedsToCardKeys(
    [
      ...columnsForSide("final", cards, bracket.size),
      ...columnsForSide("final_reset", cards, bracket.size),
    ],
    slotsById,
  );
  if (gfCols.length) {
    bands.push({
      id: "grand_final",
      title: "Гранд-финал",
      columns: gfCols,
    });
  }

  const thirdCols = wireFeedsToCardKeys(
    columnsForSide("third_place", cards, bracket.size),
    slotsById,
  );
  if (thirdCols.length) {
    bands.push({
      id: "third",
      title: "За 3-е место",
      columns: thirdCols,
    });
  }

  const championId = bracket.championParticipantId ?? null;
  return {
    bands,
    championName: championId ? nameFor(championId, nameMap) : null,
    championAvatarKey: championId
      ? avatarFor(championId, avatarMap)
      : null,
  };
}
