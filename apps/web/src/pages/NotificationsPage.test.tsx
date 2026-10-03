import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Activity, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { NotificationsPage } from "./NotificationsPage";

vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "test-user" } }) }));

const notifications = vi.fn();
const respondTeamInvitation = vi.fn();
const markNotificationRead = vi.fn();
const markNotificationsReadVisible = vi.fn();

vi.mock("../api", () => ({
  api: {
    notifications: (...args: unknown[]) => notifications(...args),
    markNotificationRead: (...args: unknown[]) => markNotificationRead(...args),
    markNotificationsReadVisible: (...args: unknown[]) =>
      markNotificationsReadVisible(...args),
    respondTeamInvitation: (...args: unknown[]) =>
      respondTeamInvitation(...args),
    respondTournamentInvitation: vi.fn(),
  },
}));

function LocationProbe() { const location = useLocation(); return <output data-testid="destination">{location.pathname}{location.search}</output>; }

function ActivityNotifications() {
  const [mode, setMode] = useState<"visible" | "hidden">("visible");
  return (
    <>
      <button onClick={() => setMode("hidden")}>Hide notifications</button>
      <button onClick={() => setMode("visible")}>Reveal notifications</button>
      <button>Fresh lifecycle focus</button>
      <Activity mode={mode}>
        <NotificationsPage />
      </Activity>
    </>
  );
}

describe("AT-NOTIF-005 terminal invitation lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markNotificationRead.mockImplementation(async (id: string) => ({
      ok: true,
      notification: { id, readAt: "2026-09-07T12:00:00.000Z" },
    }));
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
          actionable: true,
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

  it("BUG-037: removes only confirmed non-actionable reads, preserves team and handover actions, and moves focus", async () => {
    let resolveRead!: (value: {
      updated: number;
      notifications: Array<{ id: string; readAt: string }>;
    }) => void;
    markNotificationsReadVisible.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRead = resolve; }),
    );
    notifications.mockResolvedValueOnce({ notifications: [
      { id: "plain", type: "account_access_changed", title: "Обычное", body: "Событие", lifecycle: "new", actionable: false, readAt: null },
      { id: "team", type: "team_invitation", title: "Команда", body: "Можно ответить", lifecycle: "new", actionable: true, readAt: null, payload: { invitationId: "team-invite" } },
      { id: "handover", type: "judge_handover_offered", title: "Передача", body: "Примите судейство", lifecycle: "new", actionable: false, readAt: null, payload: { matchId: "match" } },
    ] });
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    const plainRead = await screen.findByRole("button", { name: "Отметить прочитанным" });
    await waitFor(() => expect(markNotificationsReadVisible).toHaveBeenCalledWith(["plain", "team", "handover"]));
    plainRead.focus();

    resolveRead({
      updated: 3,
      notifications: ["plain", "team", "handover"].map((id) => ({
        id,
        readAt: "2026-09-07T12:00:00.000Z",
      })),
    });

    await waitFor(() => expect(screen.queryByText("Обычное")).not.toBeInTheDocument());
    expect(screen.getByText("Команда")).toBeInTheDocument();
    expect(screen.getByText("Передача")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /принять|отклонить/i })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Открыть матч" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Команда" })).toHaveFocus();
  });

  it("BUG-037: keeps an omitted batch row unread and does not report local success", async () => {
    markNotificationsReadVisible.mockResolvedValueOnce({
      updated: 1,
      notifications: [{ id: "confirmed", readAt: "2026-09-07T12:00:00.000Z" }],
    });
    notifications.mockResolvedValueOnce({ notifications: [
      { id: "confirmed", type: "account_access_changed", title: "Подтверждено", body: "Событие", lifecycle: "new", actionable: false, readAt: null },
      { id: "omitted", type: "account_access_changed", title: "Не подтверждено", body: "Событие", lifecycle: "new", actionable: false, readAt: null },
    ] });
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);

    expect(await screen.findByText(/не удалось подтвердить чтение части уведомлений/i)).toBeInTheDocument();
    expect(screen.queryByText("Подтверждено")).not.toBeInTheDocument();
    expect(screen.getByText("Не подтверждено")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Не подтверждено" })).getByText("Новое")).toBeInTheDocument();
  });

  it("BUG-037: does not synthesize readAt when an individual read response has no notification", async () => {
    let resolveBatch!: (value: { updated: number; notifications: [] }) => void;
    markNotificationsReadVisible.mockImplementationOnce(
      () => new Promise((resolve) => { resolveBatch = resolve; }),
    );
    markNotificationRead.mockResolvedValueOnce({ ok: true, notification: null });
    notifications.mockResolvedValue({ notifications: [
      { id: "plain", type: "account_access_changed", title: "Обычное", body: "Событие", lifecycle: "new", actionable: false, readAt: null },
    ] });
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Отметить прочитанным" }));

    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith("plain"));
    expect(screen.getByText("Обычное")).toBeInTheDocument();
    expect(screen.getByText("Новое")).toBeInTheDocument();
    expect(screen.getByText(/не удалось подтвердить чтение уведомления/i)).toBeInTheDocument();
    await waitFor(() => expect(markNotificationsReadVisible).toHaveBeenCalledWith(["plain"]));
    resolveBatch({ updated: 0, notifications: [] });
  });

  it("BUG-037: moves focus to the list heading when an individually confirmed row is removed", async () => {
    markNotificationsReadVisible.mockImplementationOnce(() => new Promise(() => undefined));
    notifications.mockResolvedValueOnce({ notifications: [
      { id: "plain", type: "account_access_changed", title: "Обычное", body: "Событие", lifecycle: "new", actionable: false, readAt: null },
    ] });
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    const button = await screen.findByRole("button", { name: "Отметить прочитанным" });
    button.focus();
    fireEvent.click(button);

    await waitFor(() => expect(screen.queryByText("Обычное")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Список уведомлений" })).toHaveFocus();
  });

  it("BUG-037: an Activity resume rejects a queued focus move from the previous lifecycle", async () => {
    let resolveRead!: (value: {
      updated: number;
      notifications: Array<{ id: string; readAt: string }>;
    }) => void;
    markNotificationsReadVisible.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRead = resolve; }),
    );
    notifications.mockResolvedValueOnce({ notifications: [
      { id: "plain", type: "account_access_changed", title: "Обычное", body: "Событие", lifecycle: "new", actionable: false, readAt: null },
      { id: "team", type: "team_invitation", title: "Команда", body: "Можно ответить", lifecycle: "new", actionable: true, readAt: null, payload: { invitationId: "team-invite" } },
    ] });
    render(<MemoryRouter><ActivityNotifications /></MemoryRouter>);
    const plainRead = await screen.findByRole("button", { name: "Отметить прочитанным" });
    await waitFor(() => expect(markNotificationsReadVisible).toHaveBeenCalledWith(["plain", "team"]));
    plainRead.focus();
    const scheduled: Array<() => void> = [];
    const queueSpy = vi.spyOn(globalThis, "queueMicrotask").mockImplementation((callback) => {
      scheduled.push(callback);
    });

    await act(async () => resolveRead({
      updated: 2,
      notifications: ["plain", "team"].map((id) => ({
        id,
        readAt: "2026-09-07T12:00:00.000Z",
      })),
    }));
    await waitFor(() => expect(screen.queryByText("Обычное")).not.toBeInTheDocument());
    expect(scheduled.length).toBeGreaterThan(0);
    queueSpy.mockRestore();

    fireEvent.click(screen.getByRole("button", { name: "Hide notifications" }));
    fireEvent.click(screen.getByRole("button", { name: "Reveal notifications" }));
    const freshFocus = screen.getByRole("button", { name: "Fresh lifecycle focus" });
    freshFocus.focus();
    await act(async () => scheduled.at(-1)?.());

    expect(freshFocus).toHaveFocus();
  });
});
