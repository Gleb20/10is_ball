import { describe, expect, it } from "vitest";
import {
  buildRanking,
  calendarMonthStartMoscow,
  calendarWeekStartMoscow,
  compareRankingEntries,
  pickRival,
  teamAggregateWins,
  toRankingEntry,
} from "./ranking.js";
import { isInvitationExpired, selectNewCaptain } from "./team-rules.js";

describe("REQ_RANK__comparator", () => {
  it("RANK-001: wins → win_rate → matches_played → created_at", () => {
    const a = toRankingEntry({
      userId: "1",
      wins: 5,
      losses: 5,
      displayName: "Аня",
      status: "active",
      createdAt: 100,
    });
    const b = toRankingEntry({
      userId: "2",
      wins: 5,
      losses: 3,
      displayName: "Боб",
      status: "active",
      createdAt: 200,
    });
    const c = toRankingEntry({
      userId: "3",
      wins: 10,
      losses: 0,
      displayName: "Вик",
      status: "active",
      createdAt: 50,
    });
    const ranking = buildRanking([a, b, c]);
    expect(ranking.map((r) => r.userId)).toEqual(["3", "2", "1"]);
  });

  it("excludes blocked users", () => {
    const ranking = buildRanking([
      toRankingEntry({
        userId: "1",
        wins: 1,
        losses: 0,
        displayName: "А",
        status: "blocked",
        createdAt: 1,
      }),
      toRankingEntry({
        userId: "2",
        wins: 1,
        losses: 0,
        displayName: "Б",
        status: "active",
        createdAt: 2,
      }),
    ]);
    expect(ranking.map((r) => r.userId)).toEqual(["2"]);
  });

  it.each([
    ["mid-week", "2026-07-15T12:00:00Z", "2026-07-12T21:00:00.000Z"],
    [
      "after Moscow Monday but still Sunday UTC",
      "2026-07-12T22:30:00Z",
      "2026-07-12T21:00:00.000Z",
    ],
    [
      "before Moscow Monday",
      "2026-07-12T20:59:59Z",
      "2026-07-05T21:00:00.000Z",
    ],
  ])("AT-RANK-002 week: %s", (_name, now, expected) => {
    expect(calendarWeekStartMoscow(new Date(now)).toISOString()).toBe(expected);
  });

  it.each([
    ["mid-month", "2026-07-15T12:00:00Z", "2026-06-30T21:00:00.000Z"],
    [
      "after Moscow month start but still previous UTC day",
      "2026-06-30T22:00:00Z",
      "2026-06-30T21:00:00.000Z",
    ],
    [
      "before Moscow month start",
      "2026-06-30T20:59:59Z",
      "2026-05-31T21:00:00.000Z",
    ],
  ])("AT-RANK-002 month: %s", (_name, now, expected) => {
    expect(calendarMonthStartMoscow(new Date(now)).toISOString()).toBe(expected);
  });

  it("compareRankingEntries matches buildRanking order", () => {
    const older = toRankingEntry({
      userId: "old",
      wins: 3,
      losses: 1,
      displayName: "Old",
      status: "active",
      createdAt: 1,
    });
    const newer = toRankingEntry({
      userId: "new",
      wins: 3,
      losses: 1,
      displayName: "New",
      status: "active",
      createdAt: 2,
    });
    expect(compareRankingEntries(older, newer)).toBeGreaterThan(0);
  });

  it("team ranking sums member wins", () => {
    expect(teamAggregateWins([3, 2, 1])).toBe(6);
  });

  it("rival needs at least 3 matches", () => {
    expect(
      pickRival([{ userId: "x", matchCount: 2, lastPlayedAt: 1 }]),
    ).toBeNull();
    expect(
      pickRival([
        { userId: "a", matchCount: 4, lastPlayedAt: 1 },
        { userId: "b", matchCount: 5, lastPlayedAt: 0 },
      ]),
    ).toBe("b");
  });
});

describe("REQ_TEAM__captain_and_invitation", () => {
  it("picks earliest active member as new captain", () => {
    expect(
      selectNewCaptain(
        [
          { userId: "c", joinedAt: 100, status: "active" },
          { userId: "a", joinedAt: 50, status: "active" },
          { userId: "b", joinedAt: 10, status: "blocked" },
        ],
        "c",
      ),
    ).toBe("a");
  });

  it("invitation expires after 14 days", () => {
    const created = Date.parse("2026-01-01T00:00:00Z");
    expect(isInvitationExpired(created, created + 13 * 86400000)).toBe(false);
    expect(isInvitationExpired(created, created + 14 * 86400000)).toBe(true);
  });
});
