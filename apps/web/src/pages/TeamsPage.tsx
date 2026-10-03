import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, TextField } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, ListRow } from "../patterns";
import { api, type Team } from "../api";
import { useLifecycleSingleFlight } from "./useLifecycleSingleFlight";
import { useAuth } from "../auth";
import { TeamAvatar, TeamAvatarPicker } from "../components/TeamAvatar";
import type { AvatarKey } from "@tab10/shared";

type CreateIssue = {
  title: string;
  description: string;
  uncertain: boolean;
};

type TeamsReturnContext = {
  userId: string;
  detailPath: string;
  teamId: string;
  scrollY: number;
  navigationToken: string;
};

const TEAMS_RETURN_KEY = "tab10.teams.return";

function takeTeamsReturnContext(userId: string): TeamsReturnContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(TEAMS_RETURN_KEY);
    window.sessionStorage.removeItem(TEAMS_RETURN_KEY);
    if (!raw) return null;
    const candidate = JSON.parse(raw) as Partial<TeamsReturnContext>;
    if (
      candidate.userId !== userId ||
      typeof candidate.teamId !== "string" ||
      candidate.teamId.length === 0 ||
      candidate.detailPath !== `/teams/${candidate.teamId}` ||
      typeof candidate.scrollY !== "number" ||
      !Number.isFinite(candidate.scrollY) ||
      typeof candidate.navigationToken !== "string" ||
      candidate.navigationToken.length === 0
    ) return null;
    return {
      userId,
      teamId: candidate.teamId,
      detailPath: candidate.detailPath,
      scrollY: Math.max(0, candidate.scrollY),
      navigationToken: candidate.navigationToken,
    };
  } catch {
    try { window.sessionStorage.removeItem(TEAMS_RETURN_KEY); } catch { /* optional context */ }
    return null;
  }
}

function isKnownRejection(error: unknown) {
  const status = (error as { status?: number }).status;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 401;
}

export function TeamsPage() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createIssue, setCreateIssue] = useState<CreateIssue | null>(null);
  const [unknownReviewed, setUnknownReviewed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [slogan, setSlogan] = useState("");
  const [welcomeText, setWelcomeText] = useState("");
  const [avatarKey, setAvatarKey] = useState<AvatarKey | null>(null);
  const [authorizedListRevision, setAuthorizedListRevision] = useState(0);
  const submission = useLifecycleSingleFlight();
  const { user } = useAuth();
  const userRef = useRef(user);
  const mountedRef = useRef(false);
  const lifecycleGenerationRef = useRef(0);
  const requestSequence = useRef(0);
  const createActorRef = useRef<string | null>(null);
  const interruptedCreateActorRef = useRef<string | null>(null);
  const lastActorIdRef = useRef(user?.id ?? null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const teamContainersRef = useRef(new Map<string, HTMLDivElement>());
  const teamsHeadingRef = useRef<HTMLHeadingElement>(null);
  const returnContextRef = useRef<TeamsReturnContext | null>(null);
  const returnContextActorRef = useRef<string | null>(null);
  const [navigationToken] = useState(() => crypto.randomUUID());
  const [pendingFocusTeamId, setPendingFocusTeamId] = useState<string | null>(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const isCurrentLifecycle = useCallback((actorId: string, generation: number) => (
    mountedRef.current &&
    lifecycleGenerationRef.current === generation &&
    userRef.current?.id === actorId
  ), []);

  const load = useCallback(async () => {
    const actorId = userRef.current?.id;
    if (!actorId) return false;
    const generation = lifecycleGenerationRef.current;
    const sequence = ++requestSequence.current;
    setLoadError(null);
    try {
      const res = await api.listTeams();
      if (
        sequence === requestSequence.current &&
        isCurrentLifecycle(actorId, generation)
      ) {
        setTeams(res.teams);
        setAuthorizedListRevision((revision) => revision + 1);
        return true;
      }
    } catch (error) {
      if (
        sequence === requestSequence.current &&
        isCurrentLifecycle(actorId, generation) &&
        (error as Error & { status?: number }).status !== 401
      ) {
        setLoadError((error as Error).message);
      }
    }
    return false;
  }, [isCurrentLifecycle]);

  useEffect(() => {
    mountedRef.current = true;
    lifecycleGenerationRef.current += 1;
    submission.resume();
    const actorId = userRef.current?.id ?? null;
    const actorChanged = Boolean(
      actorId && lastActorIdRef.current && actorId !== lastActorIdRef.current,
    );
    if (actorId && returnContextActorRef.current !== actorId) {
      returnContextActorRef.current = actorId;
      const candidate = takeTeamsReturnContext(actorId);
      returnContextRef.current = actorChanged ? null : candidate;
    }
    if (actorChanged) {
      setTeams(null);
      setAuthorizedListRevision(0);
      setCreateOpen(false);
      setName("");
      setSlogan("");
      setWelcomeText("");
      setAvatarKey(null);
      setCreateIssue(null);
      setUnknownReviewed(false);
      interruptedCreateActorRef.current = null;
      returnContextRef.current = null;
    } else if (actorId && interruptedCreateActorRef.current === actorId) {
      interruptedCreateActorRef.current = null;
      setCreateOpen(true);
      setUnknownReviewed(false);
      setCreateIssue({
        title: "Не удалось подтвердить создание",
        description: "Команда могла быть создана. Введённые значения сохранены. Обновите список перед новым явным решением.",
        uncertain: true,
      });
    } else if (actorId && interruptedCreateActorRef.current) {
      interruptedCreateActorRef.current = null;
    }
    if (actorId) lastActorIdRef.current = actorId;
    void load();
    return () => {
      mountedRef.current = false;
      lifecycleGenerationRef.current += 1;
      requestSequence.current += 1;
      if (submission.invalidate() && createActorRef.current) {
        interruptedCreateActorRef.current = createActorRef.current;
      }
    };
  }, [load, user?.id]);

  useEffect(() => {
    if (createOpen) nameInputRef.current?.focus();
  }, [createOpen]);

  useEffect(() => {
    if (!pendingFocusTeamId) return;
    const link = teamContainersRef.current
      .get(pendingFocusTeamId)
      ?.querySelector<HTMLAnchorElement>("a");
    if (!link) return;
    link.focus();
    setPendingFocusTeamId(null);
  }, [pendingFocusTeamId, teams]);

  useEffect(() => {
    const context = returnContextRef.current;
    if (!context || authorizedListRevision === 0 || teams === null) return;
    returnContextRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      if (!mountedRef.current || userRef.current?.id !== context.userId) return;
      const link = teamContainersRef.current
        .get(context.teamId)
        ?.querySelector<HTMLAnchorElement>("a");
      (link ?? teamsHeadingRef.current)?.focus({ preventScroll: true });
      const pageHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight ?? 0,
      );
      const maxScrollY = Math.max(0, pageHeight - window.innerHeight);
      window.scrollTo(0, Math.min(context.scrollY, maxScrollY));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [authorizedListRevision, teams]);

  function rememberTeamReturn(teamId: string) {
    const actorId = userRef.current?.id;
    if (!actorId) return;
    try {
      window.sessionStorage.setItem(TEAMS_RETURN_KEY, JSON.stringify({
        userId: actorId,
        detailPath: `/teams/${teamId}`,
        teamId,
        scrollY: Math.max(0, window.scrollY),
        navigationToken,
      } satisfies TeamsReturnContext));
    } catch { /* navigation remains available without optional context */ }
  }

  function toggleCreate() {
    if (submission.pending) return;
    if (createOpen) {
      setCreateOpen(false);
      createButtonRef.current?.focus();
    } else {
      setCreateOpen(true);
    }
  }

  async function reviewUnknownCreate() {
    const refreshed = await load();
    if (!refreshed) return;
    setUnknownReviewed(true);
    setCreateIssue({
      title: "Список обновлён",
      description: "Это текущее состояние сервера, а не подтверждение исхода предыдущего запроса. Проверьте список перед повторным созданием.",
      uncertain: true,
    });
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const actorId = userRef.current?.id;
    if (!actorId || (createIssue?.uncertain && !unknownReviewed)) return;
    await submission.run(async () => {
      createActorRef.current = actorId;
      const generation = lifecycleGenerationRef.current;
      const payload = {
        name: name.trim(),
        ...(slogan.trim() ? { slogan: slogan.trim() } : {}),
        ...(welcomeText.trim() ? { welcomeText: welcomeText.trim() } : {}),
        ...(avatarKey ? { avatarKey } : {}),
      };
      setCreateIssue(null);
      setUnknownReviewed(false);
      try {
        const response = await api.createTeam(payload);
        if (!isCurrentLifecycle(actorId, generation)) return;
        requestSequence.current += 1;
        setName("");
        setSlogan("");
        setWelcomeText("");
        setAvatarKey(null);
        setCreateOpen(false);
        setTeams((current) => [
          response.team,
          ...(current ?? []).filter((team) => team.id !== response.team.id),
        ]);
        setPendingFocusTeamId(response.team.id);
      } catch (error) {
        if (
          !isCurrentLifecycle(actorId, generation) ||
          (error as Error & { status?: number }).status === 401
        ) return;
        setCreateIssue(isKnownRejection(error)
          ? {
              title: "Не удалось создать команду",
              description: (error as Error).message,
              uncertain: false,
            }
          : {
              title: "Не удалось подтвердить создание",
              description: "Команда могла быть создана. Введённые значения сохранены. Обновите список перед новым явным решением.",
              uncertain: true,
            });
      }
    });
  }

  return (
    <PageLayout title="Команды">
      <section className="stack" aria-labelledby="my-teams-heading">
        <h2 ref={teamsHeadingRef} id="my-teams-heading" className="section-title" tabIndex={-1}>Мои команды</h2>
        <Button
          ref={createButtonRef}
          type="button"
          variant="secondary"
          aria-expanded={createOpen}
          aria-controls="team-create-form"
          disabled={submission.pending}
          onClick={toggleCreate}
        >
          {createOpen ? "Скрыть форму" : "Создать команду"}
        </Button>

        {createOpen ? (
          <form
            id="team-create-form"
            className="card stack"
            onSubmit={create}
            aria-label="Создание команды"
          >
            <TextField
              ref={nameInputRef}
              label="Название команды"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              required
              disabled={submission.pending}
            />
            <TeamAvatarPicker
              value={avatarKey}
              onChange={setAvatarKey}
              name="create-team-avatar"
              disabled={submission.pending}
            />
            <TextField
              label="Слоган"
              value={slogan}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSlogan(e.target.value)}
              disabled={submission.pending}
            />
            <TextField
              label="Текст приветствия"
              value={welcomeText}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWelcomeText(e.target.value)}
              disabled={submission.pending}
            />
            {createIssue ? (
              <Alert
                type={createIssue.uncertain ? "warning" : "error"}
                variant="tonal"
                role="alert"
                title={createIssue.title}
                description={createIssue.description}
              />
            ) : null}
            {createIssue?.uncertain ? (
              <Button
                type="button"
                variant="secondary"
                disabled={submission.pending}
                onClick={() => void reviewUnknownCreate()}
              >
                Обновить список
              </Button>
            ) : null}
            <Button
              type="submit"
              disabled={submission.pending || !name.trim() || Boolean(createIssue?.uncertain && !unknownReviewed)}
            >
              {submission.pending
                ? "Создание…"
                : createIssue?.uncertain && unknownReviewed
                  ? "Создать ещё раз"
                  : "Создать"}
            </Button>
          </form>
        ) : null}

        {loadError ? (
          <div className="card stack">
            <Alert type="error" variant="tonal" title="Не удалось загрузить команды" description={loadError} />
            <Button variant="secondary" onClick={() => void load()}>Повторить загрузку</Button>
          </div>
        ) : (
          <AsyncState
            loading={teams === null}
            empty={teams !== null && teams.length === 0}
            emptyTitle="Нет команд"
            emptyDescription="Создайте первую команду, когда будете готовы."
          >
            <div className="stack">
              {(teams ?? []).map((team) => (
                <div
                  key={team.id}
                  ref={(node) => {
                    if (node) teamContainersRef.current.set(team.id, node);
                    else teamContainersRef.current.delete(team.id);
                  }}
                >
                  <ListRow
                    to={`/teams/${team.id}`}
                    state={{
                      returnTo: "/teams",
                      returnLabel: "К списку команд",
                      teamsReturnToken: navigationToken,
                    }}
                    onClick={() => rememberTeamReturn(team.id)}
                    leading={<TeamAvatar avatarKey={team.avatarKey} teamName={team.name} />}
                    title={team.name}
                    subtitle={[
                      team.slogan,
                      `${team.members.length} участников`,
                      team.isCaptain ? "Вы капитан" : "Вы участник",
                      team.status === "archived" ? "Архив" : null,
                    ].filter(Boolean).join(" · ")}
                  />
                </div>
              ))}
            </div>
          </AsyncState>
        )}
      </section>
    </PageLayout>
  );
}
