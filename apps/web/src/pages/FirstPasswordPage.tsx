import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, TextField } from "../ui";
import { AuthLayout } from "../authUi";
import { api } from "../api";
import { useAuth } from "../auth";

export function FirstPasswordPage() {
  const { user, refresh } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) return <Navigate to="/" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    try {
      await api.firstPasswordChange(password);
      await refresh();
      navigate("/onboarding");
    } catch (err) {
      const details = (err as { details?: { errors?: string[] } }).details;
      const extra = details?.errors?.join("; ");
      setError(extra ? `${(err as Error).message}: ${extra}` : (err as Error).message);
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
        <TextField
          label="Новый пароль"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setPassword(e.target.value)
          }
          autoComplete="new-password"
          required
        />
        <TextField
          label="Повторите пароль"
          type={showPassword ? "text" : "password"}
          value={confirm}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setConfirm(e.target.value)
          }
          autoComplete="new-password"
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
          Минимум 10 символов: заглавная, строчная, цифра и спецсимвол
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="stack stack--actions">
          <Button type="submit">Сохранить</Button>
          <Button type="button" variant="secondary" onClick={() => navigate("/login")}>
            Выйти
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
