import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Alert, Avatar, Button, Chip, Dialog, TextField } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, ListRow } from "../patterns";
import { initialsFromName } from "../rankingUi";
import { avatarSrc } from "../avatarSrc";
import { api, type AuthSession, type PlayerProfile } from "../api";
import { useAuth } from "../auth";
import { useSingleFlight } from "../useSingleFlight";

function formatBirthDate(value?: string | null) {
  if (!value) return "Не указана";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

type EditDraft = {
  firstName: string;
  lastName: string;
  birthDate: string;
  organizationText: string;
  positionText: string;
};

export function ProfilePage() {
  const { user, setUser } = useAuth();
  const { userId } = useParams<{ userId: string }>();
  const publicProfile = Boolean(userId);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [sessions, setSessions] = useState<AuthSession[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [sessionToRevoke, setSessionToRevoke] = useState<AuthSession | null>(null);
  const navigate = useNavigate();
  const onboardingRestart = useSingleFlight();
  const profileSave = useSingleFlight();
  const sessionRevoke = useSingleFlight();
  const profileRequestSequence = useRef(0);
  const sessionRequestSequence = useRef(0);

  const loadProfile = useCallback(async () => {
    const sequence = ++profileRequestSequence.current;
    try {
      const response = userId
        ? await api.playerProfile(userId)
        : await api.ownProfile();
      if (sequence === profileRequestSequence.current) {
        setProfile(response.profile);
      }
    } catch (loadError) {
      if (sequence === profileRequestSequence.current) throw loadError;
    }
  }, [userId]);

  const loadSessions = useCallback(async () => {
    const sequence = ++sessionRequestSequence.current;
    setSessionError(null);
    try {
      const response = await api.sessions();
      if (sequence === sessionRequestSequence.current) {
        setSessions(response.sessions);
      }
    } catch (loadError) {
      if (sequence === sessionRequestSequence.current) throw loadError;
    }
  }, []);

  function restartOnboarding() {
    void onboardingRestart.run(async () => {
      setActionError(null);
      try {
        const result = await api.restartOnboarding();
        setUser(result.user);
        navigate("/onboarding");
      } catch (restartError) {
        setActionError((restartError as Error).message);
      }
    });
  }

  useEffect(() => {
    if (!user) return;
    setProfile(null);
    setError(null);
    void loadProfile().catch((loadError) =>
      setError((loadError as Error).message),
    );
    if (!publicProfile) {
      void loadSessions().catch((loadError) =>
        setSessionError((loadError as Error).message),
      );
      void api
        .home()
        .then((response) => setUnreadCount(response.unreadCount ?? 0))
        .catch(() => setUnreadCount(0));
    }
  }, [loadProfile, loadSessions, publicProfile, user?.id]);

  function beginEditing() {
    if (!profile?.isOwn) return;
    setEditDraft({
      firstName: profile.identity.firstName,
      lastName: profile.identity.lastName,
      birthDate: profile.identity.birthDate ?? "",
      organizationText: profile.identity.organizationText ?? "",
      positionText: profile.identity.positionText ?? "",
    });
    setEditing(true);
  }

  function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (!editDraft) return;
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const field = (name: string) => {
      const value = formData.get(name);
      return typeof value === "string" ? value : "";
    };
    const payload = {
      firstName: field("firstName"),
      lastName: field("lastName"),
      birthDate: field("birthDate") || null,
      organizationText: field("organizationText") || null,
      positionText: field("positionText") || null,
    };
    void profileSave.run(async () => {
      setActionError(null);
      try {
        const response = await api.updateProfile(payload);
        setUser(response.user);
        await loadProfile();
        setEditing(false);
      } catch (saveError) {
        setActionError((saveError as Error).message);
      }
    });
  }

  function confirmSessionRevoke() {
    if (!sessionToRevoke) return;
    void sessionRevoke.run(async () => {
      setActionError(null);
      try {
        await api.revokeSession(sessionToRevoke.id);
        await loadSessions();
        setSessionToRevoke(null);
      } catch (revokeError) {
        setActionError((revokeError as Error).message);
      }
    });
  }

  const identity = profile?.identity;
  const stats = profile?.stats;

  if (userId && user?.id === userId) {
    return <Navigate to="/profile" replace />;
  }

  return (
    <PageLayout title={publicProfile ? "Карточка игрока" : "Профиль"}>
      <AsyncState
        loading={profile === null && !error}
        error={error}
        skeletonCount={4}
      >
        {profile && identity && stats ? (
          <>
            {actionError ? (
              <Alert
                type="error"
                variant="tonal"
                title="Действие не выполнено"
                description={actionError}
              />
            ) : null}

            <section className="card profile-hero" aria-labelledby="profile-name">
              <Avatar
                size="md"
                variant="contained"
                color="primary"
                src={avatarSrc(identity.avatarKey)}
                initials={initialsFromName(identity.displayName)}
                alt={identity.displayName}
              />
              <div className="profile-hero__body">
                <strong id="profile-name">{identity.displayName}</strong>
                {identity.organizationText || identity.positionText ? (
                  <div className="muted">
                    {[identity.organizationText, identity.positionText]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                ) : null}
                {profile.isOwn ? (
                  <div className="muted">{identity.email}</div>
                ) : null}
                <div className="row profile-hero__chips">
                  {stats.rank ? (
                    <Chip
                      size="sm"
                      variant="tonal"
                      color="primary"
                      label={`#${stats.rank} в рейтинге`}
                    />
                  ) : null}
                  {profile.isOwn ? (
                    <Chip
                      size="sm"
                      variant="tonal"
                      color={user?.role === "admin" ? "primary" : "neutral"}
                      label={user?.role === "admin" ? "Админ" : "Игрок"}
                    />
                  ) : null}
                </div>
              </div>
            </section>

            {profile.isOwn ? (
              <section className="card stack" aria-labelledby="profile-contact-title">
                <div className="profile-section-heading">
                  <h2 className="section-title" id="profile-contact-title">
                    Личные данные
                  </h2>
                  <Button size="sm" variant="secondary" onClick={beginEditing}>
                    Редактировать профиль
                  </Button>
                </div>
                <dl className="profile-details">
                  <div><dt>Email</dt><dd>{identity.email}</dd></div>
                  <div><dt>Дата рождения</dt><dd>{formatBirthDate(identity.birthDate)}</dd></div>
                  <div><dt>Организация</dt><dd>{identity.organizationText || "Не указана"}</dd></div>
                  <div><dt>Должность</dt><dd>{identity.positionText || "Не указана"}</dd></div>
                </dl>
                <p className="muted profile-avatar-note">
                  Аватар назначается автоматически из клубных пресетов и не меняется в MVP.
                </p>
              </section>
            ) : null}

            {editing && editDraft ? (
              <form className="card stack" aria-label="Редактирование профиля" onSubmit={saveProfile}>
                <h2 className="section-title">Редактирование профиля</h2>
                <TextField name="firstName" label="Имя" required value={editDraft.firstName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEditDraft({ ...editDraft, firstName: event.target.value })} />
                <TextField name="lastName" label="Фамилия" required value={editDraft.lastName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEditDraft({ ...editDraft, lastName: event.target.value })} />
                <TextField
                  name="birthDate"
                  label="Дата рождения"
                  type="date"
                  value={editDraft.birthDate}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setEditDraft({ ...editDraft, birthDate: event.target.value })
                  }
                  onInput={(event: React.FormEvent<HTMLInputElement>) =>
                    setEditDraft({
                      ...editDraft,
                      birthDate: event.currentTarget.value,
                    })
                  }
                />
                <TextField name="organizationText" label="Организация" value={editDraft.organizationText} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEditDraft({ ...editDraft, organizationText: event.target.value })} />
                <TextField name="positionText" label="Должность" value={editDraft.positionText} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEditDraft({ ...editDraft, positionText: event.target.value })} />
                <div className="row">
                  <Button type="submit" disabled={profileSave.pending}>
                    {profileSave.pending ? "Сохранение…" : "Сохранить"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={profileSave.pending}>
                    Отмена
                  </Button>
                </div>
              </form>
            ) : null}

            <section className="stack" aria-labelledby="profile-stats-title">
              <h2 className="section-title" id="profile-stats-title">Статистика</h2>
              <dl className="profile-stats card">
                <div><dt>Матчи</dt><dd>{stats.matchesPlayed}</dd></div>
                <div><dt>Победы</dt><dd>{stats.wins}</dd></div>
                <div><dt>Поражения</dt><dd>{stats.losses}</dd></div>
                <div><dt>Win rate</dt><dd>{Math.round(stats.winRate * 100)}%</dd></div>
                <div><dt>Очков за матч</dt><dd>{stats.averagePoints}</dd></div>
                <div><dt>Турниры</dt><dd>{stats.tournamentsPlayed}</dd></div>
                <div><dt>Победы в турнирах</dt><dd>{stats.tournamentWins}</dd></div>
                <div><dt>Создано турниров</dt><dd>{stats.tournamentsCreated}</dd></div>
                <div><dt>Матчи судьёй</dt><dd>{stats.judgedMatches}</dd></div>
                <div><dt>Место</dt><dd>{stats.rank ? `#${stats.rank}` : "—"}</dd></div>
              </dl>
            </section>

            <section className="stack" aria-labelledby="profile-facts-title">
              <h2 className="section-title" id="profile-facts-title">Интересные факты</h2>
              <div className="stack">
                <ListRow title="Самая долгая игра" subtitle={profile.facts.longestMatch ? `${profile.facts.longestMatch.title} · ${formatDuration(profile.facts.longestMatch.durationSeconds)}` : "Появится после завершённого матча"} />
                <ListRow title="Лучший победный счёт" subtitle={profile.facts.bestWinningScore ? `${profile.facts.bestWinningScore.title} · ${profile.facts.bestWinningScore.score}` : "Появится после первой победы"} />
                <ListRow title="Частый соперник" subtitle={profile.facts.frequentOpponent ? `${profile.facts.frequentOpponent.displayName} · ${profile.facts.frequentOpponent.matchCount} матчей` : "Проведите несколько очных матчей"} to={profile.facts.frequentOpponent ? `/players/${profile.facts.frequentOpponent.userId}` : undefined} />
                <ListRow title="Принципиальный соперник" subtitle={profile.facts.rival ? `${profile.facts.rival.displayName} · ${profile.facts.rival.matchCount} матчей` : "Появится после трёх очных матчей"} to={profile.facts.rival ? `/players/${profile.facts.rival.userId}` : undefined} />
              </div>
            </section>

            <section className="stack" aria-labelledby="profile-teams-title">
              <h2 className="section-title" id="profile-teams-title">Команды</h2>
              {profile.teams.length > 0 ? profile.teams.map((team) => (
                <ListRow key={team.id} title={`${team.name} · ${team.role === "captain" ? "капитан" : "участник"}`} />
              )) : <p className="muted">Нет мест в текущих командах.</p>}
            </section>

            {profile.canChallenge ? (
              <Button onClick={() => navigate(`/matches/new?opponentId=${encodeURIComponent(identity.id)}&opponentName=${encodeURIComponent(identity.displayName)}`)}>
                Бросить вызов
              </Button>
            ) : null}

            {profile.isOwn ? (
              <>
                <h2 className="section-title">Разделы</h2>
                <div className="stack">
                  <ListRow to="/teams" title="Команды" subtitle="Создание и приглашения" />
                  <ListRow to="/notifications" title="Уведомления" subtitle="Приглашения и события" trailing={unreadCount > 0 ? <Chip size="sm" variant="tonal" color="primary" label={String(unreadCount)} /> : null} />
                  <ListRow to="/help" title="Помощь" subtitle="FAQ и обратная связь" />
                  <ListRow onClick={restartOnboarding} title={onboardingRestart.pending ? "Запускаем онбординг…" : "Пройти онбординг заново"} subtitle="Начать с первого шага и при желании сыграть учебный матч" />
                  {user?.role === "admin" ? <ListRow to="/admin" title="Админка" subtitle="Пользователи и доступ" /> : null}
                </div>

                <h2 className="section-title">Активные сессии</h2>
                <AsyncState loading={sessions === null && !sessionError} error={sessionError} empty={sessions !== null && sessions.length === 0} emptyTitle="Нет активных сессий" skeletonCount={1}>
                  <div className="stack">
                    {(sessions ?? []).map((session) => (
                      <ListRow
                        key={session.id}
                        title={session.userAgent ?? "Неизвестное устройство"}
                        subtitle={`Последняя активность: ${formatDateTime(session.lastSeenAt)}`}
                        trailing={session.current ? <Chip size="sm" variant="tonal" color="success" label="Текущая" /> : <Button size="sm" variant="secondary" onClick={() => setSessionToRevoke(session)}>Завершить</Button>}
                      />
                    ))}
                  </div>
                </AsyncState>

                <Button variant="secondary" onClick={() => void api.logout().then(() => { setUser(null); navigate("/login"); }).catch((logoutError) => setActionError((logoutError as Error).message))}>
                  Выйти
                </Button>
              </>
            ) : null}

            <Dialog open={sessionToRevoke !== null} onClose={() => setSessionToRevoke(null)} title="Завершить другую сессию?">
              <div className="stack">
                <p>Устройство «{sessionToRevoke?.userAgent ?? "Неизвестное устройство"}» потеряет доступ и должно будет войти заново.</p>
                <div className="row">
                  <Button onClick={confirmSessionRevoke} disabled={sessionRevoke.pending}>{sessionRevoke.pending ? "Завершение…" : "Завершить сессию"}</Button>
                  <Button variant="secondary" onClick={() => setSessionToRevoke(null)} disabled={sessionRevoke.pending}>Отмена</Button>
                </div>
              </div>
            </Dialog>
          </>
        ) : null}
      </AsyncState>
      {!publicProfile && error ? (
        <div className="stack">
          <ListRow
            onClick={restartOnboarding}
            title={
              onboardingRestart.pending
                ? "Запускаем онбординг…"
                : "Пройти онбординг заново"
            }
            subtitle="Начать с первого шага и при желании сыграть учебный матч"
          />
          <Button
            variant="secondary"
            onClick={() =>
              void api
                .logout()
                .then(() => {
                  setUser(null);
                  navigate("/login");
                })
                .catch((logoutError) =>
                  setActionError((logoutError as Error).message),
                )
            }
          >
            Выйти
          </Button>
        </div>
      ) : null}
    </PageLayout>
  );
}
