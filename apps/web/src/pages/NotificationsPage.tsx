import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, ListRow } from "../patterns";
import { api } from "../api";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt?: string | null;
  lifecycle?: "new" | "accepted" | "declined" | "read" | "expired";
  payload?: {
    invitationId?: string;
    teamId?: string;
    tournamentId?: string;
    matchId?: string;
  };
};

function lifecycleLabel(n: NotificationRow): string {
  switch (n.lifecycle) {
    case "accepted":
      return "Принято";
    case "declined":
      return "Отклонено";
    case "expired":
      return "Истекло";
    case "read":
      return "Прочитано";
    default:
      return "Новое";
  }
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [onlyActual, setOnlyActual] = useState(true);

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
    return all.filter((n) => (n.lifecycle ?? "new") === "new");
  }, [items, onlyActual]);

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
    setBusyId(invitationId);
    setActionError(null);
    try {
      await api.respondTeamInvitation(invitationId, accept);
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function respondTournamentInvite(
    invitationId: string,
    accept: boolean,
  ) {
    setBusyId(invitationId);
    setActionError(null);
    try {
      await api.respondTournamentInvitation(invitationId, accept);
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const isInviteActionable = (n: NotificationRow) =>
    (n.lifecycle ?? "new") === "new" &&
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
              {n.type === "team_invitation" &&
              n.payload?.invitationId &&
              isInviteActionable(n) ? (
                <div className="row">
                  <Button
                    size="sm"
                    disabled={busyId === n.payload.invitationId}
                    onClick={() =>
                      void respondTeamInvite(n.payload!.invitationId!, true)
                    }
                  >
                    Принять
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busyId === n.payload.invitationId}
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
                    disabled={busyId === n.payload.invitationId}
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
                    disabled={busyId === n.payload.invitationId}
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
