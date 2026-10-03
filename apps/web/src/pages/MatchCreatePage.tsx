import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Alert, Autocomplete, Button, TextField } from "../ui";
import { PageLayout } from "../layout";
import { FilterBar } from "../patterns";
import { api, type MatchCreateOptions } from "../api";
import { useAuth } from "../auth";
import "./MatchCreatePage.css";

type MatchFormat = "1v1" | "2v2";
type OpponentMode = "user" | "guest";
type FirstServerMethod = "random" | "manual" | "rally";
type SlotKey = "playerA" | "partner" | "opponent1" | "opponent2";
type SlotState = { mode: OpponentMode; userId: string; guestName: string };
type PointsChoice = "11" | "21" | "custom";
type FocusTarget = SlotKey | "points" | "mercy" | "title" | null;
type PreviewAssignment = { label: string; opponent1: string; opponent2?: string };

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
  fieldsetRef,
}: {
  label: string;
  slot: SlotState;
  options: Array<{ value: string; label: string }>;
  onChange: (next: SlotState) => void;
  fieldsetRef?: (node: HTMLFieldSetElement | null) => void;
}) {
  const [inputText, setInputText] = useState(
    () => options.find((option) => option.value === slot.userId)?.label ?? "",
  );
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
    <fieldset ref={fieldsetRef} className="match-create__slot stack">
      <legend>{label}</legend>
      <FilterBar
        label={`${label}: тип участника`}
        value={slot.mode}
        onChange={(value) => onChange({ ...emptySlot(), mode: value as OpponentMode })}
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
          onInputChange={(value) => {
            inputDirtyRef.current = true;
            setInputText(value);
          }}
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
          fullWidth
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
  const [titleOpen, setTitleOpen] = useState(false);
  const [format, setFormat] = useState<MatchFormat>("1v1");
  const [pointsChoice, setPointsChoice] = useState<PointsChoice>("11");
  const [pointsToWin, setPointsToWin] = useState("11");
  const [customPointsToWin, setCustomPointsToWin] = useState("11");
  const [mercyEnabled, setMercyEnabled] = useState(true);
  const [mercyPoints, setMercyPoints] = useState("5");
  const [mercyManuallyEdited, setMercyManuallyEdited] = useState(false);
  const [firstServerMethod, setFirstServerMethod] = useState<FirstServerMethod>("manual");
  const [rulesOpen, setRulesOpen] = useState(false);
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
  const [preview, setPreview] = useState<PreviewAssignment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(null);
  const [pending, setPending] = useState(false);
  const slotRefs = useRef<Partial<Record<SlotKey, HTMLFieldSetElement | null>>>({});

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const hiddenKeys = ["opponentId", "opponentName", "revengeOf", "source"];
    if (!hiddenKeys.some((key) => query.has(key))) return;
    hiddenKeys.forEach((key) => query.delete(key));
    navigate(
      { pathname: location.pathname, search: query.toString() ? `?${query}` : "" },
      { replace: true },
    );
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

  useEffect(() => {
    if (!focusTarget) return;
    const input =
      focusTarget === "points"
        ? document.getElementById("match-points-custom")
        : focusTarget === "mercy"
          ? document.getElementById("match-mercy-points")
          : focusTarget === "title"
            ? document.getElementById("match-title")
            : slotRefs.current[focusTarget]?.querySelector<HTMLElement>("input");
    input?.focus();
    setFocusTarget(null);
  }, [focusTarget, rulesOpen, titleOpen]);

  useEffect(() => {
    if (format === "1v1") setPreview(null);
  }, [format]);

  function updateSlot(key: SlotKey, value: SlotState) {
    setSlots((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  const optionById = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );
  const occupiedSideAIds = useMemo(() => {
    const ids = new Set<string>();
    if (creatorParticipates && user?.id) ids.add(user.id);
    if (!creatorParticipates && slots.playerA.mode === "user" && slots.playerA.userId) {
      ids.add(slots.playerA.userId);
    }
    if (format === "2v2" && slots.partner.mode === "user" && slots.partner.userId) {
      ids.add(slots.partner.userId);
    }
    return ids;
  }, [creatorParticipates, format, slots.partner, slots.playerA, user?.id]);
  const frequentOptions = useMemo(
    () => creatorParticipates
      ? (createOptions?.frequentOpponentIds ?? []).flatMap((id) => {
          const option = optionById.get(id);
          return option && !occupiedSideAIds.has(id) ? [option] : [];
        })
      : [],
    [createOptions?.frequentOpponentIds, creatorParticipates, occupiedSideAIds, optionById],
  );
  const recentOptions = useMemo(
    () => creatorParticipates
      ? (createOptions?.recentOpponentIds ?? []).flatMap((id) => {
          const option = optionById.get(id);
          return option && !occupiedSideAIds.has(id) ? [option] : [];
        })
      : [],
    [createOptions?.recentOpponentIds, creatorParticipates, occupiedSideAIds, optionById],
  );
  const eligibleTeams = useMemo(
    () => format === "2v2"
      ? (createOptions?.teams ?? []).flatMap((team) => {
          const available = team.userIds.filter(
            (userId) =>
              userId !== user?.id &&
              !occupiedSideAIds.has(userId) &&
              optionById.has(userId),
          );
          return available.length >= 2 ? [{ ...team, available: available.slice(0, 2) }] : [];
        })
      : [],
    [createOptions?.teams, format, occupiedSideAIds, optionById, user?.id],
  );
  const hasQuickChoices =
    frequentOptions.length > 0 || recentOptions.length > 0 || eligibleTeams.length > 0;

  useEffect(() => {
    if (!preview) return;
    if (
      occupiedSideAIds.has(preview.opponent1) ||
      (preview.opponent2 ? occupiedSideAIds.has(preview.opponent2) : false)
    ) {
      setPreview(null);
    }
  }, [occupiedSideAIds, preview]);

  function selectSuggestedOpponent(userId: string) {
    if (!optionById.has(userId) || occupiedSideAIds.has(userId)) return;
    if (!slots.opponent1.userId && !slots.opponent1.guestName.trim()) {
      updateSlot("opponent1", { mode: "user", userId, guestName: "" });
      setPreview(null);
      return;
    }
    setPreview({ label: "Заменить соперника", opponent1: userId });
  }

  function previewTeam(name: string, userIds: string[]) {
    if (!userIds[0] || !userIds[1]) return;
    setPreview({ label: name, opponent1: userIds[0], opponent2: userIds[1] });
  }

  function applyPreview() {
    if (!preview) return;
    if (
      occupiedSideAIds.has(preview.opponent1) ||
      (preview.opponent2 ? occupiedSideAIds.has(preview.opponent2) : false)
    ) {
      setPreview(null);
      setError("Игрок стороны A не может одновременно занять место стороны B");
      return;
    }
    setSlots((current) => ({
      ...current,
      opponent1: { mode: "user", userId: preview.opponent1, guestName: "" },
      ...(preview.opponent2
        ? { opponent2: { mode: "user" as const, userId: preview.opponent2, guestName: "" } }
        : {}),
    }));
    setPreview(null);
    setError(null);
  }

  function setPoints(choice: PointsChoice) {
    setPointsChoice(choice);
    const value = choice === "custom" ? customPointsToWin : choice;
    setPointsToWin(value);
    const parsed = Number(value);
    if (!mercyManuallyEdited && Number.isInteger(parsed) && parsed > 0) {
      setMercyPoints(String(defaultMercyPoints(parsed)));
    }
    setError(null);
  }

  function changeCustomPoints(value: string) {
    setCustomPointsToWin(value);
    setPointsToWin(value);
    const parsed = Number(value);
    if (!mercyManuallyEdited && Number.isInteger(parsed) && parsed > 0) {
      setMercyPoints(String(defaultMercyPoints(parsed)));
    }
    setError(null);
  }

  function stepCustomPoints(delta: number) {
    const parsed = Number(pointsToWin);
    const next = Math.max(1, Number.isInteger(parsed) ? parsed + delta : 1);
    changeCustomPoints(String(next));
  }

  function fail(message: string, target: FocusTarget, section?: "rules" | "title"): never {
    if (section === "rules") setRulesOpen(true);
    if (section === "title") setTitleOpen(true);
    setError(message);
    setFocusTarget(target);
    throw new Error(message);
  }

  function slotPayload(key: SlotKey, side: "A" | "B") {
    const slot = slots[key];
    if (slot.mode === "user") {
      if (!slot.userId) fail("Выберите всех игроков из списка", key);
      return { side, userId: slot.userId };
    }
    const parts = slot.guestName.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) fail("Для гостя укажите имя и фамилию", key);
    return {
      side,
      guestFirstName: parts[0]!,
      guestLastName: parts.slice(1).join(" "),
    };
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      if (!user?.id) throw new Error("Сессия пользователя не загружена");
      if (!title.trim()) fail("Укажите название матча", "title", "title");
      const points = Number(pointsToWin);
      const mercy = Number(mercyPoints);
      if (!Number.isInteger(points) || points < 1) {
        fail("Очки до победы должны быть положительным целым числом", "points", "rules");
      }
      if (mercyEnabled && (!Number.isInteger(mercy) || mercy < 1)) {
        fail("Порог сухой победы должен быть положительным целым числом", "mercy", "rules");
      }
      const participants = [
        ...(creatorParticipates
          ? [{ side: "A" as const, userId: user.id }]
          : [slotPayload("playerA", "A")]),
        ...(format === "2v2" ? [slotPayload("partner", "A")] : []),
        slotPayload("opponent1", "B"),
        ...(format === "2v2" ? [slotPayload("opponent2", "B")] : []),
      ];
      const registeredIds = participants.flatMap((participant) =>
        "userId" in participant ? [participant.userId] : [],
      );
      if (new Set(registeredIds).size !== registeredIds.length) {
        fail("Один игрок не может занимать несколько мест", "opponent1");
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
        setError((current) => current ?? (reason as Error).message);
      }
    } finally {
      setPending(false);
    }
  }

  const serverMethodLabel = {
    manual: "вручную",
    random: "случайно",
    rally: "розыгрышем",
  }[firstServerMethod];
  const rulesSummary = `До ${pointsToWin || "—"} · ${
    mercyEnabled ? `сухая ${mercyPoints || "—"}:0` : "сухая выключена"
  } · первая подача ${serverMethodLabel}`;

  return (
    <PageLayout title="Новый матч">
      <form
        className="card stack match-create"
        onSubmit={create}
        aria-label="Создание матча"
        noValidate
      >
        <fieldset
          className="match-create__payload stack"
          disabled={pending}
          aria-busy={pending}
        >
          <section className="match-create__primary stack" aria-labelledby="match-create-format">
            <h2 id="match-create-format">Формат матча</h2>
            <FilterBar
              label="Формат"
              value={format}
              onChange={(value) => setFormat(value as MatchFormat)}
              options={[
                { value: "1v1", label: "1 × 1" },
                { value: "2v2", label: "2 × 2" },
              ]}
            />
            <label className="match-create__check">
              <input
                type="checkbox"
                checked={creatorParticipates}
                onChange={(event) => setCreatorParticipates(event.target.checked)}
              />
              Создатель играет
            </label>
          </section>

          <section className="match-create__composition stack" aria-labelledby="match-create-roster">
            <div className="match-create__section-heading">
              <div>
                <h2 id="match-create-roster">Состав</h2>
                <p className="muted">Выберите зарегистрированных игроков или добавьте разовых гостей.</p>
              </div>
            </div>
            <div className="match-create__sides">
              <section className="match-create__side stack" aria-labelledby="match-create-side-a">
                <h3 id="match-create-side-a">Сторона A</h3>
                {creatorParticipates ? (
                  <p className="match-create__operator">{user?.firstName} {user?.lastName}</p>
                ) : (
                  <SlotEditor
                    label="Игрок A"
                    slot={slots.playerA}
                    options={options}
                    onChange={(value) => updateSlot("playerA", value)}
                    fieldsetRef={(node) => { slotRefs.current.playerA = node; }}
                  />
                )}
                {format === "2v2" ? (
                  <SlotEditor
                    label="Партнёр"
                    slot={slots.partner}
                    options={options}
                    onChange={(value) => updateSlot("partner", value)}
                    fieldsetRef={(node) => { slotRefs.current.partner = node; }}
                  />
                ) : null}
              </section>
              <section className="match-create__side stack" aria-labelledby="match-create-side-b">
                <h3 id="match-create-side-b">Сторона B</h3>
                <SlotEditor
                  label={format === "2v2" ? "Соперник 1" : "Соперник"}
                  slot={slots.opponent1}
                  options={options}
                  onChange={(value) => updateSlot("opponent1", value)}
                  fieldsetRef={(node) => { slotRefs.current.opponent1 = node; }}
                />
                {format === "2v2" ? (
                  <SlotEditor
                    label="Соперник 2"
                    slot={slots.opponent2}
                    options={options}
                    onChange={(value) => updateSlot("opponent2", value)}
                    fieldsetRef={(node) => { slotRefs.current.opponent2 = node; }}
                  />
                ) : null}
              </section>
            </div>
          </section>

          {directoryState === "loading" ? (
            <p role="status" className="muted">Загружаем список игроков…</p>
          ) : null}
          {directoryState === "error" ? (
            <Alert
              type="warning"
              variant="tonal"
              title="Список игроков недоступен"
              description="Можно добавить гостей или повторить загрузку."
              actionLabel="Повторить"
              onAction={() => void loadDirectory()}
            />
          ) : null}
          {directoryState === "ready" && hasQuickChoices ? (
            <section className="match-create__suggestions stack" aria-label="Быстрый выбор игроков">
              <div className="match-create__section-heading">
                <div>
                  <h2>Быстрый выбор</h2>
                  <p className="muted">Перед заменой видно, кого займут места B1 и B2.</p>
                </div>
              </div>
              {frequentOptions.length > 0 ? (
                <div>
                  <h3>Частые соперники</h3>
                  <div className="match-create__suggestion-list">
                    {frequentOptions.map((option) => (
                      <Button key={option.value} type="button" variant="secondary" onClick={() => selectSuggestedOpponent(option.value)}>
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              {recentOptions.length > 0 ? (
                <div>
                  <h3>Недавние соперники</h3>
                  <div className="match-create__suggestion-list">
                    {recentOptions.map((option) => (
                      <Button key={option.value} type="button" variant="secondary" onClick={() => selectSuggestedOpponent(option.value)}>
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              {eligibleTeams.length > 0 ? (
                <div>
                  <h3>Команды</h3>
                  <div className="match-create__suggestion-list">
                    {eligibleTeams.map((team) => (
                      <Button key={team.id} type="button" variant="secondary" onClick={() => previewTeam(team.name, team.available)}>
                        {team.name}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              {preview ? (
                <section className="match-create__preview stack" aria-label="Предпросмотр быстрого выбора">
                  <strong>{preview.label}</strong>
                  <span>B1: {optionById.get(preview.opponent1)?.label}</span>
                  {preview.opponent2 ? <span>B2: {optionById.get(preview.opponent2)?.label}</span> : null}
                  <div className="match-create__inline-actions">
                    <Button type="button" onClick={applyPreview}>Применить</Button>
                    <Button type="button" variant="secondary" onClick={() => setPreview(null)}>Отмена</Button>
                  </div>
                </section>
              ) : null}
            </section>
          ) : null}

          <section className="match-create__summary stack" aria-labelledby="match-create-rules-title">
            <div className="match-create__summary-row">
              <div>
                <h2 id="match-create-rules-title">Правила</h2>
                <p>{rulesSummary}</p>
              </div>
              <Button type="button" variant="secondary" aria-expanded={rulesOpen} aria-controls="match-create-rules" onClick={() => setRulesOpen((current) => !current)}>
                {rulesOpen ? "Скрыть правила" : "Изменить правила"}
              </Button>
            </div>
            {rulesOpen ? (
              <div id="match-create-rules" className="match-create__disclosure stack">
                <FilterBar
                  label="Очков до победы"
                  value={pointsChoice}
                  onChange={(value) => setPoints(value as PointsChoice)}
                  options={[
                    { value: "11", label: "11" },
                    { value: "21", label: "21" },
                    { value: "custom", label: "Своё" },
                  ]}
                />
                {pointsChoice === "custom" ? (
                  <div className="match-create__stepper">
                    <Button type="button" variant="secondary" aria-label="Уменьшить очки до победы" onClick={() => stepCustomPoints(-1)}>−</Button>
                    <TextField
                      id="match-points-custom"
                      label="Своё значение"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={customPointsToWin}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => changeCustomPoints(event.target.value)}
                      required
                    />
                    <Button type="button" variant="secondary" aria-label="Увеличить очки до победы" onClick={() => stepCustomPoints(1)}>+</Button>
                  </div>
                ) : null}
                <div className="match-create__mercy-row">
                  <label className="match-create__check">
                    <input type="checkbox" checked={mercyEnabled} onChange={(event) => setMercyEnabled(event.target.checked)} />
                    Сухая победа
                  </label>
                  {mercyEnabled ? (
                    <TextField
                      id="match-mercy-points"
                      label="Порог"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={mercyPoints}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        setMercyPoints(event.target.value);
                        setMercyManuallyEdited(true);
                        setError(null);
                      }}
                      required
                    />
                  ) : null}
                </div>
                <FilterBar
                  label="Первый подающий"
                  value={firstServerMethod}
                  onChange={(value) => setFirstServerMethod(value as FirstServerMethod)}
                  options={[
                    { value: "manual", label: "Вручную" },
                    { value: "random", label: "Случайно" },
                    { value: "rally", label: "Розыгрыш" },
                  ]}
                />
                <p className="context-tip" role="note" aria-label="Подсказка о подаче">
                  До победного порога подача меняется после двух подач. После достижения порога — после каждого очка, пока не появится отрыв в два.
                </p>
              </div>
            ) : null}
          </section>

          <section className="match-create__summary stack">
            <div className="match-create__summary-row">
              <div>
                <h2 id="match-create-title-heading">Название</h2>
                <p>{title || "Без названия"}</p>
              </div>
              <Button type="button" variant="secondary" aria-expanded={titleOpen} aria-controls="match-create-title-editor" onClick={() => setTitleOpen((current) => !current)}>
                {titleOpen ? "Скрыть название" : "Изменить название"}
              </Button>
            </div>
            {titleOpen ? (
              <div id="match-create-title-editor" className="match-create__disclosure">
                <TextField id="match-title" label="Название" value={title} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)} required fullWidth />
              </div>
            ) : null}
          </section>

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
