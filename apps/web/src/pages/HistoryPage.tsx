import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Dialog } from "../ui";
import { PageLayout } from "../layout";
import {
  AsyncState,
  ListRow,
  StatusChip,
  formatLabel,
} from "../patterns";
import { api } from "../api";
import { useAuth } from "../auth";

type HistoryItem = {
  kind: "match" | "tournament";
  matchKind?: string;
  id: string;
  title: string;
  status: string;
  subtitle: string;
  sortAt: number;
};

export function HistoryPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  async function load() {
    const [matches, tournaments] = await Promise.all([
      api.listMatches(),
      api.listTournaments(),
    ]);
    const matchItems: HistoryItem[] = matches.matches.map((m) => ({
      kind: "match" as const,
      matchKind: String(m.kind ?? "standalone"),
      id: String(m.id),
      title: String(m.title),
      status: String(m.status),
      subtitle: `Матч · ${String(m.scoreA)}:${String(m.scoreB)}`,
      sortAt: Date.parse(String(m.updatedAt ?? m.createdAt ?? 0)),
    }));
    const tournamentItems: HistoryItem[] = tournaments.tournaments.map(
      (t) => ({
        kind: "tournament" as const,
        id: String(t.id),
        title: String(t.title),
        status: String(t.status),
        subtitle: `Турнир · ${formatLabel(String(t.format))}`,
        sortAt: Date.parse(String(t.updatedAt ?? t.createdAt ?? 0)),
      }),
    );
    setItems(
      [...matchItems, ...tournamentItems].sort(
        (a, b) => b.sortAt - a.sortAt,
      ),
    );
  }

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);

  async function onDeleteConfirm() {
    if (!deleteId) return;
    setDeletePending(true);
    setError(null);
    try {
      await api.adminDeleteMatch(deleteId);
      setDeleteId(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
      setDeleteId(null);
    } finally {
      setDeletePending(false);
    }
  }

  const isAdmin = user?.role === "admin";

  return (
    <PageLayout title="История">
      <AsyncState
        loading={items === null && !error}
        error={error}
        empty={items !== null && items.length === 0}
        emptyTitle="Пока пусто"
        emptyDescription="Сыграйте матч или создайте турнир — события появятся здесь."
        emptyAction={
          <Button onClick={() => navigate("/start")}>Начать</Button>
        }
      >
        <div className="stack">
          {(items ?? []).map((item) => {
            const canDelete =
              isAdmin &&
              item.kind === "match" &&
              item.matchKind === "standalone";
            return (
              <div
                key={`${item.kind}-${item.id}`}
                className="row history-row"
              >
                <div className="history-row__link">
                  <ListRow
                    to={
                      item.kind === "match"
                        ? `/matches/${item.id}`
                        : `/tournaments/${item.id}`
                    }
                    title={item.title}
                    subtitle={item.subtitle}
                    trailing={
                      <StatusChip
                        status={item.status}
                        domain={
                          item.kind === "match" ? "match" : "tournament"
                        }
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
        </div>
      </AsyncState>
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
          Матч будет удалён безвозвратно. Если результат уже учтён в рейтинге,
          победы и поражения будут откачены.
        </p>
      </Dialog>
    </PageLayout>
  );
}
