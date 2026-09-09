import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar, Button, Dialog, TextField } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, FilterBar, StatusChip } from "../patterns";
import { api } from "../api";
import { useAuth } from "../auth";
import {
  elapsedMs,
  formatMatchDuration,
  type ActiveJudge,
} from "../judgeUi";
import { initialsFromName } from "../rankingUi";
import { avatarSrc } from "../avatarSrc";

type AdminConfirm = "force-close" | "delete" | null;

export function MatchDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [match, setMatch] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopOpen, setStopOpen] = useState(false);
  const [stopSide, setStopSide] = useState<"A" | "B">("A");
  const [stopReason, setStopReason] = useState("injury");
  const [stopPending, setStopPending] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidPending, setVoidPending] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [adminConfirm, setAdminConfirm] = useState<AdminConfirm>(null);
  const [adminPending, setAdminPending] = useState(false);
  const [now, setNow] = useState(() => new Date());

  async function load() {
    const res = await api.getMatch(id!);
    setMatch(res.match);
  }

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (match?.status !== "in_progress") return;
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(tick);
  }, [match?.status]);

  const participants =
    (match?.participants as Array<{
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

  async function onStop() {
    setStopPending(true);
    setError(null);
    try {
      const res = await api.stopMatch(id!, {
        winnerSide: stopSide,
        reasonCode: stopReason,
      });
      setMatch(res.match);
      setStopOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStopPending(false);
    }
  }

  async function onCancelConfirm() {
    if (!id) return;
    setCancelPending(true);
    setError(null);
    try {
      const res = await api.cancelMatch(
        id,
        Number(match?.version),
        crypto.randomUUID(),
      );
      setMatch(res.match);
      setCancelOpen(false);
    } catch (e) {
      setError((e as Error).message);
      setCancelOpen(false);
    } finally {
      setCancelPending(false);
    }
  }

  async function onVoidConfirm() {
    if (!id) return;
    setVoidPending(true);
    setError(null);
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
      setError((e as Error).message);
      setVoidOpen(false);
    } finally {
      setVoidPending(false);
    }
  }

  async function onAdminConfirm() {
    if (!adminConfirm || !id) return;
    setAdminPending(true);
    setError(null);
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
      setError((e as Error).message);
      setAdminConfirm(null);
    } finally {
      setAdminPending(false);
    }
  }

  return (
    <PageLayout title={match ? String(match.title) : "Матч"}>
      <AsyncState loading={!match && !error} error={error}>
        {match ? (
          <>
            <div className="card stack">
              <div className="row">
                <StatusChip status={String(match.status)} />
              </div>
              <p className="score-display">
                {String(match.scoreA)} : {String(match.scoreB)}
              </p>
              {durationLabel ? (
                <p className="muted">Длительность: {durationLabel}</p>
              ) : null}
              {activeJudge ? (
                <p className="muted">Судит: {activeJudge.displayName}</p>
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
            </div>
            <div className="stack stack--actions">
              {canStart && (
                <Button
                  onClick={() =>
                    api
                      .startMatch(id!)
                      .then((r) => setMatch(r.match))
                      .catch((e) => setError(e.message))
                  }
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
                <Button variant="secondary" onClick={() => setStopOpen((v) => !v)}>
                  {stopOpen ? "Скрыть остановку" : "Остановить матч"}
                </Button>
              )}
              {canCancel ? (
                <Button
                  variant="secondary"
                  onClick={() => setCancelOpen(true)}
                >
                  Отменить матч
                </Button>
              ) : null}
              {canVoid ? (
                <Button
                  variant="secondary"
                  onClick={() => setVoidOpen(true)}
                >
                  Аннулировать результат
                </Button>
              ) : null}
              {canForceClose ? (
                <Button
                  variant="secondary"
                  onClick={() => setAdminConfirm("force-close")}
                >
                  Принудительно закрыть
                </Button>
              ) : null}
              {canAdminPurge ? (
                <Button
                  variant="secondary"
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
                <Button disabled={stopPending} onClick={() => void onStop()}>
                  {stopPending ? "Сохранение…" : "Подтвердить остановку"}
                </Button>
              </div>
            ) : null}
            <Dialog
              open={cancelOpen}
              onClose={() => (!cancelPending ? setCancelOpen(false) : undefined)}
              title="Отменить матч?"
              width="sm"
              secondaryButtonLabel="Нет"
              onSecondaryButton={() =>
                !cancelPending ? setCancelOpen(false) : undefined
              }
              mainButtonLabel={cancelPending ? "…" : "Отменить матч"}
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
              onClose={() => (!voidPending ? setVoidOpen(false) : undefined)}
              title="Аннулировать результат?"
              width="sm"
              secondaryButtonLabel="Отмена"
              onSecondaryButton={() =>
                !voidPending ? setVoidOpen(false) : undefined
              }
              mainButtonLabel={
                voidPending ? "…" : "Подтвердить аннулирование"
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
                    продвинутые участники, следующие матчи и уведомления не будут
                    пересчитаны.
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
                !adminPending ? setAdminConfirm(null) : undefined
              }
              title={
                adminConfirm === "force-close"
                  ? "Принудительно закрыть матч?"
                  : "Удалить матч из истории?"
              }
              width="sm"
              secondaryButtonLabel="Отмена"
              onSecondaryButton={() =>
                !adminPending ? setAdminConfirm(null) : undefined
              }
              mainButtonLabel={
                adminPending
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
