import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../ui";
import { api } from "../api";
import { useAuth } from "../auth";

export function HomePage() {
  const { user } = useAuth();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .home()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Загрузка…</p>;

  const lastMatches = (data.lastMatches as Array<Record<string, unknown>>) ?? [];
  const hero = data.hero as { type: string; displayName?: string; wins?: number };

  return (
    <div className="stack">
      <h1 className="page-title">
        Привет, {user?.firstName ?? "игрок"}
      </h1>
      {hero?.type === "empty" ? (
        <div className="empty-state card">
          <p>Пока нет игр. Создайте первый матч!</p>
          <Link to="/matches">
            <Button>Создать матч</Button>
          </Link>
        </div>
      ) : (
        <div className="card">
          <p className="muted">Лидер рейтинга</p>
          <strong>
            {hero.displayName} — {hero.wins} побед
          </strong>
        </div>
      )}

      <div className="row">
        <Link to="/matches">
          <Button>Матч</Button>
        </Link>
        <Link to="/tournaments">
          <Button variant="secondary">Турнир</Button>
        </Link>
        <Link to="/onboarding">
          <Button variant="secondary">Обучение</Button>
        </Link>
      </div>

      <h2>Последние матчи</h2>
      {lastMatches.length === 0 ? (
        <p className="muted">История пуста</p>
      ) : (
        lastMatches.map((m) => (
          <Link key={String(m.id)} to={`/matches/${m.id}`} className="card">
            <strong>{String(m.title)}</strong>
            <div className="muted">
              {String(m.status)} · {String(m.scoreA)}:{String(m.scoreB)}
            </div>
          </Link>
        ))
      )}

      {user?.role === "admin" && (
        <Link to="/admin">
          <Button variant="secondary">Админка</Button>
        </Link>
      )}
    </div>
  );
}
