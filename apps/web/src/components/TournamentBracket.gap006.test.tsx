import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
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

  it("opens a bracket match when session storage cannot save position", async () => {
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
        actualMatchId: "m1", cancelled: false, activationCondition: null,
      }],
    };
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/tournaments/t1"]}>
        <Routes>
          <Route path="/tournaments/:id" element={<TournamentBracket graph={graph} names={{ p1: "Анна", p2: "Борис" }} matches={[{ id: "m1", status: "waiting" }]} tournamentId="t1" userId="u1" />} />
          <Route path="/matches/m1/judge" element={<div>Судейство открыто</div>} />
        </Routes>
      </MemoryRouter>,
    );
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("StorageError"); });
    try {
      await user.click(screen.getByRole("button", { name: /Судить: Анна — Борис/ }));
      expect(await screen.findByText("Судейство открыто")).toBeInTheDocument();
    } finally {
      storage.mockRestore();
    }
  });
});
