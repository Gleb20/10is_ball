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
} from "../patterns";
import { api } from "../api";
import { formatPlannedDate } from "../tournamentDate";
import { useVisibleRefresh } from "../useVisibleRefresh";
import { useSingleFlight } from "../useSingleFlight";
import "./TournamentSetup.css";

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
  const [plannedDate, setPlannedDate] = useState("");
  const [format, setFormat] = useState<
    "single_elimination" | "double_elimination"
  >("single_elimination");
  const [organizerParticipates, setOrganizerParticipates] = useState(true);
  const [pointsToWin, setPointsToWin] = useState(11);
  const [mercyEnabled, setMercyEnabled] = useState(false);
  const [mercyPoints, setMercyPoints] = useState(2);
  const submission = useSingleFlight();

  const load = useCallback(async () => {
    if (createOnly) return;
    const res = await api.listTournaments();
    setList(res.tournaments);
  }, [createOnly]);
  const { error: loadError, refreshing, refreshNow } = useVisibleRefresh(load, { pollingEnabled: !createOnly });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      title,
      format,
      organizerParticipates,
      pointsToWin,
      mercyEnabled,
      mercyPoints: mercyEnabled ? mercyPoints : null,
      requireParticipantConsent: false,
      ...(plannedDate ? { plannedDate } : {}),
    };
    await submission.run(async () => {
      setFormError(null);
      try {
        const result = await api.createTournament(payload);
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
        className="card stack tournament-setup"
        onSubmit={create}
        aria-label="Создание турнира"
      >
        <h2 className="section-title">Шаг 1 из 3 · Правила</h2>
        <p className="muted tournament-setup__intro">
          Задайте правила сейчас. Состав участников и сетка будут следующими шагами.
        </p>
        <TextField
          label="Название"
          disabled={submission.pending}
          value={title}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setTitle(e.target.value)
          }
        />
        <TextField label="Плановая дата (необязательно)" type="date" value={plannedDate}
          disabled={submission.pending} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setPlannedDate(event.target.value)}
          aria-describedby="tournament-planned-date-help" />
        <p id="tournament-planned-date-help" className="muted">Дата для участников. Турнир запускается вручную.</p>
        <fieldset className="stack tournament-setup__choice" disabled={submission.pending} role="presentation">
          <span className="tournament-setup__choice-label">Сетка проигравших</span>
          <FilterBar
            label="Сетка проигравших"
            value={format}
            onChange={(v) =>
              setFormat(v as "single_elimination" | "double_elimination")
            }
            options={[
              { value: "single_elimination", label: "Выключена" },
              { value: "double_elimination", label: "Включена" },
            ]}
          />
        </fieldset>
        <TextField
          label="Очков для победы"
          disabled={submission.pending}
          type="number"
          min={1}
          inputMode="numeric"
          value={String(pointsToWin)}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setPointsToWin(Number(e.target.value))
          }
        />
        <label className="match-create__check">
          <input
            type="checkbox"
            disabled={submission.pending}
            checked={mercyEnabled}
            onChange={(e) => setMercyEnabled(e.target.checked)}
          />
          Завершать матч при сухом счёте
        </label>
        {mercyEnabled ? <>
          <TextField
            label="Очков для сухой победы"
            disabled={submission.pending}
            type="number"
            min={1}
            inputMode="numeric"
            value={String(mercyPoints)}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setMercyPoints(Number(e.target.value))
            }
          />
          <p className="muted tournament-setup__hint">
            Матч завершится, когда один игрок наберёт указанное число очков, а у соперника останется 0.
          </p>
        </> : null}
        <label className="match-create__check">
          <input
            type="checkbox"
            disabled={submission.pending}
            checked={organizerParticipates}
            onChange={(e) => setOrganizerParticipates(e.target.checked)}
          />
          Организатор участвует
        </label>
        <Button
          type="submit"
          disabled={submission.pending || !title.trim() || pointsToWin < 1 || (mercyEnabled && mercyPoints < 1)}
        >
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
              subtitle={[t.format ? `Сетка проигравших ${String(t.format) === "double_elimination" ? "включена" : "выключена"}` : null, formatPlannedDate(t.plannedDate)].filter(Boolean).join(" · ")}
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
