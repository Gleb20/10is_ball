import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Alert, Button, Dialog, TextField } from "../ui";
import { PageLayout } from "../layout";
import { StatusChip } from "../patterns";
import { api, type AdminUser, type AdminUserAuditFeed, type AdminUserAuditItem } from "../api";
import { useAuth } from "../auth";
import { AdminUserActions, type AdminUserAction } from "./AdminUserActions";
import { useAdminPasswordReset } from "../adminPasswordReset";

type Context = { key: string; generation: number; loadEffect: number; mutationEffect: number };
type ProfileDraft = {
  firstName: string; lastName: string; birthDate: string; organizationText: string; positionText: string;
};

const actionLabels: Record<AdminUserAuditItem["action"], string> = {
  "user.created": "Аккаунт создан",
  "user.updated": "Профиль изменён",
  "user.role_changed": "Роль изменена",
  "user.blocked": "Аккаунт заблокирован",
  "user.unblocked": "Аккаунт разблокирован",
  "user.password_reset": "Пароль сброшен",
  "admin.bootstrap_provisioned": "Администратор создан при запуске",
};
const fieldLabels: Record<AdminUserAuditItem["changedFields"][number], string> = {
  firstName: "Имя", lastName: "Фамилия", birthDate: "Дата рождения",
  organizationText: "Организация", positionText: "Должность", role: "Роль",
};
const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Moscow",
});
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "Europe/Moscow" });
const displayDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
};
const displayDateTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${dateTimeFormatter.format(date)} МСК`;
};
const isValidIsoDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
};
const mutationMessage = (error: unknown) => {
  const typed = error as Error & { status?: number };
  return !typed.status || typed.status >= 500
    ? "Результат операции не подтверждён. Обновите аккаунт перед повтором."
    : typed.message;
};

export function AdminUserPage() {
  const { id = "" } = useParams();
  const { user, reauthRequired } = useAuth();
  const passwordReset = useAdminPasswordReset();
  const actorKey = user?.role === "admin" ? user.id : reauthRequired ? "reauth" : "unauthorized";
  const routeKey = `/admin/users/${id}`;
  const key = `${actorKey}:${routeKey}`;
  const context = useRef<Context>({ key, generation: 1, loadEffect: 0, mutationEffect: 0 });
  if (context.current.key !== key) {
    context.current = { key, generation: context.current.generation + 1, loadEffect: 0, mutationEffect: 0 };
  }
  const generation = context.current.generation;
  const mutationActive = useRef(false);
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [feed, setFeed] = useState<AdminUserAuditFeed | null>(null);
  const [dataGeneration, setDataGeneration] = useState(0);
  const [loadingGeneration, setLoadingGeneration] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorGeneration, setLoadErrorGeneration] = useState(0);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationGeneration, setMutationGeneration] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionsGeneration, setActionsGeneration] = useState(0);
  const [confirm, setConfirm] = useState<AdminUserAction | null>(null);
  const [confirmGeneration, setConfirmGeneration] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [editGeneration, setEditGeneration] = useState(0);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const isCurrent = useCallback((token: { key: string; generation: number }) =>
    context.current.key === token.key && context.current.generation === token.generation, []);

  const load = useCallback(async () => {
    const current = context.current;
    if (!id || current.key.startsWith("reauth:") || current.key.startsWith("unauthorized:")) return;
    const token = { key: current.key, generation: current.generation, effect: ++current.loadEffect };
    setLoadingGeneration(token.generation);
    setLoadError(null); setLoadErrorGeneration(token.generation);
    try {
      const [userResponse, auditResponse] = await Promise.all([
        api.getAdminUser(id),
        api.listAdminUserAudit(id),
      ]);
      if (isCurrent(token) && context.current.loadEffect === token.effect) {
        setTarget(userResponse.user); setFeed(auditResponse); setDataGeneration(token.generation);
      }
    } catch (error) {
      if (isCurrent(token) && context.current.loadEffect === token.effect && (error as { status?: number }).status !== 401) {
        setLoadError((error as Error).message);
        setLoadErrorGeneration(token.generation);
      }
    } finally {
      if (isCurrent(token) && context.current.loadEffect === token.effect) setLoadingGeneration(0);
    }
  }, [id, isCurrent]);

  useEffect(() => {
    mutationActive.current = false;
    setTarget(null); setFeed(null); setDataGeneration(0); setLoadingGeneration(0);
    setLoadError(null); setAuditError(null); setMutationError(null); setMutationGeneration(0);
    setActionsOpen(false); setConfirm(null); setEditOpen(false); setDraft(null);
    if (user?.role === "admin") void load();
  }, [key, load, user?.role]);

  if (user?.role !== "admin" && !reauthRequired) return <Navigate to="/" replace />;
  const visibleTarget = dataGeneration === generation ? target : null;
  const visibleFeed = dataGeneration === generation ? feed : null;
  const visibleLoadError = loadErrorGeneration === generation ? loadError : null;
  const loading = loadingGeneration === generation || (user?.role === "admin" && visibleTarget === null && !visibleLoadError);
  const pending = mutationGeneration === generation;
  const showActions = actionsGeneration === generation && actionsOpen;
  const visibleConfirm = confirmGeneration === generation ? confirm : null;
  const visibleEdit = editGeneration === generation && editOpen;

  async function runMutation(task: (valid: () => boolean) => Promise<void>) {
    if (mutationActive.current) return;
    const current = context.current;
    const token = { key: current.key, generation: current.generation, effect: ++current.mutationEffect };
    mutationActive.current = true; setMutationGeneration(token.generation);
    const valid = () => isCurrent(token) && context.current.mutationEffect === token.effect;
    try {
      await task(valid);
    } finally {
      if (valid()) { mutationActive.current = false; setMutationGeneration(0); }
    }
  }

  async function loadMore() {
    if (!visibleFeed?.nextCursor) return;
    const current = context.current;
    const token = { key: current.key, generation: current.generation, effect: ++current.loadEffect };
    setAuditError(null);
    try {
      const next = await api.listAdminUserAudit(id, visibleFeed.nextCursor);
      if (isCurrent(token) && context.current.loadEffect === token.effect) {
        setFeed({ items: [...visibleFeed.items, ...next.items], nextCursor: next.nextCursor });
      }
    } catch (error) {
      if (isCurrent(token) && context.current.loadEffect === token.effect && (error as { status?: number }).status !== 401) {
        setAuditError((error as Error).message);
      }
    }
  }

  async function runConfirmedAction() {
    if (!visibleTarget || !visibleConfirm) return;
    const action = visibleConfirm;
    await runMutation(async (valid) => {
      setMutationError(null);
      try {
        if (action === "block") await api.blockUser(visibleTarget.id);
        else if (action === "unblock") await api.unblockUser(visibleTarget.id);
        else if (action === "promote") await api.updateUserRole(visibleTarget.id, "admin");
        else if (action === "demote") await api.updateUserRole(visibleTarget.id, "user");
        else throw new Error("Сброс пароля временно недоступен во время безопасного обновления");
        if (!valid()) return;
        setConfirm(null);
        await load();
      } catch (error) {
        if (valid() && (error as { status?: number }).status !== 401) setMutationError(mutationMessage(error));
      }
    });
  }

  function openEdit() {
    if (!visibleTarget) return;
    setDraft({
      firstName: visibleTarget.firstName, lastName: visibleTarget.lastName,
      birthDate: visibleTarget.birthDate ?? "", organizationText: visibleTarget.organizationText ?? "",
      positionText: visibleTarget.positionText ?? "",
    });
    setProfileError(null); setEditOpen(true); setEditGeneration(generation);
  }

  async function saveProfile() {
    if (!visibleTarget || !draft) return;
    const patch = {
      firstName: draft.firstName.trim(), lastName: draft.lastName.trim(),
      birthDate: draft.birthDate || null, organizationText: draft.organizationText.trim() || null,
      positionText: draft.positionText.trim() || null,
    };
    if (!patch.firstName || !patch.lastName) { setProfileError("Укажите имя и фамилию"); return; }
    if (patch.firstName.length > 100 || patch.lastName.length > 100) { setProfileError("Имя и фамилия должны быть не длиннее 100 символов"); return; }
    if (patch.birthDate && !isValidIsoDate(patch.birthDate)) { setProfileError("Укажите корректную дату рождения"); return; }
    if ((patch.organizationText?.length ?? 0) > 200 || (patch.positionText?.length ?? 0) > 200) {
      setProfileError("Организация и должность должны быть не длиннее 200 символов"); return;
    }
    await runMutation(async (valid) => {
      setProfileError(null);
      try {
        const response = await api.updateAdminUser(visibleTarget.id, patch);
        if (!valid()) return;
        setTarget(response.user); setEditOpen(false); setDraft(null);
      } catch (error) {
        if (valid() && (error as { status?: number }).status !== 401) setProfileError(mutationMessage(error));
      }
    });
  }

  const confirmTitle = visibleConfirm === "block" ? "Заблокировать пользователя?"
    : visibleConfirm === "unblock" ? "Разблокировать пользователя?"
      : visibleConfirm === "reset" ? "Сбросить пароль?"
        : visibleConfirm === "promote" ? "Сделать администратором?"
          : visibleConfirm === "demote" ? "Снять права администратора?" : "";

  if (loading) return <PageLayout title="Аккаунт пользователя"><div role="status" aria-label="Загружаем аккаунт">Загружаем аккаунт…</div></PageLayout>;
  if (!visibleTarget) return <PageLayout title="Аккаунт пользователя">
    <Alert type="error" variant="tonal" title="Не удалось загрузить аккаунт" description={visibleLoadError ?? "Аккаунт недоступен"} />
    <Button variant="secondary" onClick={() => void load()}>Повторить</Button>
  </PageLayout>;

  return <PageLayout title={`${visibleTarget.lastName} ${visibleTarget.firstName}`}>
    <section className="card stack" aria-label="Данные аккаунта">
      <div className="row"><StatusChip status={visibleTarget.status} domain="user" /><span>{visibleTarget.role === "admin" ? "Администратор" : "Игрок"}</span></div>
      <p>{visibleTarget.email}</p>
      <dl className="stack">
        <div><dt>Дата рождения</dt><dd>{visibleTarget.birthDate ? displayDate(visibleTarget.birthDate) : "Не указана"}</dd></div>
        <div><dt>Организация</dt><dd>{visibleTarget.organizationText ?? "Не указана"}</dd></div>
        <div><dt>Должность</dt><dd>{visibleTarget.positionText ?? "Не указана"}</dd></div>
        <div><dt>Создан</dt><dd>{displayDate(visibleTarget.createdAt)}</dd></div>
        <div><dt>Последний вход</dt><dd>{visibleTarget.lastLoginAt ? displayDateTime(visibleTarget.lastLoginAt) : "Ещё не входил"}</dd></div>
      </dl>
      <Button size="sm" variant="secondary" disabled={pending} onClick={openEdit}>Редактировать</Button>
      <AdminUserActions actorId={user?.id ?? null} target={visibleTarget} open={showActions} pending={pending}
        resetEnabled={passwordReset.enabled}
        groupLabel="Действия с аккаунтом"
        onToggle={() => { setActionsOpen(!showActions); setActionsGeneration(generation); }}
        onClose={() => setActionsOpen(false)}
        onAction={(action) => {
          if (action === "reset") {
            setActionsOpen(false);
            void passwordReset.open(visibleTarget);
            return;
          }
          setConfirm(action); setConfirmGeneration(generation);
        }} />
    </section>
    {mutationError ? <Alert type="error" variant="tonal" title="Результат действия" description={mutationError} /> : null}
    <section className="card stack" role="region" aria-label="История изменений">
      <h2 className="section-title">История изменений</h2>
      {visibleFeed?.items.length ? <ol className="stack">{visibleFeed.items.map((item) => <li key={item.id}>
        <strong>{actionLabels[item.action]}</strong>
        <div className="muted">{displayDateTime(item.createdAt)} · {item.actor?.displayName ?? "Система / автор не указан"}</div>
        {item.changedFields.length ? <div>Поля: {item.changedFields.map((field) => fieldLabels[field]).join(", ")}</div> : null}
      </li>)}</ol> : <p className="muted">Изменений пока нет.</p>}
      {auditError ? <Alert type="error" variant="tonal" title="Не удалось загрузить продолжение" description={auditError} /> : null}
      {visibleFeed?.nextCursor ? <Button variant="secondary" onClick={() => void loadMore()}>Показать ещё</Button> : null}
    </section>
    <Dialog open={visibleConfirm !== null} onClose={() => !pending && setConfirm(null)} title={confirmTitle} width="sm"
      secondaryButtonLabel="Отмена" onSecondaryButton={() => !pending && setConfirm(null)}
      mainButtonLabel={pending ? "…" : "Подтвердить"} onMainButton={() => void runConfirmedAction()}>
      <p>Действие относится к аккаунту {visibleTarget.email}. Продолжить?</p>
    </Dialog>
    <Dialog open={visibleEdit && draft !== null} onClose={() => !pending && setEditOpen(false)} title="Профиль пользователя" width="sm"
      secondaryButtonLabel="Отмена" onSecondaryButton={() => !pending && setEditOpen(false)}
      mainButtonLabel={pending ? "Сохранение…" : "Сохранить"} onMainButton={() => void saveProfile()}>
      {draft ? <div className="stack">
        <TextField label="Email" value={visibleTarget.email} readOnly />
        <TextField label="Имя" value={draft.firstName} maxLength={100} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, firstName: event.target.value })} />
        <TextField label="Фамилия" value={draft.lastName} maxLength={100} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, lastName: event.target.value })} />
        <TextField label="Дата рождения" type="date" value={draft.birthDate} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, birthDate: event.target.value })} />
        <TextField label="Организация" value={draft.organizationText} maxLength={200} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, organizationText: event.target.value })} />
        <TextField label="Должность" value={draft.positionText} maxLength={200} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, positionText: event.target.value })} />
        {profileError ? <Alert type="error" variant="tonal" title="Профиль не сохранён" description={profileError} /> : null}
      </div> : null}
    </Dialog>
  </PageLayout>;
}
