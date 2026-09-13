import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { App } from "./App";

const activeUser = {
  id: "u1",
  email: "player@tab10.local",
  role: "user",
  mustChangePassword: false,
  firstName: "Иван",
  lastName: "Игрок",
};

const otherUser = {
  ...activeUser,
  id: "u2",
  email: "other@tab10.local",
  firstName: "Анна",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

describe("AT-AUTH-009 runtime session recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows login after a runtime 401 and restores the safe route with its unsaved form draft", async () => {
    let sessionValid = true;
    let createAttempts = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input), "http://tab10.local").pathname;
      const method = (init?.method ?? "GET").toUpperCase();

      if (path === "/api/v1/auth/me") {
        return sessionValid
          ? jsonResponse(200, { user: activeUser })
          : jsonResponse(401, {
              code: "UNAUTHORIZED",
              message: "Session expired",
            });
      }
      if (path === "/api/v1/users/directory") {
        return jsonResponse(200, { users: [] });
      }
      if (path === "/api/v1/matches" && method === "POST") {
        createAttempts += 1;
        sessionValid = false;
        return jsonResponse(401, {
          code: "UNAUTHORIZED",
          message: "Session expired",
        });
      }
      if (path === "/api/v1/auth/login" && method === "POST") {
        sessionValid = true;
        return jsonResponse(200, { user: activeUser });
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/matches/new"]}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    );

    const title = await screen.findByLabelText("Название");
    await user.clear(title);
    await user.type(title, "Финал после обеда");
    await user.click(screen.getByRole("button", { name: /^гость$/i }));
    await user.type(
      await screen.findByLabelText(/гость \(имя фамилия\)/i),
      "Анна Тестова",
    );
    await user.click(screen.getByRole("button", { name: /создать матч/i }));

    expect(await screen.findByRole("heading", { name: "Вход" })).toBeVisible();
    expect(screen.getByText(/сессия завершена/i)).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent("/matches/new");
    expect(createAttempts).toBe(1);

    await user.type(screen.getByLabelText("Email"), activeUser.email);
    await user.type(screen.getByLabelText("Пароль"), "ValidPass1!");
    await user.click(screen.getByRole("button", { name: /^войти$/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Вход" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("location")).toHaveTextContent("/matches/new");
    expect(screen.getByLabelText("Название")).toHaveValue("Финал после обеда");
    expect(screen.getByLabelText(/гость \(имя фамилия\)/i)).toHaveValue(
      "Анна Тестова",
    );
    expect(createAttempts).toBe(1);
    expect(screen.queryByText("Session expired")).not.toBeInTheDocument();
  });

  it("clears protected page state when reauthentication changes the actor", async () => {
    let sessionValid = true;
    let currentUser = activeUser;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input), "http://tab10.local").pathname;
      const method = (init?.method ?? "GET").toUpperCase();
      if (path === "/api/v1/auth/me") {
        return sessionValid
          ? jsonResponse(200, { user: currentUser })
          : jsonResponse(401, { code: "UNAUTHORIZED", message: "Session expired" });
      }
      if (path === "/api/v1/users/directory") {
        return jsonResponse(200, { users: [] });
      }
      if (path === "/api/v1/matches" && method === "POST") {
        sessionValid = false;
        return jsonResponse(401, { code: "UNAUTHORIZED", message: "Session expired" });
      }
      if (path === "/api/v1/auth/login" && method === "POST") {
        currentUser = otherUser;
        sessionValid = true;
        return jsonResponse(200, { user: otherUser });
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/matches/new"]}>
        <App />
      </MemoryRouter>,
    );
    const title = await screen.findByLabelText("Название");
    await user.clear(title);
    await user.type(title, "Черновик другого пользователя");
    await user.click(screen.getByRole("button", { name: /^гость$/i }));
    await user.type(
      await screen.findByLabelText(/гость \(имя фамилия\)/i),
      "Секретный соперник",
    );
    await user.click(screen.getByRole("button", { name: /создать матч/i }));
    await user.type(await screen.findByLabelText("Email"), otherUser.email);
    await user.type(screen.getByLabelText("Пароль"), "OtherPass1!");
    await user.click(screen.getByRole("button", { name: /^войти$/i }));

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Вход" })).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Название")).not.toHaveValue(
      "Черновик другого пользователя",
    );
    expect(screen.queryByDisplayValue("Секретный соперник")).not.toBeInTheDocument();
  });

  it("rejects an external post-login return target", async () => {
    let authenticated = false;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = new URL(String(input), "http://tab10.local").pathname;
        const method = (init?.method ?? "GET").toUpperCase();
        if (path === "/api/v1/auth/me") {
          return authenticated
            ? jsonResponse(200, { user: activeUser })
            : jsonResponse(401, {
                code: "UNAUTHORIZED",
                message: "No session",
              });
        }
        if (path === "/api/v1/auth/login" && method === "POST") {
          authenticated = true;
          return jsonResponse(200, { user: activeUser });
        }
        if (path === "/api/v1/home") return jsonResponse(200, {});
        throw new Error(`Unexpected request: ${method} ${path}`);
      }),
    );
    const user = userEvent.setup();

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/login",
            state: { returnTo: "https://evil.example/steal" },
          },
        ]}
      >
        <App />
        <LocationProbe />
      </MemoryRouter>,
    );

    await user.type(await screen.findByLabelText("Email"), activeUser.email);
    await user.type(screen.getByLabelText("Пароль"), "ValidPass1!");
    await user.click(screen.getByRole("button", { name: /^войти$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    });
  });

  it("returns a normally unauthenticated user to the requested internal route", async () => {
    let authenticated = false;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = new URL(String(input), "http://tab10.local").pathname;
        const method = (init?.method ?? "GET").toUpperCase();
        if (path === "/api/v1/auth/me") {
          return authenticated
            ? jsonResponse(200, { user: activeUser })
            : jsonResponse(401, {
                code: "UNAUTHORIZED",
                message: "No session",
              });
        }
        if (path === "/api/v1/auth/login" && method === "POST") {
          authenticated = true;
          return jsonResponse(200, { user: activeUser });
        }
        if (path === "/api/v1/matches") {
          return jsonResponse(200, { matches: [] });
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      }),
    );
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/matches?scope=recent#results"]}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    );

    await user.type(await screen.findByLabelText("Email"), activeUser.email);
    await user.type(screen.getByLabelText("Пароль"), "ValidPass1!");
    await user.click(screen.getByRole("button", { name: /^войти$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/matches");
    });
    expect(await screen.findByRole("heading", { name: "Матчи" })).toBeVisible();
  });
});
