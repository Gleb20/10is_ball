export type ScoreSide = "A" | "B";

export type PointIntent = {
  id: string;
  side: ScoreSide;
  idempotencyKey: string;
};

export type PointAttempt = PointIntent & {
  expectedVersion: number;
  state: "sending" | "unknown" | "accepted-no-key";
  reviewedVersion?: number;
  reviewedScoreA?: number;
  reviewedScoreB?: number;
  reviewedServerParticipantId?: string;
  fence?: boolean;
};

export type CorrectionAttempt = {
  id: string;
  idempotencyKey: string;
  expectedVersion: number;
  scoreA: number;
  scoreB: number;
  currentServerParticipantId: string;
  state: "unsent" | "sending" | "unknown" | "accepted-no-key";
  reviewedVersion?: number;
  reviewedScoreA?: number;
  reviewedScoreB?: number;
  reviewedServerParticipantId?: string;
  fence?: boolean;
};

export type ReviewedScoreSnapshot = {
  version: number;
  scoreA: number;
  scoreB: number;
  currentServerParticipantId: string;
};

export type ScoreRecoveryRecord = {
  schemaVersion: 1;
  actorUserId: string;
  matchId: string;
  serverVersion: number;
  attempts: PointAttempt[];
  unsent: PointIntent[];
  correctionAttempts: CorrectionAttempt[];
  pausedAfterError: boolean;
  storageSafe: boolean;
  readState: "idle" | "checking" | "failed" | "no-key" | "exact";
  reviewedVersion?: number;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const records = new Map<string, ScoreRecoveryRecord>();
const generations = new Map<string, number>();

function recordKey(actorUserId: string, matchId: string) {
  return `${actorUserId}\u0000${matchId}`;
}

function copyRecord(record: ScoreRecoveryRecord): ScoreRecoveryRecord {
  return {
    ...record,
    attempts: record.attempts.map((attempt) => ({ ...attempt })),
    unsent: record.unsent.map((intent) => ({ ...intent })),
    correctionAttempts: record.correctionAttempts.map((attempt) => ({ ...attempt })),
  };
}

export function scoreRecoveryStorageKey(actorUserId: string, matchId: string) {
  return `tab10:judge-score-recovery:v1:${encodeURIComponent(actorUserId)}:${encodeURIComponent(matchId)}`;
}

export function beginScoreRecoveryGeneration(actorUserId: string, matchId: string) {
  const key = recordKey(actorUserId, matchId);
  const generation = (generations.get(key) ?? 0) + 1;
  generations.set(key, generation);
  return generation;
}

export function isScoreRecoveryGenerationCurrent(
  actorUserId: string,
  matchId: string,
  generation: number,
) {
  return generations.get(recordKey(actorUserId, matchId)) === generation;
}

export function invalidateScoreRecoveryGeneration(actorUserId: string, matchId: string) {
  beginScoreRecoveryGeneration(actorUserId, matchId);
}

export function createScoreRecoveryRecord(
  actorUserId: string,
  matchId: string,
  serverVersion: number,
): ScoreRecoveryRecord {
  return {
    schemaVersion: 1,
    actorUserId,
    matchId,
    serverVersion,
    attempts: [],
    unsent: [],
    correctionAttempts: [],
    pausedAfterError: false,
    storageSafe: true,
    readState: "idle",
  };
}

export function appendPointIntent(record: ScoreRecoveryRecord, intent: PointIntent) {
  return { ...record, unsent: [...record.unsent, { ...intent }] };
}

export function beginPointAttempt(
  record: ScoreRecoveryRecord,
  expectedVersion: number,
  fence = false,
) {
  const [intent, ...unsent] = record.unsent;
  if (!intent) return { record, attempt: null };
  const attempt: PointAttempt = {
    ...intent,
    expectedVersion,
    state: "sending",
    ...(fence ? { fence: true } : {}),
  };
  return {
    attempt,
    record: {
      ...record,
      serverVersion: Math.max(record.serverVersion, expectedVersion),
      attempts: [...record.attempts, attempt],
      unsent,
    },
  };
}

export function markPointAttemptError(record: ScoreRecoveryRecord, attemptId: string) {
  return {
    ...record,
    attempts: record.attempts.map((attempt) =>
      attempt.id === attemptId ? { ...attempt, state: "unknown" as const } : attempt,
    ),
    pausedAfterError: true,
  };
}

export function markPointAttemptNoWrite(
  record: ScoreRecoveryRecord,
  attemptId: string,
) {
  const attempts = record.attempts.filter((attempt) => attempt.id !== attemptId);
  return {
    ...record,
    attempts,
    pausedAfterError:
      attempts.length > 0 ||
      record.unsent.length > 0 ||
      record.correctionAttempts.length > 0,
  };
}

export function appendCorrectionIntent(
  record: ScoreRecoveryRecord,
  intent: Omit<CorrectionAttempt, "state">,
) {
  return {
    ...record,
    correctionAttempts: [
      ...record.correctionAttempts,
      { ...intent, state: "unsent" as const },
    ],
    pausedAfterError: true,
  };
}

export function beginCorrectionAttempt(record: ScoreRecoveryRecord, attemptId: string) {
  const attempt = record.correctionAttempts.find((candidate) => candidate.id === attemptId);
  if (!attempt || attempt.state !== "unsent") return { record, attempt: null };
  const sending = { ...attempt, state: "sending" as const };
  return {
    attempt: sending,
    record: {
      ...record,
      serverVersion: Math.max(record.serverVersion, sending.expectedVersion),
      correctionAttempts: record.correctionAttempts.map((candidate) =>
        candidate.id === attemptId ? sending : candidate,
      ),
      pausedAfterError:
        record.attempts.length > 0 ||
        record.unsent.length > 0 ||
        record.correctionAttempts.some((candidate) => candidate.id !== attemptId)
          ? record.pausedAfterError
          : false,
    },
  };
}

export function markCorrectionAttemptUnsent(record: ScoreRecoveryRecord, attemptId: string) {
  return {
    ...record,
    correctionAttempts: record.correctionAttempts.map((attempt) =>
      attempt.id === attemptId ? { ...attempt, state: "unsent" as const } : attempt,
    ),
    pausedAfterError: true,
  };
}

export function markCorrectionAttemptError(record: ScoreRecoveryRecord, attemptId: string) {
  return {
    ...record,
    correctionAttempts: record.correctionAttempts.map((attempt) =>
      attempt.id === attemptId ? { ...attempt, state: "unknown" as const } : attempt,
    ),
    pausedAfterError: true,
  };
}

export function markCorrectionAttemptNoWrite(record: ScoreRecoveryRecord, attemptId: string) {
  const correctionAttempts = record.correctionAttempts.filter(
    (attempt) => attempt.id !== attemptId,
  );
  return {
    ...record,
    correctionAttempts,
    pausedAfterError:
      record.attempts.length > 0 ||
      record.unsent.length > 0 ||
      correctionAttempts.length > 0,
  };
}

function isEligibleAcceptedAttempt(
  attempt: Pick<PointAttempt | CorrectionAttempt, "state" | "expectedVersion">,
  fenceExpectedVersion: number,
) {
  return (
    attempt.state === "accepted-no-key" &&
    attempt.expectedVersion <= fenceExpectedVersion
  );
}

export function markPointAttemptApplied(
  record: ScoreRecoveryRecord,
  attemptId: string,
  serverVersion: number,
) {
  const applied = record.attempts.find((attempt) => attempt.id === attemptId);
  const attempts = record.attempts.filter(
    (attempt) =>
      attempt.id !== attemptId &&
      !(applied?.fence && isEligibleAcceptedAttempt(attempt, applied.expectedVersion)),
  );
  const correctionAttempts = record.correctionAttempts.filter(
    (attempt) =>
      !(applied?.fence && isEligibleAcceptedAttempt(attempt, applied.expectedVersion)),
  );
  return {
    ...record,
    serverVersion: Math.max(record.serverVersion, serverVersion),
    attempts,
    correctionAttempts,
    pausedAfterError: applied?.fence
      ? attempts.length > 0 || record.unsent.length > 0 || correctionAttempts.length > 0
      : record.pausedAfterError,
    readState: "exact" as const,
    reviewedVersion: serverVersion,
  };
}

export function markCorrectionAttemptApplied(
  record: ScoreRecoveryRecord,
  attemptId: string,
  serverVersion: number,
) {
  const applied = record.correctionAttempts.find((attempt) => attempt.id === attemptId);
  const attempts = record.attempts.filter(
    (attempt) =>
      !(applied?.fence && isEligibleAcceptedAttempt(attempt, applied.expectedVersion)),
  );
  const correctionAttempts = record.correctionAttempts.filter(
    (attempt) =>
      attempt.id !== attemptId &&
      !(applied?.fence && isEligibleAcceptedAttempt(attempt, applied.expectedVersion)),
  );
  return {
    ...record,
    serverVersion: Math.max(record.serverVersion, serverVersion),
    attempts,
    correctionAttempts,
    pausedAfterError: applied?.fence
      ? attempts.length > 0 || record.unsent.length > 0 || correctionAttempts.length > 0
      : record.pausedAfterError,
    readState: "exact" as const,
    reviewedVersion: serverVersion,
  };
}

export function restoreSendingAttemptsAsUnknown(record: ScoreRecoveryRecord): ScoreRecoveryRecord {
  const copied = copyRecord(record);
  return {
    ...copied,
    attempts: copied.attempts.map((attempt) => ({
      ...attempt,
      state:
        attempt.state === "sending" || attempt.state === "accepted-no-key"
          ? "unknown"
          : attempt.state,
      reviewedVersion: undefined,
      reviewedScoreA: undefined,
      reviewedScoreB: undefined,
      reviewedServerParticipantId: undefined,
    })),
    correctionAttempts: copied.correctionAttempts.map((attempt) => ({
      ...attempt,
      state:
        attempt.state === "sending" || attempt.state === "accepted-no-key"
          ? "unknown"
          : attempt.state,
      reviewedVersion: undefined,
      reviewedScoreA: undefined,
      reviewedScoreB: undefined,
      reviewedServerParticipantId: undefined,
    })),
    pausedAfterError:
      copied.attempts.length > 0 ||
      copied.unsent.length > 0 ||
      copied.correctionAttempts.length > 0,
    readState: "idle",
    reviewedVersion: undefined,
  };
}

export function reconcilePointAttempts(
  record: ScoreRecoveryRecord,
  serverVersion: number,
  idempotencyKeys: string[],
) {
  const exact = new Set(idempotencyKeys);
  const exactPointFenceAttempts = record.attempts.filter(
    (attempt) => attempt.fence && exact.has(attempt.idempotencyKey),
  );
  const exactCorrectionFenceAttempts = record.correctionAttempts.filter(
    (attempt) =>
      attempt.fence && exact.has(`manual-correction:${attempt.idempotencyKey}`),
  );
  const fenceExpectedVersions = [
    ...exactPointFenceAttempts,
    ...exactCorrectionFenceAttempts,
  ]
    .filter((attempt) => serverVersion > attempt.expectedVersion)
    .map((attempt) => attempt.expectedVersion);
  const appliedAttemptIds = record.attempts
    .filter((attempt) => exact.has(attempt.idempotencyKey))
    .map((attempt) => attempt.id);
  const appliedCorrectionAttemptIds = record.correctionAttempts
    .filter((attempt) => exact.has(`manual-correction:${attempt.idempotencyKey}`))
    .map((attempt) => attempt.id);
  const fencedAttemptIds = record.attempts
    .filter(
      (attempt) =>
        !appliedAttemptIds.includes(attempt.id) &&
        fenceExpectedVersions.some((expectedVersion) =>
          isEligibleAcceptedAttempt(attempt, expectedVersion),
        ),
    )
    .map((attempt) => attempt.id);
  const fencedCorrectionAttemptIds = record.correctionAttempts
    .filter(
      (attempt) =>
        !appliedCorrectionAttemptIds.includes(attempt.id) &&
        fenceExpectedVersions.some((expectedVersion) =>
          isEligibleAcceptedAttempt(attempt, expectedVersion),
        ),
    )
    .map((attempt) => attempt.id);
  const resolvedIds = new Set([...appliedAttemptIds, ...fencedAttemptIds]);
  const attempts = record.attempts
    .filter((attempt) => !resolvedIds.has(attempt.id))
    .map((attempt) =>
      attempt.state === "accepted-no-key"
        ? { ...attempt }
        : { ...attempt, reviewedVersion: serverVersion },
    );
  const resolvedCorrectionIds = new Set([
    ...appliedCorrectionAttemptIds,
    ...fencedCorrectionAttemptIds,
  ]);
  const correctionAttempts = record.correctionAttempts
    .filter((attempt) => !resolvedCorrectionIds.has(attempt.id))
    .map((attempt) =>
      attempt.state === "accepted-no-key" || attempt.state === "unsent"
        ? { ...attempt }
        : { ...attempt, reviewedVersion: serverVersion },
    );
  const unresolvedSent =
    attempts.length > 0 ||
    correctionAttempts.some((attempt) => attempt.state !== "unsent");
  return {
    appliedAttemptIds,
    appliedCorrectionAttemptIds,
    fencedAttemptIds,
    fencedCorrectionAttemptIds,
    record: {
      ...record,
      serverVersion: Math.max(record.serverVersion, serverVersion),
      attempts,
      correctionAttempts,
      pausedAfterError:
        attempts.length === 0 &&
        record.unsent.length === 0 &&
        correctionAttempts.length === 0
          ? false
          : record.pausedAfterError,
      readState: unresolvedSent ? ("no-key" as const) : ("exact" as const),
      reviewedVersion: serverVersion,
    },
  };
}

export function acceptReviewedPointScore(
  record: ScoreRecoveryRecord,
  snapshot?: ReviewedScoreSnapshot,
) {
  if (record.readState !== "no-key" || record.reviewedVersion === undefined) return record;
  return {
    ...record,
    attempts: record.attempts.map((attempt) =>
      attempt.state === "unknown"
        ? {
            ...attempt,
            state: "accepted-no-key" as const,
            reviewedVersion: record.reviewedVersion,
            ...(snapshot
              ? {
                  reviewedScoreA: snapshot.scoreA,
                  reviewedScoreB: snapshot.scoreB,
                  reviewedServerParticipantId: snapshot.currentServerParticipantId,
                }
              : {}),
          }
        : attempt,
    ),
  };
}

export function acceptReviewedCorrectionScore(
  record: ScoreRecoveryRecord,
  attemptId: string,
  snapshot: ReviewedScoreSnapshot,
) {
  if (record.readState !== "no-key" || record.reviewedVersion !== snapshot.version) {
    return record;
  }
  return {
    ...record,
    correctionAttempts: record.correctionAttempts.map((attempt) =>
      attempt.id === attemptId && attempt.state === "unknown"
        ? {
            ...attempt,
            state: "accepted-no-key" as const,
            reviewedVersion: snapshot.version,
            reviewedScoreA: snapshot.scoreA,
            reviewedScoreB: snapshot.scoreB,
            reviewedServerParticipantId: snapshot.currentServerParticipantId,
          }
        : attempt,
    ),
  };
}

export function discardUnsentCorrection(record: ScoreRecoveryRecord, attemptId: string) {
  const correctionAttempts = record.correctionAttempts.filter(
    (attempt) => !(attempt.id === attemptId && attempt.state === "unsent"),
  );
  return {
    ...record,
    correctionAttempts,
    pausedAfterError:
      record.attempts.length > 0 ||
      record.unsent.length > 0 ||
      correctionAttempts.length > 0,
  };
}

export function discardUnsentPointIntents(record: ScoreRecoveryRecord) {
  return {
    ...record,
    unsent: [],
    pausedAfterError:
      record.attempts.length > 0 || record.correctionAttempts.length > 0
        ? record.pausedAfterError
        : false,
  };
}

export function resumeUnsentPointIntents(record: ScoreRecoveryRecord) {
  return { ...record, pausedAfterError: false };
}

export function markRecoveryReadChecking(record: ScoreRecoveryRecord) {
  return { ...record, readState: "checking" as const };
}

export function markRecoveryReadFailed(record: ScoreRecoveryRecord) {
  return { ...record, readState: "failed" as const, pausedAfterError: true };
}

export function rememberScoreRecoveryRecord(record: ScoreRecoveryRecord) {
  const copied = copyRecord(record);
  records.set(recordKey(record.actorUserId, record.matchId), copied);
  return copied;
}

export function persistScoreRecoveryRecord(record: ScoreRecoveryRecord, storage: StorageLike) {
  const safeRecord = { ...copyRecord(record), storageSafe: true };
  try {
    storage.setItem(
      scoreRecoveryStorageKey(record.actorUserId, record.matchId),
      JSON.stringify(safeRecord),
    );
    rememberScoreRecoveryRecord(safeRecord);
    return { ok: true as const, record: safeRecord };
  } catch {
    const unsafeRecord = {
      ...copyRecord(record),
      pausedAfterError: true,
      storageSafe: false,
    };
    rememberScoreRecoveryRecord(unsafeRecord);
    return { ok: false as const, record: unsafeRecord };
  }
}

function isPointIntent(value: unknown): value is PointIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as Record<string, unknown>;
  return (
    typeof intent.id === "string" &&
    (intent.side === "A" || intent.side === "B") &&
    typeof intent.idempotencyKey === "string"
  );
}

function isPointAttempt(value: unknown): value is PointAttempt {
  if (!isPointIntent(value)) return false;
  const attempt = value as unknown as Record<string, unknown>;
  return (
    Number.isInteger(attempt.expectedVersion) &&
    (attempt.state === "sending" ||
      attempt.state === "unknown" ||
      attempt.state === "accepted-no-key") &&
    (attempt.reviewedVersion === undefined || Number.isInteger(attempt.reviewedVersion)) &&
    (attempt.reviewedScoreA === undefined || Number.isInteger(attempt.reviewedScoreA)) &&
    (attempt.reviewedScoreB === undefined || Number.isInteger(attempt.reviewedScoreB)) &&
    (attempt.reviewedServerParticipantId === undefined ||
      typeof attempt.reviewedServerParticipantId === "string") &&
    (attempt.fence === undefined || typeof attempt.fence === "boolean")
  );
}

function isCorrectionAttempt(value: unknown): value is CorrectionAttempt {
  if (!value || typeof value !== "object") return false;
  const attempt = value as Record<string, unknown>;
  return (
    typeof attempt.id === "string" &&
    typeof attempt.idempotencyKey === "string" &&
    Number.isInteger(attempt.expectedVersion) &&
    Number.isInteger(attempt.scoreA) &&
    Number.isInteger(attempt.scoreB) &&
    typeof attempt.currentServerParticipantId === "string" &&
    (attempt.state === "unsent" ||
      attempt.state === "sending" ||
      attempt.state === "unknown" ||
      attempt.state === "accepted-no-key") &&
    (attempt.reviewedVersion === undefined || Number.isInteger(attempt.reviewedVersion)) &&
    (attempt.reviewedScoreA === undefined || Number.isInteger(attempt.reviewedScoreA)) &&
    (attempt.reviewedScoreB === undefined || Number.isInteger(attempt.reviewedScoreB)) &&
    (attempt.reviewedServerParticipantId === undefined ||
      typeof attempt.reviewedServerParticipantId === "string") &&
    (attempt.fence === undefined || typeof attempt.fence === "boolean")
  );
}

function isScoreRecoveryRecord(value: unknown): value is ScoreRecoveryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === 1 &&
    typeof record.actorUserId === "string" &&
    typeof record.matchId === "string" &&
    Number.isInteger(record.serverVersion) &&
    Array.isArray(record.attempts) &&
    record.attempts.every(isPointAttempt) &&
    Array.isArray(record.unsent) &&
    record.unsent.every(isPointIntent) &&
    (record.correctionAttempts === undefined ||
      (Array.isArray(record.correctionAttempts) &&
        record.correctionAttempts.every(isCorrectionAttempt))) &&
    typeof record.pausedAfterError === "boolean" &&
    typeof record.storageSafe === "boolean" &&
    ["idle", "checking", "failed", "no-key", "exact"].includes(String(record.readState)) &&
    (record.reviewedVersion === undefined || Number.isInteger(record.reviewedVersion))
  );
}

export function readScoreRecoveryRecord(
  actorUserId: string,
  matchId: string,
  storage: StorageLike,
): { record: ScoreRecoveryRecord | null; storageError: string | null } {
  const memory = records.get(recordKey(actorUserId, matchId));
  if (memory && !memory.storageSafe) {
    return { record: copyRecord(memory), storageError: null };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(scoreRecoveryStorageKey(actorUserId, matchId));
  } catch {
    return { record: null, storageError: "Не удалось прочитать сохранённое состояние счёта." };
  }
  if (raw === null) {
    if (!memory) return { record: null, storageError: null };
    const unsafe = rememberScoreRecoveryRecord({ ...memory, storageSafe: false });
    return {
      record: unsafe,
      storageError: "Не удалось подтвердить сохранённое состояние счёта.",
    };
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isScoreRecoveryRecord(parsed)) {
      return { record: null, storageError: "Сохранённое состояние счёта повреждено." };
    }
    if (parsed.actorUserId !== actorUserId || parsed.matchId !== matchId) {
      return { record: null, storageError: "Сохранённое состояние счёта повреждено." };
    }
    const normalized: ScoreRecoveryRecord = {
      ...parsed,
      correctionAttempts: parsed.correctionAttempts ?? [],
    };
    const restored = rememberScoreRecoveryRecord(memory ?? normalized);
    return { record: restored, storageError: null };
  } catch {
    return { record: null, storageError: "Сохранённое состояние счёта повреждено." };
  }
}

export function resetScoreRecoveryForTests() {
  records.clear();
  generations.clear();
}
