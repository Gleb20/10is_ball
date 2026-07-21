import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, Button, Chip } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, ListRow } from "../patterns";
import { initialsFromName } from "../rankingUi";
import { avatarSrc } from "../avatarSrc";
import { api } from "../api";
import { useAuth } from "../auth";

export function ProfilePage() {
  const { user, setUser } = useAuth();
  const [sessions, setSessions] = useState<
    Array<{ id: string; userAgent: string | null; current: boolean }> | null
  >(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    void api
      .sessions()
      .then((r) => setSessions(r.sessions))
      .catch((e) => setError(e.message));
    void api
      .home()
      .then((r) =>
        setUnreadCount(Number((r as { unreadCount?: number }).unreadCount ?? 0)),
      )
      .catch(() => setUnreadCount(0));
  }, []);

  const displayName = `${user?.lastName ?? ""} ${user?.firstName ?? ""}`.trim();

  return (
    <PageLayout title="Профиль">
      <div className="card profile-hero">
        <Avatar
          size="md"
          variant="contained"
          color="primary"
          src={avatarSrc(user?.avatarKey)}
          initials={initialsFromName(displayName || user?.email || "?")}
          alt={displayName}
        />
        <div>
          <strong>{displayName || "Пользователь"}</strong>
          <div className="muted">{user?.email}</div>
          <div className="row profile-hero__chips">
            <Chip
              size="sm"
              variant="tonal"
              color={user?.role === "admin" ? "primary" : "neutral"}
              label={user?.role === "admin" ? "Админ" : "Игрок"}
            />
          </div>
        </div>
      </div>

      <h2 className="section-title">Разделы</h2>
      <div className="stack">
        <ListRow
          to="/teams"
          title="Команды"
          subtitle="Создание и приглашения"
        />
        <ListRow
          to="/notifications"
          title="Уведомления"
          subtitle="Приглашения и события"
          trailing={
            unreadCount > 0 ? (
              <Chip
                size="sm"
                variant="tonal"
                color="primary"
                label={String(unreadCount)}
              />
            ) : null
          }
        />
        <ListRow to="/help" title="Помощь" subtitle="FAQ и обратная связь" />
        <ListRow
          to="/onboarding"
          title="Онбординг"
          subtitle="Учебный матч с Призрачным Олегом"
        />
        {user?.role === "admin" ? (
          <ListRow
            to="/admin"
            title="Админка"
            subtitle="Пользователи и доступ"
          />
        ) : null}
      </div>

      <h2 className="section-title">Сессии</h2>
      <AsyncState
        loading={sessions === null && !error}
        error={error}
        empty={sessions !== null && sessions.length === 0}
        emptyTitle="Нет сессий"
        skeletonCount={1}
      >
        <div className="stack">
          {(sessions ?? []).map((s) => (
            <ListRow
              key={s.id}
              title={s.userAgent ?? "Устройство"}
              trailing={
                s.current ? (
                  <Chip
                    size="sm"
                    variant="tonal"
                    color="success"
                    label="Текущая"
                  />
                ) : null
              }
            />
          ))}
        </div>
      </AsyncState>

      <Button
        variant="secondary"
        onClick={() =>
          api.logout().then(() => {
            setUser(null);
            navigate("/login");
          })
        }
      >
        Выйти
      </Button>
    </PageLayout>
  );
}
