import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminUserPage } from "./AdminUserPage";
import type { AdminUser, AdminUserAuditFeed } from "../api";

const mocks = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  listAdminUserAudit: vi.fn(),
  updateAdminUser: vi.fn(),
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
    getAdminUser: (...args: unknown[]) => mocks.getAdminUser(...args),
    listAdminUserAudit: (...args: unknown[]) => mocks.listAdminUserAudit(...args),
    updateAdminUser: (...args: unknown[]) => mocks.updateAdminUser(...args),
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

const targetId = "00000000-0000-4000-8000-000000001102";
const otherId = "00000000-0000-4000-8000-000000001103";
const target: AdminUser = {
  id: targetId,
  email: "player@example.test",
  firstName: "Борис",
  lastName: "Игроков",
  role: "user",
  status: "active",
  mustChangePassword: false,
  birthDate: null,
  organizationText: "Клуб",
  positionText: null,
  createdAt: "2026-01-02T10:00:00.000Z",
  lastLoginAt: null,
};
const feed: AdminUserAuditFeed = {
  items: [
    {
      id: "00000000-0000-4000-8000-000000002611",
      createdAt: "2026-09-18T10:00:00.000Z",
      actor: {
        id: "00000000-0000-4000-8000-000000001101",
        displayName: "Админова Анна",
      },
      action: "user.updated",
      changedFields: ["firstName", "role"],
    },
  ],
  nextCursor: "next-page",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function RouteButtons() {
  const navigate = useNavigate();
  return <>
    <button onClick={() => navigate(`/admin/users/${targetId}`)}>Первая карточка</button>
    <button onClick={() => navigate(`/admin/users/${otherId}`)}>Вторая карточка</button>
  </>;
}

function page(initial = targetId) {
  return <MemoryRouter initialEntries={[`/admin/users/${initial}`]}>
    <RouteButtons />
    <Routes><Route path="/admin/users/:id" element={<AdminUserPage />} /></Routes>
  </MemoryRouter>;
}

describe("GAP-026 admin account card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser = {
      id: "00000000-0000-4000-8000-000000001101",
      email: "admin@example.test",
      role: "admin",
      mustChangePassword: false,
    };
    mocks.reauthRequired = false;
    mocks.passwordResetEnabled = false;
    mocks.getAdminUser.mockResolvedValue({ user: target });
    mocks.listAdminUserAudit.mockResolvedValue(feed);
    mocks.updateAdminUser.mockResolvedValue({ user: target });
  });

  it("routes an enabled password reset through the Stage 12 controller", async () => {
    const user = userEvent.setup();
    mocks.passwordResetEnabled = true;
    render(page());
    await screen.findByRole("heading", { name: "Игроков Борис" });
    await user.click(screen.getByRole("button", { name: "Действия" }));
    await user.click(screen.getByRole("button", { name: "Сбросить пароль" }));

    expect(mocks.openPasswordReset).toHaveBeenCalledOnce();
    expect(mocks.openPasswordReset).toHaveBeenCalledWith(target);
    expect(screen.queryByRole("dialog", { name: "Сбросить пароль?" })).toBeNull();
  });

  it("shows allowlisted account context and a safe, human-readable audit timeline", async () => {
    render(page());
    expect(await screen.findByRole("heading", { name: "Игроков Борис" })).toBeInTheDocument();
    expect(screen.getByText("player@example.test")).toBeInTheDocument();
    expect(screen.getByText("Активен")).toBeInTheDocument();
    const history = screen.getByRole("region", { name: "История изменений" });
    expect(within(history).getByText("Профиль изменён")).toBeInTheDocument();
    expect(within(history).getByText(/Админова Анна/)).toBeInTheDocument();
    expect(within(history).getByText(/Имя, Роль/)).toBeInTheDocument();
    expect(within(history).getByText(/МСК/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Показать ещё" })).toBeInTheDocument();
  });

  it("edits a stable target with readonly email and nullable profile fields", async () => {
    const user = userEvent.setup();
    render(page());
    await screen.findByRole("heading", { name: "Игроков Борис" });
    await user.click(screen.getByRole("button", { name: "Редактировать" }));
    const dialog = screen.getByRole("dialog", { name: "Профиль пользователя" });
    expect(within(dialog).getByLabelText("Email")).toHaveAttribute("readonly");
    fireEvent.change(within(dialog).getByLabelText("Имя"), { target: { value: "Борислав" } });
    fireEvent.change(within(dialog).getByLabelText("Дата рождения"), { target: { value: "2000-02-29" } });
    await user.clear(within(dialog).getByLabelText("Организация"));
    await user.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(mocks.updateAdminUser).toHaveBeenCalledWith(targetId, {
      firstName: "Борислав",
      lastName: "Игроков",
      birthDate: "2000-02-29",
      organizationText: null,
      positionText: null,
    });
  });

  it("keeps loading until the current route effect finishes and ignores late success/error/finally", async () => {
    const user = userEvent.setup();
    const firstUser = deferred<{ user: AdminUser }>();
    const firstAudit = deferred<AdminUserAuditFeed>();
    const secondUser = deferred<{ user: AdminUser }>();
    const secondAudit = deferred<AdminUserAuditFeed>();
    mocks.getAdminUser.mockImplementation((id: string) => id === targetId ? firstUser.promise : secondUser.promise);
    mocks.listAdminUserAudit.mockImplementation((id: string) => id === targetId ? firstAudit.promise : secondAudit.promise);
    render(page());
    await user.click(screen.getByRole("button", { name: "Вторая карточка" }));

    firstUser.resolve({ user: target });
    firstAudit.reject(new Error("Старая ошибка"));
    await waitFor(() => expect(screen.queryByText("Игроков Борис")).toBeNull());
    expect(screen.queryByText("Старая ошибка")).toBeNull();
    expect(screen.getByRole("status", { name: "Загружаем аккаунт" })).toBeInTheDocument();

    secondUser.resolve({ user: { ...target, id: otherId, firstName: "Вера", lastName: "Новая" } });
    secondAudit.resolve({ items: [], nextCursor: null });
    expect(await screen.findByRole("heading", { name: "Новая Вера" })).toBeInTheDocument();
  });

  it("closes one action disclosure with Escape and returns focus", async () => {
    const user = userEvent.setup();
    render(page());
    await screen.findByRole("heading", { name: "Игроков Борис" });
    const trigger = screen.getByRole("button", { name: "Действия" });
    await user.click(trigger);
    const group = screen.getByRole("group", { name: "Действия с аккаунтом" });
    const block = within(group).getByRole("button", { name: "Заблокировать" });
    block.focus();
    fireEvent.keyDown(block, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Действия с аккаунтом" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("drops a late mutation result after the route changes", async () => {
    const user = userEvent.setup();
    const block = deferred<{ ok: boolean }>();
    mocks.blockUser.mockImplementation(() => block.promise);
    mocks.getAdminUser.mockImplementation(async (id: string) => ({
      user: id === targetId ? target : { ...target, id: otherId, firstName: "Вера", lastName: "Новая" },
    }));
    mocks.listAdminUserAudit.mockResolvedValue({ items: [], nextCursor: null });
    render(page());
    await screen.findByRole("heading", { name: "Игроков Борис" });
    await user.click(screen.getByRole("button", { name: "Действия" }));
    await user.click(screen.getByRole("button", { name: "Заблокировать" }));
    await user.click(screen.getByRole("button", { name: "Подтвердить" }));
    await user.click(screen.getByRole("button", { name: "Вторая карточка" }));
    expect(await screen.findByRole("heading", { name: "Новая Вера" })).toBeInTheDocument();
    block.resolve({ ok: true });
    await waitFor(() => expect(mocks.blockUser).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Действия" })).not.toBeDisabled();
  });
});
