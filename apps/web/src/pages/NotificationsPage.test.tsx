import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { NotificationsPage } from "./NotificationsPage";

vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "test-user" } }) }));

const notifications = vi.fn();
const respondTeamInvitation = vi.fn();
const markNotificationsReadVisible = vi.fn();

vi.mock("../api", () => ({
  api: {
    notifications: (...args: unknown[]) => notifications(...args),
    markNotificationRead: vi.fn(),
    markNotificationsReadVisible: (...args: unknown[]) =>
      markNotificationsReadVisible(...args),
    respondTeamInvitation: (...args: unknown[]) =>
      respondTeamInvitation(...args),
    respondTournamentInvitation: vi.fn(),
  },
}));

function LocationProbe() { const location = useLocation(); return <output data-testid="destination">{location.pathname}{location.search}</output>; }

describe("AT-NOTIF-005 terminal invitation lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markNotificationsReadVisible.mockImplementation(
      async (ids: string[]) => ({
        updated: ids.length,
        notifications: ids.map((id) => ({
          id,
          readAt: "2026-09-07T12:00:00.000Z",
        })),
      }),
    );
    notifications.mockResolvedValue({
      notifications: [
        {
          id: "cancelled",
          type: "tournament_invitation",
          title: "Отменённый турнир",
          body: "Состав закрыт",
          lifecycle: "cancelled",
          createdAt: "2026-09-07T09:00:00.000Z",
          lifecycleAt: "2026-09-07T10:00:00.000Z",
          reasonCode: "event_cancelled",
          payload: { invitationId: "cancelled-invite" },
        },
        {
          id: "expired",
          type: "team_invitation",
          title: "Истёкшая команда",
          body: "Прошло 14 дней",
          lifecycle: "expired",
          createdAt: "2026-08-24T10:00:00.000Z",
          lifecycleAt: "2026-09-07T10:00:00.000Z",
          reasonCode: "timeout",
          payload: { invitationId: "expired-invite" },
        },
        {
          id: "new",
          type: "team_invitation",
          title: "Актуальная команда",
          body: "Можно ответить",
          lifecycle: "new",
          actionable: true,
          createdAt: "2026-09-07T11:55:00.000Z",
          payload: { invitationId: "new-invite" },
        },
      ],
    });
  });

  afterEach(() => cleanup());

  it("AT-TEAM-005 opens the accepted team's welcome screen", async () => {
    const teamId = "12345678-1234-4234-8234-123456789abc";
    respondTeamInvitation.mockResolvedValue({ status: "accepted", teamId });
    render(<MemoryRouter><NotificationsPage /><LocationProbe /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Принять" }));
    await waitFor(() => expect(screen.getByTestId("destination")).toHaveTextContent(`/teams/${teamId}?welcome=1`));
  });

  it("filters terminal cards from actual and never renders their actions", async () => {
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Актуальная команда")).toBeInTheDocument();
    expect(screen.queryByText("Отменённый турнир")).not.toBeInTheDocument();
    expect(screen.queryByText("Истёкшая команда")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /принять|отклонить/i })).toHaveLength(2);

    await waitFor(() =>
      expect(markNotificationsReadVisible).toHaveBeenCalledWith(["new"]),
    );
    expect(await screen.findByText("Прочитано")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Актуальные" }));
    expect(screen.queryByText("Отменённый турнир")).not.toBeInTheDocument();
    expect(screen.getByText("Истёкшая команда")).toBeInTheDocument();
    expect(screen.queryByText("Отменено")).not.toBeInTheDocument();
    expect(screen.getByText("Истекло")).toBeInTheDocument();
    expect(screen.getByText(/Причина: срок приглашения истёк/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /принять|отклонить/i })).toHaveLength(2);
  });

  it("BUG-009: sends one invitation response while the action is pending", async () => {
    let resolveResponse!: (value: { ok: boolean }) => void;
    respondTeamInvitation.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    );
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>,
    );

    const accept = await screen.findByRole("button", { name: "Принять" });
    fireEvent.click(accept);
    fireEvent.click(accept);

    expect(respondTeamInvitation).toHaveBeenCalledTimes(1);
    expect(accept).toBeDisabled();
    resolveResponse({ ok: true });
  });

  it("GAP-029: old API rows never expose hidden invitations or mark them read", async () => {
    notifications.mockResolvedValue({ notifications: [
      ...Array.from({ length: 7 }, (_, index) => ({
        id: `hidden-${index}`, type: index % 2 ? "judge_invitation" : "match_invitation",
        title: `Hidden ${index}`, body: "Game", lifecycle: "new", readAt: null,
      })),
      { id: "tournament", type: "tournament_invitation", title: "Hidden tournament", body: "Tournament", lifecycle: "new", readAt: null },
      { id: "team", type: "team_invitation", title: "Team remains", body: "Team", lifecycle: "new", actionable: true, readAt: null, payload: { invitationId: "team-invite" } },
      { id: "handover", type: "judge_handover_offered", title: "Handover remains", body: "Judge", lifecycle: "new", readAt: null, payload: { matchId: "match" } },
    ] });
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    expect(await screen.findByText("Team remains")).toBeInTheDocument();
    expect(screen.getByText("Handover remains")).toBeInTheDocument();
    expect(screen.queryByText(/Hidden/)).not.toBeInTheDocument();
    await waitFor(() => expect(markNotificationsReadVisible).toHaveBeenCalledWith(["team", "handover"]));
    expect(screen.getAllByRole("button", { name: /принять|отклонить/i })).toHaveLength(2);
  });
});
