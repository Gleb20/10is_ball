import { Activity } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminMatchRecovery } from "./adminMatchRecovery";

const active = {
  id: "00000000-0000-4000-8000-000000002801",
  kind: "standalone" as const,
  status: "in_progress" as const,
  version: 4,
  allowedEmergencyAction: "force_close" as const,
};
const cancelled = {
  ...active,
  status: "cancelled" as const,
  version: 5,
  allowedEmergencyAction: null,
};

const mocks = vi.hoisted(() => ({
  auth: {
    user: {
      id: "00000000-0000-4000-8000-000000002800",
      role: "admin" as const,
    } as { id: string; role: "admin" | "user" } | null,
    explicitAuthEpoch: 1,
    refresh: vi.fn(),
  },
  lookup: vi.fn(),
  forceClose: vi.fn(),
}));

vi.mock("./auth", () => ({ useAuth: () => mocks.auth }));
vi.mock("./api", () => ({
  api: {
    getAdminMatchRecovery: (...args: unknown[]) => mocks.lookup(...args),
    forceCloseAdminMatchRecovery: (...args: unknown[]) => mocks.forceClose(...args),
  },
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

async function lookupActive(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("ID матча"), active.id);
  await user.click(screen.getByRole("button", { name: "Найти матч" }));
  expect(await screen.findByText("Аварийное завершение доступно")).toBeInTheDocument();
}

describe("Stage 11 admin exact-id match recovery", () => {
  beforeEach(() => {
    mocks.auth.user = {
      id: "00000000-0000-4000-8000-000000002800",
      role: "admin",
    };
    mocks.auth.explicitAuthEpoch = 1;
    mocks.auth.refresh.mockReset();
    mocks.lookup.mockReset();
    mocks.forceClose.mockReset();
    mocks.lookup.mockResolvedValue({ recovery: active });
    mocks.forceClose.mockResolvedValue({ recovery: cancelled });
  });

  it("validates the exact id, discloses only the projection and POSTs only after named confirmation", async () => {
    const user = userEvent.setup();
    render(<AdminMatchRecovery />);
    await user.type(screen.getByLabelText("ID матча"), "bad-id");
    await user.click(screen.getByRole("button", { name: "Найти матч" }));
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(screen.getByText("Введите UUID матча полностью")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("ID матча"));
    await lookupActive(user);
    const region = screen.getByRole("region", { name: "Аварийное завершение матча" });
    expect(within(region).getByText(active.id)).toBeInTheDocument();
    expect(within(region).getByText("Обычный матч")).toBeInTheDocument();
    expect(within(region).queryByText(/SECRET/i)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Аварийно завершить" }));
    expect(mocks.forceClose).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", {
      name: `Аварийно завершить матч ${active.id}?`,
    });
    expect(within(dialog).getByText(/без победителя и статистики/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Отмена" }));
    expect(mocks.forceClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Аварийно завершить" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", {
      name: `Завершить матч ${active.id}`,
    }));
    await waitFor(() => expect(mocks.forceClose).toHaveBeenCalledTimes(1));
    const [id, payload, key] = mocks.forceClose.mock.calls[0]!;
    expect(id).toBe(active.id);
    expect(payload).toEqual({ expectedVersion: 4 });
    expect(key).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await screen.findByText(`Матч ${active.id} аварийно завершён`)).toBeInTheDocument();
  });

  it("uses GET-only reconciliation before a separately confirmed same-key replay", async () => {
    const user = userEvent.setup();
    mocks.forceClose
      .mockRejectedValueOnce(Object.assign(new Error("network"), { status: 500 }))
      .mockResolvedValueOnce({ recovery: cancelled });
    mocks.lookup
      .mockResolvedValueOnce({ recovery: active })
      .mockResolvedValueOnce({ recovery: cancelled });
    render(<AdminMatchRecovery />);
    await lookupActive(user);
    await user.click(screen.getByRole("button", { name: "Аварийно завершить" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", {
      name: `Завершить матч ${active.id}`,
    }));
    expect(await screen.findByText("Исход запроса неизвестен")).toBeInTheDocument();
    const original = mocks.forceClose.mock.calls[0]!;

    await user.click(screen.getByRole("button", { name: "Сверить состояние" }));
    await screen.findByText("Состояние получено, но авторство изменения не доказано");
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
    expect(mocks.forceClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Проверить исход тем же запросом" }));
    expect(mocks.forceClose).toHaveBeenCalledTimes(1);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", {
      name: "Отправить тот же запрос",
    }));
    await waitFor(() => expect(mocks.forceClose).toHaveBeenCalledTimes(2));
    expect(mocks.forceClose.mock.calls[1]).toEqual(original);
  });

  it.each([400, 401, 403, 404, 409])(
    "closes the stale action after a known %i response until an explicit fresh GET",
    async (status) => {
      const user = userEvent.setup();
      mocks.forceClose.mockRejectedValueOnce(
        Object.assign(new Error(`known ${status}`), { status }),
      );
      render(<AdminMatchRecovery />);
      await lookupActive(user);
      await user.click(screen.getByRole("button", { name: "Аварийно завершить" }));
      await user.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: `Завершить матч ${active.id}`,
        }),
      );

      await waitFor(() => {
        expect(
          screen.queryByRole("button", { name: "Аварийно завершить" }),
        ).toBeNull();
      });
      expect(screen.getByLabelText("ID матча")).toHaveValue(active.id);
      expect(screen.queryByText("Аварийное завершение доступно")).toBeNull();
      expect(mocks.forceClose).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("button", { name: "Найти матч" }));
      expect(await screen.findByText("Аварийное завершение доступно")).toBeInTheDocument();
      expect(mocks.lookup).toHaveBeenCalledTimes(2);
      expect(mocks.forceClose).toHaveBeenCalledTimes(1);
    },
  );

  it("invalidates a late Activity result/finally while a newer reconciliation remains pending", async () => {
    const user = userEvent.setup();
    const mutation = deferred<{ recovery: typeof cancelled }>();
    const reconciliation = deferred<{ recovery: typeof cancelled }>();
    mocks.forceClose.mockImplementationOnce(() => mutation.promise);
    mocks.lookup
      .mockResolvedValueOnce({ recovery: active })
      .mockImplementationOnce(() => reconciliation.promise);
    const view = render(<Activity mode="visible"><AdminMatchRecovery /></Activity>);
    await lookupActive(user);
    await user.click(screen.getByRole("button", { name: "Аварийно завершить" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", {
      name: `Завершить матч ${active.id}`,
    }));
    view.rerender(<Activity mode="hidden"><AdminMatchRecovery /></Activity>);
    view.rerender(<Activity mode="visible"><AdminMatchRecovery /></Activity>);
    expect(await screen.findByText("Исход запроса неизвестен")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Сверить состояние" }));
    expect(screen.getByRole("button", { name: "Сверка…" })).toBeDisabled();

    await act(async () => {
      mutation.resolve({ recovery: cancelled });
      await mutation.promise;
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Сверка…" })).toBeDisabled();
    await act(async () => {
      reconciliation.resolve({ recovery: cancelled });
      await reconciliation.promise;
    });
    expect(await screen.findByText("Состояние получено, но авторство изменения не доказано")).toBeInTheDocument();
  });

  it("clears projection/correlation and ignores late rejection after actor or auth epoch changes", async () => {
    const user = userEvent.setup();
    const held = deferred<{ recovery: typeof active }>();
    mocks.lookup.mockImplementationOnce(() => held.promise);
    const view = render(<AdminMatchRecovery />);
    await user.type(screen.getByLabelText("ID матча"), active.id);
    await user.click(screen.getByRole("button", { name: "Найти матч" }));

    mocks.auth.explicitAuthEpoch = 2;
    view.rerender(<AdminMatchRecovery />);
    await act(async () => {
      held.reject(Object.assign(new Error("late SECRET"), { status: 500 }));
      try { await held.promise; } catch { /* expected */ }
      await Promise.resolve();
    });
    expect(screen.queryByText(/late SECRET|Исход запроса неизвестен/)).toBeNull();
    expect(screen.queryByText(active.id)).toBeNull();
    expect(screen.getByLabelText("ID матча")).toHaveValue("");
  });
});
