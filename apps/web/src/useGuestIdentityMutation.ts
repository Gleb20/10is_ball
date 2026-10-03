import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GuestIdentity } from "@tab10/shared";
import { api } from "./api";

type CreateAttempt = {
  operation: "create";
  requestId: string;
  firstName: string;
  lastName: string;
};

type RenameAttempt = {
  operation: "rename";
  requestId: string;
  guestId: string;
  expectedVersion: number;
  firstName: string;
  lastName: string;
};

export type GuestIdentityAttempt = CreateAttempt | RenameAttempt;

export type GuestIdentityMutationState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "unknown" }
  | { kind: "success"; guest: GuestIdentity; recovered: boolean }
  | { kind: "conflict"; guest: GuestIdentity | null }
  | { kind: "failure"; message: string };

export type GuestIdentityMutationScope = {
  actorId?: string;
  authEpoch?: number;
  routeKey?: string;
  purposeKey?: string;
};

export function guestCreatePurposeKey(target:
  | { kind: "catalogue" }
  | { kind: "match"; draftToken: string; slotKey: string }
  | { kind: "tournament"; tournamentId: string }
) {
  if (target.kind === "match") return `guest-create:match:${target.draftToken}:${target.slotKey}`;
  if (target.kind === "tournament") return `guest-create:tournament:${target.tournamentId}`;
  return "guest-create:catalogue";
}

type ApiFailure = Error & { status?: number; code?: string };

function failureOf(value: unknown): ApiFailure {
  return value instanceof Error ? value as ApiFailure : new Error(String(value));
}

function isKnownTerminalFailure(error: ApiFailure) {
  return typeof error.status === "number" && error.status >= 400 && error.status < 500 &&
    error.status !== 401 && error.code !== "VERSION_CONFLICT";
}

const GUEST_MUTATION_WATCHDOG_MS = 15_000;
const GUEST_MUTATION_TIMEOUT = Symbol("guest-mutation-timeout");

type AttemptTarget = { actorId: string; purposeKey: string };

const heldAttempts = new Map<string, { target: AttemptTarget; attempt: GuestIdentityAttempt }>();

function targetKey(target: AttemptTarget) {
  return `${target.actorId}\u0000${target.purposeKey}`;
}

export function clearHeldGuestIdentityMutationForTests() {
  heldAttempts.clear();
}

async function withWatchdog<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(GUEST_MUTATION_TIMEOUT), GUEST_MUTATION_WATCHDOG_MS);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function send(attempt: GuestIdentityAttempt): Promise<GuestIdentity> {
  if (attempt.operation === "create") {
    return (await api.createGuest({
      requestId: attempt.requestId,
      firstName: attempt.firstName,
      lastName: attempt.lastName,
    })).guest;
  }
  return (await api.renameGuest(attempt.guestId, {
    requestId: attempt.requestId,
    expectedVersion: attempt.expectedVersion,
    firstName: attempt.firstName,
    lastName: attempt.lastName,
  })).guest;
}

type CompleteScope = Required<GuestIdentityMutationScope>;

function sameScope(left: CompleteScope, right: CompleteScope) {
  return left.actorId === right.actorId &&
    left.authEpoch === right.authEpoch &&
    left.routeKey === right.routeKey &&
    left.purposeKey === right.purposeKey;
}

export function useGuestIdentityMutation(scope: GuestIdentityMutationScope = {}) {
  const currentScope: CompleteScope = {
    actorId: scope.actorId ?? "anonymous",
    authEpoch: scope.authEpoch ?? 0,
    routeKey: scope.routeKey ?? "local",
    purposeKey: scope.purposeKey ?? "local",
  };
  const scopeRef = useRef(currentScope);
  scopeRef.current = currentScope;
  const initialTarget = { actorId: currentScope.actorId, purposeKey: currentScope.purposeKey };
  const initialAttempt = heldAttempts.get(targetKey(initialTarget))?.attempt ?? null;
  const [attempt, setAttempt] = useState<GuestIdentityAttempt | null>(initialAttempt);
  const attemptRef = useRef<GuestIdentityAttempt | null>(initialAttempt);
  const attemptTargetRef = useRef<AttemptTarget | null>(initialAttempt ? initialTarget : null);
  const recoveredRef = useRef(Boolean(initialAttempt));
  const [state, setState] = useState<GuestIdentityMutationState>(
    initialAttempt ? { kind: "unknown" } : { kind: "idle" },
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const mountedRef = useRef(true);
  const operationGenerationRef = useRef(0);
  const previousScopeRef = useRef(currentScope);

  const hold = useCallback((frozen: GuestIdentityAttempt, target: AttemptTarget) => {
    heldAttempts.set(targetKey(target), { target, attempt: frozen });
  }, []);

  const clearHeld = useCallback((frozen: GuestIdentityAttempt, target: AttemptTarget) => {
    const key = targetKey(target);
    if (heldAttempts.get(key)?.attempt === frozen) heldAttempts.delete(key);
  }, []);

  useEffect(() => {
    const previous = previousScopeRef.current;
    previousScopeRef.current = currentScope;
    if (sameScope(previous, currentScope)) return;
    operationGenerationRef.current += 1;
    const frozen = attemptRef.current;
    if (previous.actorId !== currentScope.actorId || previous.purposeKey !== currentScope.purposeKey) {
      const nextTarget = { actorId: currentScope.actorId, purposeKey: currentScope.purposeKey };
      const nextAttempt = heldAttempts.get(targetKey(nextTarget))?.attempt ?? null;
      attemptRef.current = nextAttempt;
      attemptTargetRef.current = nextAttempt ? nextTarget : null;
      recoveredRef.current = Boolean(nextAttempt);
      setAttempt(nextAttempt);
      setState(nextAttempt ? { kind: "unknown" } : { kind: "idle" });
      return;
    }
    if (frozen && (stateRef.current.kind === "pending" || stateRef.current.kind === "unknown")) {
      const target = attemptTargetRef.current;
      if (target) hold(frozen, target);
      setState({ kind: "unknown" });
    }
  }, [currentScope.actorId, currentScope.authEpoch, currentScope.purposeKey, currentScope.routeKey, hold]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationGenerationRef.current += 1;
      const frozen = attemptRef.current;
      if (frozen && (stateRef.current.kind === "pending" || stateRef.current.kind === "unknown")) {
        const target = attemptTargetRef.current;
        if (target) hold(frozen, target);
      }
    };
  }, [hold]);

  const run = useCallback(async (frozen: GuestIdentityAttempt, recovered = false) => {
    const issuedScope = scopeRef.current;
    const target = { actorId: issuedScope.actorId, purposeKey: issuedScope.purposeKey };
    const generation = operationGenerationRef.current + 1;
    operationGenerationRef.current = generation;
    attemptRef.current = frozen;
    attemptTargetRef.current = target;
    recoveredRef.current = recovered;
    hold(frozen, target);
    setAttempt(frozen);
    setState({ kind: "pending" });
    const isCurrent = () => mountedRef.current &&
      operationGenerationRef.current === generation &&
      attemptRef.current === frozen &&
      sameScope(scopeRef.current, issuedScope);
    try {
      const guest = await withWatchdog(send(frozen));
      if (!isCurrent()) return;
      clearHeld(frozen, target);
      setState({ kind: "success", guest, recovered });
    } catch (value) {
      if (attemptRef.current !== frozen) return;
      if (!isCurrent()) {
        if (
          mountedRef.current &&
          scopeRef.current.actorId === issuedScope.actorId &&
          scopeRef.current.purposeKey === issuedScope.purposeKey &&
          attemptRef.current === frozen
        ) {
          hold(frozen, target);
          setState({ kind: "unknown" });
        }
        return;
      }
      const error = failureOf(value);
      if (error.code === "VERSION_CONFLICT" && frozen.operation === "rename") {
        const current = await api.getGuest(frozen.guestId).catch(() => null);
        if (isCurrent()) {
          clearHeld(frozen, target);
          setState({ kind: "conflict", guest: current?.guest ?? null });
        }
        return;
      }
      if (isKnownTerminalFailure(error)) {
        clearHeld(frozen, target);
        setState({
          kind: "failure",
          message: error.code === "IDEMPOTENCY_KEY_REUSED"
            ? "Эта попытка уже относится к другим данным. Начните новую операцию."
            : "Не удалось сохранить гостя. Проверьте введённые данные и попробуйте снова.",
        });
        return;
      }
      hold(frozen, target);
      setState({ kind: "unknown" });
    }
  }, [clearHeld, hold]);

  const create = useCallback(async (firstName: string, lastName: string) => {
    if (stateRef.current.kind === "pending" || stateRef.current.kind === "unknown") return;
    const frozen: CreateAttempt = {
      operation: "create",
      requestId: crypto.randomUUID(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
    };
    await run(frozen, false);
  }, [run]);

  const rename = useCallback(async (
    guest: GuestIdentity,
    firstName: string,
    lastName: string,
  ) => {
    if (stateRef.current.kind === "pending" || stateRef.current.kind === "unknown") return;
    const frozen: RenameAttempt = {
      operation: "rename",
      requestId: crypto.randomUUID(),
      guestId: guest.id,
      expectedVersion: guest.version,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
    };
    await run(frozen, false);
  }, [run]);

  const resendFrozenAttempt = useCallback(async () => {
    const frozen = attemptRef.current;
    if (!frozen) return;
    await run(frozen, recoveredRef.current);
  }, [run]);

  const checkFrozenAttempt = useCallback(async () => {
    const frozen = attemptRef.current;
    if (!frozen) return;
    const checkScope = scopeRef.current;
    const target = attemptTargetRef.current;
    if (!target || target.actorId !== checkScope.actorId || target.purposeKey !== checkScope.purposeKey) return;
    const generation = operationGenerationRef.current + 1;
    operationGenerationRef.current = generation;
    hold(frozen, target);
    setState({ kind: "pending" });
    const isCurrent = () => mountedRef.current &&
      operationGenerationRef.current === generation &&
      attemptRef.current === frozen &&
      sameScope(scopeRef.current, checkScope);
    try {
      const outcome = await withWatchdog(api.getGuestMutationOutcome(frozen.requestId));
      if (!isCurrent()) return;
      if (outcome.outcome === "unknown") {
        hold(frozen, target);
        setState({ kind: "unknown" });
        return;
      }
      const current = await withWatchdog(api.getGuest(outcome.guestId));
      if (isCurrent()) {
        clearHeld(frozen, target);
        setState({ kind: "success", guest: current.guest, recovered: recoveredRef.current });
      }
    } catch {
      if (isCurrent()) {
        hold(frozen, target);
        setState({ kind: "unknown" });
      }
    }
  }, [clearHeld, hold]);

  const reset = useCallback(() => {
    if (state.kind === "pending" || state.kind === "unknown") return;
    const frozen = attemptRef.current;
    const target = attemptTargetRef.current;
    if (frozen && target) clearHeld(frozen, target);
    attemptRef.current = null;
    attemptTargetRef.current = null;
    recoveredRef.current = false;
    setAttempt(null);
    setState({ kind: "idle" });
  }, [clearHeld, state.kind]);

  const message = useMemo(() => {
    if (state.kind === "unknown") {
      return "Ответ не получен. Проверьте статус попытки или повторите её с теми же данными.";
    }
    if (state.kind === "conflict") {
      return "Этого гостя уже изменил другой человек. Обновите карточку и внесите правку ещё раз.";
    }
    if (state.kind === "failure") return state.message;
    return null;
  }, [state]);

  return {
    attempt,
    state,
    message,
    create,
    rename,
    resendFrozenAttempt,
    checkFrozenAttempt,
    reset,
  };
}
