import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, Avatar, Dialog, TextField } from "../ui";
import { api } from "../api";
import { TableTennisRacketIcon } from "../icons/TableTennisRacketIcon";
import {
  boardSides,
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
import {
  acceptMatchFacts,
  freezeMatchFacts,
  monotonicNow,
  playingClockView,
  type MatchFactsSnapshot,
} from "../matchFactsUi";
import {
  useJudgeNavigationController,
  type JudgeBlockedPop,
  type JudgeExitNotice,
} from "../judgeNavigation";
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
import "./JudgePage.css";

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
const SCORE_POINTER_MOVE_THRESHOLD = 8;
const JUDGE_EXIT_NETWORK_DEADLINE_MS = 10_000;

type JudgeOwnership = "none" | "pending" | "possible" | "owned";
type ExitIntent = { token: symbol; kind: "explicit" | "native" };

type SettledRequest<T> =
  | { outcome: "success"; value: T }
  | { outcome: "failure"; error: unknown }
  | { outcome: "timeout" };

function settleRequest<T>(promise: Promise<T>): Promise<SettledRequest<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ outcome: "timeout" });
    }, JUDGE_EXIT_NETWORK_DEADLINE_MS);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve({ outcome: "success", value });
      },
      (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve({ outcome: "failure", error });
      },
    );
  });
}

type ScorePointerGesture = {
  side: "A" | "B";
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
};

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

function needsAuthoritativeSetup(match: MatchState): boolean {
  const initialServerState = (
    match.matchFacts as MatchFactsSnapshot["facts"] | undefined
  )?.initialServer.state;
  const atomicLaunchAlreadyStarted =
    match.status === "in_progress" && initialServerState === "known";
  return !atomicLaunchAlreadyStarted && needsJudgeSetup(match);
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
  const [factsSnapshot, setFactsSnapshot] = useState<MatchFactsSnapshot | null>(null);
  const factsSnapshotRef = useRef<MatchFactsSnapshot | null>(null);
  const factsRefreshNeededRef = useRef(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const pointRecoveryErrorRef = useRef<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const returnFocusToMoreRef = useRef(false);
  const [rotationHintDismissed, setRotationHintDismissed] = useState(false);
  const [flashSide, setFlashSide] = useState<"A" | "B" | null>(null);
  const [undoPending, setUndoPending] = useState(false);
  const [pointPendingCount, setPointPendingCount] = useState(0);
  const pointQueueRef = useRef<PointIntent[]>([]);
  const pointQueueOwnerRef = useRef<symbol | null>(null);
  const [pointDrainActive, setPointDrainActive] = useState(false);
  const recoveryRecordRef = useRef<ScoreRecoveryRecord | null>(null);
  const recoveryGenerationRef = useRef(0);
  const loadPromiseRef = useRef<Promise<MatchState> | null>(null);
  const matchMutationGenerationRef = useRef(0);
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
  const judgeOwnershipRef = useRef<JudgeOwnership>("none");
  const [judgeOwnership, setJudgeOwnershipState] = useState<JudgeOwnership>("none");
  const liveSyncOwnerRef = useRef<symbol | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const scorePointerGestureRef = useRef<ScorePointerGesture | null>(null);
  const suppressScoreClickRef = useRef(false);
  const exitPendingRef = useRef(false);
  const exitIntentRef = useRef<ExitIntent | null>(null);
  const exitSettlementRef = useRef<Promise<JudgeExitNotice> | null>(null);
  const nativeBlockedPopRef = useRef<JudgeBlockedPop | null>(null);
  const competingBlockedPopRef = useRef<JudgeBlockedPop | null>(null);
  const nativeSettlementRef = useRef(false);
  const exclusiveMutationRef = useRef(false);
  const flashTimeoutRef = useRef<number | null>(null);
  const [exitPending, setExitPending] = useState(false);
  const [nativeBackPending, setNativeBackPending] = useState(false);
  const [nativeBackDeadlineExpired, setNativeBackDeadlineExpired] = useState(false);
  const [nativeBackMessage, setNativeBackMessage] = useState<string | null>(null);
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  const [factsNow, setFactsNow] = useState(monotonicNow);
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
  const displayFlipOwnerRef = useRef<symbol | null>(null);
  const [displayFlipPending, setDisplayFlipPending] = useState(false);
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
  const correctionHeadingRef = useRef<HTMLSpanElement | null>(null);
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

  const setJudgeOwnership = useCallback((next: JudgeOwnership) => {
    judgeOwnershipRef.current = next;
    judgeLockOwnedRef.current = next === "owned";
    setJudgeOwnershipState(next);
  }, []);

  const applyFreshFacts = useCallback((nextMatch: MatchState) => {
    const next = acceptMatchFacts(
      factsSnapshotRef.current,
      nextMatch.matchFacts as MatchFactsSnapshot["facts"] | undefined,
      Number(nextMatch.version ?? -1),
      String(nextMatch.status ?? "unknown"),
    );
    factsSnapshotRef.current = next;
    factsRefreshNeededRef.current = false;
    setFactsSnapshot(next);
    setFactsNow(next.receivedAtPerformanceMs);
  }, []);

  const beginMatchMutation = useCallback(() => {
    matchMutationGenerationRef.current += 1;
  }, []);

  const freezeFactsForMutation = useCallback(() => {
    beginMatchMutation();
    const next = freezeMatchFacts(factsSnapshotRef.current);
    factsSnapshotRef.current = next;
    factsRefreshNeededRef.current = true;
    setFactsSnapshot(next);
    if (next) setFactsNow(next.receivedAtPerformanceMs);
  }, [beginMatchMutation]);

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
    setJudgeOwnership("none");
    liveSyncOwnerRef.current = null;
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
      nativeBlockedPopRef.current = null;
      competingBlockedPopRef.current = null;
      exitIntentRef.current = null;
      exitSettlementRef.current = null;
      exitPendingRef.current = false;
      loadPromiseRef.current = null;
      liveSyncOwnerRef.current = null;
      factsSnapshotRef.current = null;
      factsRefreshNeededRef.current = false;
      if (displayFlipOwnerRef.current !== null) {
        displayFlipOwnerRef.current = null;
        exclusiveMutationRef.current = false;
        setDisplayFlipPending(false);
      }
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
  }, [actorUserId, applyRecoveryRecord, id, setJudgeOwnership]);

  useEffect(() => {
    setRotationHintDismissed(false);
  }, [id]);

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
    const mutationGeneration = matchMutationGenerationRef.current;
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
        if (mutationGeneration !== matchMutationGenerationRef.current) {
          return matchRef.current ?? fresh;
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
        applyFreshFacts(fresh);
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
  }, [actorUserId, applyFreshFacts, applyRecoveryRecord, id, saveRecoveryRecord, updateMatch]);

  useEffect(() => {
    confirmedStartRef.current = null;
    setupUnknownRef.current = false;
    setSetupUnknown(false);
    setupPendingRef.current = false;
    setSetupPending(false);
  }, [id]);

  useEffect(() => {
    correctionOpenRef.current = correctionOpen;
    if (correctionOpen) {
      const heading = correctionHeadingRef.current?.closest("h2");
      if (heading instanceof HTMLElement) {
        heading.tabIndex = -1;
        heading.focus();
      }
    }
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

  useEffect(() => {
    if (menuOpen || !returnFocusToMoreRef.current) return;
    returnFocusToMoreRef.current = false;
    document.getElementById("judge-more-trigger")?.focus();
  }, [menuOpen]);

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
      if (!id || !actorUserId) return;
      const requestedId = id;
      const generation = recoveryGenerationRef.current;
      if (
        currentMatchIdRef.current !== requestedId ||
        !isScoreRecoveryGenerationCurrent(actorUserId, requestedId, generation)
      ) return;
      setJudgeOwnership("none");
      pointQueueRef.current = [];
      setPointPendingCount(0);
      setUndoPending(false);
      setMenuOpen(false);
      setPhase("lost_lock");
      setError(lostJudgeMessage(error));
      try {
        const fresh = await load(true);
        if (
          currentMatchIdRef.current !== requestedId ||
          !isScoreRecoveryGenerationCurrent(actorUserId, requestedId, generation)
        ) return;
        if (isTerminalMatchStatus(fresh.status)) {
          setPhase("readonly");
          setError(null);
        }
      } catch {
        // Preserve the last authoritative screen when read access is also gone.
      }
    },
    [actorUserId, id, load, setJudgeOwnership],
  );

  const syncLiveState = useCallback(
    async (ownsLock: boolean) => {
      if (!id || !actorUserId || liveSyncOwnerRef.current) return;
      const requestedId = id;
      const generation = recoveryGenerationRef.current;
      const syncOwner = Symbol("judge-live-sync");
      liveSyncOwnerRef.current = syncOwner;
      const isCurrent = () =>
        currentMatchIdRef.current === requestedId &&
        isScoreRecoveryGenerationCurrent(actorUserId, requestedId, generation);
      try {
        if (ownsLock) await api.heartbeatJudge(requestedId);
        if (!isCurrent()) return;
        const fresh = await load();
        if (!isCurrent()) return;
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
          setJudgeOwnership("none");
          pointQueueRef.current = [];
          setPointPendingCount(0);
          setMenuOpen(false);
          setPhase("readonly");
          setError(null);
        }
      } catch (error) {
        if (!isCurrent()) return;
        if (ownsLock && isLostJudgeError(error, true)) {
          await loseJudgeLock(error);
        } else {
          setError(
            `Не удалось обновить состояние матча: ${(error as Error).message}`,
          );
        }
      } finally {
        if (liveSyncOwnerRef.current === syncOwner) {
          liveSyncOwnerRef.current = null;
        }
      }
    },
    [actorUserId, id, load, loseJudgeLock, setJudgeOwnership],
  );

  const initJudge = useCallback(async () => {
    if (!id || !actorUserId) return;
    const requestedId = id;
    const generation = recoveryGenerationRef.current;
    const isCurrent = () =>
      currentMatchIdRef.current === requestedId &&
      isScoreRecoveryGenerationCurrent(actorUserId, requestedId, generation);
    if (!isCurrent()) return;
    setJudgeOwnership("none");
    setPhase("loading");
    setError(null);
    try {
      let acquiredDuringFallback = false;
      let detail: MatchState;
      try {
        detail = await load();
        if (!isCurrent()) return;
      } catch (loadError) {
        if (!isCurrent()) return;
        if (readonlyMode || (loadError as ApiError).status !== 403) {
          throw loadError;
        }
        if (!isCurrent()) return;
        freezeFactsForMutation();
        setJudgeOwnership("pending");
        await api.acquireJudge(requestedId);
        if (!isCurrent()) return;
        acquiredDuringFallback = true;
        setJudgeOwnership("owned");
        detail = await load();
        if (!isCurrent()) return;
      }
      if (!isCurrent()) return;
      const status = String(detail.status ?? "");
      if (
        readonlyMode ||
        isTerminalMatchStatus(status)
      ) {
        setJudgeOwnership("none");
        setPhase("readonly");
        return;
      }
      if (!acquiredDuringFallback) {
        if (!isCurrent()) return;
        freezeFactsForMutation();
        setJudgeOwnership("pending");
        await api.acquireJudge(requestedId);
        if (!isCurrent()) return;
        setJudgeOwnership("owned");
      }
      if (!isCurrent()) return;
      const refreshed = acquiredDuringFallback ? detail : await load();
      if (!isCurrent()) return;
      if (needsAuthoritativeSetup(refreshed)) {
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
      if (!isCurrent()) return;
      if (judgeOwnershipRef.current === "pending") {
        const candidate = e as ApiError;
        const definitive = Boolean(
          candidate.status && candidate.status >= 400 && candidate.status < 500 &&
          candidate.status !== 408 && candidate.status !== 429,
        );
        setJudgeOwnership(definitive ? "none" : "possible");
      }
      const err = e as Error & {
        code?: string;
        details?: { currentJudge?: { userId?: string; displayName: string } };
      };
      setError(judgeAcquireErrorMessage(err));
      setPhase("blocked");
    }
  }, [actorUserId, freezeFactsForMutation, id, load, readonlyMode, setJudgeOwnership]);

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
    document.getElementById(directoryState === "ready" ? "judge-handover-user" : "judge-handover-retry")?.focus();
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
    const clock = factsSnapshot?.facts.playingClock;
    if (
      (phase !== "scoring" && phase !== "readonly") ||
      factsSnapshot?.certainty !== "fresh" ||
      clock?.state !== "available" ||
      !clock.running
    ) return;
    const tick = window.setInterval(() => setFactsNow(monotonicNow()), 1000);
    return () => window.clearInterval(tick);
  }, [factsSnapshot, phase]);

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
    if (!id || !match || exitPendingRef.current || setupPendingRef.current || setupUnknownRef.current) return;
    const method = String(match.firstServerMethod ?? "manual");
    if (method !== "random" && !firstServerId) return;
    const requestedId = id;
    const attempt = { firstServerParticipantId: firstServerId, swapSides };
    setupPendingRef.current = true;
    setSetupPending(true);
    setError(null);
    freezeFactsForMutation();
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
        if (factsRefreshNeededRef.current) void load(true).catch(() => undefined);
      }
    }
  }

  async function drainPointQueue(initialMatch: MatchState, fenceVersion?: number) {
    if (!id || pointQueueOwnerRef.current) return;
    const owner = Symbol("point-queue-owner");
    pointQueueOwnerRef.current = owner;
    setPointDrainActive(true);
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
      if (pointQueueOwnerRef.current === owner) {
        pointQueueOwnerRef.current = null;
        if (isScoreRecoveryGenerationCurrent(actorUserId, id, generation)) {
          setPointDrainActive(false);
        }
      }
      if (
        factsRefreshNeededRef.current &&
        isScoreRecoveryGenerationCurrent(actorUserId, id, generation)
      ) {
        void load(true).catch(() => undefined);
      }
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
      exitPendingRef.current ||
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
    freezeFactsForMutation();
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
    freezeFactsForMutation();
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
      if (factsRefreshNeededRef.current) void load(true).catch(() => undefined);
    }
  }

  function claimExitIntent(kind: ExitIntent["kind"]): ExitIntent | null {
    if (exitIntentRef.current) return null;
    const intent = { token: Symbol(`judge-${kind}-exit`), kind } as const;
    exitIntentRef.current = intent;
    exitPendingRef.current = true;
    setExitPending(true);
    return intent;
  }

  function clearExitIntent(intent: ExitIntent) {
    if (exitIntentRef.current?.token !== intent.token) return;
    exitIntentRef.current = null;
    exitPendingRef.current = false;
    exitSettlementRef.current = null;
    nativeSettlementRef.current = false;
    nativeBlockedPopRef.current = null;
    competingBlockedPopRef.current = null;
    setExitPending(false);
    setNativeBackPending(false);
    setNativeBackDeadlineExpired(false);
  }

  function settleJudgeExit(): Promise<JudgeExitNotice> {
    if (exitSettlementRef.current) return exitSettlementRef.current;
    const request = (async (): Promise<JudgeExitNotice> => {
      const ownership = judgeOwnershipRef.current;
      if (ownership === "owned" || ownership === "pending" || ownership === "possible") {
        const ownershipWasConfirmed = ownership === "owned";
        beginMatchMutation();
        const settled = await settleRequest(
          Promise.resolve().then(() => api.releaseJudge(id!)),
        );
        setJudgeOwnership("none");
        if (settled.outcome === "success" && ownershipWasConfirmed) {
          return {
            kind: "success",
            message: "Вы вышли из ведения. Другой пользователь может продолжить",
          };
        }
        return {
          kind: "warning",
          message: "Не удалось проверить выход из ведения. Проверьте текущее состояние матча",
        };
      }
      return {
        kind: "warning",
        message: "Ведение на этом устройстве уже не активно. Проверьте текущее состояние матча",
      };
    })();
    exitSettlementRef.current = request;
    return request;
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
    const intent = claimExitIntent("explicit");
    if (!intent) return;
    const notice = await settleJudgeExit();
    competingBlockedPopRef.current?.reset();
    clearExitIntent(intent);
    exitAfterJudge(matchRef.current ?? match, notice, destination);
  }

  useJudgeNavigationController({
    shouldBlock: ({ action, currentPath, nextPath }) => {
      if (action !== "POP" || !id) return false;
      const currentWithoutHash = currentPath.split("#", 1)[0];
      const nextWithoutHash = nextPath.split("#", 1)[0];
      return (
        currentWithoutHash.startsWith(`/matches/${id}/judge`) &&
        currentWithoutHash !== nextWithoutHash
      );
    },
    onBlocked: (blocked) => {
      const activeIntent = exitIntentRef.current;
      if (activeIntent?.kind === "explicit") {
        competingBlockedPopRef.current = blocked;
        return;
      }
      if (activeIntent) {
        blocked.reset();
        return;
      }
      const intent = claimExitIntent("native");
      if (!intent) {
        blocked.reset();
        return;
      }
      nativeBlockedPopRef.current = blocked;
      setNativeBackMessage(null);
      setNativeBackDeadlineExpired(false);
      setNativeBackPending(true);
    },
  });

  useEffect(() => {
    if (
      !nativeBackPending ||
      nativeBackDeadlineExpired ||
      (phase !== "loading" && judgeOwnership !== "pending")
    ) return;
    const timer = window.setTimeout(
      () => setNativeBackDeadlineExpired(true),
      JUDGE_EXIT_NETWORK_DEADLINE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [judgeOwnership, nativeBackDeadlineExpired, nativeBackPending, phase]);

  useEffect(() => {
    if (!nativeBackPending || nativeSettlementRef.current) return;
    const blocked = nativeBlockedPopRef.current;
    const intent = exitIntentRef.current;
    if (!blocked || !intent || intent.kind !== "native") return;

    const recoveryUnsafe = Boolean(
      recoveryStorageError ||
      (recoveryRecord && !recoveryRecord.storageSafe && hasRecoveryWork(recoveryRecord)),
    );
    const cancelBlockedPop = (message: string) => {
      blocked.reset();
      setNativeBackMessage(message);
      clearExitIntent(intent);
    };

    if (recoveryUnsafe) {
      cancelBlockedPop(
        "Не удалось безопасно сохранить восстановление счёта. Проверьте состояние и повторите выход после сохранения.",
      );
      return;
    }
    if (correctionOpen) {
      cancelBlockedPop(
        "Сначала сохраните или закройте коррекцию, затем повторите переход назад.",
      );
      return;
    }
    if (match?.status === "pending_confirmation" && !terminalPending) {
      cancelBlockedPop(
        "Сначала подтвердите результат или продолжите матч, затем повторите переход назад.",
      );
      return;
    }
    if (
      ((phase === "loading" || judgeOwnership === "pending") &&
        !nativeBackDeadlineExpired) ||
      setupPending ||
      undoPending ||
      correctionPending ||
      displayFlipPending ||
      handoverPending ||
      terminalPending ||
      pointDrainActive ||
      exclusiveMutationRef.current
    ) return;

    nativeSettlementRef.current = true;
    const ownership = judgeOwnershipRef.current;
    if (
      ownership === "none" ||
      phase === "lost_lock" ||
      phase === "readonly"
    ) {
      clearExitIntent(intent);
      blocked.proceed();
      return;
    }
    void settleJudgeExit().then((notice) => {
      if (exitIntentRef.current?.token !== intent.token) return;
      clearExitIntent(intent);
      blocked.proceed(notice);
    });
  }, [
    correctionOpen,
    correctionPending,
    displayFlipPending,
    handoverPending,
    judgeOwnership,
    match?.status,
    nativeBackDeadlineExpired,
    nativeBackPending,
    phase,
    pointDrainActive,
    recoveryRecord,
    recoveryStorageError,
    setupPending,
    terminalPending,
    undoPending,
  ]);

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
    freezeFactsForMutation();
    try {
      const res = await api.confirmFinish(id);
      const finished = (res.match ?? match) as MatchState;
      setJudgeOwnership("none");
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
      if (factsRefreshNeededRef.current) void load(true).catch(() => undefined);
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
    freezeFactsForMutation();
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
      if (factsRefreshNeededRef.current) void load(true).catch(() => undefined);
    }
  }

  async function toggleDisplayFlip() {
    if (
      !id ||
      !match ||
      exitPendingRef.current ||
      displayFlipOwnerRef.current !== null ||
      exclusiveMutationRef.current
    ) return;
    const owner = Symbol("judge-display-flip");
    displayFlipOwnerRef.current = owner;
    exclusiveMutationRef.current = true;
    setDisplayFlipPending(true);
    const next = !match.judgeDisplayFlipped;
    freezeFactsForMutation();
    try {
      const res = await api.judgeSetup(id, { displayFlipped: next });
      updateMatch(res.match as MatchState);
    } catch (e) {
      if (isLostJudgeError(e)) {
        await loseJudgeLock(e);
      } else {
        setError((e as Error).message);
      }
    } finally {
      if (displayFlipOwnerRef.current === owner) {
        displayFlipOwnerRef.current = null;
        exclusiveMutationRef.current = false;
        setDisplayFlipPending(false);
        if (factsRefreshNeededRef.current) void load(true).catch(() => undefined);
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
    freezeFactsForMutation();
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
        if (factsRefreshNeededRef.current) void load(true).catch(() => undefined);
      }
    }
  }

  async function submitHandover() {
    if (!id || !handoverUserId || handoverPending || exclusiveMutationRef.current) return;
    exclusiveMutationRef.current = true;
    setHandoverPending(true);
    setError(null);
    try {
      beginMatchMutation();
      const result = await api.handoverJudge(id, handoverUserId);
      setJudgeOwnership("none");
      exitAfterJudge(matchRef.current ?? match, {
        kind: "success",
        message: `Передача подготовлена для ${String(result.reservation.displayName ?? "назначенный пользователь")}. Получатель должен принять её и открыть ведение на своём устройстве`,
      });
    } catch (reason) {
      if (isLostJudgeError(reason)) await loseJudgeLock(reason);
      else {
        const stale = ["VERSION_CONFLICT", "MATCH_VERSION_CONFLICT"].includes(String((reason as ApiError).code));
        if (stale) await load(true).catch(() => undefined);
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

  useEffect(() => {
    if (match?.status !== "pending_confirmation") return;
    setMenuOpen(false);
    if (!correctionPending) setCorrectionOpen(false);
  }, [correctionPending, match?.status]);

  if (phase === "loading") {
    return (
      <div className="judge-screen judge-screen--loading">
        <p className="judge-screen__status" role="status">
          {nativeBackPending
            ? "Проверяем судейство перед выходом…"
            : "Подключение судьи…"}
        </p>
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
        {nativeBackPending ? (
          <p role="status">Проверяем судейство перед выходом…</p>
        ) : null}
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
  const setupInputLocked = setupPending || setupUnknown || exitPending;
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
    exitPending ||
    scoreRecoveryVisible ||
    match.status === "pending_confirmation" ||
    match.status === "finished" ||
    correctionOpen ||
    correctionPending ||
    displayFlipPending ||
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
  const rotateHintNeeded = shouldShowLandscapeHint(viewport.w, viewport.h);
  const showDismissibleHint =
    phase === "scoring" &&
    !rotationHintDismissed &&
    rotateHintNeeded;
  const showLegacyHint = phase !== "scoring" && rotateHintNeeded;
  const { left, right } = boardSides(boardMatch);
  const clockView = playingClockView(factsSnapshot, factsNow);
  const duration = clockView.state === "available"
    ? formatMatchDuration(clockView.elapsedMs)
    : "Время недоступно";

  function startScorePointer(side: "A" | "B", event: PointerEvent<HTMLButtonElement>) {
    suppressScoreClickRef.current = false;
    scorePointerGestureRef.current = {
      side,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  }

  function moveScorePointer(side: "A" | "B", event: PointerEvent<HTMLButtonElement>) {
    const gesture = scorePointerGestureRef.current;
    if (!gesture || gesture.side !== side || gesture.pointerId !== event.pointerId) return;
    const moved =
      Math.abs(event.clientX - gesture.startX) > SCORE_POINTER_MOVE_THRESHOLD ||
      Math.abs(event.clientY - gesture.startY) > SCORE_POINTER_MOVE_THRESHOLD;
    if (moved) {
      gesture.moved = true;
      suppressScoreClickRef.current = true;
    }
  }

  function finishScorePointer(side: "A" | "B", event: PointerEvent<HTMLButtonElement>) {
    const gesture = scorePointerGestureRef.current;
    if (!gesture || gesture.side !== side || gesture.pointerId !== event.pointerId) return;
    suppressScoreClickRef.current = gesture.moved;
    scorePointerGestureRef.current = null;
  }

  function cancelScorePointer(side: "A" | "B", event: PointerEvent<HTMLButtonElement>) {
    const gesture = scorePointerGestureRef.current;
    if (!gesture || gesture.side !== side || gesture.pointerId !== event.pointerId) return;
    suppressScoreClickRef.current = true;
    scorePointerGestureRef.current = null;
  }

  function activateScore(side: "A" | "B", event: MouseEvent<HTMLButtonElement>) {
    const suppressPointerClick = event.detail > 0 && suppressScoreClickRef.current;
    suppressScoreClickRef.current = false;
    scorePointerGestureRef.current = null;
    if (suppressPointerClick) return;
    void point(side);
  }

  function renderSide(side: "A" | "B", matchState: MatchState) {
    const label = sideDisplayName(boardMatch, side);
    const score = isSetup
      ? "0"
      : side === "A"
        ? String(matchState.scoreA)
        : String(matchState.scoreB);
    const serving = serve === side;
    const flash = !isSetup && flashSide === side;
    const sideClassName = [
      "judge-side",
      serving ? "judge-side--serving" : "",
      flash ? "judge-side--flash" : "",
      isSetup ? "judge-side--setup" : "",
      !isSetup && !readonly && !lostLock ? "judge-side--scoring" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const content = (
      <>
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
          <span className="judge-side__label">{label}</span>
        </span>
        <span className="judge-side__score">{score}</span>
        <ServeBadge active={Boolean(serving)} />
        {!isSetup && !readonly && !lostLock ? (
          <span className="judge-point-btn" aria-hidden="true">+1</span>
        ) : (
          <span className="judge-point-spacer" aria-hidden="true" />
        )}
      </>
    );

    if (!isSetup && !readonly && !lostLock) {
      return (
        <button
          key={side}
          type="button"
          className={sideClassName}
          data-testid={`judge-side-${side}`}
          disabled={locked}
          onPointerDown={(event) => startScorePointer(side, event)}
          onPointerMove={(event) => moveScorePointer(side, event)}
          onPointerUp={(event) => finishScorePointer(side, event)}
          onPointerCancel={(event) => cancelScorePointer(side, event)}
          onClick={(event) => activateScore(side, event)}
          aria-label={`+1 очко: ${label}. Счёт ${score}.${serving ? " Подаёт." : ""}`}
        >
          {content}
        </button>
      );
    }

    return (
      <div
        key={side}
        className={sideClassName}
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
        {content}
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
      {nativeBackPending ? (
        <p className="judge-screen__status" role="status" aria-live="polite">
          Завершаем текущее действие перед выходом…
        </p>
      ) : null}
      {nativeBackMessage ? (
        <p className="judge-screen__status" role="alert">
          {nativeBackMessage}
        </p>
      ) : null}
      {showDismissibleHint ? (
        <div className="judge-rotate-hint">
          <p role="status">Поверните устройство горизонтально для удобного судейства</p>
          <button
            type="button"
            className="judge-rotate-hint__close"
            aria-label="Закрыть подсказку"
            onClick={() => {
              setRotationHintDismissed(true);
              boardRef.current?.focus();
            }}
          >
            ×
          </button>
        </div>
      ) : showLegacyHint ? (
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
                ? "Ведение недоступно"
              : statusLabel(String(match.status), "match")}
          </span>
          {!isSetup ? (
            <span className="judge-timer" aria-live="off">
              {duration}
            </span>
          ) : null}
          {!isSetup && clockView.certainty === "checking" ? (
            <span className="judge-clock-status" aria-live="polite">
              Проверяем время…
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
            disabled={exitPending || setupPending || undoPending || terminalPending || scoreSendInFlight || correctionOpen || correctionPending || displayFlipPending || handoverPending || match.status === "pending_confirmation"}
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
                disabled={exitPending || undoPending || terminalPending || scoreSendInFlight || correctionOpen || correctionPending || displayFlipPending || handoverPending || match.status === "pending_confirmation"}
              >
                {exitPending ? "Выходим…" : "Назад"}
              </Button>
              <Button
                variant="secondary"
                className="judge-touch"
                onClick={() => void undo()}
                disabled={locked || undoPending || pointPendingCount > 0}
                aria-label="Отменить последнее очко"
                aria-describedby="judge-undo-description"
              >
                Отменить очко
              </Button>
              <span id="judge-undo-description" className="visually-hidden">
                Отменяет последнее действующее очко. Ручную коррекцию не отменяет
              </span>
              <Button
                variant="secondary"
                className="judge-touch"
                onClick={() => setMenuOpen((v) => !v)}
                disabled={exitPending || scoreRecoveryVisible || undoPending || terminalPending || scoreSendInFlight || correctionOpen || correctionPending || displayFlipPending || handoverPending || match.status === "pending_confirmation"}
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
        Счёт меняет тот, кто сейчас ведёт игру на этом устройстве. Отмена снимает последнее действующее очко
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
        <Dialog
          open
          onClose={() => {
            returnFocusToMoreRef.current = true;
            setMenuOpen(false);
          }}
          title="Действия судьи"
          width="md"
          icon={false}
          className="judge-dialog"
        >
          <div
            id="judge-more-menu"
            className="judge-more"
            role="group"
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
            <p>Передаёте этот телефон? Можно продолжить без смены аккаунта. Записи останутся от текущего аккаунта. Для другого устройства выберите получателя</p>
            <label htmlFor="judge-handover-user">Передать ведение на другое устройство</label>
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
              disabled={directoryState !== "ready" || !handoverUserId || handoverPending || correctionOpen || correctionPending || displayFlipPending}
              onClick={() => void submitHandover()}
            >
              {handoverPending ? "Передаём…" : "Передать ведение"}
            </Button>
          </div>
          <Button
            variant="secondary"
            className="judge-touch"
            onClick={() => void releaseAndExit()}
            disabled={exitPending || scoreSendInFlight || correctionOpen || correctionPending || displayFlipPending || handoverPending}
          >
            {exitPending ? "Выходим…" : "Выйти из ведения"}
          </Button>
          </div>
        </Dialog>
      ) : null}

      {correctionOpen && !readonly && !lostLock ? (
        <Dialog
          open
          title={<span ref={correctionHeadingRef}>Ручная коррекция</span>}
          width="sm"
          icon={false}
          closeOnEscape={false}
          closeOnOverlayClick={false}
          className="judge-dialog"
          onKeyDownCapture={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === "Escape" && !correctionPending) {
              event.preventDefault();
              closeCorrection();
            }
          }}
        >
          <section className="judge-correction stack" aria-label="Ручная коррекция">
          <p>Коррекция меняет счёт и подачу. Она сохраняется отдельно от игровых очков</p>
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
            className="judge-correction__field"
            id={correctionScoreAId}
            type="number"
            min={0}
            value={String(correctionScoreA)}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCorrectionScoreA(Number(event.target.value))}
          />
          <label className="judge-correction__label" htmlFor={correctionScoreBId}>Счёт стороны B</label>
          <TextField
            className="judge-correction__field"
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
        </Dialog>
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
        ref={boardRef}
        tabIndex={-1}
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
      !correctionOpen &&
      !readonly &&
      !isSetup ? (
        <Dialog
          open
          title="Подтвердить результат?"
          width="sm"
          icon={false}
          closeOnEscape={false}
          closeOnOverlayClick={false}
          className="judge-dialog"
        >
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
        </Dialog>
      ) : null}
    </div>
  );
}
