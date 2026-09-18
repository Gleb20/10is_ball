import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  notificationView: "available" as const,
};

describe("AT-HOME dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.home).mockResolvedValue(dashboard);
  });

  it("renders personal work, recent history, notification count, and direct actions", async () => {
    render(<MemoryRouter><AuthProvider><HomePage /></AuthProvider></MemoryRouter>);
    expect(await screen.findByText("Матч сейчас")).toBeInTheDocument();
    expect(screen.getByText("Кубок сейчас")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Матчи" })).toBeInTheDocument();
    expect(screen.getByText("История игр")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Уведомления (4)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /профиль: анна игрок/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Начать матч" })).toHaveAttribute("href", "/matches/new");
    expect(screen.getByRole("link", { name: "Провести турнир" })).toHaveAttribute("href", "/tournaments/new");
    expect(screen.getByRole("link", { name: "Игрок Анна" })).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("link", { name: "Игрок Анна" }).closest("ol")).toHaveTextContent("2 побед");
  });

  it("GAP-029 does not treat an old API's unverified count as zero or expose its preview", async () => {
    vi.mocked(api.home).mockResolvedValue({
      ...dashboard, notificationView: undefined, unreadCount: 8,
      unreadNotifications: [{ id: "old", type: "match_invitation", title: "Hidden game" }],
    });
    render(<MemoryRouter><AuthProvider><HomePage /></AuthProvider></MemoryRouter>);
    expect(await screen.findByRole("link", { name: "Уведомления" })).toBeInTheDocument();
    expect(screen.queryByText("Уведомления (8)")).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden game")).not.toBeInTheDocument();
  });

  it("reloads top-3 for the month period", async () => {
    render(<MemoryRouter><AuthProvider><HomePage /></AuthProvider></MemoryRouter>);
    await screen.findByText("Матч сейчас");
    fireEvent.click(screen.getByRole("button", { name: "За месяц" }));
    await waitFor(() => expect(api.home).toHaveBeenLastCalledWith("month", "all"));
  });

  it("shows two current tasks first and expands the remaining work on demand", async () => {
    vi.mocked(api.home).mockResolvedValue({
      ...dashboard,
      currentTasks: [
        { ...dashboard.activeEvents.match!, currentRoles: ["player"], updatedAt: "2026-09-18T10:00:00.000Z" },
        { ...dashboard.activeEvents.tournament!, currentRoles: ["organizer"], updatedAt: "2026-09-18T09:00:00.000Z" },
        { id: "m-third", type: "match", title: "Третье дело", status: "waiting", scoreA: 0, scoreB: 0, currentRoles: ["organizer"], updatedAt: "2026-09-18T08:00:00.000Z" },
      ],
    });
    render(<MemoryRouter><AuthProvider><HomePage /></AuthProvider></MemoryRouter>);
    expect(await screen.findByText("Матч сейчас")).toBeInTheDocument();
    expect(screen.queryByText("Третье дело")).not.toBeVisible();
    const more = screen.getByRole("button", { name: "Ещё 1 текущее дело" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(screen.getByText("Третье дело")).toBeVisible();
    expect(more).toHaveAttribute("aria-expanded", "true");
  });

  it("requests player history from the server before displaying the filtered five", async () => {
    vi.mocked(api.home).mockImplementation(async (_period, role) => ({ ...dashboard, recentRole: role, recentEvents: role === "player" ? dashboard.recentEvents.slice(0, 1) : dashboard.recentEvents }));
    render(<MemoryRouter><AuthProvider><HomePage /></AuthProvider></MemoryRouter>);
    await screen.findByText("Финал");
    fireEvent.click(screen.getByRole("button", { name: "Только мои" }));
    await waitFor(() => expect(api.home).toHaveBeenLastCalledWith("all_time", "player"));
    expect(screen.getByText("Финал")).toBeInTheDocument();
    expect(screen.queryByText("Кубок")).not.toBeInTheDocument();
  });

  it("shows actionable empty history and ranking with direct creation", async () => {
    vi.mocked(api.home).mockResolvedValue({
      ...dashboard,
      myStats: { ...dashboard.myStats, matchesPlayed: 0, wins: 0, losses: 0, winRate: 0, averagePoints: 0, rival: null },
      activeEvents: { match: null, tournament: null },
      recentEvents: [],
      topRankings: [],
      unreadCount: 0,
    });
    render(<MemoryRouter><AuthProvider><HomePage /></AuthProvider></MemoryRouter>);
    expect(await screen.findByText("История пока пуста")).toBeInTheDocument();
    expect(screen.getByText("История пока пуста")).toBeInTheDocument();
    expect(screen.getByText("Рейтинг пока пуст")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Начать матч" }).length).toBeGreaterThan(0);
  });

  it("keeps other permitted routes reachable while Home data fails", async () => {
    vi.mocked(api.home).mockRejectedValue(new Error("Сеть недоступна"));
    render(<MemoryRouter><AuthProvider><HomePage /></AuthProvider></MemoryRouter>);
    expect(await screen.findByText("Не удалось загрузить главную")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Команды" })).toHaveAttribute("href", "/teams");
    expect(screen.getByRole("link", { name: "Помощь" })).toHaveAttribute("href", "/help");
    expect(screen.getByRole("link", { name: "Турниры" })).toHaveAttribute("href", "/tournaments");
    const otherRoutes = screen.getByRole("navigation", { name: "Другие разделы" });
    expect(within(otherRoutes).getByRole("link", { name: "История" })).toHaveAttribute("href", "/history");
    expect(within(otherRoutes).getByRole("link", { name: "Рейтинг" })).toHaveAttribute("href", "/rankings");
    expect(screen.getByRole("link", { name: /Профиль: Анна Игрок/ })).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("link", { name: "Уведомления" })).toHaveAttribute("href", "/notifications");
    expect(screen.queryByText(/в рейтинге/)).not.toBeInTheDocument();
  });

  it("keeps history and ranking available while the first Home request is pending", async () => {
    vi.mocked(api.home).mockImplementation(() => new Promise(() => {}));
    render(<MemoryRouter><AuthProvider><HomePage /></AuthProvider></MemoryRouter>);
    expect(await screen.findByRole("status", { name: "Загружаем главную" })).toBeInTheDocument();
    const otherRoutes = screen.getByRole("navigation", { name: "Другие разделы" });
    expect(within(otherRoutes).getByRole("link", { name: "История" })).toHaveAttribute("href", "/history");
    expect(within(otherRoutes).getByRole("link", { name: "Рейтинг" })).toHaveAttribute("href", "/rankings");
    expect(screen.queryByText(/в рейтинге/)).not.toBeInTheDocument();
  });

  it("marks a finished match winner by side even when both sides have the same display name", async () => {
    vi.mocked(api.home).mockResolvedValue({
      ...dashboard,
      recentEvents: [{
        id: "m-same", type: "match", title: "Пары", status: "finished",
        sideA: "Анна / Борис", sideB: "Анна / Борис", scoreA: 8, scoreB: 11,
        winnerName: "Анна / Борис", winnerSide: "B", durationSeconds: 600,
      }],
    });
    render(<MemoryRouter><AuthProvider><HomePage /></AuthProvider></MemoryRouter>);
    const card = await screen.findByRole("link", { name: /Анна \/ Борис.*Анна \/ Борис/ });
    expect(within(card).getByRole("img", { name: "Победитель: сторона B" })).toBeInTheDocument();
    expect(card).toHaveTextContent("10 мин");
    expect(card).not.toHaveTextContent("Победитель: Анна / Борис");
    expect(card).not.toHaveTextContent("Завершён");
  });

  it("keeps 2×2 names, unknown winners, and exceptional terminal outcomes distinct", async () => {
    vi.mocked(api.home).mockResolvedValue({
      ...dashboard,
      recentEvents: [
        { id: "m-pair", type: "match", title: "Пары", status: "finished", sideA: "Анна / Борис", sideB: "Вера / Глеб", scoreA: 11, scoreB: 7, winnerSide: "A", durationSeconds: 780 },
        { id: "m-legacy", type: "match", title: "Старый ответ", status: "finished", sideA: "Анна", sideB: "Борис", scoreA: 11, scoreB: 7, winnerName: "Анна", durationSeconds: 600 },
        { id: "m-stop", type: "match", title: "Остановленный", status: "stopped", sideA: "Анна", sideB: "Борис", scoreA: 5, scoreB: 3, winnerSide: "A" },
        { id: "m-cancel", type: "match", title: "Отменённый", status: "cancelled", scoreA: 0, scoreB: 0 },
        { id: "m-void", type: "match", title: "Аннулированный", status: "voided", scoreA: 11, scoreB: 9 },
      ],
    });
    render(<MemoryRouter><AuthProvider><HomePage /></AuthProvider></MemoryRouter>);
    await screen.findByText("Анна / Борис");
    const byId = (id: string) => document.querySelector<HTMLAnchorElement>(`a[href="/matches/${id}"]`)!;
    expect(within(byId("m-pair")).getByRole("img", { name: "Победитель: сторона A" })).toBeInTheDocument();
    expect(byId("m-pair")).toHaveTextContent("13 мин");
    expect(within(byId("m-legacy")).queryByRole("img", { name: /Победитель/ })).not.toBeInTheDocument();
    expect(within(byId("m-stop")).queryByRole("img", { name: /Победитель/ })).not.toBeInTheDocument();
    expect(byId("m-stop")).toHaveTextContent("Остановлен");
    expect(byId("m-cancel")).toHaveTextContent("Отменён");
    expect(byId("m-void")).toHaveTextContent("Аннулирован");
  });
});
