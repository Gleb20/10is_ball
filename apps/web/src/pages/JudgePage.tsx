import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, Avatar } from "../ui";
import { api } from "../api";
import { TableTennisRacketIcon } from "../icons/TableTennisRacketIcon";
import {
  boardSides,
  elapsedMs,
  formatMatchDuration,
  judgeAcquireErrorMessage,
  needsJudgeSetup,
  servingSide,
  shouldShowLandscapeHint,
  sideAvatarKey,
  sideDisplayName,
  type JudgeMatchLike,
  type JudgeParticipant,
} from "../judgeUi";
import { statusLabel } from "../statusLabels";
import { initialsFromName } from "../rankingUi";
import { avatarSrc } from "../avatarSrc";
import type { JudgeExitNotice } from "../layout";

type MatchState = Record<string, unknown> & JudgeMatchLike;
type Phase =
  | "loading"
  | "blocked"
  | "setup"
  | "scoring"
  | "lost_lock"
  | "readonly";
type PointIntent = {
  side: "A" | "B";
  idempotencyKey: string;
};

type ApiError = Error & { code?: string; status?: number };

const LOST_JUDGE_CODES = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "PASSWORD_CHANGE_REQUIRED",
  "JUDGE_NOT_ACTIVE",
  "JUDGE_REQUIRED",
  "JUDGE_TAKEN",
]);

function isLostJudgeError(
  error: unknown,
  heartbeatStatusFallback = false,
): error is ApiError {
  const candidate = error as ApiError;
  return (
    candidate.status === 401 ||
    candidate.status === 403 ||
    (heartbeatStatusFallback && candidate.status === 409) ||
    Boolean(candidate.code && LOST_JUDGE_CODES.has(candidate.code))
  );
}

function lostJudgeMessage(error: ApiError): string {
  if (error.status === 401 || error.code === "UNAUTHORIZED") {
    return "Слот судьи потерян: сессия входа завершена. Счёт обновлён с сервера; начисление очков заблокировано.";
  }
  if (
    error.status === 403 ||
    error.code === "FORBIDDEN" ||
    error.code === "PASSWORD_CHANGE_REQUIRED"
  ) {
    return "Слот судьи потерян: доступ к судейству больше не подтверждён. Счёт обновлён с сервера; действия заблокированы.";
  }
  return "Слот судьи потерян или истёк. Счёт обновлён с сервера; действия заблокированы.";
}

function isTerminalMatchStatus(status: unknown): boolean {
  return ["finished", "stopped", "cancelled", "voided"].includes(
    String(status ?? ""),
  );
}

function ServeBadge({ active }: { active: boolean }) {
  if (!active) {
    return <span className="judge-serve-badge judge-serve-badge--empty" />;
  }
  return (
    <span className="judge-serve-badge" aria-live="polite">
      <TableTennisRacketIcon size={16} />
      Подача
    </span>
  );
}

export function JudgePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const readonlyMode = searchParams.get("mode") === "readonly";

  const [match, setMatch] = useState<MatchState | null>(null);
  const matchRef = useRef<MatchState | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [flashSide, setFlashSide] = useState<"A" | "B" | null>(null);
  const [undoPending, setUndoPending] = useState(false);
  const [pointPendingCount, setPointPendingCount] = useState(0);
  const pointQueueRef = useRef<PointIntent[]>([]);
  const pointQueueRunningRef = useRef(false);
  const judgeLockOwnedRef = useRef(false);
  const liveSyncRunningRef = useRef(false);
  const exitPendingRef = useRef(false);
  const flashTimeoutRef = useRef<number | null>(null);
  const [exitPending, setExitPending] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  const [now, setNow] = useState(() => new Date());
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 800,
    h: typeof window !== "undefined" ? window.innerHeight : 600,
  }));

  const [firstServerId, setFirstServerId] = useState("");
  const [swapSides, setSwapSides] = useState(false);
  const [setupPending, setSetupPending] = useState(false);

  const updateMatch = useCallback((nextMatch: MatchState) => {
    matchRef.current = nextMatch;
    setMatch(nextMatch);
  }, []);

  const load = useCallback(async () => {
    const res = await api.getMatch(id!);
    updateMatch(res.match as MatchState);
    return res.match as MatchState;
  }, [id, updateMatch]);

  const exitAfterJudge = useCallback(
    (m: MatchState | null, notice?: JudgeExitNotice) => {
      if (m?.kind === "tutorial") {
        navigate("/onboarding");
        return;
      }
      const tournamentId = m?.tournamentId ? String(m.tournamentId) : null;
      const options = notice ? { state: { judgeExitNotice: notice } } : undefined;
      if (tournamentId) {
        navigate(`/tournaments/${tournamentId}`, options);
        return;
      }
      navigate(id ? `/matches/${id}` : "/history", options);
    },
    [id, navigate],
  );

  const loseJudgeLock = useCallback(
    async (error: ApiError) => {
      judgeLockOwnedRef.current = false;
      pointQueueRef.current = [];
      setPointPendingCount(0);
      setUndoPending(false);
      setMenuOpen(false);
      setPhase("lost_lock");
      setError(lostJudgeMessage(error));
      try {
        const fresh = await load();
        if (isTerminalMatchStatus(fresh.status)) {
          setPhase("readonly");
          setError(null);
        }
      } catch {
        // Preserve the last authoritative screen when read access is also gone.
      }
    },
    [load],
  );

  const syncLiveState = useCallback(
    async (ownsLock: boolean) => {
      if (!id || liveSyncRunningRef.current) return;
      liveSyncRunningRef.current = true;
      try {
        if (ownsLock) await api.heartbeatJudge(id);
        const fresh = await load();
        if (isTerminalMatchStatus(fresh.status)) {
          judgeLockOwnedRef.current = false;
          pointQueueRef.current = [];
          setPointPendingCount(0);
          setMenuOpen(false);
          setPhase("readonly");
          setError(null);
        }
      } catch (error) {
        if (ownsLock && isLostJudgeError(error, true)) {
          await loseJudgeLock(error);
        } else {
          setError(
            `Не удалось обновить состояние матча: ${(error as Error).message}`,
          );
        }
      } finally {
        liveSyncRunningRef.current = false;
      }
    },
    [id, load, loseJudgeLock],
  );

  const initJudge = useCallback(async () => {
    if (!id) return;
    setPhase("loading");
    setError(null);
    try {
      const detail = await load();
      if (
        readonlyMode ||
        isTerminalMatchStatus(detail.status)
      ) {
        judgeLockOwnedRef.current = false;
        setPhase("readonly");
        return;
      }
      await api.acquireJudge(id);
      judgeLockOwnedRef.current = true;
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
        setSwapSides(false);
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
    const onVisibilityChange = () =>
      setDocumentVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

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

  useEffect(
    () => () => {
      if (flashTimeoutRef.current !== null) {
        window.clearTimeout(flashTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (phase !== "scoring" && phase !== "readonly") return;
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(tick);
  }, [phase]);

  useEffect(() => {
    const ownsLock = phase === "setup" || phase === "scoring";
    const watchesMatch = ownsLock || phase === "readonly";
    if (!id || !documentVisible || !watchesMatch) return;

    void syncLiveState(ownsLock);
    const liveTimer = window.setInterval(
      () => syncLiveState(ownsLock),
      30_000,
    );
    return () => window.clearInterval(liveTimer);
  }, [documentVisible, id, phase, syncLiveState]);

  function previewMatchFrom(base: MatchState): JudgeMatchLike {
    const participants = (base.participants ?? []) as JudgeParticipant[];
    return {
      ...base,
      scoreA: 0,
      scoreB: 0,
      participants: swapSides
        ? participants.map((p) => ({
            ...p,
            side: p.side === "A" ? "B" : "A",
          }))
        : participants,
      currentServerParticipantId: firstServerId || null,
    };
  }

  function pickServerForSide(side: "A" | "B", preview: JudgeMatchLike) {
    const p = (preview.participants ?? []).find((x) => x.side === side);
    if (p) setFirstServerId(p.id);
  }

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
      updateMatch(res.match as MatchState);
      setPhase("scoring");
    } catch (e) {
      if (isLostJudgeError(e)) {
        await loseJudgeLock(e);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setSetupPending(false);
    }
  }

  async function drainPointQueue(initialMatch: MatchState) {
    if (!id || pointQueueRunningRef.current) return;
    pointQueueRunningRef.current = true;
    let authoritativeMatch = initialMatch;

    try {
      while (pointQueueRef.current.length > 0) {
        const intent = pointQueueRef.current[0]!;
        if (authoritativeMatch.status !== "in_progress") {
          pointQueueRef.current = [];
          setPointPendingCount(0);
          setError(
            "Матч больше не принимает очки. Проверьте итоговый счёт перед продолжением.",
          );
          break;
        }

        try {
          const res = await api.awardPoint(
            id,
            intent.side,
            Number(authoritativeMatch.version),
            intent.idempotencyKey,
          );
          if (!judgeLockOwnedRef.current) {
            pointQueueRef.current = [];
            setPointPendingCount(0);
            try {
              await load();
            } catch {
              // The lost-lock alert remains authoritative for the user.
            }
            break;
          }
          authoritativeMatch = res.match as MatchState;
          pointQueueRef.current.shift();
          setPointPendingCount(pointQueueRef.current.length);
          updateMatch(authoritativeMatch);
          setError(null);
          setFlashSide(intent.side);
          if (flashTimeoutRef.current !== null) {
            window.clearTimeout(flashTimeoutRef.current);
          }
          flashTimeoutRef.current = window.setTimeout(() => {
            setFlashSide(null);
            flashTimeoutRef.current = null;
          }, 350);
        } catch (e) {
          const err = e as Error & { code?: string };
          pointQueueRef.current = [];
          setPointPendingCount(0);
          if (isLostJudgeError(e)) {
            await loseJudgeLock(e);
            break;
          }
          try {
            authoritativeMatch = await load();
          } catch {
            // Preserve the mutation error; the existing screen remains usable.
          }
          setError(
            err.code === "VERSION_CONFLICT" ||
              err.code === "MATCH_VERSION_CONFLICT"
              ? "Счёт изменился на другом устройстве. Очередь остановлена: проверьте счёт и повторите неначисленное очко."
              : `Очко не подтверждено: ${err.message}. Очередь остановлена: проверьте счёт и повторите.`,
          );
          break;
        }
      }
    } finally {
      pointQueueRunningRef.current = false;
    }
  }

  function point(side: "A" | "B") {
    if (
      !id ||
      !match ||
      phase !== "scoring" ||
      !judgeLockOwnedRef.current
    ) {
      return;
    }
    pointQueueRef.current.push({
      side,
      idempotencyKey: crypto.randomUUID(),
    });
    setMenuOpen(false);
    setPointPendingCount(pointQueueRef.current.length);
    void drainPointQueue(matchRef.current ?? match);
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
      updateMatch(res.match as MatchState);
      setError(null);
    } catch (e) {
      if (isLostJudgeError(e)) {
        await loseJudgeLock(e);
      } else {
        setError((e as Error).message);
        await load();
      }
    } finally {
      setUndoPending(false);
    }
  }

  async function releaseAndExit() {
    if (
      !id ||
      exitPendingRef.current ||
      pointQueueRunningRef.current ||
      pointQueueRef.current.length > 0
    ) {
      return;
    }
    exitPendingRef.current = true;
    setExitPending(true);
    let notice: JudgeExitNotice;
    try {
      if (judgeLockOwnedRef.current) {
        await api.releaseJudge(id);
        judgeLockOwnedRef.current = false;
        notice = {
          kind: "success",
          message: "Слот судьи освобождён. Другой пользователь может занять его сразу.",
        };
      } else {
        notice = {
          kind: "warning",
          message: "Слот судьи уже не был активен. Проверьте актуального судью в карточке матча.",
        };
      }
    } catch (e) {
      judgeLockOwnedRef.current = false;
      notice = {
        kind: "warning",
        message: `Не удалось подтвердить освобождение слота: ${(e as Error).message}. Он освободится по TTL, если запрос не дошёл.`,
      };
    }
    exitPendingRef.current = false;
    setExitPending(false);
    exitAfterJudge(matchRef.current ?? match, notice);
  }

  async function onConfirmFinish() {
    try {
      const res = await api.confirmFinish(id!);
      const finished = (res.match ?? match) as MatchState;
      judgeLockOwnedRef.current = false;
      updateMatch(finished);
      exitAfterJudge(finished);
    } catch (e) {
      if (isLostJudgeError(e)) {
        await loseJudgeLock(e);
      } else {
        setError((e as Error).message);
      }
    }
  }

  async function toggleDisplayFlip() {
    if (!id || !match) return;
    const next = !match.judgeDisplayFlipped;
    try {
      const res = await api.judgeSetup(id, { displayFlipped: next });
      updateMatch(res.match as MatchState);
    } catch (e) {
      if (isLostJudgeError(e)) {
        await loseJudgeLock(e);
      } else {
        setError((e as Error).message);
      }
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
    const tournamentId = match?.tournamentId
      ? String(match.tournamentId)
      : null;
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
          <Button
            variant="secondary"
            onClick={() =>
              judgeLockOwnedRef.current
                ? void releaseAndExit()
                : navigate(`/matches/${id}`)
            }
            disabled={exitPending}
          >
            Назад к матчу
          </Button>
          {tournamentId ? (
            <Button
              variant="secondary"
              onClick={() => navigate(`/tournaments/${tournamentId}`)}
            >
              К турниру
            </Button>
          ) : null}
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

  const isSetup = phase === "setup";
  const lostLock = phase === "lost_lock";
  const locked =
    lostLock ||
    match.status === "pending_confirmation" ||
    match.status === "finished";
  const readonly = phase === "readonly";
  const boardMatch = isSetup ? previewMatchFrom(match) : match;
  const serve = isSetup
    ? (() => {
        const p = (boardMatch.participants ?? []).find(
          (x) => x.id === firstServerId,
        );
        return p?.side === "A" || p?.side === "B" ? p.side : null;
      })()
    : servingSide(match);
  const showHint = shouldShowLandscapeHint(viewport.w, viewport.h);
  const { left, right } = boardSides(boardMatch);
  const duration = formatMatchDuration(
    elapsedMs(
      match.startedAt as string | undefined,
      now,
      match.finishedAt as string | undefined,
      String(match.status),
    ),
  );

  function renderSide(side: "A" | "B", matchState: MatchState) {
    const label = sideDisplayName(boardMatch, side);
    const score = isSetup
      ? "0"
      : side === "A"
        ? String(matchState.scoreA)
        : String(matchState.scoreB);
    const serving = serve === side;
    const flash = !isSetup && flashSide === side;

    return (
      <div
        key={side}
        className={[
          "judge-side",
          serving ? "judge-side--serving" : "",
          flash ? "judge-side--flash" : "",
          isSetup ? "judge-side--setup" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid={`judge-side-${side}`}
        role={isSetup ? "button" : undefined}
        tabIndex={isSetup ? 0 : undefined}
        onClick={
          isSetup
            ? () => pickServerForSide(side, boardMatch)
            : undefined
        }
        onKeyDown={
          isSetup
            ? (e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pickServerForSide(side, boardMatch);
                }
              }
            : undefined
        }
        aria-label={
          isSetup
            ? `Сторона ${label}${serving ? ", подаёт" : ""}. Нажмите, чтобы выбрать подающего`
            : undefined
        }
      >
        <span className="judge-side__name">
          <Avatar
            size="sm"
            variant="tonal"
            className="judge-side__avatar"
            src={avatarSrc(sideAvatarKey(boardMatch, side))}
            initials={initialsFromName(label)}
            alt={label}
          />
          {label}
        </span>
        <span className="judge-side__score">{score}</span>
        <ServeBadge active={Boolean(serving)} />
        {isSetup ? (
          <span className="judge-point-spacer" aria-hidden />
        ) : !readonly && !lostLock ? (
          <Button
            className="judge-point-btn judge-touch"
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
              void point(side);
            }}
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
    <div
      className="judge-screen"
      data-testid={
        isSetup ? "judge-setup" : lostLock ? "judge-lost-lock" : "judge-screen"
      }
    >
      {showHint ? (
        <p className="judge-rotate-hint" role="status">
          Поверните устройство горизонтально для удобного судейства
        </p>
      ) : null}

      <header className="judge-toolbar">
        <div className="judge-toolbar__meta">
          <span className="judge-status">
            {isSetup
              ? "Перед стартом"
              : lostLock
                ? "Слот судьи потерян"
              : statusLabel(String(match.status), "match")}
          </span>
          {!isSetup && match.startedAt ? (
            <span className="judge-timer" aria-live="off">
              {duration}
            </span>
          ) : null}
          {match.deuceMode && !isSetup ? (
            <span className="judge-deuce">Deuce</span>
          ) : null}
          {readonly ? (
            <span className="judge-readonly-badge">Только просмотр</span>
          ) : null}
          {lostLock ? (
            <span className="judge-readonly-badge">Действия заблокированы</span>
          ) : null}
          {pointPendingCount > 0 ? (
            <span className="judge-pending-badge" role="status" aria-live="polite">
              {pointPendingCount === 1
                ? "Отправка очка…"
                : `В очереди: ${pointPendingCount}`}
            </span>
          ) : null}
        </div>
        <div className="judge-toolbar__actions">
          {isSetup ? (
            <Button
              variant="secondary"
              className="judge-touch"
              onClick={() => void releaseAndExit()}
              disabled={exitPending}
            >
              {exitPending ? "Выходим…" : "Отмена"}
            </Button>
          ) : lostLock ? (
            <Button
              variant="secondary"
              className="judge-touch"
              onClick={() => exitAfterJudge(matchRef.current ?? match)}
            >
              К матчу
            </Button>
          ) : !readonly ? (
            <>
              <Button
                variant="secondary"
                className="judge-touch"
                onClick={() => void releaseAndExit()}
                disabled={exitPending || pointPendingCount > 0}
              >
                {exitPending ? "Выходим…" : "Назад"}
              </Button>
              <Button
                variant="secondary"
                className="judge-touch"
                onClick={() => void undo()}
                disabled={locked || undoPending || pointPendingCount > 0}
                aria-label="Отменить последнее очко"
              >
                Undo
              </Button>
              <Button
                variant="secondary"
                className="judge-touch"
                onClick={() => setMenuOpen((v) => !v)}
                disabled={pointPendingCount > 0}
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

      {isSetup ? (
        <p className="judge-screen__hint">
          Нажмите на сторону, чтобы выбрать, кто подаёт первым. ↔ меняет стороны
          стола.
        </p>
      ) : null}

      {menuOpen && !readonly && !lostLock && !isSetup ? (
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
                      updateMatch(r.match as MatchState);
                      setMenuOpen(false);
                    })
                    .catch(async (e) => {
                      if (isLostJudgeError(e)) {
                        await loseJudgeLock(e);
                      } else {
                        setError(e.message);
                      }
                    })
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
            disabled={exitPending || pointPendingCount > 0}
          >
            {exitPending ? "Освобождаем…" : "Освободить слот и выйти"}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="error judge-error" role="alert">
          {error}
        </p>
      ) : null}

      <div
        className={["judge-board", isSetup ? "judge-board--setup" : ""]
          .filter(Boolean)
          .join(" ")}
        role="group"
        aria-label={isSetup ? "Расположение и подача" : "Счёт матча"}
      >
        {renderSide(left, match)}
        {isSetup ? (
          <Button
            variant="secondary"
            className="judge-touch judge-setup__swap-btn"
            aria-label="Поменять стороны"
            onClick={() => setSwapSides((v) => !v)}
          >
            ↔
          </Button>
        ) : null}
        {renderSide(right, match)}
      </div>

      {isSetup ? (
        <div className="judge-confirm-bar">
          <Button
            className="judge-touch"
            disabled={setupPending || !firstServerId}
            onClick={() => void confirmSetup()}
          >
            {setupPending ? "Сохранение…" : "Начать матч"}
          </Button>
        </div>
      ) : null}

      {match.status === "pending_confirmation" &&
      !menuOpen &&
      !readonly &&
      !isSetup ? (
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
                .then((r) => updateMatch(r.match as MatchState))
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
