import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Alert, Button, Dialog, TextField } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, StatusChip } from "../patterns";
import { TempPasswordPanel } from "../authUi";
import { api, type AdminUser } from "../api";
import { useAuth } from "../auth";
import { AdminUserActions, type AdminUserAction } from "./AdminUserActions";

type UserStatusFilter = "" | "active" | "blocked";
type Context = { actorKey: string; generation: number; loadEffect: number; mutationEffect: number };
type AdminReturnContext = {
  v: 1;
  userId: string;
  detailPath: string;
  queryInput: string;
  appliedQuery: string;
  status: UserStatusFilter;
  scrollY: number;
  focusUserId: string;
};

const ADMIN_RETURN_KEY = "tab10.admin.return";

function readAdminReturnContext(userId?: string): AdminReturnContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ADMIN_RETURN_KEY);
    window.sessionStorage.removeItem(ADMIN_RETURN_KEY);
    if (!raw || !userId) return null;
    const value = JSON.parse(raw) as Partial<AdminReturnContext>;
    if (value.v !== 1 || value.userId !== userId || typeof value.focusUserId !== "string" || !value.focusUserId ||
        value.detailPath !== `/admin/users/${value.focusUserId}` || typeof value.queryInput !== "string" ||
        typeof value.appliedQuery !== "string" || typeof value.status !== "string" ||
        !["", "active", "blocked"].includes(value.status) ||
        typeof value.scrollY !== "number" || !Number.isFinite(value.scrollY) || value.scrollY < 0) return null;
    return value as AdminReturnContext;
  } catch {
    try { window.sessionStorage.removeItem(ADMIN_RETURN_KEY); } catch { /* context is optional */ }
    return null;
  }
}

const dateFormatter = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "Europe/Moscow" });
const formatAccountDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
};
const mutationMessage = (error: unknown) => {
  const typed = error as Error & { status?: number };
  return !typed.status || typed.status >= 500
    ? "Результат операции не подтверждён. Обновите данные перед повтором."
    : typed.message;
};

export function AdminPage() {
  const { user, reauthRequired } = useAuth();
  const restoredRef = useRef<AdminReturnContext | null | undefined>(undefined);
  if (restoredRef.current === undefined) {
    restoredRef.current = readAdminReturnContext(user?.role === "admin" ? user.id : undefined);
  }
  const restored = restoredRef.current;
  const restoreScrollRef = useRef(restored?.scrollY ?? null);
  const restoreFocusRef = useRef(restored?.focusUserId ?? null);
  const lastAdminIdRef = useRef(user?.role === "admin" ? user.id : null);
  const actorKey = user?.role === "admin" ? user.id : reauthRequired ? "reauth" : "unauthorized";
  const context = useRef<Context>({ actorKey, generation: 1, loadEffect: 0, mutationEffect: 0 });
  if (context.current.actorKey !== actorKey) {
    context.current = { actorKey, generation: context.current.generation + 1, loadEffect: 0, mutationEffect: 0 };
  }
  const generation = context.current.generation;
  const filtersRef = useRef<{ query: string; status: UserStatusFilter }>({
    query: restored?.appliedQuery ?? "",
    status: restored?.status ?? "",
  });
  const mutationActive = useRef(false);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [usersGeneration, setUsersGeneration] = useState(0);
  const [loadingGeneration, setLoadingGeneration] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorGeneration, setLoadErrorGeneration] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionErrorGeneration, setActionErrorGeneration] = useState(0);
  const [query, setQuery] = useState(restored?.queryInput ?? "");
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>(restored?.status ?? "");
  const [openActions, setOpenActions] = useState<string | null>(null);
  const [actionsGeneration, setActionsGeneration] = useState(0);
  const [mutationGeneration, setMutationGeneration] = useState(0);
  const [confirm, setConfirm] = useState<{ action: AdminUserAction; target: AdminUser } | null>(null);
  const [confirmGeneration, setConfirmGeneration] = useState(0);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [tempGeneration, setTempGeneration] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [createGeneration, setCreateGeneration] = useState(0);
  const [discardCreateOpen, setDiscardCreateOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");

  const isCurrent = useCallback((token: { actorKey: string; generation: number }) =>
    context.current.actorKey === token.actorKey && context.current.generation === token.generation, []);

  const load = useCallback(async (nextQuery: string, nextStatus: UserStatusFilter) => {
    const current = context.current;
    if (current.actorKey === "reauth" || current.actorKey === "unauthorized") return;
    const token = { actorKey: current.actorKey, generation: current.generation, effect: ++current.loadEffect };
    setLoadingGeneration(token.generation);
    setLoadError(null); setLoadErrorGeneration(token.generation);
    try {
      const response = await api.listUsers(nextQuery.trim() || undefined, nextStatus || undefined);
      if (isCurrent(token) && context.current.loadEffect === token.effect) {
        setUsers(response.users);
        setUsersGeneration(token.generation);
      }
    } catch (error) {
      if (isCurrent(token) && context.current.loadEffect === token.effect && (error as { status?: number }).status !== 401) {
        setLoadError((error as Error).message);
        setLoadErrorGeneration(token.generation);
      }
    } finally {
      if (isCurrent(token) && context.current.loadEffect === token.effect) setLoadingGeneration(0);
    }
  }, [isCurrent]);

  useEffect(() => {
    mutationActive.current = false;
    setUsers(null); setUsersGeneration(0); setLoadingGeneration(0);
    setLoadError(null); setActionError(null); setOpenActions(null); setConfirm(null);
    setTempPassword(null); setMutationGeneration(0);
    setCreateOpen(false); setDiscardCreateOpen(false); setCreateGeneration(0);
    setEmail(""); setFirstName(""); setLastName(""); setRole("user");
    if (user?.role === "admin") {
      if (lastAdminIdRef.current !== null && lastAdminIdRef.current !== user.id) {
        filtersRef.current = { query: "", status: "" };
        setQuery(""); setStatusFilter("");
        restoreScrollRef.current = null; restoreFocusRef.current = null;
      }
      lastAdminIdRef.current = user.id;
      void load(filtersRef.current.query, filtersRef.current.status);
    }
  }, [actorKey, load, user?.role]);

  const visibleUsers = usersGeneration === generation ? users : null;
  useEffect(() => {
    if (user?.role !== "admin" || visibleUsers === null ||
        (restoreScrollRef.current === null && restoreFocusRef.current === null)) return;
    const scrollY = restoreScrollRef.current;
    const focusUserId = restoreFocusRef.current;
    restoreScrollRef.current = null;
    restoreFocusRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      if (scrollY !== null) window.scrollTo(0, scrollY);
      if (focusUserId) document.getElementById(`admin-user-link-${focusUserId}`)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [user?.role, visibleUsers]);

  if (user?.role !== "admin" && !reauthRequired) return <Navigate to="/" replace />;
  const loading = loadingGeneration === generation || (user?.role === "admin" && visibleUsers === null);
  const mutationPending = mutationGeneration === generation;
  const visibleOpenActions = actionsGeneration === generation ? openActions : null;
  const visibleConfirm = confirmGeneration === generation ? confirm : null;
  const visibleTempPassword = tempGeneration === generation ? tempPassword : null;
  const visibleLoadError = loadErrorGeneration === generation ? loadError : null;
  const visibleActionError = actionErrorGeneration === generation ? actionError : null;
  const visibleCreateOpen = createGeneration === generation && createOpen;
  const visibleDiscardCreateOpen = createGeneration === generation && discardCreateOpen;
  const createDirty = Boolean(email || firstName || lastName || role !== "user");

  function rememberAdminReturn(target: AdminUser) {
    if (!user || user.role !== "admin" || visibleUsers === null) return;
    try {
      window.sessionStorage.setItem(ADMIN_RETURN_KEY, JSON.stringify({
        v: 1,
        userId: user.id,
        detailPath: `/admin/users/${target.id}`,
        queryInput: query,
        appliedQuery: filtersRef.current.query,
        status: filtersRef.current.status,
        scrollY: window.scrollY,
        focusUserId: target.id,
      } satisfies AdminReturnContext));
    } catch { /* navigation still works without saved list position */ }
  }

  async function runMutation(task: (valid: () => boolean) => Promise<void>) {
    if (mutationActive.current) return;
    const current = context.current;
    const token = { actorKey: current.actorKey, generation: current.generation, effect: ++current.mutationEffect };
    mutationActive.current = true;
    setMutationGeneration(token.generation);
    const valid = () => isCurrent(token) && context.current.mutationEffect === token.effect;
    try {
      await task(valid);
    } finally {
      if (valid()) {
        mutationActive.current = false;
        setMutationGeneration(0);
      }
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    await runMutation(async (valid) => {
      setActionError(null); setActionErrorGeneration(generation);
      try {
        const response = await api.createUser({ email, firstName, lastName, role });
        if (!valid()) return;
        setTempPassword(response.temporaryPassword); setTempGeneration(generation);
        setEmail(""); setFirstName(""); setLastName(""); setRole("user"); setCreateOpen(false);
        await load(filtersRef.current.query, filtersRef.current.status);
      } catch (error) {
        if (valid() && (error as { status?: number }).status !== 401) {
          setActionError(mutationMessage(error)); setActionErrorGeneration(generation);
        }
      }
    });
  }

  async function runConfirmedAction() {
    if (!visibleConfirm) return;
    const { action, target } = visibleConfirm;
    await runMutation(async (valid) => {
      setActionError(null); setActionErrorGeneration(generation);
      try {
        if (action === "block") await api.blockUser(target.id);
        else if (action === "unblock") await api.unblockUser(target.id);
        else if (action === "promote") await api.updateUserRole(target.id, "admin");
        else if (action === "demote") await api.updateUserRole(target.id, "user");
        else {
          const response = await api.resetPassword(target.id);
          if (!valid()) return;
          setTempPassword(response.temporaryPassword); setTempGeneration(generation);
        }
        if (!valid()) return;
        setConfirm(null);
        if (action !== "reset") await load(filtersRef.current.query, filtersRef.current.status);
      } catch (error) {
        if (valid() && (error as { status?: number }).status !== 401) {
          setActionError(mutationMessage(error)); setActionErrorGeneration(generation);
        }
      }
    });
  }

  const confirmTitle = visibleConfirm?.action === "block" ? "Заблокировать пользователя?"
    : visibleConfirm?.action === "unblock" ? "Разблокировать пользователя?"
      : visibleConfirm?.action === "reset" ? "Сбросить пароль?"
        : visibleConfirm?.action === "promote" ? "Сделать администратором?"
          : visibleConfirm?.action === "demote" ? "Снять права администратора?" : "";

  return <PageLayout title="Админка">
    <h2 className="section-title">Пользователи</h2>
    <form className="card row" role="search" aria-label="Поиск пользователей" onSubmit={(event) => {
      event.preventDefault();
      filtersRef.current = { query, status: statusFilter };
      void load(query, statusFilter);
    }}>
      <TextField label="Имя или email" value={query} maxLength={100} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} />
      <label className="stack" style={{ gap: 4 }}><span>Статус</span>
        <select aria-label="Статус" value={statusFilter} disabled={mutationPending} onChange={(event) => {
          const next = event.target.value === "active" || event.target.value === "blocked" ? event.target.value : "";
          setStatusFilter(next); filtersRef.current = { query, status: next }; void load(query, next);
        }}>
          <option value="">Все</option><option value="active">Активные</option><option value="blocked">Заблокированные</option>
        </select>
      </label>
      <Button type="submit" variant="secondary" disabled={loading || mutationPending}>Найти</Button>
    </form>
    {visibleUsers ? <p className="muted">Найдено: {visibleUsers.length}</p> : null}
    <Button variant="secondary" aria-expanded={visibleCreateOpen} aria-controls="admin-create-user" disabled={mutationPending} onClick={() => {
      setCreateGeneration(generation);
      if (visibleCreateOpen && createDirty) setDiscardCreateOpen(true); else setCreateOpen(!visibleCreateOpen);
    }}>Добавить пользователя</Button>
    {visibleCreateOpen ? <form id="admin-create-user" className="card stack" onSubmit={create} aria-label="Создание пользователя">
      <h2 className="section-title">Новый пользователь</h2>
      <TextField label="Email" value={email} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)} required />
      <TextField label="Имя" value={firstName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setFirstName(event.target.value)} required />
      <TextField label="Фамилия" value={lastName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setLastName(event.target.value)} required />
      <label className="stack" style={{ gap: 4 }}><span>Роль</span>
        <select aria-label="Роль" value={role} onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "user")}>
          <option value="user">Игрок (user)</option><option value="admin">Админ (admin)</option>
        </select>
      </label>
      <div className="row"><Button type="submit" disabled={mutationPending}>{mutationPending ? "Создание…" : "Создать"}</Button>
        <Button type="button" variant="secondary" disabled={mutationPending} onClick={() => createDirty ? setDiscardCreateOpen(true) : setCreateOpen(false)}>Закрыть</Button>
      </div>
    </form> : null}
    {visibleActionError ? <Alert type="error" variant="tonal" title="Результат действия" description={visibleActionError} /> : null}
    {visibleLoadError ? <div className="stack"><Alert type="error" variant="tonal" title="Не удалось загрузить пользователей" description={visibleLoadError} />
      <Button variant="secondary" disabled={mutationPending} onClick={() => void load(filtersRef.current.query, filtersRef.current.status)}>Повторить</Button></div> : null}
    <AsyncState loading={loading} empty={visibleUsers !== null && visibleUsers.length === 0} emptyTitle="Пользователи не найдены" emptyDescription="Измените строку поиска или фильтр статуса.">
      <div className="stack">{(visibleUsers ?? []).map((entry) => <div key={entry.id} className="list-row list-row--static list-row--admin">
        <div className="list-row__body">
          <strong><Link id={`admin-user-link-${entry.id}`} to={`/admin/users/${entry.id}`}
            state={{ returnTo: "/admin", returnLabel: "К пользователям" }} onClick={() => rememberAdminReturn(entry)}>
            {entry.lastName} {entry.firstName}
          </Link></strong>
          <span className="muted">{entry.email} · {entry.role}{entry.id === user?.id ? " · вы" : ""}</span>
          <span className="muted">Создан: {formatAccountDate(entry.createdAt)}</span>
          <span className="muted">{entry.lastLoginAt ? `Последний вход: ${formatAccountDate(entry.lastLoginAt)}` : "Ещё не входил"}</span>
        </div>
        <StatusChip status={entry.status} domain="user" />
        <AdminUserActions actorId={user?.id ?? null} target={entry} open={visibleOpenActions === entry.id} pending={mutationPending}
          groupLabel={`Действия: ${entry.lastName} ${entry.firstName}`}
          onToggle={() => { setOpenActions(visibleOpenActions === entry.id ? null : entry.id); setActionsGeneration(generation); }}
          onClose={() => setOpenActions(null)}
          onAction={(action) => { setConfirm({ action, target: entry }); setConfirmGeneration(generation); }} />
      </div>)}</div>
    </AsyncState>
    <Dialog open={visibleConfirm !== null} onClose={() => !mutationPending && setConfirm(null)} title={confirmTitle} width="sm"
      secondaryButtonLabel="Отмена" onSecondaryButton={() => !mutationPending && setConfirm(null)}
      mainButtonLabel={mutationPending ? "…" : "Подтвердить"} onMainButton={() => void runConfirmedAction()}>
      <p>Действие относится к аккаунту {visibleConfirm?.target.email ?? ""}. Продолжить?</p>
    </Dialog>
    <Dialog open={visibleDiscardCreateOpen} onClose={() => setDiscardCreateOpen(false)} title="Закрыть форму?" width="sm"
      secondaryButtonLabel="Продолжить заполнение" onSecondaryButton={() => setDiscardCreateOpen(false)}
      mainButtonLabel="Удалить черновик" onMainButton={() => {
        setEmail(""); setFirstName(""); setLastName(""); setRole("user"); setDiscardCreateOpen(false); setCreateOpen(false);
      }}><p>Введённые данные не сохранятся.</p></Dialog>
    <Dialog open={visibleTempPassword !== null} onClose={() => setTempPassword(null)} title="Временный пароль" width="sm"
      mainButtonLabel="Готово" onMainButton={() => setTempPassword(null)}>
      {visibleTempPassword ? <TempPasswordPanel password={visibleTempPassword} onDismiss={() => setTempPassword(null)} /> : null}
    </Dialog>
  </PageLayout>;
}
