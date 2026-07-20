import { describe, expect, it } from "vitest";
import { initialsFromName, splitPodium } from "./rankingUi";

describe("REQ_ui__rankings_podium", () => {
  it("splits top three for podium", () => {
    expect(splitPodium([1, 2, 3, 4, 5])).toEqual({
      podium: [1, 2, 3],
      rest: [4, 5],
    });
    expect(splitPodium([1, 2])).toEqual({ podium: [1, 2], rest: [] });
  });

  it("builds initials from display name", () => {
    expect(initialsFromName("Иванов Иван")).toBe("ИИ");
    expect(initialsFromName("Admin")).toBe("AD");
  });
});
