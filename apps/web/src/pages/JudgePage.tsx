import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "../ui";
import { api } from "../api";

export function JudgePage() {
  const { id } = useParams();
  const [match, setMatch] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  async function load() {
    const res = await api.getMatch(id!);
    setMatch(res.match);
  }

  useEffect(() => {
    void (async () => {
      try {
        const detail = await api.getMatch(id!);
        setMatch(detail.match);
        if (detail.match.status === "waiting") {
          await api.startMatch(id!);
        }
        await api.acquireJudge(id!);
        setReady(true);
        await load();
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id]);

  async function point(side: "A" | "B") {
    if (!match) return;
    try {
      const res = await api.awardPoint(
        id!,
        side,
        Number(match.version),
        crypto.randomUUID(),
      );
      setMatch(res.match);
    } catch (e) {
      setError((e as Error).message);
      await load();
    }
  }

  if (error && !match) return <p className="error">{error}</p>;
  if (!match || !ready) return <p className="muted">Подключение судьи…</p>;

  return (
    <div className="stack">
      <h1 className="page-title">Судейство</h1>
      {error && <p className="error">{error}</p>}
      <div className="judge-board">
        <button
          type="button"
          className="judge-side"
          onClick={() => void point("A")}
          disabled={match.status === "pending_confirmation" || match.status === "finished"}
          aria-label="Очко стороне A"
        >
          {String(match.scoreA)}
          <span className="muted" style={{ fontSize: 14 }}>
            A
          </span>
        </button>
        <button
          type="button"
          className="judge-side"
          onClick={() => void point("B")}
          disabled={match.status === "pending_confirmation" || match.status === "finished"}
          aria-label="Очко стороне B"
        >
          {String(match.scoreB)}
          <span className="muted" style={{ fontSize: 14 }}>
            B
          </span>
        </button>
      </div>
      <div className="row">
        <Button
          variant="secondary"
          onClick={() =>
            api
              .undoPoint(id!, Number(match.version), crypto.randomUUID())
              .then((r) => setMatch(r.match))
              .catch((e) => setError(e.message))
          }
        >
          Undo
        </Button>
        {match.status === "pending_confirmation" && (
          <Button
            onClick={() =>
              api
                .confirmFinish(id!)
                .then((r) => setMatch(r.match))
                .catch((e) => setError(e.message))
            }
          >
            Подтвердить результат
          </Button>
        )}
      </div>
      <p className="muted">Статус: {String(match.status)}</p>
    </div>
  );
}
