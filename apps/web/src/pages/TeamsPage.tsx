import { useCallback, useEffect, useRef, useState } from "react";
import { Button, TextField } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, ListRow } from "../patterns";
import { api, type Team } from "../api";
import { useSingleFlight } from "../useSingleFlight";
import { useAuth } from "../auth";

export function TeamsPage() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slogan, setSlogan] = useState("");
  const [welcomeText, setWelcomeText] = useState("");
  const submission = useSingleFlight();
  const { user } = useAuth();
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoadError(null);
    try {
      const res = await api.listTeams();
      if (sequence === requestSequence.current) setTeams(res.teams);
    } catch (error) {
      if (
        sequence === requestSequence.current &&
        (error as Error & { status?: number }).status !== 401
      ) {
        setLoadError((error as Error).message);
      }
    }
  }, []);

  useEffect(() => {
    if (!user?.id) {
      requestSequence.current += 1;
      return;
    }
    void load();
    return () => {
      requestSequence.current += 1;
    };
  }, [load, user?.id]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await submission.run(async () => {
      setFormError(null);
      try {
        const sequence = ++requestSequence.current;
        const response = await api.createTeam({
          name: name.trim(),
          ...(slogan.trim() ? { slogan: slogan.trim() } : {}),
          ...(welcomeText.trim() ? { welcomeText: welcomeText.trim() } : {}),
        });
        setName("");
        setSlogan("");
        setWelcomeText("");
        if (sequence === requestSequence.current) {
          setTeams((current) => [
            response.team,
            ...(current ?? []).filter((team) => team.id !== response.team.id),
          ]);
        }
      } catch (error) {
        if ((error as Error & { status?: number }).status !== 401) {
          setFormError((error as Error).message);
        }
      }
    });
  }

  return (
    <PageLayout title="Команды">
      <form
        className="card stack"
        onSubmit={create}
        aria-label="Создание команды"
      >
        <TextField
          label="Название команды"
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setName(e.target.value)
          }
          required
        />
        <TextField
          label="Слоган"
          value={slogan}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setSlogan(e.target.value)
          }
        />
        <TextField
          label="Текст приветствия"
          value={welcomeText}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setWelcomeText(e.target.value)
          }
        />
        <Button type="submit" disabled={submission.pending}>
          {submission.pending ? "Создание…" : "Создать"}
        </Button>
        {formError ? <p className="error" role="alert">{formError}</p> : null}
      </form>

      <AsyncState
        loading={teams === null && !loadError}
        error={loadError}
        empty={teams !== null && teams.length === 0}
        emptyTitle="Нет команд"
        emptyDescription="Создайте команду формой выше."
      >
        <div className="stack">
          {(teams ?? []).map((t) => (
            <ListRow
              key={t.id}
              to={`/teams/${t.id}`}
              title={t.name}
              subtitle={[
                t.slogan,
                `${t.members.length} участников`,
                t.isCaptain ? "Вы капитан" : null,
                t.status === "archived" ? "Архив" : null,
              ].filter(Boolean).join(" · ")}
            />
          ))}
        </div>
      </AsyncState>
    </PageLayout>
  );
}
