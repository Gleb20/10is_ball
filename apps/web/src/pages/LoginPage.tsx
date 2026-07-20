import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, TextField } from "../ui";
import { api } from "../api";
import { useAuth } from "../auth";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { setUser, refresh } = useAuth();
  const navigate = useNavigate();

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
        navigate("/");
      }
    } catch (err) {
      setError((err as Error).message || "Ошибка входа");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login-page">
      <h1 className="page-title">Tab-10</h1>
      <p className="muted">Вход в сервис настольного тенниса</p>
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
          required
        />
        <TextField
          label="Пароль"
          type="password"
          name="password"
          value={password}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setPassword(e.target.value)
          }
          autoComplete="current-password"
          required
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Вход…" : "Войти"}
        </Button>
      </form>
    </div>
  );
}
