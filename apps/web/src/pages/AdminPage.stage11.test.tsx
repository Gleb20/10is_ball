import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "./AdminPage";
import { TaskNavigation } from "../layout";
import type { AdminUser } from "../api";

const mocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUserRole: vi.fn(),
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
  resetPassword: vi.fn(),
  openPasswordReset: vi.fn(),
  passwordResetEnabled: false,
  currentUser: {
    id: "00000000-0000-4000-8000-000000001101",
    email: "admin@example.test",
    role: "admin" as const,
    mustChangePassword: false,
  } as { id: string; email: string; role: "admin"; mustChangePassword: boolean } | null,
  reauthRequired: false,
}));

vi.mock("../auth", () => ({
  useAuth: () => ({ user: mocks.currentUser, reauthRequired: mocks.reauthRequired }),
}));
vi.mock("../api", () => ({
  api: {
    listUsers: (...args: unknown[]) => mocks.listUsers(...args),
    createUser: (...args: unknown[]) => mocks.createUser(...args),
    updateUserRole: (...args: unknown[]) => mocks.updateUserRole(...args),
    blockUser: (...args: unknown[]) => mocks.blockUser(...args),
    unblockUser: (...args: unknown[]) => mocks.unblockUser(...args),
    resetPassword: (...args: unknown[]) => mocks.resetPassword(...args),
  },
}));
vi.mock("../adminPasswordReset", () => ({
  useAdminPasswordReset: () => ({
    enabled: mocks.passwordResetEnabled,
    open: mocks.openPasswordReset,
  }),
}));

const admin: AdminUser = {
  id: "00000000-0000-4000-8000-000000001101",
  email: "admin@example.test",
  firstName: "Анна",
  lastName: "Админова",
  role: "admin",
  status: "active",
  mustChangePassword: false,
  birthDate: null,
  organizationText: null,
  positionText: null,
  createdAt: "2026-01-02T10:00:00.000Z",
  lastLoginAt: null,
};
const player: AdminUser = {
  ...admin,
  id: "00000000-0000-4000-8000-000000001102",
  email: "player@example.test",
  firstName: "Борис",
  lastName: "Игроков",
  role: "user",
  lastLoginAt: "2026-02-03T10:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function page() {
  return <MemoryRouter><AdminPage /></MemoryRouter>;
}

describe("Stage 11 admin directory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mocks.currentUser = {
      id: admin.id,
      email: admin.email,
      role: "admin",
      mustChangePassword: false,
    };
    mocks.reauthRequired = false;
    mocks.passwordResetEnabled = false;
    mocks.listUsers.mockResolvedValue({ users: [admin, player] });
    mocks.createUser.mockResolvedValue({ user: player, temporaryPassword: "OneTime1!" });
    mocks.resetPassword.mockResolvedValue({ temporaryPassword: "Reset1!" });
  });

  it("routes an enabled password reset through the Stage 12 controller", async () => {
    const user = userEvent.setup();
    mocks.passwordResetEnabled = true;
    render(page());
    const triggers = await screen.findAllByRole("button", { name: "Действия" });
    await user.click(triggers[1]!);
    await user.click(screen.getByRole("button", { name: "Сбросить пароль" }));

    expect(mocks.openPasswordReset).toHaveBeenCalledOnce();
    expect(mocks.openPasswordReset).toHaveBeenCalledWith(player);
    expect(screen.queryByRole("dialog", { name: "Сбросить пароль?" })).toBeNull();
  });

  it("starts with search, result count and rows while creation is secondary", async () => {
    const user = userEvent.setup();
    render(page());
    const search = screen.getByRole("search", { name: "Поиск пользователей" });
    expect(await screen.findByText("Найдено: 2")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Создание пользователя" })).toBeNull();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.getByRole("link", { name: "Игроков Борис" })).toHaveAttribute(
      "href",
      `/admin/users/${player.id}`,
    );
    expect(search.compareDocumentPosition(screen.getByText("Найдено: 2")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const add = screen.getByRole("button", { name: "Добавить пользователя" });
    expect(add).toHaveAttribute("aria-expanded", "false");
    await user.click(add);
    expect(screen.getByRole("form", { name: "Создание пользователя" })).toBeInTheDocument();
    expect(add).toHaveAttribute("aria-expanded", "true");
  });

  it("restores filtered catalog context, scroll and row focus after account Back with fresh data", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    Object.defineProperty(window, "scrollY", { configurable: true, value: 240 });
    render(<MemoryRouter initialEntries={["/admin"]}><Routes>
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/admin/users/:id" element={<><TaskNavigation userId={mocks.currentUser?.id} isAdmin={mocks.currentUser?.role === "admin"} /><p>Карточка аккаунта</p></>} />
    </Routes></MemoryRouter>);
    await screen.findByText("Найдено: 2");
    const search = screen.getByRole("search", { name: "Поиск пользователей" });
    await user.type(within(search).getByLabelText("Имя или email"), "Борис");
    await user.click(within(search).getByRole("button", { name: "Найти" }));
    await user.click(screen.getByRole("link", { name: "Игроков Борис" }));
    expect(await screen.findByText("Карточка аккаунта")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "К пользователям" }));
    expect(await screen.findByDisplayValue("Борис")).toBeInTheDocument();
    await waitFor(() => expect(mocks.listUsers).toHaveBeenLastCalledWith("Борис", undefined));
    const restoredLink = await screen.findByRole("link", { name: "Игроков Борис" });
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 240));
    await waitFor(() => expect(restoredLink).toHaveFocus());
    scrollTo.mockRestore();
  });

  it("does not restore another admin's catalog context", async () => {
    window.sessionStorage.setItem("tab10.admin.return", JSON.stringify({
      v: 1,
      userId: admin.id,
      detailPath: `/admin/users/${player.id}`,
      queryInput: "Чужой запрос",
      appliedQuery: "Чужой запрос",
      status: "blocked",
      scrollY: 200,
      focusUserId: player.id,
    }));
    mocks.currentUser = {
      id: "00000000-0000-4000-8000-000000001199",
      email: "other-admin@example.test",
      role: "admin",
      mustChangePassword: false,
    };
    render(page());
    await screen.findByText("Найдено: 2");
    expect(screen.getByLabelText("Имя или email")).toHaveValue("");
    expect(mocks.listUsers).toHaveBeenLastCalledWith(undefined, undefined);
    expect(window.sessionStorage.getItem("tab10.admin.return")).toBeNull();
  });

  it("asks before discarding a non-empty creation draft", async () => {
    const user = userEvent.setup();
    render(page());
    await screen.findByText("Найдено: 2");
    await user.click(screen.getByRole("button", { name: "Добавить пользователя" }));
    await user.type(screen.getByLabelText("Email"), "draft@example.test");
    await user.click(screen.getByRole("button", { name: "Закрыть" }));
    const dialog = screen.getByRole("dialog", { name: "Закрыть форму?" });
    await user.click(within(dialog).getByRole("button", { name: "Продолжить заполнение" }));
    expect(screen.getByDisplayValue("draft@example.test")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Закрыть" }));
    await user.click(within(screen.getByRole("dialog", { name: "Закрыть форму?" })).getByRole("button", { name: "Удалить черновик" }));
    expect(screen.queryByRole("form", { name: "Создание пользователя" })).toBeNull();
  });

  it("keeps one action group open and Escape returns focus to its trigger", async () => {
    const user = userEvent.setup();
    render(page());
    const triggers = await screen.findAllByRole("button", { name: "Действия" });
    await user.click(triggers[0]!);
    expect(screen.getByRole("group", { name: `Действия: ${admin.lastName} ${admin.firstName}` })).toBeInTheDocument();
    await user.click(triggers[1]!);
    expect(screen.queryByRole("group", { name: `Действия: ${admin.lastName} ${admin.firstName}` })).toBeNull();
    const group = screen.getByRole("group", { name: `Действия: ${player.lastName} ${player.firstName}` });
    const block = within(group).getByRole("button", { name: "Заблокировать" });
    block.focus();
    fireEvent.keyDown(block, { key: "Escape" });
    expect(screen.queryByRole("group", { name: `Действия: ${player.lastName} ${player.firstName}` })).toBeNull();
    expect(triggers[1]).toHaveFocus();
  });

  it("does not apply a late mutation result after React Activity reauth invalidates the actor context", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ ok: boolean }>();
    mocks.blockUser.mockImplementation(() => pending.promise);
    const view = render(page());
    const triggers = await screen.findAllByRole("button", { name: "Действия" });
    await user.click(triggers[1]!);
    await user.click(screen.getByRole("button", { name: "Заблокировать" }));
    await user.click(screen.getByRole("button", { name: "Подтвердить" }));

    mocks.currentUser = null;
    mocks.reauthRequired = true;
    view.rerender(page());
    pending.resolve({ ok: true });
    await waitFor(() => expect(mocks.blockUser).toHaveBeenCalledTimes(1));

    mocks.currentUser = {
      id: admin.id,
      email: admin.email,
      role: "admin",
      mustChangePassword: false,
    };
    mocks.reauthRequired = false;
    view.rerender(page());
    await screen.findByText("Найдено: 2");
  });

  it("drops a late mutation error and finally after React Activity changes actor context", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ ok: boolean }>();
    mocks.blockUser.mockImplementation(() => pending.promise);
    const view = render(page());
    const triggers = await screen.findAllByRole("button", { name: "Действия" });
    await user.click(triggers[1]!);
    await user.click(screen.getByRole("button", { name: "Заблокировать" }));
    await user.click(screen.getByRole("button", { name: "Подтвердить" }));
    mocks.currentUser = null; mocks.reauthRequired = true; view.rerender(page());
    pending.reject(new Error("Старая ошибка мутации"));
    await waitFor(() => expect(mocks.blockUser).toHaveBeenCalledTimes(1));
    mocks.currentUser = { id: admin.id, email: admin.email, role: "admin", mustChangePassword: false };
    mocks.reauthRequired = false; view.rerender(page());
    await screen.findByText("Найдено: 2");
    expect(screen.queryByText("Старая ошибка мутации")).toBeNull();
    expect((await screen.findAllByRole("button", { name: "Действия" }))[1]).not.toBeDisabled();
  });
});
