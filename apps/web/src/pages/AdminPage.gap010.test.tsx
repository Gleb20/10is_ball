import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "./AdminPage";
import type { AdminUser } from "../api";

const mocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUserRole: vi.fn(),
  updateAdminUser: vi.fn(),
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
  resetPassword: vi.fn(),
  currentUser: {
    id: "admin-1",
    email: "admin@example.test",
    role: "admin" as const,
    mustChangePassword: false,
  } as { id: string; email: string; role: "admin"; mustChangePassword: boolean } | null,
  reauthRequired: false,
}));

vi.mock("../auth", () => ({ useAuth: () => ({ user: mocks.currentUser, reauthRequired: mocks.reauthRequired }) }));
vi.mock("../api", () => ({
  api: {
    listUsers: (...args: unknown[]) => mocks.listUsers(...args),
    createUser: (...args: unknown[]) => mocks.createUser(...args),
    updateUserRole: (...args: unknown[]) => mocks.updateUserRole(...args),
    updateAdminUser: (...args: unknown[]) => mocks.updateAdminUser(...args),
    blockUser: (...args: unknown[]) => mocks.blockUser(...args),
    unblockUser: (...args: unknown[]) => mocks.unblockUser(...args),
    resetPassword: (...args: unknown[]) => mocks.resetPassword(...args),
  },
}));

const adminUser: AdminUser = {
  id: "admin-1",
  email: "admin@example.test",
  firstName: "Анна",
  lastName: "Админова",
  role: "admin" as const,
  status: "active" as const,
  mustChangePassword: false,
  birthDate: "1990-05-10",
  organizationText: "Клуб",
  positionText: "Тренер",
  createdAt: "2026-01-02T10:00:00.000Z",
  lastLoginAt: null,
};

const playerUser: AdminUser = {
  ...adminUser,
  id: "user-2",
  email: "player@example.test",
  firstName: "Борис",
  lastName: "Игроков",
  role: "user" as const,
  birthDate: null,
  organizationText: null,
  positionText: null,
  lastLoginAt: "2026-02-03T10:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>,
  );
}

describe("GAP-010 admin user catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser = {
      id: "admin-1",
      email: "admin@example.test",
      role: "admin",
      mustChangePassword: false,
    };
    mocks.reauthRequired = false;
    mocks.listUsers.mockResolvedValue({ users: [adminUser, playerUser] });
    mocks.updateAdminUser.mockResolvedValue({ user: playerUser });
  });

  it("ADM-002 keeps the latest search/filter result and displays account dates", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("player@example.test · user")).toBeInTheDocument();
    expect(screen.getByText("Ещё не входил")).toBeInTheDocument();

    const slow = deferred<{ users: typeof playerUser[] }>();
    const fast = deferred<{ users: typeof playerUser[] }>();
    mocks.listUsers.mockImplementation((_q?: string, status?: string) =>
      status === "blocked" ? fast.promise : slow.promise,
    );

    const search = screen.getByRole("search", { name: "Поиск пользователей" });
    await user.clear(within(search).getByLabelText("Имя или email"));
    await user.type(within(search).getByLabelText("Имя или email"), "Борис");
    await user.click(within(search).getByRole("button", { name: "Найти" }));
    await user.selectOptions(within(search).getByLabelText("Статус"), "blocked");

    fast.resolve({ users: [{ ...playerUser, id: "blocked-3", email: "blocked@example.test", status: "blocked" }] });
    expect(await screen.findByText("blocked@example.test · user")).toBeInTheDocument();
    slow.resolve({ users: [{ ...playerUser, id: "stale-4", email: "stale@example.test" }] });
    await waitFor(() => expect(screen.queryByText("stale@example.test · user")).toBeNull());
    expect(mocks.listUsers).toHaveBeenLastCalledWith("Борис", "blocked");
  });

  it("ADM-004 edits a stable target, keeps email readonly and maps empty nullable fields to null", async () => {
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText("player@example.test · user")).closest(".list-row") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Редактировать" }));

    const dialog = screen.getByRole("dialog", { name: "Профиль пользователя" });
    expect(within(dialog).getByLabelText("Email")).toHaveAttribute("readonly");
    fireEvent.change(within(dialog).getByLabelText("Имя"), { target: { value: "Борислав" } });
    fireEvent.change(within(dialog).getByLabelText("Дата рождения"), { target: { value: "2000-02-29" } });
    await user.clear(within(dialog).getByLabelText("Организация"));
    await user.clear(within(dialog).getByLabelText("Должность"));
    await user.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    expect(mocks.updateAdminUser).toHaveBeenCalledWith("user-2", {
      firstName: "Борислав",
      lastName: "Игроков",
      birthDate: "2000-02-29",
      organizationText: null,
      positionText: null,
    });
  });

  it("keeps a saved profile newer than an earlier catalog response", async () => {
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText("player@example.test · user")).closest(".list-row") as HTMLElement;
    const staleLoad = deferred<{ users: AdminUser[] }>();
    const refreshedLoad = deferred<{ users: AdminUser[] }>();
    mocks.listUsers
      .mockImplementationOnce(() => staleLoad.promise)
      .mockImplementationOnce(() => refreshedLoad.promise);
    const updatedPlayer = { ...playerUser, firstName: "Борислав" };
    mocks.updateAdminUser.mockResolvedValue({ user: updatedPlayer });

    await user.click(screen.getByRole("button", { name: "Найти" }));
    await user.click(within(row).getByRole("button", { name: "Редактировать" }));
    const dialog = screen.getByRole("dialog", { name: "Профиль пользователя" });
    fireEvent.change(within(dialog).getByLabelText("Имя"), { target: { value: "Борислав" } });
    await user.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(mocks.listUsers).toHaveBeenCalledTimes(3));
    refreshedLoad.resolve({ users: [adminUser, updatedPlayer] });
    expect(await screen.findByText("Игроков Борислав")).toBeInTheDocument();
    staleLoad.resolve({ users: [adminUser, playerUser] });
    await waitFor(() => expect(screen.queryByText("Игроков Борис")).toBeNull());
    expect(screen.getByText("Игроков Борислав")).toBeInTheDocument();
  });

  it("validates profile edits, serializes all admin mutations, and preserves loaded context on failure", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ user: typeof playerUser }>();
    mocks.updateAdminUser.mockImplementation(() => pending.promise);
    renderPage();
    const row = (await screen.findByText("player@example.test · user")).closest(".list-row") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Редактировать" }));
    const dialog = screen.getByRole("dialog", { name: "Профиль пользователя" });

    await user.clear(within(dialog).getByLabelText("Имя"));
    await user.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Укажите имя и фамилию");
    expect(mocks.updateAdminUser).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText("Имя"), { target: { value: "Борис" } });
    const save = within(dialog).getByRole("button", { name: "Сохранить" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mocks.updateAdminUser).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Создание…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Найти" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Статус" })).toBeDisabled();

    pending.reject(new Error("Профиль не сохранён"));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Профиль не сохранён");
    expect(screen.getByText("player@example.test · user")).toBeInTheDocument();
  });

  it("keeps a typed profile draft across a 401 and same-actor reload", async () => {
    const user = userEvent.setup();
    const unauthorized = Object.assign(new Error("Требуется вход"), { status: 401 });
    mocks.updateAdminUser.mockRejectedValue(unauthorized);
    const view = renderPage();
    const row = (await screen.findByText("player@example.test · user")).closest(".list-row") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Редактировать" }));
    const name = within(screen.getByRole("dialog", { name: "Профиль пользователя" })).getByLabelText("Имя");
    fireEvent.change(name, { target: { value: "Черновик" } });
    expect(screen.getByDisplayValue("Черновик")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    mocks.currentUser = null;
    mocks.reauthRequired = true;
    view.rerender(<MemoryRouter><AdminPage /></MemoryRouter>);
    mocks.currentUser = { id: "admin-1", email: "admin@example.test", role: "admin", mustChangePassword: false };
    mocks.reauthRequired = false;
    view.rerender(<MemoryRouter><AdminPage /></MemoryRouter>);
    expect(await screen.findByDisplayValue("Черновик")).toBeInTheDocument();
    expect(screen.queryByText("Требуется вход")).toBeNull();
  });

  it("shows an initial load error with retry and a filtered empty state", async () => {
    const user = userEvent.setup();
    mocks.listUsers.mockRejectedValueOnce(new Error("Каталог недоступен")).mockResolvedValueOnce({ users: [] });
    renderPage();
    expect(await screen.findByText("Каталог недоступен")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Пользователи не найдены")).toBeInTheDocument();
  });
});
