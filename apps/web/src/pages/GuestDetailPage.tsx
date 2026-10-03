import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { GuestIdentity } from "@tab10/shared";
import { api, type HistoryItem } from "../api";
import { avatarSrc } from "../avatarSrc";
import { guestRecordLabel } from "../components/GuestPicker";
import { PageLayout } from "../layout";
import { AsyncState, StatusChip } from "../patterns";
import { initialsFromName } from "../rankingUi";
import { Alert, Avatar, Button, Dialog, TextField } from "../ui";
import { useGuestIdentityMutation } from "../useGuestIdentityMutation";
import { useAuth } from "../auth";
import type { GuestSelectionContext, GuestSelectionResult } from "./GuestsPage";
import "./GuestPages.css";

const DATE = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

function selectionContextFromState(state: unknown): GuestSelectionContext | null {
  const context = state && typeof state === "object"
    ? (state as { guestSelectionContext?: GuestSelectionContext }).guestSelectionContext
    : null;
  return context?.returnTo?.startsWith("/") ? context : null;
}

function historySubtitle(item: HistoryItem) {
  const when = DATE.format(new Date(item.occurredAt));
  if (item.type === "tournament") return `Турнир · ${when}`;
  const score = item.scoreA === null || item.scoreB === null ? "" : ` · ${item.scoreA}:${item.scoreB}`;
  return `${item.sideA ?? "Сторона A"} — ${item.sideB ?? "Сторона B"}${score} · ${when}`;
}

export function GuestDetailPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, explicitAuthEpoch } = useAuth();
  const selectionContext = selectionContextFromState(location.state);
  const [guest, setGuest] = useState<GuestIdentity | null>(null);
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const appliedSuccess = useRef<string | null>(null);
  const loadSequenceRef = useRef(0);
  const currentGuestIdRef = useRef(id);
  currentGuestIdRef.current = id;
  const paginationControllerRef = useRef<AbortController | null>(null);
  const mutationActorRef = useRef(user?.id);
  if (user?.id) mutationActorRef.current = user.id;
  const mutation = useGuestIdentityMutation({
    actorId: user?.id ?? mutationActorRef.current,
    authEpoch: explicitAuthEpoch,
    routeKey: location.pathname,
    purposeKey: `guest-rename:${id}`,
  });

  useEffect(() => {
    if (!user?.id) return;
    const controller = new AbortController();
    const request = ++loadSequenceRef.current;
    const requestedGuestId = id;
    paginationControllerRef.current?.abort();
    paginationControllerRef.current = null;
    setLoadingMore(false);
    setGuest(null);
    setItems(null);
    setError(null);
    void api.getGuestHistory(id, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted || request !== loadSequenceRef.current || currentGuestIdRef.current !== requestedGuestId) return;
        setGuest(response.guest);
        setItems(response.items);
        setNextCursor(response.nextCursor);
        setFirstName(response.guest.firstName);
        setLastName(response.guest.lastName);
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted && request === loadSequenceRef.current && currentGuestIdRef.current === requestedGuestId) {
          setError(reason.message || "Не удалось загрузить гостя");
        }
      });
    return () => {
      controller.abort();
      paginationControllerRef.current?.abort();
    };
  }, [explicitAuthEpoch, id, reloadVersion, user?.id]);

  useEffect(() => {
    if (mutation.state.kind !== "success") return;
    if (mutation.state.guest.id !== id) return;
    if (appliedSuccess.current === `${mutation.state.guest.id}:${mutation.state.guest.version}`) return;
    appliedSuccess.current = `${mutation.state.guest.id}:${mutation.state.guest.version}`;
    setGuest(mutation.state.guest);
    setFirstName(mutation.state.guest.firstName);
    setLastName(mutation.state.guest.lastName);
    setRenameOpen(false);
  }, [id, mutation.state]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const controller = new AbortController();
    paginationControllerRef.current?.abort();
    paginationControllerRef.current = controller;
    const request = loadSequenceRef.current;
    const requestedGuestId = id;
    const requestedCursor = nextCursor;
    setLoadingMore(true);
    setPageError(null);
    try {
      const response = await api.getGuestHistory(id, { cursor: requestedCursor, signal: controller.signal });
      if (controller.signal.aborted || request !== loadSequenceRef.current || currentGuestIdRef.current !== requestedGuestId) return;
      setGuest(response.guest);
      setItems((current) => [...(current ?? []), ...response.items]);
      setNextCursor(response.nextCursor);
    } catch (reason) {
      if (!controller.signal.aborted && request === loadSequenceRef.current && currentGuestIdRef.current === requestedGuestId) {
        setPageError(reason instanceof Error ? reason.message : "Не удалось загрузить продолжение");
      }
    } finally {
      if (paginationControllerRef.current === controller) paginationControllerRef.current = null;
      if (!controller.signal.aborted && request === loadSequenceRef.current && currentGuestIdRef.current === requestedGuestId) {
        setLoadingMore(false);
      }
    }
  }

  function selectGuest() {
    if (!selectionContext || !guest) return;
    navigate(selectionContext.returnTo, {
      replace: true,
      state: { guestSelection: { ...selectionContext, guest } satisfies GuestSelectionResult },
    });
  }

  const busy = mutation.state.kind === "pending";
  const canRename = firstName.trim().length > 0 && lastName.trim().length > 0;

  return (
    <PageLayout
      title={guest?.displayName ?? "Гость"}
      action={selectionContext && guest ? <Button onClick={selectGuest}>Выбрать гостя</Button> : undefined}
    >
      <AsyncState loading={!guest && !error} error={error}>
        {guest ? (
          <>
            <section className="guest-profile card" aria-label="Карточка гостя">
              <Avatar size="md" variant="tonal" src={avatarSrc(guest.avatarKey)} initials={initialsFromName(guest.displayName)} alt="" />
              <div>
                <strong>{guest.displayName}</strong>
                <p className="muted">{guestRecordLabel(guest.id)}</p>
              </div>
              {guest.canRename ? <Button variant="secondary" onClick={() => { mutation.reset(); setRenameOpen(true); }}>Переименовать</Button> : null}
            </section>

            <section className="card stack" aria-labelledby="guest-history-title">
              <h2 id="guest-history-title" className="section-title">История участий</h2>
              {items?.length ? (
                <div className="guest-history" role="list">
                  {items.map((item) => (
                    <div role="listitem" key={`${item.type}-${item.id}`}>
                    <Link
                      className="guest-history__row"
                      to={item.type === "match" ? `/matches/${item.id}` : `/tournaments/${item.id}`}
                      state={{ returnTo: `/guests/${guest.id}`, returnLabel: "К гостю" }}
                    >
                      <span><strong>{item.title}</strong><small>{historySubtitle(item)}</small></span>
                      <StatusChip status={item.status} domain={item.type === "match" ? "match" : "tournament"} />
                    </Link>
                    </div>
                  ))}
                </div>
              ) : <p className="muted">Участий в завершённых событиях пока нет.</p>}
              {pageError ? <Alert type="error" variant="tonal" title="Не удалось загрузить продолжение" description={pageError} /> : null}
              {nextCursor ? <Button variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Загружаем…" : "Показать ещё"}</Button> : null}
            </section>
          </>
        ) : null}
      </AsyncState>
      {error ? <Button variant="secondary" onClick={() => setReloadVersion((version) => version + 1)}>Повторить загрузку</Button> : null}

      {!renameOpen && mutation.message ? <Alert type={mutation.state.kind === "conflict" ? "warning" : "error"} variant="tonal" title={mutation.state.kind === "unknown" ? "Статус переименования неизвестен" : "Имя не сохранено"} description={mutation.message} slot={mutation.state.kind === "unknown" ? <div className="guest-form__actions"><Button size="sm" variant="secondary" onClick={() => void mutation.checkFrozenAttempt()}>Проверить статус</Button><Button size="sm" variant="text" onClick={() => void mutation.resendFrozenAttempt()}>Повторить ту же попытку</Button></div> : undefined} /> : null}

      <Dialog open={renameOpen} onClose={() => { if (!busy) setRenameOpen(false); }} title="Переименовать гостя" width="sm">
        <div className="stack">
          <TextField label="Имя" value={firstName} maxLength={100} disabled={busy} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setFirstName(event.target.value)} />
          <TextField label="Фамилия" value={lastName} maxLength={100} disabled={busy} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setLastName(event.target.value)} />
          {mutation.message ? <Alert type={mutation.state.kind === "conflict" ? "warning" : "error"} variant="tonal" title={mutation.state.kind === "unknown" ? "Статус переименования неизвестен" : "Имя не сохранено"} description={mutation.message} slot={mutation.state.kind === "unknown" ? <div className="guest-form__actions"><Button size="sm" variant="secondary" onClick={() => void mutation.checkFrozenAttempt()}>Проверить статус</Button><Button size="sm" variant="text" onClick={() => void mutation.resendFrozenAttempt()}>Повторить ту же попытку</Button></div> : mutation.state.kind === "conflict" && mutation.state.guest ? <Button size="sm" variant="secondary" onClick={() => { setGuest(mutation.state.kind === "conflict" ? mutation.state.guest : guest); if (mutation.state.kind === "conflict" && mutation.state.guest) { setFirstName(mutation.state.guest.firstName); setLastName(mutation.state.guest.lastName); } mutation.reset(); }}>Показать актуальное имя</Button> : undefined} /> : null}
          <div className="guest-form__actions guest-form__actions--end">
            <Button variant="secondary" disabled={busy} onClick={() => setRenameOpen(false)}>Закрыть</Button>
            <Button disabled={busy || !canRename || mutation.state.kind === "unknown" || mutation.state.kind === "conflict" || !guest} onClick={() => guest && void mutation.rename(guest, firstName, lastName)}>{busy ? "Сохраняем…" : "Сохранить имя"}</Button>
          </div>
        </div>
      </Dialog>
    </PageLayout>
  );
}
