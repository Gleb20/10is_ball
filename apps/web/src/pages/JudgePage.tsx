import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "../ui";
import { api } from "../api";
import {
  boardSides,
  elapsedMs,
  formatMatchDuration,
  judgeAcquireErrorMessage,
  needsJudgeSetup,
  participantDisplayName,
  servingSide,
  shouldShowLandscapeHint,
  sideDisplayName,
  type JudgeMatchLike,
  type JudgeParticipant,
} from "../judgeUi";
import { statusLabel } from "../statusLabels";

type MatchState = Record<string, unknown> & JudgeMatchLike;
type Phase =
  | "loading"
  | "blocked"
  | "setup"
  | "scoring"
  | "readonly";

export function JudgePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const readonlyMode = searchParams.get("mode") === "readonly";

  const [match, setMatch] = useState<MatchState | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [flashSide, setFlashSide] = useState<"A" | "B" | null>(null);
  const [undoPending, setUndoPending] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 800,
    h: typeof window !== "undefined" ? window.innerHeight : 600,
  }));

  const [firstServerId, setFirstServerId] = useState("");
  const [swapSides, setSwapSides] = useState(false);
  const [setupPending, setSetupPending] = useState(false);

  const load = useCallback(async () => {
    const res = await api.getMatch(id!);
    setMatch(res.match as MatchState);
    return res.match as MatchState;
  }, [id]);

  const initJudge = useCallback(async () => {
    if (!id) return;
    setPhase("loading");
    setError(null);
    try {
      const detail = await load();
      if (readonlyMode) {
        setPhase("readonly");
        return;
      }
      await api.acquireJudge(id);
      const refreshed = await load();
      if (needsJudgeSetup(refreshed)) {
        const participants = (refreshed.participants ?? []) as JudgeParticipant[];
        setFirstServerId(
          String(
            refreshed.currentServerParticipantId ??
              participants[0]?.id ??
              "",
          ),
        );
        setPhase("setup");
      } else {
        setPhase("scoring");
      }
    } catch (e) {
      const err = e as Error & {
        code?: string;
        details?: { currentJudge?: { userId?: string; displayName: string } };
      };
      setError(judgeAcquireErrorMessage(err));
      setPhase("blocked");
    }
  }, [id, load, readonlyMode]);

  useEffect(() => {
    void initJudge();
  }, [initJudge]);

  useEffect(() => {
    const onResize = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  useEffect(() => {
    if (phase !== "scoring" && phase !== "readonly") return;
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(tick);
  }, [phase]);

  useEffect(() => {
    if (!id || (phase !== "scoring" && phase !== "readonly")) return;
    const poll = window.setInterval(() => {
      void load().catch(() => undefined);
    }, phase === "readonly" ? 30_000 : 60_000);
    return () => window.clearInterval(poll);
  }, [id, load, phase]);

  useEffect(() => {
    if (phase !== "scoring" || !id) return;
    const tick = window.setInterval(() => {
      void api.heartbeatJudge(id).catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(tick);
  }, [phase, id]);

  async function confirmSetup() {
    if (!id || !firstServerId) return;
    setSetupPending(true);
    setError(null);
    try {
      if (match?.status === "waiting") {
        await api.startMatch(id, { firstServerParticipantId: firstServerId });
      }
      const res = await api.judgeSetup(id, {
        firstServerParticipantId: firstServerId,
        swapSides,
      });
      setMatch(res.match as MatchState);
      setPhase("scoring");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSetupPending(false);
    }
  }

  async function point(side: "A" | "B") {
    if (!match || phase !== "scoring") return;
    try {
      const res = await api.awardPoint(
        id!,
        side,
        Number(match.version),
        crypto.randomUUID(),
      );
      setMatch(res.match as MatchState);
      setError(null);
      setFlashSide(side);
      window.setTimeout(() => setFlashSide(null), 350);
    } catch (e) {
      setError((e as Error).message);
      await load();
    }
  }

  async function undo() {
    if (!match || undoPending) return;
    setUndoPending(true);
    try {
      const res = await api.undoPoint(
        id!,
        Number(match.version),
        crypto.randomUUID(),
      );
      setMatch(res.match as MatchState);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setUndoPending(false);
    }
  }

  async function releaseAndExit() {
    try {
      await api.releaseJudge(id!);
      navigate(id ? `/matches/${id}` : "/history");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onConfirmFinish() {
    try {
      await api.confirmFinish(id!);
      navigate(`/matches/${id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleDisplayFlip() {
    if (!id || !match) return;
    const next = !match.judgeDisplayFlipped;
    try {
      const res = await api.judgeSetup(id, { displayFlipped: next });
      setMatch(res.match as MatchState);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (phase === "loading") {
    return (
      <div className="judge-screen judge-screen--loading">
        <p className="judge-screen__status">Подключение судьи…</p>
      </div>
    );
  }

  if (phase === "blocked") {
    return (
      <div className="judge-screen judge-screen--error" data-testid="judge-blocked">
        <p className="judge-screen__status" role="alert">
          {error}
        </p>
        <div className="judge-blocked-actions">
          <Button onClick={() => void initJudge()}>Повторить</Button>
          <Button
            variant="secondary"
            onClick={() => navigate(`/matches/${id}/judge?mode=readonly`)}
          >
            Смотреть счёт
          </Button>
          <Button variant="secondary" onClick={() => navigate(`/matches/${id}`)}>
            Назад к матчу
          </Button>
        </div>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="judge-screen judge-screen--error">
        <p className="judge-screen__status" role="alert">
          Матч не найден
        </p>
        <Button variant="secondary" onClick={() => navigate(-1)}>
          Назад
        </Button>
      </div>
    );
  }

  if (phase === "setup") {
    const participants = (match.participants ?? []) as JudgeParticipant[];
    const previewMatch: JudgeMatchLike = {
      ...match,
      participants: swapSides
        ? participants.map((p) => ({
            ...p,
            side: p.side === "A" ? "B" : "A",
          }))
        : participants,
    };
    const { left, right } = boardSides(previewMatch);

    return (
      <div className="judge-screen" data-testid="judge-setup">
        <h2 className="judge-setup__title">Настройка перед игрой</h2>
        <p className="judge-screen__hint">
          Выберите первую подачу. Нажмите ↔, чтобы поменять стороны стола.
        </p>

        <fieldset className="judge-setup__field">
          <legend className="judge-setup__legend">Первый подаёт</legend>
          {participants.map((p) => (
            <label key={p.id} className="judge-setup__radio">
              <input
                type="radio"
                name="firstServer"
                value={p.id}
                checked={firstServerId === p.id}
                onChange={() => setFirstServerId(p.id)}
              />
              {participantDisplayName(p)}
            </label>
          ))}
        </fieldset>

        <div className="judge-setup__sides" aria-label="Стороны стола">
          <div className="judge-setup__half">
            <span className="judge-setup__half-label">Слева</span>
            <strong>{sideDisplayName(previewMatch, left)}</strong>
          </div>
          <button
            type="button"
            className="judge-setup__swap-btn"
            aria-label="Поменять стороны"
            onClick={() => setSwapSides((v) => !v)}
          >
            ↔
          </button>
          <div className="judge-setup__half">
            <span className="judge-setup__half-label">Справа</span>
            <strong>{sideDisplayName(previewMatch, right)}</strong>
          </div>
        </div>

        {error ? (
          <p className="error judge-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="judge-setup__actions">
          <Button
            disabled={setupPending || !firstServerId}
            onClick={() => void confirmSetup()}
          >
            {setupPending ? "Сохранение…" : "Начать судейство"}
          </Button>
          <Button variant="secondary" onClick={() => navigate(`/matches/${id}`)}>
            Отмена
          </Button>
        </div>
      </div>
    );
  }

  const locked =
    match.status === "pending_confirmation" || match.status === "finished";
  const readonly = phase === "readonly";
  const serve = servingSide(match);
  const showHint = shouldShowLandscapeHint(viewport.w, viewport.h);
  const { left, right } = boardSides(match);
  const duration = formatMatchDuration(
    elapsedMs(
      match.startedAt as string | undefined,
      now,
      match.finishedAt as string | undefined,
      String(match.status),
    ),
  );

  function renderSide(side: "A" | "B", matchState: MatchState) {
    const label = sideDisplayName(matchState, side);
    const score = side === "A" ? String(matchState.scoreA) : String(matchState.scoreB);
    const serving = serve === side;
    const flash = flashSide === side;

    return (
      <div
        key={side}
        className={[
          "judge-side",
          serving ? "judge-side--serving" : "",
          flash ? "judge-side--flash" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid={`judge-side-${side}`}
      >
        <span className="judge-side__name">{label}</span>
        <span className="judge-side__score">{score}</span>
        {serving ? (
          <span className="judge-serve-badge" aria-live="polite">
            Подача
          </span>
        ) : (
          <span className="judge-serve-badge judge-serve-badge--empty" />
        )}
        {!readonly ? (
          <Button
            className="judge-point-btn judge-touch"
            onClick={() => void point(side)}
            disabled={locked}
            aria-label={`+1 очко: ${label}`}
          >
            +1
          </Button>
        ) : (
          <span className="judge-point-spacer" aria-hidden />
        )}
      </div>
    );
  }

  return (
    <div className="judge-screen" data-testid="judge-screen">
      {showHint ? (
        <p className="judge-rotate-hint" role="status">
          Поверните устройство горизонтально для удобного судейства
        </p>
      ) : null}

      <header className="judge-toolbar">
        <div className="judge-toolbar__meta">
          <span className="judge-status">
            {statusLabel(String(match.status), "match")}
          </span>
          {match.startedAt ? (
            <span className="judge-timer" aria-live="off">
              {duration}
            </span>
          ) : null}
          {match.deuceMode ? (
            <span className="judge-deuce">Deuce</span>
          ) : null}
          {readonly ? (
            <span className="judge-readonly-badge">Только просмотр</span>
          ) : null}
        </div>
        <div className="judge-toolbar__actions">
          {!readonly ? (
            <>
              <Button
                variant="secondary"
                className="judge-touch"
                onClick={() => void undo()}
                disabled={locked || undoPending}
                aria-label="Отменить последнее очко"
              >
                Undo
              </Button>
              <Button
                variant="secondary"
                className="judge-touch"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-controls="judge-more-menu"
              >
                Ещё
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              className="judge-touch"
              onClick={() => navigate(`/matches/${id}`)}
            >
              К матчу
            </Button>
          )}
        </div>
      </header>

      {menuOpen && !readonly ? (
        <div
          id="judge-more-menu"
          className="judge-more"
          role="menu"
          aria-label="Действия судьи"
        >
          <Button
            variant="secondary"
            className="judge-touch"
            onClick={() => void toggleDisplayFlip()}
            disabled={locked}
          >
            {match.judgeDisplayFlipped
              ? "Вернуть порядок на экране"
              : "Поменять местами на экране"}
          </Button>
          {match.status === "pending_confirmation" ? (
            <>
              <Button
                className="judge-touch"
                onClick={() => {
                  setMenuOpen(false);
                  void onConfirmFinish();
                }}
              >
                Подтвердить результат
              </Button>
              <Button
                variant="secondary"
                className="judge-touch"
                onClick={() =>
                  void api
                    .revertFinish(id!)
                    .then((r) => {
                      setMatch(r.match as MatchState);
                      setMenuOpen(false);
                    })
                    .catch((e) => setError(e.message))
                }
              >
                Продолжить игру
              </Button>
            </>
          ) : null}
          <Button
            variant="secondary"
            className="judge-touch"
            onClick={() => void releaseAndExit()}
          >
            Освободить слот и выйти
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="error judge-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="judge-board" role="group" aria-label="Счёт матча">
        {renderSide(left, match)}
        {renderSide(right, match)}
      </div>

      {match.status === "pending_confirmation" && !menuOpen && !readonly ? (
        <div className="judge-confirm-bar">
          <Button className="judge-touch" onClick={() => void onConfirmFinish()}>
            Подтвердить результат
          </Button>
          <Button
            variant="secondary"
            className="judge-touch"
            onClick={() =>
              void api
                .revertFinish(id!)
                .then((r) => setMatch(r.match as MatchState))
                .catch((e) => setError(e.message))
            }
          >
            Продолжить
          </Button>
        </div>
      ) : null}
    </div>
  );
}
