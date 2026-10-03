import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, Avatar, TextField } from "../ui";
import { api } from "../api";
import { TableTennisRacketIcon } from "../icons/TableTennisRacketIcon";
import {
  boardSides,
  elapsedMs,
  formatMatchDuration,
  judgeAcquireErrorMessage,
  needsJudgeSetup,
  participantDisplayName,
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
import { useAuth } from "../auth";
import {
  acceptReviewedCorrectionScore,
  acceptReviewedPointScore,
  appendCorrectionIntent,
  appendPointIntent,
  beginCorrectionAttempt,
  beginPointAttempt,
  beginScoreRecoveryGeneration,
  createScoreRecoveryRecord,
  discardUnsentCorrection,
  discardUnsentPointIntents,
  invalidateScoreRecoveryGeneration,
  isScoreRecoveryGenerationCurrent,
  markCorrectionAttemptApplied,
  markCorrectionAttemptError,
  markCorrectionAttemptNoWrite,
  markCorrectionAttemptUnsent,
  markPointAttemptApplied,
  markPointAttemptError,
  markPointAttemptNoWrite,
  markRecoveryReadChecking,
  markRecoveryReadFailed,
  persistScoreRecoveryRecord,
  readScoreRecoveryRecord,
  reconcilePointAttempts,
  rememberScoreRecoveryRecord,
  restoreSendingAttemptsAsUnknown,
  resumeUnsentPointIntents,
  type PointIntent,
  type PointAttempt,
  type CorrectionAttempt,
  type ReviewedScoreSnapshot,
  type ScoreRecoveryRecord,
} from "./judgeScoreRecovery";

type MatchState = Record<string, unknown> & JudgeMatchLike;
type Phase =
  | "loading"
  | "blocked"
  | "setup"
  | "waiting_start"
  | "scoring"
  | "lost_lock"
  | "readonly";
type ApiError = Error & { code?: string; status?: number };

const LOST_JUDGE_CODES = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "PASSWORD_CHANGE_REQUIRED",
  "JUDGE_NOT_ACTIVE",
  "JUDGE_REQUIRED",
  "JUDGE_TAKEN",
]);

const unavailableRecoveryStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
  getItem() {
    throw new Error("session storage unavailable");
  },
  setItem() {
    throw new Error("session storage unavailable");
  },
  removeItem() {
    throw new Error("session storage unavailable");
  },
};

function recoveryStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return unavailableRecoveryStorage;
  }
}

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

function isKnownPointNoWrite(error: unknown) {
  const candidate = error as ApiError;
  return (
    (candidate.status === 400 && candidate.code === "VALIDATION") ||
    (candidate.status === 409 && candidate.code === "VERSION_CONFLICT")
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
  return ["finished", "stopped", "cancelled", "voided"].includes(String(status));
}

function hasRecoveryWork(record: ScoreRecoveryRecord | null | undefined) {
  return Boolean(
    record &&
      (record.attempts.length > 0 ||
        record.unsent.length > 0 ||
        record.correctionAttempts.length > 0 ||
        record.pausedAfterError),
  );
}

function isDefinitiveSetupRejection(error: unknown): boolean {
  const response = error as ApiError;
  return Boolean(response.code && response.status && response.status >= 400 &&
    response.status < 500 && response.status !== 408 && response.status !== 429);
}

function activeJudgeCanStart(match: MatchState): boolean {
  const activeJudgeUserId = String(
    (match.activeJudge as { userId?: unknown } | null)?.userId ?? "",
  );
  const creatorUserId = String(match.createdByUserId ?? "");
  return (
    !activeJudgeUserId ||
    !creatorUserId ||
    activeJudgeUserId === creatorUserId
  );
}

function ServeBadge({ active }: { active: boolean }) {
  if (!active) {
    return <span className="judge-serve-badge judge-serve-badge--empty" />;
  }
  return (
    <span className="judge-serve-badge">
      <TableTennisRacketIcon size={16} />
      Подача
    </span>
  );
}

export function JudgePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const actorUserId = String(user?.id ?? "");
  const currentMatchIdRef = useRef(id);
  currentMatchIdRef.current = id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const readonlyMode = searchParams.get("mode") === "readonly";

  const [match, setMatch] = useState<MatchState | null>(null);
  const matchRef = useRef<MatchState | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const pointRecoveryErrorRef = useRef<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [flashSide, setFlashSide] = useState<"A" | "B" | null>(null);
  const [undoPending, setUndoPending] = useState(false);
  const [pointPendingCount, setPointPendingCount] = useState(0);
  const pointQueueRef = useRef<PointIntent[]>([]);
  const pointQueueOwnerRef = useRef<symbol | null>(null);
  const recoveryRecordRef = useRef<ScoreRecoveryRecord | null>(null);
  const recoveryGenerationRef = useRef(0);
  const loadPromiseRef = useRef<Promise<MatchState> | null>(null);
  const [recoveryRecord, setRecoveryRecord] = useState<ScoreRecoveryRecord | null>(null);
  const [recoveryStorageError, setRecoveryStorageError] = useState<string | null>(null);
  const [discardRecoveryConfirm, setDiscardRecoveryConfirm] = useState(false);
  const [acceptRecoverySnapshot, setAcceptRecoverySnapshot] = useState<{
    version: number;
    scoreA: number;
    scoreB: number;
    serverId: string;
    sideA: string;
    sideB: string;
    serverName: string;
  } | null>(null);
  const recoveryRegionRef = useRef<HTMLElement | null>(null);
  const recoveryWasVisibleRef = useRef(false);
  const judgeLockOwnedRef = useRef(false);
  const liveSyncRunningRef = useRef(false);
  const exitPendingRef = useRef(false);
  const exclusiveMutationRef = useRef(false);
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
  const setupPendingRef = useRef(false);
  const [setupUnknown, setSetupUnknown] = useState(false);
  const setupUnknownRef = useRef(false);
  const confirmedStartRef = useRef<MatchState | null>(null);
  const [directoryUsers, setDirectoryUsers] = useState<Array<{ id: string; displayName: string }>>([]);
  const [directoryState, setDirectoryState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [directoryRequestVersion, setDirectoryRequestVersion] = useState(0);
  const [focusHandoverAfterRetry, setFocusHandoverAfterRetry] = useState(false);
  const [handoverUserId, setHandoverUserId] = useState("");
  const [handoverPending, setHandoverPending] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionScoreA, setCorrectionScoreA] = useState(0);
  const [correctionScoreB, setCorrectionScoreB] = useState(0);
  const [correctionServerId, setCorrectionServerId] = useState("");
  const [correctionDraftVersion, setCorrectionDraftVersion] = useState<number | null>(null);
  const [correctionDraftFence, setCorrectionDraftFence] = useState(false);
  const [correctionPriorAttempt, setCorrectionPriorAttempt] = useState<CorrectionAttempt | null>(null);
  const [correctionPending, setCorrectionPending] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [correctionAnnouncement, setCorrectionAnnouncement] = useState("");
  const [acceptCorrectionSnapshot, setAcceptCorrectionSnapshot] = useState<{
    attemptId: string;
    snapshot: ReviewedScoreSnapshot;
    sideA: string;
    sideB: string;
    serverName: string;
  } | null>(null);
  const correctionScoreAId = useId();
  const correctionScoreBId = useId();
  const correctionHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const correctionErrorRef = useRef<HTMLParagraphElement | null>(null);
  const correctionOpenRef = useRef(false);
  const [correctionFocusTarget, setCorrectionFocusTarget] = useState<
    "trigger" | "actions" | null
  >(null);
  const activeCorrectionAttemptIdRef = useRef<string | null>(null);
  const [terminalPending, setTerminalPending] = useState(false);

  const updateMatch = useCallback((nextMatch: MatchState) => {
    matchRef.current = nextMatch;
    setMatch(nextMatch);
  }, []);

  const setPointRecoveryError = useCallback((message: string) => {
    pointRecoveryErrorRef.current = message;
    setError(message);
  }, []);

  const clearPointRecoveryError = useCallback(() => {
    const ownedMessage = pointRecoveryErrorRef.current;
    pointRecoveryErrorRef.current = null;
    setError((current) => current === ownedMessage ? null : current);
  }, []);

  const applyRecoveryRecord = useCallback((next: ScoreRecoveryRecord | null) => {
    recoveryRecordRef.current = next;
    pointQueueRef.current = next?.unsent ?? [];
    setPointPendingCount(
      (next?.unsent.length ?? 0) +
        (next?.attempts.filter((attempt) => attempt.state === "sending").length ?? 0),
    );
    setRecoveryRecord(next);
  }, []);

  const saveRecoveryRecord = useCallback((next: ScoreRecoveryRecord) => {
    const result = persistScoreRecoveryRecord(next, recoveryStorage());
    applyRecoveryRecord(result.record);
    if (!result.ok) {
      setError("Не удалось надёжно сохранить состояние. Дальнейшая отправка изменений счёта заблокирована.");
    }
    return result;
  }, [applyRecoveryRecord]);

  useEffect(() => {
    if (!id || !actorUserId) return;
    const generation = beginScoreRecoveryGeneration(actorUserId, id);
    recoveryGenerationRef.current = generation;
    const restored = readScoreRecoveryRecord(actorUserId, id, recoveryStorage());
    setRecoveryStorageError(restored.storageError);
    if (restored.record) {
      const safeRestore = restoreSendingAttemptsAsUnknown(restored.record);
      if (restored.storageError) {
        const unsafe = rememberScoreRecoveryRecord({ ...safeRestore, storageSafe: false });
        applyRecoveryRecord(unsafe);
      } else {
        const persisted = persistScoreRecoveryRecord(safeRestore, recoveryStorage());
        applyRecoveryRecord(persisted.record);
      }
    } else {
      applyRecoveryRecord(null);
    }
    return () => {
      invalidateScoreRecoveryGeneration(actorUserId, id);
      recoveryGenerationRef.current = 0;
      pointQueueOwnerRef.current = null;
      loadPromiseRef.current = null;
      if (activeCorrectionAttemptIdRef.current !== null) {
        activeCorrectionAttemptIdRef.current = null;
        exclusiveMutationRef.current = false;
        correctionOpenRef.current = false;
        setCorrectionPending(false);
        setCorrectionOpen(false);
        setCorrectionError(null);
        setCorrectionFocusTarget(null);
      }
    };
  }, [actorUserId, applyRecoveryRecord, id]);

  const load = useCallback(async (forceFresh = false): Promise<MatchState> => {
    if (!id || !actorUserId) throw new Error("Матч или пользователь не определён");
    const requestedGeneration = recoveryGenerationRef.current;
    if (loadPromiseRef.current) {
      const activeRequest = loadPromiseRef.current;
      if (!forceFresh) return activeRequest;
      try {
        await activeRequest;
      } catch {
        // A recovery read still has to start after the mutation outcome became unknown.
      }
      if (!isScoreRecoveryGenerationCurrent(actorUserId, id, requestedGeneration)) {
        throw new Error("Экран судьи уже закрыт");
      }
      return load(false);
    }
    const generation = requestedGeneration;
    const request = (async () => {
      const activeRecovery = recoveryRecordRef.current;
      if (activeRecovery && hasRecoveryWork(activeRecovery)) {
        const checking = markRecoveryReadChecking(activeRecovery);
        rememberScoreRecoveryRecord(checking);
        applyRecoveryRecord(checking);
      }
      try {
        const res = await api.getMatch(id);
        const fresh = res.match as MatchState;
        if (!isScoreRecoveryGenerationCurrent(actorUserId, id, generation)) {
          return fresh;
        }
        const confirmed = confirmedStartRef.current;
        if (confirmed && confirmed.id === id && fresh.status === "waiting") return confirmed;
        const currentRecovery = recoveryRecordRef.current;
        const acceptedVersionFloor = Math.max(
          Number(matchRef.current?.version ?? -1),
          Number(currentRecovery?.serverVersion ?? -1),
        );
        if (Number(fresh.version ?? -1) < acceptedVersionFloor) {
          return matchRef.current ?? fresh;
        }
        updateMatch(fresh);
        if (currentRecovery && hasRecoveryWork(currentRecovery)) {
          const reconciled = reconcilePointAttempts(
            currentRecovery,
            Number(fresh.version ?? currentRecovery.serverVersion),
            Array.isArray(fresh.idempotencyKeys)
              ? fresh.idempotencyKeys.map(String)
              : [],
          );
          if (currentRecovery.storageSafe) {
            saveRecoveryRecord(reconciled.record);
          } else {
            const unsafe = { ...reconciled.record, storageSafe: false };
            rememberScoreRecoveryRecord(unsafe);
            applyRecoveryRecord(unsafe);
          }
          if (reconciled.appliedCorrectionAttemptIds.length > 0) {
            setCorrectionAnnouncement(
              `Коррекция сохранена. Текущий счёт ${sideDisplayName(fresh, "A")}: ${String(fresh.scoreA)}; ${sideDisplayName(fresh, "B")}: ${String(fresh.scoreB)}.`,
            );
            if (!correctionOpenRef.current) {
              setCorrectionFocusTarget("actions");
            }
          }
        }
        return fresh;
      } catch (reason) {
        const currentRecovery = recoveryRecordRef.current;
        if (
          currentRecovery &&
          hasRecoveryWork(currentRecovery) &&
          isScoreRecoveryGenerationCurrent(actorUserId, id, generation)
        ) {
          const failedRead = markRecoveryReadFailed(currentRecovery);
          if (currentRecovery.storageSafe) saveRecoveryRecord(failedRead);
          else {
            const unsafe = { ...failedRead, storageSafe: false };
            rememberScoreRecoveryRecord(unsafe);
            applyRecoveryRecord(unsafe);
          }
        }
        throw reason;
      }
    })();
    loadPromiseRef.current = request;
    try {
      return await request;
    } finally {
      if (loadPromiseRef.current === request) loadPromiseRef.current = null;
    }
  }, [actorUserId, applyRecoveryRecord, id, saveRecoveryRecord, updateMatch]);

  useEffect(() => {
    confirmedStartRef.current = null;
    setupUnknownRef.current = false;
    setSetupUnknown(false);
    setupPendingRef.current = false;
    setSetupPending(false);
  }, [id]);

  useEffect(() => {
    correctionOpenRef.current = correctionOpen;
    if (correctionOpen) correctionHeadingRef.current?.focus();
  }, [correctionOpen]);

  useEffect(() => {
    const target = correctionFocusTarget;
    if (!target || correctionOpen) return;
    if (target === "trigger" && !menuOpen) return;
    const element =
      target === "trigger"
        ? document.getElementById("judge-correction-trigger")
        : document.getElementById("judge-more-trigger");
    if (!element) return;
    element.focus();
    setCorrectionFocusTarget(null);
  }, [correctionFocusTarget, correctionOpen, menuOpen]);

  const exitAfterJudge = useCallback(
    (m: MatchState | null, notice?: JudgeExitNotice, destination?: "/") => {
      if (m?.kind === "tutorial") {
        navigate("/onboarding");
        return;
      }
      const tournamentId = m?.tournamentId ? String(m.tournamentId) : null;
      const options = notice ? { state: { judgeExitNotice: notice } } : undefined;
      if (destination === "/") {
        navigate("/", options);
        return;
      }
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
        const fresh = await load(true);
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
        const status = String(fresh.status ?? "");
        if (ownsLock && status === "in_progress") {
          setPhase((current) =>
            current === "waiting_start" ? "scoring" : current,
          );
        }
        if (
          status === "finished" ||
          status === "stopped" ||
          status === "cancelled" ||
          status === "voided"
        ) {
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
      let acquiredDuringFallback = false;
      let detail: MatchState;
      try {
        detail = await load();
      } catch (loadError) {
        if (readonlyMode || (loadError as ApiError).status !== 403) {
          throw loadError;
        }
        await api.acquireJudge(id);
        acquiredDuringFallback = true;
        judgeLockOwnedRef.current = true;
        detail = await load();
      }
      const status = String(detail.status ?? "");
      if (
        readonlyMode ||
        isTerminalMatchStatus(status)
      ) {
        judgeLockOwnedRef.current = false;
        setPhase("readonly");
        return;
      }
      if (!acquiredDuringFallback) {
        await api.acquireJudge(id);
        judgeLockOwnedRef.current = true;
      }
      const refreshed = acquiredDuringFallback ? detail : await load();
      if (needsJudgeSetup(refreshed)) {
        const firstServerMethod = String(refreshed.firstServerMethod ?? "manual");
        setFirstServerId(
          firstServerMethod === "random"
            ? String(refreshed.currentServerParticipantId ?? "")
            : refreshed.status === "waiting"
              ? ""
              : String(refreshed.currentServerParticipantId ?? ""),
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
    if (!menuOpen || readonlyMode || directoryState === "ready" || directoryState === "error") return;
    let current = true;
    setDirectoryState("loading");
    void api.directory().then((result) => {
      if (!current) return;
      setDirectoryUsers(
        (result.users as Array<{ id: string; displayName?: string; firstName?: string; lastName?: string }>).map((candidate) => ({
          id: candidate.id,
          displayName: candidate.displayName ?? `${candidate.lastName ?? ""} ${candidate.firstName ?? ""}`.trim(),
        })),
      );
      setDirectoryState("ready");
    }).catch(() => {
      if (current) setDirectoryState("error");
    });
    return () => { current = false; };
  }, [directoryRequestVersion, menuOpen, readonlyMode]);

  useEffect(() => {
    if (!focusHandoverAfterRetry || (directoryState !== "ready" && directoryState !== "error")) return;
    if (document.activeElement === document.body) document.getElementById(directoryState === "ready" ? "judge-handover-user" : "judge-handover-retry")?.focus();
    setFocusHandoverAfterRetry(false);
  }, [directoryState, focusHandoverAfterRetry]);

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
    const ownsLock =
      phase === "setup" || phase === "waiting_start" || phase === "scoring";
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
    if (setupPendingRef.current || setupUnknownRef.current) return;
    const p = (preview.participants ?? []).find((x) => x.side === side);
    if (p) setFirstServerId(p.id);
  }

  async function confirmSetup() {
    if (!id || !match || setupPendingRef.current || setupUnknownRef.current) return;
    const method = String(match.firstServerMethod ?? "manual");
    if (method !== "random" && !firstServerId) return;
    const requestedId = id;
    const attempt = { firstServerParticipantId: firstServerId, swapSides };
    setupPendingRef.current = true;
    setSetupPending(true);
    setError(null);
    try {
      if (match.status === "waiting" && !activeJudgeCanStart(match)) {
        if (method !== "random") {
          const result = await api.judgeSetup(id, attempt);
          if (currentMatchIdRef.current !== requestedId) return;
          updateMatch(result.match as MatchState);
        }
        setPhase("waiting_start");
        return;
      }
      let started = confirmedStartRef.current ?? match;
      if (started.status === "waiting") {
        const startResult = await api.startMatch(
          id,
          method === "random" ? {} : { firstServerParticipantId: attempt.firstServerParticipantId },
        );
        if (currentMatchIdRef.current !== requestedId) return;
        started = startResult.match as MatchState;
        confirmedStartRef.current = started;
        updateMatch(started);
      }
      const selectedServer = method === "random"
        ? String(started.currentServerParticipantId ?? "")
        : attempt.firstServerParticipantId;
      if (!selectedServer) throw new Error("Не удалось определить первую подачу");
      const res = await api.judgeSetup(id, {
        firstServerParticipantId: selectedServer,
        swapSides: attempt.swapSides,
      });
      if (currentMatchIdRef.current !== requestedId) return;
      updateMatch(res.match as MatchState);
      setPhase("scoring");
    } catch (e) {
      if (currentMatchIdRef.current !== requestedId) return;
      if (isLostJudgeError(e)) {
        await loseJudgeLock(e);
      } else if (!isDefinitiveSetupRejection(e)) {
        setupUnknownRef.current = true;
        setSetupUnknown(true);
        setError("Исход подготовки неизвестен. Не отправляйте её повторно: проверьте состояние матча перед продолжением.");
      } else {
        setError((e as Error).message);
      }
    } finally {
      if (currentMatchIdRef.current === requestedId) {
        setupPendingRef.current = false;
        setSetupPending(false);
      }
    }
  }

  async function drainPointQueue(initialMatch: MatchState, fenceVersion?: number) {
    if (!id || pointQueueOwnerRef.current) return;
    const owner = Symbol("point-queue-owner");
    pointQueueOwnerRef.current = owner;
    let authoritativeMatch = initialMatch;
    let nextFenceVersion = fenceVersion;
    const generation = recoveryGenerationRef.current;

    try {
      while (recoveryRecordRef.current?.unsent.length) {
        const beforeAttempt = recoveryRecordRef.current;
        if (
          !beforeAttempt.storageSafe ||
          beforeAttempt.pausedAfterError ||
          !judgeLockOwnedRef.current ||
          !isScoreRecoveryGenerationCurrent(actorUserId, id, generation)
        ) break;
        if (authoritativeMatch.status !== "in_progress") {
          const stopped = { ...beforeAttempt, pausedAfterError: true };
          rememberScoreRecoveryRecord(stopped);
          applyRecoveryRecord(stopped);
          setError(
            "Матч больше не принимает очки. Проверьте итоговый счёт перед продолжением.",
          );
          break;
        }

        const begun = beginPointAttempt(
          beforeAttempt,
          nextFenceVersion !== undefined
            ? nextFenceVersion
            : Number(authoritativeMatch.version),
          nextFenceVersion !== undefined,
        );
        nextFenceVersion = undefined;
        if (!begun.attempt) break;
        const transition = saveRecoveryRecord(begun.record);
        if (!transition.ok) {
          const restoredIntent = { ...beforeAttempt, storageSafe: false };
          rememberScoreRecoveryRecord(restoredIntent);
          applyRecoveryRecord(restoredIntent);
          break;
        }
        const intent = begun.attempt;
        try {
          const res = await api.awardPoint(
            id,
            intent.side,
            intent.expectedVersion,
            intent.idempotencyKey,
          );
          if (!isScoreRecoveryGenerationCurrent(actorUserId, id, generation)) break;
          if (!judgeLockOwnedRef.current) {
            try {
              await load();
            } catch {
              // The lost-lock alert remains authoritative for the user.
            }
            break;
          }
          const responseMatch = res.match as MatchState;
          authoritativeMatch =
            Number(responseMatch.version ?? -1) >= Number(matchRef.current?.version ?? -1)
              ? responseMatch
              : (matchRef.current ?? responseMatch);
          const currentRecovery = recoveryRecordRef.current;
          if (!currentRecovery) break;
          const applied = markPointAttemptApplied(
            currentRecovery,
            intent.id,
            Number(authoritativeMatch.version),
          );
          const saved = currentRecovery.storageSafe
            ? saveRecoveryRecord(applied)
            : { ok: false as const, record: { ...applied, storageSafe: false } };
          if (!currentRecovery.storageSafe) {
            rememberScoreRecoveryRecord(saved.record);
            applyRecoveryRecord(saved.record);
          }
          updateMatch(authoritativeMatch);
          pointRecoveryErrorRef.current = null;
          setError(null);
          setFlashSide(intent.side);
          if (flashTimeoutRef.current !== null) {
            window.clearTimeout(flashTimeoutRef.current);
          }
          flashTimeoutRef.current = window.setTimeout(() => {
            setFlashSide(null);
            flashTimeoutRef.current = null;
          }, 350);
          if (!saved.ok) break;
        } catch (e) {
          const err = e as ApiError;
          if (!isScoreRecoveryGenerationCurrent(actorUserId, id, generation)) break;
          const currentRecovery = recoveryRecordRef.current;
          const knownNoWrite = isKnownPointNoWrite(e);
          if (currentRecovery) {
            const resolved = knownNoWrite
              ? markPointAttemptNoWrite(currentRecovery, intent.id)
              : markPointAttemptError(currentRecovery, intent.id);
            if (currentRecovery.storageSafe) saveRecoveryRecord(resolved);
            else {
              const unsafe = { ...resolved, storageSafe: false };
              rememberScoreRecoveryRecord(unsafe);
              applyRecoveryRecord(unsafe);
            }
          }
          if (isLostJudgeError(e)) {
            await loseJudgeLock(e);
            break;
          }
          try {
            authoritativeMatch = await load(true);
          } catch {
            // Preserve the mutation error; the existing screen remains usable.
          }
          if (!isScoreRecoveryGenerationCurrent(actorUserId, id, generation)) break;
          const afterRead = recoveryRecordRef.current;
          const attemptStillUnresolved = Boolean(
            afterRead?.attempts.some((attempt) => attempt.id === intent.id),
          );
          const queuedCount = afterRead?.unsent.length ?? 0;
          if (!attemptStillUnresolved && !knownNoWrite) {
            if (queuedCount > 0) {
              setPointRecoveryError(
                "Начисление подтверждено сервером. Оставшиеся сохранённые нажатия остановлены до вашего решения.",
              );
            } else {
              clearPointRecoveryError();
            }
          } else if (knownNoWrite) {
            setPointRecoveryError(
              queuedCount > 0
                ? "Запрос не изменил счёт. Показано актуальное состояние; сохранённые нажатия остаются остановлены до вашего решения."
                : "Запрос не изменил счёт. Показано актуальное состояние.",
            );
          } else {
            setPointRecoveryError(
              `Не удалось подтвердить результат начисления: ${err.message}. Сохранённые нажатия остановлены до вашего решения.`,
            );
          }
          break;
        }
      }
    } finally {
      if (pointQueueOwnerRef.current === owner) pointQueueOwnerRef.current = null;
    }
  }

  function point(side: "A" | "B") {
    const currentRecovery = recoveryRecordRef.current;
    const outcomeBlocked = Boolean(
      currentRecovery &&
        (!currentRecovery.storageSafe ||
          currentRecovery.pausedAfterError ||
          currentRecovery.attempts.some((attempt) => attempt.state !== "sending")),
    );
    if (
      !id ||
      !actorUserId ||
      !match ||
      phase !== "scoring" ||
      !judgeLockOwnedRef.current ||
      exclusiveMutationRef.current ||
      recoveryStorageError ||
      outcomeBlocked
    ) {
      return;
    }
    setMenuOpen(false);
    const base = currentRecovery ?? createScoreRecoveryRecord(
      actorUserId,
      id,
      Number((matchRef.current ?? match).version),
    );
    const next = appendPointIntent(base, {
      id: crypto.randomUUID(),
      side,
      idempotencyKey: crypto.randomUUID(),
    });
    const saved = saveRecoveryRecord(next);
    if (!saved.ok) return;
    void drainPointQueue(matchRef.current ?? match);
  }

  function recoveryBlocksMutations() {
    const record = recoveryRecordRef.current;
    return Boolean(
      recoveryStorageError ||
        (record &&
          (!record.storageSafe ||
            record.pausedAfterError ||
            record.attempts.length > 0 ||
            record.unsent.length > 0 ||
            record.correctionAttempts.length > 0)),
    );
  }

  async function recheckScoreRecovery() {
    if (!id || !actorUserId) return;
    setRecoveryStorageError(null);
    const current = recoveryRecordRef.current;
    if (current && !current.storageSafe) {
      const saved = saveRecoveryRecord(current);
      if (!saved.ok) return;
    } else if (!current) {
      const restored = readScoreRecoveryRecord(actorUserId, id, recoveryStorage());
      setRecoveryStorageError(restored.storageError);
      if (restored.storageError) return;
      if (restored.record) applyRecoveryRecord(restoreSendingAttemptsAsUnknown(restored.record));
    }
    try {
      await load(true);
      if (pointRecoveryErrorRef.current) {
        const checked = recoveryRecordRef.current;
        if ((checked?.attempts.length ?? 0) === 0) {
          if ((checked?.unsent.length ?? 0) > 0) {
            setPointRecoveryError(
              "Начисление подтверждено сервером. Оставшиеся сохранённые нажатия остановлены до вашего решения.",
            );
          } else {
            clearPointRecoveryError();
          }
        }
      }
    } catch (reason) {
      setError(`Не удалось проверить счёт: ${(reason as Error).message}`);
    }
  }

  function acceptCurrentScore() {
    const current = recoveryRecordRef.current;
    const authoritative = matchRef.current;
    if (
      !current ||
      !authoritative ||
      current.readState !== "no-key" ||
      current.reviewedVersion === undefined ||
      !current.storageSafe
    ) return;
    const serverId = String(authoritative.currentServerParticipantId ?? "");
    const server = (authoritative.participants ?? []).find(
      (participant) => participant.id === serverId,
    );
    setAcceptRecoverySnapshot({
      version: current.reviewedVersion,
      scoreA: Number(authoritative.scoreA ?? 0),
      scoreB: Number(authoritative.scoreB ?? 0),
      serverId,
      sideA: sideDisplayName(authoritative, "A"),
      sideB: sideDisplayName(authoritative, "B"),
      serverName: server ? participantDisplayName(server) : "не определена",
    });
  }

  function confirmCurrentScoreAcceptance() {
    const current = recoveryRecordRef.current;
    const authoritative = matchRef.current;
    const snapshot = acceptRecoverySnapshot;
    if (!current || !authoritative || !snapshot) return;
    const stillCurrent =
      current.readState === "no-key" &&
      current.reviewedVersion === snapshot.version &&
      Number(authoritative.version) === snapshot.version &&
      Number(authoritative.scoreA ?? 0) === snapshot.scoreA &&
      Number(authoritative.scoreB ?? 0) === snapshot.scoreB &&
      String(authoritative.currentServerParticipantId ?? "") === snapshot.serverId &&
      current.attempts.some((attempt) => attempt.state === "unknown");
    if (!stillCurrent) {
      setAcceptRecoverySnapshot(null);
      setError("Счёт изменился во время подтверждения. Проверьте актуальное состояние ещё раз.");
      return;
    }
    saveRecoveryRecord(
      acceptReviewedPointScore(current, {
        version: snapshot.version,
        scoreA: snapshot.scoreA,
        scoreB: snapshot.scoreB,
        currentServerParticipantId: snapshot.serverId,
      }),
    );
    setAcceptRecoverySnapshot(null);
    setError(null);
  }

  function acceptCurrentCorrectionScore(attemptId: string) {
    const current = recoveryRecordRef.current;
    const authoritative = matchRef.current;
    const attempt = current?.correctionAttempts.find(
      (candidate) => candidate.id === attemptId && candidate.state === "unknown",
    );
    if (
      !current ||
      !authoritative ||
      !attempt ||
      current.readState !== "no-key" ||
      current.reviewedVersion === undefined ||
      !current.storageSafe
    ) return;
    const snapshot = correctionSnapshotFromMatch(authoritative);
    if (snapshot.version !== current.reviewedVersion) return;
    const server = (authoritative.participants ?? []).find(
      (participant) => participant.id === snapshot.currentServerParticipantId,
    );
    setAcceptCorrectionSnapshot({
      attemptId,
      snapshot,
      sideA: sideDisplayName(authoritative, "A"),
      sideB: sideDisplayName(authoritative, "B"),
      serverName: server ? participantDisplayName(server) : "не определена",
    });
  }

  function confirmCurrentCorrectionAcceptance() {
    const current = recoveryRecordRef.current;
    const authoritative = matchRef.current;
    const choice = acceptCorrectionSnapshot;
    if (!current || !authoritative || !choice) return;
    const currentSnapshot = correctionSnapshotFromMatch(authoritative);
    const attempt = current.correctionAttempts.find(
      (candidate) => candidate.id === choice.attemptId && candidate.state === "unknown",
    );
    const stillCurrent =
      Boolean(attempt) &&
      current.readState === "no-key" &&
      current.reviewedVersion === choice.snapshot.version &&
      currentSnapshot.version === choice.snapshot.version &&
      currentSnapshot.scoreA === choice.snapshot.scoreA &&
      currentSnapshot.scoreB === choice.snapshot.scoreB &&
      currentSnapshot.currentServerParticipantId === choice.snapshot.currentServerParticipantId;
    if (!stillCurrent) {
      setAcceptCorrectionSnapshot(null);
      setError("Счёт изменился во время подтверждения. Проверьте актуальное состояние ещё раз.");
      return;
    }
    saveRecoveryRecord(
      acceptReviewedCorrectionScore(current, choice.attemptId, choice.snapshot),
    );
    setAcceptCorrectionSnapshot(null);
    setError(null);
  }

  function discardUnsentCorrectionIntent(attemptId: string) {
    const current = recoveryRecordRef.current;
    if (!current) return;
    const discarded = discardUnsentCorrection(current, attemptId);
    if (current.storageSafe) saveRecoveryRecord(discarded);
    else {
      const unsafe = { ...discarded, storageSafe: false };
      rememberScoreRecoveryRecord(unsafe);
      applyRecoveryRecord(unsafe);
    }
  }

  function continueQueuedPoints() {
    const current = recoveryRecordRef.current;
    const authoritative = matchRef.current;
    if (
      !current ||
      !authoritative ||
      !judgeLockOwnedRef.current ||
      !current.storageSafe ||
      current.attempts.length > 0 ||
      current.unsent.length === 0 ||
      current.readState !== "exact"
    ) return;
    const saved = saveRecoveryRecord(resumeUnsentPointIntents(current));
    if (saved.ok) void drainPointQueue(authoritative);
  }

  function sendReviewedFencePoint(side: "A" | "B") {
    const current = recoveryRecordRef.current;
    const authoritative = matchRef.current;
    const acceptedAttempt = current?.attempts.find(
      (attempt) => attempt.state === "accepted-no-key" && attempt.reviewedVersion !== undefined,
    );
    if (
      !id ||
      !current ||
      !authoritative ||
      !judgeLockOwnedRef.current ||
      !current.storageSafe ||
      current.readState !== "no-key" ||
      !acceptedAttempt ||
      acceptedAttempt.reviewedVersion === undefined
    ) return;
    const fenced = resumeUnsentPointIntents({
      ...current,
      unsent: [
        { id: crypto.randomUUID(), side, idempotencyKey: crypto.randomUUID() },
        ...current.unsent,
      ],
    });
    const saved = saveRecoveryRecord(fenced);
    if (saved.ok) void drainPointQueue(authoritative, acceptedAttempt.reviewedVersion);
  }

  function discardQueuedPoints() {
    const current = recoveryRecordRef.current;
    if (!current?.unsent.length) return;
    if (!discardRecoveryConfirm) {
      setDiscardRecoveryConfirm(true);
      return;
    }
    const discarded = discardUnsentPointIntents(current);
    if (current.storageSafe) saveRecoveryRecord(discarded);
    else {
      const unsafe = { ...discarded, storageSafe: false };
      rememberScoreRecoveryRecord(unsafe);
      applyRecoveryRecord(unsafe);
    }
    setDiscardRecoveryConfirm(false);
  }

  async function undo() {
    if (
      !match ||
      undoPending ||
      exclusiveMutationRef.current ||
      pointQueueOwnerRef.current !== null ||
      pointQueueRef.current.length > 0 ||
      recoveryBlocksMutations()
    ) return;
    exclusiveMutationRef.current = true;
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
      exclusiveMutationRef.current = false;
      setUndoPending(false);
    }
  }

  async function releaseAndExit(destination?: "/") {
    const scoreWriteInFlight = Boolean(
      recoveryRecordRef.current?.attempts.some((attempt) => attempt.state === "sending"),
    );
    if (
      !id ||
      exitPendingRef.current ||
      setupPendingRef.current ||
      exclusiveMutationRef.current ||
      scoreWriteInFlight
    ) return;
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
    exitAfterJudge(matchRef.current ?? match, notice, destination);
  }

  async function onConfirmFinish() {
    if (
      !id ||
      terminalPending ||
      exclusiveMutationRef.current ||
      pointQueueOwnerRef.current !== null ||
      pointQueueRef.current.length > 0 ||
      recoveryBlocksMutations()
    ) return;
    exclusiveMutationRef.current = true;
    setTerminalPending(true);
    try {
      const res = await api.confirmFinish(id);
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
    } finally {
      exclusiveMutationRef.current = false;
      setTerminalPending(false);
    }
  }

  async function onRevertFinish() {
    if (
      !id ||
      terminalPending ||
      exclusiveMutationRef.current ||
      pointQueueOwnerRef.current !== null ||
      pointQueueRef.current.length > 0 ||
      recoveryBlocksMutations()
    ) return;
    exclusiveMutationRef.current = true;
    setTerminalPending(true);
    try {
      const result = await api.revertFinish(id);
      updateMatch(result.match as MatchState);
      setMenuOpen(false);
      setError(null);
    } catch (error) {
      if (isLostJudgeError(error)) await loseJudgeLock(error);
      else setError((error as Error).message);
    } finally {
      exclusiveMutationRef.current = false;
      setTerminalPending(false);
    }
  }

  async function toggleDisplayFlip() {
    if (!id || !match || exclusiveMutationRef.current) return;
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

  function openCorrection() {
    if (
      exclusiveMutationRef.current ||
      pointQueueRef.current.length > 0 ||
      recoveryBlocksMutations()
    ) return;
    setCorrectionScoreA(Number(match?.scoreA ?? 0));
    setCorrectionScoreB(Number(match?.scoreB ?? 0));
    setCorrectionServerId(String(match?.currentServerParticipantId ?? ""));
    setCorrectionDraftVersion(Number(match?.version ?? 0));
    setCorrectionDraftFence(false);
    setCorrectionPriorAttempt(null);
    setCorrectionError(null);
    setCorrectionOpen(true);
    setMenuOpen(false);
  }

  function closeCorrection() {
    if (correctionPending) return;
    setCorrectionOpen(false);
    setCorrectionError(null);
    setMenuOpen(true);
    setCorrectionFocusTarget("trigger");
  }

  function correctionSnapshotFromMatch(authoritative: MatchState): ReviewedScoreSnapshot {
    return {
      version: Number(authoritative.version),
      scoreA: Number(authoritative.scoreA ?? 0),
      scoreB: Number(authoritative.scoreB ?? 0),
      currentServerParticipantId: String(authoritative.currentServerParticipantId ?? ""),
    };
  }

  function openReviewedCorrection(attempt: PointAttempt | CorrectionAttempt) {
    const accepted = attempt;
    if (
      accepted.reviewedVersion === undefined ||
      accepted.reviewedScoreA === undefined ||
      accepted.reviewedScoreB === undefined ||
      !accepted.reviewedServerParticipantId
    ) return;
    setCorrectionScoreA(accepted.reviewedScoreA);
    setCorrectionScoreB(accepted.reviewedScoreB);
    setCorrectionServerId(accepted.reviewedServerParticipantId);
    setCorrectionDraftVersion(accepted.reviewedVersion);
    setCorrectionDraftFence(true);
    setCorrectionPriorAttempt(
      "scoreA" in accepted && typeof accepted.scoreA === "number"
        ? accepted
        : null,
    );
    setCorrectionError(null);
    setCorrectionOpen(true);
    setMenuOpen(false);
  }

  async function submitCorrection() {
    if (
      !id ||
      !actorUserId ||
      !match ||
      !correctionServerId ||
      correctionDraftVersion === null ||
      correctionPending ||
      exclusiveMutationRef.current ||
      (!correctionDraftFence && recoveryBlocksMutations())
    ) return;
    if (!Number.isInteger(correctionScoreA) || correctionScoreA < 0) {
      setCorrectionError("Введите целое неотрицательное значение для стороны A.");
      document.getElementById(correctionScoreAId)?.focus();
      return;
    }
    if (!Number.isInteger(correctionScoreB) || correctionScoreB < 0) {
      setCorrectionError("Введите целое неотрицательное значение для стороны B.");
      document.getElementById(correctionScoreBId)?.focus();
      return;
    }
    const attemptId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    const base = recoveryRecordRef.current ?? createScoreRecoveryRecord(
      actorUserId,
      id,
      correctionDraftVersion,
    );
    const queued = appendCorrectionIntent(base, {
      id: attemptId,
      idempotencyKey,
      expectedVersion: correctionDraftVersion,
      scoreA: correctionScoreA,
      scoreB: correctionScoreB,
      currentServerParticipantId: correctionServerId,
      ...(correctionDraftFence ? { fence: true } : {}),
    });
    const queuedSave = saveRecoveryRecord(queued);
    if (!queuedSave.ok) {
      setCorrectionOpen(false);
      return;
    }
    const begun = beginCorrectionAttempt(queuedSave.record, attemptId);
    if (!begun.attempt) return;
    const sendingSave = saveRecoveryRecord(begun.record);
    if (!sendingSave.ok) {
      const unsafe = {
        ...markCorrectionAttemptUnsent(sendingSave.record, attemptId),
        storageSafe: false,
      };
      rememberScoreRecoveryRecord(unsafe);
      applyRecoveryRecord(unsafe);
      setCorrectionOpen(false);
      return;
    }
    const generation = recoveryGenerationRef.current;
    activeCorrectionAttemptIdRef.current = attemptId;
    exclusiveMutationRef.current = true;
    setCorrectionPending(true);
    setCorrectionError(null);
    setError(null);
    try {
      const result = await api.manualCorrection(
        id,
        {
          scoreA: begun.attempt.scoreA,
          scoreB: begun.attempt.scoreB,
          currentServerParticipantId: begun.attempt.currentServerParticipantId,
          expectedVersion: begun.attempt.expectedVersion,
        },
        begun.attempt.idempotencyKey,
      );
      if (!isScoreRecoveryGenerationCurrent(actorUserId, id, generation)) return;
      const responseMatch = result.match as MatchState;
      const authoritative =
        Number(responseMatch.version ?? -1) >= Number(matchRef.current?.version ?? -1)
          ? responseMatch
          : (matchRef.current ?? responseMatch);
      const currentRecovery = recoveryRecordRef.current;
      if (currentRecovery) {
        saveRecoveryRecord(
          markCorrectionAttemptApplied(
            currentRecovery,
            attemptId,
            Number(authoritative.version),
          ),
        );
      }
      updateMatch(authoritative);
      if (activeCorrectionAttemptIdRef.current === attemptId) {
        setCorrectionOpen(false);
        setMenuOpen(false);
        setCorrectionFocusTarget("actions");
      }
      setCorrectionAnnouncement(
        `Коррекция сохранена. Текущий счёт ${sideDisplayName(authoritative, "A")}: ${String(authoritative.scoreA)}; ${sideDisplayName(authoritative, "B")}: ${String(authoritative.scoreB)}.`,
      );
    } catch (reason) {
      if (!isScoreRecoveryGenerationCurrent(actorUserId, id, generation)) return;
      const apiError = reason as ApiError;
      const knownNoWrite = isKnownPointNoWrite(reason) || isLostJudgeError(reason);
      const currentRecovery = recoveryRecordRef.current;
      if (currentRecovery) {
        const resolved = knownNoWrite
          ? markCorrectionAttemptNoWrite(currentRecovery, attemptId)
          : markCorrectionAttemptError(currentRecovery, attemptId);
        if (currentRecovery.storageSafe) saveRecoveryRecord(resolved);
        else {
          const unsafe = { ...resolved, storageSafe: false };
          rememberScoreRecoveryRecord(unsafe);
          applyRecoveryRecord(unsafe);
        }
      }
      if (isLostJudgeError(reason)) {
        setCorrectionOpen(false);
        await loseJudgeLock(reason);
      } else if (knownNoWrite) {
        try {
          await load(true);
        } catch {
          // Keep the known mutation result and the latest visible server state.
        }
        if (!isScoreRecoveryGenerationCurrent(actorUserId, id, generation)) return;
        if (apiError.status === 400 && apiError.code === "VALIDATION") {
          setCorrectionError("Коррекция не сохранена. Проверьте введённые значения.");
          correctionErrorRef.current?.focus();
        } else {
          setCorrectionOpen(false);
          setCorrectionFocusTarget("actions");
          setError("Состояние матча изменилось. Показаны актуальные данные.");
        }
      } else {
        setCorrectionOpen(false);
        try {
          await load(true);
        } catch {
          // The recovery record retains the immutable submitted correction.
        }
        if (!isScoreRecoveryGenerationCurrent(actorUserId, id, generation)) return;
        const unresolved = recoveryRecordRef.current?.correctionAttempts.some(
          (attempt) => attempt.id === attemptId,
        );
        if (unresolved) {
          setError(
            `Не удалось подтвердить результат коррекции: ${apiError.message}. Выполните только проверку состояния.`,
          );
        } else {
          setError(null);
        }
      }
    } finally {
      if (isScoreRecoveryGenerationCurrent(actorUserId, id, generation)) {
        if (activeCorrectionAttemptIdRef.current === attemptId) {
          activeCorrectionAttemptIdRef.current = null;
        }
        exclusiveMutationRef.current = false;
        setCorrectionPending(false);
      }
    }
  }

  async function submitHandover() {
    if (!id || !handoverUserId || handoverPending || exclusiveMutationRef.current) return;
    exclusiveMutationRef.current = true;
    setHandoverPending(true);
    setError(null);
    try {
      const result = await api.handoverJudge(id, handoverUserId);
      judgeLockOwnedRef.current = false;
      exitAfterJudge(matchRef.current ?? match, {
        kind: "success",
        message: `Судейство передано: ${String(result.reservation.displayName ?? "назначенный пользователь")} может занять слот.`,
      });
    } catch (reason) {
      if (isLostJudgeError(reason)) await loseJudgeLock(reason);
      else {
        const stale = ["VERSION_CONFLICT", "MATCH_VERSION_CONFLICT"].includes(String((reason as ApiError).code));
        if (stale) await load().catch(() => undefined);
        setError(stale ? "Матч изменился на другом устройстве. Данные обновлены; повторите передачу при необходимости." : (reason as Error).message);
      }
    } finally {
      exclusiveMutationRef.current = false;
      setHandoverPending(false);
    }
  }

  const scoreRecoveryVisible = Boolean(
    recoveryStorageError ||
      (recoveryRecord &&
        (!recoveryRecord.storageSafe ||
          recoveryRecord.attempts.some((attempt) => attempt.state !== "sending") ||
          recoveryRecord.correctionAttempts.some((attempt) => attempt.state !== "sending") ||
          recoveryRecord.pausedAfterError)),
  );
  const scoreRecoveryRenderable = Boolean(
    scoreRecoveryVisible &&
      match &&
      phase !== "loading" &&
      phase !== "blocked",
  );

  useEffect(() => {
    if (scoreRecoveryRenderable && !recoveryWasVisibleRef.current) {
      recoveryRegionRef.current?.focus();
      recoveryWasVisibleRef.current = true;
    } else if (!scoreRecoveryRenderable) {
      recoveryWasVisibleRef.current = false;
    }
  }, [scoreRecoveryRenderable]);

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

  const isSetup = phase === "setup" || phase === "waiting_start";
  const awaitingCreator = phase === "waiting_start";
  const setupInputLocked = setupPending || setupUnknown;
  const lostLock = phase === "lost_lock";
  const scoreRecoveryBlocked = Boolean(
    recoveryStorageError ||
      (recoveryRecord &&
        (!recoveryRecord.storageSafe ||
          recoveryRecord.attempts.length > 0 ||
          recoveryRecord.unsent.length > 0 ||
          recoveryRecord.correctionAttempts.length > 0 ||
          recoveryRecord.pausedAfterError)),
  );
  const scoreSendInFlight = Boolean(
    recoveryRecord?.attempts.some((attempt) => attempt.state === "sending"),
  );
  const sendingPointCount =
    recoveryRecord?.attempts.filter((attempt) => attempt.state === "sending").length ?? 0;
  const unsentPointCount = recoveryRecord?.unsent.length ?? 0;
  const activePointCount = sendingPointCount + unsentPointCount;
  const unknownCorrectionAttempt = recoveryRecord?.correctionAttempts.find(
    (attempt) => attempt.state === "unknown",
  );
  const acceptedCorrectionSource = [
    ...(recoveryRecord?.attempts ?? []),
    ...(recoveryRecord?.correctionAttempts ?? []),
  ].find(
    (attempt) =>
      attempt.state === "accepted-no-key" &&
      attempt.reviewedVersion !== undefined &&
      attempt.reviewedScoreA !== undefined &&
      attempt.reviewedScoreB !== undefined &&
      Boolean(attempt.reviewedServerParticipantId),
  );
  const locked =
    lostLock ||
    scoreRecoveryVisible ||
    match.status === "pending_confirmation" ||
    match.status === "finished" ||
    correctionOpen ||
    correctionPending ||
    handoverPending ||
    terminalPending;
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
        role={isSetup && !awaitingCreator ? "button" : undefined}
        tabIndex={isSetup && !awaitingCreator ? setupInputLocked ? -1 : 0 : undefined}
        aria-disabled={isSetup && !awaitingCreator ? setupInputLocked : undefined}
        onClick={
          isSetup && !awaitingCreator && !setupInputLocked
            ? () => pickServerForSide(side, boardMatch)
            : undefined
        }
        onKeyDown={
          isSetup && !awaitingCreator && !setupInputLocked
            ? (e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pickServerForSide(side, boardMatch);
                }
              }
            : undefined
        }
        aria-label={
          isSetup && !awaitingCreator
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
            alt=""
            aria-hidden="true"
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
          {sendingPointCount > 0 ? (
            <span className="judge-pending-badge" role="status" aria-live="polite">
              {activePointCount === 1
                ? "Отправка очка…"
                : `В очереди: ${activePointCount}`}
            </span>
          ) : null}
        </div>
        <div className="judge-toolbar__actions">
          {!readonly && !lostLock ? <Button
            variant="secondary"
            className="judge-touch"
            onClick={() => void releaseAndExit("/")}
            disabled={exitPending || setupPending || undoPending || terminalPending || scoreSendInFlight || correctionOpen || correctionPending || handoverPending}
          >На главную</Button> : null}
          {isSetup ? (
            <Button
              variant="secondary"
              className="judge-touch"
              onClick={() => void releaseAndExit()}
            disabled={exitPending || setupPending}
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
                disabled={exitPending || undoPending || terminalPending || scoreSendInFlight || correctionOpen || correctionPending || handoverPending}
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
                disabled={scoreRecoveryVisible || undoPending || terminalPending || scoreSendInFlight || correctionOpen || correctionPending || handoverPending}
                aria-expanded={menuOpen}
                aria-controls="judge-more-menu"
                id="judge-more-trigger"
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

      <p className="visually-hidden" data-testid="judge-score-announcement" aria-live="polite" aria-atomic="true">
        {!isSetup ? `${sideDisplayName(match, "A")}: ${match.scoreA}. ${sideDisplayName(match, "B")}: ${match.scoreB}.${serve ? ` Подаёт ${sideDisplayName(match, serve)}.` : ""}` : ""}
      </p>

      <p className="judge-screen__context-tip" role="note" aria-label="Подсказка судье">
        Только активный судья этой сессии меняет счёт. Undo отменяет последнее действующее очко.
      </p>

      {scoreRecoveryVisible ? (
        <section
          className="judge-screen__hint stack"
          role="region"
          aria-label="Восстановление счёта"
          ref={recoveryRegionRef}
          tabIndex={-1}
        >
          <h2>Проверьте изменения счёта</h2>
          {recoveryStorageError ? (
            <p role="alert">{recoveryStorageError} Изменение счёта заблокировано.</p>
          ) : !recoveryRecord?.storageSafe ? (
            <p role="alert">
              Изменение сохранено только в этой вкладке и не отправляется, пока сохранение не подтверждено. Не перезагружайте вкладку: несохранённые сведения могут быть потеряны.
            </p>
          ) : recoveryRecord.readState === "checking" ? (
            <p role="status">Проверяем сохранённые изменения по данным матча…</p>
          ) : recoveryRecord.readState === "failed" ? (
            <p role="alert">Не удалось проверить результат отправки. Повторная отправка заблокирована.</p>
          ) : recoveryRecord.correctionAttempts.some((attempt) => attempt.state === "unknown") ? (
            <p role="status">
              Сервер не подтвердил, была ли сохранена отправленная коррекция. Текущий счёт не определяет исход этой попытки.
            </p>
          ) : recoveryRecord.attempts.some((attempt) => attempt.state === "unknown") ? (
            <p role="status">
              Сервер не подтвердил, было ли начислено отправленное очко. Показанный счёт сам по себе не определяет исход.
            </p>
          ) : recoveryRecord.attempts.some((attempt) => attempt.state === "accepted-no-key") ||
            recoveryRecord.correctionAttempts.some((attempt) => attempt.state === "accepted-no-key") ? (
            <p role="status">
              Показанный счёт принят. Следующее изменение требует отдельного явного действия.
            </p>
          ) : recoveryRecord.unsent.length > 0 ? (
            <p role="status">
              Предыдущее начисление подтверждено. Осталось нажатий: {recoveryRecord.unsent.length}.
            </p>
          ) : null}
          {recoveryRecord?.attempts.length ? (
            <div>
              <p>Отправленные очки:</p>
              <ul>
                {recoveryRecord.attempts.map((attempt) => (
                  <li key={attempt.id}>
                    {sideDisplayName(match, attempt.side)} — {attempt.state === "sending"
                      ? "отправляется"
                      : attempt.state === "accepted-no-key"
                        ? "принят показанный счёт"
                        : "исход неизвестен"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {recoveryRecord?.unsent.length ? (
            <p>
              Не отправлено: {recoveryRecord.unsent.length}. Сторона A: {recoveryRecord.unsent.filter((intent) => intent.side === "A").length}; сторона B: {recoveryRecord.unsent.filter((intent) => intent.side === "B").length}.
            </p>
          ) : null}
          {recoveryRecord?.correctionAttempts.length ? (
            <div>
              <p>Коррекции:</p>
              <ul>
                {recoveryRecord.correctionAttempts.map((attempt) => (
                  <li key={attempt.id}>
                    Отправляли {attempt.scoreA}:{attempt.scoreB}; подаёт {(() => {
                      const participant = (match.participants ?? []).find(
                        (candidate) => candidate.id === attempt.currentServerParticipantId,
                      );
                      return participant ? participantDisplayName(participant) : "не определён";
                    })()} — {attempt.state === "unsent"
                      ? "не отправлена"
                      : attempt.state === "sending"
                        ? "отправляется"
                        : attempt.state === "accepted-no-key"
                          ? "принят показанный счёт"
                          : "исход неизвестен"}
                  </li>
                ))}
              </ul>
              <p>
                На сервере сейчас {String(match.scoreA)}:{String(match.scoreB)}; подаёт {(() => {
                  const participant = (match.participants ?? []).find(
                    (candidate) => candidate.id === String(match.currentServerParticipantId ?? ""),
                  );
                  return participant ? participantDisplayName(participant) : "не определён";
                })()}.
              </p>
            </div>
          ) : null}
          {readonly ? (
            <p>Матч доступен только для просмотра. Сохранённые сведения остаются для проверки.</p>
          ) : lostLock ? (
            <p>Сохранённые сведения доступны для проверки, но изменение счёта требует заново занять слот судьи.</p>
          ) : null}
          {acceptRecoverySnapshot ? (
            <section className="stack" role="region" aria-label="Подтверждение показанного счёта">
              <h3>Подтвердите показанный счёт</h3>
              <p>
                {acceptRecoverySnapshot.sideA}: {acceptRecoverySnapshot.scoreA}. {acceptRecoverySnapshot.sideB}: {acceptRecoverySnapshot.scoreB}.
              </p>
              <p>Подаёт: {acceptRecoverySnapshot.serverName}.</p>
              <div className="stack">
                <Button onClick={confirmCurrentScoreAcceptance}>Подтвердить показанный счёт</Button>
                <Button variant="secondary" onClick={() => setAcceptRecoverySnapshot(null)}>
                  Отменить принятие
                </Button>
              </div>
            </section>
          ) : null}
          {acceptCorrectionSnapshot ? (
            <section className="stack" role="region" aria-label="Подтверждение счёта после коррекции">
              <h3>Подтвердите показанный счёт</h3>
              <p>
                {acceptCorrectionSnapshot.sideA}: {acceptCorrectionSnapshot.snapshot.scoreA}. {acceptCorrectionSnapshot.sideB}: {acceptCorrectionSnapshot.snapshot.scoreB}.
              </p>
              <p>Подаёт: {acceptCorrectionSnapshot.serverName}.</p>
              <div className="stack">
                <Button onClick={confirmCurrentCorrectionAcceptance}>Подтвердить показанный счёт</Button>
                <Button variant="secondary" onClick={() => setAcceptCorrectionSnapshot(null)}>
                  Отменить принятие
                </Button>
              </div>
            </section>
          ) : null}
          <div className="stack">
            <Button variant="secondary" onClick={() => void recheckScoreRecovery()}>
              {recoveryRecord?.storageSafe === false ? "Повторить сохранение" : "Проверить состояние"}
            </Button>
            {recoveryRecord?.readState === "no-key" &&
            recoveryRecord.attempts.some((attempt) => attempt.state === "unknown") &&
            !acceptRecoverySnapshot ? (
              <Button variant="secondary" onClick={acceptCurrentScore}>
                Принять показанный счёт
              </Button>
            ) : null}
            {recoveryRecord?.readState === "no-key" &&
            unknownCorrectionAttempt &&
            !acceptCorrectionSnapshot ? (
              <Button
                variant="secondary"
                onClick={() => acceptCurrentCorrectionScore(unknownCorrectionAttempt.id)}
              >
                Принять показанный счёт после коррекции
              </Button>
            ) : null}
            {recoveryRecord?.attempts.some((attempt) => attempt.state === "accepted-no-key") &&
            !lostLock &&
            !readonly ? (
              <>
                <Button onClick={() => sendReviewedFencePoint("A")}>
                  Добавить новое очко: {sideDisplayName(match, "A")}
                </Button>
                <Button onClick={() => sendReviewedFencePoint("B")}>
                  Добавить новое очко: {sideDisplayName(match, "B")}
                </Button>
              </>
            ) : null}
            {acceptedCorrectionSource && !lostLock && !readonly ? (
              <Button onClick={() => openReviewedCorrection(acceptedCorrectionSource)}>
                Задать другой счёт
              </Button>
            ) : null}
            {recoveryRecord?.unsent.length &&
            recoveryRecord.attempts.length === 0 &&
            recoveryRecord.correctionAttempts.length === 0 &&
            recoveryRecord.storageSafe &&
            !lostLock &&
            !readonly ? (
              <Button onClick={continueQueuedPoints}>Отправить оставшиеся нажатия</Button>
            ) : null}
            {recoveryRecord?.unsent.length ? (
              <Button variant="secondary" onClick={discardQueuedPoints}>
                {discardRecoveryConfirm ? "Подтвердить: не отправлять" : "Не отправлять оставшиеся"}
              </Button>
            ) : null}
            {recoveryRecord?.correctionAttempts
              .filter((attempt) => attempt.state === "unsent")
              .map((attempt) => (
                <Button
                  key={attempt.id}
                  variant="secondary"
                  onClick={() => discardUnsentCorrectionIntent(attempt.id)}
                >
                  Не отправлять сохранённую коррекцию
                </Button>
              ))}
          </div>
        </section>
      ) : null}

      {isSetup ? (
        <div className="judge-screen__hint stack">
          {awaitingCreator ? (
            <p role="status" aria-label="Ожидаем запуска">
              Подготовка сохранена. Ожидаем запуска создателем матча…
            </p>
          ) : <p>
            {match.firstServerMethod === "random"
              ? "Первая подача будет выбрана случайно при старте. ↔ меняет стороны стола."
              : match.firstServerMethod === "rally"
                ? "Выберите победителя розыгрыша за первую подачу. ↔ меняет стороны стола."
                : "Выберите, кто подаёт первым. ↔ меняет стороны стола."}
          </p>}
          {!awaitingCreator && match.firstServerMethod !== "random" ? (
            <fieldset className="judge-server-picker" disabled={setupPending || setupUnknown}>
              <legend>Первая подача</legend>
              {((boardMatch.participants ?? []) as JudgeParticipant[]).map((participant) => (
                <label key={participant.id}>
                  <input
                    type="radio"
                    name="first-server"
                    checked={firstServerId === participant.id}
                    onChange={() => { if (!setupPendingRef.current && !setupUnknownRef.current) setFirstServerId(participant.id); }}
                  />
                  {participantDisplayName(participant)} · сторона {participant.side}
                </label>
              ))}
            </fieldset>
          ) : null}
        </div>
      ) : null}

      {menuOpen && !readonly && !lostLock && !isSetup ? (
        <div
          id="judge-more-menu"
          className="judge-more"
          role="group"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault(); setMenuOpen(false);
              document.getElementById("judge-more-trigger")?.focus();
            }
          }}
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
          <Button
            id="judge-correction-trigger"
            variant="secondary"
            className="judge-touch"
            onClick={openCorrection}
            disabled={locked || handoverPending}
          >
            Исправить счёт и подачу
          </Button>
          <div className="judge-handover stack" aria-busy={directoryState === "loading"}>
            <label htmlFor="judge-handover-user">Передать судейство</label>
            <select
              id="judge-handover-user"
              value={handoverUserId}
              disabled={directoryState !== "ready"}
              aria-busy={directoryState === "loading"}
              aria-describedby={directoryState === "error" ? "judge-handover-error" : undefined}
              onChange={(event) => setHandoverUserId(event.target.value)}
            >
              <option value="">Выберите пользователя</option>
              {directoryUsers.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>
              ))}
            </select>
            {directoryState === "loading" ? <p role="status" aria-live="polite">Загружаем пользователей…</p> : null}
            {directoryState === "ready" && directoryUsers.length === 0 ? <p role="status" aria-live="polite">Некому передать</p> : null}
            {directoryState === "error" ? (
              <>
                <p id="judge-handover-error" role="alert">Не удалось загрузить пользователей</p>
                <Button id="judge-handover-retry" variant="secondary" type="button" onClick={() => {
                  setFocusHandoverAfterRetry(true);
                  setDirectoryState("loading");
                  setDirectoryRequestVersion((version) => version + 1);
                }}>Повторить загрузку пользователей</Button>
              </>
            ) : null}
            <Button
              variant="secondary"
              className="judge-touch"
              disabled={directoryState !== "ready" || !handoverUserId || handoverPending || correctionOpen || correctionPending}
              onClick={() => void submitHandover()}
            >
              {handoverPending ? "Передаём…" : "Передать слот"}
            </Button>
          </div>
          {match.status === "pending_confirmation" ? (
            <>
              <Button
                className="judge-touch"
                disabled={
                  handoverPending ||
                  correctionPending ||
                  terminalPending ||
                  pointPendingCount > 0 ||
                  scoreRecoveryBlocked
                }
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
                disabled={
                  handoverPending ||
                  correctionPending ||
                  terminalPending ||
                  pointPendingCount > 0 ||
                  scoreRecoveryBlocked
                }
                onClick={() => void onRevertFinish()}
              >
                Продолжить игру
              </Button>
            </>
          ) : null}
          <Button
            variant="secondary"
            className="judge-touch"
            onClick={() => void releaseAndExit()}
            disabled={exitPending || scoreSendInFlight || correctionOpen || correctionPending || handoverPending}
          >
            {exitPending ? "Освобождаем…" : "Освободить слот и выйти"}
          </Button>
        </div>
      ) : null}

      {correctionOpen && !readonly && !lostLock ? (
        <section
          className="judge-correction stack"
          aria-label="Ручная коррекция"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !correctionPending) {
              event.preventDefault();
              closeCorrection();
            }
          }}
        >
          <h2 ref={correctionHeadingRef} tabIndex={-1}>Ручная коррекция</h2>
          <p>Изменение фиксируется как техническое событие и не становится игровым очком.</p>
          {correctionPriorAttempt ? (
            <p>
              Ранее отправляли {correctionPriorAttempt.scoreA}:{correctionPriorAttempt.scoreB}. Новая форма заполнена показанными сервером значениями.
            </p>
          ) : null}
          {correctionError ? (
            <p ref={correctionErrorRef} tabIndex={-1} role="alert">{correctionError}</p>
          ) : null}
          <label className="judge-correction__label" htmlFor={correctionScoreAId}>Счёт стороны A</label>
          <TextField
            id={correctionScoreAId}
            type="number"
            min={0}
            value={String(correctionScoreA)}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCorrectionScoreA(Number(event.target.value))}
          />
          <label className="judge-correction__label" htmlFor={correctionScoreBId}>Счёт стороны B</label>
          <TextField
            id={correctionScoreBId}
            type="number"
            min={0}
            value={String(correctionScoreB)}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCorrectionScoreB(Number(event.target.value))}
          />
          <label htmlFor="correction-server">Текущий подающий</label>
          <select
            id="correction-server"
            value={correctionServerId}
            onChange={(event) => setCorrectionServerId(event.target.value)}
          >
            {((match.participants ?? []) as JudgeParticipant[]).map((participant) => (
              <option key={participant.id} value={participant.id}>{participantDisplayName(participant)}</option>
            ))}
          </select>
          <div className="row">
            <Button disabled={correctionPending || !correctionServerId} onClick={() => void submitCorrection()}>
              {correctionPending ? "Сохраняем…" : "Сохранить коррекцию"}
            </Button>
            <Button variant="secondary" disabled={correctionPending} onClick={closeCorrection}>Отмена</Button>
          </div>
        </section>
      ) : null}

      {correctionAnnouncement ? (
        <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          {correctionAnnouncement}
        </p>
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
        {isSetup && !awaitingCreator ? (
          <Button
            variant="secondary"
            className="judge-touch judge-setup__swap-btn"
            aria-label="Поменять стороны"
            disabled={setupPending || setupUnknown}
            onClick={() => { if (!setupPendingRef.current && !setupUnknownRef.current) setSwapSides((v) => !v); }}
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
            disabled={
              setupPending ||
              setupUnknown ||
              awaitingCreator ||
              (match.firstServerMethod !== "random" && !firstServerId)
            }
            onClick={() => void confirmSetup()}
          >
            {setupPending
              ? "Сохранение…"
              : awaitingCreator
                ? "Ожидаем запуска"
                : activeJudgeCanStart(match)
                  ? "Начать матч"
                  : "Сохранить подготовку"}
          </Button>
        </div>
      ) : null}

      {match.status === "pending_confirmation" &&
      !menuOpen &&
      !readonly &&
      !isSetup ? (
        <div className="judge-confirm-bar">
          <Button
            className="judge-touch"
            disabled={
              handoverPending ||
              correctionPending ||
              terminalPending ||
              pointPendingCount > 0
            }
            onClick={() => void onConfirmFinish()}
          >
            Подтвердить результат
          </Button>
          <Button
            variant="secondary"
            className="judge-touch"
            disabled={
              handoverPending ||
              correctionPending ||
              terminalPending ||
              pointPendingCount > 0
            }
            onClick={() => void onRevertFinish()}
          >
            Продолжить
          </Button>
        </div>
      ) : null}
    </div>
  );
}
