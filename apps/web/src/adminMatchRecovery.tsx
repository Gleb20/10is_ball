import { useEffect, useRef, useState } from "react";
import { api, type AdminMatchRecovery as RecoveryDto } from "./api";
import { useAuth } from "./auth";
import { Alert, Button, Dialog, TextField } from "./ui";
import { useLifecycleSingleFlight } from "./pages/useLifecycleSingleFlight";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Correlation = {
  actorId: string;
  authEpoch: number;
  matchId: string;
  expectedVersion: number;
  idempotencyKey: string;
  reconciled: boolean;
};

type ActiveOperation = {
  kind: "lookup" | "mutation" | "reconcile";
  correlation?: Correlation;
};

const kindLabel: Record<RecoveryDto["kind"], string> = {
  standalone: "Обычный матч",
  tournament: "Турнирный матч",
  tutorial: "Обучение",
};

const statusLabel: Record<RecoveryDto["status"], string> = {
  waiting: "Ожидает начала",
  in_progress: "Идёт",
  pending_confirmation: "Ожидает подтверждения результата",
  finished: "Завершён",
  stopped: "Остановлен",
  cancelled: "Отменён",
  voided: "Аннулирован",
};

function errorStatus(error: unknown) {
  return (error as { status?: number } | null)?.status;
}

export function AdminMatchRecovery() {
  const { user, explicitAuthEpoch, refresh } = useAuth();
  const actorId = user?.id ?? "anonymous";
  const identityKey = `${actorId}:${explicitAuthEpoch}`;
  const identityRef = useRef({ actorId, authEpoch: explicitAuthEpoch });
  identityRef.current = { actorId, authEpoch: explicitAuthEpoch };
  const previousIdentityRef = useRef(identityKey);
  const mountedRef = useRef(false);
  const lifecycleRef = useRef(0);
  const sequenceRef = useRef(0);
  const activeOperationRef = useRef<ActiveOperation | null>(null);
  const interruptedRef = useRef<Correlation | null>(null);
  const flight = useLifecycleSingleFlight();

  const [ownerKey, setOwnerKey] = useState(identityKey);
  const [matchId, setMatchId] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoveryDto | null>(null);
  const [unknown, setUnknown] = useState<Correlation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"new" | "replay" | null>(null);
  const [pendingKind, setPendingKind] = useState<ActiveOperation["kind"] | null>(null);

  const visible = ownerKey === identityKey;
  const visibleRecovery = visible ? recovery : null;
  const visibleUnknown = visible ? unknown : null;
  const visibleMatchId = visible ? matchId : "";

  useEffect(() => {
    mountedRef.current = true;
    lifecycleRef.current += 1;
    flight.resume();
    const identityChanged = previousIdentityRef.current !== identityKey;
    previousIdentityRef.current = identityKey;
    if (identityChanged) {
      interruptedRef.current = null;
      setOwnerKey(identityKey);
      setMatchId("");
      setFieldError(null);
      setRecovery(null);
      setUnknown(null);
      setError(null);
      setSuccess(null);
      setConfirm(null);
      setPendingKind(null);
    } else if (interruptedRef.current) {
      const interrupted = interruptedRef.current;
      interruptedRef.current = null;
      if (
        interrupted.actorId === actorId &&
        interrupted.authEpoch === explicitAuthEpoch
      ) {
        setOwnerKey(identityKey);
        setMatchId(interrupted.matchId);
        setRecovery(null);
        setUnknown(interrupted);
        setError(null);
        setSuccess(null);
        setPendingKind(null);
      }
    }
    return () => {
      mountedRef.current = false;
      lifecycleRef.current += 1;
      sequenceRef.current += 1;
      const active = activeOperationRef.current;
      if (
        flight.invalidate() &&
        active?.kind === "mutation" &&
        active.correlation
      ) {
        interruptedRef.current = active.correlation;
      }
    };
  }, [actorId, explicitAuthEpoch, flight.invalidate, flight.resume, identityKey]);

  function token() {
    return {
      actorId: identityRef.current.actorId,
      authEpoch: identityRef.current.authEpoch,
      lifecycle: lifecycleRef.current,
      sequence: ++sequenceRef.current,
    };
  }

  function isCurrent(value: ReturnType<typeof token>) {
    return (
      mountedRef.current &&
      identityRef.current.actorId === value.actorId &&
      identityRef.current.authEpoch === value.authEpoch &&
      lifecycleRef.current === value.lifecycle &&
      sequenceRef.current === value.sequence
    );
  }

  async function handleKnownError(failure: unknown) {
    const status = errorStatus(failure);
    if (status === 401) return;
    if (status === 403) {
      await refresh();
      return;
    }
    setError((failure as Error).message);
  }

  async function lookup(event: React.FormEvent) {
    event.preventDefault();
    const normalized = visibleMatchId.trim();
    if (!UUID.test(normalized)) {
      setFieldError("Введите UUID матча полностью");
      return;
    }
    setFieldError(null);
    await flight.run(async () => {
      const current = token();
      activeOperationRef.current = { kind: "lookup" };
      setPendingKind("lookup");
      setError(null);
      setSuccess(null);
      try {
        const response = await api.getAdminMatchRecovery(normalized);
        if (!isCurrent(current)) return;
        setOwnerKey(identityKey);
        setRecovery(response.recovery);
        setUnknown(null);
      } catch (failure) {
        if (!isCurrent(current)) return;
        await handleKnownError(failure);
      } finally {
        if (isCurrent(current)) {
          activeOperationRef.current = null;
          setPendingKind(null);
        }
      }
    });
  }

  function newCorrelation(): Correlation | null {
    if (!visibleRecovery || !user) return null;
    return {
      actorId: user.id,
      authEpoch: explicitAuthEpoch,
      matchId: visibleRecovery.id,
      expectedVersion: visibleRecovery.version,
      idempotencyKey: crypto.randomUUID(),
      reconciled: false,
    };
  }

  async function mutate(correlation: Correlation) {
    setConfirm(null);
    await flight.run(async () => {
      const current = token();
      activeOperationRef.current = { kind: "mutation", correlation };
      setPendingKind("mutation");
      setError(null);
      setSuccess(null);
      try {
        const response = await api.forceCloseAdminMatchRecovery(
          correlation.matchId,
          { expectedVersion: correlation.expectedVersion },
          correlation.idempotencyKey,
        );
        if (!isCurrent(current)) return;
        setOwnerKey(identityKey);
        setRecovery(response.recovery);
        setUnknown(null);
        setSuccess(`Матч ${correlation.matchId} аварийно завершён`);
      } catch (failure) {
        if (!isCurrent(current)) return;
        const status = errorStatus(failure);
        if (!status || status >= 500) {
          setRecovery(null);
          setUnknown(correlation);
          setError(null);
        } else {
          setRecovery(null);
          setUnknown(null);
          await handleKnownError(failure);
        }
      } finally {
        if (isCurrent(current)) {
          activeOperationRef.current = null;
          setPendingKind(null);
        }
      }
    });
  }

  async function reconcile() {
    if (!visibleUnknown) return;
    const correlation = visibleUnknown;
    await flight.run(async () => {
      const current = token();
      activeOperationRef.current = { kind: "reconcile", correlation };
      setPendingKind("reconcile");
      setError(null);
      try {
        const response = await api.getAdminMatchRecovery(correlation.matchId);
        if (!isCurrent(current)) return;
        setRecovery(response.recovery);
        setUnknown({ ...correlation, reconciled: true });
      } catch (failure) {
        if (!isCurrent(current)) return;
        await handleKnownError(failure);
      } finally {
        if (isCurrent(current)) {
          activeOperationRef.current = null;
          setPendingKind(null);
        }
      }
    });
  }

  const confirmationId =
    confirm === "replay" ? visibleUnknown?.matchId : visibleRecovery?.id;

  return (
    <section className="card stack" aria-labelledby="admin-match-recovery-title">
      <h2 className="section-title" id="admin-match-recovery-title">
        Аварийное завершение матча
      </h2>
      <p className="muted">
        Введите точный ID. Поиск не открывает состав, счёт, судью или события матча.
      </p>
      <form className="stack" onSubmit={lookup} noValidate>
        <TextField
          label="ID матча"
          value={visibleMatchId}
          autoComplete="off"
          disabled={flight.pending || visibleUnknown !== null}
          error={Boolean(fieldError)}
          helperText={fieldError ?? undefined}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setOwnerKey(identityKey);
            setMatchId(event.target.value);
            if (fieldError) setFieldError(null);
          }}
        />
        <Button type="submit" variant="secondary" disabled={flight.pending || visibleUnknown !== null}>
          {pendingKind === "lookup" ? "Поиск…" : "Найти матч"}
        </Button>
      </form>

      {error ? <Alert type="error" variant="tonal" title="Действие не выполнено" description={error} /> : null}
      {success ? <Alert type="primary" variant="tonal" title={success} description="Сервер подтвердил отмену матча." /> : null}

      {visibleUnknown ? (
        <div className="stack">
          <Alert
            type="warning"
            variant="tonal"
            title={visibleUnknown.reconciled
              ? "Состояние получено, но авторство изменения не доказано"
              : "Исход запроса неизвестен"}
            description={visibleUnknown.reconciled
              ? "Статус и версия не доказывают, какой запрос изменил матч. Можно отдельно подтвердить повтор того же ключа."
              : "Не отправляйте действие снова вслепую. Сначала получите текущее состояние только чтением."}
          />
          {!visibleUnknown.reconciled ? (
            <Button variant="secondary" disabled={flight.pending} onClick={() => void reconcile()}>
              {pendingKind === "reconcile" ? "Сверка…" : "Сверить состояние"}
            </Button>
          ) : (
            <div className="row">
              <Button variant="secondary" disabled={flight.pending} onClick={() => setConfirm("replay")}>
                Проверить исход тем же запросом
              </Button>
              <Button variant="secondary" disabled={flight.pending} onClick={() => setUnknown(null)}>
                Закрыть сверку
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {visibleRecovery ? (
        <div className="stack" aria-label="Минимальные данные матча">
          <dl className="profile-details">
            <div><dt>ID</dt><dd>{visibleRecovery.id}</dd></div>
            <div><dt>Тип</dt><dd>{kindLabel[visibleRecovery.kind]}</dd></div>
            <div><dt>Статус</dt><dd>{statusLabel[visibleRecovery.status]}</dd></div>
            <div><dt>Версия</dt><dd>{visibleRecovery.version}</dd></div>
            <div><dt>Аварийное действие</dt><dd>{visibleRecovery.allowedEmergencyAction === "force_close" ? "Аварийное завершение доступно" : "Недоступно"}</dd></div>
          </dl>
          {visibleRecovery.allowedEmergencyAction === "force_close" && !visibleUnknown ? (
            <Button disabled={flight.pending} onClick={() => setConfirm("new")}>
              Аварийно завершить
            </Button>
          ) : null}
        </div>
      ) : null}

      <Dialog
        open={confirm !== null}
        onClose={() => !flight.pending && setConfirm(null)}
        title={confirmationId ? `Аварийно завершить матч ${confirmationId}?` : "Аварийно завершить матч?"}
        width="sm"
        secondaryButtonLabel="Отмена"
        onSecondaryButton={() => !flight.pending && setConfirm(null)}
        mainButtonLabel={confirm === "replay" ? "Отправить тот же запрос" : confirmationId ? `Завершить матч ${confirmationId}` : "Завершить матч"}
        onMainButton={() => {
          const correlation = confirm === "replay" ? visibleUnknown : newCorrelation();
          if (correlation) void mutate(correlation);
        }}
      >
        <p>
          Матч станет отменённым без победителя и статистики. Судейский слот и занятость игроков будут сняты.
        </p>
        {confirm === "replay" ? (
          <p className="muted">Будут повторены тот же ID, версия и Idempotency-Key; новый запрос не создаётся автоматически.</p>
        ) : null}
      </Dialog>
    </section>
  );
}
