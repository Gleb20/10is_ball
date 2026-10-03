import { Activity, useState } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { TeamsPage } from "./TeamsPage";
import { TeamDetailPage } from "./TeamDetailPage";
import { AuthProvider, useAuth } from "../auth";
import { TaskNavigation } from "../layout";

const listTeams = vi.fn();
const createTeam = vi.fn();
const getTeam = vi.fn();
const me = vi.fn();

vi.mock("../api", () => ({
  api: {
    me: (...args: unknown[]) => me(...args),
    listTeams: (...args: unknown[]) => listTeams(...args),
    createTeam: (...args: unknown[]) => createTeam(...args),
    getTeam: (...args: unknown[]) => getTeam(...args),
  },
}));

vi.mock("../components/UserPicker", () => ({
  UserPicker: () => null,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function AuthControl() {
  const { setUser } = useAuth();
  return (
    <>
      <button onClick={() => setUser(null)}>expire-session</button>
      <button onClick={() => setUser({ id: "u1", role: "user", mustChangePassword: false } as never)}>restore-session</button>
      <button onClick={() => setUser({ id: "u2", role: "user", mustChangePassword: false } as never)}>switch-actor</button>
    </>
  );
}

function PageRoutes({ activityMode }: { activityMode?: "visible" | "hidden" }) {
  const page = (
    <Routes>
      <Route path="/teams" element={<TeamsPage />} />
      <Route path="/teams/:id" element={<span>team-detail</span>} />
    </Routes>
  );
  return activityMode
    ? <Activity mode={activityMode}>{page}</Activity>
    : page;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/teams"]}>
      <AuthProvider>
        <AuthControl />
        <PageRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function ActivityPage() {
  const [mode, setMode] = useState<"visible" | "hidden">("visible");
  return (
    <>
      <button onClick={() => setMode("hidden")}>hide-activity</button>
      <button onClick={() => setMode("visible")}>show-activity</button>
      <PageRoutes activityMode={mode} />
    </>
  );
}

function TeamDetailFixture() {
  return (
    <>
      <TaskNavigation userId="u1" />
      <TeamDetailPage />
    </>
  );
}

async function lowerReturnButton() {
  const buttons = await screen.findAllByRole("button", { name: "К списку команд" });
  return buttons[buttons.length - 1]!;
}

function HomeFixture() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/teams/team-2")}>direct-team-b</button>;
}

function renderNavigationFlow(initialEntries: string[] = ["/teams"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider>
        <Routes>
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:id" element={<TeamDetailFixture />} />
          <Route path="/" element={<HomeFixture />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function ActivityNavigationFlow() {
  const [mode, setMode] = useState<"visible" | "hidden">("visible");
  return (
    <>
      <button onClick={() => setMode("hidden")}>hide-navigation-activity</button>
      <button onClick={() => setMode("visible")}>show-navigation-activity</button>
      <Activity mode={mode}>
        <Routes>
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:id" element={<TeamDetailFixture />} />
        </Routes>
      </Activity>
    </>
  );
}

async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  const trigger = await screen.findByRole("button", { name: "Создать команду" });
  await user.click(trigger);
  expect(screen.getByRole("form", { name: "Создание команды" })).toBeInTheDocument();
  expect(screen.getByLabelText("Название команды")).toHaveFocus();
}

const createdTeam = {
  id: "team-2",
  name: "Подача",
  slogan: null,
  welcomeText: null,
  captainUserId: "u1",
  status: "active" as const,
  createdAt: "2026-09-13T00:00:00Z",
  archivedAt: null,
  members: [],
  isMember: true,
  isCaptain: true,
};

const teamList = [
  {
    ...createdTeam,
    id: "team-1",
    name: "Первая команда",
  },
  {
    ...createdTeam,
    id: "team-2",
    name: "Вторая команда",
    isCaptain: false,
  },
];

describe("GAP-022 teams list and creation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.sessionStorage.clear();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 0 });
    me.mockResolvedValue({ user: { id: "u1", role: "user", mustChangePassword: false } });
    getTeam.mockImplementation(async (id: string) => ({
      team: teamList.find((team) => team.id === id) ?? teamList[0],
    }));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("puts the team list before one collapsed inline create form", async () => {
    listTeams.mockResolvedValue({
      teams: [{
        id: "team-1",
        name: "Очень длинное название команды без скрытия",
        slogan: "Играем точно",
        status: "active",
        isCaptain: true,
        members: [{ userId: "u1" }, { userId: "u2" }],
      }],
    });
    const user = userEvent.setup();
    renderPage();

    const heading = await screen.findByRole("heading", { name: "Мои команды" });
    const trigger = screen.getByRole("button", { name: "Создать команду" });
    const link = await screen.findByRole("link", { name: /очень длинное название/i });
    expect(heading.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trigger.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Создание команды" })).not.toBeInTheDocument();
    expect(link).toHaveTextContent("Вы капитан");

    await user.click(trigger);
    expect(screen.getAllByRole("form", { name: "Создание команды" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Скрыть форму" }));
    expect(trigger).toHaveFocus();
  });

  it("creates once, freezes the payload, collapses, and focuses the returned team", async () => {
    const pending = deferred<{ team: typeof createdTeam }>();
    listTeams.mockResolvedValue({ teams: [] });
    createTeam.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Нет команд");
    await openCreate(user);

    await user.type(screen.getByLabelText("Название команды"), "Подача");
    await user.click(screen.getByRole("radio", { name: "Аватар 4" }));
    await user.type(screen.getByLabelText("Слоган"), "Вместе сильнее");
    await user.type(screen.getByLabelText("Текст приветствия"), "Добро пожаловать!");
    await user.dblClick(screen.getByRole("button", { name: "Создать" }));

    expect(createTeam).toHaveBeenCalledTimes(1);
    expect(createTeam).toHaveBeenCalledWith({
      name: "Подача",
      slogan: "Вместе сильнее",
      welcomeText: "Добро пожаловать!",
      avatarKey: "avatar_4",
    });
    expect(screen.getByLabelText("Название команды")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Скрыть форму" })).toBeDisabled();

    await act(async () => {
      pending.resolve({ team: createdTeam });
      await pending.promise;
    });
    const link = await screen.findByRole("link", { name: /подача/i });
    expect(screen.queryByRole("form", { name: "Создание команды" })).not.toBeInTheDocument();
    expect(link).toHaveFocus();
  });

  it("preserves values for a documented rejection and permits one explicit retry", async () => {
    listTeams.mockResolvedValue({ teams: [] });
    createTeam
      .mockRejectedValueOnce(Object.assign(new Error("Название занято"), { status: 400 }))
      .mockResolvedValueOnce({ team: createdTeam });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Нет команд");
    await openCreate(user);
    await user.type(screen.getByLabelText("Название команды"), "Подача");
    await user.click(screen.getByRole("radio", { name: "Аватар 6" }));
    await user.click(screen.getByRole("button", { name: "Создать" }));

    const form = screen.getByRole("form", { name: "Создание команды" });
    expect(within(form).getByRole("alert")).toHaveTextContent("Название занято");
    expect(screen.getByLabelText("Название команды")).toHaveValue("Подача");
    await user.click(screen.getByRole("button", { name: "Создать" }));
    expect(createTeam).toHaveBeenCalledTimes(2);
  });

  it("treats a lost response as unknown and only GETs before an explicit retry", async () => {
    listTeams.mockResolvedValue({ teams: [] });
    createTeam.mockRejectedValueOnce(new Error("Network lost"));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Нет команд");
    await openCreate(user);
    await user.type(screen.getByLabelText("Название команды"), "Подача");
    await user.click(screen.getByRole("radio", { name: "Аватар 6" }));
    await user.click(screen.getByRole("button", { name: "Создать" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось подтвердить создание");
    expect(screen.getByRole("button", { name: "Создать" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Аватар 6" })).toBeChecked();
    expect(createTeam).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Обновить список" }));
    expect(listTeams).toHaveBeenCalledTimes(2);
    expect(createTeam).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("radio", { name: "Аватар 6" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Создать ещё раз" })).toBeEnabled();
  });

  it("keeps list failure local and exposes one GET retry plus the same create trigger", async () => {
    listTeams
      .mockRejectedValueOnce(new Error("Список недоступен"))
      .mockResolvedValueOnce({ teams: [] });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Список недоступен");
    expect(screen.getByRole("button", { name: "Создать команду" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Повторить загрузку" }));
    expect(await screen.findByText("Нет команд")).toBeInTheDocument();
  });

  it("preserves a same-actor draft through reauthentication and clears it for a new actor", async () => {
    listTeams.mockResolvedValue({ teams: [] });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Нет команд");
    await openCreate(user);
    await user.type(screen.getByLabelText("Название команды"), "Черновик капитана");
    await user.click(screen.getByRole("button", { name: "expire-session" }));
    await user.click(screen.getByRole("button", { name: "restore-session" }));
    expect(await screen.findByLabelText("Название команды")).toHaveValue("Черновик капитана");

    await user.click(screen.getByRole("button", { name: "switch-actor" }));
    await waitFor(() => expect(screen.queryByLabelText("Название команды")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Создать команду" })).toBeInTheDocument();
  });

  it("does not let a late Activity result clear or overwrite a newer create", async () => {
    const first = deferred<{ team: typeof createdTeam }>();
    const second = deferred<{ team: typeof createdTeam }>();
    listTeams.mockResolvedValue({ teams: [] });
    createTeam.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/teams"]}>
        <AuthProvider>
          <ActivityPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByText("Нет команд");
    await openCreate(user);
    await user.type(screen.getByLabelText("Название команды"), "Первая");
    await user.click(screen.getByRole("button", { name: "Создать" }));
    await user.click(screen.getByRole("button", { name: "hide-activity" }));
    await user.click(screen.getByRole("button", { name: "show-activity" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось подтвердить создание");
    await user.click(screen.getByRole("button", { name: "Обновить список" }));
    await user.clear(screen.getByLabelText("Название команды"));
    await user.type(screen.getByLabelText("Название команды"), "Вторая");
    await user.click(screen.getByRole("button", { name: "Создать ещё раз" }));
    expect(createTeam).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Название команды")).toBeDisabled();

    await act(async () => first.resolve({ team: { ...createdTeam, id: "old", name: "Первая" } }));
    expect(screen.getByLabelText("Название команды")).toBeDisabled();
    expect(screen.queryByRole("link", { name: /Первая/ })).not.toBeInTheDocument();
    await act(async () => second.resolve({ team: { ...createdTeam, id: "new", name: "Вторая" } }));
    expect(await screen.findByRole("link", { name: /Вторая/ })).toHaveFocus();
  });

  it("restores the selected row and scroll after the top PUSH only after a fresh authorized GET", async () => {
    const freshReturn = deferred<{ teams: typeof teamList }>();
    listTeams
      .mockResolvedValueOnce({ teams: teamList })
      .mockReturnValueOnce(freshReturn.promise);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 640 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 2000 });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const user = userEvent.setup();
    renderNavigationFlow();

    await user.click(await screen.findByRole("link", { name: /Вторая команда/ }));
    await user.click(within(screen.getByRole("navigation", { name: "Возврат" }))
      .getByRole("button", { name: "К списку команд" }));
    expect(listTeams).toHaveBeenCalledTimes(2);
    expect(scrollTo).not.toHaveBeenCalled();

    await act(async () => freshReturn.resolve({ teams: teamList }));
    const returnedRow = await screen.findByRole("link", { name: /Вторая команда/ });
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 640));
    expect(returnedRow).toHaveFocus();
    expect(window.sessionStorage.getItem("tab10.teams.return")).toBeNull();
  });

  it("restores after the lower POP and uses a safe direct-detail fallback without context", async () => {
    listTeams.mockResolvedValue({ teams: teamList });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 420 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 1400 });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const user = userEvent.setup();
    const view = renderNavigationFlow();

    await user.click(await screen.findByRole("link", { name: /Первая команда/ }));
    await user.click(await lowerReturnButton());
    const returnedRow = await screen.findByRole("link", { name: /Первая команда/ });
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 420));
    expect(returnedRow).toHaveFocus();

    view.unmount();
    scrollTo.mockClear();
    renderNavigationFlow(["/teams/direct"]);
    await user.click(await lowerReturnButton());
    expect(await screen.findByRole("heading", { name: "Мои команды" })).toBeInTheDocument();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it.each(["top", "lower"] as const)(
    "does not restore team A after leaving for home, directly opening team B, and using the %s return",
    async (returnControl) => {
      listTeams.mockResolvedValue({ teams: teamList });
      Object.defineProperty(window, "scrollY", { configurable: true, value: 510 });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
      Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 1500 });
      const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
      const user = userEvent.setup();
      renderNavigationFlow();

      await user.click(await screen.findByRole("link", { name: /Первая команда/ }));
      const taskNavigation = screen.getByRole("navigation", { name: "Возврат" });
      await user.click(within(taskNavigation).getByRole("button", { name: "На главную" }));
      await user.click(screen.getByRole("button", { name: "direct-team-b" }));
      expect(await screen.findByRole("heading", { name: "Вторая команда" })).toBeInTheDocument();
      await waitFor(() => expect(window.sessionStorage.getItem("tab10.teams.return")).toBeNull());

      if (returnControl === "top") {
        await user.click(within(screen.getByRole("navigation", { name: "Возврат" }))
          .getByRole("button", { name: "К командам" }));
      } else {
        await user.click(await lowerReturnButton());
      }

      expect(await screen.findByRole("heading", { name: "Мои команды" })).toBeInTheDocument();
      expect(scrollTo).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["another actor", JSON.stringify({ userId: "u2", detailPath: "/teams/team-2", teamId: "team-2", scrollY: 500, navigationToken: "actor-token" })],
    ["malformed context", "{not-json"],
  ])("discards %s return context after a fresh list read", async (_label, stored) => {
    window.sessionStorage.setItem("tab10.teams.return", stored);
    listTeams.mockResolvedValue({ teams: teamList });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    renderNavigationFlow();

    expect(await screen.findByRole("link", { name: /Первая команда/ })).toBeInTheDocument();
    expect(listTeams).toHaveBeenCalledTimes(1);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("tab10.teams.return")).toBeNull();
  });

  it("clamps restored scroll and focuses the list heading when the selected row was removed", async () => {
    window.sessionStorage.setItem("tab10.teams.return", JSON.stringify({
      userId: "u1",
      detailPath: "/teams/team-2",
      teamId: "team-2",
      scrollY: 900,
      navigationToken: "removed-row-token",
    }));
    listTeams.mockResolvedValue({ teams: [teamList[0]!] });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 1000 });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    renderNavigationFlow();

    const heading = await screen.findByRole("heading", { name: "Мои команды" });
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 200));
    expect(heading).toHaveFocus();
    expect(screen.queryByRole("link", { name: /Вторая команда/ })).not.toBeInTheDocument();
  });

  it("waits through Activity resume and ignores the stale pre-hide list response", async () => {
    const staleReturn = deferred<{ teams: typeof teamList }>();
    listTeams
      .mockResolvedValueOnce({ teams: teamList })
      .mockReturnValueOnce(staleReturn.promise)
      .mockResolvedValueOnce({ teams: teamList });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 360 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 1500 });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/teams"]}>
        <AuthProvider><ActivityNavigationFlow /></AuthProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("link", { name: /Вторая команда/ }));
    await user.click(within(screen.getByRole("navigation", { name: "Возврат" }))
      .getByRole("button", { name: "К списку команд" }));
    await user.click(screen.getByRole("button", { name: "hide-navigation-activity" }));
    await user.click(screen.getByRole("button", { name: "show-navigation-activity" }));
    await waitFor(() => expect(listTeams).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 360));
    expect(await screen.findByRole("link", { name: /Вторая команда/ })).toHaveFocus();

    await act(async () => staleReturn.resolve({ teams: [teamList[0]!] }));
    expect(screen.getByRole("link", { name: /Вторая команда/ })).toHaveFocus();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});
