import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OPS-005 bounded cold-start UX", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows an explicit waking state while only the initial auth probe is pending", async () => {
    vi.useFakeTimers();
    let resolveMe!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveMe = resolve;
          }),
      ),
    );

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText("Подключаемся к сервису…")).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(screen.getByText("Сервис просыпается…")).toBeVisible();
    expect(screen.getByText(/это может занять до минуты/i)).toBeVisible();

    await act(async () => {
      resolveMe(response(401, { code: "UNAUTHORIZED", message: "Войдите" }));
      await Promise.resolve();
    });
    expect(screen.getByLabelText(/email/i)).toBeVisible();
  });

  it("times out after 60 seconds and offers an explicit Retry", async () => {
    vi.useFakeTimers();
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        attempt += 1;
        if (attempt > 1) {
          return Promise.resolve(
            response(401, { code: "UNAUTHORIZED", message: "Войдите" }),
          );
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    );

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByText("Сервис не ответил за минуту")).toBeVisible();
    const retry = screen.getByRole("button", { name: /повторить/i });

    await act(async () => {
      fireEvent.click(retry);
      await Promise.resolve();
    });
    expect(screen.getByLabelText(/email/i)).toBeVisible();
    expect(attempt).toBe(2);
  });

  it("does not label a warm page request as a cold start", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://tab10.local").pathname;
        if (path === "/api/v1/auth/me") {
          return response(200, {
            user: {
              id: "u1",
              email: "warm@tab10.local",
              role: "user",
              mustChangePassword: false,
              firstName: "Warm",
              lastName: "User",
              onboardingStep: 6,
              onboardingCompletedAt: "2026-09-01T00:00:00.000Z",
            },
          });
        }
        if (path === "/api/v1/home") return new Promise<Response>(() => {});
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.queryByText("Сервис просыпается…")).toBeNull();
    expect(screen.getByText(/привет, warm/i)).toBeVisible();
  });
});
