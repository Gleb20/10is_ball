import { describe, expect, it } from "vitest";
import { defaultMatchTitle } from "./MatchCreatePage";
import { defaultTournamentTitle } from "./TournamentsPage";

describe("BUG-016 Europe/Moscow event default titles", () => {
  const instant = new Date("2026-01-15T21:05:00.000Z");

  it.each([
    ["match", defaultMatchTitle, "Матч 16.01, 00:05"],
    ["tournament", defaultTournamentTitle, "Турнир 16.01.2026, 00:05:00"],
  ])("formats the %s title in Moscow", (_kind, format, expected) => {
    expect(format(instant)).toBe(expected);
  });
});
