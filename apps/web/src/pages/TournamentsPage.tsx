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

export function TournamentsPage({ createOnly = false }: { createOnly?: boolean }) {
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
    if (createOnly) return;
    const res = await api.listTournaments();
    setList(res.tournaments);
  }, [createOnly]);
  const { error: loadError, refreshing, refreshNow } = useVisibleRefresh(load, { pollingEnabled: !createOnly });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await submission.run(async () => {
      setFormError(null);
      try {
        const result = await api.createTournament({
          title,
          format,
          organizerParticipates,
          requireParticipantConsent: false,
        });
        navigate(`/tournaments/${result.tournament.id}`);
      } catch (error) {
        setFormError((error as Error).message);
      }
    });
  }

  return (
    <PageLayout
      title={createOnly ? "Подготовка турнира" : "Турниры"}
      action={
        createOnly ? undefined : <div className="row"><RefreshButton refreshing={refreshing} onRefresh={refreshNow} /><Button size="sm" onClick={() => navigate("/tournaments/new")}>Провести турнир</Button></div>
      }
    >
      {createOnly ? <form
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
      </form> : null}

      {!createOnly ? <AsyncState
        loading={list === null && !loadError}
        error={!list ? loadError : null}
        empty={list !== null && list.length === 0}
        emptyTitle="Нет турниров"
        emptyDescription="Проведите первый турнир."
        emptyAction={<Button onClick={() => navigate("/tournaments/new")}>Провести турнир</Button>}
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
              subtitle={t.format ? formatLabel(String(t.format)) : undefined}
              trailing={
                <StatusChip status={String(t.status)} domain="tournament" />
              }
            />
          ))}
        </div>
      </AsyncState> : null}
    </PageLayout>
  );
}
