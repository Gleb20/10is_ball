import { describe, expect, it } from "vitest";
import {
  buildRanking,
  calendarMonthStartUTC,
  calendarWeekStartUTC,
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

  it("calendar week starts on Monday UTC", () => {
    const wed = new Date("2026-07-15T12:00:00Z");
    const start = calendarWeekStartUTC(wed);
    expect(start.toISOString()).toBe("2026-07-13T00:00:00.000Z");
  });

  it("calendar month starts on first day UTC", () => {
    const mid = new Date("2026-07-15T12:00:00Z");
    expect(calendarMonthStartUTC(mid).toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    );
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
