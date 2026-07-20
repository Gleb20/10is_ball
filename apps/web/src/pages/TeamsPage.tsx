import { useEffect, useState } from "react";
import { Button, TextField } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, ListRow } from "../patterns";
import { api } from "../api";

export function TeamsPage() {
  const [teams, setTeams] = useState<Array<Record<string, unknown>> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");

  async function load() {
    const res = await api.listTeams();
    setTeams(res.teams);
  }

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);

  return (
    <PageLayout title="Команды">
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          void api
            .createTeam({ name })
            .then(() => {
              setName("");
              return load();
            })
            .catch((err) => setError((err as Error).message));
        }}
      >
        <TextField
          label="Название команды"
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setName(e.target.value)
          }
          required
        />
        <Button type="submit">Создать</Button>
      </form>

      <AsyncState
        loading={teams === null && !error}
        error={error}
        empty={teams !== null && teams.length === 0}
        emptyTitle="Нет команд"
        emptyDescription="Создайте команду формой выше."
      >
        <div className="stack">
          {(teams ?? []).map((t) => (
            <ListRow
              key={String(t.id)}
              title={String(t.name)}
              subtitle={`Участников: ${
                Array.isArray(t.members) ? t.members.length : 0
              }`}
            />
          ))}
        </div>
      </AsyncState>
    </PageLayout>
  );
}
