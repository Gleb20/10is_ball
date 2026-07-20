import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../ui";
import { api } from "../api";

export function MatchDetailPage() {
  const { id } = useParams();
  const [match, setMatch] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await api.getMatch(id!);
    setMatch(res.match);
  }

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!match) return <p className="muted">Загрузка…</p>;

  return (
    <div className="stack">
      <h1 className="page-title">{String(match.title)}</h1>
      <div className="card">
        <p>
          Счёт: {String(match.scoreA)} : {String(match.scoreB)}
        </p>
        <p className="muted">Статус: {String(match.status)}</p>
      </div>
      <div className="row">
        {match.status === "waiting" && (
          <Button
            onClick={() =>
              api
                .startMatch(id!)
                .then((r) => setMatch(r.match))
                .catch((e) => setError(e.message))
            }
          >
            Старт
          </Button>
        )}
        {(match.status === "in_progress" ||
          match.status === "pending_confirmation" ||
          match.status === "waiting") && (
          <Link to={`/matches/${id}/judge`}>
            <Button>Судить</Button>
          </Link>
        )}
      </div>
    </div>
  );
}
