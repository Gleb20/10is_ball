import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TeamsPage } from "./TeamsPage";
import { AuthProvider, useAuth } from "../auth";

const listTeams = vi.fn();
const createTeam = vi.fn();
const me = vi.fn();

vi.mock("../api", () => ({
  api: {
    me: (...args: unknown[]) => me(...args),
    listTeams: (...args: unknown[]) => listTeams(...args),
    createTeam: (...args: unknown[]) => createTeam(...args),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function AuthControl() {
  const { setUser } = useAuth();
  return (
    <>
      <button onClick={() => setUser(null)}>expire-session</button>
      <button onClick={() => setUser({ id: "u1", role: "user", mustChangePassword: false } as never)}>restore-session</button>
    </>
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/teams"]}>
      <AuthProvider>
        <AuthControl />
        <Routes>
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:id" element={<span>team-detail</span>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("GAP-007 teams list and creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    me.mockResolvedValue({ user: { id: "u1", role: "user", mustChangePassword: false } });
  });
  afterEach(() => cleanup());

  it("shows current teams as detail links with captain and member counts", async () => {
    listTeams.mockResolvedValue({
      teams: [
        {
          id: "team-1",
          name: "Ракетки",
          slogan: "Играем точно",
          status: "active",
          isCaptain: true,
          members: [{ userId: "u1" }, { userId: "u2" }],
        },
      ],
    });
    const user = userEvent.setup();
    renderPage();

    const link = await screen.findByRole("link", { name: /ракетки/i });
    expect(link).toHaveTextContent("Играем точно");
    expect(link).toHaveTextContent(/2 участник/);
    expect(link).toHaveTextContent(/капитан/i);
    await user.click(link);
    expect(await screen.findByText("team-detail")).toBeInTheDocument();
  });

  it("creates once with optional text and refreshes the list", async () => {
    const createdTeam = {
      id: "team-2", name: "Подача", slogan: null, welcomeText: null,
      captainUserId: "u1", status: "active" as const, createdAt: "2026-09-13T00:00:00Z",
      archivedAt: null, members: [], isMember: true, isCaptain: true,
    };
    const pending = deferred<{ team: typeof createdTeam }>();
    listTeams
      .mockResolvedValueOnce({ teams: [] });
    createTeam.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Нет команд");
    await user.type(screen.getByLabelText("Название команды"), "Подача");
    await user.type(screen.getByLabelText("Слоган"), "Вместе сильнее");
    await user.type(screen.getByLabelText("Текст приветствия"), "Добро пожаловать!");
    const submit = screen.getByRole("button", { name: "Создать" });
    await user.dblClick(submit);

    expect(createTeam).toHaveBeenCalledTimes(1);
    expect(createTeam).toHaveBeenCalledWith({
      name: "Подача",
      slogan: "Вместе сильнее",
      welcomeText: "Добро пожаловать!",
    });
    expect(screen.getByRole("button", { name: /создание/i })).toBeDisabled();
    await act(async () => {
      pending.resolve({ team: createdTeam });
      await pending.promise;
    });
    expect(await screen.findByRole("link", { name: /подача/i })).toBeInTheDocument();
  });

  it("keeps the create form visible when initial loading fails", async () => {
    listTeams.mockRejectedValue(new Error("Список недоступен"));
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Список недоступен");
    expect(within(screen.getByRole("form", { name: "Создание команды" })).getByLabelText("Название команды")).toBeInTheDocument();
  });

  it("does not let a late initial load erase a newly created team", async () => {
    const initial = deferred<{ teams: never[] }>();
    listTeams.mockReturnValueOnce(initial.promise);
    createTeam.mockResolvedValue({
      team: {
        id: "team-new", name: "Новая", slogan: null, welcomeText: null,
        captainUserId: "u1", status: "active", createdAt: "2026-09-13T00:00:00Z",
        archivedAt: null, members: [], isMember: true, isCaptain: true,
      },
    });
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("Название команды"), "Новая");
    await user.click(screen.getByRole("button", { name: "Создать" }));
    expect(await screen.findByRole("link", { name: /новая/i })).toBeInTheDocument();
    await act(async () => initial.resolve({ teams: [] }));
    expect(screen.getByRole("link", { name: /новая/i })).toBeInTheDocument();
  });

  it("reloads after same-user reauthentication and preserves the create draft", async () => {
    listTeams
      .mockResolvedValueOnce({ teams: [] })
      .mockResolvedValueOnce({
        teams: [{ id: "team-restored", name: "После входа", slogan: null, members: [], isCaptain: false, status: "active" }],
      });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Нет команд");
    await user.type(screen.getByLabelText("Название команды"), "Несохранённый черновик");
    await user.click(screen.getByRole("button", { name: "expire-session" }));
    await user.click(screen.getByRole("button", { name: "restore-session" }));
    expect(await screen.findByRole("link", { name: /после входа/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Название команды")).toHaveValue("Несохранённый черновик");
  });
});
