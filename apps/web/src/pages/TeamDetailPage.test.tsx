import { act, cleanup, render, screen, within } from "@testing-library/react";
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
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function AuthControl() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate("/teams/team-2")}>other-team</button>
      <button onClick={() => setUser(null)}>expire-session</button>
      <button onClick={() => setUser({ id: "u1", role: "user", mustChangePassword: false } as never)}>restore-session</button>
    </>
  );
}

function renderPage(path = "/teams/team-1") {
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
    vi.clearAllMocks();
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
  afterEach(() => cleanup());

  it("shows welcome copy and lets only the captain edit team text", async () => {
    updateTeam.mockResolvedValue({
      team: { ...captainTeam, name: "Новые ракетки", slogan: "Новый слоган" },
    });
    const user = userEvent.setup();
    renderPage("/teams/team-1?welcome=1");

    expect(await screen.findByRole("alert")).toHaveTextContent("Рады видеть в команде!");
    const form = screen.getByRole("form", { name: "Редактирование команды" });
    await user.clear(within(form).getByLabelText("Название команды"));
    await user.type(within(form).getByLabelText("Название команды"), "Новые ракетки");
    await user.clear(within(form).getByLabelText("Слоган"));
    await user.type(within(form).getByLabelText("Слоган"), "Новый слоган");
    await user.click(within(form).getByRole("button", { name: "Сохранить" }));

    expect(updateTeam).toHaveBeenCalledWith("team-1", {
      name: "Новые ракетки",
      slogan: "Новый слоган",
      welcomeText: "Рады видеть в команде!",
    });
    expect(await screen.findByRole("heading", { name: "Новые ракетки" })).toBeInTheDocument();
    expect(screen.queryByText(/загрузить аватар/i)).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /приглашаем/i })).toBeDisabled();
    await act(async () => {
      pending.resolve({ invitation: { id: "invite-1" } });
      await pending.promise;
    });

    removeTeamMember.mockRejectedValueOnce(new Error("Участник занят"));
    await user.click(screen.getByRole("button", { name: "Исключить Второй Игрок" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Участник занят");
    expect(screen.getByRole("heading", { name: "Ракетки" })).toBeInTheDocument();
    expect(screen.getByText("Второй Игрок")).toBeInTheDocument();

    transferTeamCaptain.mockResolvedValueOnce({
      team: {
        ...captainTeam,
        captainUserId: "u2",
        isCaptain: false,
      },
    });
    await user.click(
      screen.getByRole("button", {
        name: "Передать капитанство Второй Игрок",
      }),
    );
    expect(transferTeamCaptain).toHaveBeenCalledWith("team-1", "u2");
    expect(
      await screen.findByText("Капитанство передано."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: "Редактирование команды" }),
    ).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Передать капитанство Второй Игрок" }));
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
});
