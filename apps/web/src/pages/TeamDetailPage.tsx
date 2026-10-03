import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Alert, Avatar, Button, Chip, Dialog, TextField } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState } from "../patterns";
import { api, type Team, type TeamMember } from "../api";
import { UserPicker } from "../components/UserPicker";
import { avatarSrc } from "../avatarSrc";
import { initialsFromName } from "../rankingUi";
import { useLifecycleSingleFlight } from "./useLifecycleSingleFlight";
import { useAuth } from "../auth";
import { TeamAvatar, TeamAvatarPicker } from "../components/TeamAvatar";
import type { AvatarKey } from "@tab10/shared";

type TeamDraft = {
  name: string;
  slogan: string;
  welcomeText: string;
  avatarKey: AvatarKey | null;
};
type OperationKind = "save" | "invite" | "remove" | "transfer" | "leave";
type OperationContext = {
  identity: string;
  kind: OperationKind;
  memberName?: string;
};
type ActionIssue = {
  title: string;
  description: string;
  uncertain: boolean;
};
type MemberConfirmation = {
  kind: "remove" | "transfer";
  member: TeamMember;
};

type TeamsReturnContext = {
  userId?: unknown;
  detailPath?: unknown;
  teamId?: unknown;
  navigationToken?: unknown;
};

type TeamsReturnRouteState = {
  returnTo?: unknown;
  teamsReturnToken?: unknown;
};

const TEAMS_RETURN_KEY = "tab10.teams.return";

function hasMatchingTeamsReturnContext(
  userId: string,
  detailPath: string,
  teamId: string,
  routeState: TeamsReturnRouteState | null,
) {
  if (
    typeof window === "undefined" ||
    routeState?.returnTo !== "/teams" ||
    typeof routeState.teamsReturnToken !== "string" ||
    routeState.teamsReturnToken.length === 0
  ) return false;
  try {
    const context = JSON.parse(
      window.sessionStorage.getItem(TEAMS_RETURN_KEY) ?? "null",
    ) as TeamsReturnContext | null;
    return Boolean(
      context &&
      context.userId === userId &&
      context.detailPath === detailPath &&
      context.teamId === teamId &&
      context.navigationToken === routeState.teamsReturnToken
    );
  } catch {
    return false;
  }
}

function clearTeamsReturnContext() {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(TEAMS_RETURN_KEY); } catch { /* optional context */ }
}

const invitationStatusLabels: Record<string, string> = {
  pending: "Ожидает ответа",
  accepted: "Принято",
  declined: "Отклонено",
  expired: "Истекло",
  cancelled: "Отменено",
};

function isKnownRejection(error: unknown) {
  const status = (error as { status?: number }).status;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 401;
}

function serverValues(team: Team) {
  return [
    `название «${team.name}»`,
    team.slogan ? `слоган «${team.slogan}»` : "слоган не указан",
    team.welcomeText ? `приветствие «${team.welcomeText}»` : "приветствие не указано",
    team.avatarKey ? `аватар ${team.avatarKey}` : "аватар не выбран",
  ].join(", ");
}

export function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [team, setTeam] = useState<Team | null>(null);
  const [draft, setDraft] = useState<TeamDraft | null>(null);
  const [inviteUserId, setInviteUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settingsIssue, setSettingsIssue] = useState<ActionIssue | null>(null);
  const [settingsReview, setSettingsReview] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);
  const [settingsFocusRequest, setSettingsFocusRequest] = useState(0);
  const [generalIssue, setGeneralIssue] = useState<ActionIssue | null>(null);
  const [rosterReview, setRosterReview] = useState<string | null>(null);
  const [confirmationIssue, setConfirmationIssue] = useState<ActionIssue | null>(null);
  const [actionHint, setActionHint] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [openMemberActions, setOpenMemberActions] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<MemberConfirmation | null>(null);
  const [pendingActionFocusMemberId, setPendingActionFocusMemberId] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<OperationKind | null>(null);
  const [focusMembersAfterUpdate, setFocusMembersAfterUpdate] = useState(false);
  const { user } = useAuth();
  const requestSequence = useRef(0);
  const loadedIdentityRef = useRef<string | null>(null);
  const userRef = useRef(user);
  const mountedRef = useRef(false);
  const lifecycleGenerationRef = useRef(0);
  const operation = useLifecycleSingleFlight();
  const currentOperationRef = useRef<OperationContext | null>(null);
  const currentOperationTokenRef = useRef<symbol | null>(null);
  const interruptedOperationRef = useRef<OperationContext | null>(null);
  const actionButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const cancelConfirmationRef = useRef<HTMLButtonElement>(null);
  const membersHeadingRef = useRef<HTMLHeadingElement>(null);
  const settingsFeedbackRef = useRef<HTMLDivElement>(null);
  const focusedSettingsRequestRef = useRef(0);
  userRef.current = user;

  const identity = user?.id && id ? `${user.id}:${id}` : null;
  const archived = team?.status === "archived";

  const isCurrentLifecycle = useCallback((
    actorId: string,
    teamId: string,
    generation: number,
  ) => (
    mountedRef.current &&
    lifecycleGenerationRef.current === generation &&
    userRef.current?.id === actorId &&
    id === teamId
  ), [id]);

  const load = useCallback(async (
    preserveDraft = false,
    review: "settings" | "roster" | null = null,
  ) => {
    const actorId = userRef.current?.id;
    const teamId = id;
    if (!actorId || !teamId) return null;
    const generation = lifecycleGenerationRef.current;
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await api.getTeam(teamId);
      if (
        sequence !== requestSequence.current ||
        !isCurrentLifecycle(actorId, teamId, generation)
      ) return null;
      setTeam(response.team);
      setDraft((current) => preserveDraft && current
        ? current
        : {
            name: response.team.name,
            slogan: response.team.slogan ?? "",
            welcomeText: response.team.welcomeText ?? "",
            avatarKey: response.team.avatarKey ?? null,
          });
      if (review === "settings") {
        setSettingsReview(
          `Сервер сейчас: ${serverValues(response.team)}. Это текущее состояние, а не подтверждение исхода предыдущего сохранения.`,
        );
      }
      if (review === "roster") {
        setRosterReview(
          "Состав и права обновлены с сервера. Это текущее состояние, а не подтверждение исхода предыдущего действия.",
        );
      }
      return response.team;
    } catch (error) {
      if (
        sequence === requestSequence.current &&
        isCurrentLifecycle(actorId, teamId, generation) &&
        (error as Error & { status?: number }).status !== 401
      ) {
        setLoadError((error as Error).message);
      }
      return null;
    } finally {
      if (
        sequence === requestSequence.current &&
        isCurrentLifecycle(actorId, teamId, generation)
      ) setLoading(false);
    }
  }, [id, isCurrentLifecycle]);

  useEffect(() => {
    mountedRef.current = true;
    lifecycleGenerationRef.current += 1;
    operation.resume();
    setPendingKind(null);
    const sameIdentity = Boolean(identity && loadedIdentityRef.current === identity);
    const interrupted = interruptedOperationRef.current;

    if (identity && !sameIdentity) {
      setTeam(null);
      setDraft(null);
      setInviteUserId("");
      setSettingsIssue(null);
      setSettingsReview(null);
      setSettingsSuccess(null);
      setGeneralIssue(null);
      setRosterReview(null);
      setConfirmationIssue(null);
      setActionHint(null);
      setLeaveOpen(false);
      setOpenMemberActions(null);
      setConfirmation(null);
      interruptedOperationRef.current = null;
    } else if (identity && interrupted?.identity === identity) {
      interruptedOperationRef.current = null;
      setConfirmation(null);
      setOpenMemberActions(null);
      if (interrupted.kind === "save") {
        setSettingsIssue({
          title: "Не удалось проверить сохранение",
          description: "Изменение могло сохраниться. Черновик оставлен без изменений; проверяется только текущее состояние сервера.",
          uncertain: true,
        });
        setSettingsFocusRequest((request) => request + 1);
      } else if (interrupted.kind === "remove" || interrupted.kind === "transfer") {
        setGeneralIssue({
          title: "Не удалось подтвердить изменение состава",
          description: `Действие с ${interrupted.memberName ?? "участником"} могло выполниться. Состав обновляется без повторной мутации.`,
          uncertain: true,
        });
      } else {
        setGeneralIssue({
          title: "Не удалось подтвердить действие",
          description: "Запрос мог выполниться. Данные обновляются без автоматического повтора.",
          uncertain: true,
        });
      }
    } else if (identity && interruptedOperationRef.current) {
      interruptedOperationRef.current = null;
    }

    if (identity) loadedIdentityRef.current = identity;
    const review = interrupted?.identity === identity
      ? interrupted.kind === "save"
        ? "settings"
        : interrupted.kind === "remove" || interrupted.kind === "transfer"
          ? "roster"
          : null
      : null;
    if (identity) void load(sameIdentity, review);
    return () => {
      mountedRef.current = false;
      lifecycleGenerationRef.current += 1;
      requestSequence.current += 1;
      if (operation.invalidate() && currentOperationRef.current) {
        interruptedOperationRef.current = currentOperationRef.current;
      }
    };
  }, [identity, load]);

  useEffect(() => {
    if (!confirmation || operation.pending) return;
    cancelConfirmationRef.current?.focus();
  }, [confirmation, operation.pending]);

  useEffect(() => {
    if (confirmation || !pendingActionFocusMemberId) return;
    actionButtonRefs.current.get(pendingActionFocusMemberId)?.focus();
    setPendingActionFocusMemberId(null);
  }, [confirmation, pendingActionFocusMemberId]);

  useEffect(() => {
    if (
      operation.pending ||
      settingsFocusRequest === focusedSettingsRequestRef.current
    ) return;
    focusedSettingsRequestRef.current = settingsFocusRequest;
    settingsFeedbackRef.current?.focus();
  }, [operation.pending, settingsFocusRequest]);

  useEffect(() => {
    if (!focusMembersAfterUpdate) return;
    membersHeadingRef.current?.focus();
    setFocusMembersAfterUpdate(false);
  }, [focusMembersAfterUpdate, team]);

  const excludedInviteIds = useMemo(
    () => [
      ...(team?.members.map((member) => member.userId) ?? []),
      ...(team?.invitations ?? [])
        .filter(
          (invitation) =>
            invitation.status === "pending" &&
            Date.parse(invitation.expiresAt) > Date.now(),
        )
        .map((invitation) => invitation.invitedUserId),
    ],
    [team],
  );

  function beginOperation(context: OperationContext) {
    const token = Symbol(context.kind);
    currentOperationRef.current = context;
    currentOperationTokenRef.current = token;
    setPendingKind(context.kind);
    requestSequence.current += 1;
    setActionHint(null);
    return token;
  }

  function endOperation(token: symbol) {
    if (currentOperationTokenRef.current !== token) return;
    currentOperationTokenRef.current = null;
    currentOperationRef.current = null;
    setPendingKind(null);
  }

  function currentActionContext(kind: OperationKind, memberName?: string) {
    if (!identity) return null;
    return { identity, kind, memberName } satisfies OperationContext;
  }

  async function saveTeam(event: React.FormEvent) {
    event.preventDefault();
    if (!id || !draft || archived || !team?.isCaptain || !identity) return;
    const actorId = userRef.current?.id;
    if (!actorId || (settingsIssue?.uncertain && !settingsReview)) return;
    const snapshot = { ...draft };
    await operation.run(async () => {
      const context = currentActionContext("save");
      if (!context) return;
      const token = beginOperation(context);
      const generation = lifecycleGenerationRef.current;
      setSettingsIssue(null);
      setSettingsReview(null);
      setSettingsSuccess(null);
      try {
        const response = await api.updateTeam(id, {
          name: snapshot.name.trim(),
          slogan: snapshot.slogan.trim(),
          welcomeText: snapshot.welcomeText.trim(),
          avatarKey: snapshot.avatarKey,
        });
        if (!isCurrentLifecycle(actorId, id, generation)) return;
        setTeam(response.team);
        setDraft({
          name: response.team.name,
          slogan: response.team.slogan ?? "",
          welcomeText: response.team.welcomeText ?? "",
          avatarKey: response.team.avatarKey ?? null,
        });
        setSettingsSuccess("Изменения сохранены.");
        setSettingsFocusRequest((request) => request + 1);
      } catch (error) {
        if (!isCurrentLifecycle(actorId, id, generation) || (error as { status?: number }).status === 401) return;
        setSettingsIssue(isKnownRejection(error)
          ? {
              title: "Не удалось сохранить настройки",
              description: (error as Error).message,
              uncertain: false,
            }
          : {
              title: "Не удалось проверить сохранение",
              description: "Изменение могло сохраниться. Черновик оставлен без изменений; обновите данные перед новым явным сохранением.",
              uncertain: true,
            });
        setSettingsFocusRequest((request) => request + 1);
      } finally {
        endOperation(token);
      }
    });
  }

  async function reviewUnknownSettings() {
    await load(true, "settings");
  }

  function invite() {
    if (!id || !inviteUserId || archived || !team?.isCaptain || !identity) return;
    const actorId = userRef.current?.id;
    if (!actorId) return;
    void operation.run(async () => {
      const context = currentActionContext("invite");
      if (!context) return;
      const token = beginOperation(context);
      const generation = lifecycleGenerationRef.current;
      setGeneralIssue(null);
      try {
        await api.inviteTeamMember(id, inviteUserId);
        if (!isCurrentLifecycle(actorId, id, generation)) return;
        setInviteUserId("");
        setActionHint("Приглашение отправлено.");
        await load(true);
      } catch (error) {
        if (!isCurrentLifecycle(actorId, id, generation) || (error as { status?: number }).status === 401) return;
        setGeneralIssue({
          title: isKnownRejection(error) ? "Не удалось отправить приглашение" : "Не удалось подтвердить приглашение",
          description: isKnownRejection(error)
            ? (error as Error).message
            : "Приглашение могло сохраниться. Обновите данные перед новым явным действием.",
          uncertain: !isKnownRejection(error),
        });
      } finally {
        endOperation(token);
      }
    });
  }

  function closeConfirmation() {
    if (operation.pending) return;
    const origin = confirmation?.member.userId;
    setConfirmation(null);
    setConfirmationIssue(null);
    if (origin) setPendingActionFocusMemberId(origin);
  }

  function confirmMemberAction() {
    if (!id || !confirmation || archived || !team?.isCaptain || !identity) return;
    const actorId = userRef.current?.id;
    if (!actorId) return;
    const selected = confirmation;
    void operation.run(async () => {
      const context = currentActionContext(selected.kind, selected.member.displayName);
      if (!context) return;
      const token = beginOperation(context);
      const generation = lifecycleGenerationRef.current;
      setConfirmationIssue(null);
      setGeneralIssue(null);
      setRosterReview(null);
      try {
        const response = selected.kind === "remove"
          ? await api.removeTeamMember(id, selected.member.userId)
          : await api.transferTeamCaptain(id, selected.member.userId);
        if (!isCurrentLifecycle(actorId, id, generation)) return;
        setTeam(response.team);
        setConfirmation(null);
        setOpenMemberActions(null);
        setActionHint(selected.kind === "remove" ? "Участник исключён." : "Капитанство передано.");
        setFocusMembersAfterUpdate(true);
      } catch (error) {
        if (!isCurrentLifecycle(actorId, id, generation) || (error as { status?: number }).status === 401) return;
        setConfirmationIssue(isKnownRejection(error)
          ? {
              title: selected.kind === "remove" ? "Не удалось исключить участника" : "Не удалось передать капитанство",
              description: (error as Error).message,
              uncertain: false,
            }
          : {
              title: "Не удалось подтвердить изменение",
              description: "Действие могло выполниться. Обновите состав без повторной мутации.",
              uncertain: true,
            });
      } finally {
        endOperation(token);
      }
    });
  }

  async function reviewUnknownRoster() {
    const refreshed = await load(true, "roster");
    if (!refreshed) return;
    setConfirmation(null);
    setConfirmationIssue(null);
    setOpenMemberActions(null);
    setFocusMembersAfterUpdate(true);
  }

  function leave() {
    if (!id || archived || !team?.isMember || team.isCaptain || !identity) return;
    const actorId = userRef.current?.id;
    if (!actorId) return;
    void operation.run(async () => {
      const context = currentActionContext("leave");
      if (!context) return;
      const token = beginOperation(context);
      const generation = lifecycleGenerationRef.current;
      setGeneralIssue(null);
      try {
        const response = await api.leaveTeam(id);
        if (!isCurrentLifecycle(actorId, id, generation)) return;
        setTeam(response.team);
        setActionHint("Вы вышли из команды.");
      } catch (error) {
        if (!isCurrentLifecycle(actorId, id, generation) || (error as { status?: number }).status === 401) return;
        setGeneralIssue({
          title: isKnownRejection(error) ? "Не удалось выйти из команды" : "Не удалось подтвердить выход",
          description: isKnownRejection(error)
            ? (error as Error).message
            : "Выход мог сохраниться. Обновите данные перед новым явным действием.",
          uncertain: !isKnownRejection(error),
        });
      } finally {
        endOperation(token);
      }
    });
  }

  const returnState = location.state as TeamsReturnRouteState | null;
  const cameFromTeams = useMemo(() => {
    if (!user?.id || !id) return false;
    return hasMatchingTeamsReturnContext(user.id, location.pathname, id, returnState);
  }, [id, location.pathname, returnState, user?.id]);

  useEffect(() => {
    if (!user?.id || !id || cameFromTeams) return;
    clearTeamsReturnContext();
  }, [cameFromTeams, id, user?.id]);

  return (
    <PageLayout
      title={team?.name ?? "Команда"}
      action={
        <Button
          size="sm"
          variant="secondary"
          disabled={loading || operation.pending}
          onClick={() => void load(true)}
        >
          {loading ? "Загрузка…" : loadError ? "Повторить" : "Обновить"}
        </Button>
      }
    >
      <AsyncState loading={loading && !team} error={!team ? loadError : null}>
        {team ? (
          <div className="stack">
            {searchParams.get("welcome") === "1" ? (
              <Alert
                type="success"
                variant="tonal"
                title={`Добро пожаловать в команду «${team.name}»`}
                description={team.welcomeText || "Вы приняты в команду."}
              />
            ) : null}
            {archived ? (
              <Alert
                type="warning"
                variant="tonal"
                title="Команда в архиве"
                description="Состав и настройки доступны только для просмотра."
              />
            ) : null}
            {loadError ? (
              <Alert type="warning" variant="tonal" title="Не удалось обновить" description={loadError} />
            ) : null}
            <section className="card stack" aria-label="О команде">
              <div className="team-identity">
                <TeamAvatar avatarKey={team.avatarKey} teamName={team.name} size="md" />
                <strong>{team.name}</strong>
              </div>
              <div className="row">
                <Chip size="sm" variant="tonal" label={archived ? "Архив" : "Активна"} startIcon={false} className="status-chip" />
                {team.isCaptain ? <Chip size="sm" variant="tonal" label="Вы капитан" startIcon={false} className="status-chip" /> : null}
              </div>
              {team.slogan ? <p>{team.slogan}</p> : <p className="muted">Слоган не указан.</p>}
              {team.welcomeText ? <p className="muted">{team.welcomeText}</p> : null}
            </section>

            <section className="card stack" aria-label="Состав команды">
              <h2 ref={membersHeadingRef} tabIndex={-1}>Участники</h2>
              {rosterReview ? <p role="status">{rosterReview}</p> : null}
              {team.members.length === 0 ? <p className="muted">В команде не осталось участников.</p> : null}
              {team.members.map((member) => {
                const captain = member.userId === team.captainUserId;
                const actionsOpen = openMemberActions === member.userId;
                const actionsId = `team-member-actions-${member.userId}`;
                return (
                  <div className="list-row list-row--static" key={member.id}>
                    <div className="list-row__leading">
                      <Avatar
                        size="sm"
                        variant="tonal"
                        src={avatarSrc(member.avatarKey)}
                        initials={initialsFromName(member.displayName)}
                        alt={member.displayName}
                      />
                    </div>
                    <div className="list-row__body">
                      <strong className="list-row__title">{member.displayName}</strong>
                      <span className="muted">{captain ? "Капитан" : "Участник"}</span>
                      {team.isCaptain && !archived && !captain ? (
                        <>
                          <div className="row">
                            <Button
                              ref={(node: HTMLButtonElement | null) => {
                                if (node) actionButtonRefs.current.set(member.userId, node);
                                else actionButtonRefs.current.delete(member.userId);
                              }}
                              size="sm"
                              variant="secondary"
                              disabled={operation.pending}
                              aria-expanded={actionsOpen}
                              aria-controls={actionsId}
                              onClick={() => setOpenMemberActions(actionsOpen ? null : member.userId)}
                            >
                              Действия с {member.displayName}
                            </Button>
                          </div>
                          {actionsOpen ? (
                            <div
                              id={actionsId}
                              className="row"
                              onKeyDown={(event) => {
                                if (event.key !== "Escape" || operation.pending) return;
                                event.preventDefault();
                                setOpenMemberActions(null);
                                actionButtonRefs.current.get(member.userId)?.focus();
                              }}
                            >
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={operation.pending}
                                onClick={() => {
                                  setConfirmationIssue(null);
                                  setConfirmation({ kind: "transfer", member });
                                }}
                              >
                                Передать капитанство
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={operation.pending}
                                onClick={() => {
                                  setConfirmationIssue(null);
                                  setConfirmation({ kind: "remove", member });
                                }}
                              >
                                Исключить участника
                              </Button>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </section>

            {team.isCaptain && !archived && draft ? (
              <>
                <form className="card stack" aria-label="Редактирование команды" onSubmit={saveTeam}>
                  <h2>Настройки</h2>
                  <TeamAvatarPicker
                    value={draft.avatarKey}
                    onChange={(avatarKey) => setDraft({ ...draft, avatarKey })}
                    name={`edit-team-avatar-${team.id}`}
                    disabled={operation.pending}
                  />
                  <TextField
                    label="Название команды"
                    value={draft.name}
                    required
                    disabled={operation.pending}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, name: event.target.value })}
                  />
                  <TextField
                    label="Слоган"
                    value={draft.slogan}
                    disabled={operation.pending}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, slogan: event.target.value })}
                  />
                  <TextField
                    label="Текст приветствия"
                    value={draft.welcomeText}
                    disabled={operation.pending}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, welcomeText: event.target.value })}
                  />
                  {settingsIssue || settingsSuccess || settingsReview ? (
                    <div ref={settingsFeedbackRef} tabIndex={-1} className="stack">
                      {settingsIssue ? (
                        <Alert
                          type={settingsIssue.uncertain ? "warning" : "error"}
                          variant="tonal"
                          role="alert"
                          title={settingsIssue.title}
                          description={settingsIssue.description}
                        />
                      ) : null}
                      {settingsSuccess ? <p role="status">{settingsSuccess}</p> : null}
                      {settingsReview ? <p role="status">{settingsReview}</p> : null}
                    </div>
                  ) : null}
                  {settingsIssue?.uncertain ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={operation.pending || loading}
                      onClick={() => void reviewUnknownSettings()}
                    >
                      {loading ? "Обновление…" : "Обновить данные"}
                    </Button>
                  ) : null}
                  <Button
                    type="submit"
                    disabled={
                      operation.pending ||
                      !draft.name.trim() ||
                      Boolean(settingsIssue?.uncertain && !settingsReview)
                    }
                  >
                    {pendingKind === "save"
                      ? "Сохраняем…"
                      : settingsIssue?.uncertain && settingsReview
                        ? "Сохранить ещё раз"
                        : "Сохранить"}
                  </Button>
                </form>
                <section className="card stack" aria-label="Приглашение в команду">
                  <h2>Пригласить участника</h2>
                  <UserPicker
                    label="Пригласить пользователя"
                    value={inviteUserId}
                    onChange={setInviteUserId}
                    excludeUserIds={excludedInviteIds}
                    disabled={operation.pending}
                  />
                  <Button disabled={operation.pending || !inviteUserId} onClick={invite}>
                    {pendingKind === "invite" ? "Приглашаем…" : "Пригласить"}
                  </Button>
                </section>
              </>
            ) : null}

            {team.isMember && !archived ? (
              <section className="card stack" aria-label="Участие в команде">
                <Button
                  variant="secondary"
                  disabled={operation.pending || team.isCaptain}
                  onClick={() => setLeaveOpen(true)}
                >
                  {pendingKind === "leave" ? "Выходим…" : "Выйти из команды"}
                </Button>
                {team.isCaptain ? <p className="muted">Сначала передайте капитанство другому участнику.</p> : null}
              </section>
            ) : null}

            {team.isCaptain && (team.invitations?.length ?? 0) > 0 ? (
              <section className="card stack" aria-label="Приглашения команды">
                <h2>Приглашения</h2>
                {team.invitations!.map((invitation) => (
                  <p key={invitation.id} className="muted">
                    {invitation.displayName ?? "Пользователь"} ·{" "}
                    {invitationStatusLabels[invitation.status] ?? invitation.status}
                  </p>
                ))}
              </section>
            ) : null}

            {generalIssue ? (
              <Alert
                type={generalIssue.uncertain ? "warning" : "error"}
                variant="tonal"
                role="alert"
                title={generalIssue.title}
                description={generalIssue.description}
              />
            ) : null}
            {actionHint ? <p role="status">{actionHint}</p> : null}

            <Dialog
              open={leaveOpen}
              onClose={operation.pending ? undefined : () => setLeaveOpen(false)}
              title="Выйти из команды?"
              width="sm"
              closeOnEscape={!operation.pending}
              closeOnOverlayClick={!operation.pending}
              secondaryButtonLabel="Отмена"
              onSecondaryButton={operation.pending ? undefined : () => setLeaveOpen(false)}
              mainButtonLabel="Подтвердить выход"
              onMainButton={operation.pending ? undefined : () => {
                setLeaveOpen(false);
                leave();
              }}
            >
              <p>Чтобы вернуться, капитану потребуется пригласить вас снова.</p>
            </Dialog>

            <Dialog
              open={Boolean(confirmation)}
              onClose={operation.pending ? undefined : closeConfirmation}
              title={confirmation
                ? confirmation.kind === "remove"
                  ? `Исключить ${confirmation.member.displayName} из команды?`
                  : `Передать капитанство ${confirmation.member.displayName}?`
                : undefined}
              width="sm"
              closeOnEscape={!operation.pending}
              closeOnOverlayClick={!operation.pending}
            >
              <div className="stack">
                <p>
                  {confirmation?.kind === "remove"
                    ? "Активное участие этого человека завершится. Исторические матчи и турниры сохранятся."
                    : "Новый капитан получит управление составом. Вы останетесь участником и потеряете капитанские права."}
                </p>
                {confirmationIssue ? (
                  <Alert
                    type={confirmationIssue.uncertain ? "warning" : "error"}
                    variant="tonal"
                    role="alert"
                    title={confirmationIssue.title}
                    description={confirmationIssue.description}
                  />
                ) : null}
                {confirmationIssue?.uncertain ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={operation.pending || loading}
                    onClick={() => void reviewUnknownRoster()}
                  >
                    {loading ? "Обновление…" : "Обновить состав"}
                  </Button>
                ) : null}
                <div className="row">
                  <Button
                    ref={cancelConfirmationRef}
                    type="button"
                    variant="secondary"
                    disabled={operation.pending}
                    onClick={closeConfirmation}
                  >
                    Отмена
                  </Button>
                  <Button
                    type="button"
                    disabled={operation.pending || Boolean(confirmationIssue?.uncertain)}
                    onClick={confirmMemberAction}
                  >
                    {operation.pending
                      ? "Выполняем…"
                      : confirmation?.kind === "remove"
                        ? "Исключить участника"
                        : "Передать капитанство"}
                  </Button>
                </div>
              </div>
            </Dialog>

            <Button
              variant="secondary"
              onClick={() => cameFromTeams ? navigate(-1) : navigate("/teams")}
            >
              К списку команд
            </Button>
          </div>
        ) : null}
      </AsyncState>
    </PageLayout>
  );
}
