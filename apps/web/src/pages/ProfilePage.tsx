import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../ui";
import { api } from "../api";
import { useAuth } from "../auth";

export function ProfilePage() {
  const { user, setUser } = useAuth();
  const [sessions, setSessions] = useState<
    Array<{ id: string; userAgent: string | null; current: boolean }>
  >([]);
  const navigate = useNavigate();

  useEffect(() => {
    void api.sessions().then((r) => setSessions(r.sessions));
  }, []);

  return (
    <div className="stack">
      <h1 className="page-title">Профиль</h1>
      <div className="card">
        <strong>
          {user?.lastName} {user?.firstName}
        </strong>
        <div className="muted">{user?.email}</div>
        <div className="muted">Роль: {user?.role}</div>
      </div>
      <h2>Сессии</h2>
      {sessions.map((s) => (
        <div className="card" key={s.id}>
          <div className="muted">{s.userAgent ?? "Устройство"}</div>
          {s.current && <strong>Текущая</strong>}
        </div>
      ))}
      <div className="row">
        <Link to="/teams">
          <Button variant="secondary">Команды</Button>
        </Link>
        <Link to="/help">
          <Button variant="secondary">Помощь</Button>
        </Link>
        <Button
          variant="secondary"
          onClick={() =>
            api.logout().then(() => {
              setUser(null);
              navigate("/login");
            })
          }
        >
          Выйти
        </Button>
      </div>
    </div>
  );
}
