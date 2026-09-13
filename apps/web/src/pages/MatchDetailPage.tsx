import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Avatar, Button, Dialog, TextField } from "../ui";
import { PageLayout } from "../layout";
import {
  AsyncState,
  FilterBar,
  RefreshButton,
  StatusChip,
} from "../patterns";
import { api } from "../api";
import { useAuth } from "../auth";
import {
  elapsedMs,
  formatMatchDuration,
  type ActiveJudge,
} from "../judgeUi";
import { initialsFromName } from "../rankingUi";
import { avatarSrc } from "../avatarSrc";
import { useVisibleRefresh } from "../useVisibleRefresh";
import { useSingleFlight } from "../useSingleFlight";

type AdminConfirm = "force-close" | "delete" | null;
type MatchEvent = { type: string; side?: "A" | "B" };

function cleanPointLog(events: MatchEvent[]): Array<"A" | "B"> {
  const points: Array<"A" | "B"> = [];
  for (const event of events) {
    if (event.type === "manual_correction") points.length = 0;
    else if (event.type === "point_awarded" && event.side) points.push(event.side);
  }
  return points;
}

export function MatchDetailPage() {
  const { id } = useParams();
  const currentIdRef = useRef(id);
  currentIdRef.current = id;
  const navigate = useNavigate();
  const { user } = useAuth();
  const [match, setMatch] = useState<Record<string, unknown> | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [startServerId, setStartServerId] = useState("");
  const [stopOpen, setStopOpen] = useState(false);
  const [stopSide, setStopSide] = useState<"A" | "B">("A");
  const [stopReason, setStopReason] = useState("injury");
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [absentSide, setAbsentSide] = useState<"A" | "B">("B");
  const [noShowReason, setNoShowReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [adminConfirm, setAdminConfirm] = useState<AdminConfirm>(null);
  const action = useSingleFlight();
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    const requestedId = id;
    if (!requestedId) return;
    const res = await api.getMatch(requestedId);
    if (currentIdRef.current === requestedId) setMatch(res.match);
  }, [id]);

  const pollingEnabled =
    match === null ||
    match.status === "waiting" ||
    match.status === "in_progress" ||
    match.status === "pending_confirmation";
  const {
    error: refreshError,
    refreshing,
    refreshNow,
  } = useVisibleRefresh(load, { pollingEnabled, refreshKey: id });

  useEffect(() => {
    if (match?.status !== "in_progress") return;
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(tick);
  }, [match?.status]);

  const participants =
    (match?.participants as Array<{
      id?: string;
      side: string;
      userId?: string | null;
      displayName?: string;
      avatarKey?: string | null;
    }>) ?? [];

  const activeJudge = match?.activeJudge as ActiveJudge | null | undefined;
  const judgeTakenByOther =
    activeJudge != null && activeJudge.userId !== user?.id;

  const isActiveStatus =
    match?.status === "waiting" ||
    match?.status === "in_progress" ||
    match?.status === "pending_confirmation";

  const isCreator = Boolean(user?.id) && match?.createdByUserId === user?.id;
  const isCurrentJudge =
    Boolean(user?.id) && activeJudge?.userId === user?.id;
  const canStart = match?.status === "waiting" && isCreator;
  const canStop =
    (match?.status === "in_progress" ||
      match?.status === "pending_confirmation") &&
    (isCreator || isCurrentJudge);
  const canNoShow = isActiveStatus && (isCreator || isCurrentJudge);
  const currentUserParticipates = participants.some((p) => p.userId === user?.id);
  const canCreateRevenge =
    match?.kind === "standalone" &&
    ["finished", "stopped"].includes(String(match?.status)) &&
    currentUserParticipates;

  const sideName = (side: "A" | "B") =>
    participants
      .filter((participant) => participant.side === side)
      .map((participant) => participant.displayName ?? `Сторона ${side}`)
      .join(" + ") || `Сторона ${side}`;
  const pointLog = cleanPointLog((match?.eventLog as MatchEvent[] | undefined) ?? []);

  const canCancel =
    match?.kind === "standalone" &&
    isActiveStatus &&
    (isCreator || user?.role === "admin");
  const canVoid =
    (match?.kind === "standalone" || match?.kind === "tournament") &&
    (match?.status === "finished" || match?.status === "stopped") &&
    (isCreator || user?.role === "admin");

  const isAdminStandalone =
    user?.role === "admin" && match?.kind === "standalone";
  const canForceClose = isAdminStandalone && isActiveStatus;
  const canAdminPurge =
    isAdminStandalone &&
    match?.status !== "finished" &&
    match?.status !== "stopped" &&
    match?.status !== "voided";

  const durationLabel =
    match?.startedAt != null
      ? formatMatchDuration(
          elapsedMs(
            String(match.startedAt),
            now,
            match.finishedAt ? String(match.finishedAt) : null,
            String(match.status),
          ),
        )
      : null;

  async function onStart() {
    if (!id || !match) return;
    const method = String(match.firstServerMethod ?? "manual");
    if (method !== "random" && !startServerId) return;
    await action.run(async () => {
      setActionError(null);
      try {
        const result = await api.startMatch(
          id,
          method === "random"
            ? {}
            : { firstServerParticipantId: startServerId },
        );
        setMatch(result.match);
        setStartOpen(false);
      } catch (error) {
        setActionError((error as Error).message);
      }
    });
  }

  async function onStop() {
    await action.run(async () => {
      setActionError(null);
      try {
        const res = await api.stopMatch(id!, {
          winnerSide: stopSide,
          reasonCode: stopReason,
        });
        setMatch(res.match);
        setStopOpen(false);
      } catch (e) {
        setActionError((e as Error).message);
      }
    });
  }

  async function onNoShow() {
    if (!id) return;
    await action.run(async () => {
      setActionError(null);
      try {
        const result = await api.noShowMatch(
          id,
          {
            expectedVersion: Number(match?.version),
            absentSide,
            reasonText: noShowReason.trim() || undefined,
          },
          crypto.randomUUID(),
        );
        setMatch(result.match);
        setNoShowOpen(false);
      } catch (error) {
        setActionError((error as Error).message);
      }
    });
  }

  async function onCancelConfirm() {
    if (!id) return;
    await action.run(async () => {
      setActionError(null);
      try {
        const res = await api.cancelMatch(
          id,
          Number(match?.version),
          crypto.randomUUID(),
        );
        setMatch(res.match);
        setCancelOpen(false);
      } catch (e) {
        setActionError((e as Error).message);
        setCancelOpen(false);
      }
    });
  }

  async function onVoidConfirm() {
    if (!id) return;
    await action.run(async () => {
      setActionError(null);
      try {
        const res = await api.voidMatch(
          id,
          Number(match?.version),
          crypto.randomUUID(),
          voidReason.trim() || undefined,
        );
        setMatch(res.match);
        setVoidOpen(false);
        setVoidReason("");
      } catch (e) {
        setActionError((e as Error).message);
        setVoidOpen(false);
      }
    });
  }

  async function onAdminConfirm() {
    if (!adminConfirm || !id) return;
    await action.run(async () => {
      setActionError(null);
      try {
        if (adminConfirm === "force-close") {
          const res = await api.adminForceCloseMatch(
            id,
            Number(match?.version),
            crypto.randomUUID(),
          );
          setMatch(res.match);
          setAdminConfirm(null);
        } else {
          await api.adminDeleteMatch(id);
          setAdminConfirm(null);
          navigate("/history");
        }
      } catch (e) {
        setActionError((e as Error).message);
        setAdminConfirm(null);
      }
    });
  }

  return (
    <PageLayout
      title={match ? String(match.title) : "Матч"}
      action={
        <RefreshButton refreshing={refreshing} onRefresh={refreshNow} />
      }
    >
      <AsyncState
        loading={!match && !refreshError}
        error={!match ? refreshError : null}
      >
        {match ? (
          <>
            {refreshError ? (
              <Alert
                type="warning"
                variant="tonal"
                title="Не удалось обновить"
                description={refreshError}
              />
            ) : null}
            <div className="card stack">
              <div className="row">
                <StatusChip status={String(match.status)} />
              </div>
              <p className="score-display">
                {String(match.scoreA)} : {String(match.scoreB)}
              </p>
              <div className="match-rules" aria-label="Правила матча">
                <strong>{match.format === "2v2" ? "2 × 2" : "1 × 1"}</strong>
                <span>до {String(match.pointsToWin)} очков</span>
                <span>
                  {match.mercyEnabled
                    ? `сухая победа при ${String(match.mercyPoints)}:0`
                    : "без правила сухой победы"}
                </span>
                <span>
                  первая подача: {match.firstServerMethod === "random" ? "случайно" : match.firstServerMethod === "rally" ? "розыгрыш" : "вручную"}
                </span>
              </div>
              {durationLabel ? (
                <p className="muted">Длительность: {durationLabel}</p>
              ) : null}
              {activeJudge ? (
                <p className="muted">Судит: {activeJudge.displayName}</p>
              ) : match.judgeReservation ? (
                <p className="muted">
                  Судейство передаётся: {String((match.judgeReservation as { displayName?: string }).displayName ?? "назначенному пользователю")}
                </p>
              ) : (
                <p className="muted">Судья не назначен</p>
              )}
              {participants.length > 0 ? (
                <div className="stack">
                  {participants.map((p) => (
                    <div
                      key={`${p.side}-${p.displayName}`}
                      className="row"
                    >
                      <Avatar
                        size="sm"
                        variant="tonal"
                        src={avatarSrc(p.avatarKey)}
                        initials={initialsFromName(p.displayName ?? p.side)}
                        alt={p.displayName}
                      />
                      <span>
                        {p.side}: {p.displayName ?? "—"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {match.finishReason === "no_show" ? (
                <Alert
                  type="warning"
                  variant="tonal"
                  title="Матч завершён из-за неявки"
                  description={`Не явилась сторона ${match.winnerSide === "A" ? "B" : "A"}. Победитель: ${sideName(String(match.winnerSide) as "A" | "B")}. Причина: ${String(match.stopReasonText ?? "Неявка")}. Счёт сохранён без вымышленных очков.`}
                />
              ) : null}
            </div>
            <div className="card stack" aria-label="Журнал очков">
              <h2>Журнал очков</h2>
              {pointLog.length > 0 ? (
                <ol className="match-point-log">
                  {pointLog.map((side, index) => (
                    <li key={`${index}-${side}`}>{sideName(side)} — очко</li>
                  ))}
                </ol>
              ) : (
                <p className="muted">Подтверждённых очков после последней коррекции нет.</p>
              )}
              {(match.eventLog as MatchEvent[] | undefined)?.some((event) => event.type === "manual_correction") ? (
                <p className="muted">Техническая коррекция учтена в текущем счёте и не показана как игровое очко.</p>
              ) : null}
            </div>
            <div className="stack stack--actions">
              {canStart && (
                <Button
                  disabled={action.pending}
                  onClick={() => {
                    setStartServerId("");
                    setStartOpen(true);
                  }}
                >
                  Старт
                </Button>
              )}
              {(match.status === "in_progress" ||
                match.status === "pending_confirmation" ||
                match.status === "waiting") && (
                <>
                  <Button
                    disabled={judgeTakenByOther}
                    onClick={() => navigate(`/matches/${id}/judge`)}
                  >
                    Судить
                  </Button>
                  {judgeTakenByOther ? (
                    <p className="muted">
                      Матч уже судит {activeJudge?.displayName}. Можно открыть
                      счёт в режиме просмотра.
                    </p>
                  ) : null}
                  <Button
                    variant="secondary"
                    onClick={() => navigate(`/matches/${id}/judge?mode=readonly`)}
                  >
                    Открыть счёт
                  </Button>
                </>
              )}
              {canStop && (
                <Button
                  variant="secondary"
                  disabled={action.pending}
                  onClick={() => setStopOpen((v) => !v)}
                >
                  {stopOpen ? "Скрыть остановку" : "Остановить матч"}
                </Button>
              )}
              {canNoShow ? (
                <Button
                  variant="secondary"
                  disabled={action.pending}
                  onClick={() => setNoShowOpen(true)}
                >
                  Зафиксировать неявку
                </Button>
              ) : null}
              {canCreateRevenge ? (
                <Button onClick={() => navigate(`/matches/new?revengeOf=${id}`)}>
                  Создать реванш
                </Button>
              ) : null}
              {canCancel ? (
                <Button
                  variant="secondary"
                  disabled={action.pending}
                  onClick={() => setCancelOpen(true)}
                >
                  Отменить матч
                </Button>
              ) : null}
              {canVoid ? (
                <Button
                  variant="secondary"
                  disabled={action.pending}
                  onClick={() => setVoidOpen(true)}
                >
                  Аннулировать результат
                </Button>
              ) : null}
              {canForceClose ? (
                <Button
                  variant="secondary"
                  disabled={action.pending}
                  onClick={() => setAdminConfirm("force-close")}
                >
                  Принудительно закрыть
                </Button>
              ) : null}
              {canAdminPurge ? (
                <Button
                  variant="secondary"
                  disabled={action.pending}
                  onClick={() => setAdminConfirm("delete")}
                >
                  Удалить из истории
                </Button>
              ) : null}
              {match.tournamentId ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    navigate(`/tournaments/${String(match.tournamentId)}`)
                  }
                >
                  К турниру
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => navigate(-1)}>
                Назад
              </Button>
            </div>
            <Dialog
              open={startOpen}
              onClose={() => (!action.pending ? setStartOpen(false) : undefined)}
              title="Начать матч?"
              width="sm"
              secondaryButtonLabel="Отмена"
              onSecondaryButton={() => {
                if (!action.pending) setStartOpen(false);
              }}
              mainButtonLabel={action.pending ? "Запускаем…" : "Начать матч"}
              onMainButton={() => void onStart()}
            >
              {match.firstServerMethod === "random" ? (
                <p>Первый подающий будет выбран случайно.</p>
              ) : (
                <fieldset className="judge-server-picker">
                  <legend>
                    {match.firstServerMethod === "rally"
                      ? "Победитель розыгрыша за подачу"
                      : "Первый подающий"}
                  </legend>
                  {participants.map((participant) => (
                    <label key={String(participant.id)}>
                      <input
                        type="radio"
                        name="match-start-server"
                        checked={
                          startServerId ===
                          String(participant.id ?? "")
                        }
                        onChange={() =>
                          setStartServerId(
                            String(participant.id ?? ""),
                          )
                        }
                      />
                      {participant.displayName ?? `Сторона ${participant.side}`}
                    </label>
                  ))}
                </fieldset>
              )}
            </Dialog>
            {actionError ? (
              <Alert
                type="error"
                variant="tonal"
                title="Не удалось выполнить действие"
                description={actionError}
              />
            ) : null}
            {stopOpen ? (
              <div className="card stack">
                <p className="muted">
                  Зафиксируйте победителя и причину досрочной остановки.
                </p>
                <FilterBar
                  label="Победитель"
                  value={stopSide}
                  onChange={(v) => setStopSide(v as "A" | "B")}
                  options={[
                    {
                      value: "A",
                      label:
                        participants.find((p) => p.side === "A")?.displayName ??
                        "Сторона A",
                    },
                    {
                      value: "B",
                      label:
                        participants.find((p) => p.side === "B")?.displayName ??
                        "Сторона B",
                    },
                  ]}
                />
                <FilterBar
                  label="Причина"
                  value={stopReason}
                  onChange={setStopReason}
                  options={[
                    { value: "injury", label: "Травма" },
                    { value: "time", label: "Нехватка времени" },
                    { value: "other", label: "Другое" },
                  ]}
                />
                <Button disabled={action.pending} onClick={() => void onStop()}>
                  {action.pending ? "Сохранение…" : "Подтвердить остановку"}
                </Button>
              </div>
            ) : null}
            <Dialog
              open={noShowOpen}
              onClose={() => (!action.pending ? setNoShowOpen(false) : undefined)}
              title="Зафиксировать неявку?"
              width="sm"
              secondaryButtonLabel="Отмена"
              onSecondaryButton={() => setNoShowOpen(false)}
              mainButtonLabel={action.pending ? "…" : "Завершить по неявке"}
              onMainButton={() => void onNoShow()}
            >
              <div className="stack">
                <p>Победителем будет признана противоположная сторона. Текущий счёт сохранится без добавления очков.</p>
                <FilterBar
                  label="Не явилась"
                  value={absentSide}
                  onChange={(value) => setAbsentSide(value as "A" | "B")}
                  options={[
                    { value: "A", label: sideName("A") },
                    { value: "B", label: sideName("B") },
                  ]}
                />
                <TextField
                  label="Комментарий (необязательно)"
                  value={noShowReason}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNoShowReason(event.target.value)}
                />
              </div>
            </Dialog>
            <Dialog
              open={cancelOpen}
              onClose={() => (!action.pending ? setCancelOpen(false) : undefined)}
              title="Отменить матч?"
              width="sm"
              secondaryButtonLabel="Нет"
              onSecondaryButton={() =>
                !action.pending ? setCancelOpen(false) : undefined
              }
              mainButtonLabel={action.pending ? "…" : "Отменить матч"}
              onMainButton={() => void onCancelConfirm()}
            >
              <p>
                Матч «{String(match.title)}» будет аннулирован без победителя и
                без влияния на рейтинг.
                Участники снова смогут играть в других матчах и турнирах.
              </p>
            </Dialog>
            <Dialog
              open={voidOpen}
              onClose={() => (!action.pending ? setVoidOpen(false) : undefined)}
              title="Аннулировать результат?"
              width="sm"
              secondaryButtonLabel="Отмена"
              onSecondaryButton={() =>
                !action.pending ? setVoidOpen(false) : undefined
              }
              mainButtonLabel={
                action.pending ? "…" : "Подтвердить аннулирование"
              }
              onMainButton={() => void onVoidConfirm()}
            >
              <div className="stack">
                <p>
                  Исходный результат матча «{String(match.title)}» сохранится в
                  журнале аудита. Уже учтённые победы, поражения и рейтинг будут
                  компенсированы.
                </p>
                {match.kind === "tournament" ? (
                  <p>
                    Остальная турнирная сетка сохранится без изменений: уже
                    продвинутые участники, следующие матчи и уведомления не
                    будут пересчитаны.
                  </p>
                ) : null}
                <TextField
                  label="Причина (необязательно)"
                  value={voidReason}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setVoidReason(event.target.value)
                  }
                />
              </div>
            </Dialog>
            <Dialog
              open={adminConfirm !== null}
              onClose={() =>
                !action.pending ? setAdminConfirm(null) : undefined
              }
              title={
                adminConfirm === "force-close"
                  ? "Принудительно закрыть матч?"
                  : "Удалить матч из истории?"
              }
              width="sm"
              secondaryButtonLabel="Отмена"
              onSecondaryButton={() =>
                !action.pending ? setAdminConfirm(null) : undefined
              }
              mainButtonLabel={
                action.pending
                  ? "…"
                  : adminConfirm === "force-close"
                    ? "Закрыть"
                    : "Удалить"
              }
              onMainButton={() => void onAdminConfirm()}
            >
              <p>
                {adminConfirm === "force-close"
                  ? `Матч «${String(match.title)}» будет аннулирован (статус «Отменён») без победителя и без влияния на рейтинг. Игроки снова смогут участвовать в других матчах.`
                  : `Незавершённый матч «${String(match.title)}» будет удалён безвозвратно. Завершённые и остановленные результаты удалить нельзя.`}
              </p>
            </Dialog>
          </>
        ) : null}
      </AsyncState>
    </PageLayout>
  );
}
