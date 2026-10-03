import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { App } from "./App";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

describe("Login navigation ownership", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["success", "unavailable"])("keeps unfinished onboarding when a redundant refresh is %s", async (refreshOutcome) => {
    const account = { id: "onboarding-user", email: "onboarding@tab10.test", role: "user", mustChangePassword: false,
      firstName: "Новый", lastName: "Игрок", onboardingStep: 0, onboardingCompletedAt: null };
    let authenticated = false;
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input), "http://tab10.local").pathname;
      if (path === "/api/v1/auth/login") {
        authenticated = true;
        return jsonResponse(200, { user: account });
      }
      if (path === "/api/v1/auth/me") {
        if (!authenticated) return jsonResponse(401, { code: "UNAUTHORIZED" });
        await refreshGate;
        if (refreshOutcome === "unavailable") throw new TypeError("Synthetic network failure");
        return jsonResponse(200, { user: account });
      }
      throw new Error(`Unexpected request: ${path}`);
    }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/login"]}><App /><LocationProbe /></MemoryRouter>);
    await user.type(await screen.findByLabelText("Email"), account.email);
    await user.type(screen.getByLabelText("Пароль", { exact: true }), "Synthetic9!");
    await user.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByRole("heading", { name: "Главная" })).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent("/onboarding");
    await act(async () => { releaseRefresh(); await refreshGate; });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/onboarding"));
    expect(screen.getByRole("heading", { name: "Главная" })).toHaveFocus();
  });
  it("prioritizes mandatory password change over onboarding and the return target", async () => {
    const account = { id: "temporary-user", email: "temporary@tab10.test", role: "user", mustChangePassword: true,
      firstName: "Новый", lastName: "Игрок", onboardingStep: 0, onboardingCompletedAt: null };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input), "http://tab10.local").pathname;
      if (path === "/api/v1/auth/login") return jsonResponse(200, { user: account });
      if (path === "/api/v1/auth/me") return jsonResponse(401, { code: "UNAUTHORIZED" });
      throw new Error(`Unexpected request: ${path}`);
    }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={[{ pathname: "/login", state: { returnTo: "/history" } }]}><App /><LocationProbe /></MemoryRouter>);
    await user.type(await screen.findByLabelText("Email"), account.email);
    await user.type(screen.getByLabelText("Пароль", { exact: true }), "Synthetic9!");
    await user.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByRole("heading", { name: "Смена пароля" })).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent("/first-password");
  });

});
