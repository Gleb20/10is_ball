import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, TextField } from "../ui";
import { PageLayout } from "../layout";
import {
  AsyncState,
  FilterBar,
  ListRow,
  RefreshButton,
  StatusChip,
  formatLabel,
} from "../patterns";
import { api } from "../api";
import { useVisibleRefresh } from "../useVisibleRefresh";
import { useSingleFlight } from "../useSingleFlight";

export function defaultTournamentTitle(d = new Date()) {
  return `Турнир ${d.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
  })}`;
}

export function TournamentsPage() {
  const navigate = useNavigate();
  const [list, setList] = useState<Array<Record<string, unknown>> | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [title, setTitle] = useState(defaultTournamentTitle);
  const [format, setFormat] = useState<
    "single_elimination" | "double_elimination"
  >("single_elimination");
  const [organizerParticipates, setOrganizerParticipates] = useState(true);
  const submission = useSingleFlight();

  const load = useCallback(async () => {
    const res = await api.listTournaments();
    setList(res.tournaments);
  }, []);
  const { error: loadError, refreshing, refreshNow } = useVisibleRefresh(load);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await submission.run(async () => {
      setFormError(null);
      try {
        const result = await api.createTournament({
          title,
          format,
          organizerParticipates,
        });
        navigate(`/tournaments/${result.tournament.id}`);
      } catch (error) {
        setFormError((error as Error).message);
      }
    });
  }

  return (
    <PageLayout
      title="Турниры"
      action={
        <RefreshButton refreshing={refreshing} onRefresh={refreshNow} />
      }
    >
      <form
        className="card stack"
        onSubmit={create}
        aria-label="Создание турнира"
      >
        <TextField
          label="Название"
          value={title}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setTitle(e.target.value)
          }
        />
        <FilterBar
          label="Формат турнира"
          value={format}
          onChange={(v) =>
            setFormat(v as "single_elimination" | "double_elimination")
          }
          options={[
            { value: "single_elimination", label: "Single" },
            { value: "double_elimination", label: "Double" },
          ]}
        />
        <label className="match-create__check">
          <input
            type="checkbox"
            checked={organizerParticipates}
            onChange={(e) => setOrganizerParticipates(e.target.checked)}
          />
          Организатор участвует
        </label>
        <Button type="submit" disabled={submission.pending}>
          {submission.pending ? "Создание…" : "Создать"}
        </Button>
        {formError ? <p className="error" role="alert">{formError}</p> : null}
      </form>

      <AsyncState
        loading={list === null && !loadError}
        error={!list ? loadError : null}
        empty={list !== null && list.length === 0}
        emptyTitle="Нет турниров"
        emptyDescription="Создайте турнир выше или через «Начать»."
      >
        <div className="stack">
          {list && loadError ? (
            <Alert
              type="warning"
              variant="tonal"
              title="Не удалось обновить"
              description={loadError}
            />
          ) : null}
          {(list ?? []).map((t) => (
            <ListRow
              key={String(t.id)}
              to={`/tournaments/${t.id}`}
              title={String(t.title)}
              subtitle={formatLabel(String(t.format))}
              trailing={
                <StatusChip status={String(t.status)} domain="tournament" />
              }
            />
          ))}
        </div>
      </AsyncState>
    </PageLayout>
  );
}
