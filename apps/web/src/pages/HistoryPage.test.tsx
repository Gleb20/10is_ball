import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../auth";
import { HistoryPage } from "./HistoryPage";

const me = vi.fn();
const listMatches = vi.fn();
const listTournaments = vi.fn();

vi.mock("../api", () => ({
  api: {
    me: (...args: unknown[]) => me(...args),
    listMatches: (...args: unknown[]) => listMatches(...args),
    listTournaments: (...args: unknown[]) => listTournaments(...args),
    adminDeleteMatch: vi.fn(),
  },
}));

describe("AT-ADM-MATCH-007 history purge visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    me.mockResolvedValue({
      user: {
        id: "admin",
        email: "admin@tab10.local",
        role: "admin",
        mustChangePassword: false,
        firstName: "Admin",
        lastName: "User",
      },
    });
    listTournaments.mockResolvedValue({ tournaments: [] });
    listMatches.mockResolvedValue({
      matches: [
        {
          id: "waiting",
          title: "Черновик",
          kind: "standalone",
          status: "waiting",
          scoreA: 0,
          scoreB: 0,
          updatedAt: "2026-09-07T10:00:00.000Z",
        },
        {
          id: "finished",
          title: "Завершённый",
          kind: "standalone",
          status: "finished",
          scoreA: 11,
          scoreB: 8,
          updatedAt: "2026-09-07T11:00:00.000Z",
        },
        {
          id: "voided",
          title: "Аннулированный",
          kind: "standalone",
          status: "voided",
          scoreA: 11,
          scoreB: 9,
          updatedAt: "2026-09-07T12:00:00.000Z",
        },
      ],
    });
  });

  afterEach(() => cleanup());

  it("shows hard purge only for non-finished standalone records", async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <HistoryPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Завершённый")).toBeInTheDocument();
    expect(screen.getByText("Аннулированный")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^удалить$/i })).toHaveLength(1);
  });
});
