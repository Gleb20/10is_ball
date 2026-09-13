import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TournamentBracket } from "./TournamentBracket";

describe("GAP-006 tournament bracket", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
  });
  it("marks every bracket row that belongs to the current participant", () => {
    const graph = {
      schemaVersion: 2 as const,
      format: "single_elimination" as const,
      constructionAlgorithm: "compact" as const,
      participantCount: 2,
      seedOrder: ["p1", "p2"],
      thirdPlaceEnabled: false,
      championParticipantId: null,
      runnerUpParticipantId: null,
      thirdPlaceParticipantId: null,
      matches: [{
        id: "node-1", stage: "winners" as const, roundIndex: 0,
        orderInRound: 0, displayNumber: 1,
        sourceA: { type: "seed" as const, seed: 1 },
        sourceB: { type: "seed" as const, seed: 2 },
        winnerParticipantId: null, loserParticipantId: null,
        actualMatchId: null, cancelled: false, activationCondition: null,
      }],
    };
    render(
      <MemoryRouter>
        <TournamentBracket
          graph={graph}
          names={{ p1: "Анна", p2: "Борис" }}
          matches={[]}
          highlightedParticipantIds={new Set(["p1"])}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Анна").closest("[data-bracket-player]")).toHaveClass("tournament-bracket__player--current");
    expect(screen.getByText("Борис").closest("[data-bracket-player]")).not.toHaveClass("tournament-bracket__player--current");
  });
});
