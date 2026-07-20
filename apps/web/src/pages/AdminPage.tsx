import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Button, TextField } from "../ui";
import { api, type User } from "../api";
import { useAuth } from "../auth";

export function AdminPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await api.listUsers();
    setUsers(res.users);
  }

  useEffect(() => {
    if (user?.role === "admin") void load().catch((e) => setError(e.message));
  }, [user]);

  if (user?.role !== "admin") return <Navigate to="/" replace />;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.createUser({ email, firstName, lastName });
      setTempPassword(res.temporaryPassword);
      setEmail("");
      setFirstName("");
      setLastName("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="stack">
      <h1 className="page-title">Админка</h1>
      <form className="card stack" onSubmit={create}>
        <h2>Новый пользователь</h2>
        <TextField
          label="Email"
          value={email}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setEmail(e.target.value)
          }
          required
        />
        <TextField
          label="Имя"
          value={firstName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setFirstName(e.target.value)
          }
          required
        />
        <TextField
          label="Фамилия"
          value={lastName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setLastName(e.target.value)
          }
          required
        />
        <Button type="submit">Создать</Button>
        {tempPassword && (
          <p role="status">
            Временный пароль (показывается один раз): <code>{tempPassword}</code>
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </form>

      <h2>Пользователи</h2>
      {users.map((u) => (
        <div className="card row" key={u.id}>
          <div style={{ flex: 1 }}>
            <strong>
              {u.lastName} {u.firstName}
            </strong>
            <div className="muted">
              {u.email} · {u.role} · {(u as User & { status?: string }).status}
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={() =>
              api.blockUser(u.id).then(load).catch((e) => setError(e.message))
            }
          >
            Блок
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              api
                .resetPassword(u.id)
                .then((r) => setTempPassword(r.temporaryPassword))
                .catch((e) => setError(e.message))
            }
          >
            Сброс
          </Button>
        </div>
      ))}
    </div>
  );
}
