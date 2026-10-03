import { Activity, useState } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { TeamDetailPage } from "./TeamDetailPage";
import { AuthProvider, useAuth } from "../auth";

const me = vi.fn();
const getTeam = vi.fn();
const updateTeam = vi.fn();
const inviteTeamMember = vi.fn();
const removeTeamMember = vi.fn();
const transferTeamCaptain = vi.fn();
const leaveTeam = vi.fn();

vi.mock("../api", () => ({
  api: {
    me: (...args: unknown[]) => me(...args),
    getTeam: (...args: unknown[]) => getTeam(...args),
    updateTeam: (...args: unknown[]) => updateTeam(...args),
    inviteTeamMember: (...args: unknown[]) => inviteTeamMember(...args),
    removeTeamMember: (...args: unknown[]) => removeTeamMember(...args),
    transferTeamCaptain: (...args: unknown[]) => transferTeamCaptain(...args),
    leaveTeam: (...args: unknown[]) => leaveTeam(...args),
  },
}));

vi.mock("../components/UserPicker", () => ({
  UserPicker: ({
    label,
    value,
    onChange,
    disabled,
    excludeUserIds,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    excludeUserIds?: string[];
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Выберите пользователя</option>
      <option value="u3" disabled={excludeUserIds?.includes("u3")}>Третий Игрок</option>
    </select>
  ),
}));

const captainTeam = {
  id: "team-1",
  name: "Ракетки",
  slogan: "Играем точно",
  welcomeText: "Рады видеть в команде!",
  avatarKey: "avatar_3" as const,
  captainUserId: "u1",
  status: "active" as const,
  createdAt: "2026-09-01T10:00:00.000Z",
  archivedAt: null,
  isMember: true,
  isCaptain: true,
  members: [
    { id: "m1", userId: "u1", joinedAt: "2026-09-01T10:00:00.000Z", displayName: "Первый Капитан", avatarKey: "avatar_1" },
    { id: "m2", userId: "u2", joinedAt: "2026-09-02T10:00:00.000Z", displayName: "Второй Игрок", avatarKey: "avatar_2" },
  ],
  invitations: [],
};

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
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate("/teams/team-2")}>other-team</button>
      <button onClick={() => setUser(null)}>expire-session</button>
      <button onClick={() => setUser({ id: "u1", role: "user", mustChangePassword: false } as never)}>restore-session</button>
      <button onClick={() => setUser({ id: "u2", role: "user", mustChangePassword: false } as never)}>switch-actor</button>
    </>
  );
}

function renderPage(path: string | { pathname: string; state?: unknown } = "/teams/team-1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AuthControl />
        <Routes>
          <Route path="/teams/:id" element={<TeamDetailPage />} />
          <Route path="/teams" element={<span>teams-list</span>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function ActivityTeamPage() {
  const [mode, setMode] = useState<"visible" | "hidden">("visible");
  return (
    <>
      <button onClick={() => setMode("hidden")}>hide-activity</button>
      <button onClick={() => setMode("visible")}>show-activity</button>
      <Activity mode={mode}>
        <Routes>
          <Route path="/teams/:id" element={<TeamDetailPage />} />
        </Routes>
      </Activity>
    </>
  );
}

describe("GAP-007 team detail", () => {
  it("does not carry an unsaved draft to another team under the same user", async () => {
    getTeam.mockImplementation(async (id: string) => ({ team: id === "team-2" ? { ...captainTeam, id, name: "Вторая команда" } : captainTeam }));
    const user = userEvent.setup(); renderPage();
    await screen.findByDisplayValue("Ракетки");
    await user.clear(screen.getByLabelText("Название команды")); await user.type(screen.getByLabelText("Название команды"), "Черновик первой");
    await user.click(screen.getByText("other-team"));
    await screen.findByDisplayValue("Вторая команда");
    expect(screen.queryByDisplayValue("Черновик первой")).not.toBeInTheDocument();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    window.sessionStorage.clear();
    me.mockResolvedValue({
      user: {
        id: "u1",
        email: "captain@tab10.test",
        role: "user",
        mustChangePassword: false,
        firstName: "Первый",
        lastName: "Капитан",
      },
    });
    getTeam.mockResolvedValue({ team: captainTeam });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps an exact list origin across a reload-shaped remount", async () => {
    const navigationToken = "valid-team-a-token";
    window.sessionStorage.setItem("tab10.teams.return", JSON.stringify({
      userId: "u1",
      detailPath: "/teams/team-1",
      teamId: "team-1",
      scrollY: 320,
      navigationToken,
    }));
    const entry = {
      pathname: "/teams/team-1",
      state: { returnTo: "/teams", returnLabel: "К списку команд", teamsReturnToken: navigationToken },
    };

    const first = renderPage(entry);
    await screen.findByRole("heading", { name: "Ракетки" });
    expect(window.sessionStorage.getItem("tab10.teams.return")).not.toBeNull();

    first.unmount();
    renderPage(entry);
    await screen.findByRole("heading", { name: "Ракетки" });
    expect(window.sessionStorage.getItem("tab10.teams.return")).not.toBeNull();
  });

  it("clears a saved origin when the same team is opened directly", async () => {
    window.sessionStorage.setItem("tab10.teams.return", JSON.stringify({
      userId: "u1",
      detailPath: "/teams/team-1",
      teamId: "team-1",
      scrollY: 320,
      navigationToken: "stale-team-a-token",
    }));

    renderPage("/teams/team-1");
    await screen.findByRole("heading", { name: "Ракетки" });
    await waitFor(() => expect(window.sessionStorage.getItem("tab10.teams.return")).toBeNull());
  });

  it("clears team A origin when team B is opened with mismatched history state", async () => {
    const navigationToken = "team-a-token";
    window.sessionStorage.setItem("tab10.teams.return", JSON.stringify({
      userId: "u1",
      detailPath: "/teams/team-1",
      teamId: "team-1",
      scrollY: 320,
      navigationToken,
    }));

    renderPage({
      pathname: "/teams/team-2",
      state: { returnTo: "/teams", returnLabel: "К списку команд", teamsReturnToken: navigationToken },
    });
    await screen.findByRole("heading", { name: "Ракетки" });
    await waitFor(() => expect(window.sessionStorage.getItem("tab10.teams.return")).toBeNull());
  });

  it("clears a valid saved origin when the actor changes", async () => {
    const navigationToken = "actor-bound-token";
    window.sessionStorage.setItem("tab10.teams.return", JSON.stringify({
      userId: "u1",
      detailPath: "/teams/team-1",
      teamId: "team-1",
      scrollY: 320,
      navigationToken,
    }));
    const user = userEvent.setup();
    renderPage({
      pathname: "/teams/team-1",
      state: { returnTo: "/teams", returnLabel: "К списку команд", teamsReturnToken: navigationToken },
    });
    await screen.findByRole("heading", { name: "Ракетки" });
    expect(window.sessionStorage.getItem("tab10.teams.return")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "switch-actor" }));
    await waitFor(() => expect(window.sessionStorage.getItem("tab10.teams.return")).toBeNull());
  });

  it("shows welcome copy and lets only the captain edit team text", async () => {
    updateTeam.mockResolvedValue({
      team: { ...captainTeam, name: "Новые ракетки", slogan: "Новый слоган", avatarKey: "avatar_4" },
    });
    const user = userEvent.setup();
    renderPage("/teams/team-1?welcome=1");

    expect(await screen.findByRole("alert")).toHaveTextContent("Рады видеть в команде!");
    const form = screen.getByRole("form", { name: "Редактирование команды" });
    await user.clear(within(form).getByLabelText("Название команды"));
    await user.type(within(form).getByLabelText("Название команды"), "Новые ракетки");
    await user.clear(within(form).getByLabelText("Слоган"));
    await user.type(within(form).getByLabelText("Слоган"), "Новый слоган");
    await user.click(within(form).getByRole("radio", { name: "Аватар 4" }));
    await user.click(within(form).getByRole("button", { name: "Сохранить" }));

    expect(updateTeam).toHaveBeenCalledWith("team-1", {
      name: "Новые ракетки",
      slogan: "Новый слоган",
      welcomeText: "Рады видеть в команде!",
      avatarKey: "avatar_4",
    });
    expect(await screen.findByRole("heading", { name: "Новые ракетки" })).toBeInTheDocument();
    expect(within(form).getByRole("status").parentElement).toHaveFocus();
    expect(screen.queryByText(/загрузить аватар/i)).not.toBeInTheDocument();
  });

  it("keeps the settings draft local and uses GET-only review after an unknown PATCH", async () => {
    getTeam
      .mockResolvedValueOnce({ team: captainTeam })
      .mockResolvedValueOnce({ team: { ...captainTeam, slogan: "Серверный слоган", avatarKey: "avatar_5" } });
    updateTeam.mockRejectedValueOnce(new Error("Network lost"));
    const user = userEvent.setup();
    renderPage();

    const form = await screen.findByRole("form", { name: "Редактирование команды" });
    const name = within(form).getByLabelText("Название команды");
    await user.clear(name);
    await user.type(name, "Черновик капитана");
    await user.click(within(form).getByRole("radio", { name: "Аватар 6" }));
    await user.click(within(form).getByRole("button", { name: "Сохранить" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent("Не удалось проверить сохранение");
    expect(within(form).getByRole("alert").parentElement).toHaveFocus();
    expect(name).toHaveValue("Черновик капитана");
    expect(within(form).getByRole("radio", { name: "Аватар 6" })).toBeChecked();
    expect(within(form).getByRole("button", { name: "Сохранить" })).toBeDisabled();
    expect(updateTeam).toHaveBeenCalledTimes(1);
    await user.click(within(form).getByRole("button", { name: "Обновить данные" }));
    expect(getTeam).toHaveBeenCalledTimes(2);
    expect(updateTeam).toHaveBeenCalledTimes(1);
    expect(await within(form).findByText(/Сервер сейчас:.*Серверный слоган/)).toHaveTextContent("не подтверждение исхода");
    expect(within(form).getByText(/Сервер сейчас:/)).toHaveTextContent("аватар avatar_5");
    expect(name).toHaveValue("Черновик капитана");
    expect(within(form).getByRole("radio", { name: "Аватар 6" })).toBeChecked();
    expect(within(form).getByRole("button", { name: "Сохранить ещё раз" })).toBeEnabled();
  });

  it("keeps a documented settings rejection beside save and preserves the draft", async () => {
    updateTeam.mockRejectedValueOnce(Object.assign(new Error("Название занято"), { status: 400 }));
    const user = userEvent.setup();
    renderPage();

    const form = await screen.findByRole("form", { name: "Редактирование команды" });
    const name = within(form).getByLabelText("Название команды");
    await user.clear(name);
    await user.type(name, "Черновик капитана");
    await user.click(within(form).getByRole("button", { name: "Сохранить" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent("Название занято");
    expect(within(form).getByRole("alert").parentElement).toHaveFocus();
    expect(name).toHaveValue("Черновик капитана");
    expect(within(form).getByRole("button", { name: "Сохранить" })).toBeEnabled();
    expect(updateTeam).toHaveBeenCalledTimes(1);
  });

  it("serializes captain roster actions and keeps loaded context on failure", async () => {
    const pending = deferred<{ invitation: { id: string } }>();
    inviteTeamMember.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Ракетки" });

    await user.selectOptions(screen.getByLabelText("Пригласить пользователя"), "u3");
    const invite = screen.getByRole("button", { name: "Пригласить" });
    await user.dblClick(invite);
    expect(inviteTeamMember).toHaveBeenCalledTimes(1);
    expect(inviteTeamMember).toHaveBeenCalledWith("team-1", "u3");
    expect(within(screen.getByRole("region", { name: "Приглашение в команду" })).getByRole("button", { name: /приглашаем/i })).toBeDisabled();
    await act(async () => {
      pending.resolve({ invitation: { id: "invite-1" } });
      await pending.promise;
    });
    await waitFor(() => expect(
      screen.getByRole("button", { name: "Действия с Второй Игрок" }),
    ).toBeEnabled());

    removeTeamMember.mockRejectedValueOnce(Object.assign(new Error("Участник занят"), { status: 409 }));
    await user.click(screen.getByRole("button", { name: "Действия с Второй Игрок" }));
    await user.click(screen.getByRole("button", { name: "Исключить участника" }));
    const removeDialog = screen.getByRole("dialog");
    expect(removeDialog).toHaveTextContent("Исключить Второй Игрок из команды?");
    expect(within(removeDialog).getByRole("button", { name: "Отмена" })).toHaveFocus();
    expect(removeTeamMember).not.toHaveBeenCalled();
    await user.click(within(removeDialog).getByRole("button", { name: "Исключить участника" }));
    expect(await within(removeDialog).findByRole("alert")).toHaveTextContent("Участник занят");
    expect(screen.getByRole("heading", { name: "Ракетки" })).toBeInTheDocument();
    expect(screen.getByText("Второй Игрок")).toBeInTheDocument();
    await user.click(within(removeDialog).getByRole("button", { name: "Отмена" }));

    transferTeamCaptain.mockResolvedValueOnce({
      team: {
        ...captainTeam,
        captainUserId: "u2",
        isCaptain: false,
      },
    });
    await user.click(screen.getByRole("button", { name: "Передать капитанство" }));
    const transferDialog = screen.getByRole("dialog");
    expect(transferTeamCaptain).not.toHaveBeenCalled();
    await user.click(within(transferDialog).getByRole("button", { name: "Передать капитанство" }));
    expect(transferTeamCaptain).toHaveBeenCalledWith("team-1", "u2");
    expect(
      await screen.findByText("Капитанство передано."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: "Редактирование команды" }),
    ).not.toBeInTheDocument();
  });

  it("uses named cancelable confirmations and blocks close/repeat while pending", async () => {
    const transfer = deferred<{ team: typeof captainTeam }>();
    transferTeamCaptain.mockReturnValueOnce(transfer.promise);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Ракетки" });

    const actions = screen.getByRole("button", { name: "Действия с Второй Игрок" });
    await user.click(actions);
    await user.click(screen.getByRole("button", { name: "Исключить участника" }));
    let dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Исторические матчи и турниры сохранятся");
    await user.click(within(dialog).getByRole("button", { name: "Отмена" }));
    expect(removeTeamMember).not.toHaveBeenCalled();
    await waitFor(() => expect(actions).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Исключить участника" }));
    await user.keyboard("{Escape}");
    expect(removeTeamMember).not.toHaveBeenCalled();
    await waitFor(() => expect(actions).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Передать капитанство" }));
    dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Вы останетесь участником");
    await user.click(within(dialog).getByRole("button", { name: "Передать капитанство" }));
    expect(transferTeamCaptain).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole("button", { name: "Отмена" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Выполняем…" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(transferTeamCaptain).toHaveBeenCalledTimes(1);

    await act(async () => transfer.resolve({
      team: { ...captainTeam, captainUserId: "u2", isCaptain: false },
    }));
    expect(await screen.findByRole("heading", { name: "Участники" })).toHaveFocus();
    expect(screen.queryByRole("form", { name: "Редактирование команды" })).not.toBeInTheDocument();
  });

  it("uses GET-only roster review after an unknown member action", async () => {
    getTeam
      .mockResolvedValueOnce({ team: captainTeam })
      .mockResolvedValueOnce({
        team: { ...captainTeam, members: captainTeam.members.filter((member) => member.userId !== "u2") },
      });
    removeTeamMember.mockRejectedValueOnce(new Error("Network lost"));
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Ракетки" });

    await user.click(screen.getByRole("button", { name: "Действия с Второй Игрок" }));
    await user.click(screen.getByRole("button", { name: "Исключить участника" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Исключить участника" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Не удалось подтвердить изменение");
    expect(within(dialog).getByRole("button", { name: "Исключить участника" })).toBeDisabled();
    expect(removeTeamMember).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole("button", { name: "Обновить состав" }));
    expect(getTeam).toHaveBeenCalledTimes(2);
    expect(removeTeamMember).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "Участники" })).toHaveFocus();
    expect(screen.queryByText("Второй Игрок")).not.toBeInTheDocument();
  });

  it("keeps invitees and former members read-only without captain controls", async () => {
    getTeam.mockResolvedValue({
      team: { ...captainTeam, isCaptain: false, isMember: false },
    });
    renderPage();
    expect(await screen.findByRole("heading", { name: "Ракетки" })).toBeInTheDocument();
    expect(screen.getByText("Второй Игрок")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /действия с/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Редактирование команды" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Выйти из команды" })).not.toBeInTheDocument();
  });

  it("shows member leave, blocks captain leave, and hides captain controls from members", async () => {
    me.mockResolvedValue({
      user: { id: "u2", email: "member@tab10.test", role: "user", mustChangePassword: false },
    });
    getTeam.mockResolvedValue({
      team: { ...captainTeam, isCaptain: false, isMember: true },
    });
    leaveTeam.mockResolvedValue({
      team: { ...captainTeam, isCaptain: false, isMember: false, members: captainTeam.members.slice(0, 1) },
    });
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "Ракетки" });
    expect(screen.queryByRole("form", { name: "Редактирование команды" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Выйти из команды" }));
    expect(leaveTeam).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("Выйти из команды?");
    await user.click(screen.getByRole("button", { name: "Подтвердить выход" }));
    expect(leaveTeam).toHaveBeenCalledWith("team-1");

    cleanup();
    me.mockResolvedValue({ user: { id: "u1", email: "captain@tab10.test", role: "user", mustChangePassword: false } });
    getTeam.mockResolvedValue({ team: captainTeam });
    renderPage();
    expect(await screen.findByRole("button", { name: "Выйти из команды" })).toBeDisabled();
    expect(screen.getByText(/сначала передайте капитанство/i)).toBeInTheDocument();
  });

  it("renders archived teams read-only", async () => {
    getTeam.mockResolvedValue({
      team: {
        ...captainTeam,
        status: "archived",
        archivedAt: "2026-09-10T10:00:00.000Z",
        members: [],
      },
    });
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(/архив/i);
    expect(screen.getByText(/не осталось участников/i)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Редактирование команды" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /исключить/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /передать капитанство/i })).not.toBeInTheDocument();
  });

  it("shows a retryable initial error", async () => {
    getTeam
      .mockRejectedValueOnce(new Error("Команда недоступна"))
      .mockResolvedValueOnce({ team: captainTeam });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Команда недоступна");
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByRole("heading", { name: "Ракетки" })).toBeInTheDocument();
  });

  it("does not let an older refresh overwrite a completed captain transfer", async () => {
    const staleRefresh = deferred<{ team: typeof captainTeam }>();
    getTeam.mockResolvedValueOnce({ team: captainTeam }).mockReturnValueOnce(staleRefresh.promise);
    const transfer = deferred<{ team: typeof captainTeam }>();
    transferTeamCaptain.mockReturnValueOnce(transfer.promise);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Ракетки" });
    await user.click(screen.getByRole("button", { name: "Обновить" }));
    await user.click(screen.getByRole("button", { name: "Действия с Второй Игрок" }));
    await user.click(screen.getByRole("button", { name: "Передать капитанство" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Передать капитанство" }));
    const transferred = { ...captainTeam, captainUserId: "u2", isCaptain: false };
    await act(async () => transfer.resolve({ team: transferred }));
    await act(async () => staleRefresh.resolve({ team: captainTeam }));
    expect(screen.queryByRole("form", { name: "Редактирование команды" })).not.toBeInTheDocument();
  });

  it("allows reinviting a user whose persisted pending invitation is past TTL", async () => {
    getTeam.mockResolvedValue({
      team: {
        ...captainTeam,
        invitations: [{
          id: "expired-pending",
          invitedUserId: "u3",
          displayName: "Третий Игрок",
          status: "pending",
          expiresAt: "2020-01-01T00:00:00.000Z",
          respondedAt: null,
        }],
      },
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Ракетки" });
    await user.selectOptions(screen.getByLabelText("Пригласить пользователя"), "u3");
    expect(screen.getByLabelText("Пригласить пользователя")).toHaveValue("u3");
  });

  it("shows captain invitation history with a friendly name and localized status", async () => {
    getTeam.mockResolvedValue({
      team: {
        ...captainTeam,
        invitations: [{
          id: "invite-history",
          invitedUserId: "u3",
          displayName: "Третий Игрок",
          status: "declined",
          expiresAt: "2026-10-01T00:00:00.000Z",
          respondedAt: "2026-09-13T09:00:00.000Z",
        }],
      },
    });
    renderPage();
    expect(await screen.findByText(/Третий Игрок.*Отклонено/)).toBeInTheDocument();
    expect(screen.queryByText(/u3.*declined/)).not.toBeInTheDocument();
  });

  it("reloads authority after same-user reauthentication without losing an unsaved draft", async () => {
    getTeam
      .mockResolvedValueOnce({ team: captainTeam })
      .mockResolvedValueOnce({ team: { ...captainTeam, slogan: "Сервер обновился" } });
    const user = userEvent.setup();
    renderPage();
    const name = await screen.findByLabelText("Название команды");
    await user.clear(name);
    await user.type(name, "Черновик капитана");
    await user.click(screen.getByRole("button", { name: "expire-session" }));
    await user.click(screen.getByRole("button", { name: "restore-session" }));
    await screen.findByText("Сервер обновился");
    expect(screen.getByLabelText("Название команды")).toHaveValue("Черновик капитана");
    expect(getTeam).toHaveBeenCalledTimes(2);
  });

  it("turns an interrupted same-user save into review without replaying it", async () => {
    const pending = deferred<{ team: typeof captainTeam }>();
    updateTeam.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    renderPage();
    const name = await screen.findByLabelText("Название команды");
    await user.clear(name);
    await user.type(name, "Черновик после 401");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await user.click(screen.getByRole("button", { name: "expire-session" }));
    await user.click(screen.getByRole("button", { name: "restore-session" }));
    const form = await screen.findByRole("form", { name: "Редактирование команды" });
    expect(await within(form).findByRole("alert")).toHaveTextContent("Не удалось проверить сохранение");
    expect(within(form).getByLabelText("Название команды")).toHaveValue("Черновик после 401");
    expect(updateTeam).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve({ team: { ...captainTeam, name: "Поздний ответ" } }));
    expect(screen.queryByRole("heading", { name: "Поздний ответ" })).not.toBeInTheDocument();
    expect(updateTeam).toHaveBeenCalledTimes(1);
  });

  it("does not let a late Activity save clear or overwrite a newer save", async () => {
    const first = deferred<{ team: typeof captainTeam }>();
    const second = deferred<{ team: typeof captainTeam }>();
    getTeam.mockResolvedValue({ team: captainTeam });
    updateTeam.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/teams/team-1"]}>
        <AuthProvider>
          <ActivityTeamPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    const name = await screen.findByLabelText("Название команды");
    await user.clear(name);
    await user.type(name, "Первая попытка");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await user.click(screen.getByRole("button", { name: "hide-activity" }));
    await user.click(screen.getByRole("button", { name: "show-activity" }));

    const form = await screen.findByRole("form", { name: "Редактирование команды" });
    expect(await within(form).findByRole("alert")).toHaveTextContent("Не удалось проверить сохранение");
    await waitFor(() => expect(within(form).getByRole("button", { name: "Сохранить ещё раз" })).toBeEnabled());
    await user.clear(within(form).getByLabelText("Название команды"));
    await user.type(within(form).getByLabelText("Название команды"), "Вторая попытка");
    await user.click(within(form).getByRole("button", { name: "Сохранить ещё раз" }));
    expect(updateTeam).toHaveBeenCalledTimes(2);
    expect(within(form).getByLabelText("Название команды")).toBeDisabled();

    await act(async () => first.resolve({ team: { ...captainTeam, name: "Старый ответ" } }));
    expect(within(form).getByLabelText("Название команды")).toBeDisabled();
    expect(screen.queryByRole("heading", { name: "Старый ответ" })).not.toBeInTheDocument();
    await act(async () => second.resolve({ team: { ...captainTeam, name: "Вторая попытка" } }));
    expect(await screen.findByRole("heading", { name: "Вторая попытка" })).toBeInTheDocument();
  });
});
