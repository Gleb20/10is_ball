import { describe, expect, it } from "vitest";
import {
  participantDisplayName,
  servingSide,
  shouldShowLandscapeHint,
  sideDisplayName,
  formatMatchDuration,
  elapsedMs,
  judgeAcquireErrorMessage,
} from "./judgeUi";

describe("REQ_ui__judge_serve_indicator", () => {
  const match = {
    currentServerParticipantId: "p-b",
    participants: [
      {
        id: "p-a",
        side: "A" as const,
        guestFirstName: "Анна",
        guestLastName: "А",
      },
      {
        id: "p-b",
        side: "B" as const,
        guestFirstName: "Борис",
        guestLastName: "Б",
      },
    ],
  };

  it("resolves serving side from currentServerParticipantId", () => {
    expect(servingSide(match)).toBe("B");
    expect(servingSide({ ...match, currentServerParticipantId: "p-a" })).toBe(
      "A",
    );
    expect(servingSide({ ...match, currentServerParticipantId: null })).toBe(
      null,
    );
  });

  it("builds side labels from participants", () => {
    expect(sideDisplayName(match, "A")).toBe("Анна А");
    expect(sideDisplayName(match, "B")).toBe("Борис Б");
  });

  it("prefers API displayName for registered players", () => {
    expect(
      participantDisplayName({
        id: "p1",
        side: "A",
        userId: "u1",
        displayName: "Иванов Иван",
      }),
    ).toBe("Иванов Иван");
  });

  it("labels tutorial actor", () => {
    expect(
      participantDisplayName({
        id: "t",
        side: "B",
        isTutorialActor: true,
      }),
    ).toBe("Призрачный Олег");
  });
});

describe("REQ_ui__judge_landscape_hint", () => {
  it("shows hint only on narrow portrait", () => {
    expect(shouldShowLandscapeHint(390, 844)).toBe(true);
    expect(shouldShowLandscapeHint(844, 390)).toBe(false);
    expect(shouldShowLandscapeHint(1024, 768)).toBe(false);
  });
});

describe("REQ_ui__judge_duration", () => {
  it("formats duration for timer display", () => {
    expect(formatMatchDuration(0)).toBe("0:00");
    expect(formatMatchDuration(65_000)).toBe("1:05");
    expect(formatMatchDuration(3_661_000)).toBe("1:01:01");
  });

  it("computes elapsed from startedAt", () => {
    const start = "2026-07-21T10:00:00.000Z";
    const now = new Date("2026-07-21T10:02:30.000Z");
    expect(elapsedMs(start, now)).toBe(150_000);
    expect(elapsedMs(start, now, "2026-07-21T10:01:00.000Z")).toBe(60_000);
  });
});

describe("REQ_ui__judge_acquire_errors", () => {
  it("builds JUDGE_TAKEN message with judge name", () => {
    expect(
      judgeAcquireErrorMessage({
        code: "JUDGE_TAKEN",
        message: "x",
        details: { currentJudge: { userId: "1", displayName: "Иванов И." } },
      }),
    ).toMatch(/Иванов И\./);
  });
});
