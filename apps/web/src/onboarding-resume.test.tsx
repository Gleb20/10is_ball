import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { App } from "./App";

type OnboardingUser = {
  id: string;
  email: string;
  role: "user";
  mustChangePassword: false;
  firstName: string;
  lastName: string;
  onboardingStep: number;
  onboardingCompletedAt: string | null;
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

describe("BUG-012 onboarding resume flow", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("auto-opens at the authoritative step and persists the next step across remount", async () => {
    let serverUser: OnboardingUser = {
      id: "u1",
      email: "new@tab10.local",
      role: "user",
      mustChangePassword: false,
      firstName: "Новый",
      lastName: "Игрок",
      onboardingStep: 3,
      onboardingCompletedAt: null,
    };
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input), "http://tab10.local").pathname;
      const method = (init?.method ?? "GET").toUpperCase();
      if (path === "/api/v1/auth/me") {
        return jsonResponse(200, { user: serverUser });
      }
      if (path === "/api/v1/me/onboarding" && method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as {
          action: string;
          step?: number;
        };
        if (body.action === "set-step") {
          serverUser = { ...serverUser, onboardingStep: body.step! };
        }
        return jsonResponse(200, { user: serverUser });
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    const first = render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Уведомления" }),
    ).toBeVisible();
    expect(screen.getByText("Шаг 4 из 7")).toBeVisible();
    expect(screen.getByText("Шаг 4 из 7")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("note", { name: "Где найти уведомления" })).toHaveTextContent(
      /главной.*профиле/i,
    );
    expect(screen.getByTestId("location")).toHaveTextContent("/onboarding");
    await user.click(screen.getByRole("button", { name: /^далее$/i }));
    expect(
      await screen.findByRole("heading", { name: "Профиль" }),
    ).toBeVisible();
    const navigation = screen.getByRole("navigation", { name: "Основная навигация" });
    expect(within(navigation).getByText("Профиль").closest(".bottom-nav__item")).toHaveAttribute(
      "data-onboarding-target",
      "true",
    );
    expect(serverUser.onboardingStep).toBe(4);

    first.unmount();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { name: "Профиль" }),
    ).toBeVisible();
    expect(screen.getByText("Шаг 5 из 7")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /^далее$/i }));
    const startHeading = await screen.findByRole("heading", { name: "Начать" });
    expect(startHeading).toHaveFocus();
    expect(within(screen.getByRole("navigation", { name: "Основная навигация" })).getByText("Начать").closest(".bottom-nav__item")).toHaveAttribute(
      "data-onboarding-target",
      "true",
    );
  });

  it("highlights reachable navigation targets without leaving the persisted guide", async () => {
    let serverUser: OnboardingUser = {
      id: "u1",
      email: "new@tab10.local",
      role: "user",
      mustChangePassword: false,
      firstName: "Новый",
      lastName: "Игрок",
      onboardingStep: 0,
      onboardingCompletedAt: null,
    };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input), "http://tab10.local").pathname;
      if (path === "/api/v1/auth/me") return jsonResponse(200, { user: serverUser });
      if (path === "/api/v1/me/onboarding") {
        const body = JSON.parse(String(init?.body)) as { step: number };
        serverUser = { ...serverUser, onboardingStep: body.step };
        return jsonResponse(200, { user: serverUser });
      }
      throw new Error(`Unexpected request: ${path}`);
    }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/"]}><App /><LocationProbe /></MemoryRouter>);

    for (const label of ["Главная", "Рейтинг", "История"]) {
      const heading = await screen.findByRole("heading", { name: label });
      await waitFor(() => expect(heading).toHaveFocus());
      const navigation = screen.getByRole("navigation", { name: "Основная навигация" });
      expect(within(navigation).getByText(label).closest(".bottom-nav__item")).toHaveAttribute(
        "data-onboarding-target",
        "true",
      );
      expect(within(navigation).queryByRole("link")).toBeNull();
      expect(screen.getByTestId("location")).toHaveTextContent("/onboarding");
      await user.click(screen.getByRole("button", {
        name: label === "Рейтинг" ? /пропустить шаг/i : /^далее$/i,
      }));
    }
  });

  it("starts the tutorial without completing onboarding", async () => {
    const serverUser: OnboardingUser = {
      id: "u1",
      email: "new@tab10.local",
      role: "user",
      mustChangePassword: false,
      firstName: "Новый",
      lastName: "Игрок",
      onboardingStep: 6,
      onboardingCompletedAt: null,
    };
    const onboardingActions: string[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input), "http://tab10.local").pathname;
      if (path === "/api/v1/auth/me") return jsonResponse(200, { user: serverUser });
      if (path === "/api/v1/me/onboarding") {
        const body = JSON.parse(String(init?.body)) as { action: string };
        onboardingActions.push(body.action);
        return jsonResponse(200, { user: serverUser });
      }
      if (path === "/api/v1/matches/tutorial") return jsonResponse(200, { match: { id: "tutorial-1" } });
      throw new Error(`Unexpected request: ${path}`);
    }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/"]}><App /><LocationProbe /></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: /матч с призрачным олегом/i }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/matches/tutorial-1/judge"));
    expect(onboardingActions).toEqual(["set-step"]);
  });

  it("restarts completed onboarding from the Profile action", async () => {
    let serverUser: OnboardingUser = {
      id: "u1",
      email: "existing@tab10.local",
      role: "user",
      mustChangePassword: false,
      firstName: "Опытный",
      lastName: "Игрок",
      onboardingStep: 6,
      onboardingCompletedAt: "2026-09-01T09:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = new URL(String(input), "http://tab10.local").pathname;
        const method = (init?.method ?? "GET").toUpperCase();
        if (path === "/api/v1/auth/me") {
          return jsonResponse(200, { user: serverUser });
        }
        if (path === "/api/v1/auth/sessions") {
          return jsonResponse(200, { sessions: [] });
        }
        if (path === "/api/v1/home") {
          return jsonResponse(200, { unreadCount: 0 });
        }
        if (path === "/api/v1/me/onboarding" && method === "PATCH") {
          const body = JSON.parse(String(init?.body)) as { action: string };
          expect(body.action).toBe("restart");
          serverUser = {
            ...serverUser,
            onboardingStep: 0,
            onboardingCompletedAt: null,
          };
          return jsonResponse(200, { user: serverUser });
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      }),
    );
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    );
    await user.click(
      await screen.findByRole("button", { name: /пройти онбординг заново/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/onboarding");
    });
    expect(
      await screen.findByRole("heading", { name: "Главная" }),
    ).toBeVisible();
    expect(screen.getByText("Шаг 1 из 7")).toBeVisible();
  });
});
