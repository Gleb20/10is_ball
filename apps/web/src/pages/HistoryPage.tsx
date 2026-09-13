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
    return `Матч${score}${result}`;
  }
  return `Турнир · ${formatLabel(item.format ?? "")}`;
}

export function HistoryPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const restoredRef = useRef<{
    userId: string;
    items: HistoryItem[];
    nextCursor: string | null;
    search: string;
    filters: FilterDraft;
  } | null>(null);
  if (restoredRef.current === null && typeof window !== "undefined") {
    try {
      const raw = window.sessionStorage.getItem("tab10.history.return");
      window.sessionStorage.removeItem("tab10.history.return");
      const restored = raw ? JSON.parse(raw) : null;
      if (restored?.userId === user?.id) restoredRef.current = restored;
    } catch {
      window.sessionStorage.removeItem("tab10.history.return");
    }
  }
  const restored = restoredRef.current;
  const skipRestoredLoadRef = useRef(Boolean(restored));
  const requestSequence = useRef(0);
  const [items, setItems] = useState<HistoryItem[] | null>(restored?.items ?? null);
  const [nextCursor, setNextCursor] = useState<string | null>(restored?.nextCursor ?? null);
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
    if (!user) return;
    if (skipRestoredLoadRef.current) {
      skipRestoredLoadRef.current = false;
      return;
    }
    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    setItems(null);
    setNextCursor(null);
    setInitialError(null);
    setPageError(null);
    setLoadingMore(false);
    void api
      .history({
        ...toApiFilters(filters, appliedSearch),
        signal: controller.signal,
      })
      .then((response) => {
        if (sequence !== requestSequence.current) return;
        setItems(response.items);
        setNextCursor(response.nextCursor);
      })
      .catch((error: Error) => {
        if (controller.signal.aborted || sequence !== requestSequence.current) {
          return;
        }
        setInitialError(error.message);
      });
    return () => controller.abort();
  }, [filters, appliedSearch, reloadToken, user?.id]);

  function rememberReturn() {
    if (!user || !items) return;
    window.sessionStorage.setItem(
      "tab10.history.return",
      JSON.stringify({ userId: user.id, items, nextCursor, search: appliedSearch, filters }),
    );
  }

  async function loadNextPage() {
    if (!nextCursor || loadingMore) return;
    const sequence = ++requestSequence.current;
    setLoadingMore(true);
    setPageError(null);
    try {
      const response = await api.history({
        ...toApiFilters(filters, appliedSearch),
        cursor: nextCursor,
      });
      if (sequence !== requestSequence.current) return;
      setItems((current) => [...(current ?? []), ...response.items]);
      setNextCursor(response.nextCursor);
    } catch (error) {
      if (sequence === requestSequence.current) {
        setPageError((error as Error).message);
      }
    } finally {
      if (sequence === requestSequence.current) setLoadingMore(false);
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
          aria-label="Поиск по сопернику или турниру"
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
          <span className="muted">Показаны результаты по выбранным условиям</span>
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
          loading={items === null}
          empty={items !== null && items.length === 0}
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
              <Button onClick={() => navigate("/start")}>Начать</Button>
            )
          }
        >
          <div className="stack">
            {(items ?? []).map((item) => {
              const canDelete =
                isAdmin &&
                item.type === "match" &&
                item.matchKind === "standalone" &&
                item.status !== "finished" &&
                item.status !== "stopped" &&
                item.status !== "voided";
              return (
                <div key={`${item.type}-${item.id}`} className="row history-row">
                  <div className="history-row__link" onClick={rememberReturn}>
                    <ListRow
                      to={
                        item.type === "match"
                          ? `/matches/${item.id}`
                          : `/tournaments/${item.id}`
                      }
                      title={item.title}
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
