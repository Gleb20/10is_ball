import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, StatusChip } from "../patterns";
import { api } from "../api";

export function MatchDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [match, setMatch] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await api.getMatch(id!);
    setMatch(res.match);
  }

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [id]);

  return (
    <PageLayout title={match ? String(match.title) : "Матч"}>
      <AsyncState loading={!match && !error} error={error}>
        {match ? (
          <>
            <div className="card stack">
              <div className="row">
                <StatusChip status={String(match.status)} />
              </div>
              <p className="score-display">
                {String(match.scoreA)} : {String(match.scoreB)}
              </p>
            </div>
            <div className="stack stack--actions">
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
                <Button onClick={() => navigate(`/matches/${id}/judge`)}>
                  Судить
                </Button>
              )}
            </div>
          </>
        ) : null}
      </AsyncState>
    </PageLayout>
  );
}
