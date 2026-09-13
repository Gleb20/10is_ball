import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "../auth";
import { api } from "../api";
import { ProfilePage } from "./ProfilePage";

vi.mock("../api", () => ({
  api: {
    me: vi.fn().mockResolvedValue({
      user: {
        id: "u1",
        email: "anna@profile.test",
        role: "user",
        status: "active",
        firstName: "Анна",
        lastName: "Профиль",
        mustChangePassword: false,
        avatarKey: "avatar_1",
        onboardingStep: 6,
        onboardingCompletedAt: "2026-09-01T00:00:00.000Z",
      },
    }),
    ownProfile: vi.fn(),
    playerProfile: vi.fn(),
    updateProfile: vi.fn(),
    sessions: vi.fn(),
    revokeSession: vi.fn(),
    home: vi.fn().mockResolvedValue({ unreadCount: 2 }),
    restartOnboarding: vi.fn(),
    logout: vi.fn(),
  },
}));

const ownProfile = {
  isOwn: true,
  canChallenge: false,
  identity: {
    id: "u1",
    firstName: "Анна",
    lastName: "Профиль",
    displayName: "Профиль Анна",
    email: "anna@profile.test",
    birthDate: "1990-05-10",
    avatarKey: "avatar_1",
    organizationText: "Депо",
    positionText: "Инженер",
  },
  avatar: { key: "avatar_1", editable: false as const },
  stats: {
    matchesPlayed: 4,
    wins: 3,
    losses: 1,
    winRate: 0.75,
    averagePoints: 10.3,
    tournamentsPlayed: 1,
    tournamentWins: 1,
    tournamentsCreated: 1,
    judgedMatches: 2,
    rank: 1,
  },
  facts: {
    longestMatch: { matchId: "m1", title: "Долгая игра", durationSeconds: 1200 },
    bestWinningScore: { matchId: "m2", title: "Лучшая победа", score: "11:5" },
    frequentOpponent: { userId: "u2", displayName: "Соперник Борис", matchCount: 3 },
    rival: { userId: "u2", displayName: "Соперник Борис", matchCount: 3 },
  },
  teams: [{ id: "team-1", name: "Север", role: "captain" as const }],
};

const publicProfile = {
  ...ownProfile,
  isOwn: false,
  canChallenge: true,
  identity: {
    id: "u2",
    firstName: "Борис",
    lastName: "Соперник",
    displayName: "Соперник Борис",
    avatarKey: "avatar_2",
    organizationText: "Метро",
    positionText: "Аналитик",
  },
};

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="location">{location.pathname + location.search}</output>;
}

function PlayerSwitch() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/players/u3")}>Другой игрок</button>;
}

function AuthControl() {
  const { setUser } = useAuth();
  return (
    <>
      <button onClick={() => setUser(null)}>Expire</button>
      <button
        onClick={() =>
          setUser({
            id: "u1",
            email: "anna@profile.test",
            role: "user",
            mustChangePassword: false,
          })
        }
      >
        Restore
      </button>
    </>
  );
}

function renderProfile(path = "/profile") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/profile" element={<><ProfilePage /><LocationProbe /></>} />
          <Route path="/players/:userId" element={<><ProfilePage /><LocationProbe /></>} />
          <Route path="/matches/new" element={<LocationProbe />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("GAP-002 profile flow", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(api.ownProfile).mockResolvedValue({ profile: ownProfile });
    vi.mocked(api.playerProfile).mockResolvedValue({ profile: publicProfile });
    vi.mocked(api.sessions).mockResolvedValue({
      sessions: [
        {
          id: "current",
          userAgent: "Chrome · macOS",
          createdAt: "2026-09-07T10:00:00.000Z",
          lastSeenAt: "2026-09-07T12:00:00.000Z",
          current: true,
        },
        {
          id: "other",
          userAgent: "Safari · iPhone",
          createdAt: "2026-09-06T10:00:00.000Z",
          lastSeenAt: "2026-09-07T11:00:00.000Z",
          current: false,
        },
      ],
    });
    vi.mocked(api.revokeSession).mockResolvedValue({ ok: true });
    vi.mocked(api.updateProfile).mockResolvedValue({
      user: {
        id: "u1",
        email: "anna@profile.test",
        role: "user",
        status: "active",
        firstName: "Анна-Мария",
        lastName: "Профиль",
        mustChangePassword: false,
        avatarKey: "avatar_1",
        onboardingStep: 6,
        onboardingCompletedAt: "2026-09-01T00:00:00.000Z",
      },
    });
  });

  it("PROFILE-001/002/004: renders complete own identity, stats, facts, teams, and read-only avatar", async () => {
    renderProfile();
    expect(await screen.findByRole("heading", { name: "Статистика" })).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("10.3")).toBeInTheDocument();
    expect(screen.getByText("Долгая игра · 20 мин")).toBeInTheDocument();
    expect(screen.getByText("Лучшая победа · 11:5")).toBeInTheDocument();
    expect(screen.getAllByText(/Соперник Борис/).length).toBeGreaterThan(0);
    expect(screen.getByText("Север · капитан")).toBeInTheDocument();
    expect(screen.getByText(/аватар назначается автоматически/i)).toBeInTheDocument();
    expect(screen.getAllByText("anna@profile.test").length).toBeGreaterThan(0);
    expect(screen.getByText("10.05.1990")).toBeInTheDocument();
  });

  it("PROFILE-003: edits only local fields and refreshes the profile", async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(await screen.findByRole("button", { name: "Редактировать профиль" }));
    const firstName = screen.getByRole("textbox", { name: "Имя" });
    const birthDate = screen.getByLabelText("Дата рождения");
    await user.clear(firstName);
    await user.type(firstName, "Анна-Мария");
    fireEvent.input(birthDate, { target: { value: "1991-06-11" } });
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(api.updateProfile).toHaveBeenCalledWith({
        firstName: "Анна-Мария",
        lastName: "Профиль",
        birthDate: "1991-06-11",
        organizationText: "Депо",
        positionText: "Инженер",
      }),
    );
    expect(api.ownProfile).toHaveBeenCalledTimes(2);
  });

  it("AUTH-008: offers revocation only for another session and refreshes after success", async () => {
    const user = userEvent.setup();
    renderProfile();
    const current = (await screen.findByText("Chrome · macOS")).closest(".list-row");
    const other = screen.getByText("Safari · iPhone").closest(".list-row");
    expect(current).not.toBeNull();
    expect(other).not.toBeNull();
    expect(within(current as HTMLElement).queryByRole("button", { name: /завершить/i })).not.toBeInTheDocument();
    await user.click(within(other as HTMLElement).getByRole("button", { name: "Завершить" }));
    await user.click(screen.getByRole("button", { name: "Завершить сессию" }));
    await waitFor(() => expect(api.revokeSession).toHaveBeenCalledWith("other"));
    expect(api.sessions).toHaveBeenCalledTimes(2);
  });

  it("PROFILE-005: public card stays privacy-safe and routes Challenge with a prefilled opponent", async () => {
    const user = userEvent.setup();
    renderProfile("/players/u2");
    expect(await screen.findByText("Соперник Борис")).toBeInTheDocument();
    expect(api.playerProfile).toHaveBeenCalledWith("u2");
    expect(screen.queryByText("anna@profile.test")).not.toBeInTheDocument();
    expect(screen.queryByText("10.05.1990")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Редактировать профиль" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Бросить вызов" }));
    expect(screen.getByLabelText("location")).toHaveTextContent(
      "/matches/new?opponentId=u2&opponentName=%D0%A1%D0%BE%D0%BF%D0%B5%D1%80%D0%BD%D0%B8%D0%BA%20%D0%91%D0%BE%D1%80%D0%B8%D1%81",
    );
  });

  it("routes the actor's own ranking card to the full own profile", async () => {
    vi.mocked(api.playerProfile).mockResolvedValueOnce({ profile: ownProfile });
    renderProfile("/players/u1");
    await waitFor(() =>
      expect(screen.getByLabelText("location")).toHaveTextContent("/profile"),
    );
  });

  it("ignores a late profile failure after navigating to another player", async () => {
    let rejectFirst!: (reason: Error) => void;
    vi.mocked(api.playerProfile)
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce({
        profile: {
          ...publicProfile,
          identity: {
            ...publicProfile.identity,
            id: "u3",
            displayName: "Новый Игрок",
          },
        },
      });
    render(
      <MemoryRouter initialEntries={["/players/u2"]}>
        <AuthProvider>
          <Routes>
            <Route path="/players/:userId" element={<><ProfilePage /><PlayerSwitch /></>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(api.playerProfile).toHaveBeenCalledWith("u2"));
    await userEvent.click(screen.getByRole("button", { name: "Другой игрок" }));
    expect(await screen.findByText("Новый Игрок")).toBeInTheDocument();
    rejectFirst(new Error("Старый ответ"));
    await waitFor(() => expect(screen.queryByText("Старый ответ")).not.toBeInTheDocument());
    expect(screen.getByText("Новый Игрок")).toBeInTheDocument();
  });

  it("PROFILE-005: renders a blocked target as an unavailable card without private fallback", async () => {
    vi.mocked(api.playerProfile).mockRejectedValueOnce(
      Object.assign(new Error("Карточка недоступна"), { status: 404 }),
    );
    renderProfile("/players/blocked");
    expect(await screen.findByText("Карточка недоступна")).toBeInTheDocument();
    expect(screen.queryByText("anna@profile.test")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /вызов/i })).not.toBeInTheDocument();
  });

  it("keeps an unsaved edit draft and reloads authoritative data after reauthentication", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/profile"]}>
        <AuthProvider>
          <ProfilePage />
          <AuthControl />
        </AuthProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: "Редактировать профиль" }));
    const firstName = screen.getByRole("textbox", { name: "Имя" });
    await user.clear(firstName);
    await user.type(firstName, "Черновик");
    await user.click(screen.getByRole("button", { name: "Expire" }));
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(api.ownProfile).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("textbox", { name: "Имя" })).toHaveValue(
      "Черновик",
    );
    expect(api.updateProfile).not.toHaveBeenCalled();
  });
});
