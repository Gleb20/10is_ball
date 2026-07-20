import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, TextField } from "../ui";
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

  if (!tournament) return <p className="muted">Загрузка…</p>;

  const participants =
    (tournament.participants as Array<Record<string, unknown>>) ?? [];
  const bracket = tournament.bracketJson as
    | { slots?: Array<Record<string, unknown>>; size?: number }
    | null;

  return (
    <div className="stack">
      <h1 className="page-title">{String(tournament.title)}</h1>
      <p className="muted">
        {String(tournament.format)} · {String(tournament.status)}
      </p>
      {error && <p className="error">{error}</p>}

      <div className="card stack">
        <h2>Участники ({participants.length})</h2>
        {participants.map((p) => (
          <div key={String(p.id)}>
            {p.userId
              ? String(p.userId).slice(0, 8)
              : `${p.guestFirstName} ${p.guestLastName}`}
          </div>
        ))}
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
              .then(load)
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
        <div className="card">
          <h2>Сетка ({bracket.size})</h2>
          <p className="muted">Слотов: {bracket.slots.length}</p>
          <div className="stack">
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
        </div>
      )}
    </div>
  );
}
