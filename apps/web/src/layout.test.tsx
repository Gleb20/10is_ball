import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BottomNav, shouldShowBottomNav } from "./layout";

describe("REQ_shell__bottom_nav_d5", () => {
  it("renders five primary tabs from ADR D5", () => {
    render(
      <MemoryRouter>
        <BottomNav />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: /основная навигация/i });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /главная/i })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: /история/i })).toHaveAttribute(
      "href",
      "/history",
    );
    expect(screen.getByRole("link", { name: /начать/i })).toHaveAttribute(
      "href",
      "/start",
    );
    expect(screen.getByRole("link", { name: /рейтинг/i })).toHaveAttribute(
      "href",
      "/rankings",
    );
    expect(screen.getByRole("link", { name: /профиль/i })).toHaveAttribute(
      "href",
      "/profile",
    );
    expect(screen.queryByRole("link", { name: /^матчи$/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^турниры$/i }),
    ).not.toBeInTheDocument();
  });
});

describe("REQ_shell__hide_nav_on_judge_and_auth", () => {
  it("hides nav for judge, auth, and unauthenticated", () => {
    expect(
      shouldShowBottomNav("/matches/abc/judge", {
        authenticated: true,
        mustChangePassword: false,
      }),
    ).toBe(false);
    expect(
      shouldShowBottomNav("/login", {
        authenticated: false,
        mustChangePassword: false,
      }),
    ).toBe(false);
    expect(
      shouldShowBottomNav("/", {
        authenticated: true,
        mustChangePassword: true,
      }),
    ).toBe(false);
    expect(
      shouldShowBottomNav("/history", {
        authenticated: true,
        mustChangePassword: false,
      }),
    ).toBe(true);
  });
});
