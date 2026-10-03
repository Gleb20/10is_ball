import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.queryByRole("button", { name: /пропустить шаг/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Закрыть обучение" })).toBeVisible();
    expect(screen.getByRole("note", { name: "Где найти уведомления" })).toHaveTextContent(
      /главной.*профиле/i,
    );
    expect(screen.getByTestId("location")).toHaveTextContent("/onboarding");
    await user.click(screen.getByRole("button", { name: /^далее$/i }));
    expect(
      await screen.findByRole("heading", { name: "Профиль" }),
    ).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Основная навигация" })).not.toBeInTheDocument();
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
    expect(screen.getByText(/на Главной доступны отдельные действия/i)).toBeVisible();
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
      expect(screen.getByRole("heading", { name: "Обучение", level: 1 })).toBeVisible();
      expect(screen.queryByText(/вызывайте соперника/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Основная навигация" })).toBeNull();
      expect(screen.getByTestId("location")).toHaveTextContent("/onboarding");
      await user.click(screen.getByRole("button", { name: /^далее$/i }));
    }
  });

  it("recovers a persisted next step with GET after a lost PATCH response without replay", async () => {
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
    let patchRequests = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input), "http://tab10.local").pathname;
      const method = String(init?.method ?? "GET").toUpperCase();
      if (path === "/api/v1/auth/me") return jsonResponse(200, { user: serverUser });
      if (path === "/api/v1/me/onboarding" && method === "PATCH") {
        patchRequests += 1;
        serverUser = { ...serverUser, onboardingStep: 4 };
        throw new TypeError("response lost");
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: "Далее" }));

    expect(await screen.findByRole("heading", { name: "Профиль" })).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(patchRequests).toBe(1);
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

  it.each([
    ["transport", new TypeError("connection lost")],
    ["5xx", Object.assign(new Error("service unavailable"), { status: 503 })],
  ])("keeps an unconfirmed tutorial creation explicit after %s failure", async (_label, failure) => {
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
    let tutorialRequests = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input), "http://tab10.local").pathname;
      if (path === "/api/v1/auth/me") return jsonResponse(200, { user: serverUser });
      if (path === "/api/v1/me/onboarding") return jsonResponse(200, { user: serverUser });
      if (path === "/api/v1/matches/tutorial") {
        tutorialRequests += 1;
        throw failure;
      }
      throw new Error(`Unexpected request: ${String(init?.method ?? "GET")} ${path}`);
    }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: /матч с призрачным олегом/i }));

    expect(await screen.findByText(/матч мог быть создан/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Начать ещё один учебный матч" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Завершить обучение" })).toBeEnabled();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(tutorialRequests).toBe(1);
  });

  it("never continues to tutorial POST after recovering a lost progress PATCH", async () => {
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
    let patchRequests = 0;
    let tutorialRequests = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input), "http://tab10.local").pathname;
      if (path === "/api/v1/auth/me") return jsonResponse(200, { user: serverUser });
      if (path === "/api/v1/me/onboarding") {
        patchRequests += 1;
        throw new TypeError("response lost");
      }
      if (path === "/api/v1/matches/tutorial") {
        tutorialRequests += 1;
        return jsonResponse(200, { match: { id: "must-not-start" } });
      }
      throw new Error(`Unexpected request: ${path}`);
    }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: /матч с призрачным олегом/i }));

    expect(await screen.findByText("Прогресс сохранён")).toBeVisible();
    expect(screen.getByText(/нажмите кнопку ещё раз/i)).toBeVisible();
    expect(patchRequests).toBe(1);
    expect(tutorialRequests).toBe(0);
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
        if (path === "/api/v1/profile/me") {
          return jsonResponse(200, {
            profile: {
              isOwn: true,
              canChallenge: false,
              identity: {
                id: serverUser.id,
                firstName: serverUser.firstName,
                lastName: serverUser.lastName,
                displayName: `${serverUser.lastName} ${serverUser.firstName}`,
                email: serverUser.email,
                birthDate: null,
                avatarKey: null,
                organizationText: null,
                positionText: null,
              },
              avatar: { key: null, editable: false },
              stats: {
                matchesPlayed: 0,
                wins: 0,
                losses: 0,
                winRate: 0,
                averagePoints: 0,
                tournamentsPlayed: 0,
                tournamentWins: 0,
                tournamentsCreated: 0,
                judgedMatches: 0,
                rank: null,
              },
              facts: {
                longestMatch: null,
                bestWinningScore: null,
                frequentOpponent: null,
                rival: null,
              },
              teams: [],
            },
          });
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
      await screen.findByRole("button", { name: /пройти обучение заново/i }),
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
