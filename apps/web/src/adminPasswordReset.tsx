import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  type AdminPasswordResetRequest,
  type AdminPasswordResetResponse,
  type AdminUser,
} from "./api";
import { useAuth } from "./auth";
import { AUTH_UNAUTHORIZED_EVENT } from "./authEvents";
import { TempPasswordPanel } from "./authUi";
import { ADMIN_PASSWORD_RESET_ENABLED } from "./adminPasswordResetFeature";
import { Alert, Button, Dialog } from "./ui";

type ResetTarget = Pick<
  AdminUser,
  "id" | "email" | "firstName" | "lastName" | "status"
>;

type Correlation = {
  v: 1;
  actorId: string;
  targetId: string;
  requestId: string;
  expectedLastAppliedRequestId: string | null;
  supersedesRequestId?: string;
};

type Operation = Correlation & {
  target: ResetTarget;
  explicitAuthEpoch: number;
  generation: number;
  storageAvailable: boolean;
};

type IdleState = { kind: "idle" };
type LoadingState = { kind: "loading"; target: ResetTarget };
type ConfirmState = {
  kind: "confirm";
  target: ResetTarget;
  expectedLastAppliedRequestId: string | null;
};
type PostingState = { kind: "posting"; operation: Operation };
type UnresolvedState = {
  kind: "unresolved";
  operation: Operation;
  checking: boolean;
  checkError?: string;
};
type ReplacementState = {
  kind: "replacement";
  previous: UnresolvedState | AppliedWithoutSecretState;
  expectedLastAppliedRequestId: string | null;
};
type SecretState = {
  kind: "secret";
  target: ResetTarget;
  password: string;
  ticket: {
    actorId: string;
    targetId: string;
    explicitAuthEpoch: number;
    selfReset: boolean;
  };
};
type AppliedWithoutSecretState = {
  kind: "applied-without-secret";
  operation: Operation;
  current: boolean;
};
type StateChangedState = {
  kind: "state-changed";
  operation: Operation;
  currentLastAppliedRequestId: string | null;
};
type ErrorState = {
  kind: "error";
  target: ResetTarget;
  title: string;
  description: string;
};
type ResetState =
  | IdleState
  | LoadingState
  | ConfirmState
  | PostingState
  | UnresolvedState
  | ReplacementState
  | SecretState
  | AppliedWithoutSecretState
  | StateChangedState
  | ErrorState;

type ResetContextValue = {
  enabled: boolean;
  open: (target: ResetTarget) => Promise<void>;
};

const disabledContext: ResetContextValue = {
  enabled: false,
  open: async () => {},
};
const ResetContext = createContext<ResetContextValue>(disabledContext);
const STORAGE_PREFIX = "tab10.admin.password-reset.v1";

function storageKey(actorId: string, targetId: string) {
  return `${STORAGE_PREFIX}:${actorId}:${targetId}`;
}

function removeCorrelation(actorId: string, targetId: string) {
  try {
    window.sessionStorage.removeItem(storageKey(actorId, targetId));
  } catch { /* memory-only operation remains valid */ }
}

function readCorrelation(actorId: string, targetId: string): Correlation | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(actorId, targetId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Correlation>;
    if (
      value.v !== 1 ||
      value.actorId !== actorId ||
      value.targetId !== targetId ||
      typeof value.requestId !== "string" ||
      !value.requestId ||
      !(value.expectedLastAppliedRequestId === null ||
        typeof value.expectedLastAppliedRequestId === "string") ||
      !(value.supersedesRequestId === undefined ||
        typeof value.supersedesRequestId === "string")
    ) {
      removeCorrelation(actorId, targetId);
      return null;
    }
    return value as Correlation;
  } catch {
    removeCorrelation(actorId, targetId);
    return null;
  }
}

function persistCorrelation(operation: Correlation) {
  if (operation.actorId === operation.targetId) {
    removeCorrelation(operation.actorId, operation.targetId);
    return true;
  }
  try {
    window.sessionStorage.setItem(
      storageKey(operation.actorId, operation.targetId),
      JSON.stringify(operation),
    );
    return true;
  } catch {
    return false;
  }
}

function operationError(error: unknown) {
  return error as Error & {
    status?: number;
    code?: string;
    currentLastAppliedRequestId?: string | null;
  };
}

export function AdminPasswordResetProvider({
  children,
  enabled = ADMIN_PASSWORD_RESET_ENABLED,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const { user, reauthRequired, explicitAuthEpoch } = useAuth();
  const [state, setState] = useState<ResetState>({ kind: "idle" });
  const generationRef = useRef(0);
  const activeOperationRef = useRef<Operation | null>(null);
  const latestAuthRef = useRef({ user, reauthRequired, explicitAuthEpoch });
  latestAuthRef.current = { user, reauthRequired, explicitAuthEpoch };
  const previousExplicitEpochRef = useRef(explicitAuthEpoch);

  const invalidate = useCallback((removeStored: boolean) => {
    generationRef.current += 1;
    const active = activeOperationRef.current;
    if (removeStored && active) removeCorrelation(active.actorId, active.targetId);
    activeOperationRef.current = null;
    setState({ kind: "idle" });
  }, []);

  useEffect(() => {
    if (previousExplicitEpochRef.current === explicitAuthEpoch) return;
    previousExplicitEpochRef.current = explicitAuthEpoch;
    invalidate(true);
  }, [explicitAuthEpoch, invalidate]);

  useEffect(() => {
    const active = activeOperationRef.current;
    if (
      reauthRequired &&
      active &&
      active.actorId !== active.targetId
    ) {
      invalidate(false);
    }
  }, [reauthRequired, invalidate]);

  useEffect(() => {
    const active = activeOperationRef.current;
    if (!active || !user) return;
    if (user.id !== active.actorId || user.role !== "admin") invalidate(true);
  }, [user, invalidate]);

  useEffect(() => {
    if (state.kind !== "secret") return;
    const { ticket } = state;
    if (ticket.explicitAuthEpoch !== explicitAuthEpoch) {
      invalidate(false);
      return;
    }
    const exactSelfReset401 =
      ticket.selfReset &&
      reauthRequired &&
      (!user || (user.id === ticket.actorId && user.role === "admin"));
    if (exactSelfReset401) return;
    if (
      state.target.id !== ticket.targetId ||
      reauthRequired ||
      !user ||
      user.id !== ticket.actorId ||
      user.role !== "admin"
    ) {
      invalidate(false);
    }
  }, [explicitAuthEpoch, invalidate, reauthRequired, state, user]);

  useEffect(() => {
    if (!enabled) invalidate(true);
  }, [enabled, invalidate]);

  const isCurrent = useCallback((operation: Operation) => {
    const auth = latestAuthRef.current;
    if (
      activeOperationRef.current !== operation ||
      generationRef.current !== operation.generation ||
      auth.explicitAuthEpoch !== operation.explicitAuthEpoch
    ) return false;
    if (auth.user?.id === operation.actorId && auth.user.role === "admin") return true;
    return auth.reauthRequired && operation.actorId === operation.targetId;
  }, []);

  const open = useCallback(async (target: ResetTarget) => {
    const actor = latestAuthRef.current.user;
    if (!enabled || actor?.role !== "admin") return;
    const previous = activeOperationRef.current;
    if (previous) removeCorrelation(previous.actorId, previous.targetId);
    generationRef.current += 1;
    activeOperationRef.current = null;
    const generation = generationRef.current;
    const persisted = readCorrelation(actor.id, target.id);
    if (persisted) {
      const operation: Operation = {
        ...persisted,
        target,
        explicitAuthEpoch: latestAuthRef.current.explicitAuthEpoch,
        generation,
        storageAvailable: true,
      };
      activeOperationRef.current = operation;
      setState({ kind: "unresolved", operation, checking: false });
      return;
    }
    setState({ kind: "loading", target });
    try {
      const result = await api.getAdminPasswordResetState(target.id);
      if (
        generationRef.current !== generation ||
        latestAuthRef.current.user?.id !== actor.id ||
        latestAuthRef.current.explicitAuthEpoch !== explicitAuthEpoch
      ) return;
      setState({
        kind: "confirm",
        target,
        expectedLastAppliedRequestId: result.lastAppliedRequestId,
      });
    } catch (error) {
      if (generationRef.current !== generation) return;
      const typed = operationError(error);
      setState({
        kind: "error",
        target,
        title: typed.status === 401 || typed.status === 403
          ? "Доступ к сбросу прекращён"
          : "Не удалось подготовить сброс",
        description: typed.status === 401
          ? "Сессия завершена. Войдите снова и начните новое действие вручную."
          : typed.status === 403
            ? "Права администратора изменились. Обновите страницу после восстановления доступа."
            : "Проверьте соединение и загрузите актуальное состояние ещё раз.",
      });
    }
  }, [enabled, explicitAuthEpoch]);

  const finishResponse = useCallback((operation: Operation, response: AdminPasswordResetResponse) => {
    if (!isCurrent(operation) || response.requestId !== operation.requestId) return;
    removeCorrelation(operation.actorId, operation.targetId);
    activeOperationRef.current = null;
    if (response.secretAvailable && typeof response.temporaryPassword === "string") {
      setState({
        kind: "secret",
        target: operation.target,
        password: response.temporaryPassword,
        ticket: {
          actorId: operation.actorId,
          targetId: operation.targetId,
          explicitAuthEpoch: operation.explicitAuthEpoch,
          selfReset: operation.actorId === operation.targetId,
        },
      });
      if (operation.actorId === operation.targetId && latestAuthRef.current.user?.id === operation.actorId) {
        window.dispatchEvent(
          new CustomEvent(AUTH_UNAUTHORIZED_EVENT, {
            detail: { error: { status: 401, code: "UNAUTHORIZED" } },
          }),
        );
      }
      return;
    }
    activeOperationRef.current = operation;
    setState({
      kind: "applied-without-secret",
      operation,
      current: response.current,
    });
  }, [isCurrent]);

  const post = useCallback(async (
    target: ResetTarget,
    expectedLastAppliedRequestId: string | null,
    supersedesRequestId?: string,
  ) => {
    const actor = latestAuthRef.current.user;
    if (!actor || actor.role !== "admin") return;
    generationRef.current += 1;
    const generation = generationRef.current;
    const requestId = crypto.randomUUID();
    const correlation: Correlation = {
      v: 1,
      actorId: actor.id,
      targetId: target.id,
      requestId,
      expectedLastAppliedRequestId,
      ...(supersedesRequestId ? { supersedesRequestId } : {}),
    };
    const operation: Operation = {
      ...correlation,
      target,
      explicitAuthEpoch: latestAuthRef.current.explicitAuthEpoch,
      generation,
      storageAvailable: persistCorrelation(correlation),
    };
    activeOperationRef.current = operation;
    setState({ kind: "posting", operation });
    const payload: AdminPasswordResetRequest = supersedesRequestId
      ? {
          expectedLastAppliedRequestId,
          supersedesRequestId,
          confirmReplacement: true,
        }
      : { expectedLastAppliedRequestId };
    try {
      finishResponse(
        operation,
        await api.resetAdminPassword(target.id, requestId, payload),
      );
    } catch (error) {
      if (!isCurrent(operation)) return;
      const typed = operationError(error);
      if (typed.code === "RESET_STATE_CHANGED") {
        removeCorrelation(operation.actorId, operation.targetId);
        setState({
          kind: "state-changed",
          operation,
          currentLastAppliedRequestId: typed.currentLastAppliedRequestId ?? null,
        });
        return;
      }
      if (typed.code === "IDEMPOTENCY_KEY_REUSED") {
        removeCorrelation(operation.actorId, operation.targetId);
        setState({
          kind: "error",
          target,
          title: "Начните сброс заново",
          description: "Не удалось безопасно продолжить это действие. Закройте сообщение и начните новый сброс.",
        });
        return;
      }
      if (typed.status === 401 || typed.status === 403) {
        removeCorrelation(operation.actorId, operation.targetId);
        setState({
          kind: "error",
          target,
          title: "Доступ к сбросу прекращён",
          description: typed.status === 401
            ? "Сессия завершена. Войдите снова и начните действие вручную."
            : "Права администратора изменились. После восстановления доступа начните действие вручную.",
        });
        return;
      }
      if (!typed.status || typed.status >= 500) {
        setState({ kind: "unresolved", operation, checking: false });
        return;
      }
      removeCorrelation(operation.actorId, operation.targetId);
      setState({
        kind: "error",
        target,
        title: "Сброс не выполнен",
        description: typed.message || "Проверьте данные и начните операцию заново.",
      });
    }
  }, [finishResponse, isCurrent]);

  const checkReceipt = useCallback(async (unresolved: UnresolvedState) => {
    const { operation } = unresolved;
    if (!isCurrent(operation)) return;
    setState({ ...unresolved, checking: true, checkError: undefined });
    try {
      const receipt = await api.getAdminPasswordResetReceipt(
        operation.targetId,
        operation.requestId,
      );
      if (!isCurrent(operation)) return;
      if (receipt.outcome === "unknown") {
        setState({ kind: "unresolved", operation, checking: false });
      } else if (receipt.outcome === "applied") {
        removeCorrelation(operation.actorId, operation.targetId);
        setState({
          kind: "applied-without-secret",
          operation,
          current: receipt.current,
        });
      } else {
        removeCorrelation(operation.actorId, operation.targetId);
        setState({
          kind: "state-changed",
          operation,
          currentLastAppliedRequestId: null,
        });
      }
    } catch (error) {
      if (!isCurrent(operation)) return;
      const typed = operationError(error);
      if (typed.status === 401 || typed.status === 403) {
        removeCorrelation(operation.actorId, operation.targetId);
        setState({
          kind: "error",
          target: operation.target,
          title: "Проверка результата недоступна",
          description: typed.status === 401
            ? "Войдите снова. Проверка не возобновится автоматически."
            : "Текущему аккаунту недоступна проверка результата.",
        });
      } else {
        setState({
          kind: "unresolved",
          operation,
          checking: false,
          checkError: "Результат всё ещё не удалось проверить.",
        });
      }
    }
  }, [isCurrent]);

  const prepareReplacement = useCallback(async (
    previous: UnresolvedState | AppliedWithoutSecretState,
  ) => {
    const { operation } = previous;
    if (!isCurrent(operation)) return;
    setState({ kind: "loading", target: operation.target });
    try {
      const fresh = await api.getAdminPasswordResetState(operation.targetId);
      if (!isCurrent(operation)) return;
      setState({
        kind: "replacement",
        previous,
        expectedLastAppliedRequestId: fresh.lastAppliedRequestId,
      });
    } catch (error) {
      if (!isCurrent(operation)) return;
      const typed = operationError(error);
      if (typed.status === 401 || typed.status === 403) {
        removeCorrelation(operation.actorId, operation.targetId);
        setState({
          kind: "error",
          target: operation.target,
          title: "Новая выдача недоступна",
          description: typed.status === 401
            ? "Войдите снова и начните новое действие вручную."
            : "Права администратора изменились.",
        });
      } else {
        setState({
          ...previous,
          ...(previous.kind === "unresolved"
            ? { checkError: "Не удалось получить свежий указатель. Новая выдача не начата." }
            : {}),
        });
      }
    }
  }, [isCurrent]);

  const close = useCallback(() => {
    generationRef.current += 1;
    activeOperationRef.current = null;
    setState({ kind: "idle" });
  }, []);

  const value: ResetContextValue = { enabled, open };
  const targetName = state.kind === "idle" ? "" :
    state.kind === "replacement" ? `${state.previous.operation.target.lastName} ${state.previous.operation.target.firstName}` :
    state.kind === "posting" || state.kind === "unresolved" || state.kind === "applied-without-secret" || state.kind === "state-changed"
      ? `${state.operation.target.lastName} ${state.operation.target.firstName}`
      : `${state.target.lastName} ${state.target.firstName}`;

  return (
    <ResetContext.Provider value={value}>
      {children}
      <Dialog
        open={state.kind === "loading"}
        title="Проверяем состояние сброса"
        width="sm"
      >
        <p role="status">Получаем актуальный указатель для {targetName}…</p>
      </Dialog>
      <Dialog
        open={state.kind === "confirm"}
        onClose={close}
        title="Сбросить пароль?"
        width="sm"
        secondaryButtonLabel="Отмена"
        onSecondaryButton={close}
        mainButtonLabel="Подтвердить сброс"
        onMainButton={() => state.kind === "confirm" && void post(
          state.target,
          state.expectedLastAppliedRequestId,
        )}
      >
        {state.kind === "confirm" ? <div className="stack">
          <p>Новый пароль будет выдан для {state.target.email}. Все активные сессии пользователя завершатся.</p>
          {state.target.status === "blocked" ? (
            <Alert type="warning" variant="tonal" title="Аккаунт заблокирован" description="Заблокированный пользователь не сможет войти, пока аккаунт не разблокируют." />
          ) : null}
        </div> : null}
      </Dialog>
      <Dialog open={state.kind === "posting"} title="Выполняем сброс" width="sm">
        <p role="status">Не закрывайте страницу до получения результата.</p>
      </Dialog>
      <Dialog
        open={state.kind === "unresolved"}
        onClose={close}
        title="Результат пока неизвестен"
        width="sm"
      >
        {state.kind === "unresolved" ? <div className="stack">
          <p>Сброс мог выполниться, но ответ не получен. Сначала проверьте результат. Если пароль уже был выдан, показать его снова нельзя.</p>
          {!state.operation.storageAvailable ? <Alert type="warning" variant="tonal" title="Только текущая страница" description="После перезагрузки восстановление будет недоступно. Сохранённый пароль отсутствует." /> : null}
          {state.checkError ? <Alert type="error" variant="tonal" title="Проверка не завершена" description={state.checkError} /> : null}
          <div className="row">
            <Button disabled={state.checking} onClick={() => void checkReceipt(state)}>{state.checking ? "Проверяем…" : "Проверить результат"}</Button>
            <Button variant="secondary" disabled={state.checking} onClick={() => void prepareReplacement(state)}>Выдать новый пароль</Button>
            <Button variant="secondary" disabled={state.checking} onClick={close}>Закрыть</Button>
          </div>
        </div> : null}
      </Dialog>
      <Dialog
        open={state.kind === "replacement"}
        onClose={() => state.kind === "replacement" && setState(state.previous)}
        title="Выдать новый пароль ещё раз?"
        width="sm"
        secondaryButtonLabel="Отмена"
        onSecondaryButton={() => state.kind === "replacement" && setState(state.previous)}
        mainButtonLabel="Подтвердить новую выдачу"
        onMainButton={() => state.kind === "replacement" && void post(
          state.previous.operation.target,
          state.expectedLastAppliedRequestId,
          state.previous.operation.requestId,
        )}
      >
        {state.kind === "replacement" ? <p>После подтверждения будет выдан новый пароль. Предыдущий пароль показать снова нельзя.</p> : null}
      </Dialog>
      <Dialog open={state.kind === "secret"} onClose={close} title="Пароль выдан" width="sm">
        {state.kind === "secret" ? <div className="stack">
          <p>Скопируйте пароль сейчас. После закрытия показать его снова нельзя. Более поздний сброс или смена пароля сделают его недействительным.</p>
          <TempPasswordPanel password={state.password} onDismiss={close} />
        </div> : null}
      </Dialog>
      <Dialog open={state.kind === "applied-without-secret"} onClose={close} title="Сброс выполнен" width="sm">
        {state.kind === "applied-without-secret" ? <div className="stack">
          <p>Сброс выполнен, но временный пароль показывался только в первом ответе и восстановить его нельзя.</p>
          {!state.current ? <Alert type="warning" variant="tonal" title="Пароль уже мог измениться" description="После этого сброса пароль меняли ещё раз. Выдайте новый пароль, если пользователю всё ещё нужен доступ." /> : null}
          <div className="row">
            <Button onClick={() => void prepareReplacement(state)}>Выдать новый пароль</Button>
            <Button variant="secondary" onClick={close}>Закрыть</Button>
          </div>
        </div> : null}
      </Dialog>
      <Dialog open={state.kind === "state-changed"} onClose={close} title="Состояние изменилось" width="sm">
        {state.kind === "state-changed" ? <div className="stack">
          <p>Пароль не изменён: данные аккаунта успели обновиться. Получите актуальное состояние и подтвердите новый сброс.</p>
          <div className="row">
            <Button onClick={() => void open(state.operation.target)}>Начать заново</Button>
            <Button variant="secondary" onClick={close}>Закрыть</Button>
          </div>
        </div> : null}
      </Dialog>
      <Dialog
        open={state.kind === "error"}
        onClose={close}
        title={state.kind === "error" ? state.title : "Ошибка"}
        width="sm"
        mainButtonLabel="Закрыть"
        onMainButton={close}
      >
        {state.kind === "error" ? <Alert type="error" variant="tonal" title={state.title} description={state.description} /> : null}
      </Dialog>
    </ResetContext.Provider>
  );
}

export function useAdminPasswordReset() {
  return useContext(ResetContext);
}
