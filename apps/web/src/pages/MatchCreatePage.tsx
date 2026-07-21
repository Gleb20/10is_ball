import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Autocomplete, Button, TextField } from "../ui";
import { PageLayout } from "../layout";
import { FilterBar } from "../patterns";
import { api } from "../api";
import { useAuth } from "../auth";

type OpponentMode = "user" | "guest";

function defaultMatchTitle() {
  const d = new Date();
  return `Матч ${d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/** Create match wizard — ADR D5 Q-UI-2 `/matches/new`. */
export function MatchCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [title, setTitle] = useState(defaultMatchTitle);
  const [pointsToWin, setPointsToWin] = useState<11 | 21>(11);
  const [mode, setMode] = useState<OpponentMode>("guest");
  const [opponentId, setOpponentId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [options, setOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const challengeHint = useMemo(() => {
    const name = searchParams.get("opponentName");
    return name ? `Вызов: ${name}` : null;
  }, [searchParams]);

  useEffect(() => {
    const opp = searchParams.get("opponentId");
    const name = searchParams.get("opponentName");
    if (opp) {
      setMode("user");
      setOpponentId(opp);
    }
    if (name) {
      setTitle(`Матч vs ${name}`);
    }
  }, [searchParams]);

  useEffect(() => {
    void api
      .directory()
      .then((res) =>
        setOptions(
          res.users
            .filter((u) => u.id !== user?.id)
            .map((u) => ({
              value: u.id,
              label: u.displayName,
            })),
        ),
      )
      .catch(() => setError("Не удалось загрузить список игроков"));
  }, [user?.id]);

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
        pointsToWin,
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
      {challengeHint ? <p className="muted">{challengeHint}</p> : null}
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
          label="Очков до победы"
          value={String(pointsToWin)}
          onChange={(v) => setPointsToWin(Number(v) as 11 | 21)}
          options={[
            { value: "11", label: "11" },
            { value: "21", label: "21" },
          ]}
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
        <div className="stack stack--actions">
          <Button type="submit" disabled={pending}>
            {pending ? "Создание…" : "Создать матч"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(searchParams.get("opponentId") ? "/rankings" : "/start")}
          >
            Отмена
          </Button>
        </div>
        {error && (
          <Alert type="error" variant="tonal" title="Ошибка" description={error} />
        )}
      </form>
    </PageLayout>
  );
}
