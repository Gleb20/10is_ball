import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "../auth";
import { api } from "../api";
import { ProfilePage, validateProfileDraft } from "./ProfilePage";

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

function PublicProfileSwitch() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/players/u2")}>Open public profile</button>;
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
      <button
        onClick={() =>
          setUser({
            id: "u2",
            email: "boris@profile.test",
            role: "user",
            mustChangePassword: false,
          })
        }
      >
        Switch actor
      </button>
    </>
  );
}

function ActorProbe() {
  const { user } = useAuth();
  return <output aria-label="actor">{user?.id ?? "anonymous"}</output>;
}

function RemountProfile() {
  const [instance, setInstance] = useState(0);
  return (
    <>
      <ProfilePage key={instance} />
      <button onClick={() => setInstance((current) => current + 1)}>Remount profile</button>
      <ActorProbe />
    </>
  );
}

function ActivityProfile() {
  const [mode, setMode] = useState<"visible" | "hidden">("visible");
  return (
    <>
      <button onClick={() => setMode("hidden")}>Hide profile</button>
      <button onClick={() => setMode("visible")}>Reveal profile</button>
      <Activity mode={mode}>
        <ProfilePage />
      </Activity>
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

  it("BUG-036: keeps an invalid attempt, associates the rule with the field, and focuses the first invalid field", async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(await screen.findByRole("button", { name: "Редактировать профиль" }));
    const firstName = screen.getByRole("textbox", { name: "Имя" });
    const organization = screen.getByRole("textbox", { name: "Организация" });
    await user.clear(firstName);
    fireEvent.change(organization, { target: { value: "О".repeat(201) } });

    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(api.updateProfile).not.toHaveBeenCalled();
    const invalidFirstName = screen.getByRole("textbox", { name: "Имя" });
    const invalidOrganization = screen.getByRole("textbox", { name: "Организация" });
    expect(invalidFirstName).toHaveAttribute("aria-invalid", "true");
    expect(invalidFirstName.getAttribute("aria-describedby")).toContain("profile-first-name-helper");
    expect(invalidOrganization).toHaveAttribute("aria-invalid", "true");
    expect(invalidOrganization).toHaveValue("О".repeat(201));
    expect(screen.getByText("Введите имя.")).toBeInTheDocument();
    expect(screen.getByText("Не более 200 символов после удаления пробелов по краям.")).toBeInTheDocument();
    expect(invalidFirstName).toHaveFocus();
  });

  it("BUG-036: mirrors trimmed server limits and exact calendar dates", () => {
    expect(validateProfileDraft({
      firstName: `  ${"А".repeat(100)}  `,
      lastName: "Профиль",
      birthDate: "2024-02-29",
      organizationText: `  ${"О".repeat(200)}  `,
      positionText: "",
    })).toEqual({});
    for (const birthDate of ["0001-01-01", "0099-12-31"]) {
      expect(validateProfileDraft({
        firstName: "Анна",
        lastName: "Профиль",
        birthDate,
        organizationText: "",
        positionText: "",
      })).toEqual({});
    }
    expect(validateProfileDraft({
      firstName: "   ",
      lastName: "Профиль",
      birthDate: "2025-02-29",
      organizationText: "",
      positionText: "Д".repeat(201),
    })).toEqual({
      firstName: "Введите имя.",
      birthDate: "Введите существующую дату в формате ГГГГ-ММ-ДД.",
      positionText: "Не более 200 символов после удаления пробелов по краям.",
    });
    expect(validateProfileDraft({
      firstName: "Анна",
      lastName: "Профиль",
      birthDate: "0000-01-01",
      organizationText: "",
      positionText: "",
    }).birthDate).toBe("Введите существующую дату в формате ГГГГ-ММ-ДД.");
  });

  it("BUG-036: treats a lost save response as unknown and refreshes with GET without replaying PATCH", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateProfile).mockRejectedValueOnce(new Error("Network failed"));
    renderProfile();
    await user.click(await screen.findByRole("button", { name: "Редактировать профиль" }));
    const organization = screen.getByRole("textbox", { name: "Организация" });
    await user.clear(organization);
    await user.type(organization, "Новая организация");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(await screen.findByText("Не удалось проверить сохранение")).toBeInTheDocument();
    expect(organization).toHaveValue("Новая организация");
    expect(api.updateProfile).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Обновить данные" }));
    await waitFor(() => expect(api.ownProfile).toHaveBeenCalledTimes(2));
    expect(api.updateProfile).toHaveBeenCalledTimes(1);
    expect(organization).toHaveValue("Новая организация");
    expect(screen.getByText(/не подтверждает исход предыдущего сохранения/i)).toBeInTheDocument();
  });

  it("BUG-036: keeps a generic 400 at form level without guessing a field", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateProfile).mockRejectedValueOnce(
      Object.assign(new Error("Проверьте данные профиля"), { status: 400 }),
    );
    renderProfile();
    await user.click(await screen.findByRole("button", { name: "Редактировать профиль" }));
    const organization = screen.getByRole("textbox", { name: "Организация" });
    await user.clear(organization);
    await user.type(organization, "Попытка");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(await screen.findByText("Проверьте данные профиля")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Организация" })).toHaveValue("Попытка");
    expect(screen.getByRole("textbox", { name: "Организация" })).not.toHaveAttribute("aria-invalid");
  });

  it("BUG-036: ignores a late save response after the actor changes and clears the previous actor draft", async () => {
    const user = userEvent.setup();
    let resolveSave!: (value: Awaited<ReturnType<typeof api.updateProfile>>) => void;
    vi.mocked(api.updateProfile).mockImplementationOnce(
      () => new Promise((resolve) => { resolveSave = resolve; }),
    );
    render(
      <MemoryRouter initialEntries={["/profile"]}>
        <AuthProvider>
          <ProfilePage />
          <AuthControl />
          <ActorProbe />
        </AuthProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: "Редактировать профиль" }));
    const firstName = screen.getByRole("textbox", { name: "Имя" });
    await user.clear(firstName);
    await user.type(firstName, "Старая попытка");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await user.click(screen.getByRole("button", { name: "Switch actor" }));
    expect(screen.getByRole("status", { name: "actor" })).toHaveTextContent("u2");

    await act(async () => resolveSave({
      user: {
        id: "u1",
        email: "anna@profile.test",
        role: "user",
        mustChangePassword: false,
      },
    }));

    await waitFor(() => expect(screen.getByRole("status", { name: "actor" })).toHaveTextContent("u2"));
    expect(screen.queryByDisplayValue("Старая попытка")).not.toBeInTheDocument();
  });

  it("BUG-036: ignores a late save response after moving to a public profile", async () => {
    const user = userEvent.setup();
    let resolveSave!: (value: Awaited<ReturnType<typeof api.updateProfile>>) => void;
    vi.mocked(api.updateProfile).mockImplementationOnce(
      () => new Promise((resolve) => { resolveSave = resolve; }),
    );
    render(
      <MemoryRouter initialEntries={["/profile"]}>
        <AuthProvider>
          <Routes>
            <Route path="/profile" element={<><ProfilePage /><PublicProfileSwitch /><ActorProbe /></>} />
            <Route path="/players/:userId" element={<><ProfilePage /><ActorProbe /></>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: "Редактировать профиль" }));
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await user.click(screen.getByRole("button", { name: "Open public profile" }));
    expect(await screen.findByText("Соперник Борис")).toBeInTheDocument();

    await act(async () => resolveSave({
      user: { id: "u1", email: "anna@profile.test", role: "user", mustChangePassword: false },
    }));

    await waitFor(() => expect(screen.getByRole("status", { name: "actor" })).toHaveTextContent("u1"));
    expect(screen.getByText("Соперник Борис")).toBeInTheDocument();
    expect(api.ownProfile).toHaveBeenCalledTimes(1);
  });

  it("BUG-036: ignores a save response from before reauthentication and keeps the draft", async () => {
    const user = userEvent.setup();
    let resolveSave!: (value: Awaited<ReturnType<typeof api.updateProfile>>) => void;
    vi.mocked(api.updateProfile).mockImplementationOnce(
      () => new Promise((resolve) => { resolveSave = resolve; }),
    );
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
    await user.type(firstName, "До повторного входа");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await user.click(screen.getByRole("button", { name: "Expire" }));
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(api.ownProfile).toHaveBeenCalledTimes(2));

    await act(async () => resolveSave({
      user: { id: "u1", email: "anna@profile.test", role: "user", mustChangePassword: false },
    }));

    expect(await screen.findByDisplayValue("До повторного входа")).toBeInTheDocument();
    expect(api.ownProfile).toHaveBeenCalledTimes(2);
  });

  it("BUG-036: ignores a late save response from an unmounted profile instance", async () => {
    const user = userEvent.setup();
    let resolveSave!: (value: Awaited<ReturnType<typeof api.updateProfile>>) => void;
    vi.mocked(api.updateProfile).mockImplementationOnce(
      () => new Promise((resolve) => { resolveSave = resolve; }),
    );
    render(
      <MemoryRouter initialEntries={["/profile"]}>
        <AuthProvider>
          <RemountProfile />
        </AuthProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: "Редактировать профиль" }));
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await user.click(screen.getByRole("button", { name: "Remount profile" }));
    await waitFor(() => expect(api.ownProfile).toHaveBeenCalledTimes(2));

    await act(async () => resolveSave({
      user: { id: "u2", email: "boris@profile.test", role: "user", mustChangePassword: false },
    }));

    await waitFor(() => expect(screen.getByRole("status", { name: "actor" })).toHaveTextContent("u1"));
    expect(api.ownProfile).toHaveBeenCalledTimes(2);
  });

  it("BUG-036: exposes an interrupted Activity save as unknown and an old finally cannot clear a newer save", async () => {
    const user = userEvent.setup();
    let rejectFirst!: (reason: Error) => void;
    let resolveSecond!: (value: Awaited<ReturnType<typeof api.updateProfile>>) => void;
    vi.mocked(api.updateProfile)
      .mockImplementationOnce(
        () => new Promise((_, reject) => { rejectFirst = reject; }),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveSecond = resolve; }),
      );
    render(
      <MemoryRouter initialEntries={["/profile"]}>
        <AuthProvider>
          <ActivityProfile />
        </AuthProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: "Редактировать профиль" }));
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Hide profile" }));
    await user.click(screen.getByRole("button", { name: "Reveal profile" }));
    expect(await screen.findByText("Не удалось проверить сохранение")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();

    const profileReadsBeforeReview = vi.mocked(api.ownProfile).mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Обновить данные" }));
    await waitFor(() =>
      expect(api.ownProfile).toHaveBeenCalledTimes(profileReadsBeforeReview + 1),
    );
    expect(screen.getByText(/не подтверждает исход предыдущего сохранения/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledTimes(2));

    await act(async () => rejectFirst(
      Object.assign(new Error("late first response"), { status: 500 }),
    ));
    expect(screen.getByRole("button", { name: "Сохранение…" })).toBeDisabled();

    await act(async () => resolveSecond({
      user: { id: "u1", email: "anna@profile.test", role: "user", mustChangePassword: false },
    }));
    await waitFor(() =>
      expect(screen.queryByRole("form", { name: "Редактирование профиля" })).not.toBeInTheDocument(),
    );
  });

  it("GAP-014/BUG-036: ignores a late onboarding restart after the actor changes", async () => {
    const user = userEvent.setup();
    let resolveRestart!: (value: Awaited<ReturnType<typeof api.restartOnboarding>>) => void;
    vi.mocked(api.restartOnboarding).mockImplementationOnce(
      () => new Promise((resolve) => { resolveRestart = resolve; }),
    );
    render(
      <MemoryRouter initialEntries={["/profile"]}>
        <AuthProvider>
          <Routes>
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/onboarding" element={<div>Onboarding destination</div>} />
          </Routes>
          <AuthControl />
          <ActorProbe />
          <LocationProbe />
        </AuthProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByText("Пройти обучение заново"));
    await user.click(screen.getByRole("button", { name: "Switch actor" }));

    await act(async () => resolveRestart({
      user: { id: "u1", email: "anna@profile.test", role: "user", mustChangePassword: false },
    }));

    expect(screen.getByRole("status", { name: "actor" })).toHaveTextContent("u2");
    expect(screen.getByLabelText("location")).toHaveTextContent("/profile");
    expect(screen.queryByText("Onboarding destination")).not.toBeInTheDocument();
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

  it("PROFILE-005 / D37: public card stays privacy-safe without challenge entry", async () => {
    renderProfile("/players/u2");
    expect(await screen.findByText("Соперник Борис")).toBeInTheDocument();
    expect(api.playerProfile).toHaveBeenCalledWith("u2");
    expect(screen.queryByText("anna@profile.test")).not.toBeInTheDocument();
    expect(screen.queryByText("10.05.1990")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Редактировать профиль" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Бросить вызов" })).not.toBeInTheDocument();
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
