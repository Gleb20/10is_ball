import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "./AdminPage";
import type { AdminUser } from "../api";

const mocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUserRole: vi.fn(),
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
  resetPassword: vi.fn(),
  currentUser: {
    id: "admin-1", email: "admin@example.test", role: "admin" as const, mustChangePassword: false,
  } as { id: string; email: string; role: "admin"; mustChangePassword: boolean } | null,
  reauthRequired: false,
}));

vi.mock("../auth", () => ({ useAuth: () => ({ user: mocks.currentUser, reauthRequired: mocks.reauthRequired }) }));
vi.mock("../api", () => ({ api: {
  listUsers: (...args: unknown[]) => mocks.listUsers(...args),
  createUser: (...args: unknown[]) => mocks.createUser(...args),
  updateUserRole: (...args: unknown[]) => mocks.updateUserRole(...args),
  blockUser: (...args: unknown[]) => mocks.blockUser(...args),
  unblockUser: (...args: unknown[]) => mocks.unblockUser(...args),
  resetPassword: (...args: unknown[]) => mocks.resetPassword(...args),
} }));

const adminUser: AdminUser = {
  id: "admin-1", email: "admin@example.test", firstName: "Анна", lastName: "Админова",
  role: "admin", status: "active", mustChangePassword: false, birthDate: "1990-05-10",
  organizationText: "Клуб", positionText: "Тренер", createdAt: "2026-01-02T10:00:00.000Z", lastLoginAt: null,
};
const playerUser: AdminUser = {
  ...adminUser, id: "user-2", email: "player@example.test", firstName: "Борис", lastName: "Игроков",
  role: "user", birthDate: null, organizationText: null, positionText: null, lastLoginAt: "2026-02-03T10:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
const renderPage = () => render(<MemoryRouter><AdminPage /></MemoryRouter>);

describe("GAP-010 admin user catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser = { id: "admin-1", email: "admin@example.test", role: "admin", mustChangePassword: false };
    mocks.reauthRequired = false;
    mocks.listUsers.mockResolvedValue({ users: [adminUser, playerUser] });
  });

  it("ADM-002 keeps the latest search/filter result and displays account dates", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("player@example.test · user")).toBeInTheDocument();
    expect(screen.getByText("Ещё не входил")).toBeInTheDocument();
    const slow = deferred<{ users: AdminUser[] }>();
    const fast = deferred<{ users: AdminUser[] }>();
    mocks.listUsers.mockImplementation((_q?: string, status?: string) => status === "blocked" ? fast.promise : slow.promise);
    const search = screen.getByRole("search", { name: "Поиск пользователей" });
    await user.type(within(search).getByLabelText("Имя или email"), "Борис");
    await user.click(within(search).getByRole("button", { name: "Найти" }));
    await user.selectOptions(within(search).getByLabelText("Статус"), "blocked");
    fast.resolve({ users: [{ ...playerUser, id: "blocked-3", email: "blocked@example.test", status: "blocked" }] });
    expect(await screen.findByText("blocked@example.test · user")).toBeInTheDocument();
    slow.resolve({ users: [{ ...playerUser, id: "stale-4", email: "stale@example.test" }] });
    await waitFor(() => expect(screen.queryByText("stale@example.test · user")).toBeNull());
    expect(mocks.listUsers).toHaveBeenLastCalledWith("Борис", "blocked");
  });

  it("ADM-004 uses a stable detail link and keeps profile editing out of catalog rows", async () => {
    renderPage();
    const row = (await screen.findByText("player@example.test · user")).closest(".list-row") as HTMLElement;
    expect(within(row).getByRole("link", { name: "Игроков Борис" })).toHaveAttribute("href", "/admin/users/user-2");
    expect(within(row).queryByRole("button", { name: "Редактировать" })).toBeNull();
  });

  it("keeps a newer filtered catalog response after an older request finishes", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("player@example.test · user");
    const older = deferred<{ users: AdminUser[] }>();
    const newer = deferred<{ users: AdminUser[] }>();
    mocks.listUsers.mockImplementation((_q?: string, status?: string) => status === "active" ? newer.promise : older.promise);
    await user.click(screen.getByRole("button", { name: "Найти" }));
    await user.selectOptions(screen.getByLabelText("Статус"), "active");
    newer.resolve({ users: [{ ...playerUser, firstName: "Новый" }] });
    expect(await screen.findByRole("link", { name: "Игроков Новый" })).toBeInTheDocument();
    older.resolve({ users: [playerUser] });
    await waitFor(() => expect(screen.queryByRole("link", { name: "Игроков Борис" })).toBeNull());
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
