import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVisibleRefresh } from "./useVisibleRefresh";

function setDocumentVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function Harness({
  load,
  pollingEnabled = true,
  refreshKey,
}: {
  load: () => Promise<void>;
  pollingEnabled?: boolean;
  refreshKey?: string;
}) {
  const { error, refreshNow, refreshing } = useVisibleRefresh(load, {
    pollingEnabled,
    refreshKey,
  });
  return (
    <div>
      <button disabled={refreshing} onClick={() => void refreshNow()}>
        {refreshing ? "Обновление…" : "Обновить"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

describe("useVisibleRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setDocumentVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("loads once, polls every 30 seconds only while visible, resumes once, and cleans up", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const rendered = render(<Harness load={load} />);

    await act(async () => Promise.resolve());
    expect(load).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(load).toHaveBeenCalledTimes(2);

    act(() => setDocumentVisibility("hidden"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(load).toHaveBeenCalledTimes(2);

    act(() => setDocumentVisibility("visible"));
    await act(async () => Promise.resolve());
    expect(load).toHaveBeenCalledTimes(3);

    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => Promise.resolve());
    expect(load).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(load).toHaveBeenCalledTimes(4);

    rendered.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("coalesces timer and manual refresh while a request is in flight", async () => {
    const pending = deferred();
    const load = vi.fn().mockReturnValue(pending.promise);
    render(<Harness load={load} />);

    await act(async () => Promise.resolve());
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Обновление…" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Обновление…" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(load).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(screen.getByRole("button", { name: "Обновить" })).toBeEnabled();
  });

  it("keeps manual retry when polling is disabled and clears the error on success", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("Сеть недоступна"))
      .mockResolvedValue(undefined);
    render(<Harness load={load} pollingEnabled={false} />);

    await act(async () => Promise.resolve());
    expect(screen.getByRole("alert")).toHaveTextContent("Сеть недоступна");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(load).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    await act(async () => Promise.resolve());
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("starts the new resource request without waiting for an older key", async () => {
    const first = deferred();
    const loadA = vi.fn().mockReturnValue(first.promise);
    const loadB = vi.fn().mockResolvedValue(undefined);
    const rendered = render(
      <Harness load={loadA} pollingEnabled={false} refreshKey="a" />,
    );
    await act(async () => Promise.resolve());
    expect(loadA).toHaveBeenCalledTimes(1);

    rendered.rerender(
      <Harness load={loadB} pollingEnabled={false} refreshKey="b" />,
    );
    await act(async () => Promise.resolve());
    expect(loadB).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve();
      await first.promise;
    });
    expect(screen.getByRole("button", { name: "Обновить" })).toBeEnabled();
  });
});
