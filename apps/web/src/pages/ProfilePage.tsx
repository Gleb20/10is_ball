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
import { useLifecycleSingleFlight } from "./useLifecycleSingleFlight";

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

export type EditDraft = {
  firstName: string;
  lastName: string;
  birthDate: string;
  organizationText: string;
  positionText: string;
};

type ProfileFieldErrors = Partial<Record<keyof EditDraft, string>>;

const PROFILE_FIELD_ORDER: Array<keyof EditDraft> = [
  "firstName",
  "lastName",
  "birthDate",
  "organizationText",
  "positionText",
];

const PROFILE_FIELD_IDS: Record<keyof EditDraft, string> = {
  firstName: "profile-first-name",
  lastName: "profile-last-name",
  birthDate: "profile-birth-date",
  organizationText: "profile-organization",
  positionText: "profile-position",
};

function isExactCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year <= 0 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

export function validateProfileDraft(draft: EditDraft): ProfileFieldErrors {
  const errors: ProfileFieldErrors = {};
  const firstName = draft.firstName.trim();
  const lastName = draft.lastName.trim();
  if (firstName.length === 0) errors.firstName = "Введите имя.";
  else if (firstName.length > 100) errors.firstName = "Не более 100 символов после удаления пробелов по краям.";
  if (lastName.length === 0) errors.lastName = "Введите фамилию.";
  else if (lastName.length > 100) errors.lastName = "Не более 100 символов после удаления пробелов по краям.";
  if (draft.birthDate && !isExactCalendarDate(draft.birthDate)) {
    errors.birthDate = "Введите существующую дату в формате ГГГГ-ММ-ДД.";
  }
  if (draft.organizationText.trim().length > 200) {
    errors.organizationText = "Не более 200 символов после удаления пробелов по краям.";
  }
  if (draft.positionText.trim().length > 200) {
    errors.positionText = "Не более 200 символов после удаления пробелов по краям.";
  }
  return errors;
}

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
  const [profileFieldErrors, setProfileFieldErrors] = useState<ProfileFieldErrors>({});
  const [profileFormError, setProfileFormError] = useState<string | null>(null);
  const [profileSaveUnknown, setProfileSaveUnknown] = useState(false);
  const [profileReviewMessage, setProfileReviewMessage] = useState<string | null>(null);
  const [profileReviewPending, setProfileReviewPending] = useState(false);
  const [sessionToRevoke, setSessionToRevoke] = useState<AuthSession | null>(null);
  const navigate = useNavigate();
  const onboardingRestart = useSingleFlight();
  const profileSave = useLifecycleSingleFlight();
  const sessionRevoke = useSingleFlight();
  const profileRequestSequence = useRef(0);
  const sessionRequestSequence = useRef(0);
  const draftActorId = useRef<string | null>(null);
  const interruptedProfileSave = useRef(false);
  const interactionContextKey = `${user?.id ?? "anonymous"}:${userId ?? "own"}`;
  const interactionContext = useRef({ key: interactionContextKey, generation: 0, active: false });
  if (interactionContext.current.key !== interactionContextKey) {
    interactionContext.current = {
      key: interactionContextKey,
      generation: interactionContext.current.generation + 1,
      active: false,
    };
  }

  useEffect(() => {
    const activeContext = {
      key: interactionContextKey,
      generation: interactionContext.current.generation + 1,
      active: true,
    };
    interactionContext.current = activeContext;
    profileSave.resume();
    if (interruptedProfileSave.current) {
      interruptedProfileSave.current = false;
      setProfileSaveUnknown(true);
      setProfileFormError(null);
      setProfileReviewMessage(null);
    }
    return () => {
      if (profileSave.invalidate()) interruptedProfileSave.current = true;
      if (interactionContext.current !== activeContext) return;
      interactionContext.current = {
        ...activeContext,
        generation: activeContext.generation + 1,
        active: false,
      };
    };
  }, [interactionContextKey, profileSave.invalidate, profileSave.resume]);

  const isCurrentInteraction = useCallback(
    (context: typeof interactionContext.current) =>
      context.active && interactionContext.current === context,
    [],
  );

  const loadProfile = useCallback(async () => {
    const sequence = ++profileRequestSequence.current;
    const operationContext = interactionContext.current;
    try {
      const response = userId
        ? await api.playerProfile(userId)
        : await api.ownProfile();
      if (sequence === profileRequestSequence.current && isCurrentInteraction(operationContext)) {
        setProfile(response.profile);
      }
    } catch (loadError) {
      if (sequence === profileRequestSequence.current && isCurrentInteraction(operationContext)) throw loadError;
    }
  }, [isCurrentInteraction, userId]);

  const loadSessions = useCallback(async () => {
    const sequence = ++sessionRequestSequence.current;
    const operationContext = interactionContext.current;
    setSessionError(null);
    try {
      const response = await api.sessions();
      if (sequence === sessionRequestSequence.current && isCurrentInteraction(operationContext)) {
        setSessions(response.sessions);
      }
    } catch (loadError) {
      if (sequence === sessionRequestSequence.current && isCurrentInteraction(operationContext)) throw loadError;
    }
  }, [isCurrentInteraction]);

  function restartOnboarding() {
    const operationContext = interactionContext.current;
    void onboardingRestart.run(async () => {
      setActionError(null);
      try {
        const result = await api.restartOnboarding();
        if (!isCurrentInteraction(operationContext)) return;
        setUser(result.user);
        navigate("/onboarding");
      } catch (restartError) {
        if (isCurrentInteraction(operationContext)) {
          setActionError((restartError as Error).message);
        }
      }
    });
  }

  useEffect(() => {
    if (!user) return;
    let active = true;
    setProfile(null);
    setError(null);
    setUnreadCount(0);
    void loadProfile().catch((loadError) =>
      setError((loadError as Error).message),
    );
    if (!publicProfile) {
      void loadSessions().catch((loadError) =>
        setSessionError((loadError as Error).message),
      );
      void api
        .home()
        .then((response) => { if (active) setUnreadCount(response.notificationView === "available" ? response.unreadCount : 0); })
        .catch(() => { if (active) setUnreadCount(0); });
    }
    return () => { active = false; };
  }, [loadProfile, loadSessions, publicProfile, user?.id]);

  useEffect(() => {
    if (!editDraft) return;
    if (publicProfile || (user && draftActorId.current !== user.id)) {
      setEditing(false);
      setEditDraft(null);
      setProfileFieldErrors({});
      setProfileFormError(null);
      setProfileSaveUnknown(false);
      setProfileReviewMessage(null);
      setProfileReviewPending(false);
      draftActorId.current = null;
    }
  }, [editDraft, publicProfile, user]);

  useEffect(() => {
    setProfileReviewPending(false);
  }, [interactionContextKey]);

  function beginEditing() {
    if (!profile?.isOwn) return;
    draftActorId.current = user?.id ?? null;
    setProfileFieldErrors({});
    setProfileFormError(null);
    setProfileSaveUnknown(false);
    setProfileReviewMessage(null);
    setProfileReviewPending(false);
    setEditDraft({
      firstName: profile.identity.firstName,
      lastName: profile.identity.lastName,
      birthDate: profile.identity.birthDate ?? "",
      organizationText: profile.identity.organizationText ?? "",
      positionText: profile.identity.positionText ?? "",
    });
    setEditing(true);
  }

  function updateDraft(field: keyof EditDraft, value: string) {
    setEditDraft((current) => current ? { ...current, [field]: value } : current);
    setProfileFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function focusFirstInvalid(errors: ProfileFieldErrors) {
    const first = PROFILE_FIELD_ORDER.find((field) => Boolean(errors[field]));
    if (!first) return;
    const operationContext = interactionContext.current;
    queueMicrotask(() => {
      if (isCurrentInteraction(operationContext)) {
        document.getElementById(PROFILE_FIELD_IDS[first])?.focus();
      }
    });
  }

  function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (!editDraft) return;
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const field = (name: string) => {
      const value = formData.get(name);
      return typeof value === "string" ? value : "";
    };
    const attempt: EditDraft = {
      firstName: field("firstName"),
      lastName: field("lastName"),
      birthDate: field("birthDate"),
      organizationText: field("organizationText"),
      positionText: field("positionText"),
    };
    setEditDraft(attempt);
    const validationErrors = validateProfileDraft(attempt);
    if (Object.keys(validationErrors).length > 0) {
      setProfileFieldErrors(validationErrors);
      setProfileFormError(null);
      setProfileSaveUnknown(false);
      setProfileReviewMessage(null);
      focusFirstInvalid(validationErrors);
      return;
    }
    const payload = {
      firstName: attempt.firstName,
      lastName: attempt.lastName,
      birthDate: attempt.birthDate || null,
      organizationText: attempt.organizationText || null,
      positionText: attempt.positionText || null,
    };
    const operationContext = interactionContext.current;
    void profileSave.run(async () => {
      setProfileFieldErrors({});
      setProfileFormError(null);
      setProfileSaveUnknown(false);
      setProfileReviewMessage(null);
      try {
        const response = await api.updateProfile(payload);
        if (!isCurrentInteraction(operationContext)) return;
        setUser(response.user);
        await loadProfile();
        if (!isCurrentInteraction(operationContext)) return;
        setEditing(false);
        setEditDraft(null);
        draftActorId.current = null;
      } catch (saveError) {
        if (!isCurrentInteraction(operationContext)) return;
        const typedError = saveError as Error & { status?: number };
        if (typedError.status === undefined || typedError.status >= 500) {
          setProfileSaveUnknown(true);
          setProfileFormError(null);
        } else if (typedError.status !== 401) {
          setProfileFormError(typedError.message);
        }
      }
    });
  }

  async function reviewProfileAfterUnknownSave() {
    const operationContext = interactionContext.current;
    setProfileReviewPending(true);
    setProfileFormError(null);
    try {
      await loadProfile();
      if (!isCurrentInteraction(operationContext)) return;
      setProfileReviewMessage(
        "Текущие данные сервера обновлены. Это не подтверждает исход предыдущего сохранения и не исключает позднюю запись.",
      );
    } catch (reviewError) {
      if (!isCurrentInteraction(operationContext)) return;
      setProfileFormError((reviewError as Error).message);
    } finally {
      if (isCurrentInteraction(operationContext)) setProfileReviewPending(false);
    }
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
              <form className="card stack" aria-label="Редактирование профиля" onSubmit={saveProfile} noValidate>
                <h2 className="section-title">Редактирование профиля</h2>
                {profileSaveUnknown ? (
                  <Alert
                    type="warning"
                    variant="tonal"
                    title="Не удалось проверить сохранение"
                    description="Ответ на сохранение не получен. Не повторяйте отправку: сначала обновите текущие данные с сервера."
                  />
                ) : null}
                {profileFormError ? (
                  <Alert type="error" variant="tonal" title="Профиль не сохранён" description={profileFormError} />
                ) : null}
                {profileReviewMessage ? (
                  <Alert type="primary" variant="tonal" title="Данные обновлены" description={profileReviewMessage} />
                ) : null}
                <TextField
                  id={PROFILE_FIELD_IDS.firstName}
                  name="firstName"
                  label="Имя"
                  required
                  value={editDraft.firstName}
                  error={Boolean(profileFieldErrors.firstName)}
                  helperText={profileFieldErrors.firstName}
                  disabled={profileSave.pending}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => updateDraft("firstName", event.target.value)}
                />
                <TextField
                  id={PROFILE_FIELD_IDS.lastName}
                  name="lastName"
                  label="Фамилия"
                  required
                  value={editDraft.lastName}
                  error={Boolean(profileFieldErrors.lastName)}
                  helperText={profileFieldErrors.lastName}
                  disabled={profileSave.pending}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => updateDraft("lastName", event.target.value)}
                />
                <TextField
                  id={PROFILE_FIELD_IDS.birthDate}
                  name="birthDate"
                  label="Дата рождения"
                  type="date"
                  value={editDraft.birthDate}
                  error={Boolean(profileFieldErrors.birthDate)}
                  helperText={profileFieldErrors.birthDate}
                  disabled={profileSave.pending}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    updateDraft("birthDate", event.target.value)
                  }
                  onInput={(event: React.FormEvent<HTMLInputElement>) =>
                    updateDraft("birthDate", event.currentTarget.value)
                  }
                />
                <TextField
                  id={PROFILE_FIELD_IDS.organizationText}
                  name="organizationText"
                  label="Организация"
                  value={editDraft.organizationText}
                  error={Boolean(profileFieldErrors.organizationText)}
                  helperText={profileFieldErrors.organizationText}
                  disabled={profileSave.pending}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => updateDraft("organizationText", event.target.value)}
                />
                <TextField
                  id={PROFILE_FIELD_IDS.positionText}
                  name="positionText"
                  label="Должность"
                  value={editDraft.positionText}
                  error={Boolean(profileFieldErrors.positionText)}
                  helperText={profileFieldErrors.positionText}
                  disabled={profileSave.pending}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => updateDraft("positionText", event.target.value)}
                />
                <div className="row">
                  <Button
                    type="submit"
                    disabled={profileSave.pending || (profileSaveUnknown && !profileReviewMessage)}
                  >
                    {profileSave.pending ? "Сохранение…" : "Сохранить"}
                  </Button>
                  {profileSaveUnknown ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={profileReviewPending || profileSave.pending}
                      onClick={() => void reviewProfileAfterUnknownSave()}
                    >
                      {profileReviewPending ? "Обновление…" : "Обновить данные"}
                    </Button>
                  ) : null}
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


            {profile.isOwn ? (
              <>
                <h2 className="section-title">Разделы</h2>
                <div className="stack">
                  <ListRow to="/teams" title="Команды" subtitle="Создание и приглашения" />
                  <ListRow to="/notifications" title="Уведомления" subtitle="Приглашения и события" trailing={unreadCount > 0 ? <Chip size="sm" variant="tonal" color="primary" label={String(unreadCount)} /> : null} />
                  <ListRow to="/help" title="Помощь" subtitle="FAQ и обратная связь" />
                  <ListRow onClick={restartOnboarding} title={onboardingRestart.pending ? "Запускаем онбординг…" : "Пройти обучение заново"} subtitle="Начать с первого шага и при желании сыграть учебный матч" />
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
                : "Пройти обучение заново"
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
