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

const MOSCOW_TIME_ZONE = "Europe/Moscow";
const moscowDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MOSCOW_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const moscowDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MOSCOW_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function numericParts(formatter: Intl.DateTimeFormat, instant: Date) {
  const values = new Map(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.get("year")!,
    month: values.get("month")!,
    day: values.get("day")!,
    hour: values.get("hour") ?? 0,
    minute: values.get("minute") ?? 0,
    second: values.get("second") ?? 0,
  };
}

/** Convert a Moscow calendar date at local 00:00 to its absolute UTC instant. */
function moscowMidnight(year: number, month: number, day: number): Date {
  const utcNoon = new Date(Date.UTC(year, month - 1, day, 12));
  const localNoon = numericParts(moscowDateTimeFormatter, utcNoon);
  const offsetMs =
    Date.UTC(
      localNoon.year,
      localNoon.month - 1,
      localNoon.day,
      localNoon.hour,
      localNoon.minute,
      localNoon.second,
    ) - utcNoon.getTime();
  return new Date(Date.UTC(year, month - 1, day) - offsetMs);
}

/** Monday 00:00 Europe/Moscow of the calendar week containing `now`. */
export function calendarWeekStartMoscow(now: Date): Date {
  const local = numericParts(moscowDateFormatter, now);
  const localDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const mondayOffset = (localDate.getUTCDay() + 6) % 7;
  localDate.setUTCDate(localDate.getUTCDate() - mondayOffset);
  return moscowMidnight(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth() + 1,
    localDate.getUTCDate(),
  );
}

/** First day 00:00 Europe/Moscow of the calendar month containing `now`. */
export function calendarMonthStartMoscow(now: Date): Date {
  const local = numericParts(moscowDateFormatter, now);
  return moscowMidnight(local.year, local.month, 1);
}

/** @deprecated Use the explicitly named Europe/Moscow boundary helper. */
export const calendarWeekStartUTC = calendarWeekStartMoscow;

/** @deprecated Use the explicitly named Europe/Moscow boundary helper. */
export const calendarMonthStartUTC = calendarMonthStartMoscow;

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
