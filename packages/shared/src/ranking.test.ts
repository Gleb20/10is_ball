import { describe, expect, it } from "vitest";
import { buildRanking, pickRival, teamAggregateWins } from "./ranking.js";
import { isInvitationExpired, selectNewCaptain } from "./team-rules.js";

describe("REQ_RANK__comparator", () => {
  it("sorts by wins then losses then name; excludes blocked", () => {
    const ranking = buildRanking([
      {
        userId: "1",
        wins: 5,
        losses: 2,
        displayName: "Боб",
        status: "active",
      },
      {
        userId: "2",
        wins: 5,
        losses: 1,
        displayName: "Аня",
        status: "active",
      },
      {
        userId: "3",
        wins: 10,
        losses: 0,
        displayName: "Закрыт",
        status: "blocked",
      },
    ]);
    expect(ranking.map((r) => r.userId)).toEqual(["2", "1"]);
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
