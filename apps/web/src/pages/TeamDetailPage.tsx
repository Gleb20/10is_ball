import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Alert, Avatar, Button, Chip, Dialog, TextField } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState } from "../patterns";
import { api, type Team } from "../api";
import { UserPicker } from "../components/UserPicker";
import { avatarSrc } from "../avatarSrc";
import { initialsFromName } from "../rankingUi";
import { useSingleFlight } from "../useSingleFlight";
import { useAuth } from "../auth";

type TeamDraft = { name: string; slogan: string; welcomeText: string };

const invitationStatusLabels: Record<string, string> = {
  pending: "Ожидает ответа",
  accepted: "Принято",
  declined: "Отклонено",
  expired: "Истекло",
  cancelled: "Отменено",
};

export function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [team, setTeam] = useState<Team | null>(null);
  const [draft, setDraft] = useState<TeamDraft | null>(null);
  const [inviteUserId, setInviteUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionHint, setActionHint] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const requestSequence = useRef(0);
  const loadedActor = useRef<string | null>(null);
  const action = useSingleFlight();
  const { user } = useAuth();

  const load = useCallback(async (preserveDraft = false) => {
    if (!id) return;
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await api.getTeam(id);
      if (sequence !== requestSequence.current) return;
      setTeam(response.team);
      setDraft((current) =>
        preserveDraft && current
          ? current
          : {
              name: response.team.name,
              slogan: response.team.slogan ?? "",
              welcomeText: response.team.welcomeText ?? "",
            },
      );
    } catch (error) {
      if (sequence === requestSequence.current) {
        if ((error as Error & { status?: number }).status !== 401) {
          setLoadError((error as Error).message);
        }
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!user?.id) {
      requestSequence.current += 1;
      return;
    }
    const identity = `${user.id}:${id}`;
    const sameActor = loadedActor.current === identity;
    loadedActor.current = identity;
    if (!sameActor) {
      setTeam(null);
      setDraft(null);
      setInviteUserId("");
      setActionError(null);
      setActionHint(null);
    }
    void load(sameActor);
    return () => {
      requestSequence.current += 1;
    };
  }, [load, user?.id, id]);

  const archived = team?.status === "archived";
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

  function runAction(work: (sequence: number) => Promise<void>) {
    void action.run(async () => {
      const sequence = ++requestSequence.current;
      setActionError(null);
      setActionHint(null);
      try {
        await work(sequence);
      } catch (error) {
        if (sequence === requestSequence.current && (error as Error & { status?: number }).status !== 401) {
          setActionError((error as Error).message);
        }
      }
    });
  }

  function saveTeam(event: React.FormEvent) {
    event.preventDefault();
    if (!id || !draft || archived || !team?.isCaptain) return;
    runAction(async (sequence) => {
      const response = await api.updateTeam(id, {
        name: draft.name.trim(),
        slogan: draft.slogan.trim(),
        welcomeText: draft.welcomeText.trim(),
      });
      if (sequence !== requestSequence.current) return;
      setTeam(response.team);
      setDraft({
        name: response.team.name,
        slogan: response.team.slogan ?? "",
        welcomeText: response.team.welcomeText ?? "",
      });
      setActionHint("Изменения сохранены.");
    });
  }

  function invite() {
    if (!id || !inviteUserId || archived || !team?.isCaptain) return;
    runAction(async (sequence) => {
      await api.inviteTeamMember(id, inviteUserId);
      if (sequence !== requestSequence.current) return;
      setInviteUserId("");
      setActionHint("Приглашение отправлено.");
      await load(true);
    });
  }

  function removeMember(userId: string) {
    if (!id || archived || !team?.isCaptain) return;
    runAction(async (sequence) => {
      const response = await api.removeTeamMember(id, userId);
      if (sequence !== requestSequence.current) return;
      setTeam(response.team);
      setActionHint("Участник исключён.");
    });
  }

  function transferCaptain(userId: string) {
    if (!id || archived || !team?.isCaptain) return;
    runAction(async (sequence) => {
      const response = await api.transferTeamCaptain(id, userId);
      if (sequence !== requestSequence.current) return;
      setTeam(response.team);
      setActionHint("Капитанство передано.");
    });
  }

  function leave() {
    if (!id || archived || !team?.isMember || team.isCaptain) return;
    runAction(async (sequence) => {
      const response = await api.leaveTeam(id);
      if (sequence !== requestSequence.current) return;
      setTeam(response.team);
      setActionHint("Вы вышли из команды.");
    });
  }

  return (
    <PageLayout
      title={team?.name ?? "Команда"}
      action={
        <Button size="sm" variant="secondary" disabled={loading || action.pending} onClick={() => void load()}>
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
              <div className="row">
                <Chip size="sm" variant="tonal" label={archived ? "Архив" : "Активна"} />
                {team.isCaptain ? <Chip size="sm" variant="tonal" label="Вы капитан" /> : null}
              </div>
              {team.slogan ? <p>{team.slogan}</p> : <p className="muted">Слоган не указан.</p>}
              {team.welcomeText ? <p className="muted">{team.welcomeText}</p> : null}
            </section>

            <section className="card stack" aria-label="Состав команды">
              <h2>Участники</h2>
              {team.members.length === 0 ? <p className="muted">В команде не осталось участников.</p> : null}
              {team.members.map((member) => {
                const captain = member.userId === team.captainUserId;
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
                    </div>
                    {team.isCaptain && !archived && !captain ? (
                      <div className="list-row__trailing row">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={action.pending}
                          aria-label={`Передать капитанство ${member.displayName}`}
                          onClick={() => transferCaptain(member.userId)}
                        >
                          Передать
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={action.pending}
                          aria-label={`Исключить ${member.displayName}`}
                          onClick={() => removeMember(member.userId)}
                        >
                          Исключить
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </section>

            {team.isCaptain && !archived && draft ? (
              <>
                <form className="card stack" aria-label="Редактирование команды" onSubmit={saveTeam}>
                  <h2>Настройки</h2>
                  <TextField
                    label="Название команды"
                    value={draft.name}
                    required
                    disabled={action.pending}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, name: event.target.value })}
                  />
                  <TextField
                    label="Слоган"
                    value={draft.slogan}
                    disabled={action.pending}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, slogan: event.target.value })}
                  />
                  <TextField
                    label="Текст приветствия"
                    value={draft.welcomeText}
                    disabled={action.pending}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, welcomeText: event.target.value })}
                  />
                  <Button type="submit" disabled={action.pending || !draft.name.trim()}>
                    {action.pending ? "Сохраняем…" : "Сохранить"}
                  </Button>
                </form>
                <section className="card stack" aria-label="Приглашение в команду">
                  <h2>Пригласить участника</h2>
                  <UserPicker
                    label="Пригласить пользователя"
                    value={inviteUserId}
                    onChange={setInviteUserId}
                    excludeUserIds={excludedInviteIds}
                    disabled={action.pending}
                  />
                  <Button disabled={action.pending || !inviteUserId} onClick={invite}>
                    {action.pending ? "Приглашаем…" : "Пригласить"}
                  </Button>
                </section>
              </>
            ) : null}

            {team.isMember && !archived ? (
              <section className="card stack" aria-label="Участие в команде">
                <Button
                  variant="secondary"
                  disabled={action.pending || team.isCaptain}
                  onClick={() => setLeaveOpen(true)}
                >
                  {action.pending ? "Выполняем…" : "Выйти из команды"}
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

            {actionError ? <Alert type="error" variant="tonal" title="Действие не выполнено" description={actionError} /> : null}
            {actionHint ? <p role="status">{actionHint}</p> : null}
            <Dialog
              open={leaveOpen}
              onClose={() => setLeaveOpen(false)}
              title="Выйти из команды?"
              width="sm"
              secondaryButtonLabel="Отмена"
              onSecondaryButton={() => setLeaveOpen(false)}
              mainButtonLabel="Подтвердить выход"
              onMainButton={() => {
                setLeaveOpen(false);
                leave();
              }}
            >
              <p>Чтобы вернуться, капитану потребуется пригласить вас снова.</p>
            </Dialog>
            <Button variant="secondary" onClick={() => navigate("/teams")}>К списку команд</Button>
          </div>
        ) : null}
      </AsyncState>
    </PageLayout>
  );
}
