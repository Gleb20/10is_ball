import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppShell, TaskNavigation } from "./layout";
import { AsyncState } from "./patterns";
import { AuthLayout } from "./authUi";
import { Button } from "./ui";

function setViewport(width: number, height = 640) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
}

describe("REQ_ui__a11y_360_smoke", () => {
  beforeEach(() => {
    setViewport(360);
  });

  afterEach(() => {
    setViewport(1024, 768);
  });

  it("renders task context navigation without a persistent tab bar", () => {
    render(
      <MemoryRouter initialEntries={["/history"]}>
        <div>
          <TaskNavigation />
        </div>
      </MemoryRouter>,
    );
    expect(screen.getByRole("navigation", { name: "Возврат" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /основная навигация/i })).not.toBeInTheDocument();
  });

  it("exposes skip link and main landmark in AppShell", () => {
    render(
      <MemoryRouter>
        <AppShell showTaskNav>
          <p>Контент</p>
        </AppShell>
      </MemoryRouter>,
    );
    const skip = screen.getByRole("link", { name: /к содержимому/i });
    expect(skip).toHaveAttribute("href", "#main-content");
    expect(document.getElementById("main-content")).toBeTruthy();
  });

  it("hides skip link in immersive judge shell", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/matches/m1/judge"]}>
        <AppShell showTaskNav={false}>
          <p>Judge</p>
        </AppShell>
      </MemoryRouter>,
    );
    expect(container.querySelector(".app-shell--immersive")).toBeTruthy();
    expect(
      container.querySelector(".skip-link"),
    ).not.toBeInTheDocument();
  });

  it("AT-EMPTY-001 empty state includes actionable CTA", () => {
    render(
      <AsyncState
        loading={false}
        empty
        emptyTitle="Нет матчей"
        emptyDescription="Создайте первый матч."
        emptyAction={<Button>Создать матч</Button>}
      >
        <div>hidden</div>
      </AsyncState>,
    );
    expect(screen.getByText("Нет матчей")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /создать матч/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("hidden")).not.toBeInTheDocument();
  });

  it("auth layout exposes brand and heading", () => {
    render(
      <div>
        <AuthLayout title="Вход" subtitle="Тест">
          <p>form</p>
        </AuthLayout>
      </div>,
    );
    expect(screen.getByTestId("auth-layout")).toBeInTheDocument();
    expect(screen.getByLabelText("Tab-10")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Вход" })).toBeInTheDocument();
  });

  it("stylesheet declares focus, skip-link, and touch floors", () => {
    const css = readFileSync(resolve(__dirname, "styles.css"), "utf8");
    expect(css).toMatch(/\.skip-link/);
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/prefers-reduced-motion/);
    expect(css).toMatch(/\.home-action\s*\{[^}]*min-height:\s*48px/s);
    expect(css).toMatch(/\.list-row\s*\{[^}]*min-height:\s*56px/s);
  });
});
