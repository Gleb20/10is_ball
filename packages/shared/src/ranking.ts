/**
 * Ranking by wins — RANK-* / AT-RANK-*.
 */

export type RankingEntry = {
  userId: string;
  wins: number;
  losses: number;
  displayName: string;
  status: "active" | "blocked";
};

export type RankingPeriod = "all_time" | "week" | "month";

/**
 * Sort: more wins first; tie-break by fewer losses; then displayName localeCompare.
 * Blocked users excluded from active rankings.
 */
export function compareRankingEntries(a: RankingEntry, b: RankingEntry): number {
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (a.losses !== b.losses) return a.losses - b.losses;
  return a.displayName.localeCompare(b.displayName, "ru");
}

export function buildRanking(
  entries: RankingEntry[],
  options: { includeBlocked?: boolean } = {},
): RankingEntry[] {
  const filtered = options.includeBlocked
    ? entries
    : entries.filter((e) => e.status === "active");
  return [...filtered].sort(compareRankingEntries);
}

/**
 * Team ranking: sum of current members' all-time wins (decision Q2 default).
 */
export function teamAggregateWins(
  memberWins: number[],
): number {
  return memberWins.reduce((s, w) => s + w, 0);
}

/**
 * Rival heuristic: opponent with most matches together (min 3), then most recent.
 */
export function pickRival(
  opponents: { userId: string; matchCount: number; lastPlayedAt: number }[],
): string | null {
  const eligible = opponents.filter((o) => o.matchCount >= 3);
  if (eligible.length === 0) return null;
  eligible.sort(
    (a, b) =>
      b.matchCount - a.matchCount || b.lastPlayedAt - a.lastPlayedAt,
  );
  return eligible[0]!.userId;
}
