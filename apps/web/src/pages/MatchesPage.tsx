import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, TextField } from "../ui";
import { api } from "../api";
import { useAuth } from "../auth";

export function MatchesPage() {
  const { user } = useAuth();
  const [matches, setMatches] = useState<Array<Record<string, unknown>>>([]);
  const [title, setTitle] = useState("Матч");
  const [opponentId, setOpponentId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await api.listMatches();
    setMatches(res.matches);
  }

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      const participants = [
        { side: "A" as const, userId: user!.id },
        guestName
          ? {
              side: "B" as const,
              guestFirstName: guestName.split(" ")[0] ?? guestName,
              guestLastName: guestName.split(" ")[1] ?? "Гость",
            }
          : { side: "B" as const, userId: opponentId },
      ];
      const res = await api.createMatch({
        title,
        format: "1v1",
        participants,
      });
      await load();
      window.location.href = `/matches/${res.match.id}`;
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="stack">
      <h1 className="page-title">Матчи</h1>
      <form className="card stack" onSubmit={create}>
        <TextField
          label="Название"
          value={title}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setTitle(e.target.value)
          }
        />
        <TextField
          label="ID соперника (или оставьте пустым)"
          value={opponentId}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setOpponentId(e.target.value)
          }
        />
        <TextField
          label="Или гость (Имя Фамилия)"
          value={guestName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setGuestName(e.target.value)
          }
        />
        <Button type="submit">Создать матч</Button>
        {error && <p className="error">{error}</p>}
      </form>
      {matches.map((m) => (
        <Link key={String(m.id)} to={`/matches/${m.id}`} className="card">
          <strong>{String(m.title)}</strong>
          <div className="muted">
            {String(m.status)} · {String(m.scoreA)}:{String(m.scoreB)}
          </div>
        </Link>
      ))}
    </div>
  );
}
