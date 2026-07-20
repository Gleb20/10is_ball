import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, ListRow, StatusChip } from "../patterns";
import { api } from "../api";

/** Secondary list of matches (not a primary tab). */
export function MatchesPage() {
  const navigate = useNavigate();
  const [matches, setMatches] = useState<Array<Record<string, unknown>> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .listMatches()
      .then((res) => setMatches(res.matches))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <PageLayout
      title="Матчи"
      action={
        <Button
          size="sm"
          variant="secondary"
          onClick={() => navigate("/matches/new")}
        >
          Новый
        </Button>
      }
    >
      <AsyncState
        loading={matches === null && !error}
        error={error}
        empty={matches !== null && matches.length === 0}
        emptyTitle="Нет матчей"
        emptyDescription="Создайте первый матч через «Начать»."
        emptyAction={
          <Button onClick={() => navigate("/start")}>Начать</Button>
        }
      >
        <div className="stack">
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
