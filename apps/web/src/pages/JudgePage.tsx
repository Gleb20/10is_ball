import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../ui";
import { api } from "../api";
import {
  servingSide,
  shouldShowLandscapeHint,
  sideDisplayName,
  type JudgeMatchLike,
} from "../judgeUi";
import { statusLabel } from "../statusLabels";

type MatchState = Record<string, unknown> & JudgeMatchLike;

export function JudgePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [match, setMatch] = useState<MatchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 800,
    h: typeof window !== "undefined" ? window.innerHeight : 600,
  }));

  async function load() {
    const res = await api.getMatch(id!);
    setMatch(res.match as MatchState);
  }

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
    void (async () => {
      try {
        const detail = await api.getMatch(id!);
        setMatch(detail.match as MatchState);
        if (detail.match.status === "waiting") {
          await api.startMatch(id!);
        }
        await api.acquireJudge(id!);
        setReady(true);
        await load();
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id]);

  useEffect(() => {
    if (!ready || !id) return;
    const tick = window.setInterval(() => {
      void api.heartbeatJudge(id).catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(tick);
  }, [ready, id]);

  async function point(side: "A" | "B") {
    if (!match) return;
    try {
      const res = await api.awardPoint(
        id!,
        side,
        Number(match.version),
        crypto.randomUUID(),
      );
      setMatch(res.match as MatchState);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      await load();
    }
  }

  async function undo() {
    if (!match) return;
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
    }
  }

  async function releaseAndExit() {
    try {
      await api.releaseJudge(id!);
    } catch {
      /* still leave UI */
    }
    navigate(id ? `/matches/${id}` : "/history");
  }

  if (error && !match) {
    return (
      <div className="judge-screen judge-screen--error">
        <p className="error" role="alert">
          {error}
        </p>
        <Button variant="secondary" onClick={() => navigate(-1)}>
          Назад
        </Button>
      </div>
    );
  }

  if (!match || !ready) {
    return (
      <div className="judge-screen judge-screen--loading">
        <p className="muted">Подключение судьи…</p>
      </div>
    );
  }

  const locked =
    match.status === "pending_confirmation" || match.status === "finished";
  const serve = servingSide(match);
  const showHint = shouldShowLandscapeHint(viewport.w, viewport.h);
  const labelA = sideDisplayName(match, "A");
  const labelB = sideDisplayName(match, "B");

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
          {match.deuceMode ? (
            <span className="judge-deuce">Deuce</span>
          ) : null}
        </div>
        <div className="judge-toolbar__actions">
          <Button
            variant="secondary"
            className="judge-touch"
            onClick={() => void undo()}
            disabled={locked}
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
        </div>
      </header>

      {menuOpen ? (
        <div
          id="judge-more-menu"
          className="judge-more"
          role="menu"
          aria-label="Действия судьи"
        >
          {match.status === "pending_confirmation" ? (
            <>
              <Button
                className="judge-touch"
                onClick={() =>
                  void api
                    .confirmFinish(id!)
                    .then((r) => {
                      setMatch(r.match as MatchState);
                      setMenuOpen(false);
                    })
                    .catch((e) => setError(e.message))
                }
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
        <button
          type="button"
          className={
            serve === "A" ? "judge-side judge-side--serving" : "judge-side"
          }
          onClick={() => void point("A")}
          disabled={locked}
          aria-label={`Очко стороне A: ${labelA}`}
        >
          <span className="judge-side__name">{labelA}</span>
          <span className="judge-side__score">{String(match.scoreA)}</span>
          {serve === "A" ? (
            <span className="judge-serve-badge" aria-live="polite">
              Подача
            </span>
          ) : (
            <span className="judge-serve-badge judge-serve-badge--empty" />
          )}
        </button>
        <button
          type="button"
          className={
            serve === "B" ? "judge-side judge-side--serving" : "judge-side"
          }
          onClick={() => void point("B")}
          disabled={locked}
          aria-label={`Очко стороне B: ${labelB}`}
        >
          <span className="judge-side__name">{labelB}</span>
          <span className="judge-side__score">{String(match.scoreB)}</span>
          {serve === "B" ? (
            <span className="judge-serve-badge" aria-live="polite">
              Подача
            </span>
          ) : (
            <span className="judge-serve-badge judge-serve-badge--empty" />
          )}
        </button>
      </div>

      {match.status === "pending_confirmation" && !menuOpen ? (
        <div className="judge-confirm-bar">
          <Button
            className="judge-touch"
            onClick={() =>
              void api
                .confirmFinish(id!)
                .then((r) => setMatch(r.match as MatchState))
                .catch((e) => setError(e.message))
            }
          >
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
