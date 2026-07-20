import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Alert, Button, TextField } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, StatusChip } from "../patterns";
import { api, type User } from "../api";
import { useAuth } from "../auth";

export function AdminPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<User[] | null>(null);
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
    <PageLayout title="Админка">
      <form className="card stack" onSubmit={create}>
        <h2 className="section-title">Новый пользователь</h2>
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
          <Alert
            type="success"
            variant="tonal"
            title="Временный пароль"
            description={tempPassword}
          />
        )}
        {error && (
          <Alert
            type="error"
            variant="tonal"
            title="Ошибка"
            description={error}
          />
        )}
      </form>

      <h2 className="section-title">Пользователи</h2>
      <AsyncState
        loading={users === null && !error}
        empty={users !== null && users.length === 0}
        emptyTitle="Нет пользователей"
        emptyDescription="Добавьте первого пользователя формой выше."
      >
        <div className="stack">
          {(users ?? []).map((u) => (
            <div
              key={u.id}
              className="list-row list-row--static list-row--admin"
            >
              <div className="list-row__body">
                <strong>
                  {u.lastName} {u.firstName}
                </strong>
                <span className="muted">
                  {u.email} · {u.role}
                </span>
              </div>
              <StatusChip
                status={(u as User & { status?: string }).status ?? "active"}
                domain="user"
              />
              <div className="row">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    api
                      .blockUser(u.id)
                      .then(load)
                      .catch((e) => setError(e.message))
                  }
                >
                  Блок
                </Button>
                <Button
                  size="sm"
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
            </div>
          ))}
        </div>
      </AsyncState>
    </PageLayout>
  );
}
