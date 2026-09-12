import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../auth";
import { api } from "../api";
import type { HomeResponse } from "../api";
import { HomePage } from "./HomePage";

vi.mock("../api", () => ({
  api: {
    me: vi.fn().mockResolvedValue({
      user: {
        id: "u1",
        email: "anna@home.test",
        role: "user",
        firstName: "Анна",
        lastName: "Игрок",
        mustChangePassword: false,
      },
    }),
    home: vi.fn(),
  },
}));

const dashboard: HomeResponse = {
  rankingPeriod: "all_time" as const,
  myStats: {
    rank: 1,
    matchesPlayed: 3,
    wins: 2,
    losses: 1,
    winRate: 2 / 3,
    averagePoints: 9.7,
    displayName: "Игрок Анна",
    avatarKey: null,
    rival: { userId: "u2", displayName: "Игрок Борис", matchCount: 3 },
  },
  activeEvents: {
    match: { id: "m-live", type: "match", title: "Матч сейчас", status: "in_progress", scoreA: 5, scoreB: 4 },
    tournament: { id: "t-live", type: "tournament", title: "Кубок сейчас", status: "in_progress" },
  },
  recentEvents: [
    { id: "m1", type: "match", title: "Финал", status: "finished", scoreA: 11, scoreB: 8, durationSeconds: 600, userRole: "participant" },
    { id: "t1", type: "tournament", title: "Кубок", status: "finished", durationSeconds: 3600, userRole: "judge", topThree: ["Игрок Анна"] },
  ],
  topRankings: [{ userId: "u1", displayName: "Игрок Анна", wins: 2, avatarKey: null }],
  unreadNotifications: [],
  unreadCount: 4,
};

describe("AT-HOME dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.home).mockResolvedValue(dashboard);
  });

  it("renders hero, both active event types, combined recent feed, notification count, and profile entry", async () => {
    render(<MemoryRouter><AuthProvider><HomePage /></AuthProvider></MemoryRouter>);
    expect(await screen.findByText("Матч сейчас")).toBeInTheDocument();
    expect(screen.getByText("Кубок сейчас")).toBeInTheDocument();
    expect(screen.getByText("Сыграно")).toBeInTheDocument();
    expect(screen.getByText("Игрок Борис")).toBeInTheDocument();
    expect(screen.getByText("Последние события")).toBeInTheDocument();
    expect(screen.getByText("Непрочитанных: 4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /открыть профиль/i })).toBeInTheDocument();
  });

  it("reloads top-3 for the month period", async () => {
    render(<MemoryRouter><AuthProvider><HomePage /></AuthProvider></MemoryRouter>);
    await screen.findByText("Матч сейчас");
    fireEvent.click(screen.getByRole("button", { name: "За месяц" }));
    await waitFor(() => expect(api.home).toHaveBeenLastCalledWith("month"));
  });

  it("shows actionable empty states for active events, history, ranking, and rival", async () => {
    vi.mocked(api.home).mockResolvedValue({
      ...dashboard,
      myStats: { ...dashboard.myStats, matchesPlayed: 0, wins: 0, losses: 0, winRate: 0, averagePoints: 0, rival: null },
      activeEvents: { match: null, tournament: null },
      recentEvents: [],
      topRankings: [],
      unreadCount: 0,
    });
    render(<MemoryRouter><AuthProvider><HomePage /></AuthProvider></MemoryRouter>);
    expect(await screen.findByText("Активных событий нет")).toBeInTheDocument();
    expect(screen.getByText("История пока пуста")).toBeInTheDocument();
    expect(screen.getByText("Рейтинг пока пуст")).toBeInTheDocument();
    expect(screen.getByText("Соперник появится после трёх очных матчей")).toBeInTheDocument();
  });
});
