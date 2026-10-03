import {
  buildDestinationIndex,
  deriveBracketMatchState,
  getMatchSides,
  listMatchPairs,
  type Bracket,
  type BracketGraphV2,
  type BracketMatchNode,
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

export type BracketEdge = {
  key: string;
  sourceCardKey: string;
  sourceBandId: BracketBand["id"];
  outcome: "winner" | "loser";
  destinationCardKey: string;
  destinationBandId: BracketBand["id"];
  destinationSide: "a" | "b";
  /** Known only after the source match resolves (or auto-advances). */
  resolvedSourceSide: "a" | "b" | null;
};

export type BracketViewModel = {
  bands: BracketBand[];
  /** Canonical potential paths, including cross-band paths, while both cards exist. */
  edges: BracketEdge[];
  /** Materialized, dependency-ready match cards in initial-focus order. */
  readyMatchCardKeys: string[];
  /** Pure recommendation for W2; applying focus or scroll remains a renderer concern. */
  workingMatchCardKey: string | null;
  championName: string | null;
  championAvatarKey: string | null;
  constructionAlgorithm?: "compact" | "power_of_two" | "legacy";
};

type CardLocation = {
  card: BracketCard;
  bandId: BracketBand["id"];
};

function cardLocations(bands: BracketBand[]): CardLocation[] {
  return bands.flatMap((band) =>
    band.columns.flatMap((column) =>
      column.cards.map((card) => ({ card, bandId: band.id })),
    ),
  );
}

function resolvedSourceSide(
  card: BracketCard,
  outcome: BracketEdge["outcome"],
): BracketEdge["resolvedSourceSide"] {
  if (!card.winnerSide) return null;
  if (outcome === "winner") return card.winnerSide;
  return card.winnerSide === "a" ? "b" : "a";
}

function dependencyDepths(
  cards: CardLocation[],
  edges: BracketEdge[],
): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const sources = incoming.get(edge.destinationCardKey) ?? [];
    if (!sources.includes(edge.sourceCardKey)) sources.push(edge.sourceCardKey);
    incoming.set(edge.destinationCardKey, sources);
  }
  const cardKeys = new Set(cards.map(({ card }) => card.key));
  const memo = new Map<string, number>();
  const visit = (key: string, visiting: Set<string>): number => {
    const cached = memo.get(key);
    if (cached != null) return cached;
    if (visiting.has(key)) return 0;
    const nextVisiting = new Set(visiting).add(key);
    const parents = (incoming.get(key) ?? []).filter((parent) => cardKeys.has(parent));
    const depth = parents.length === 0
      ? 0
      : Math.max(...parents.map((parent) => visit(parent, nextVisiting) + 1));
    memo.set(key, depth);
    return depth;
  };
  for (const key of cardKeys) visit(key, new Set());
  return memo;
}

function selectReadyMatchCardKeys(
  bands: BracketBand[],
  edges: BracketEdge[],
  allowedKeys?: ReadonlySet<string>,
): string[] {
  const cards = cardLocations(bands);
  const depths = dependencyDepths(cards, edges);
  const workingStatuses = new Set([
    "waiting",
    "in_progress",
    "pending_confirmation",
  ]);
  return cards
    .map(({ card }) => card)
    .filter(
      (card) =>
        card.cta === "judge" &&
        card.matchId != null &&
        card.status != null &&
        workingStatuses.has(card.status) &&
        (!allowedKeys || allowedKeys.has(card.key)),
    )
    .sort(
      (a, b) =>
        (depths.get(a.key) ?? 0) - (depths.get(b.key) ?? 0) ||
        a.pairIndex - b.pairIndex ||
        a.key.localeCompare(b.key),
    )
    .map((card) => card.key);
}

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

function buildV1Edges(bracket: Bracket, bands: BracketBand[]): BracketEdge[] {
  const locations = cardLocations(bands);
  const locationBySlotId = new Map<
    string,
    { location: CardLocation; side: "a" | "b" }
  >();
  for (const location of locations) {
    locationBySlotId.set(location.card.slotA.slotId, { location, side: "a" });
    locationBySlotId.set(location.card.slotB.slotId, { location, side: "b" });
  }
  const slotsById = new Map(bracket.slots.map((slot) => [slot.id, slot]));
  const edges: BracketEdge[] = [];
  for (const sourceLocation of locations) {
    const slotA = slotsById.get(sourceLocation.card.slotA.slotId);
    const slotB = slotsById.get(sourceLocation.card.slotB.slotId);
    if (!slotA || !slotB) continue;
    const competitive = !slotA.isBye && !slotB.isBye;
    for (const [outcome, destinationIds] of [
      ["winner", [slotA.advancesToSlotId, slotB.advancesToSlotId]],
      ["loser", [slotA.loserToSlotId, slotB.loserToSlotId]],
    ] as const) {
      if (outcome === "loser" && !competitive) continue;
      const uniqueDestinationIds = new Set(
        destinationIds.filter((id): id is string => id != null),
      );
      for (const destinationId of uniqueDestinationIds) {
        const destination = locationBySlotId.get(destinationId);
        if (!destination) continue;
        edges.push({
          key: `${sourceLocation.card.key}:${outcome}->${destination.location.card.key}:${destination.side}`,
          sourceCardKey: sourceLocation.card.key,
          sourceBandId: sourceLocation.bandId,
          outcome,
          destinationCardKey: destination.location.card.key,
          destinationBandId: destination.location.bandId,
          destinationSide: destination.side,
          resolvedSourceSide: resolvedSourceSide(sourceLocation.card, outcome),
        });
      }
    }
  }
  return edges;
}

/** Resolve «A vs B» from tournamentSlotId + bracket participant names. */
export function liveMatchVersusLabel(
  match: {
    tournamentSlotId?: string | null;
    tournamentBracketMatchId?: string | null;
    title?: string;
  },
  bracket: Bracket | BracketGraphV2 | null | undefined,
  names: Map<string, string>,
): string {
  if (bracket && "schemaVersion" in bracket && bracket.schemaVersion === 2) {
    const nodeId =
      match.tournamentBracketMatchId ?? match.tournamentSlotId ?? null;
    if (nodeId) {
      const node = bracket.matches.find((m) => m.id === nodeId);
      if (node) {
        const sides = getMatchSides(bracket, node);
        const nameA =
          sides.a.kind === "resolved"
            ? nameFor(sides.a.participantId, names)
            : sides.a.kind === "structurally_empty"
              ? "BYE"
              : "—";
        const nameB =
          sides.b.kind === "resolved"
            ? nameFor(sides.b.participantId, names)
            : sides.b.kind === "structurally_empty"
              ? "BYE"
              : "—";
        if (nameA !== "—" || nameB !== "—") {
          return `${nameA} vs ${nameB}`;
        }
      }
    }
    return match.title?.trim() || "Матч";
  }

  const slotIds = String(match.tournamentSlotId ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const v1 = bracket as Bracket | null | undefined;
  if (v1?.slots && slotIds.length >= 2) {
    const a = v1.slots.find((s) => s.id === slotIds[0]);
    const b = v1.slots.find((s) => s.id === slotIds[1]);
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
  const edges = buildV1Edges(bracket, bands);
  const readyMatchCardKeys = selectReadyMatchCardKeys(bands, edges);
  return {
    bands,
    edges,
    readyMatchCardKeys,
    workingMatchCardKey: readyMatchCardKeys[0] ?? null,
    championName: championId ? nameFor(championId, nameMap) : null,
    championAvatarKey: championId
      ? avatarFor(championId, avatarMap)
      : null,
  };
}

function stageToPairSide(
  stage: BracketMatchNode["stage"],
): MatchPair["side"] {
  switch (stage) {
    case "winners":
      return "main";
    case "losers":
      return "losers";
    case "grand_final":
      return "final";
    case "grand_final_reset":
      return "final_reset";
    case "third_place":
      return "third_place";
    default:
      return "main";
  }
}

function resolveV2Fate(
  nodeId: string,
  isWinner: boolean,
  decided: boolean,
  dest: ReturnType<typeof buildDestinationIndex>,
): PlayerFate {
  if (!decided) return null;
  if (isWinner) {
    return dest.winners.has(nodeId) ? "advance" : null;
  }
  return dest.losers.has(nodeId) ? "drop" : "eliminated";
}

function cardFromV2Node(
  node: BracketMatchNode,
  graph: BracketGraphV2,
  names: Map<string, string>,
  avatars: Map<string, string | null>,
  seeds: Map<string, number | null>,
  matchesById: Map<string, BracketMatchLike>,
  dest: ReturnType<typeof buildDestinationIndex>,
): BracketCard | null {
  const state = deriveBracketMatchState(graph, node.id);
  if (
    state === "inactive" ||
    state === "structurally_empty" ||
    state === "cancelled"
  ) {
    return null;
  }

  const sides = getMatchSides(graph, node);
  const matchId = node.actualMatchId;
  const match = matchId ? matchesById.get(matchId) : undefined;
  const status = match?.status ?? null;
  const scoreLabel =
    match &&
    (status === "finished" ||
      status === "stopped" ||
      status === "in_progress" ||
      status === "pending_confirmation")
      ? `${match.scoreA ?? 0}:${match.scoreB ?? 0}`
      : null;

  const aEmpty = sides.a.kind === "structurally_empty";
  const bEmpty = sides.b.kind === "structurally_empty";
  const aId = sides.a.kind === "resolved" ? sides.a.participantId : null;
  const bId = sides.b.kind === "resolved" ? sides.b.participantId : null;

  let cta: BracketCard["cta"] = "pending";
  let autoAdvanceName: string | null = null;
  if (state === "auto_advance_eligible" || (aEmpty !== bEmpty && !matchId)) {
    cta = "bye";
    const named = aEmpty ? bId : aId;
    autoAdvanceName = named ? nameFor(named, names) : null;
  } else if (matchId && (status === "finished" || status === "stopped")) {
    cta = "open";
  } else if (matchId) {
    cta = "judge";
  } else if (state === "ready") {
    cta = "pending";
  }

  const winnerId = node.winnerParticipantId;
  const decided =
    Boolean(winnerId) || cta === "bye" || cta === "open" || state === "completed";
  const aWinner = Boolean(winnerId && aId === winnerId);
  const bWinner = Boolean(winnerId && bId === winnerId);
  const aAdvanceBye = cta === "bye" && !aEmpty && Boolean(aId);
  const bAdvanceBye = cta === "bye" && !bEmpty && Boolean(bId);
  const slotAIsWinner = aWinner || aAdvanceBye;
  const slotBIsWinner = bWinner || bAdvanceBye;

  let winnerSide: BracketCard["winnerSide"] = null;
  if (slotAIsWinner) winnerSide = "a";
  else if (slotBIsWinner) winnerSide = "b";

  const pairSide = stageToPairSide(node.stage);
  const winnerDest = dest.winners.get(node.id);

  return {
    key: node.id,
    side: pairSide,
    round: node.roundIndex,
    matchId,
    status,
    scoreLabel,
    slotA: {
      slotId: `${node.id}:a`,
      participantId: aId,
      displayName: aEmpty ? "—" : nameFor(aId, names),
      avatarKey: aEmpty ? null : avatarFor(aId, avatars),
      seed: seedFor(aId, seeds),
      isBye: aEmpty,
      isWinner: slotAIsWinner,
      fate: resolveV2Fate(node.id, slotAIsWinner, decided, dest),
    },
    slotB: {
      slotId: `${node.id}:b`,
      participantId: bId,
      displayName: bEmpty ? "—" : nameFor(bId, names),
      avatarKey: bEmpty ? null : avatarFor(bId, avatars),
      seed: seedFor(bId, seeds),
      isBye: bEmpty,
      isWinner: slotBIsWinner,
      fate: resolveV2Fate(node.id, slotBIsWinner, decided, dest),
    },
    cta,
    autoAdvanceName,
    pairIndex: node.orderInRound,
    pairsInRound: 1,
    decided,
    feedsToCardKey: winnerDest?.bracketMatchId ?? null,
    winnerSide,
  };
}

function wireV2FeedsInBand(columns: BracketRoundColumn[]): BracketRoundColumn[] {
  const keys = new Set(
    columns.flatMap((c) => c.cards.map((card) => card.key)),
  );
  return columns.map((col) => ({
    ...col,
    cards: col.cards.map((card) => {
      const inBand = Boolean(
        card.feedsToCardKey && keys.has(card.feedsToCardKey),
      );
      return {
        ...card,
        feedsToCardKey: inBand ? card.feedsToCardKey : null,
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

function buildV2Edges(
  graph: BracketGraphV2,
  bands: BracketBand[],
  destinations: ReturnType<typeof buildDestinationIndex>,
): BracketEdge[] {
  const locations = cardLocations(bands);
  const locationByCardKey = new Map(
    locations.map((location) => [location.card.key, location]),
  );
  const edges: BracketEdge[] = [];
  for (const node of graph.matches) {
    const source = locationByCardKey.get(node.id);
    if (!source) continue;
    const sides = getMatchSides(graph, node);
    const competitive =
      sides.a.kind !== "structurally_empty" &&
      sides.b.kind !== "structurally_empty";
    for (const [outcome, destination] of [
      ["winner", destinations.winners.get(node.id)],
      ["loser", destinations.losers.get(node.id)],
    ] as const) {
      if (!destination || (outcome === "loser" && !competitive)) continue;
      const target = locationByCardKey.get(destination.bracketMatchId);
      if (!target) continue;
      const destinationSide = destination.position === "A" ? "a" : "b";
      edges.push({
        key: `${node.id}:${outcome}->${target.card.key}:${destinationSide}`,
        sourceCardKey: node.id,
        sourceBandId: source.bandId,
        outcome,
        destinationCardKey: target.card.key,
        destinationBandId: target.bandId,
        destinationSide,
        resolvedSourceSide: resolvedSourceSide(source.card, outcome),
      });
    }
  }
  return edges;
}

/** Match-centric V2 view-model (Challonge-inspired topology). */
export function buildBracketViewModelV2(
  graph: BracketGraphV2,
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
  const dest = buildDestinationIndex(graph);

  const cards = graph.matches
    .map((n) =>
      cardFromV2Node(
        n,
        graph,
        nameMap,
        avatarMap,
        seedMap,
        matchesById,
        dest,
      ),
    )
    .filter((c): c is BracketCard => c != null);

  const bands: BracketBand[] = [];
  const size =
    graph.constructionAlgorithm === "power_of_two"
      ? graph.bracketSize
      : graph.participantCount;

  const mainCols = wireV2FeedsInBand(columnsForSide("main", cards, size));
  if (mainCols.length) {
    bands.push({ id: "winners", title: "Победители", columns: mainCols });
  }
  const loserCols = wireV2FeedsInBand(columnsForSide("losers", cards, size));
  if (loserCols.length) {
    bands.push({ id: "losers", title: "Проигравшие", columns: loserCols });
  }
  const gfCols = wireV2FeedsInBand([
    ...columnsForSide("final", cards, size),
    ...columnsForSide("final_reset", cards, size),
  ]);
  if (gfCols.length) {
    bands.push({ id: "grand_final", title: "Гранд-финал", columns: gfCols });
  }
  const thirdCols = wireV2FeedsInBand(
    columnsForSide("third_place", cards, size),
  );
  if (thirdCols.length) {
    bands.push({ id: "third", title: "За 3-е место", columns: thirdCols });
  }

  const championId = graph.championParticipantId ?? null;
  const edges = buildV2Edges(graph, bands, dest);
  const graphReadyKeys = new Set(
    graph.matches
      .filter((node) => deriveBracketMatchState(graph, node.id) === "ready")
      .map((node) => node.id),
  );
  const readyMatchCardKeys = selectReadyMatchCardKeys(
    bands,
    edges,
    graphReadyKeys,
  );
  return {
    bands,
    edges,
    readyMatchCardKeys,
    workingMatchCardKey: readyMatchCardKeys[0] ?? null,
    championName: championId ? nameFor(championId, nameMap) : null,
    championAvatarKey: championId
      ? avatarFor(championId, avatarMap)
      : null,
    constructionAlgorithm: graph.constructionAlgorithm,
  };
}
