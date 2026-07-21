/**
 * Ranking by wins — RANK-* / AT-RANK-*.
 */

export type RankingEntry = {
  userId: string;
  wins: number;
  losses: number;
  matchesPlayed: number;
  winRate: number;
  displayName: string;
  status: "active" | "blocked";
  /** Account creation time (ms) for RANK-001 tie-break. */
  createdAt: number;
  avatarKey?: string | null;
};

export type RankingScope = "all_time" | "week" | "month";

/** Monday 00:00 UTC of the calendar week containing `now`. */
export function calendarWeekStartUTC(now: Date): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const mondayOffset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  return d;
}

/** First day 00:00 UTC of the calendar month containing `now`. */
export function calendarMonthStartUTC(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function winRate(wins: number, matchesPlayed: number): number {
  if (matchesPlayed <= 0) return 0;
  return wins / matchesPlayed;
}

export function toRankingEntry(input: {
  userId: string;
  wins: number;
  losses: number;
  displayName: string;
  status: "active" | "blocked";
  createdAt: Date | number;
  avatarKey?: string | null;
}): RankingEntry {
  const matchesPlayed = input.wins + input.losses;
  return {
    userId: input.userId,
    wins: input.wins,
    losses: input.losses,
    matchesPlayed,
    winRate: winRate(input.wins, matchesPlayed),
    displayName: input.displayName,
    status: input.status,
    createdAt:
      typeof input.createdAt === "number"
        ? input.createdAt
        : input.createdAt.getTime(),
    avatarKey: input.avatarKey ?? null,
  };
}

/**
 * RANK-001: wins DESC → win_rate DESC → matches_played DESC → created_at DESC.
 */
export function compareRankingEntries(a: RankingEntry, b: RankingEntry): number {
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (b.winRate !== a.winRate) return b.winRate - a.winRate;
  if (b.matchesPlayed !== a.matchesPlayed) return b.matchesPlayed - a.matchesPlayed;
  if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
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
export function teamAggregateWins(memberWins: number[]): number {
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
