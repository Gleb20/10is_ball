import { useId, useLayoutEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, TextField } from "../ui";
import { AuthLayout, AuthPasswordField } from "../authUi";
import { api } from "../api";
import { useAuth } from "../auth";
import { useSingleFlight } from "../useSingleFlight";

function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return "/";
  }
  const base = "https://tab10.invalid";
  const parsed = new URL(value, base);
  if (parsed.origin !== base || parsed.pathname === "/login") return "/";
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function LoginPage({
  returnTo,
  sessionExpired = false,
}: {
  returnTo?: string;
  sessionExpired?: boolean;
} = {}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorFocusRevision, setErrorFocusRevision] = useState(0);
  const [invalidCredentials, setInvalidCredentials] = useState(false);
  const submission = useSingleFlight();
  const errorId = useId();
  const { setUser, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as { returnTo?: unknown } | null;
  const destination = safeReturnPath(returnTo ?? routeState?.returnTo);

  useLayoutEffect(() => {
    if (error) document.getElementById(errorId)?.focus();
  }, [error, errorId, errorFocusRevision]);

  function reportError(message: string) {
    setError(message);
    setErrorFocusRevision((revision) => revision + 1);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submission.run(async () => {
      setError(null);
      setInvalidCredentials(false);
      try {
        const res = await api.login(email, password);
        setUser(res.user);
        if (res.user.mustChangePassword) {
          navigate("/first-password");
        } else {
          await refresh();
          navigate(destination, { replace: true, state: null });
        }
      } catch (err) {
        const code = (err as { code?: string }).code;
        setInvalidCredentials(code === "INVALID_CREDENTIALS");
        reportError(code === "ACCOUNT_BLOCKED"
          ? "Аккаунт заблокирован"
          : code === "RATE_LIMITED"
            ? "Слишком много попыток"
            : code === "INVALID_CREDENTIALS" || (err as { status?: number }).status === 401
              ? "Неверный email или пароль"
              : "Не удалось выполнить вход. Проверьте соединение и попробуйте снова.");
      }
    });
  }

  return (
    <AuthLayout
      title="Вход"
      subtitle={
        sessionExpired
          ? "Сессия завершена. Войдите снова, чтобы продолжить с этого места."
          : "Сервис настольного тенниса для закрытой группы"
      }
    >
      <form className="stack" onSubmit={onSubmit} aria-label="Форма входа">
        <TextField
          label="Email"
          id="login-email"
          type="email"
          name="email"
          value={email}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setEmail(e.target.value);
            setError(null);
            setInvalidCredentials(false);
          }}
          autoComplete="username"
          autoFocus={sessionExpired}
          fullWidth
          disabled={submission.pending}
          error={invalidCredentials}
          aria-describedby={invalidCredentials ? errorId : undefined}
          required
        />
        <AuthPasswordField
          id="login-password"
          label="Пароль"
          name="password"
          value={password}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setPassword(e.target.value);
            setError(null);
            setInvalidCredentials(false);
          }}
          autoComplete="current-password"
          disabled={submission.pending}
          error={invalidCredentials}
          aria-describedby={invalidCredentials ? errorId : undefined}
          required
        />
        <p className="muted">
          Нет доступа? Обратитесь к администратору Tab-10 — самостоятельная
          регистрация недоступна.
        </p>
        {error ? <Alert id={errorId} tabIndex={-1} role="alert" type="error" variant="tonal" title="Не удалось войти" description={error} /> : null}
        <Button type="submit" disabled={submission.pending}>
          {submission.pending ? "Вход…" : "Войти"}
        </Button>
      </form>
    </AuthLayout>
  );
}
