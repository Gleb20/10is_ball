import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, TextField } from "../ui";
import { api } from "../api";

export function TournamentsPage() {
  const [list, setList] = useState<Array<Record<string, unknown>>>([]);
  const [title, setTitle] = useState("Турнир");
  const [format, setFormat] = useState<"single_elimination" | "double_elimination">(
    "single_elimination",
  );

  async function load() {
    const res = await api.listTournaments();
    setList(res.tournaments);
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="stack">
      <h1 className="page-title">Турниры</h1>
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          void api
            .createTournament({ title, format })
            .then((r) => {
              window.location.href = `/tournaments/${r.tournament.id}`;
            });
        }}
      >
        <TextField
          label="Название"
          value={title}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setTitle(e.target.value)
          }
        />
        <div className="row">
          <Button
            type="button"
            variant={format === "single_elimination" ? "primary" : "secondary"}
            onClick={() => setFormat("single_elimination")}
          >
            Single
          </Button>
          <Button
            type="button"
            variant={format === "double_elimination" ? "primary" : "secondary"}
            onClick={() => setFormat("double_elimination")}
          >
            Double
          </Button>
        </div>
        <Button type="submit">Создать</Button>
      </form>
      {list.map((t) => (
        <Link key={String(t.id)} to={`/tournaments/${t.id}`} className="card">
          <strong>{String(t.title)}</strong>
          <div className="muted">
            {String(t.format)} · {String(t.status)}
          </div>
        </Link>
      ))}
    </div>
  );
}
