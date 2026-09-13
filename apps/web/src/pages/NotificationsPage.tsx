import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, ListRow } from "../patterns";
import { useAuth } from "../auth";
import { useVisibleRefresh } from "../useVisibleRefresh";
import { api } from "../api";
import { useSingleFlight } from "../useSingleFlight";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt?: string | null;
  createdAt?: string;
  actionable?: boolean;
  reasonCode?: string | null;
  lifecycleAt?: string | null;
  expiresAt?: string | null;
  lifecycle?:
    | "new"
    | "accepted"
    | "declined"
    | "read"
    | "expired"
    | "cancelled";
  payload?: {
    invitationId?: string;
    teamId?: string;
    tournamentId?: string;
    matchId?: string;
  };
};

function lifecycleLabel(n: NotificationRow): string {
  if ((n.lifecycle === "new" || !n.lifecycle) && n.readAt) {
    return "Прочитано";
  }
  switch (n.lifecycle) {
    case "accepted":
      return "Принято";
    case "declined":
      return "Отклонено";
    case "expired":
      return "Истекло";
    case "cancelled":
      return "Отменено";
    case "read":
      return "Прочитано";
    default:
      return "Новое";
  }
}

const notificationDateTime = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Moscow",
});

function formatNotificationTime(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : notificationDateTime.format(date);
}

function reasonLabel(reasonCode?: string | null): string | null {
  switch (reasonCode) {
    case "timeout":
      return "срок приглашения истёк";
    case "match_started": return "матч уже начался";
    case "event_started": return "событие уже началось";
    case "match_finished": case "event_finished": return "событие завершено";
    case "match_cancelled": case "event_cancelled": return "событие отменено";
    case "side_changed": return "сторона игрока изменена";
    case "roster_changed": case "roster_closed": return "состав изменён или закрыт";
    case "invitation_revoked":
      return "приглашение отозвано";
    case "source_unavailable":
      return "исходное приглашение больше недоступно";
    default:
      return null;
  }
}

export function NotificationsPage() {
  const { user } = useAuth();
  return <ActorNotificationsPage key={user?.id ?? "anonymous"} userId={user?.id} />;
}

function ActorNotificationsPage({ userId }: { userId?: string }) {
  const navigate = useNavigate();
  const sequence = useRef(0);
  const mounted = useRef(true);
  const mutating = useRef(false);
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const action = useSingleFlight();
  const [onlyActual, setOnlyActual] = useState(true);
  const readRequests = useRef(new Set<string>());

  const load = useCallback(async (force = false) => {
    if (!userId || (mutating.current && !force)) return;
    const current = ++sequence.current;
    const res = await api.notifications();
    if (mounted.current && current === sequence.current) setItems(res.notifications as NotificationRow[]);
  }, [userId]);
  const { error, refreshNow } = useVisibleRefresh(load, { refreshKey: userId });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const visible = useMemo(() => {
    const all = items ?? [];
    if (!onlyActual) return all;
    return all.filter(
      (n) => n.actionable || (n.lifecycle ?? "new") === "new",
    );
  }, [items, onlyActual]);

  useEffect(() => {
    const ids = visible
      .filter((notification) => !notification.readAt)
      .map((notification) => notification.id)
      .filter((id) => !readRequests.current.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => readRequests.current.add(id));
    void api
      .markNotificationsReadVisible(ids)
      .then((response) => {
        if (!mounted.current) return;
        const readAtById = new Map(
          response.notifications.map((notification) => [
            notification.id,
            notification.readAt,
          ]),
        );
        setItems((current) =>
          (current ?? []).map((notification) => ({
            ...notification,
            readAt: readAtById.get(notification.id) ?? notification.readAt,
          })),
        );
      })
      .catch((caught: Error) => {
        if (!mounted.current) return;
        ids.forEach((id) => readRequests.current.delete(id));
        if ((caught as Error & { status?: number }).status !== 401) setActionError(caught.message);
      });
  }, [visible]);

  async function markRead(id: string) {
    try {
    await api.markNotificationRead(id);
    if (!mounted.current) return;
    setItems((prev) =>
      (prev ?? []).map((n) =>
        n.id === id
          ? {
              ...n,
              readAt: new Date().toISOString(),
              lifecycle:
                n.lifecycle === "new" || !n.lifecycle ? "read" : n.lifecycle,
            }
          : n,
      ),
    );
    } catch (cause) {
      if (!mounted.current) return;
      if ((cause as Error & { status?: number }).status !== 401) setActionError((cause as Error).message);
    }
  }

  async function respondTeamInvite(invitationId: string, accept: boolean) {
    await action.run(async () => {
      mutating.current = true;
      sequence.current += 1;
      setActionError(null);
      try {
        const result = await api.respondTeamInvitation(invitationId, accept);
        if (!mounted.current) return;
        if (accept && result?.status === "accepted" && result.teamId) {
          navigate(`/teams/${result.teamId}?welcome=1`);
          return;
        }
        await load(true);
      } catch (e) {
        if (!mounted.current) return;
        if ((e as Error & { status?: number }).status !== 401) { setActionError((e as Error).message); await load(true); }
      } finally {
        mutating.current = false;
      }
    });
  }

  async function respondTournamentInvite(
    invitationId: string,
    accept: boolean,
  ) {
    await action.run(async () => {
      mutating.current = true;
      sequence.current += 1;
      setActionError(null);
      try {
        await api.respondTournamentInvitation(invitationId, accept);
        if (!mounted.current) return;
        await load(true);
      } catch (e) {
        if (!mounted.current) return;
        if ((e as Error & { status?: number }).status !== 401) { setActionError((e as Error).message); await load(true); }
      } finally {
        mutating.current = false;
      }
    });
  }

  async function respondMatchInvite(invitationId: string, accept: boolean, judge: boolean) {
    await action.run(async () => {
      mutating.current = true;
      sequence.current += 1;
      setActionError(null);
      try {
        const result = await api.respondMatchInvitation(invitationId, accept);
        if (!mounted.current) return;
        if (accept && result.invitation.status === "accepted") {
          navigate(`/matches/${result.invitation.matchId}${judge ? "/judge" : ""}`);
          return;
        }
        await load(true);
      } catch (cause) {
        if (!mounted.current) return;
        if ((cause as Error & { status?: number }).status !== 401) { setActionError((cause as Error).message); await load(true); }
      } finally {
        mutating.current = false;
      }
    });
  }

  const isInviteActionable = (n: NotificationRow) =>
    (n.actionable ?? (n.lifecycle ?? "new") === "new") &&
    Boolean(n.payload?.invitationId);

  return (
    <PageLayout title="Уведомления">
      <div className="stack stack--actions">
        <Button variant="secondary" onClick={() => navigate(-1)}>
          Назад
        </Button>
      </div>
      <label className="row" style={{ gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={onlyActual}
          onChange={(e) => setOnlyActual(e.target.checked)}
        />
        <span>Актуальные</span>
      </label>
      {actionError ? (
        <Alert type="error" variant="tonal" title="Ошибка" description={actionError} />
      ) : null}
      <Button variant="secondary" disabled={action.pending} onClick={() => void refreshNow()}>Обновить уведомления</Button>
      <AsyncState
        loading={items === null && !error}
        error={error}
        empty={items !== null && visible.length === 0}
        emptyTitle={onlyActual ? "Нет актуальных уведомлений" : "Нет уведомлений"}
        emptyDescription={
          onlyActual
            ? "Снимите «Актуальные», чтобы увидеть историю."
            : "Приглашения в команды и другие события появятся здесь."
        }
        emptyAction={
          <Button variant="secondary" onClick={() => navigate("/")}>
            На главную
          </Button>
        }
      >
        <div className="stack">
          {visible.map((n) => (
            <div key={n.id} className="card stack">
              <ListRow
                title={n.title}
                subtitle={n.body}
                trailing={
                  <span className="muted">{lifecycleLabel(n)}</span>
                }
              />
              {formatNotificationTime(n.createdAt) ? (
                <time className="muted" dateTime={n.createdAt}>
                  Создано: {formatNotificationTime(n.createdAt)}
                </time>
              ) : null}
              {reasonLabel(n.reasonCode) ? (
                <p className="muted">
                  Причина: {reasonLabel(n.reasonCode)}
                  {formatNotificationTime(n.lifecycleAt)
                    ? ` · ${formatNotificationTime(n.lifecycleAt)}`
                    : ""}
                </p>
              ) : null}
              {["match_invitation", "judge_invitation"].includes(n.type) && n.payload?.invitationId && isInviteActionable(n) ? (
                <div className="row">
                  <Button disabled={action.pending} onClick={() => void respondMatchInvite(n.payload!.invitationId!, true, n.type === "judge_invitation")}>Принять</Button>
                  <Button variant="secondary" disabled={action.pending} onClick={() => void respondMatchInvite(n.payload!.invitationId!, false, n.type === "judge_invitation")}>Отклонить</Button>
                </div>
              ) : null}
              {n.type === "team_invitation" &&
              n.payload?.invitationId &&
              isInviteActionable(n) ? (
                <div className="row">
                  <Button
                    size="sm"
                    disabled={action.pending}
                    onClick={() =>
                      void respondTeamInvite(n.payload!.invitationId!, true)
                    }
                  >
                    Принять
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={action.pending}
                    onClick={() =>
                      void respondTeamInvite(n.payload!.invitationId!, false)
                    }
                  >
                    Отклонить
                  </Button>
                </div>
              ) : null}
              {n.type === "tournament_invitation" &&
              n.payload?.invitationId &&
              isInviteActionable(n) ? (
                <div className="row">
                  <Button
                    size="sm"
                    disabled={action.pending}
                    onClick={() =>
                      void respondTournamentInvite(
                        n.payload!.invitationId!,
                        true,
                      )
                    }
                  >
                    Принять
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={action.pending}
                    onClick={() =>
                      void respondTournamentInvite(
                        n.payload!.invitationId!,
                        false,
                      )
                    }
                  >
                    Отклонить
                  </Button>
                </div>
              ) : null}
              {!isInviteActionable(n) && n.payload?.matchId && !["expired", "cancelled", "declined"].includes(n.lifecycle ?? "") ? (
                <Button variant="secondary" onClick={() => navigate(`/matches/${n.payload!.matchId}${["judge_invitation", "judge_handover", "judge_handover_offered"].includes(n.type) ? "/judge" : ""}`)}>Открыть матч</Button>
              ) : null}
              {!isInviteActionable(n) && n.payload?.teamId && ["team_captain_assigned", "captain_assigned"].includes(n.type) ? <Button variant="secondary" onClick={() => navigate(`/teams/${n.payload!.teamId}`)}>Открыть команду</Button> : null}
              {!isInviteActionable(n) && n.payload?.tournamentId && n.type !== "tournament_invitation" ? <Button variant="secondary" onClick={() => navigate(`/tournaments/${n.payload!.tournamentId}`)}>Открыть турнир</Button> : null}
              {(n.lifecycle ?? "new") === "new" &&
              n.type !== "match_invitation" && n.type !== "judge_invitation" &&
              n.type !== "team_invitation" &&
              n.type !== "tournament_invitation" &&
              n.type !== "tournament_match_ready" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void markRead(n.id)}
                >
                  Отметить прочитанным
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </AsyncState>
    </PageLayout>
  );
}
