import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, TextField } from "../ui";
import { PageLayout } from "../layout";
import {
  AsyncState,
  FilterBar,
  ListRow,
  StatusChip,
  formatLabel,
} from "../patterns";
import { api } from "../api";

export function TournamentsPage() {
  const navigate = useNavigate();
  const [list, setList] = useState<Array<Record<string, unknown>> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [title, setTitle] = useState(() => {
    const d = new Date();
    return `Турнир ${d.toLocaleString("ru-RU")}`;
  });
  const [format, setFormat] = useState<
    "single_elimination" | "double_elimination"
  >("single_elimination");
  const [organizerParticipates, setOrganizerParticipates] = useState(true);

  async function load() {
    const res = await api.listTournaments();
    setList(res.tournaments);
  }

  useEffect(() => {
    void load().catch((e) => setLoadError(e.message));
  }, []);

  return (
    <PageLayout title="Турниры">
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          void api
            .createTournament({ title, format, organizerParticipates })
            .then((r) => navigate(`/tournaments/${r.tournament.id}`))
            .catch((err) => setFormError((err as Error).message));
        }}
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
        <Button type="submit">Создать</Button>
        {formError ? <p className="error">{formError}</p> : null}
      </form>

      <AsyncState
        loading={list === null && !loadError}
        error={loadError}
        empty={list !== null && list.length === 0}
        emptyTitle="Нет турниров"
        emptyDescription="Создайте турнир выше или через «Начать»."
      >
        <div className="stack">
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
