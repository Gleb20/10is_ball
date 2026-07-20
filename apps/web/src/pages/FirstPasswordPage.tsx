import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, TextField } from "../ui";
import { AuthLayout } from "../authUi";
import { api } from "../api";
import { useAuth } from "../auth";

export function FirstPasswordPage() {
  const { user, refresh } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) return <Navigate to="/" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.firstPasswordChange(password);
      await refresh();
      navigate("/onboarding");
    } catch (err) {
      setError((err as Error).message);
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
          type="password"
          value={password}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setPassword(e.target.value)
          }
          autoComplete="new-password"
          required
        />
        <p className="muted">
          Минимум 10 символов: заглавная, строчная, цифра и спецсимвол
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit">Сохранить</Button>
      </form>
    </AuthLayout>
  );
}
