import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TournamentDetailPage } from "../pages/TournamentDetailPage";
import { AuthProvider } from "../auth";
import { BRACKET_ALGORITHM_DIALOG } from "../bracketAlgorithmCopy";

const generateBracket = vi.fn().mockResolvedValue({});
const getTournament = vi.fn();

vi.mock("../api", () => ({
  api: {
    me: vi.fn().mockResolvedValue({
      user: { id: "u1", role: "user", firstName: "A", lastName: "B" },
    }),
    getTournament: (...args: unknown[]) => getTournament(...args),
    generateBracket: (...args: unknown[]) => generateBracket(...args),
    dissolveBracket: vi.fn(),
    startTournament: vi.fn(),
    stopTournament: vi.fn(),
    withdrawTournament: vi.fn(),
    cancelTournament: vi.fn(),
    addTournamentParticipant: vi.fn(),
    removeTournamentParticipant: vi.fn(),
    inviteTournament: vi.fn(),
    cancelTournamentInvitation: vi.fn(),
    searchUsers: vi.fn().mockResolvedValue({ users: [] }),
    directory: vi.fn().mockResolvedValue({ users: [] }),
  },
}));

describe("TournamentDetailPage algorithm dialog wiring", () => {
  beforeEach(() => {
    generateBracket.mockClear();
    getTournament.mockResolvedValue({
      tournament: {
        id: "t1",
        title: "Cup",
        status: "collecting",
        format: "single_elimination",
        createdByUserId: "u1",
        participants: [
          { id: "p1", displayName: "A", status: "active", userId: "u1" },
          { id: "p2", displayName: "B", status: "active", userId: "u2" },
          { id: "p3", displayName: "C", status: "active", userId: "u3" },
        ],
        invitations: [],
        matches: [],
        bracketJson: null,
      },
    });
  });

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={["/tournaments/t1"]}>
        <AuthProvider>
          <Routes>
            <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  it("Построить сетку opens dialog; submit sends compact enum", async () => {
    renderPage();
    await screen.findByText("Cup");
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    expect(
      screen.getByTestId("bracket-algorithm-dialog"),
    ).toBeInTheDocument();
    const submitButtons = screen.getAllByRole("button", {
      name: BRACKET_ALGORITHM_DIALOG.submit,
    });
    fireEvent.click(submitButtons[submitButtons.length - 1]!);
    await waitFor(() => {
      expect(generateBracket).toHaveBeenCalledWith("t1", {
        constructionAlgorithm: "compact",
      });
    });
  });

  it("cancel does not call generateBracket", async () => {
    renderPage();
    await screen.findByText("Cup");
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    const cancelButtons = screen.getAllByRole("button", {
      name: BRACKET_ALGORITHM_DIALOG.cancel,
    });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]!);
    expect(generateBracket).not.toHaveBeenCalled();
  });
});
