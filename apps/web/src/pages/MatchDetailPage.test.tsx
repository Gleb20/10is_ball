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
    cancelMatch: vi.fn(),
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
        createdByUserId: "other",
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

describe("REQ_ui__match_cancel", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows cancel for organizer on waiting standalone match", async () => {
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
    getMatch.mockResolvedValue({
      match: {
        id: "m2",
        title: "Created",
        kind: "standalone",
        status: "waiting",
        scoreA: 0,
        scoreB: 0,
        createdByUserId: "u1",
        participants: [
          { side: "A", userId: "u1", displayName: "User A" },
          { side: "B", userId: "u2", displayName: "User B" },
        ],
        activeJudge: null,
      },
    });
    render(
      <MemoryRouter initialEntries={["/matches/m2"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("button", { name: /^отменить матч$/i }),
    ).toBeInTheDocument();
  });

  it("hides cancel for outsider on waiting match", async () => {
    me.mockResolvedValue({
      user: {
        id: "outsider",
        email: "x@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "X",
        lastName: "User",
      },
    });
    getMatch.mockResolvedValue({
      match: {
        id: "m3",
        title: "Other",
        kind: "standalone",
        status: "waiting",
        scoreA: 0,
        scoreB: 0,
        createdByUserId: "u1",
        participants: [
          { side: "A", userId: "u1", displayName: "User A" },
          { side: "B", userId: "u2", displayName: "User B" },
        ],
        activeJudge: null,
      },
    });
    render(
      <MemoryRouter initialEntries={["/matches/m3"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Other")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^отменить матч$/i }),
    ).not.toBeInTheDocument();
  });
});
