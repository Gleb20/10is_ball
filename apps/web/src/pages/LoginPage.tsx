import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, TextField } from "../ui";
import { AuthLayout } from "../authUi";
import { api } from "../api";
import { useAuth } from "../auth";

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
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const { setUser, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as { returnTo?: unknown } | null;
  const destination = safeReturnPath(returnTo ?? routeState?.returnTo);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
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
      setError((err as Error).message || "Ошибка входа");
    } finally {
      setPending(false);
    }
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
          type="email"
          name="email"
          value={email}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setEmail(e.target.value)
          }
          autoComplete="username"
          autoFocus={sessionExpired}
          required
        />
        <TextField
          label="Пароль"
          type={showPassword ? "text" : "password"}
          name="password"
          value={password}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setPassword(e.target.value)
          }
          autoComplete="current-password"
          required
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setShowPassword((v) => !v)}
        >
          {showPassword ? "Скрыть пароль" : "Показать пароль"}
        </Button>
        <p className="muted">
          Нет доступа? Обратитесь к администратору Tab-10 — самостоятельная
          регистрация недоступна.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Вход…" : "Войти"}
        </Button>
      </form>
    </AuthLayout>
  );
}
