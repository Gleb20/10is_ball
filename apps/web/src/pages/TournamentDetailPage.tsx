import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, TextField } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, StatusChip, formatLabel } from "../patterns";
import { api } from "../api";

export function TournamentDetailPage() {
  const { id } = useParams();
  const [tournament, setTournament] = useState<Record<string, unknown> | null>(
    null,
  );
  const [guest, setGuest] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await api.getTournament(id!);
    setTournament(res.tournament);
  }

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [id]);

  const participants =
    (tournament?.participants as Array<Record<string, unknown>>) ?? [];
  const bracket = tournament?.bracketJson as
    | { slots?: Array<Record<string, unknown>>; size?: number }
    | null
    | undefined;

  return (
    <PageLayout title={tournament ? String(tournament.title) : "Турнир"}>
      <AsyncState loading={!tournament && !error} error={error}>
        {tournament ? (
          <div className="stack page-layout">
            <div className="row">
              <StatusChip
                status={String(tournament.status)}
                domain="tournament"
              />
              <span className="muted">
                {formatLabel(String(tournament.format))}
              </span>
            </div>

            <div className="card stack">
              <h2 className="section-title">
                Участники ({participants.length})
              </h2>
              {participants.length === 0 ? (
                <p className="muted">Пока никого нет</p>
              ) : (
                participants.map((p) => (
                  <div key={String(p.id)} className="muted">
                    {p.userId
                      ? String(p.userId).slice(0, 8)
                      : `${p.guestFirstName} ${p.guestLastName}`}
                  </div>
                ))
              )}
              <TextField
                label="Добавить гостя (Имя Фамилия)"
                value={guest}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setGuest(e.target.value)
                }
              />
              <Button
                onClick={() => {
                  const [first, ...rest] = guest.trim().split(/\s+/);
                  void api
                    .addTournamentParticipant(id!, {
                      guestFirstName: first,
                      guestLastName: rest.join(" ") || "Гость",
                    })
                    .then(() => {
                      setGuest("");
                      return load();
                    })
                    .catch((e) => setError(e.message));
                }}
              >
                Добавить
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  api
                    .generateBracket(id!)
                    .then(load)
                    .catch((e) => setError(e.message))
                }
              >
                Сгенерировать сетку
              </Button>
            </div>

            {bracket?.slots && (
              <div className="card stack">
                <h2 className="section-title">Сетка ({bracket.size})</h2>
                <p className="muted">Слотов: {bracket.slots.length}</p>
                {bracket.slots
                  .filter((s) => s.round === 0)
                  .map((s) => (
                    <div key={String(s.id)} className="muted">
                      R0#{String(s.position)}{" "}
                      {s.isBye
                        ? "BYE"
                        : s.participantId
                          ? String(s.participantId).slice(0, 8)
                          : "—"}
                    </div>
                  ))}
              </div>
            )}
          </div>
        ) : null}
      </AsyncState>
    </PageLayout>
  );
}
