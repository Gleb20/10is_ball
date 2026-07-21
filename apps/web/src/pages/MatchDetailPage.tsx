import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, FilterBar, StatusChip } from "../patterns";
import { api } from "../api";
import { useAuth } from "../auth";
import {
  elapsedMs,
  formatMatchDuration,
  type ActiveJudge,
} from "../judgeUi";

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
    (match?.participants as Array<{ side: string; displayName?: string }>) ??
    [];

  const activeJudge = match?.activeJudge as ActiveJudge | null | undefined;
  const judgeTakenByOther =
    activeJudge != null && activeJudge.userId !== user?.id;

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
                <div className="muted">
                  {participants.map((p) => (
                    <div key={`${p.side}-${p.displayName}`}>
                      {p.side}: {p.displayName ?? "—"}
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
          </>
        ) : null}
      </AsyncState>
    </PageLayout>
  );
}
