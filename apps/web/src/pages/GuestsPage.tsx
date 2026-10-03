import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { GuestIdentity } from "@tab10/shared";
import { api } from "../api";
import { avatarSrc } from "../avatarSrc";
import { guestRecordLabel } from "../components/GuestPicker";
import { PageLayout } from "../layout";
import { AsyncState, ListRow } from "../patterns";
import { initialsFromName } from "../rankingUi";
import { Alert, Avatar, Button, Dialog, TextField } from "../ui";
import { guestCreatePurposeKey, useGuestIdentityMutation } from "../useGuestIdentityMutation";
import { useAuth } from "../auth";
import "./GuestPages.css";

export type GuestSelectionContext = {
  kind: "match" | "tournament";
  returnTo: string;
  returnLabel: string;
  draftToken?: string;
  slotKey?: string;
  tournamentId?: string;
};

export type GuestSelectionResult = GuestSelectionContext & { guest: GuestIdentity };

function readSelectionContext(state: unknown): GuestSelectionContext | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as { guestSelectionContext?: unknown }).guestSelectionContext;
  if (!value || typeof value !== "object") return null;
  const context = value as Partial<GuestSelectionContext>;
  if (
    (context.kind !== "match" && context.kind !== "tournament") ||
    typeof context.returnTo !== "string" || !context.returnTo.startsWith("/") || context.returnTo.startsWith("//") ||
    typeof context.returnLabel !== "string"
  ) return null;
  if (context.kind === "match" && (typeof context.draftToken !== "string" || typeof context.slotKey !== "string")) return null;
  if (context.kind === "tournament" && typeof context.tournamentId !== "string") return null;
  return context as GuestSelectionContext;
}

export function GuestsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, explicitAuthEpoch } = useAuth();
  const selectionContext = readSelectionContext(location.state);
  const query = (searchParams.get("q") ?? "").trim().slice(0, 100);
  const [guests, setGuests] = useState<GuestIdentity[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [queryInput, setQueryInput] = useState(query);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const sequence = useRef(0);
  const currentQueryRef = useRef(query);
  currentQueryRef.current = query;
  const paginationControllerRef = useRef<AbortController | null>(null);
  const appliedSuccess = useRef<string | null>(null);
  const mutationActorRef = useRef(user?.id);
  if (user?.id) mutationActorRef.current = user.id;
  const mutationPurposeKey = selectionContext?.kind === "match"
    ? guestCreatePurposeKey({ kind: "match", draftToken: selectionContext.draftToken!, slotKey: selectionContext.slotKey! })
    : selectionContext?.kind === "tournament"
      ? guestCreatePurposeKey({ kind: "tournament", tournamentId: selectionContext.tournamentId! })
      : guestCreatePurposeKey({ kind: "catalogue" });
  const mutation = useGuestIdentityMutation({
    actorId: user?.id ?? mutationActorRef.current,
    authEpoch: explicitAuthEpoch,
    routeKey: location.pathname,
    purposeKey: mutationPurposeKey,
  });

  useEffect(() => {
    setQueryInput(query);
  }, [query]);

  useEffect(() => {
    if (!user?.id) return;
    const controller = new AbortController();
    const request = ++sequence.current;
    paginationControllerRef.current?.abort();
    paginationControllerRef.current = null;
    setLoadingMore(false);
    setGuests(null);
    setInitialError(null);
    setPageError(null);
    void api.listGuests({ q: query || undefined, limit: 20, signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted || request !== sequence.current || currentQueryRef.current !== query) return;
        setGuests(response.guests);
        setNextCursor(response.nextCursor);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted && request === sequence.current) {
          setInitialError(error.message || "Не удалось загрузить гостей");
        }
      });
    return () => {
      controller.abort();
      paginationControllerRef.current?.abort();
    };
  }, [explicitAuthEpoch, query, reloadVersion, user?.id]);

  useEffect(() => {
    if (mutation.state.kind !== "success") return;
    const createdGuest = mutation.state.guest;
    if (appliedSuccess.current === createdGuest.id) return;
    appliedSuccess.current = createdGuest.id;
    setGuests((current) => current
      ? [createdGuest, ...current.filter((guest) => guest.id !== createdGuest.id)]
      : [createdGuest]);
    setCreateOpen(false);
    if (selectionContext && !mutation.state.recovered) {
      navigate(selectionContext.returnTo, {
        replace: true,
        state: { guestSelection: { ...selectionContext, guest: createdGuest } satisfies GuestSelectionResult },
      });
    }
  }, [mutation.state, navigate, selectionContext]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const controller = new AbortController();
    paginationControllerRef.current?.abort();
    paginationControllerRef.current = controller;
    const request = sequence.current;
    const requestedQuery = query;
    setLoadingMore(true);
    setPageError(null);
    try {
      const response = await api.listGuests({ q: query || undefined, cursor: nextCursor, limit: 20, signal: controller.signal });
      if (controller.signal.aborted || request !== sequence.current || currentQueryRef.current !== requestedQuery) return;
      setGuests((current) => [...(current ?? []), ...response.guests]);
      setNextCursor(response.nextCursor);
    } catch (error) {
      if (!controller.signal.aborted && request === sequence.current && currentQueryRef.current === requestedQuery) {
        setPageError(error instanceof Error ? error.message : "Не удалось загрузить продолжение");
      }
    } finally {
      if (paginationControllerRef.current === controller) paginationControllerRef.current = null;
      if (!controller.signal.aborted && request === sequence.current && currentQueryRef.current === requestedQuery) {
        setLoadingMore(false);
      }
    }
  }

  function selectGuest(guest: GuestIdentity) {
    if (!selectionContext) return;
    navigate(selectionContext.returnTo, {
      replace: true,
      state: { guestSelection: { ...selectionContext, guest } satisfies GuestSelectionResult },
    });
  }

  const busy = mutation.state.kind === "pending";
  const canCreate = firstName.trim().length > 0 && lastName.trim().length > 0;

  return (
    <PageLayout
      title="Гости"
      action={<Button onClick={() => { mutation.reset(); setCreateOpen(true); }}>Создать гостя</Button>}
    >
      {selectionContext ? (
        <Alert
          type="primary"
          variant="tonal"
          title="Выберите сохранённого гостя"
          description="Выбор вернёт вас в незавершённую подготовку. Совпадающие имена различаются номером записи."
        />
      ) : null}

      {mutation.state.kind === "success" && mutation.state.recovered ? (
        <Alert
          type="success"
          variant="tonal"
          title="Гость сохранён"
          description={`${mutation.state.guest.displayName} сохранён. Выберите его явно для текущего поля.`}
          slot={selectionContext ? (
            <Button onClick={() => {
              const recoveredGuest = mutation.state.kind === "success" ? mutation.state.guest : null;
              if (!recoveredGuest) return;
              mutation.reset();
              selectGuest(recoveredGuest);
            }}>Выбрать {mutation.state.guest.displayName}</Button>
          ) : undefined}
        />
      ) : null}

      <form className="guest-search" onSubmit={(event) => {
        event.preventDefault();
        const nextQuery = queryInput.trim();
        setSearchParams(nextQuery ? { q: nextQuery } : {}, { replace: true });
      }}>
        <TextField
          label="Поиск гостей"
          placeholder="Имя или фамилия"
          maxLength={100}
          value={queryInput}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQueryInput(event.target.value)}
        />
        <Button type="submit">Найти</Button>
        {query ? <Button type="button" variant="secondary" onClick={() => { setQueryInput(""); setSearchParams({}, { replace: true }); }}>Сбросить</Button> : null}
      </form>

      <AsyncState
        loading={guests === null && !initialError}
        error={initialError}
        empty={guests?.length === 0}
        emptyTitle={query ? "Гости не найдены" : "Сохранённых гостей пока нет"}
        emptyDescription={query ? "Измените запрос или создайте новую запись." : "Создайте гостя, чтобы выбирать его в матчах и турнирах."}
        emptyAction={<Button onClick={() => setCreateOpen(true)}>Создать гостя</Button>}
      >
        <div className="guest-list" role="list">
          {guests?.map((guest) => selectionContext ? (
            <article className="guest-list__selectable" role="listitem" key={guest.id}>
              <Avatar size="md" variant="tonal" src={avatarSrc(guest.avatarKey)} initials={initialsFromName(guest.displayName)} alt="" />
              <div className="guest-list__body">
                <strong>{guest.displayName}</strong>
                <span className="muted">{guestRecordLabel(guest.id)}</span>
              <Link to={`/guests/${guest.id}`} state={{ ...location.state, returnTo: `${location.pathname}${location.search}`, returnLabel: "К гостям" }}>Открыть карточку</Link>
              </div>
              <Button onClick={() => selectGuest(guest)}>Выбрать</Button>
            </article>
          ) : (
            <div role="listitem" key={guest.id}>
            <ListRow
              to={`/guests/${guest.id}`}
              state={{ returnTo: `${location.pathname}${location.search}`, returnLabel: "К гостям" }}
              leading={<Avatar size="md" variant="tonal" src={avatarSrc(guest.avatarKey)} initials={initialsFromName(guest.displayName)} alt="" />}
              title={guest.displayName}
              subtitle={guestRecordLabel(guest.id)}
            />
            </div>
          ))}
        </div>
        {pageError ? <Alert type="error" variant="tonal" title="Не удалось загрузить продолжение" description={pageError} /> : null}
        {nextCursor ? <Button variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Загружаем…" : "Показать ещё"}</Button> : null}
      </AsyncState>

      {initialError ? <Button variant="secondary" onClick={() => setReloadVersion((version) => version + 1)}>Повторить загрузку</Button> : null}

      {!createOpen && mutation.message ? (
        <Alert
          type="error"
          variant="tonal"
          title={mutation.state.kind === "unknown" ? "Статус сохранения неизвестен" : "Гость не сохранён"}
          description={mutation.message}
          slot={mutation.state.kind === "unknown" ? <div className="guest-form__actions"><Button size="sm" variant="secondary" onClick={() => void mutation.checkFrozenAttempt()}>Проверить статус</Button><Button size="sm" variant="text" onClick={() => void mutation.resendFrozenAttempt()}>Повторить ту же попытку</Button></div> : undefined}
        />
      ) : null}

      <Dialog open={createOpen} onClose={() => { if (!busy) setCreateOpen(false); }} title="Новый сохранённый гость" width="sm">
        <div className="stack">
          <TextField label="Имя" value={firstName} maxLength={100} disabled={busy} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setFirstName(event.target.value)} />
          <TextField label="Фамилия" value={lastName} maxLength={100} disabled={busy} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setLastName(event.target.value)} />
          {mutation.message ? <Alert type="error" variant="tonal" title={mutation.state.kind === "unknown" ? "Статус сохранения неизвестен" : "Гость не сохранён"} description={mutation.message} slot={mutation.state.kind === "unknown" ? <div className="guest-form__actions"><Button size="sm" variant="secondary" onClick={() => void mutation.checkFrozenAttempt()}>Проверить статус</Button><Button size="sm" variant="text" onClick={() => void mutation.resendFrozenAttempt()}>Повторить ту же попытку</Button></div> : undefined} /> : null}
          <div className="guest-form__actions guest-form__actions--end">
            <Button variant="secondary" disabled={busy} onClick={() => setCreateOpen(false)}>Закрыть</Button>
            <Button disabled={busy || !canCreate || mutation.state.kind === "unknown"} onClick={() => void mutation.create(firstName, lastName)}>{busy ? "Сохраняем…" : "Создать"}</Button>
          </div>
        </div>
      </Dialog>
    </PageLayout>
  );
}
