import type { KeyboardEvent } from "react";
import type { AdminUser } from "../api";
import { Button } from "../ui";

export type AdminUserAction = "block" | "unblock" | "reset" | "promote" | "demote";

type Props = {
  actorId: string | null;
  target: AdminUser;
  open: boolean;
  pending: boolean;
  resetEnabled?: boolean;
  groupLabel: string;
  onToggle: () => void;
  onClose: () => void;
  onAction: (action: AdminUserAction) => void;
};

function triggerId(userId: string) {
  return `admin-user-actions-trigger-${userId}`;
}

function groupId(userId: string) {
  return `admin-user-actions-${userId}`;
}

function resetAvailabilityId(userId: string) {
  return `admin-user-reset-availability-${userId}`;
}

export function focusAdminUserActionsTrigger(userId: string) {
  document.getElementById(triggerId(userId))?.focus();
}

export function AdminUserActions({
  actorId,
  target,
  open,
  pending,
  resetEnabled = false,
  groupLabel,
  onToggle,
  onClose,
  onAction,
}: Props) {
  const isSelf = actorId === target.id;
  const closeOnEscape = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    focusAdminUserActionsTrigger(target.id);
    onClose();
  };

  return (
    <div className="stack admin-user-actions" style={{ gap: 8 }}>
      <Button
        id={triggerId(target.id)}
        size="sm"
        variant="secondary"
        aria-expanded={open}
        aria-controls={groupId(target.id)}
        disabled={pending}
        onClick={onToggle}
      >
        Действия
      </Button>
      {open ? (
        <div
          id={groupId(target.id)}
          className="row"
          role="group"
          aria-label={groupLabel}
          onKeyDown={closeOnEscape}
        >
          {!isSelf && target.role === "user" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => onAction("promote")}>Сделать администратором</Button>
          ) : null}
          {!isSelf && target.role === "admin" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => onAction("demote")}>Снять права администратора</Button>
          ) : null}
          {target.status === "blocked" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => onAction("unblock")}>Разблокировать</Button>
          ) : !isSelf ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => onAction("block")}>Заблокировать</Button>
          ) : null}
          {resetEnabled ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => onAction("reset")}
            >
              Сбросить пароль
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled
                aria-describedby={resetAvailabilityId(target.id)}
              >
                Сбросить пароль
              </Button>
              <span
                id={resetAvailabilityId(target.id)}
                className="muted"
                role="status"
              >
                Временно недоступно во время безопасного обновления
              </span>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
