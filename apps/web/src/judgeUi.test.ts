import { describe, expect, it } from "vitest";
import {
  participantDisplayName,
  servingSide,
  shouldShowLandscapeHint,
  sideDisplayName,
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
