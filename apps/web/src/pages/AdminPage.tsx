import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Alert, Button, Dialog, TextField } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, StatusChip } from "../patterns";
import { TempPasswordPanel } from "../authUi";
import { api, type User } from "../api";
import { useAuth } from "../auth";

type ConfirmKind = "block" | "reset" | "promote" | "demote" | null;

export function AdminPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<User[] | null>(null);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    kind: ConfirmKind;
    target: User | null;
  }>({ kind: null, target: null });
  const [busy, setBusy] = useState(false);

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
      const res = await api.createUser({ email, firstName, lastName, role });
      setTempPassword(res.temporaryPassword);
      setEmail("");
      setFirstName("");
      setLastName("");
      setRole("user");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function runConfirm() {
    const target = confirm.target;
    const kind = confirm.kind;
    if (!target || !kind) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "block") {
        await api.blockUser(target.id);
        await load();
      } else if (kind === "reset") {
        const r = await api.resetPassword(target.id);
        setTempPassword(r.temporaryPassword);
      } else if (kind === "promote") {
        await api.updateUserRole(target.id, "admin");
        await load();
      } else if (kind === "demote") {
        await api.updateUserRole(target.id, "user");
        await load();
      }
      setConfirm({ kind: null, target: null });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const confirmTitle =
    confirm.kind === "block"
      ? "Заблокировать пользователя?"
      : confirm.kind === "reset"
        ? "Сбросить пароль?"
        : confirm.kind === "promote"
          ? "Сделать администратором?"
          : confirm.kind === "demote"
            ? "Снять права администратора?"
            : "";
  const confirmBody =
    confirm.kind === "block"
      ? `Сессии ${confirm.target?.email ?? ""} будут отозваны. Продолжить?`
      : confirm.kind === "reset"
        ? `Будет выдан новый временный пароль для ${confirm.target?.email ?? ""}.`
        : confirm.kind === "promote" || confirm.kind === "demote"
          ? `Роль ${confirm.target?.email ?? ""} будет изменена. Все сессии пользователя будут сброшены — потребуется повторный вход.`
          : "";

  return (
    <PageLayout title="Админка">
      <form
        className="card stack"
        onSubmit={create}
        aria-label="Создание пользователя"
      >
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
        <label className="stack" style={{ gap: 4 }}>
          <span>Роль</span>
          <select
            aria-label="Роль"
            value={role}
            onChange={(e) =>
              setRole(e.target.value === "admin" ? "admin" : "user")
            }
          >
            <option value="user">Игрок (user)</option>
            <option value="admin">Админ (admin)</option>
          </select>
        </label>
        <Button type="submit">Создать</Button>
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
          {(users ?? []).map((u) => {
            const isSelf = u.id === user?.id;
            return (
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
                    {isSelf ? " · вы" : ""}
                  </span>
                </div>
                <StatusChip
                  status={(u as User & { status?: string }).status ?? "active"}
                  domain="user"
                />
                <div className="row">
                  {!isSelf && u.role === "user" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setConfirm({ kind: "promote", target: u })
                      }
                    >
                      Сделать админом
                    </Button>
                  ) : null}
                  {!isSelf && u.role === "admin" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setConfirm({ kind: "demote", target: u })}
                    >
                      Снять админа
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirm({ kind: "block", target: u })}
                  >
                    Блок
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirm({ kind: "reset", target: u })}
                  >
                    Сброс
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </AsyncState>

      <Dialog
        open={confirm.kind !== null}
        onClose={() => !busy && setConfirm({ kind: null, target: null })}
        title={confirmTitle}
        width="sm"
        secondaryButtonLabel="Отмена"
        onSecondaryButton={() => setConfirm({ kind: null, target: null })}
        mainButtonLabel={busy ? "…" : "Подтвердить"}
        onMainButton={() => void runConfirm()}
      >
        <p>{confirmBody}</p>
      </Dialog>

      <Dialog
        open={tempPassword !== null}
        onClose={() => setTempPassword(null)}
        title="Временный пароль"
        width="sm"
        mainButtonLabel="Готово"
        onMainButton={() => setTempPassword(null)}
      >
        {tempPassword ? (
          <TempPasswordPanel
            password={tempPassword}
            onDismiss={() => setTempPassword(null)}
          />
        ) : null}
      </Dialog>
    </PageLayout>
  );
}
