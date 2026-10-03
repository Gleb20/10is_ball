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

const hiddenInvitationTypes = new Set(["match_invitation", "judge_invitation", "tournament_invitation"]);
const terminalLifecycles = new Set(["accepted", "declined", "expired", "cancelled"]);

function isTerminal(n: NotificationRow): boolean {
  return terminalLifecycles.has(n.lifecycle ?? "");
}

function hasJudgeHandoverAction(n: NotificationRow): boolean {
  return ["judge_handover", "judge_handover_offered"].includes(n.type) &&
    Boolean(n.payload?.matchId) &&
    !isTerminal(n);
}

function hasNotificationAction(n: NotificationRow): boolean {
  if (isTerminal(n)) return false;
  if (n.actionable === true || hasJudgeHandoverAction(n)) return true;
  return n.type === "team_invitation" &&
    n.actionable === undefined &&
    (n.lifecycle ?? "new") === "new" &&
    Boolean(n.payload?.invitationId);
}

function isActualNotification(n: NotificationRow): boolean {
  if (isTerminal(n)) return false;
  return hasNotificationAction(n) ||
    (((n.lifecycle ?? "new") === "new") && !n.readAt);
}

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
  const mounted = useRef(false);
  const generation = useRef(0);
  const mutating = useRef(false);
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const action = useSingleFlight();
  const [onlyActual, setOnlyActual] = useState(true);
  const readRequests = useRef(new Set<string>());
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<{
    target: string | "heading";
    generation: number;
  } | null>(null);

  const load = useCallback(async (force = false) => {
    if (!userId || (mutating.current && !force)) return;
    const current = ++sequence.current;
    const operationGeneration = generation.current;
    const res = await api.notifications();
    if (mounted.current &&
        operationGeneration === generation.current &&
        current === sequence.current) {
      setItems((res.notifications as NotificationRow[]).filter((row) => !hiddenInvitationTypes.has(row.type)));
    }
  }, [userId]);
  useEffect(() => {
    const activeGeneration = ++generation.current;
    mounted.current = true;
    return () => {
      if (generation.current !== activeGeneration) return;
      mounted.current = false;
      generation.current += 1;
      pendingFocus.current = null;
    };
  }, []);
  const { error, refreshNow } = useVisibleRefresh(load, { refreshKey: userId });

  const visible = useMemo(() => {
    const all = items ?? [];
    if (!onlyActual) return all;
    return all.filter(isActualNotification);
  }, [items, onlyActual]);

  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    queueMicrotask(() => {
      if (!mounted.current || pending.generation !== generation.current) return;
      if (pending.target === "heading") listHeadingRef.current?.focus();
      else cardRefs.current.get(pending.target)?.focus();
    });
  }, [visible]);

  function preserveFocusAfterRemoval(
    before: NotificationRow[],
    updated: NotificationRow[],
    focusedCard?: string,
  ) {
    if (!onlyActual || !focusedCard) return;
    const beforeVisible = before.filter(isActualNotification);
    const afterVisible = updated.filter(isActualNotification);
    if (!beforeVisible.some((row) => row.id === focusedCard) ||
        afterVisible.some((row) => row.id === focusedCard)) return;
    const removedIndex = beforeVisible.findIndex((row) => row.id === focusedCard);
    pendingFocus.current = {
      target: afterVisible[removedIndex]?.id ??
        afterVisible[removedIndex - 1]?.id ??
        "heading",
      generation: generation.current,
    };
  }

  useEffect(() => {
    const ids = visible
      .filter((notification) => !notification.readAt)
      .map((notification) => notification.id)
      .filter((id) => !readRequests.current.has(id));
    if (ids.length === 0) return;
    const current = ++sequence.current;
    const operationGeneration = generation.current;
    ids.forEach((id) => readRequests.current.add(id));
    void api
      .markNotificationsReadVisible(ids)
      .then((response) => {
        if (!mounted.current ||
            operationGeneration !== generation.current ||
            current !== sequence.current) return;
        const readAtById = new Map(
          response.notifications
            .filter((notification) => Boolean(notification.id && notification.readAt))
            .map((notification) => [notification.id, notification.readAt]),
        );
        const omitted = ids.filter((id) => !readAtById.has(id));
        if (omitted.length > 0) {
          setActionError("Не удалось подтвердить чтение части уведомлений. Обновите список.");
        }
        const focusedCard = document.activeElement?.closest<HTMLElement>("[data-notification-id]")?.dataset.notificationId;
        setItems((current) => {
          const before = current ?? [];
          const updated = before.map((notification) => ({
            ...notification,
            readAt: readAtById.get(notification.id) ?? notification.readAt,
          }));
          preserveFocusAfterRemoval(before, updated, focusedCard);
          return updated;
        });
      })
      .catch((caught: Error) => {
        if (!mounted.current ||
            operationGeneration !== generation.current ||
            current !== sequence.current) return;
        ids.forEach((id) => readRequests.current.delete(id));
        if ((caught as Error & { status?: number }).status !== 401) setActionError(caught.message);
      });
  }, [visible]);

  async function markRead(id: string) {
    const current = sequence.current;
    const operationGeneration = generation.current;
    try {
      const response = await api.markNotificationRead(id) as {
        notification?: { id?: string; readAt?: string | null } | null;
      };
      if (!mounted.current ||
          operationGeneration !== generation.current ||
          current !== sequence.current) return;
      const confirmed = response.notification;
      if (confirmed?.id === id && confirmed.readAt) {
        const focusedCard = document.activeElement?.closest<HTMLElement>("[data-notification-id]")?.dataset.notificationId;
        setItems((prev) => {
          const before = prev ?? [];
          const updated = before.map((n) =>
            n.id === id ? { ...n, readAt: confirmed.readAt } : n,
          );
          preserveFocusAfterRemoval(before, updated, focusedCard);
          return updated;
        });
        return;
      }
      setActionError("Не удалось подтвердить чтение уведомления. Обновите список.");
      await load(true);
    } catch (cause) {
      if (!mounted.current ||
          operationGeneration !== generation.current ||
          current !== sequence.current) return;
      if ((cause as Error & { status?: number }).status !== 401) {
        setActionError((cause as Error).message);
        await load(true).catch(() => undefined);
      }
    }
  }

  async function respondTeamInvite(invitationId: string, accept: boolean) {
    await action.run(async () => {
      mutating.current = true;
      sequence.current += 1;
      const operationGeneration = generation.current;
      setActionError(null);
      try {
        const result = await api.respondTeamInvitation(invitationId, accept);
        if (!mounted.current ||
            operationGeneration !== generation.current) return;
        if (accept && result?.status === "accepted" && result.teamId) {
          navigate(`/teams/${result.teamId}?welcome=1`);
          return;
        }
        await load(true);
      } catch (e) {
        if (!mounted.current || operationGeneration !== generation.current) return;
        if ((e as Error & { status?: number }).status !== 401) { setActionError((e as Error).message); await load(true); }
      } finally {
        mutating.current = false;
      }
    });
  }

  const isInviteActionable = (n: NotificationRow) =>
    n.type === "team_invitation" &&
    hasNotificationAction(n) &&
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
      <h2 ref={listHeadingRef} className="visually-hidden" tabIndex={-1}>Список уведомлений</h2>
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
            <div
              key={n.id}
              className="card stack"
              role="group"
              aria-label={n.title}
              tabIndex={-1}
              data-notification-id={n.id}
              ref={(node) => {
                if (node) cardRefs.current.set(n.id, node);
                else cardRefs.current.delete(n.id);
              }}
            >
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
              {!isInviteActionable(n) && n.payload?.matchId && !["expired", "cancelled", "declined"].includes(n.lifecycle ?? "") ? (
                <Button variant="secondary" onClick={() => navigate(`/matches/${n.payload!.matchId}${["judge_invitation", "judge_handover", "judge_handover_offered"].includes(n.type) ? "/judge" : ""}`)}>Открыть матч</Button>
              ) : null}
              {!isInviteActionable(n) && n.payload?.teamId && ["team_captain_assigned", "captain_assigned"].includes(n.type) ? <Button variant="secondary" onClick={() => navigate(`/teams/${n.payload!.teamId}`)}>Открыть команду</Button> : null}
              {!isInviteActionable(n) && n.payload?.tournamentId && n.type !== "tournament_invitation" ? <Button variant="secondary" onClick={() => navigate(`/tournaments/${n.payload!.tournamentId}`)}>Открыть турнир</Button> : null}
              {(n.lifecycle ?? "new") === "new" &&
              n.type !== "match_invitation" && n.type !== "judge_invitation" &&
              n.type !== "team_invitation" &&
              n.type !== "tournament_invitation" &&
              n.type !== "tournament_match_ready" &&
              !hasJudgeHandoverAction(n) &&
              !n.readAt ? (
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
