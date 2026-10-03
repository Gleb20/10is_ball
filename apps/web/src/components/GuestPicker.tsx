import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { GuestIdentity } from "@tab10/shared";
import { api } from "../api";
import { avatarSrc } from "../avatarSrc";
import { initialsFromName } from "../rankingUi";
import { Alert, Autocomplete, Avatar, Button, Dialog, TextField } from "../ui";
import { useGuestIdentityMutation, type GuestIdentityMutationScope } from "../useGuestIdentityMutation";

const EMPTY_IDS: string[] = [];

export function guestRecordLabel(guestId: string): string {
  const compact = guestId.replace(/[^0-9a-z]/gi, "");
  return `№ ${compact.slice(-6).toUpperCase()}`;
}

type GuestPickerProps = {
  label: string;
  value: Pick<GuestIdentity, "id" | "displayName" | "avatarKey"> | null;
  onChange: (guest: GuestIdentity | null) => void;
  excludeGuestIds?: string[];
  disabled?: boolean;
  onOpenCatalogue?: () => void;
  mutationScope?: GuestIdentityMutationScope;
};

export function GuestPicker({
  label,
  value,
  onChange,
  excludeGuestIds = EMPTY_IDS,
  disabled = false,
  onOpenCatalogue,
  mutationScope,
}: GuestPickerProps) {
  const [guests, setGuests] = useState<GuestIdentity[]>([]);
  const [query, setQuery] = useState("");
  const [catalogueState, setCatalogueState] = useState<"loading" | "ready" | "error">("loading");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const fieldId = useId();
  const retryId = useId();
  const catalogueSequenceRef = useRef(0);
  const appliedSuccess = useRef<string | null>(null);
  const mutation = useGuestIdentityMutation(mutationScope);

  const excludeKey = useMemo(
    () => [...excludeGuestIds].sort().join(","),
    [excludeGuestIds],
  );

  useEffect(() => {
    const controller = new AbortController();
    const request = ++catalogueSequenceRef.current;
    setCatalogueState("loading");
    void api.listGuests({
      q: query.trim() || undefined,
      limit: 50,
      signal: controller.signal,
    }).then((response) => {
      if (controller.signal.aborted || request !== catalogueSequenceRef.current) return;
      const excluded = new Set(excludeKey.split(",").filter(Boolean));
      setGuests(response.guests.filter((guest) => !excluded.has(guest.id)));
      setCatalogueState("ready");
    }).catch(() => {
      if (!controller.signal.aborted && request === catalogueSequenceRef.current) setCatalogueState("error");
    });
    return () => {
      controller.abort();
    };
  }, [
    excludeKey,
    mutationScope?.actorId,
    mutationScope?.authEpoch,
    mutationScope?.routeKey,
    query,
    reloadVersion,
  ]);

  useEffect(() => {
    if (mutation.state.kind !== "success") return;
    if (appliedSuccess.current === mutation.state.guest.id) return;
    appliedSuccess.current = mutation.state.guest.id;
    setCreateOpen(false);
    if (!mutation.state.recovered) onChange(mutation.state.guest);
  }, [mutation.state, onChange]);

  const options = guests.map((guest) => ({
    value: guest.id,
    label: `${guest.displayName} · ${guestRecordLabel(guest.id)}`,
  }));
  if (value && !options.some((option) => option.value === value.id)) {
    options.unshift({
      value: value.id,
      label: `${value.displayName} · ${guestRecordLabel(value.id)}`,
    });
  }

  const busy = mutation.state.kind === "pending";
  const canCreate = firstName.trim().length > 0 && lastName.trim().length > 0;

  return (
    <div className="guest-picker stack" aria-busy={catalogueState === "loading"}>
      <Autocomplete
        id={fieldId}
        label={label}
        placeholder="Найдите сохранённого гостя"
        options={options}
        value={value?.id ?? ""}
        inputValue={query}
        onInputChange={setQuery}
        onChange={(guestId) => {
          if (!guestId) {
            onChange(null);
            return;
          }
          const selected = guests.find((guest) => guest.id === guestId) ?? null;
          if (selected) onChange(selected);
        }}
        clearable
        fullWidth
        disabled={disabled || catalogueState === "loading"}
        error={catalogueState === "error"}
      />

      {value ? (
        <div className="guest-picker__selection" data-testid="selected-guest">
          <Avatar
            size="sm"
            variant="tonal"
            src={avatarSrc(value.avatarKey)}
            initials={initialsFromName(value.displayName)}
            alt=""
          />
          <span>
            <strong>{value.displayName}</strong>
            <small className="muted">{guestRecordLabel(value.id)}</small>
          </span>
        </div>
      ) : null}

      {catalogueState === "loading" ? (
        <p className="muted" role="status" aria-live="polite">Загружаем гостей…</p>
      ) : null}
      {catalogueState === "ready" && guests.length === 0 ? (
        <p className="muted" role="status" aria-live="polite">
          {query ? "Сохранённых гостей с таким именем нет" : "Сохранённых гостей пока нет"}
        </p>
      ) : null}
      {catalogueState === "error" ? (
        <Alert
          type="error"
          variant="tonal"
          title="Не удалось загрузить гостей"
          description="Выбранный гость сохранён. Можно повторить загрузку списка."
          actionLabel="Повторить"
          onAction={() => setReloadVersion((version) => version + 1)}
          id={retryId}
        />
      ) : null}

      {mutation.state.kind === "success" && mutation.state.recovered ? (
        <Alert
          type="success"
          variant="tonal"
          title="Гость сохранён"
          description={`${mutation.state.guest.displayName} сохранён. Подтвердите выбор для этого поля.`}
          actionLabel={`Выбрать ${mutation.state.guest.displayName}`}
          onAction={() => {
            const recoveredGuest = mutation.state.kind === "success" ? mutation.state.guest : null;
            if (!recoveredGuest) return;
            mutation.reset();
            onChange(recoveredGuest);
          }}
        />
      ) : null}

      <div className="guest-picker__actions">
        <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => {
          mutation.reset();
          setCreateOpen(true);
        }}>
          Создать гостя
        </Button>
        {onOpenCatalogue ? (
          <Button type="button" size="sm" variant="text" disabled={disabled} onClick={onOpenCatalogue}>
            Все гости
          </Button>
        ) : null}
      </div>

      {!createOpen && mutation.message ? (
        <Alert
          type={mutation.state.kind === "conflict" ? "warning" : "error"}
          variant="tonal"
          title={mutation.state.kind === "unknown" ? "Статус сохранения неизвестен" : "Гость не сохранён"}
          description={mutation.message}
          role="alert"
          slot={mutation.state.kind === "unknown" ? (
            <div className="guest-picker__actions">
              <Button size="sm" variant="secondary" onClick={() => void mutation.checkFrozenAttempt()}>Проверить статус</Button>
              <Button size="sm" variant="text" onClick={() => void mutation.resendFrozenAttempt()}>Повторить ту же попытку</Button>
            </div>
          ) : undefined}
        />
      ) : null}

      <Dialog
        open={createOpen}
        onClose={() => { if (!busy) setCreateOpen(false); }}
        title="Новый сохранённый гость"
        width="sm"
      >
        <div className="stack">
          <TextField
            label="Имя"
            value={firstName}
            maxLength={100}
            disabled={busy}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setFirstName(event.target.value)}
          />
          <TextField
            label="Фамилия"
            value={lastName}
            maxLength={100}
            disabled={busy}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setLastName(event.target.value)}
          />
          {mutation.message ? (
            <Alert
              type={mutation.state.kind === "conflict" ? "warning" : "error"}
              variant="tonal"
              title={mutation.state.kind === "unknown" ? "Статус сохранения неизвестен" : "Гость не сохранён"}
              description={mutation.message}
              role="alert"
              slot={mutation.state.kind === "unknown" ? (
                <div className="guest-picker__actions">
                  <Button size="sm" variant="secondary" onClick={() => void mutation.checkFrozenAttempt()}>Проверить статус</Button>
                  <Button size="sm" variant="text" onClick={() => void mutation.resendFrozenAttempt()}>Повторить ту же попытку</Button>
                </div>
              ) : undefined}
            />
          ) : null}
          <div className="guest-picker__actions guest-picker__actions--end">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setCreateOpen(false)}>
              Закрыть
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={busy || !canCreate || mutation.state.kind === "unknown"}
              onClick={() => void mutation.create(firstName, lastName)}
            >
              {busy ? "Сохраняем…" : "Создать и выбрать"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
