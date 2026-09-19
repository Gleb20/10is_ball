import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Alert, Autocomplete, Button, TextField } from "../ui";
import { PageLayout } from "../layout";
import { FilterBar } from "../patterns";
import { api, type MatchCreateOptions } from "../api";
import { useAuth } from "../auth";

type MatchFormat = "1v1" | "2v2";
type OpponentMode = "user" | "guest";
type FirstServerMethod = "random" | "manual" | "rally";
type SlotKey = "playerA" | "partner" | "opponent1" | "opponent2";
type SlotState = { mode: OpponentMode; userId: string; guestName: string };
const emptySlot = (): SlotState => ({ mode: "user", userId: "", guestName: "" });

export function defaultMatchTitle(d = new Date()) {
  return `Матч ${d.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function defaultMercyPoints(pointsToWin: number): number {
  if (pointsToWin === 21) return 10;
  return pointsToWin === 11 ? 5 : Math.max(1, Math.floor(pointsToWin / 2));
}

function SlotEditor({
  label,
  slot,
  options,
  onChange,
}: {
  label: string;
  slot: SlotState;
  options: Array<{ value: string; label: string }>;
  onChange: (next: SlotState) => void;
}) {
  const [inputText, setInputText] = useState(() => options.find((option) => option.value === slot.userId)?.label ?? "");
  const inputDirtyRef = useRef(false);
  const selectionIdentity = `${slot.mode}:${slot.userId}`;
  const selectionIdentityRef = useRef(selectionIdentity);
  const selectedLabel = options.find((option) => option.value === slot.userId)?.label;
  useEffect(() => {
    const selectionChanged = selectionIdentityRef.current !== selectionIdentity;
    selectionIdentityRef.current = selectionIdentity;
    if (!selectionChanged && (inputDirtyRef.current || !slot.userId || !selectedLabel)) return;
    inputDirtyRef.current = false;
    setInputText(selectedLabel ?? "");
  }, [selectedLabel, selectionIdentity, slot.userId]);
  return (
    <fieldset className="match-create__slot stack">
      <legend>{label}</legend>
      <FilterBar
        label={`${label}: тип участника`}
        value={slot.mode}
        onChange={(value) =>
          onChange({ ...emptySlot(), mode: value as OpponentMode })
        }
        options={[
          { value: "user", label: "Игрок" },
          { value: "guest", label: "Гость" },
        ]}
      />
      {slot.mode === "user" ? (
        <Autocomplete
          label={label}
          placeholder="Начните вводить имя"
          options={options}
          value={slot.userId}
          inputValue={inputText}
          onInputChange={(value) => { inputDirtyRef.current = true; setInputText(value); }}
          onChange={(userId) => onChange({ ...slot, userId })}
          clearable
          fullWidth
        />
      ) : (
        <TextField
          label={label === "Соперник" ? "Гость (Имя Фамилия)" : `${label} — гость (Имя Фамилия)`}
          value={slot.guestName}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            onChange({ ...slot, guestName: event.target.value })
          }
          placeholder="Иван Иванов"
          required
        />
      )}
    </fieldset>
  );
}

/** Complete standalone match flow for MATCH-001..005/014. */
export function MatchCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [title, setTitle] = useState(defaultMatchTitle);
  const [format, setFormat] = useState<MatchFormat>("1v1");
  const [pointsToWin, setPointsToWin] = useState("11");
  const [mercyEnabled, setMercyEnabled] = useState(true);
  const [mercyPoints, setMercyPoints] = useState("5");
  const [firstServerMethod, setFirstServerMethod] = useState<FirstServerMethod>("manual");
  const [creatorParticipates, setCreatorParticipates] = useState(false);
  const [slots, setSlots] = useState<Record<SlotKey, SlotState>>({
    playerA: emptySlot(),
    partner: emptySlot(),
    opponent1: emptySlot(),
    opponent2: emptySlot(),
  });
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [createOptions, setCreateOptions] = useState<MatchCreateOptions | null>(null);
  const [directoryState, setDirectoryState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const hiddenKeys = ["opponentId", "opponentName", "revengeOf", "source"];
    if (!hiddenKeys.some((key) => query.has(key))) return;
    hiddenKeys.forEach((key) => query.delete(key));
    navigate({ pathname: location.pathname, search: query.toString() ? `?${query}` : "" }, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const loadDirectory = useCallback(async () => {
    setDirectoryState("loading");
    try {
      const response = await api.matchCreateOptions();
      setCreateOptions(response);
      setOptions(
        response.users
          .filter((candidate) => candidate.id !== user?.id)
          .map((candidate) => ({
            value: candidate.id,
            label: `${candidate.firstName ?? ""} ${candidate.lastName ?? ""}`.trim(),
          })),
      );
      setDirectoryState("ready");
    } catch {
      setDirectoryState("error");
    }
  }, [user?.id]);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  function updateSlot(key: SlotKey, value: SlotState) {
    setSlots((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  const optionById = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );

  function selectSuggestedOpponent(userId: string) {
    if (!optionById.has(userId)) return;
    updateSlot("opponent1", { mode: "user", userId, guestName: "" });
  }

  function selectTeam(userIds: string[]) {
    const available = userIds.filter(
      (userId) => userId !== user?.id && optionById.has(userId),
    );
    if (available.length === 0) return;
    setSlots((current) => ({
      ...current,
      opponent1: { mode: "user", userId: available[0]!, guestName: "" },
      ...(format === "2v2" && available[1]
        ? { opponent2: { mode: "user" as const, userId: available[1], guestName: "" } }
        : {}),
    }));
    setError(null);
  }

  function slotPayload(slot: SlotState, side: "A" | "B") {
    if (slot.mode === "user") {
      if (!slot.userId) throw new Error("Выберите всех игроков из списка");
      return { side, userId: slot.userId };
    }
    const parts = slot.guestName.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) throw new Error("Для гостя укажите имя и фамилию");
    return { side, guestFirstName: parts[0]!, guestLastName: parts.slice(1).join(" ") };
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      if (!user?.id) throw new Error("Сессия пользователя не загружена");
      const points = Number(pointsToWin);
      const mercy = Number(mercyPoints);
      if (!Number.isInteger(points) || points < 1) {
        throw new Error("Очки до победы должны быть положительным целым числом");
      }
      if (mercyEnabled && (!Number.isInteger(mercy) || mercy < 1)) {
        throw new Error("Порог сухой победы должен быть положительным целым числом");
      }
      const participants = [
        ...(creatorParticipates
          ? [{ side: "A" as const, userId: user.id }]
          : [slotPayload(slots.playerA, "A")]),
        ...(format === "2v2" ? [slotPayload(slots.partner, "A")] : []),
        slotPayload(slots.opponent1, "B"),
        ...(format === "2v2" ? [slotPayload(slots.opponent2, "B")] : []),
      ];
      const registeredIds = participants.flatMap((participant) =>
        "userId" in participant ? [participant.userId] : [],
      );
      if (new Set(registeredIds).size !== registeredIds.length) {
        throw new Error("Один игрок не может занимать несколько мест");
      }
      const response = await api.createMatch({
        title,
        format,
        pointsToWin: points,
        mercyEnabled,
        mercyPoints: mercyEnabled ? mercy : null,
        firstServerMethod,
        source: "manual",
        sendPlayerInvitations: false,
        participants,
      });
      navigate(`/matches/${response.match.id}`);
    } catch (reason) {
      // Global recovery owns 401 feedback; preserve only the unsaved form draft.
      if ((reason as Error & { status?: number }).status !== 401) {
        setError((reason as Error).message);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <PageLayout title="Новый матч">
      <form className="card stack" onSubmit={create} aria-label="Создание матча">
        <fieldset className="match-create__payload stack" disabled={pending} aria-busy={pending}>
        <TextField label="Название" value={title} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)} required />
        <FilterBar
          label="Формат"
          value={format}
          onChange={(value) => setFormat(value as MatchFormat)}
          options={[{ value: "1v1", label: "1 × 1" }, { value: "2v2", label: "2 × 2" }]}
        />
        <label className="match-create__check">
          <input
            type="checkbox"
            checked={creatorParticipates}
            onChange={(event) => setCreatorParticipates(event.target.checked)}
          />
          Создатель играет
        </label>
        <TextField
          label="Очков до победы"
          type="number"
          min={1}
          step={1}
          value={pointsToWin}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            const value = event.target.value;
            setPointsToWin(value);
            const parsed = Number(value);
            if (Number.isInteger(parsed) && parsed > 0) setMercyPoints(String(defaultMercyPoints(parsed)));
          }}
          required
        />
        <label className="match-create__check">
          <input type="checkbox" checked={mercyEnabled} onChange={(event) => setMercyEnabled(event.target.checked)} />
          Сухая победа{mercyEnabled ? ` при счёте ${mercyPoints}:0` : " выключена"}
        </label>
        {mercyEnabled ? (
          <TextField label="Порог сухой победы" type="number" min={1} step={1} value={mercyPoints} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setMercyPoints(event.target.value)} required />
        ) : null}
        <FilterBar
          label="Первый подающий"
          value={firstServerMethod}
          onChange={(value) => setFirstServerMethod(value as FirstServerMethod)}
          options={[{ value: "manual", label: "Вручную" }, { value: "random", label: "Случайно" }, { value: "rally", label: "Розыгрыш" }]}
        />
        <p className="context-tip" role="note" aria-label="Подсказка о подаче">
          До победного порога подача меняется после двух подач. После достижения порога — после каждого очка, пока не появится отрыв в два.
        </p>
        {directoryState === "loading" ? <p role="status" className="muted">Загружаем список игроков…</p> : null}
        {directoryState === "error" ? (
          <Alert type="warning" variant="tonal" title="Список игроков недоступен" description="Можно добавить гостей или повторить загрузку." actionLabel="Повторить" onAction={() => void loadDirectory()} />
        ) : null}
        {directoryState === "ready" && createOptions ? (
          <section className="match-create__suggestions stack" aria-label="Быстрый выбор игроков">
            {createOptions.frequentOpponentIds.some((id) => optionById.has(id)) ? (
              <div>
                <h3>Частые соперники</h3>
                <div className="match-create__suggestion-list">
                  {createOptions.frequentOpponentIds.map((id) => optionById.get(id)).filter(Boolean).map((option) => (
                    <Button key={option!.value} type="button" variant="secondary" onClick={() => selectSuggestedOpponent(option!.value)}>{option!.label}</Button>
                  ))}
                </div>
              </div>
            ) : null}
            {createOptions.recentOpponentIds.some((id) => optionById.has(id)) ? (
              <div>
                <h3>Недавние соперники</h3>
                <div className="match-create__suggestion-list">
                  {createOptions.recentOpponentIds.map((id) => optionById.get(id)).filter(Boolean).map((option) => (
                    <Button key={option!.value} type="button" variant="secondary" onClick={() => selectSuggestedOpponent(option!.value)}>{option!.label}</Button>
                  ))}
                </div>
              </div>
            ) : null}
            {createOptions.teams.length > 0 ? (
              <div>
                <h3>Команды</h3>
                <div className="match-create__suggestion-list">
                  {createOptions.teams.map((team) => (
                    <Button key={team.id} type="button" variant="secondary" onClick={() => selectTeam(team.userIds)}>{team.name}</Button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
        {!creatorParticipates ? (
          <SlotEditor label="Игрок A" slot={slots.playerA} options={options} onChange={(value) => updateSlot("playerA", value)} />
        ) : null}
        {format === "2v2" ? <SlotEditor label="Партнёр" slot={slots.partner} options={options} onChange={(value) => updateSlot("partner", value)} /> : null}
        <SlotEditor label={format === "2v2" ? "Соперник 1" : "Соперник"} slot={slots.opponent1} options={options} onChange={(value) => updateSlot("opponent1", value)} />
        {format === "2v2" ? <SlotEditor label="Соперник 2" slot={slots.opponent2} options={options} onChange={(value) => updateSlot("opponent2", value)} /> : null}
        <div className="stack stack--actions">
          <Button type="submit" disabled={pending}>{pending ? "Создание…" : "Создать матч"}</Button>
        </div>
        </fieldset>
        <div className="stack stack--actions">
          <Button type="button" variant="secondary" onClick={() => navigate("/start")}>Отмена</Button>
        </div>
        {error ? <Alert type="error" variant="tonal" title="Ошибка" description={error} /> : null}
      </form>
    </PageLayout>
  );
}
