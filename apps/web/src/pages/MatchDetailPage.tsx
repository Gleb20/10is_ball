import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar, Button, Dialog } from "../ui";
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
      displayName?: string;
      avatarKey?: string | null;
    }>) ?? [];

  const activeJudge = match?.activeJudge as ActiveJudge | null | undefined;
  const judgeTakenByOther =
    activeJudge != null && activeJudge.userId !== user?.id;

  const isAdminStandalone =
    user?.role === "admin" && match?.kind === "standalone";
  const canForceClose =
    isAdminStandalone &&
    (match?.status === "waiting" ||
      match?.status === "in_progress" ||
      match?.status === "pending_confirmation");

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

  async function onAdminConfirm() {
    if (!adminConfirm || !id) return;
    setAdminPending(true);
    setError(null);
    try {
      if (adminConfirm === "force-close") {
        const res = await api.adminForceCloseMatch(id);
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
              {match.status === "waiting" && (
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
              {(match.status === "in_progress" ||
                match.status === "pending_confirmation") && (
                <Button variant="secondary" onClick={() => setStopOpen((v) => !v)}>
                  {stopOpen ? "Скрыть остановку" : "Остановить матч"}
                </Button>
              )}
              {canForceClose ? (
                <Button
                  variant="secondary"
                  onClick={() => setAdminConfirm("force-close")}
                >
                  Принудительно закрыть
                </Button>
              ) : null}
              {isAdminStandalone ? (
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
                  ? "Матч будет аннулирован (статус «Отменён») без победителя и без влияния на рейтинг. Игроки снова смогут участвовать в других матчах."
                  : "Матч будет удалён безвозвратно. Если результат уже учтён в рейтинге, победы и поражения будут откачены."}
              </p>
            </Dialog>
          </>
        ) : null}
      </AsyncState>
    </PageLayout>
  );
}
