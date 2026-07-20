import { useEffect, useState } from "react";
import { Button, TextField } from "../ui";
import { api } from "../api";

export function TeamsPage() {
  const [teams, setTeams] = useState<Array<Record<string, unknown>>>([]);
  const [name, setName] = useState("");

  async function load() {
    const res = await api.listTeams();
    setTeams(res.teams);
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="stack">
      <h1 className="page-title">Команды</h1>
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          void api.createTeam({ name }).then(() => {
            setName("");
            return load();
          });
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
      {teams.map((t) => (
        <div className="card" key={String(t.id)}>
          <strong>{String(t.name)}</strong>
          <div className="muted">
            Участников:{" "}
            {Array.isArray(t.members) ? t.members.length : 0}
          </div>
        </div>
      ))}
    </div>
  );
}
