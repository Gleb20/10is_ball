import {
  listMatchPairs,
  type Bracket,
  type MatchPair,
} from "@tab10/shared";

export type BracketMatchLike = {
  id: string;
  status?: string;
  scoreA?: number | null;
  scoreB?: number | null;
  title?: string;
};

export type BracketCardSide = {
  participantId: string | null;
  displayName: string;
  avatarKey?: string | null;
  seed?: number | null;
  isBye: boolean;
  isWinner: boolean;
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

  const matchesInRound = bracketSize / 2 ** (round + 1);
  if (matchesInRound <= 1) return "Финал";
  if (matchesInRound === 2) return "1/2";
  if (matchesInRound === 4) return "1/4";
  if (matchesInRound === 8) return "1/8";
  if (matchesInRound === 16) return "1/16";
  return `Раунд ${round + 1}`;
}

function cardFromPair(
  pair: MatchPair,
  names: Map<string, string>,
  avatars: Map<string, string | null>,
  seeds: Map<string, number | null>,
  matchesById: Map<string, BracketMatchLike>,
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

  return {
    key: `${pair.side}-${pair.round}-${pair.slotA.id}-${pair.slotB.id}`,
    side: pair.side,
    round: pair.round,
    matchId,
    status,
    scoreLabel,
    slotA: {
      participantId: pair.slotA.participantId,
      displayName: pair.slotA.isBye
        ? "—"
        : nameFor(pair.slotA.participantId, names),
      avatarKey: pair.slotA.isBye
        ? null
        : avatarFor(pair.slotA.participantId, avatars),
      seed: seedFor(pair.slotA.participantId, seeds),
      isBye: pair.slotA.isBye,
      isWinner: Boolean(
        winnerId && pair.slotA.participantId === winnerId,
      ),
    },
    slotB: {
      participantId: pair.slotB.participantId,
      displayName: pair.slotB.isBye
        ? "—"
        : nameFor(pair.slotB.participantId, names),
      avatarKey: pair.slotB.isBye
        ? null
        : avatarFor(pair.slotB.participantId, avatars),
      seed: seedFor(pair.slotB.participantId, seeds),
      isBye: pair.slotB.isBye,
      isWinner: Boolean(
        winnerId && pair.slotB.participantId === winnerId,
      ),
    },
    cta,
    autoAdvanceName,
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
  return rounds.map((round) => ({
    key: `${side}:${round}`,
    label: challongeRoundLabel(bracketSize, round, side),
    side: side as MatchPair["side"],
    round,
    cards: cards.filter((c) => c.side === side && c.round === round),
  }));
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
  const pairs = listMatchPairs(bracket);
  const cards = pairs.map((p) =>
    cardFromPair(p, nameMap, avatarMap, seedMap, matchesById),
  );

  const bands: BracketBand[] = [];

  const mainCols = columnsForSide("main", cards, bracket.size);
  if (mainCols.length) {
    bands.push({
      id: "winners",
      title: "Победители",
      columns: mainCols,
    });
  }

  const loserCols = columnsForSide("losers", cards, bracket.size);
  if (loserCols.length) {
    bands.push({
      id: "losers",
      title: "Проигравшие",
      columns: loserCols,
    });
  }

  const gfCols = [
    ...columnsForSide("final", cards, bracket.size),
    ...columnsForSide("final_reset", cards, bracket.size),
  ];
  if (gfCols.length) {
    bands.push({
      id: "grand_final",
      title: "Гранд-финал",
      columns: gfCols,
    });
  }

  const thirdCols = columnsForSide("third_place", cards, bracket.size);
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
