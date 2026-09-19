import { useId, useLayoutEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Alert, Button } from "../ui";
import { AuthLayout, AuthPasswordField } from "../authUi";
import { api } from "../api";
import { useAuth } from "../auth";
import { useSingleFlight } from "../useSingleFlight";

const policyReasonText: Record<string, string> = {
  TOO_SHORT: "Не менее 10 символов",
  TOO_LONG: "Не более 128 символов",
  MISSING_UPPERCASE: "Добавьте заглавную латинскую букву",
  MISSING_LOWERCASE: "Добавьте строчную латинскую букву",
  MISSING_DIGIT: "Добавьте цифру",
  MISSING_SPECIAL: "Добавьте допустимый спецсимвол",
};

function firstPasswordError(error: unknown): string {
  const response = error as { code?: string; details?: { errors?: unknown } };
  if (response.code === "PASSWORD_POLICY") {
    const reasons = Array.isArray(response.details?.errors)
      ? response.details.errors.filter((value): value is string => typeof value === "string")
      : [];
    const known = reasons.map((reason) => policyReasonText[reason]).filter(Boolean);
    return known.length === reasons.length && known.length > 0
      ? known.join("; ")
      : [...known, "Пароль не соответствует требованиям"].join("; ");
  }
  return "Не удалось сохранить пароль. Проверьте соединение и попробуйте снова.";
}

export function FirstPasswordPage() {
  const { user, refresh, setUser } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorFocusRevision, setErrorFocusRevision] = useState(0);
  const [mismatch, setMismatch] = useState(false);
  const [policyError, setPolicyError] = useState(false);
  const [pendingAction, setPendingAction] = useState<"save" | "logout" | null>(null);
  const errorId = useId();
  const submission = useSingleFlight();
  const navigate = useNavigate();

  useLayoutEffect(() => {
    if (error) document.getElementById(errorId)?.focus();
  }, [error, errorId, errorFocusRevision]);

  function reportError(message: string) {
    setError(message);
    setErrorFocusRevision((revision) => revision + 1);
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) return <Navigate to="/" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submission.run(async () => {
      setError(null);
      setMismatch(false);
      setPolicyError(false);
      if (password !== confirm) {
        setMismatch(true);
        reportError("Пароли не совпадают");
        return;
      }
      setPendingAction("save");
      try {
        await api.firstPasswordChange(password);
        await refresh();
        navigate("/onboarding");
      } catch (err) {
        setPolicyError((err as { code?: string }).code === "PASSWORD_POLICY");
        reportError(firstPasswordError(err));
      } finally {
        setPendingAction(null);
      }
    });
  }

  async function onLogout() {
    await submission.run(async () => {
      setError(null);
      setMismatch(false);
      setPolicyError(false);
      setPendingAction("logout");
      try {
        await api.logout();
      } catch (err) {
        if ((err as { status?: number }).status !== 401) {
          reportError("Не удалось подтвердить выход. Проверьте соединение и попробуйте снова.");
          setPendingAction(null);
          return;
        }
      }
      setPassword("");
      setConfirm("");
      setUser(null);
      navigate("/login", { replace: true });
    });
  }

  function changePassword(value: string) {
    setPassword(value);
    if (mismatch || policyError) {
      setMismatch(false);
      setPolicyError(false);
      setError(null);
    }
  }

  function changeConfirm(value: string) {
    setConfirm(value);
    if (mismatch) {
      setMismatch(false);
      setError(null);
    }
  }

  return (
    <AuthLayout
      title="Смена пароля"
      subtitle="Задайте новый пароль при первом входе"
    >
      <form
        className="stack"
        onSubmit={onSubmit}
        aria-label="Форма смены пароля"
      >
        <AuthPasswordField
          id="first-password-new"
          label="Новый пароль"
          value={password}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            changePassword(e.target.value)
          }
          autoComplete="new-password"
          disabled={submission.pending}
          error={mismatch || policyError}
          aria-describedby={mismatch || policyError ? errorId : undefined}
          required
        />
        <AuthPasswordField
          id="first-password-confirm"
          label="Повторите пароль"
          toggleLabel="повторный пароль"
          value={confirm}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            changeConfirm(e.target.value)
          }
          autoComplete="new-password"
          disabled={submission.pending}
          error={mismatch}
          aria-describedby={mismatch ? errorId : undefined}
          required
        />
        <p className="muted">
          Минимум 10 символов: заглавная, строчная, цифра и спецсимвол
        </p>
        {error ? <Alert id={errorId} tabIndex={-1} role="alert" type="error" variant="tonal" title={mismatch ? "Проверьте пароли" : policyError ? "Проверьте пароль" : "Не удалось продолжить"} description={error} /> : null}
        <div className="stack stack--actions">
          <Button type="submit" disabled={submission.pending}>
            {pendingAction === "save" ? "Сохранение…" : "Сохранить"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={submission.pending}
            onClick={() => void onLogout()}
          >
            {pendingAction === "logout" ? "Выход…" : "Выйти"}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
