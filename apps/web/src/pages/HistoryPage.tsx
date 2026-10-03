import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Dialog, TextField } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, ListRow, StatusChip, formatLabel } from "../patterns";
import { api, type HistoryFilters, type HistoryItem } from "../api";
import { useAuth } from "../auth";

type FilterDraft = {
  role: "" | "player" | "judge";
  result: "" | "win" | "loss";
  eventType: "" | "match" | "tournament";
  from: string;
  to: string;
};

const EMPTY_FILTERS: FilterDraft = {
  role: "",
  result: "",
  eventType: "",
  from: "",
  to: "",
};

export function historyDayBoundary(value: string, end: boolean): string | undefined {
  if (!value) return undefined;
  const date = new Date(
    `${value}T${end ? "23:59:59.999" : "00:00:00.000"}+03:00`,
  );
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toApiFilters(filters: FilterDraft, q: string): HistoryFilters {
  return {
    role: filters.role || undefined,
    result: filters.result || undefined,
    eventType: filters.eventType || undefined,
    from: historyDayBoundary(filters.from, false),
    to: historyDayBoundary(filters.to, true),
    q: q.trim() || undefined,
  };
}

const HISTORY_DATE = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

function roleLabel(role: HistoryItem["roles"][number]) {
  return {
    player: "Игрок",
    judge: "Судья",
    organizer: "Организатор",
    viewer: "Зритель",
  }[role];
}

function resultLabel(item: HistoryItem) {
  if (item.result === "win") return "Победа";
  if (item.result === "loss") return "Поражение";
  if (item.status === "voided") return "Результат аннулирован";
  return null;
}

function matchFormatLabel(format: string | null) {
  if (format === "1v1") return "1×1";
  if (format === "2v2") return "2×2";
  return format ? formatLabel(format) : null;
}

function itemSubtitle(item: HistoryItem) {
  if (item.type === "match") {
    const score =
      item.scoreA === null || item.scoreB === null
        ? ""
        : ` · ${item.scoreA}:${item.scoreB}`;
    const result =
      item.result === "win"
        ? " · Победа"
        : item.result === "loss"
          ? " · Поражение"
          : item.status === "voided"
            ? " · Результат аннулирован"
            : "";
    if (!item.sideA || !item.sideB) return `Матч${score}${result}`;
    const metadata = [
      matchFormatLabel(item.format),
      item.roles.map(roleLabel).join(", "),
      HISTORY_DATE.format(new Date(item.occurredAt)),
      resultLabel(item),
    ].filter(Boolean).join(" · ");
    return (
      <span className="history-row__details">
        <span className="history-row__sides">
          <span className="history-row__side">
            <span>{item.sideA}</span>
            <strong aria-label={`Счёт стороны ${item.sideA}: ${item.scoreA ?? "не указан"}`}>
              {item.scoreA ?? "—"}
            </strong>
          </span>
          <span className="history-row__side">
            <span>{item.sideB}</span>
            <strong aria-label={`Счёт стороны ${item.sideB}: ${item.scoreB ?? "не указан"}`}>
              {item.scoreB ?? "—"}
            </strong>
          </span>
        </span>
        <span>{metadata}</span>
      </span>
    );
  }
  return [
    "Турнир",
    formatLabel(item.format ?? ""),
    item.roles.map(roleLabel).join(", "),
    HISTORY_DATE.format(new Date(item.occurredAt)),
    resultLabel(item),
  ].filter(Boolean).join(" · ");
}

export function HistoryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const restoredRef = useRef<{
    userId: string;
    loadedCount: number;
    scrollY: number;
    search: string;
    filters: FilterDraft;
    focusKey?: string;
    focusIndex?: number;
  } | null>(null);
  if (restoredRef.current === null && typeof window !== "undefined") {
    try {
      const raw = window.sessionStorage.getItem("tab10.history.return");
      window.sessionStorage.removeItem("tab10.history.return");
      const restored = raw ? JSON.parse(raw) : null;
      if (restored?.userId === user?.id) restoredRef.current = restored;
    } catch {
      try { window.sessionStorage.removeItem("tab10.history.return"); } catch { /* context is optional */ }
    }
  }
  const restored = restoredRef.current;
  const restorePositionRef = useRef(restored ? {
    scrollY: restored.scrollY,
    focusKey: restored.focusKey,
    focusIndex: restored.focusIndex ?? 0,
  } : null);
  const requestSequence = useRef(0);
  const lifecycleGeneration = useRef(0);
  const pageControllerRef = useRef<AbortController | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [itemsActorId, setItemsActorId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchInput, setSearchInput] = useState(restored?.search ?? "");
  const [appliedSearch, setAppliedSearch] = useState(restored?.search ?? "");
  const [filters, setFilters] = useState<FilterDraft>(restored?.filters ?? EMPTY_FILTERS);
  const [draft, setDraft] = useState<FilterDraft>(restored?.filters ?? EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  useEffect(() => {
    lifecycleGeneration.current += 1;
    return () => {
      lifecycleGeneration.current += 1;
      requestSequence.current += 1;
      pageControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    const generation = lifecycleGeneration.current;
    pageControllerRef.current?.abort();
    setItems(null);
    setItemsActorId(null);
    setNextCursor(null);
    setInitialError(null);
    setPageError(null);
    setLoadingMore(false);
    void (async () => {
      const baseFilters = toApiFilters(filters, appliedSearch);
      let response = await api.history({ ...baseFilters, signal: controller.signal });
      const freshItems = [...response.items];
      const wanted = restoredRef.current?.loadedCount ?? 0;
      while (response.nextCursor && freshItems.length < wanted && !controller.signal.aborted) {
        response = await api.history({ ...baseFilters, cursor: response.nextCursor, signal: controller.signal });
        freshItems.push(...response.items);
      }
      return { freshItems, nextCursor: response.nextCursor };
    })()
      .then((response) => {
        if (sequence !== requestSequence.current || generation !== lifecycleGeneration.current) return;
        setItems(response.freshItems);
        setItemsActorId(user.id);
        setNextCursor(response.nextCursor);
        restoredRef.current = null;
      })
      .catch((error: Error) => {
        if (controller.signal.aborted || sequence !== requestSequence.current || generation !== lifecycleGeneration.current) {
          return;
        }
        setInitialError(error.message);
      });
    return () => controller.abort();
  }, [filters, appliedSearch, reloadToken, user?.id]);

  useEffect(() => {
    if (items === null || itemsActorId !== user?.id || restorePositionRef.current === null) return;
    const position = restorePositionRef.current;
    const generation = lifecycleGeneration.current;
    const frame = window.requestAnimationFrame(() => {
      if (generation !== lifecycleGeneration.current) return;
      const exact = position.focusKey ? rowRefs.current.get(position.focusKey) : null;
      const nearestItem = items[Math.min(position.focusIndex, Math.max(items.length - 1, 0))];
      const nearest = nearestItem ? rowRefs.current.get(`${nearestItem.type}-${nearestItem.id}`) : null;
      const link = (exact ?? nearest)?.querySelector<HTMLAnchorElement>("a");
      const fallback = document.querySelector<HTMLInputElement>(".history-search input");
      (link ?? fallback)?.focus({ preventScroll: true });
      window.scrollTo(0, position.scrollY);
      restorePositionRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [items, itemsActorId, user?.id]);

  function rememberReturn(item: HistoryItem, focusIndex: number) {
    if (!user || !items) return;
    const detailPath = item.type === "match" ? `/matches/${item.id}` : `/tournaments/${item.id}`;
    try {
      window.sessionStorage.setItem(
        "tab10.history.return",
        JSON.stringify({ userId: user.id, detailPath, loadedCount: items.length, scrollY: window.scrollY, search: appliedSearch, filters, focusKey: `${item.type}-${item.id}`, focusIndex }),
      );
    } catch { /* navigation still works without saved list position */ }
  }

  async function loadNextPage() {
    if (!nextCursor || loadingMore) return;
    const sequence = ++requestSequence.current;
    const generation = lifecycleGeneration.current;
    const controller = new AbortController();
    pageControllerRef.current?.abort();
    pageControllerRef.current = controller;
    setLoadingMore(true);
    setPageError(null);
    try {
      const response = await api.history({
        ...toApiFilters(filters, appliedSearch),
        cursor: nextCursor,
        signal: controller.signal,
      });
      if (sequence !== requestSequence.current || generation !== lifecycleGeneration.current) return;
      setItems((current) => [...(current ?? []), ...response.items]);
      setNextCursor(response.nextCursor);
    } catch (error) {
      if (!controller.signal.aborted && sequence === requestSequence.current && generation === lifecycleGeneration.current) {
        setPageError((error as Error).message);
      }
    } finally {
      if (sequence === requestSequence.current && generation === lifecycleGeneration.current) setLoadingMore(false);
    }
  }

  async function onDeleteConfirm() {
    if (!deleteId) return;
    setDeletePending(true);
    setPageError(null);
    try {
      await api.adminDeleteMatch(deleteId);
      setDeleteId(null);
      setReloadToken((token) => token + 1);
    } catch (error) {
      setPageError((error as Error).message);
      setDeleteId(null);
    } finally {
      setDeletePending(false);
    }
  }

  function applyFilters() {
    setFilters(draft);
    setFilterOpen(false);
  }

  function resetFilters() {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setSearchInput("");
    setAppliedSearch("");
    setFilterOpen(false);
  }

  const filterCount = Object.values(filters).filter(Boolean).length;
  const hasQuery = filterCount > 0 || Boolean(appliedSearch);
  const isAdmin = user?.role === "admin";
  const visibleItems = itemsActorId === user?.id ? items : null;
  const appliedConditions = [
    appliedSearch ? `Поиск: «${appliedSearch}»` : null,
    filters.role ? `Роль: ${filters.role === "player" ? "Игрок" : "Судья"}` : null,
    filters.result ? `Результат: ${filters.result === "win" ? "Победа" : "Поражение"}` : null,
    filters.eventType ? `Тип: ${filters.eventType === "match" ? "Матч" : "Турнир"}` : null,
    filters.from ? `С даты: ${filters.from}` : null,
    filters.to ? `По дату: ${filters.to}` : null,
  ].filter(Boolean).join("; ");

  return (
    <PageLayout
      title="История"
      action={
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setDraft(filters);
            setFilterOpen(true);
          }}
        >
          Фильтры{filterCount > 0 ? ` (${filterCount})` : ""}
        </Button>
      }
    >
      <form
        className="history-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setAppliedSearch(searchInput.trim());
        }}
      >
        <TextField
          label="Поиск"
          aria-label="Поиск по участнику или названию турнира"
          type="search"
          fullWidth
          value={searchInput}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            setSearchInput(event.target.value)
          }
        />
        <Button type="submit">Найти</Button>
      </form>

      {hasQuery ? (
        <div className="history-query-summary" aria-live="polite">
          <span className="muted">{appliedConditions}</span>
          <Button size="sm" variant="secondary" onClick={resetFilters}>
            Сбросить
          </Button>
        </div>
      ) : null}

      {initialError ? (
        <div className="stack">
          <Alert
            type="error"
            variant="tonal"
            title="Не удалось загрузить историю"
            description={initialError}
          />
          <Button variant="secondary" onClick={() => setReloadToken((v) => v + 1)}>
            Повторить
          </Button>
        </div>
      ) : (
        <AsyncState
          loading={visibleItems === null}
          empty={visibleItems !== null && visibleItems.length === 0}
          emptyTitle={hasQuery ? "Пока ничего не найдено" : "Пока пусто"}
          emptyDescription={
            hasQuery
              ? "Измените поиск или фильтры и попробуйте снова."
              : "Сыграйте матч или создайте турнир — события появятся здесь."
          }
          emptyAction={
            hasQuery ? (
              <Button onClick={resetFilters}>Сбросить условия</Button>
            ) : (
              <Button onClick={() => navigate("/matches/new")}>Начать матч</Button>
            )
          }
        >
          <div className="stack">
            {(visibleItems ?? []).map((item, index) => {
              const canDelete =
                isAdmin &&
                item.type === "match" &&
                item.matchKind === "standalone" &&
                item.status !== "finished" &&
                item.status !== "stopped" &&
                item.status !== "voided";
              return (
                <div
                  key={`${item.type}-${item.id}`}
                  className="row history-row"
                  data-history-key={`${item.type}-${item.id}`}
                  ref={(node) => {
                    const key = `${item.type}-${item.id}`;
                    if (node) rowRefs.current.set(key, node);
                    else rowRefs.current.delete(key);
                  }}
                >
                  <div className="history-row__link">
                    <ListRow
                      to={
                        item.type === "match"
                          ? `/matches/${item.id}`
                          : `/tournaments/${item.id}`
                      }
                      title={item.title}
                      state={{ returnTo: "/history", returnLabel: "К истории" }}
                      onClick={() => rememberReturn(item, index)}
                      subtitle={itemSubtitle(item)}
                      trailing={
                        <StatusChip
                          status={item.status}
                          domain={item.type === "match" ? "match" : "tournament"}
                        />
                      }
                    />
                  </div>
                  {canDelete ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setDeleteId(item.id)}
                    >
                      Удалить
                    </Button>
                  ) : null}
                </div>
              );
            })}
            {pageError ? (
              <div className="stack">
                <Alert
                  type="error"
                  variant="tonal"
                  title="Не удалось загрузить следующую страницу"
                  description={pageError}
                />
                <Button variant="secondary" onClick={() => void loadNextPage()}>
                  Повторить
                </Button>
              </div>
            ) : null}
            {nextCursor && !pageError ? (
              <Button
                variant="secondary"
                disabled={loadingMore}
                onClick={() => void loadNextPage()}
              >
                {loadingMore ? "Загрузка…" : "Показать ещё"}
              </Button>
            ) : null}
          </div>
        </AsyncState>
      )}

      <Dialog
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Фильтры истории"
        width="sm"
        secondaryButtonLabel="Отмена"
        onSecondaryButton={() => setFilterOpen(false)}
        mainButtonLabel="Применить"
        onMainButton={applyFilters}
      >
        <div className="stack history-filters">
          <label>
            <span>Роль</span>
            <select
              value={draft.role}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  role: event.target.value as FilterDraft["role"],
                }))
              }
            >
              <option value="">Любая</option>
              <option value="player">Игрок</option>
              <option value="judge">Судья</option>
            </select>
          </label>
          <label>
            <span>Результат</span>
            <select
              value={draft.result}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  result: event.target.value as FilterDraft["result"],
                }))
              }
            >
              <option value="">Любой</option>
              <option value="win">Победа</option>
              <option value="loss">Поражение</option>
            </select>
          </label>
          <label>
            <span>Тип события</span>
            <select
              value={draft.eventType}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  eventType: event.target.value as FilterDraft["eventType"],
                }))
              }
            >
              <option value="">Все</option>
              <option value="match">Матч</option>
              <option value="tournament">Турнир</option>
            </select>
          </label>
          <label>
            <span>С даты</span>
            <input
              type="date"
              value={draft.from}
              max={draft.to || undefined}
              onChange={(event) =>
                setDraft((value) => ({ ...value, from: event.target.value }))
              }
            />
          </label>
          <label>
            <span>По дату</span>
            <input
              type="date"
              value={draft.to}
              min={draft.from || undefined}
              onChange={(event) =>
                setDraft((value) => ({ ...value, to: event.target.value }))
              }
            />
          </label>
        </div>
      </Dialog>

      <Dialog
        open={deleteId !== null}
        onClose={() => (!deletePending ? setDeleteId(null) : undefined)}
        title="Удалить матч из истории?"
        width="sm"
        secondaryButtonLabel="Отмена"
        onSecondaryButton={() =>
          !deletePending ? setDeleteId(null) : undefined
        }
        mainButtonLabel={deletePending ? "…" : "Удалить"}
        onMainButton={() => void onDeleteConfirm()}
      >
        <p>
          Незавершённый матч будет удалён безвозвратно. Завершённые, остановленные
          и аннулированные результаты удалить нельзя.
        </p>
      </Dialog>
    </PageLayout>
  );
}
