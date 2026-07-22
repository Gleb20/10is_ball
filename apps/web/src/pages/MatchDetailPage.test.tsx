import { render, screen, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MatchDetailPage } from "./MatchDetailPage";
import { AuthProvider } from "../auth";

const getMatch = vi.fn();
const me = vi.fn();

vi.mock("../api", () => ({
  api: {
    me: (...a: unknown[]) => me(...a),
    getMatch: (...a: unknown[]) => getMatch(...a),
    startMatch: vi.fn(),
    stopMatch: vi.fn(),
    adminForceCloseMatch: vi.fn(),
    adminDeleteMatch: vi.fn(),
  },
}));

describe("REQ_ui__admin_match_ops", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    me.mockResolvedValue({
      user: {
        id: "admin1",
        email: "admin@tab10.local",
        role: "admin",
        mustChangePassword: false,
        firstName: "Admin",
        lastName: "User",
      },
    });
    getMatch.mockResolvedValue({
      match: {
        id: "m1",
        title: "Stuck",
        kind: "standalone",
        status: "in_progress",
        scoreA: 1,
        scoreB: 0,
        participants: [],
        activeJudge: null,
      },
    });
  });

  it("shows force-close and delete for admin on standalone active match", async () => {
    render(
      <MemoryRouter initialEntries={["/matches/m1"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("button", { name: /принудительно закрыть/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /удалить из истории/i }),
    ).toBeInTheDocument();
  });

  it("hides admin CTAs for non-admin", async () => {
    me.mockResolvedValue({
      user: {
        id: "u1",
        email: "a@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "A",
        lastName: "User",
      },
    });
    render(
      <MemoryRouter initialEntries={["/matches/m1"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Stuck")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /принудительно закрыть/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /удалить из истории/i }),
    ).not.toBeInTheDocument();
  });
});
