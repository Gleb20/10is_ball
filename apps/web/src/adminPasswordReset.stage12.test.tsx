import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUser, User } from "./api";
import {
  AdminPasswordResetProvider,
  useAdminPasswordReset,
} from "./adminPasswordReset";

const requestA = "00000000-0000-4000-8000-0000000012a1";
const requestB = "00000000-0000-4000-8000-0000000012b2";
const actor: User = {
  id: "00000000-0000-4000-8000-000000001201",
  email: "admin@example.test",
  role: "admin",
  mustChangePassword: false,
};
const target: AdminUser = {
  id: "00000000-0000-4000-8000-000000001202",
  email: "player@example.test",
  role: "user",
  status: "active",
  mustChangePassword: false,
  firstName: "Борис",
  lastName: "Игроков",
  birthDate: null,
  organizationText: null,
  positionText: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastLoginAt: null,
};
const blockedTarget = { ...target, status: "blocked" as const };
const selfTarget: AdminUser = {
  ...target,
  id: actor.id,
  email: actor.email,
  role: "admin",
  firstName: "Анна",
  lastName: "Админова",
};

const mocks = vi.hoisted(() => ({
  state: vi.fn(),
  reset: vi.fn(),
  receipt: vi.fn(),
  auth: {
    user: null as User | null,
    reauthRequired: false,
    explicitAuthEpoch: 1,
  },
}));

vi.mock("./api", () => ({
  api: {
    getAdminPasswordResetState: (...args: unknown[]) => mocks.state(...args),
    resetAdminPassword: (...args: unknown[]) => mocks.reset(...args),
    getAdminPasswordResetReceipt: (...args: unknown[]) => mocks.receipt(...args),
  },
}));

vi.mock("./auth", () => ({
  useAuth: () => mocks.auth,
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

function Harness() {
  const reset = useAdminPasswordReset();
  return (
    <>
      <output aria-label="reset enabled">{String(reset.enabled)}</output>
      <button onClick={() => void reset.open(target)}>reset target</button>
      <button onClick={() => void reset.open(blockedTarget)}>reset blocked</button>
      <button onClick={() => void reset.open(selfTarget)}>reset self</button>
    </>
  );
}

function view() {
  return <AdminPasswordResetProvider enabled><Harness /></AdminPasswordResetProvider>;
}

async function openAndConfirm(user: ReturnType<typeof userEvent.setup>, name = "reset target") {
  await user.click(screen.getByRole("button", { name }));
  const dialog = await screen.findByRole("dialog", { name: "Сбросить пароль?" });
  await user.click(within(dialog).getByRole("button", { name: "Подтвердить сброс" }));
}

async function revealSecret(
  user: ReturnType<typeof userEvent.setup>,
  name = "reset target",
) {
  mocks.reset.mockResolvedValueOnce({
    requestId: requestA,
    outcome: "applied",
    secretAvailable: true,
    temporaryPassword: "VisibleTicket1!",
    current: true,
  });
  await openAndConfirm(user, name);
  await screen.findByRole("dialog", { name: "Пароль выдан" });
}

function hasVisibleSecret() {
  return document.querySelector('[data-testid="temp-password-value"]') !== null;
}

describe("Stage 12 correlated admin password reset controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mocks.auth.user = actor;
    mocks.auth.reauthRequired = false;
    mocks.auth.explicitAuthEpoch = 1;
    mocks.state.mockResolvedValue({ targetUserId: target.id, lastAppliedRequestId: null });
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(requestA)
      .mockReturnValueOnce(requestB);
  });

  it("persists only correlation before POST and keeps the first secret visible through Copy until Close", async () => {
    const pending = deferred<{
      requestId: string;
      outcome: "applied";
      secretAvailable: true;
      temporaryPassword: string;
      current: true;
    }>();
    mocks.reset.mockImplementationOnce(() => pending.promise);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const user = userEvent.setup();
    render(view());

    await openAndConfirm(user);
    const storedBeforeResponse = Object.values(window.sessionStorage).join(" ");
    expect(storedBeforeResponse).toContain(requestA);
    expect(storedBeforeResponse).not.toContain("TempPass1!");
    pending.resolve({
      requestId: requestA,
      outcome: "applied",
      secretAvailable: true,
      temporaryPassword: "TempPass1!",
      current: true,
    });

    const secretDialog = await screen.findByRole("dialog", { name: "Пароль выдан" });
    expect(within(secretDialog).getByTestId("temp-password-value")).toHaveTextContent("TempPass1!");
    expect(secretDialog).not.toHaveTextContent(requestA);
    expect(Object.values(window.sessionStorage).join(" ")).not.toContain("TempPass1!");
    await user.click(within(secretDialog).getByRole("button", { name: "Скопировать" }));
    await screen.findByRole("button", { name: "Скопировано" });
    expect(within(secretDialog).getByTestId("temp-password-value")).toBeVisible();
    await user.click(within(secretDialog).getAllByRole("button", { name: "Закрыть" }).at(-1)!);
    expect(screen.queryByText("TempPass1!")).toBeNull();
  });

  it("removes an already-visible non-self secret after automatic 401", async () => {
    const user = userEvent.setup();
    const rendered = render(view());
    await revealSecret(user);

    mocks.auth.user = null;
    mocks.auth.reauthRequired = true;
    rendered.rerender(view());

    await waitFor(() => expect(hasVisibleSecret()).toBe(false));
  });

  it("removes an already-visible secret when the issuing actor loses admin role", async () => {
    const user = userEvent.setup();
    const rendered = render(view());
    await revealSecret(user);

    mocks.auth.user = { ...actor, role: "user" };
    rendered.rerender(view());

    await waitFor(() => expect(hasVisibleSecret()).toBe(false));
  });

  it("keeps an already-visible secret through an ordinary refresh of the same valid actor", async () => {
    const user = userEvent.setup();
    const rendered = render(view());
    await revealSecret(user);

    mocks.auth.user = { ...actor, firstName: "Обновлённая" };
    rendered.rerender(view());

    expect(hasVisibleSecret()).toBe(true);
  });

  it("keeps the exact self-reset secret ticket through its expected automatic 401", async () => {
    mocks.state.mockResolvedValue({ targetUserId: actor.id, lastAppliedRequestId: null });
    const user = userEvent.setup();
    const rendered = render(view());
    await revealSecret(user, "reset self");

    mocks.auth.user = null;
    mocks.auth.reauthRequired = true;
    rendered.rerender(view());

    expect(hasVisibleSecret()).toBe(true);
  });

  it("removes an already-visible self-reset secret on explicit logout", async () => {
    mocks.state.mockResolvedValue({ targetUserId: actor.id, lastAppliedRequestId: null });
    const user = userEvent.setup();
    const rendered = render(view());
    await revealSecret(user, "reset self");

    mocks.auth.user = null;
    mocks.auth.reauthRequired = false;
    mocks.auth.explicitAuthEpoch += 1;
    rendered.rerender(view());

    await waitFor(() => expect(hasVisibleSecret()).toBe(false));
  });

  it("uses only receipt GET after an unknown result and sends exactly one confirmed replacement B", async () => {
    mocks.reset
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce({
        requestId: requestB,
        outcome: "applied",
        secretAvailable: true,
        temporaryPassword: "Replacement1!",
        current: true,
      });
    mocks.receipt.mockResolvedValue({
      requestId: requestA,
      targetUserId: target.id,
      outcome: "unknown",
      secretAvailable: false,
    });
    mocks.state
      .mockResolvedValueOnce({ targetUserId: target.id, lastAppliedRequestId: null })
      .mockResolvedValue({ targetUserId: target.id, lastAppliedRequestId: requestA });
    const user = userEvent.setup();
    render(view());

    await openAndConfirm(user);
    const unresolved = await screen.findByRole("dialog", { name: "Результат пока неизвестен" });
    expect(unresolved).not.toHaveTextContent(requestA);
    expect(unresolved).not.toHaveTextContent("POST");
    await user.click(within(unresolved).getByRole("button", { name: "Проверить результат" }));
    expect(await screen.findByRole("dialog", { name: "Результат пока неизвестен" })).toBeVisible();
    expect(mocks.reset).toHaveBeenCalledTimes(1);
    expect(mocks.receipt).toHaveBeenCalledWith(target.id, requestA);

    await user.click(screen.getByRole("button", { name: "Выдать новый пароль" }));
    const replacement = await screen.findByRole("dialog", { name: "Выдать новый пароль ещё раз?" });
    await user.click(within(replacement).getByRole("button", { name: "Отмена" }));
    expect(mocks.reset).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Выдать новый пароль" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Выдать новый пароль ещё раз?" }))
      .getByRole("button", { name: "Подтвердить новую выдачу" }));

    await screen.findByRole("dialog", { name: "Пароль выдан" });
    expect(mocks.reset).toHaveBeenCalledTimes(2);
    expect(mocks.reset).toHaveBeenLastCalledWith(target.id, requestB, {
      expectedLastAppliedRequestId: requestA,
      supersedesRequestId: requestA,
      confirmReplacement: true,
    });
  });

  it("keeps an own self-reset response ticket across automatic 401 but invalidates it on explicit logout", async () => {
    const pending = deferred<{
      requestId: string;
      outcome: "applied";
      secretAvailable: true;
      temporaryPassword: string;
      current: true;
    }>();
    mocks.state.mockResolvedValue({ targetUserId: actor.id, lastAppliedRequestId: null });
    mocks.reset.mockImplementation(() => pending.promise);
    const user = userEvent.setup();
    const rendered = render(view());
    await openAndConfirm(user, "reset self");

    mocks.auth.user = null;
    mocks.auth.reauthRequired = true;
    rendered.rerender(view());
    pending.resolve({ requestId: requestA, outcome: "applied", secretAvailable: true, temporaryPassword: "Self1!", current: true });
    expect(await screen.findByRole("dialog", { name: "Пароль выдан" })).toHaveTextContent("Self1!");

    const selfSecret = screen.getByRole("dialog", { name: "Пароль выдан" });
    await user.click(within(selfSecret).getAllByRole("button", { name: "Закрыть" }).at(-1)!);
    const late = deferred<{
      requestId: string;
      outcome: "applied";
      secretAvailable: true;
      temporaryPassword: string;
      current: true;
    }>();
    mocks.auth.user = actor;
    mocks.auth.reauthRequired = false;
    mocks.auth.explicitAuthEpoch = 2;
    mocks.state.mockResolvedValue({ targetUserId: actor.id, lastAppliedRequestId: requestA });
    mocks.reset.mockImplementationOnce(() => late.promise);
    rendered.rerender(view());
    await openAndConfirm(user, "reset self");
    mocks.auth.user = null;
    mocks.auth.explicitAuthEpoch = 3;
    rendered.rerender(view());
    late.resolve({ requestId: requestB, outcome: "applied", secretAvailable: true, temporaryPassword: "MustNotShow1!", current: true });
    await act(async () => { await late.promise; await Promise.resolve(); });
    expect(screen.queryByText("MustNotShow1!")).toBeNull();
  });

  it("ignores a late A response after a newer B operation becomes active", async () => {
    const lateA = deferred<{
      requestId: string;
      outcome: "applied";
      secretAvailable: true;
      temporaryPassword: string;
      current: true;
    }>();
    mocks.reset
      .mockImplementationOnce(() => lateA.promise)
      .mockResolvedValueOnce({ requestId: requestB, outcome: "applied", secretAvailable: true, temporaryPassword: "B-Secret1!", current: true });
    const user = userEvent.setup();
    render(view());
    await openAndConfirm(user);
    await openAndConfirm(user);
    expect(await screen.findByRole("dialog", { name: "Пароль выдан" })).toHaveTextContent("B-Secret1!");

    lateA.resolve({ requestId: requestA, outcome: "applied", secretAvailable: true, temporaryPassword: "A-Late1!", current: true });
    await act(async () => { await lateA.promise; await Promise.resolve(); });
    expect(screen.queryByText("A-Late1!")).toBeNull();
    expect(screen.getByText("B-Secret1!")).toBeVisible();
  });

  it("shows blocked-target consequences and reports unavailable persistence without losing the in-memory operation", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    mocks.state.mockResolvedValue({ targetUserId: target.id, lastAppliedRequestId: null });
    mocks.reset.mockRejectedValueOnce(new TypeError("connection lost"));
    const user = userEvent.setup();
    render(view());
    await user.click(screen.getByRole("button", { name: "reset blocked" }));
    expect(await screen.findByText(/заблокированный пользователь не сможет войти/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Подтвердить сброс" }));
    expect(await screen.findByText(/после перезагрузки восстановление будет недоступно/i)).toBeVisible();
    storage.mockRestore();
  });

  it("stops on both server 409 contracts without replaying or rebasing the POST", async () => {
    mocks.reset
      .mockRejectedValueOnce(Object.assign(new Error("state changed"), {
        status: 409,
        code: "RESET_STATE_CHANGED",
        currentLastAppliedRequestId: requestB,
      }))
      .mockRejectedValueOnce(Object.assign(new Error("key reused"), {
        status: 409,
        code: "IDEMPOTENCY_KEY_REUSED",
      }));
    const user = userEvent.setup();
    render(view());

    await openAndConfirm(user);
    const changed = await screen.findByRole("dialog", { name: "Состояние изменилось" });
    expect(changed).toBeVisible();
    expect(changed).not.toHaveTextContent("POST");
    expect(mocks.reset).toHaveBeenCalledTimes(1);
    expect(mocks.state).toHaveBeenCalledTimes(1);
    await user.click(within(changed).getAllByRole("button", { name: "Закрыть" }).at(-1)!);

    await openAndConfirm(user);
    expect(await screen.findByRole("dialog", { name: "Начните сброс заново" })).toBeVisible();
    expect(mocks.reset).toHaveBeenCalledTimes(2);
    expect(mocks.state).toHaveBeenCalledTimes(2);
  });

  it("turns preflight 401 into a terminal session message instead of leaving a loading dialog", async () => {
    mocks.state.mockRejectedValueOnce(Object.assign(new Error("unauthorized"), { status: 401 }));
    const user = userEvent.setup();
    render(view());

    await user.click(screen.getByRole("button", { name: "reset target" }));
    const error = await screen.findByRole("dialog", { name: "Доступ к сбросу прекращён" });
    expect(error).toHaveTextContent(/сессия завершена/i);
    expect(screen.queryByRole("dialog", { name: "Проверяем состояние сброса" })).toBeNull();
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it("invalidates a late response when the same actor loses the admin role", async () => {
    const late = deferred<{
      requestId: string;
      outcome: "applied";
      secretAvailable: true;
      temporaryPassword: string;
      current: true;
    }>();
    mocks.reset.mockImplementationOnce(() => late.promise);
    const user = userEvent.setup();
    const rendered = render(view());
    await openAndConfirm(user);

    mocks.auth.user = { ...actor, role: "user" };
    rendered.rerender(view());
    late.resolve({
      requestId: requestA,
      outcome: "applied",
      secretAvailable: true,
      temporaryPassword: "DemotedMustNotSee1!",
      current: true,
    });
    await act(async () => { await late.promise; await Promise.resolve(); });

    expect(screen.queryByText("DemotedMustNotSee1!")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(Object.values(window.sessionStorage).join(" ")).not.toContain(requestA);
  });

  it("recovers persisted correlation with receipt GET and warns when a later reset made it non-current", async () => {
    window.sessionStorage.setItem(
      `tab10.admin.password-reset.v1:${actor.id}:${target.id}`,
      JSON.stringify({
        v: 1,
        actorId: actor.id,
        targetId: target.id,
        requestId: requestA,
        expectedLastAppliedRequestId: null,
      }),
    );
    mocks.receipt.mockResolvedValue({
      requestId: requestA,
      targetUserId: target.id,
      outcome: "applied",
      secretAvailable: false,
      current: false,
    });
    const user = userEvent.setup();
    render(view());

    await user.click(screen.getByRole("button", { name: "reset target" }));
    const unresolved = await screen.findByRole("dialog", { name: "Результат пока неизвестен" });
    await user.click(within(unresolved).getByRole("button", { name: "Проверить результат" }));

    expect(await screen.findByText(/пароль уже мог измениться/i)).toBeVisible();
    expect(mocks.receipt).toHaveBeenCalledWith(target.id, requestA);
    expect(mocks.state).not.toHaveBeenCalled();
    expect(mocks.reset).not.toHaveBeenCalled();
    expect(Object.values(window.sessionStorage).join(" ")).not.toContain("temporaryPassword");
  });
});
