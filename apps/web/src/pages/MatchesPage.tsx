import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button } from "../ui";
import { PageLayout } from "../layout";
import {
  AsyncState,
  ListRow,
  RefreshButton,
  StatusChip,
} from "../patterns";
import { api } from "../api";
import { useVisibleRefresh } from "../useVisibleRefresh";

/** Secondary list of matches (not a primary tab). */
export function MatchesPage() {
  const navigate = useNavigate();
  const [matches, setMatches] = useState<Array<Record<string, unknown>> | null>(
    null,
  );
  const load = useCallback(async () => {
    const res = await api.listMatches();
    setMatches(res.matches);
  }, []);
  const { error, refreshing, refreshNow } = useVisibleRefresh(load);

  return (
    <PageLayout
      title="Матчи"
      action={
        <div className="row">
          <RefreshButton refreshing={refreshing} onRefresh={refreshNow} />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate("/matches/new")}
          >
            Новый
          </Button>
        </div>
      }
    >
      <AsyncState
        loading={matches === null && !error}
        error={!matches ? error : null}
        empty={matches !== null && matches.length === 0}
        emptyTitle="Нет матчей"
        emptyDescription="Создайте первый матч через «Начать»."
        emptyAction={
          <Button onClick={() => navigate("/start")}>Начать</Button>
        }
      >
        <div className="stack">
          {matches && error ? (
            <Alert
              type="warning"
              variant="tonal"
              title="Не удалось обновить"
              description={error}
            />
          ) : null}
          {(matches ?? []).map((m) => (
            <ListRow
              key={String(m.id)}
              to={`/matches/${m.id}`}
              title={String(m.title)}
              subtitle={`${String(m.scoreA)}:${String(m.scoreB)}`}
              trailing={<StatusChip status={String(m.status)} />}
            />
          ))}
        </div>
      </AsyncState>
    </PageLayout>
  );
}
