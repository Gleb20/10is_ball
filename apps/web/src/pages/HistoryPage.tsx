import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui";
import { PageLayout } from "../layout";
import {
  AsyncState,
  ListRow,
  StatusChip,
  formatLabel,
} from "../patterns";
import { api } from "../api";

type HistoryItem = {
  kind: "match" | "tournament";
  id: string;
  title: string;
  status: string;
  subtitle: string;
};

export function HistoryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [matches, tournaments] = await Promise.all([
          api.listMatches(),
          api.listTournaments(),
        ]);
        const matchItems: HistoryItem[] = matches.matches.map((m) => ({
          kind: "match" as const,
          id: String(m.id),
          title: String(m.title),
          status: String(m.status),
          subtitle: `Матч · ${String(m.scoreA)}:${String(m.scoreB)}`,
        }));
        const tournamentItems: HistoryItem[] = tournaments.tournaments.map(
          (t) => ({
            kind: "tournament" as const,
            id: String(t.id),
            title: String(t.title),
            status: String(t.status),
            subtitle: `Турнир · ${formatLabel(String(t.format))}`,
          }),
        );
        setItems([...matchItems, ...tournamentItems]);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

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
          {(items ?? []).map((item) => (
            <ListRow
              key={`${item.kind}-${item.id}`}
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
                  domain={item.kind === "match" ? "match" : "tournament"}
                />
              }
            />
          ))}
        </div>
      </AsyncState>
    </PageLayout>
  );
}
