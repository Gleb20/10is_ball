import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../auth";
import { HomePage } from "./HomePage";
import { MatchDetailPage } from "./MatchDetailPage";
import { MatchesPage } from "./MatchesPage";
import { TournamentDetailPage } from "./TournamentDetailPage";
import { TournamentsPage } from "./TournamentsPage";

const home = vi.fn();
const listMatches = vi.fn();
const getMatch = vi.fn();
const listTournaments = vi.fn();
const getTournament = vi.fn();

vi.mock("../api", () => ({
  api: {
    me: vi.fn().mockResolvedValue({
      user: {
        id: "u1",
        email: "u1@tab10.local",
        role: "user",
        firstName: "Анна",
        lastName: "Игрок",
        mustChangePassword: false,
      },
    }),
    home: (...args: unknown[]) => home(...args),
    listMatches: (...args: unknown[]) => listMatches(...args),
    getMatch: (...args: unknown[]) => getMatch(...args),
    listTournaments: (...args: unknown[]) => listTournaments(...args),
    getTournament: (...args: unknown[]) => getTournament(...args),
    createTournament: vi.fn(),
    startMatch: vi.fn(),
    stopMatch: vi.fn(),
    cancelMatch: vi.fn(),
    voidMatch: vi.fn(),
    adminForceCloseMatch: vi.fn(),
    adminDeleteMatch: vi.fn(),
    generateBracket: vi.fn(),
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

function setDocumentVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function flushRequests() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("BUG-008 live match, tournament, list, and home surfaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDocumentVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls an active match and stops after the authoritative state is terminal", async () => {
    vi.useFakeTimers();
    getMatch
      .mockResolvedValueOnce({
        match: {
          id: "m1",
          title: "Финал",
          kind: "standalone",
          status: "in_progress",
          scoreA: 3,
          scoreB: 2,
          version: 5,
          createdByUserId: "u1",
          participants: [],
          activeJudge: null,
        },
      })
      .mockResolvedValue({
        match: {
          id: "m1",
          title: "Финал",
          kind: "standalone",
          status: "finished",
          scoreA: 11,
          scoreB: 7,
          version: 14,
          createdByUserId: "u1",
          participants: [],
          activeJudge: null,
        },
      });

    render(
      <MemoryRouter initialEntries={["/matches/m1"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await flushRequests();
    expect(screen.getByText("3 : 2")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByText("11 : 7")).toBeInTheDocument();
    expect(getMatch).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getMatch).toHaveBeenCalledTimes(2);
  });

  it("polls an active tournament detail and stops after completion", async () => {
    vi.useFakeTimers();
    const base = {
      id: "t1",
      title: "Кубок",
      format: "single_elimination",
      createdByUserId: "u1",
      participants: [],
      invitations: [],
      bracketJson: null,
    };
    getTournament
      .mockResolvedValueOnce({
        tournament: { ...base, status: "in_progress", matches: [] },
      })
      .mockResolvedValue({
        tournament: {
          ...base,
          status: "finished",
          matches: [
            {
              id: "tm1",
              title: "Финал",
              status: "finished",
              scoreA: 11,
              scoreB: 8,
            },
          ],
        },
      });

    render(
      <MemoryRouter initialEntries={["/tournaments/t1"]}>
        <AuthProvider>
          <Routes>
            <Route
              path="/tournaments/:id"
              element={<TournamentDetailPage />}
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await flushRequests();
    expect(screen.getByText("Идёт")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByText("Завершён")).toBeInTheDocument();
    expect(
      screen.getByText(/турнир завершён.*сыгранные матчи/i),
    ).toBeInTheDocument();
    expect(getTournament).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getTournament).toHaveBeenCalledTimes(2);
  });

  it("keeps a manual home retry after the initial request fails", async () => {
    home
      .mockRejectedValueOnce(new Error("Сеть недоступна"))
      .mockResolvedValue({
        hero: { type: "empty" },
        lastMatches: [],
        topRankings: [],
        unreadNotifications: [],
      });
    render(
      <MemoryRouter>
        <AuthProvider>
          <HomePage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Сеть недоступна",
    );
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    expect(
      await screen.findByText("Активных событий нет"),
    ).toBeInTheDocument();
    expect(home).toHaveBeenCalledTimes(2);
  });

  it("manually refreshes the match list without navigation", async () => {
    listMatches
      .mockResolvedValueOnce({
        matches: [
          {
            id: "m1",
            title: "Матч",
            status: "in_progress",
            scoreA: 1,
            scoreB: 0,
          },
        ],
      })
      .mockResolvedValue({
        matches: [
          {
            id: "m1",
            title: "Матч",
            status: "finished",
            scoreA: 11,
            scoreB: 6,
          },
        ],
      });
    render(
      <MemoryRouter>
        <MatchesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("1:0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    expect(await screen.findByText("11:6")).toBeInTheDocument();
    expect(listMatches).toHaveBeenCalledTimes(2);
  });

  it("manually refreshes the tournament list without navigation", async () => {
    listTournaments
      .mockResolvedValueOnce({
        tournaments: [
          {
            id: "t1",
            title: "Кубок",
            format: "single_elimination",
            status: "collecting",
          },
        ],
      })
      .mockResolvedValue({
        tournaments: [
          {
            id: "t1",
            title: "Кубок",
            format: "single_elimination",
            status: "finished",
          },
        ],
      });
    render(
      <MemoryRouter>
        <TournamentsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Сбор")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    expect(await screen.findByText("Завершён")).toBeInTheDocument();
    expect(listTournaments).toHaveBeenCalledTimes(2);
  });
});
