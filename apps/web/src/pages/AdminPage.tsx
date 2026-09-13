import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { Alert, Button, Dialog, TextField } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, StatusChip } from "../patterns";
import { TempPasswordPanel } from "../authUi";
import { api, type AdminUser } from "../api";
import { useAuth } from "../auth";
import { useSingleFlight } from "../useSingleFlight";

type ConfirmKind = "block" | "unblock" | "reset" | "promote" | "demote" | null;
type UserStatusFilter = "" | "active" | "blocked";
type ProfileDraft = {
  email: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  organizationText: string;
  positionText: string;
};

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeZone: "Europe/Moscow",
});

function formatAccountDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function isValidIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function AdminPage() {
  const { user, reauthRequired } = useAuth();
  const retainedAdminId = useRef(user?.role === "admin" ? user.id : null);
  if (user?.role === "admin") retainedAdminId.current = user.id;
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>("");
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; target: AdminUser | null }>({ kind: null, target: null });
  const [profileTargetId, setProfileTargetId] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const mutationInFlight = useRef(false);
  const mutationSubmission = useSingleFlight();

  const load = useCallback(async (
    nextQuery = "",
    nextStatus: UserStatusFilter = "",
    duringMutation = false,
  ) => {
    if (mutationInFlight.current && !duringMutation) return;
    const sequence = ++requestSequence.current;
    setLoadingUsers(true);
    setLoadError(null);
    try {
      const normalizedQuery = nextQuery.trim();
      const response = await api.listUsers(normalizedQuery || undefined, nextStatus || undefined);
      if (sequence === requestSequence.current) setUsers(response.users);
    } catch (error) {
      if (sequence === requestSequence.current && (error as Error & { status?: number }).status !== 401) {
        setLoadError((error as Error).message);
      }
    } finally {
      if (sequence === requestSequence.current) setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role !== "admin") {
      requestSequence.current += 1;
      return;
    }
    void load(query, statusFilter);
    return () => {
      requestSequence.current += 1;
    };
    // Query controls trigger their own loads; this effect follows the authenticated actor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, user?.id, user?.role]);

  if (user?.role !== "admin" && !reauthRequired) return <Navigate to="/" replace />;
  const actorId = user?.id ?? retainedAdminId.current;

  async function runMutation(task: () => Promise<void>) {
    await mutationSubmission.run(async () => {
      mutationInFlight.current = true;
      requestSequence.current += 1;
      setLoadingUsers(false);
      try {
        await task();
      } finally {
        mutationInFlight.current = false;
      }
    });
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    await runMutation(async () => {
      setActionError(null);
      try {
        const response = await api.createUser({ email, firstName, lastName, role });
        setTempPassword(response.temporaryPassword);
        setEmail("");
        setFirstName("");
        setLastName("");
        setRole("user");
        await load(query, statusFilter, true);
      } catch (error) {
        if ((error as Error & { status?: number }).status !== 401) setActionError((error as Error).message);
      }
    });
  }

  async function runConfirm() {
    const target = confirm.target;
    const kind = confirm.kind;
    if (!target || !kind) return;
    await runMutation(async () => {
      setActionError(null);
      try {
        if (kind === "block") await api.blockUser(target.id);
        else if (kind === "unblock") await api.unblockUser(target.id);
        else if (kind === "reset") {
          const response = await api.resetPassword(target.id);
          setTempPassword(response.temporaryPassword);
        } else if (kind === "promote") await api.updateUserRole(target.id, "admin");
        else await api.updateUserRole(target.id, "user");

        if (kind !== "reset") await load(query, statusFilter, true);
        setConfirm({ kind: null, target: null });
      } catch (error) {
        if ((error as Error & { status?: number }).status !== 401) setActionError((error as Error).message);
      }
    });
  }

  function openProfile(target: AdminUser) {
    setProfileTargetId(target.id);
    setProfileDraft({
      email: target.email,
      firstName: target.firstName,
      lastName: target.lastName,
      birthDate: target.birthDate ?? "",
      organizationText: target.organizationText ?? "",
      positionText: target.positionText ?? "",
    });
    setProfileError(null);
  }

  function closeProfile() {
    if (mutationSubmission.pending) return;
    setProfileTargetId(null);
    setProfileDraft(null);
    setProfileError(null);
  }

  async function saveProfile() {
    const targetId = profileTargetId;
    const draft = profileDraft;
    if (!targetId || !draft) return;
    const normalized = {
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      birthDate: draft.birthDate || null,
      organizationText: draft.organizationText.trim() || null,
      positionText: draft.positionText.trim() || null,
    };
    if (!normalized.firstName || !normalized.lastName) {
      setProfileError("Укажите имя и фамилию");
      return;
    }
    if (normalized.firstName.length > 100 || normalized.lastName.length > 100) {
      setProfileError("Имя и фамилия должны быть не длиннее 100 символов");
      return;
    }
    if (normalized.birthDate && !isValidIsoDate(normalized.birthDate)) {
      setProfileError("Укажите корректную дату рождения");
      return;
    }
    if ((normalized.organizationText?.length ?? 0) > 200 || (normalized.positionText?.length ?? 0) > 200) {
      setProfileError("Организация и должность должны быть не длиннее 200 символов");
      return;
    }

    await runMutation(async () => {
      setProfileError(null);
      try {
        const response = await api.updateAdminUser(targetId, normalized);
        setUsers((current) => current?.map((entry) => entry.id === targetId ? response.user : entry) ?? null);
        setProfileTargetId(null);
        setProfileDraft(null);
        await load(query, statusFilter, true);
      } catch (error) {
        if ((error as Error & { status?: number }).status !== 401) setProfileError((error as Error).message);
      }
    });
  }

  const confirmTitle = confirm.kind === "block"
    ? "Заблокировать пользователя?"
    : confirm.kind === "unblock"
      ? "Разблокировать пользователя?"
      : confirm.kind === "reset"
        ? "Сбросить пароль?"
        : confirm.kind === "promote"
          ? "Сделать администратором?"
          : confirm.kind === "demote"
            ? "Снять права администратора?"
            : "";
  const confirmBody = confirm.kind === "block"
    ? `Сессии ${confirm.target?.email ?? ""} будут отозваны. Продолжить?`
    : confirm.kind === "unblock"
      ? `${confirm.target?.email ?? ""} снова сможет войти и участвовать в новых событиях. Ранее отозванные сессии останутся недействительными.`
      : confirm.kind === "reset"
        ? `Будет выдан новый временный пароль для ${confirm.target?.email ?? ""}.`
        : confirm.kind === "promote" || confirm.kind === "demote"
          ? `Роль ${confirm.target?.email ?? ""} будет изменена. Все сессии пользователя будут сброшены — потребуется повторный вход.`
          : "";
  const mutationPending = mutationSubmission.pending;

  return (
    <PageLayout title="Админка">
      <form className="card stack" onSubmit={create} aria-label="Создание пользователя">
        <h2 className="section-title">Новый пользователь</h2>
        <TextField label="Email" value={email} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)} required />
        <TextField label="Имя" value={firstName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setFirstName(event.target.value)} required />
        <TextField label="Фамилия" value={lastName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setLastName(event.target.value)} required />
        <label className="stack" style={{ gap: 4 }}>
          <span>Роль</span>
          <select aria-label="Роль" value={role} onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "user")}>
            <option value="user">Игрок (user)</option>
            <option value="admin">Админ (admin)</option>
          </select>
        </label>
        <Button type="submit" disabled={mutationPending}>{mutationPending ? "Создание…" : "Создать"}</Button>
      </form>

      <h2 className="section-title">Пользователи</h2>
      <form
        className="card row"
        role="search"
        aria-label="Поиск пользователей"
        onSubmit={(event) => {
          event.preventDefault();
          if (mutationInFlight.current) return;
          void load(query, statusFilter);
        }}
      >
        <TextField label="Имя или email" value={query} maxLength={100} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} />
        <label className="stack" style={{ gap: 4 }}>
          <span>Статус</span>
          <select
            aria-label="Статус"
            value={statusFilter}
            disabled={mutationPending}
            onChange={(event) => {
              if (mutationInFlight.current) return;
              const next = event.target.value === "active" || event.target.value === "blocked" ? event.target.value : "";
              setStatusFilter(next);
              void load(query, next);
            }}
          >
            <option value="">Все</option>
            <option value="active">Активные</option>
            <option value="blocked">Заблокированные</option>
          </select>
        </label>
        <Button type="submit" variant="secondary" disabled={loadingUsers || mutationPending}>Найти</Button>
      </form>

      {actionError ? <Alert type="error" variant="tonal" title="Действие не выполнено" description={actionError} /> : null}
      {loadError ? (
        <div className="stack">
          <Alert type="error" variant="tonal" title="Не удалось загрузить пользователей" description={loadError} />
          <Button variant="secondary" disabled={mutationPending} onClick={() => void load(query, statusFilter)}>Повторить</Button>
        </div>
      ) : null}

      <AsyncState
        loading={users === null && loadingUsers}
        empty={users !== null && users.length === 0}
        emptyTitle="Пользователи не найдены"
        emptyDescription="Измените строку поиска или фильтр статуса."
      >
        <div className="stack">
          {(users ?? []).map((entry) => {
            const isSelf = entry.id === actorId;
            const isBlocked = entry.status === "blocked";
            return (
              <div key={entry.id} className="list-row list-row--static list-row--admin">
                <div className="list-row__body">
                  <strong>{entry.lastName} {entry.firstName}</strong>
                  <span className="muted">{entry.email} · {entry.role}{isSelf ? " · вы" : ""}</span>
                  <span className="muted">Создан: {formatAccountDate(entry.createdAt)}</span>
                  <span className="muted">{entry.lastLoginAt ? `Последний вход: ${formatAccountDate(entry.lastLoginAt)}` : "Ещё не входил"}</span>
                </div>
                <StatusChip status={entry.status} domain="user" />
                <div className="row">
                  <Button size="sm" variant="secondary" disabled={mutationPending} onClick={() => openProfile(entry)}>Редактировать</Button>
                  {!isSelf && entry.role === "user" ? (
                    <Button size="sm" variant="secondary" disabled={mutationPending} onClick={() => setConfirm({ kind: "promote", target: entry })}>Сделать админом</Button>
                  ) : null}
                  {!isSelf && entry.role === "admin" ? (
                    <Button size="sm" variant="secondary" disabled={mutationPending} onClick={() => setConfirm({ kind: "demote", target: entry })}>Снять админа</Button>
                  ) : null}
                  {isBlocked ? (
                    <Button size="sm" variant="secondary" disabled={mutationPending} onClick={() => setConfirm({ kind: "unblock", target: entry })}>Разблокировать</Button>
                  ) : !isSelf ? (
                    <Button size="sm" variant="secondary" disabled={mutationPending} onClick={() => setConfirm({ kind: "block", target: entry })}>Блок</Button>
                  ) : null}
                  <Button size="sm" variant="secondary" disabled={mutationPending} onClick={() => setConfirm({ kind: "reset", target: entry })}>Сброс</Button>
                </div>
              </div>
            );
          })}
        </div>
      </AsyncState>

      <Dialog
        open={confirm.kind !== null}
        onClose={() => !mutationPending && setConfirm({ kind: null, target: null })}
        title={confirmTitle}
        width="sm"
        secondaryButtonLabel="Отмена"
        onSecondaryButton={() => !mutationPending && setConfirm({ kind: null, target: null })}
        mainButtonLabel={mutationPending ? "…" : "Подтвердить"}
        onMainButton={() => void runConfirm()}
      >
        <p>{confirmBody}</p>
      </Dialog>

      <Dialog
        open={profileTargetId !== null && profileDraft !== null}
        onClose={closeProfile}
        title="Профиль пользователя"
        width="sm"
        secondaryButtonLabel="Отмена"
        onSecondaryButton={closeProfile}
        mainButtonLabel={mutationPending ? "Сохранение…" : "Сохранить"}
        onMainButton={() => void saveProfile()}
      >
        {profileDraft ? (
          <div className="stack">
            <TextField label="Email" value={profileDraft.email} readOnly />
            <TextField label="Имя" value={profileDraft.firstName} maxLength={100} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setProfileDraft({ ...profileDraft, firstName: event.target.value })} />
            <TextField label="Фамилия" value={profileDraft.lastName} maxLength={100} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setProfileDraft({ ...profileDraft, lastName: event.target.value })} />
            <TextField label="Дата рождения" type="date" value={profileDraft.birthDate} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setProfileDraft({ ...profileDraft, birthDate: event.target.value })} />
            <TextField label="Организация" value={profileDraft.organizationText} maxLength={200} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setProfileDraft({ ...profileDraft, organizationText: event.target.value })} />
            <TextField label="Должность" value={profileDraft.positionText} maxLength={200} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setProfileDraft({ ...profileDraft, positionText: event.target.value })} />
            {profileError ? <Alert type="error" variant="tonal" title="Профиль не сохранён" description={profileError} /> : null}
          </div>
        ) : null}
      </Dialog>

      <Dialog open={tempPassword !== null} onClose={() => setTempPassword(null)} title="Временный пароль" width="sm" mainButtonLabel="Готово" onMainButton={() => setTempPassword(null)}>
        {tempPassword ? <TempPasswordPanel password={tempPassword} onDismiss={() => setTempPassword(null)} /> : null}
      </Dialog>
    </PageLayout>
  );
}
