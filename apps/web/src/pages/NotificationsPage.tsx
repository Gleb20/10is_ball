import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, ListRow } from "../patterns";
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
    case "invitation_revoked":
      return "приглашение отозвано";
    case "source_unavailable":
      return "исходное приглашение больше недоступно";
    default:
      return null;
  }
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const action = useSingleFlight();
  const [onlyActual, setOnlyActual] = useState(true);
  const readRequests = useRef(new Set<string>());

  async function load() {
    const res = await api.notifications();
    setItems(res.notifications as NotificationRow[]);
  }

  useEffect(() => {
    void load().catch((e) => setError(e.message));
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
        ids.forEach((id) => readRequests.current.delete(id));
        setActionError(caught.message);
      });
  }, [visible]);

  async function markRead(id: string) {
    await api.markNotificationRead(id);
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
  }

  async function respondTeamInvite(invitationId: string, accept: boolean) {
    await action.run(async () => {
      setActionError(null);
      try {
        await api.respondTeamInvitation(invitationId, accept);
        await load();
      } catch (e) {
        setActionError((e as Error).message);
      }
    });
  }

  async function respondTournamentInvite(
    invitationId: string,
    accept: boolean,
  ) {
    await action.run(async () => {
      setActionError(null);
      try {
        await api.respondTournamentInvitation(invitationId, accept);
        await load();
      } catch (e) {
        setActionError((e as Error).message);
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
              {n.type === "tournament_match_ready" &&
              n.payload?.matchId &&
              (n.lifecycle ?? "new") === "new" ? (
                <Button
                  size="sm"
                  onClick={() => {
                    void markRead(n.id);
                    navigate(`/matches/${n.payload!.matchId}`);
                  }}
                >
                  Открыть матч
                </Button>
              ) : null}
              {(n.lifecycle ?? "new") === "new" &&
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
