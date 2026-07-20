import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Autocomplete, Button, TextField } from "../ui";
import { PageLayout } from "../layout";
import { FilterBar } from "../patterns";
import { api } from "../api";
import { useAuth } from "../auth";

type OpponentMode = "user" | "guest";

/** Create match wizard — ADR D5 Q-UI-2 `/matches/new`. */
export function MatchCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState("Матч");
  const [mode, setMode] = useState<OpponentMode>("guest");
  const [opponentId, setOpponentId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [options, setOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void api
      .directory()
      .then((res) =>
        setOptions(
          res.users.map((u) => ({
            value: u.id,
            label: u.displayName,
          })),
        ),
      )
      .catch(() => setOptions([]));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (mode === "user" && !opponentId) {
        setError("Выберите соперника из списка");
        setPending(false);
        return;
      }
      if (mode === "guest" && !guestName.trim()) {
        setError("Укажите имя гостя");
        setPending(false);
        return;
      }
      const participants = [
        { side: "A" as const, userId: user!.id },
        mode === "guest"
          ? {
              side: "B" as const,
              guestFirstName: guestName.trim().split(/\s+/)[0] ?? guestName,
              guestLastName:
                guestName.trim().split(/\s+/).slice(1).join(" ") || "Гость",
            }
          : { side: "B" as const, userId: opponentId },
      ];
      const res = await api.createMatch({
        title,
        format: "1v1",
        participants,
      });
      navigate(`/matches/${res.match.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <PageLayout title="Новый матч">
      <form className="card stack" onSubmit={create} aria-label="Создание матча">
        <TextField
          label="Название"
          value={title}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setTitle(e.target.value)
          }
          required
        />
        <FilterBar
          label="Тип соперника"
          value={mode}
          onChange={(v) => {
            setMode(v as OpponentMode);
            setError(null);
          }}
          options={[
            { value: "guest", label: "Гость" },
            { value: "user", label: "Игрок" },
          ]}
        />
        {mode === "user" ? (
          <Autocomplete
            label="Соперник"
            placeholder="Начните вводить имя"
            options={options}
            value={opponentId}
            onChange={(value) => setOpponentId(value)}
            clearable
            fullWidth
          />
        ) : (
          <TextField
            label="Гость (Имя Фамилия)"
            value={guestName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setGuestName(e.target.value)
            }
            placeholder="Иван Иванов"
            required
          />
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Создание…" : "Создать матч"}
        </Button>
        {error && (
          <Alert type="error" variant="tonal" title="Ошибка" description={error} />
        )}
      </form>
    </PageLayout>
  );
}
