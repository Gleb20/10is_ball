import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider } from "../auth";
import { RankingsPage } from "./RankingsPage";

const rankings = vi.fn();

vi.mock("../api", () => ({
  api: {
    me: vi.fn().mockResolvedValue({
      user: {
        id: "u1",
        email: "self@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "Self",
        lastName: "Player",
      },
    }),
    rankings: (...args: unknown[]) => rankings(...args),
  },
}));

function LocationProbe() {
  return <output aria-label="location">{useLocation().pathname + useLocation().search}</output>;
}

describe("BUG-010 ranking challenge guard", () => {
  beforeEach(() => {
    cleanup();
    rankings.mockResolvedValue({
      rankings: [
        { userId: "u1", displayName: "Self Player", wins: 8 },
        { userId: "u2", displayName: "Other Player", wins: 5 },
      ],
    });
  });

  it("does not offer Challenge for the current user and keeps it for a rival", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/rankings"]}>
        <AuthProvider>
          <Routes>
            <Route path="*" element={<><RankingsPage /><LocationProbe /></>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    const selfSlot = (await screen.findByText("Self Player")).closest(
      ".podium__slot",
    );
    const rivalSlot = screen.getByText("Other Player").closest(".podium__slot");
    expect(selfSlot).not.toBeNull();
    expect(rivalSlot).not.toBeNull();
    expect(
      within(selfSlot as HTMLElement).queryByRole("button", { name: /вызов/i }),
    ).not.toBeInTheDocument();

    await user.click(
      within(rivalSlot as HTMLElement).getByRole("button", { name: /вызов/i }),
    );
    expect(screen.getByLabelText("location")).toHaveTextContent(
      "/matches/new?opponentId=u2&opponentName=Other%20Player",
    );
  });
});
