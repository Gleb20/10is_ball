import { useEffect, useState } from "react";
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
  payload?: { invitationId?: string; teamId?: string };
  createdAt?: string;
};

export function NotificationsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const res = await api.notifications();
    setItems(res.notifications as NotificationRow[]);
  }

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);

  async function markRead(id: string) {
    await api.markNotificationRead(id);
    setItems((prev) =>
      (prev ?? []).map((n) =>
        n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
      ),
    );
  }

  async function respondInvite(invitationId: string, accept: boolean) {
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

  return (
    <PageLayout title="Уведомления">
      <div className="stack stack--actions">
        <Button variant="secondary" onClick={() => navigate(-1)}>
          Назад
        </Button>
      </div>
      {actionError ? (
        <Alert type="error" variant="tonal" title="Ошибка" description={actionError} />
      ) : null}
      <AsyncState
        loading={items === null && !error}
        error={error}
        empty={items !== null && items.length === 0}
        emptyTitle="Нет уведомлений"
        emptyDescription="Приглашения в команды и другие события появятся здесь."
        emptyAction={
          <Button variant="secondary" onClick={() => navigate("/")}>
            На главную
          </Button>
        }
      >
        <div className="stack">
          {(items ?? []).map((n) => (
            <div key={n.id} className="card stack">
              <ListRow
                title={n.title}
                subtitle={n.body}
                trailing={
                  n.readAt ? (
                    <span className="muted">Прочитано</span>
                  ) : (
                    <span className="muted">Новое</span>
                  )
                }
              />
              {n.type === "team_invitation" && n.payload?.invitationId ? (
                <div className="row">
                  <Button
                    size="sm"
                    disabled={busyId === n.payload.invitationId}
                    onClick={() =>
                      void respondInvite(n.payload!.invitationId!, true).then(
                        () => markRead(n.id),
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
                      void respondInvite(n.payload!.invitationId!, false).then(
                        () => markRead(n.id),
                      )
                    }
                  >
                    Отклонить
                  </Button>
                </div>
              ) : (
                !n.readAt && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void markRead(n.id)}
                  >
                    Отметить прочитанным
                  </Button>
                )
              )}
            </div>
          ))}
        </div>
      </AsyncState>
    </PageLayout>
  );
}
