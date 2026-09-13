import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
      scope: "all_time",
      team: null,
      availableTeams: [{ id: "team-1", name: "Ракетки" }],
      rankings: [
        { userId: "u1", displayName: "Self Player", wins: 8 },
        { userId: "u2", displayName: "Other Player", wins: 5 },
        { userId: "u3", displayName: "Third Player", wins: 4 },
        { userId: "u4", displayName: "Rest Player", wins: 3 },
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
    expect(
      within(selfSlot as HTMLElement).getByRole("link", { name: /self player/i }),
    ).toHaveAttribute("href", "/profile");

    await user.click(
      within(rivalSlot as HTMLElement).getByRole("button", { name: /вызов/i }),
    );
    expect(screen.getByLabelText("location")).toHaveTextContent(
      "/matches/new?opponentId=u2&opponentName=Other%20Player",
    );
  });

  it("RANK-002/004 switches Moscow period and own-team presentation", async () => {
    const user = userEvent.setup();
    rankings.mockImplementation(async (scope: string, teamId?: string) => ({
      scope,
      team: teamId
        ? { id: teamId, name: "Ракетки", activeMemberCount: 2, winsAllTime: 13 }
        : null,
      availableTeams: [{ id: "team-1", name: "Ракетки" }],
      rankings: [
        { userId: "u1", displayName: "Self Player", wins: 8 },
        { userId: "u4", displayName: "Rest Player", wins: 3 },
      ],
    }));
    render(
      <MemoryRouter initialEntries={["/rankings"]}>
        <AuthProvider>
          <RankingsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await screen.findByText("Self Player");
    expect(rankings).toHaveBeenCalledWith("all_time", undefined);
    expect(screen.getByText(/неделя и месяц.*по московскому времени/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Неделя" }));
    await waitFor(() => expect(rankings).toHaveBeenCalledWith("calendar_week", undefined));
    await user.click(screen.getByRole("button", { name: "Ракетки" }));
    await waitFor(() => expect(rankings).toHaveBeenCalledWith("calendar_week", "team-1"));
    expect(await screen.findByText(/13 побед за всё время/i)).toBeInTheDocument();
    expect(screen.getByText(/2 активных участника/i)).toBeInTheDocument();
  });

  it("RANK-005 opens a public card from every ranking row and keeps Challenge for a non-podium rival", async () => {
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

    const restRow = (await screen.findByText("Rest Player")).closest(".ranking-row");
    expect(restRow).not.toBeNull();
    expect(
      within(restRow as HTMLElement).getByRole("button", { name: /вызов/i }),
    ).toBeInTheDocument();
    await user.click(
      within(restRow as HTMLElement).getByRole("link", { name: /rest player/i }),
    );
    expect(screen.getByLabelText("location")).toHaveTextContent("/players/u4");
  });

  it("RANK-004/EMPTY offers a concrete team action when the actor has no teams", async () => {
    rankings.mockResolvedValue({
      scope: "all_time",
      team: null,
      availableTeams: [],
      rankings: [{ userId: "u1", displayName: "Self Player", wins: 0 }],
    });
    render(
      <MemoryRouter initialEntries={["/rankings"]}>
        <AuthProvider>
          <RankingsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/командный рейтинг станет доступен/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /создать команду/i })).toHaveAttribute("href", "/teams");
  });

  it("keeps the last valid ranking visible when an unavailable team refresh fails", async () => {
    const user = userEvent.setup();
    rankings.mockResolvedValueOnce({
      scope: "all_time",
      team: null,
      availableTeams: [{ id: "team-1", name: "Ракетки" }],
      rankings: [{ userId: "u2", displayName: "Other Player", wins: 5 }],
    });
    render(
      <MemoryRouter initialEntries={["/rankings"]}>
        <AuthProvider><RankingsPage /></AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Other Player")).toBeInTheDocument();
    rankings.mockRejectedValueOnce(new Error("Команда недоступна"));
    await user.click(screen.getByRole("button", { name: "Ракетки" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Команда недоступна");
    expect(screen.getByText("Other Player")).toBeInTheDocument();
  });
});
