import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { GuestIdentity, MatchLaunchRequest, MatchLaunchSlot } from "@tab10/shared";
import { Alert, Autocomplete, Button, Dialog, TextField } from "../ui";
import { FilterBar } from "../patterns";
import { GuestPicker } from "../components/GuestPicker";
import { guestCreatePurposeKey } from "../useGuestIdentityMutation";
import { api, type MatchCreateOptions } from "../api";
import { useAuth } from "../auth";
import {
  buildMatchLaunchRequest,
  defaultMercyPoints,
  emptyPreparationSlots,
  holdPreparationForGuestCatalogue,
  readReplaySeed,
  takePreparationFromGuestCatalogue,
  type FirstServerMethod,
  type MatchFormat,
  type PreparationSlot,
  type PreparationSlotKey,
  type PreparationSlots,
} from "./matchPreparation";
import "./MatchCreatePage.css";

type PointsChoice = "11" | "21" | "custom";
type FocusTarget = PreparationSlotKey | "points" | "mercy" | "title" | null;
type PreviewAssignment = { label: string; opponent1: string; opponent2?: string };
type LaunchPhase = "editing" | "serve" | "pending" | "unknown" | "terminal";
type LaunchTicket = {
  actorId: string;
  originAuthEpoch: number;
  payload: MatchLaunchRequest;
  receiptChecked: boolean;
  matchId?: string;
};
type AsyncOperation = {
  actorId: string;
  authEpoch: number;
  lifecycleGeneration: number;
};

const MATCH_LAUNCH_WATCHDOG_MS = 15_000;
const MATCH_LAUNCH_WATCHDOG_TIMEOUT = Symbol("match-launch-watchdog-timeout");

async function withLaunchWatchdog<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(MATCH_LAUNCH_WATCHDOG_TIMEOUT), MATCH_LAUNCH_WATCHDOG_MS);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function defaultMatchTitle(d = new Date()) {
  return `Матч ${d.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function SlotEditor({
  label,
  slot,
  options,
  onChange,
  fieldsetRef,
  excludeGuestIds,
  onOpenGuestCatalogue,
  mutationScope,
  guestMutationPurposeKey,
}: {
  label: string;
  slot: PreparationSlot;
  options: Array<{ value: string; label: string }>;
  onChange: (next: PreparationSlot) => void;
  fieldsetRef?: (node: HTMLFieldSetElement | null) => void;
  excludeGuestIds: string[];
  onOpenGuestCatalogue: () => void;
  mutationScope: { actorId?: string; authEpoch?: number; routeKey?: string };
  guestMutationPurposeKey: string;
}) {
  const selectedLabel = options.find((option) => option.value === slot.userId)?.label ?? slot.userLabel;
  const [inputText, setInputText] = useState(() => selectedLabel ?? "");
  const inputDirtyRef = useRef(false);
  const selectionIdentity = `${slot.mode}:${slot.userId}:${slot.userLabel}`;
  const selectionIdentityRef = useRef(selectionIdentity);

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
        onChange={(mode) => onChange({
          mode: mode as PreparationSlot["mode"],
          userId: "",
          userLabel: "",
          guestName: "",
        })}
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
          onChange={(userId) => onChange({
            ...slot,
            userId,
            userLabel: options.find((option) => option.value === userId)?.label ?? "",
          })}
          clearable
          fullWidth
        />
      ) : (
        <div className="stack">
          <FilterBar
            label={`${label}: вид гостя`}
            value={slot.guestIdentityId ? "saved" : "inline"}
            onChange={(kind) => onChange({
              mode: "guest",
              userId: "",
              userLabel: "",
              guestName: "",
              ...(kind === "saved" ? { guestIdentityId: "", guestIdentityLabel: "" } : {}),
            })}
            options={[
              { value: "inline", label: "Разовый" },
              { value: "saved", label: "Сохранённый" },
            ]}
          />
          {slot.guestIdentityId !== undefined ? (
            <GuestPicker
              label={`${label} — сохранённый гость`}
              value={slot.guestIdentityId ? {
                id: slot.guestIdentityId,
                displayName: slot.guestIdentityLabel || "Сохранённый гость",
                avatarKey: slot.guestAvatarKey ?? "avatar_1",
              } : null}
              excludeGuestIds={excludeGuestIds}
              onChange={(guest: GuestIdentity | null) => onChange({
                mode: "guest",
                userId: "",
                userLabel: "",
                guestName: "",
                guestIdentityId: guest?.id ?? "",
                guestIdentityLabel: guest?.displayName ?? "",
                guestAvatarKey: guest?.avatarKey,
              })}
              onOpenCatalogue={onOpenGuestCatalogue}
              mutationScope={{ ...mutationScope, purposeKey: guestMutationPurposeKey }}
            />
          ) : (
            <TextField
              label={`${label} — гость (Имя Фамилия)`}
              value={slot.guestName}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                onChange({ ...slot, guestName: event.target.value })
              }
              placeholder="Иван Иванов"
              required
              fullWidth
            />
          )}
        </div>
      )}
    </fieldset>
  );
}

function slotDisplayName(
  slot: PreparationSlot,
  options: Map<string, { value: string; label: string }>,
) {
  if (slot.mode === "guest") return slot.guestIdentityId
    ? slot.guestIdentityLabel || "Сохранённый гость"
    : slot.guestName.trim() || "Гость не выбран";
  return (options.get(slot.userId)?.label ?? slot.userLabel) || "Игрок не выбран";
}

function isKnownRejection(error: unknown) {
  const status = (error as { status?: number }).status;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 401;
}

/** Atomic standalone preparation for MATCH-001..005/014 and D40. */
export function MatchCreatePage() {
  const { user, explicitAuthEpoch } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [title, setTitle] = useState(defaultMatchTitle);
  const [format, setFormat] = useState<MatchFormat>("1v1");
  const [pointsChoice, setPointsChoice] = useState<PointsChoice>("11");
  const [pointsToWin, setPointsToWin] = useState("11");
  const [customPointsToWin, setCustomPointsToWin] = useState("11");
  const [mercyEnabled, setMercyEnabled] = useState(true);
  const [mercyPoints, setMercyPoints] = useState("5");
  const [mercyManuallyEdited, setMercyManuallyEdited] = useState(false);
  const [firstServerMethod, setFirstServerMethod] = useState<FirstServerMethod>("manual");
  const [creatorParticipates, setCreatorParticipates] = useState(false);
  const [slots, setSlots] = useState<PreparationSlots>(emptyPreparationSlots);
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [createOptions, setCreateOptions] = useState<MatchCreateOptions | null>(null);
  const [directoryState, setDirectoryState] = useState<"loading" | "ready" | "error">("loading");
  const [preview, setPreview] = useState<PreviewAssignment | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [phase, setPhaseState] = useState<LaunchPhase>("editing");
  const [sidesSwapped, setSidesSwapped] = useState(false);
  const [ticket, setTicketState] = useState<LaunchTicket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(null);
  const slotRefs = useRef<Partial<Record<PreparationSlotKey, HTMLFieldSetElement | null>>>({});
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const mountedRef = useRef(false);
  const lifecycleGenerationRef = useRef(0);
  const phaseRef = useRef<LaunchPhase>(phase);
  const ticketRef = useRef<LaunchTicket | null>(ticket);
  const authRef = useRef({ actorId: user?.id ?? null, explicitAuthEpoch });
  const directorySequenceRef = useRef(0);
  const replayConsumedRef = useRef(false);
  const lastActorRef = useRef<string | null>(null);
  const [guestDraftToken, setGuestDraftToken] = useState<string>(() => crypto.randomUUID());

  phaseRef.current = phase;
  ticketRef.current = ticket;
  authRef.current = { actorId: user?.id ?? null, explicitAuthEpoch };
  const guestMutationScope = {
    actorId: user?.id ?? lastActorRef.current ?? undefined,
    authEpoch: explicitAuthEpoch,
    routeKey: location.pathname,
  };

  const setPhase = useCallback((next: LaunchPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);
  const setTicket = useCallback((next: LaunchTicket | null) => {
    ticketRef.current = next;
    setTicketState(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    lifecycleGenerationRef.current += 1;
    if (phaseRef.current === "pending" && ticketRef.current) setPhase("unknown");
    return () => {
      mountedRef.current = false;
      lifecycleGenerationRef.current += 1;
      directorySequenceRef.current += 1;
    };
  }, [setPhase]);

  const isCurrentOperation = useCallback((operation: AsyncOperation) =>
    mountedRef.current &&
    lifecycleGenerationRef.current === operation.lifecycleGeneration &&
    authRef.current.actorId === operation.actorId &&
    authRef.current.explicitAuthEpoch === operation.authEpoch, []);

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const hiddenKeys = ["opponentId", "opponentName", "revengeOf", "source"];
    if (!hiddenKeys.some((key) => query.has(key))) return;
    hiddenKeys.forEach((key) => query.delete(key));
    navigate(
      { pathname: location.pathname, search: query.toString() ? `?${query}` : "" },
      { replace: true, state: location.state },
    );
  }, [location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    if (replayConsumedRef.current || !user?.id) return;
    replayConsumedRef.current = true;
    const routeState = location.state && typeof location.state === "object"
      ? location.state as Record<string, unknown>
      : null;
    const selection = routeState?.guestSelection && typeof routeState.guestSelection === "object"
      ? routeState.guestSelection as { kind?: unknown; draftToken?: unknown; slotKey?: unknown; guest?: unknown }
      : null;
    const cancellation = routeState?.guestSelectionCancel && typeof routeState.guestSelectionCancel === "object"
      ? routeState.guestSelectionCancel as { kind?: unknown; draftToken?: unknown }
      : null;
    const detour = selection?.kind === "match" ? selection : cancellation?.kind === "match" ? cancellation : null;
    const detourSeed = detour && typeof detour.draftToken === "string"
      ? takePreparationFromGuestCatalogue(detour.draftToken, user.id)
      : null;
    const seed = detourSeed ?? readReplaySeed(location.state, user.id);
    if (seed) {
      if (detour && typeof detour.draftToken === "string") setGuestDraftToken(detour.draftToken);
      setTitle(seed.title);
      setFormat(seed.format);
      setPointsToWin(seed.draftValues?.pointsToWin ?? String(seed.pointsToWin));
      setCustomPointsToWin(seed.draftValues?.customPointsToWin ?? String(seed.pointsToWin));
      setPointsChoice(seed.draftValues?.pointsChoice ?? (seed.pointsToWin === 11 ? "11" : seed.pointsToWin === 21 ? "21" : "custom"));
      setMercyEnabled(seed.mercyEnabled);
      setMercyPoints(seed.draftValues?.mercyPoints ?? String(seed.mercyPoints));
      setMercyManuallyEdited(seed.draftValues?.mercyManuallyEdited ?? true);
      setFirstServerMethod(seed.firstServerMethod);
      setCreatorParticipates(seed.creatorParticipates);
      const validSlotKeys: PreparationSlotKey[] = ["playerA", "partner", "opponent1", "opponent2"];
      const selectedGuest = selection?.guest && typeof selection.guest === "object"
        ? selection.guest as Partial<GuestIdentity>
        : null;
      if (
        detourSeed &&
        typeof selection?.slotKey === "string" &&
        validSlotKeys.includes(selection.slotKey as PreparationSlotKey) &&
        typeof selectedGuest?.id === "string" &&
        typeof selectedGuest.displayName === "string" &&
        typeof selectedGuest.avatarKey === "string"
      ) {
        setSlots({
          ...seed.slots,
          [selection.slotKey]: {
            mode: "guest",
            userId: "",
            userLabel: "",
            guestName: "",
            guestIdentityId: selectedGuest.id,
            guestIdentityLabel: selectedGuest.displayName,
            guestAvatarKey: selectedGuest.avatarKey,
          },
        });
      } else {
        setSlots(seed.slots);
      }
    } else if (detour) {
      setError("Не удалось восстановить подготовку после каталога гостей. Заполните состав ещё раз.");
    }
    if (routeState && ("matchReplaySeed" in routeState || "guestSelection" in routeState || "guestSelectionCancel" in routeState)) {
      const nextState = { ...routeState };
      delete nextState.matchReplaySeed;
      delete nextState.guestSelection;
      delete nextState.guestSelectionCancel;
      navigate(
        { pathname: location.pathname, search: location.search, hash: location.hash },
        { replace: true, state: Object.keys(nextState).length > 0 ? nextState : null },
      );
    }
  }, [location.hash, location.pathname, location.search, location.state, navigate, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const previousActor = lastActorRef.current;
    lastActorRef.current = user.id;
    if (previousActor && previousActor !== user.id) {
      setTicket(null);
      setPhase("editing");
      setSlots(emptyPreparationSlots());
      setCreatorParticipates(false);
      setError(null);
      return;
    }
    const frozen = ticketRef.current;
    if (!frozen || frozen.actorId !== user.id || frozen.originAuthEpoch === explicitAuthEpoch) return;
    if (frozen.matchId) {
      navigate(`/matches/${frozen.matchId}`, { replace: true });
      return;
    }
    if (phaseRef.current === "pending") setPhase("unknown");
  }, [explicitAuthEpoch, navigate, setPhase, setTicket, user?.id]);

  const loadDirectory = useCallback(async () => {
    if (!user?.id) return;
    const operation: AsyncOperation = {
      actorId: user.id,
      authEpoch: explicitAuthEpoch,
      lifecycleGeneration: lifecycleGenerationRef.current,
    };
    const sequence = ++directorySequenceRef.current;
    let nextState: "ready" | "error" = "error";
    setDirectoryState("loading");
    try {
      const response = await api.matchCreateOptions();
      if (sequence !== directorySequenceRef.current || !isCurrentOperation(operation)) return;
      setCreateOptions(response);
      setOptions(response.users
        .filter((candidate) => candidate.id !== operation.actorId)
        .map((candidate) => ({
          value: candidate.id,
          label: `${candidate.firstName ?? ""} ${candidate.lastName ?? ""}`.trim(),
        })));
      nextState = "ready";
    } catch {
      if (sequence !== directorySequenceRef.current || !isCurrentOperation(operation)) return;
      nextState = "error";
    } finally {
      if (sequence === directorySequenceRef.current && isCurrentOperation(operation)) {
        setDirectoryState(nextState);
      }
    }
  }, [explicitAuthEpoch, isCurrentOperation, user?.id]);

  useEffect(() => { void loadDirectory(); }, [loadDirectory]);

  useEffect(() => {
    if (!focusTarget) return;
    const input = focusTarget === "points"
      ? document.getElementById("match-points-custom")
      : focusTarget === "mercy"
        ? document.getElementById("match-mercy-points")
        : focusTarget === "title"
          ? document.getElementById("match-title")
          : slotRefs.current[focusTarget]?.querySelector<HTMLElement>("input");
    input?.focus();
    setFocusTarget(null);
  }, [focusTarget, settingsOpen]);

  useEffect(() => { if (format === "1v1") setPreview(null); }, [format]);

  const optionById = useMemo(() => new Map(options.map((option) => [option.value, option])), [options]);
  const occupiedSideAIds = useMemo(() => {
    const ids = new Set<string>();
    if (creatorParticipates && user?.id) ids.add(user.id);
    if (!creatorParticipates && slots.playerA.mode === "user" && slots.playerA.userId) ids.add(slots.playerA.userId);
    if (format === "2v2" && slots.partner.mode === "user" && slots.partner.userId) ids.add(slots.partner.userId);
    return ids;
  }, [creatorParticipates, format, slots.partner, slots.playerA, user?.id]);
  const frequentOptions = useMemo(() => creatorParticipates
    ? (createOptions?.frequentOpponentIds ?? []).flatMap((id) => {
        const option = optionById.get(id);
        return option && !occupiedSideAIds.has(id) ? [option] : [];
      })
    : [], [createOptions?.frequentOpponentIds, creatorParticipates, occupiedSideAIds, optionById]);
  const recentOptions = useMemo(() => creatorParticipates
    ? (createOptions?.recentOpponentIds ?? []).flatMap((id) => {
        const option = optionById.get(id);
        return option && !occupiedSideAIds.has(id) ? [option] : [];
      })
    : [], [createOptions?.recentOpponentIds, creatorParticipates, occupiedSideAIds, optionById]);
  const eligibleTeams = useMemo(() => format === "2v2"
    ? (createOptions?.teams ?? []).flatMap((team) => {
        const available = team.userIds.filter((candidateId) =>
          candidateId !== user?.id && !occupiedSideAIds.has(candidateId) && optionById.has(candidateId));
        return available.length >= 2 ? [{ ...team, available: available.slice(0, 2) }] : [];
      })
    : [], [createOptions?.teams, format, occupiedSideAIds, optionById, user?.id]);
  const hasQuickChoices = frequentOptions.length > 0 || recentOptions.length > 0 || eligibleTeams.length > 0;

  useEffect(() => {
    if (preview && (occupiedSideAIds.has(preview.opponent1) || (preview.opponent2 ? occupiedSideAIds.has(preview.opponent2) : false))) setPreview(null);
  }, [occupiedSideAIds, preview]);

  function updateSlot(key: PreparationSlotKey, value: PreparationSlot) {
    setSlots((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  function openGuestCatalogue(slotKey: PreparationSlotKey) {
    if (!user?.id || phaseRef.current !== "editing") return;
    const parsedPoints = Number(pointsToWin);
    const parsedMercy = Number(mercyPoints);
    const draftToken = holdPreparationForGuestCatalogue({
      actorId: user.id,
      title,
      format,
      pointsToWin: Number.isInteger(parsedPoints) && parsedPoints > 0 ? parsedPoints : 11,
      mercyEnabled,
      mercyPoints: Number.isInteger(parsedMercy) && parsedMercy > 0 ? parsedMercy : 1,
      firstServerMethod,
      creatorParticipates,
      slots,
      draftValues: {
        pointsChoice,
        pointsToWin,
        customPointsToWin,
        mercyPoints,
        mercyManuallyEdited,
      },
    }, guestDraftToken);
    const guestSelectionContext = {
      kind: "match" as const,
      returnTo: "/matches/new",
      returnLabel: "К подготовке",
      draftToken,
      slotKey,
    };
    navigate("/guests", {
      state: {
        returnTo: "/matches/new",
        returnLabel: "К подготовке",
        guestSelectionContext,
      },
    });
  }

  function guestIdsExcept(slotKey: PreparationSlotKey) {
    return Object.entries(slots).flatMap(([key, slot]) =>
      key !== slotKey && slot.guestIdentityId ? [slot.guestIdentityId] : [],
    );
  }

  function selectSuggestedOpponent(userId: string) {
    if (!optionById.has(userId) || occupiedSideAIds.has(userId)) return;
    if (!slots.opponent1.userId && !slots.opponent1.guestName.trim()) {
      updateSlot("opponent1", { mode: "user", userId, userLabel: optionById.get(userId)!.label, guestName: "" });
      setPreview(null);
      return;
    }
    setPreview({ label: "Заменить соперника", opponent1: userId });
  }

  function previewTeam(name: string, userIds: string[]) {
    if (userIds[0] && userIds[1]) setPreview({ label: name, opponent1: userIds[0], opponent2: userIds[1] });
  }

  function applyPreview() {
    if (!preview) return;
    if (occupiedSideAIds.has(preview.opponent1) || (preview.opponent2 ? occupiedSideAIds.has(preview.opponent2) : false)) {
      setPreview(null);
      setError("Игрок стороны A не может одновременно занять место стороны B");
      return;
    }
    setSlots((current) => ({
      ...current,
      opponent1: { mode: "user", userId: preview.opponent1, userLabel: optionById.get(preview.opponent1)?.label ?? "", guestName: "" },
      ...(preview.opponent2 ? { opponent2: { mode: "user" as const, userId: preview.opponent2, userLabel: optionById.get(preview.opponent2)?.label ?? "", guestName: "" } } : {}),
    }));
    setPreview(null);
    setError(null);
  }

  function setPoints(choice: PointsChoice) {
    setPointsChoice(choice);
    const value = choice === "custom" ? customPointsToWin : choice;
    setPointsToWin(value);
    const parsed = Number(value);
    if (!mercyManuallyEdited && Number.isInteger(parsed) && parsed > 0) setMercyPoints(String(defaultMercyPoints(parsed)));
    setError(null);
  }

  function changeCustomPoints(value: string) {
    setCustomPointsToWin(value);
    setPointsToWin(value);
    const parsed = Number(value);
    if (!mercyManuallyEdited && Number.isInteger(parsed) && parsed > 0) setMercyPoints(String(defaultMercyPoints(parsed)));
    setError(null);
  }

  function stepCustomPoints(delta: number) {
    const parsed = Number(pointsToWin);
    changeCustomPoints(String(Math.max(1, Number.isInteger(parsed) ? parsed + delta : 1)));
  }

  function fail(message: string, target: FocusTarget, openSettings = false): never {
    if (openSettings) setSettingsOpen(true);
    setError(message);
    setFocusTarget(target);
    throw new Error(message);
  }

  function validateSlot(key: PreparationSlotKey) {
    const slot = slots[key];
    if (slot.mode === "user" && !slot.userId) fail("Выберите всех игроков из списка", key);
    if (slot.mode === "guest" && !slot.guestIdentityId && slot.guestName.trim().split(/\s+/).filter(Boolean).length < 2) fail("Для гостя укажите имя и фамилию", key);
  }

  function validateDraft() {
    if (!user?.id) throw new Error("Сессия пользователя не загружена");
    if (!title.trim()) fail("Укажите название матча", "title", true);
    const points = Number(pointsToWin);
    const mercy = Number(mercyPoints);
    if (!Number.isInteger(points) || points < 1) fail("Очки до победы должны быть положительным целым числом", "points", true);
    if (mercyEnabled && (!Number.isInteger(mercy) || mercy < 1)) fail("Порог сухой победы должен быть положительным целым числом", "mercy", true);
    if (!creatorParticipates) validateSlot("playerA");
    if (format === "2v2") validateSlot("partner");
    validateSlot("opponent1");
    if (format === "2v2") validateSlot("opponent2");
    const registeredIds = [
      ...(creatorParticipates ? [user.id] : slots.playerA.mode === "user" ? [slots.playerA.userId] : []),
      ...(format === "2v2" && slots.partner.mode === "user" ? [slots.partner.userId] : []),
      ...(slots.opponent1.mode === "user" ? [slots.opponent1.userId] : []),
      ...(format === "2v2" && slots.opponent2.mode === "user" ? [slots.opponent2.userId] : []),
    ].filter(Boolean);
    if (new Set(registeredIds).size !== registeredIds.length) fail("Один игрок не может занимать несколько мест", "opponent1");
    const reusableGuestIds = Object.values(slots).flatMap((slot) =>
      slot.guestIdentityId ? [slot.guestIdentityId] : [],
    );
    if (new Set(reusableGuestIds).size !== reusableGuestIds.length) {
      fail("Один сохранённый гость не может занимать несколько мест", "opponent1");
    }
    return { points, mercy };
  }

  function enterServeSelection(event: React.FormEvent) {
    event.preventDefault();
    if (phaseRef.current !== "editing") return;
    setError(null);
    try {
      validateDraft();
      setSettingsOpen(false);
      setSidesSwapped(false);
      setPhase("serve");
    } catch (reason) {
      if ((reason as Error).message === "Сессия пользователя не загружена") setError((reason as Error).message);
    }
  }

  const serveEntries = useMemo(() => {
    const sideA = [
      { slot: "A1" as MatchLaunchSlot, label: creatorParticipates ? `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() : slotDisplayName(slots.playerA, optionById) },
      ...(format === "2v2" ? [{ slot: "A2" as MatchLaunchSlot, label: slotDisplayName(slots.partner, optionById) }] : []),
    ];
    const sideB = [
      { slot: "B1" as MatchLaunchSlot, label: slotDisplayName(slots.opponent1, optionById) },
      ...(format === "2v2" ? [{ slot: "B2" as MatchLaunchSlot, label: slotDisplayName(slots.opponent2, optionById) }] : []),
    ];
    if (!sidesSwapped) return { A: sideA, B: sideB };
    return {
      A: sideB.map((entry, index) => ({ ...entry, slot: (index === 0 ? "A1" : "A2") as MatchLaunchSlot })),
      B: sideA.map((entry, index) => ({ ...entry, slot: (index === 0 ? "B1" : "B2") as MatchLaunchSlot })),
    };
  }, [creatorParticipates, format, optionById, sidesSwapped, slots, user?.firstName, user?.lastName]);

  const finishCommitted = useCallback(async (matchId: string, frozen: LaunchTicket, operation: AsyncOperation) => {
    const committed = { ...frozen, matchId };
    setTicket(committed);
    try {
      await api.getMatch(matchId);
    } catch (reason) {
      if (!isCurrentOperation(operation)) return;
      setPhase("terminal");
      setError((reason as { status?: number }).status === 404
        ? "Матч создан, но больше недоступен. Новый запуск не отправлен."
        : "Матч создан, но его актуальное состояние пока не удалось загрузить.");
      return;
    }
    if (!isCurrentOperation(operation)) return;
    if (operation.authEpoch !== frozen.originAuthEpoch) {
      navigate(`/matches/${matchId}`, { replace: true });
      return;
    }
    try {
      await api.heartbeatJudge(matchId);
      if (isCurrentOperation(operation)) navigate(`/matches/${matchId}/judge`, { replace: true });
    } catch {
      if (isCurrentOperation(operation)) navigate(`/matches/${matchId}`, { replace: true });
    }
  }, [isCurrentOperation, navigate, setPhase, setTicket]);

  const reconcile = useCallback(async (frozen: LaunchTicket, operation: AsyncOperation) => {
    setPhase("pending");
    setError(null);
    try {
      const outcome = await withLaunchWatchdog(api.getMatchLaunchOutcome(frozen.payload.requestId));
      if (!isCurrentOperation(operation)) return;
      if (outcome.outcome === "committed") {
        await finishCommitted(outcome.matchId, frozen, operation);
        return;
      }
      setTicket({ ...frozen, receiptChecked: true });
      setPhase("unknown");
    } catch {
      if (!isCurrentOperation(operation)) return;
      setTicket({ ...frozen, receiptChecked: false });
      setPhase("unknown");
    }
  }, [finishCommitted, isCurrentOperation, setPhase, setTicket]);

  const issueLaunch = useCallback(async (frozen: LaunchTicket, explicitRetry: boolean) => {
    if (phaseRef.current === "pending") return;
    const actorId = authRef.current.actorId;
    if (!actorId || actorId !== frozen.actorId) return;
    const operation: AsyncOperation = {
      actorId,
      authEpoch: authRef.current.explicitAuthEpoch,
      lifecycleGeneration: lifecycleGenerationRef.current,
    };
    setTicket(frozen);
    setPhase("pending");
    setError(null);
    try {
      const response = await withLaunchWatchdog(api.launchMatch(frozen.payload));
      if (!isCurrentOperation(operation)) return;
      await finishCommitted(response.matchId, frozen, operation);
    } catch (reason) {
      if (!isCurrentOperation(operation)) return;
      if (reason === MATCH_LAUNCH_WATCHDOG_TIMEOUT) {
        setTicket({ ...frozen, receiptChecked: false });
        setPhase("unknown");
        return;
      }
      if (!explicitRetry && isKnownRejection(reason)) {
        setTicket(null);
        setPhase("editing");
        setError((reason as Error).message);
        return;
      }
      if ((reason as { status?: number }).status === 401) {
        setPhase("unknown");
        return;
      }
      await reconcile(frozen, operation);
    }
  }, [finishCommitted, isCurrentOperation, reconcile, setPhase, setTicket]);

  function launchWithServer(firstServerSlot?: MatchLaunchSlot) {
    if (phaseRef.current !== "serve" || !user?.id) return;
    const { points, mercy } = validateDraft();
    const payload = buildMatchLaunchRequest({
      requestId: crypto.randomUUID(),
      actorUserId: user.id,
      title,
      format,
      pointsToWin: points,
      mercyEnabled,
      mercyPoints: mercy,
      firstServerMethod,
      firstServerSlot,
      creatorParticipates,
      sidesSwapped,
      slots,
    });
    void issueLaunch({ actorId: user.id, originAuthEpoch: explicitAuthEpoch, payload, receiptChecked: false }, false);
  }

  function retryFrozenLaunch() {
    const frozen = ticketRef.current;
    if (phaseRef.current === "unknown" && frozen?.receiptChecked) void issueLaunch(frozen, true);
  }

  function checkReceipt() {
    const frozen = ticketRef.current;
    const actorId = authRef.current.actorId;
    if (phaseRef.current !== "unknown" || !frozen || !actorId || actorId !== frozen.actorId) return;
    void reconcile(frozen, {
      actorId,
      authEpoch: authRef.current.explicitAuthEpoch,
      lifecycleGeneration: lifecycleGenerationRef.current,
    });
  }

  const serverMethodLabel = { manual: "вручную", random: "случайно", rally: "розыгрышем" }[firstServerMethod];
  const rulesSummary = `До ${pointsToWin || "—"} · ${mercyEnabled ? `сухая ${mercyPoints || "—"}:0` : "сухая выключена"} · первая подача ${serverMethodLabel}`;
  const locked = phase === "pending" || phase === "unknown" || phase === "terminal";

  return (
    <form className="judge-screen match-create" onSubmit={enterServeSelection} aria-label="Создание матча" noValidate>
      <header className="judge-toolbar match-create__toolbar">
        <div className="judge-toolbar__meta">
          <span className="judge-status">{phase === "editing" ? "Подготовка матча" : phase === "serve" ? "Первая подача" : phase === "pending" ? "Проверяем запуск…" : phase === "unknown" ? "Исход уточняется" : "Матч создан"}</span>
          <span className="match-create__title">{title || "Без названия"}</span>
        </div>
        <div className="judge-toolbar__actions">
          {phase === "editing" ? <Button ref={settingsButtonRef} type="button" variant="secondary" className="judge-touch" onClick={() => setSettingsOpen(true)}>Настройки</Button> : null}
          <Button type="button" variant="secondary" className="judge-touch" disabled={locked} onClick={() => navigate("/start")}>Отмена</Button>
        </div>
      </header>

      {phase === "editing" ? (
        <>
          <fieldset className="match-create__payload" disabled={locked}>
            <div className="judge-board match-create__board" role="group" aria-label="Состав матча">
              <section className="judge-side match-create__side" aria-labelledby="match-create-side-a">
                <h2 id="match-create-side-a">Сторона A</h2>
                {creatorParticipates ? <div className="match-create__operator"><span className="match-create__slot-code">A1</span><strong>{user?.firstName} {user?.lastName}</strong><span>Оператор играет</span></div> : <SlotEditor label="Игрок A" slot={slots.playerA} options={options} excludeGuestIds={guestIdsExcept("playerA")} onOpenGuestCatalogue={() => openGuestCatalogue("playerA")} mutationScope={guestMutationScope} guestMutationPurposeKey={guestCreatePurposeKey({ kind: "match", draftToken: guestDraftToken, slotKey: "playerA" })} onChange={(value) => updateSlot("playerA", value)} fieldsetRef={(node) => { slotRefs.current.playerA = node; }} />}
                {format === "2v2" ? <SlotEditor label="Партнёр" slot={slots.partner} options={options} excludeGuestIds={guestIdsExcept("partner")} onOpenGuestCatalogue={() => openGuestCatalogue("partner")} mutationScope={guestMutationScope} guestMutationPurposeKey={guestCreatePurposeKey({ kind: "match", draftToken: guestDraftToken, slotKey: "partner" })} onChange={(value) => updateSlot("partner", value)} fieldsetRef={(node) => { slotRefs.current.partner = node; }} /> : null}
              </section>
              <section className="judge-side match-create__side" aria-labelledby="match-create-side-b">
                <h2 id="match-create-side-b">Сторона B</h2>
                <SlotEditor label={format === "2v2" ? "Соперник 1" : "Соперник"} slot={slots.opponent1} options={options} excludeGuestIds={guestIdsExcept("opponent1")} onOpenGuestCatalogue={() => openGuestCatalogue("opponent1")} mutationScope={guestMutationScope} guestMutationPurposeKey={guestCreatePurposeKey({ kind: "match", draftToken: guestDraftToken, slotKey: "opponent1" })} onChange={(value) => updateSlot("opponent1", value)} fieldsetRef={(node) => { slotRefs.current.opponent1 = node; }} />
                {format === "2v2" ? <SlotEditor label="Соперник 2" slot={slots.opponent2} options={options} excludeGuestIds={guestIdsExcept("opponent2")} onOpenGuestCatalogue={() => openGuestCatalogue("opponent2")} mutationScope={guestMutationScope} guestMutationPurposeKey={guestCreatePurposeKey({ kind: "match", draftToken: guestDraftToken, slotKey: "opponent2" })} onChange={(value) => updateSlot("opponent2", value)} fieldsetRef={(node) => { slotRefs.current.opponent2 = node; }} /> : null}
              </section>
            </div>
          </fieldset>
          {directoryState === "loading" ? <p role="status" className="judge-screen__hint">Загружаем список игроков…</p> : null}
          {directoryState === "error" ? <Alert type="warning" variant="tonal" title="Список игроков недоступен" description="Можно добавить гостей или повторить загрузку." actionLabel="Повторить" onAction={() => void loadDirectory()} /> : null}
          {directoryState === "ready" && hasQuickChoices ? <section className="match-create__suggestions stack" aria-label="Быстрый выбор игроков"><div><strong>Быстрый выбор</strong><p>Перед заменой видно, кого займут B1 и B2.</p></div>{frequentOptions.length > 0 ? <div><h3>Частые соперники</h3><div className="match-create__suggestion-list">{frequentOptions.map((option) => <Button key={option.value} type="button" variant="secondary" onClick={() => selectSuggestedOpponent(option.value)}>{option.label}</Button>)}</div></div> : null}{recentOptions.length > 0 ? <div><h3>Недавние соперники</h3><div className="match-create__suggestion-list">{recentOptions.map((option) => <Button key={option.value} type="button" variant="secondary" onClick={() => selectSuggestedOpponent(option.value)}>{option.label}</Button>)}</div></div> : null}{eligibleTeams.length > 0 ? <div><h3>Команды</h3><div className="match-create__suggestion-list">{eligibleTeams.map((team) => <Button key={team.id} type="button" variant="secondary" onClick={() => previewTeam(team.name, team.available)}>{team.name}</Button>)}</div></div> : null}{preview ? <section className="match-create__preview stack" aria-label="Предпросмотр быстрого выбора"><strong>{preview.label}</strong><span>B1: {optionById.get(preview.opponent1)?.label}</span>{preview.opponent2 ? <span>B2: {optionById.get(preview.opponent2)?.label}</span> : null}<div className="match-create__inline-actions"><Button type="button" onClick={applyPreview}>Применить</Button><Button type="button" variant="secondary" onClick={() => setPreview(null)}>Отмена</Button></div></section> : null}</section> : null}
          <div className="match-create__launch-bar"><span>{format === "2v2" ? "2 × 2" : "1 × 1"} · {rulesSummary}</span><Button type="submit">Начать</Button></div>
        </>
      ) : (
        <div className="judge-board judge-board--setup match-create__serve-board" role="group" aria-label="Выбор первой подачи">
          <section className="judge-side match-create__serve-side" aria-labelledby="match-create-serve-a"><h2 id="match-create-serve-a">Сторона A</h2>{serveEntries.A.map((entry) => firstServerMethod === "random" ? <div key={entry.slot} className="match-create__serve-name"><span>{entry.slot}</span><strong>{entry.label}</strong></div> : <button key={entry.slot} type="button" className="match-create__serve-option" disabled={locked} onClick={(event) => { event.preventDefault(); event.stopPropagation(); launchWithServer(entry.slot); }}><span>{entry.slot}</span><strong>{entry.label}</strong><small>{firstServerMethod === "rally" ? "Победитель розыгрыша" : "Подаёт первым"}</small></button>)}</section>
          <button type="button" className="judge-setup__swap-btn match-create__swap" aria-label="Поменять стороны стола" disabled={locked} onClick={() => setSidesSwapped((current) => !current)}>↔</button>
          <section className="judge-side match-create__serve-side" aria-labelledby="match-create-serve-b"><h2 id="match-create-serve-b">Сторона B</h2>{serveEntries.B.map((entry) => firstServerMethod === "random" ? <div key={entry.slot} className="match-create__serve-name"><span>{entry.slot}</span><strong>{entry.label}</strong></div> : <button key={entry.slot} type="button" className="match-create__serve-option" disabled={locked} onClick={(event) => { event.preventDefault(); event.stopPropagation(); launchWithServer(entry.slot); }}><span>{entry.slot}</span><strong>{entry.label}</strong><small>{firstServerMethod === "rally" ? "Победитель розыгрыша" : "Подаёт первым"}</small></button>)}</section>
        </div>
      )}
      {phase === "serve" ? <div className="judge-confirm-bar match-create__serve-actions"><Button type="button" variant="secondary" onClick={() => { setSidesSwapped(false); setPhase("editing"); }}>Назад к составу</Button>{firstServerMethod === "random" ? <Button type="button" onClick={(event: React.MouseEvent<HTMLButtonElement>) => { event.preventDefault(); event.stopPropagation(); launchWithServer(); }}>Определить подачу случайно</Button> : <span>Выберите игрока на карточке</span>}</div> : null}
      {phase === "pending" ? <p className="match-create__pending" role="status" aria-live="polite">Проверяем запуск матча. Не закрывайте экран.</p> : null}
      {phase === "unknown" ? <section className="match-create__recovery stack" aria-label="Проверка запуска"><Alert type="warning" variant="tonal" title="Результат запуска ещё не подтверждён" description="Состав и запрос зафиксированы. Новый матч автоматически не создаётся." /><div className="match-create__inline-actions"><Button type="button" onClick={checkReceipt}>Проверить ещё раз</Button>{ticket?.receiptChecked ? <Button type="button" variant="secondary" onClick={retryFrozenLaunch}>Повторить тот же запуск</Button> : null}</div></section> : null}
      {phase === "terminal" && ticket?.matchId ? <div className="match-create__recovery stack"><Button type="button" onClick={() => navigate(`/matches/${ticket.matchId}`)}>Открыть матч</Button></div> : null}
      {error ? <Alert type="error" variant="tonal" title={phase === "unknown" ? "Не удалось уточнить запуск" : phase === "terminal" ? "Матч недоступен" : "Матч не запущен"} description={error} /> : null}

      <Dialog open={settingsOpen} onClose={() => { setSettingsOpen(false); queueMicrotask(() => settingsButtonRef.current?.focus()); }} title="Настройки матча" width="md" icon={false} className="match-create__dialog" secondaryButtonLabel="Готово" onSecondaryButton={() => { setSettingsOpen(false); queueMicrotask(() => settingsButtonRef.current?.focus()); }}>
        <fieldset className="match-create__settings stack" disabled={phase !== "editing"}>
          <FilterBar label="Формат" value={format} onChange={(value) => setFormat(value as MatchFormat)} options={[{ value: "1v1", label: "1 × 1" }, { value: "2v2", label: "2 × 2" }]} />
          <label className="match-create__check"><input type="checkbox" checked={creatorParticipates} onChange={(event) => setCreatorParticipates(event.target.checked)} />Создатель играет</label>
          <TextField id="match-title" label="Название" value={title} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)} required fullWidth />
          <FilterBar label="Очков до победы" value={pointsChoice} onChange={(value) => setPoints(value as PointsChoice)} options={[{ value: "11", label: "11" }, { value: "21", label: "21" }, { value: "custom", label: "Своё" }]} />
          {pointsChoice === "custom" ? <div className="match-create__stepper"><Button type="button" variant="secondary" aria-label="Уменьшить очки до победы" onClick={() => stepCustomPoints(-1)}>−</Button><TextField id="match-points-custom" label="Своё значение" type="number" inputMode="numeric" min={1} step={1} value={customPointsToWin} onChange={(event: React.ChangeEvent<HTMLInputElement>) => changeCustomPoints(event.target.value)} required /><Button type="button" variant="secondary" aria-label="Увеличить очки до победы" onClick={() => stepCustomPoints(1)}>+</Button></div> : null}
          <div className="match-create__mercy-row"><label className="match-create__check"><input type="checkbox" checked={mercyEnabled} onChange={(event) => setMercyEnabled(event.target.checked)} />Сухая победа</label>{mercyEnabled ? <TextField id="match-mercy-points" label="Порог" type="number" inputMode="numeric" min={1} step={1} value={mercyPoints} onChange={(event: React.ChangeEvent<HTMLInputElement>) => { setMercyPoints(event.target.value); setMercyManuallyEdited(true); setError(null); }} required /> : null}</div>
          <FilterBar label="Первый подающий" value={firstServerMethod} onChange={(value) => setFirstServerMethod(value as FirstServerMethod)} options={[{ value: "manual", label: "Вручную" }, { value: "random", label: "Случайно" }, { value: "rally", label: "Розыгрыш" }]} />
          <p className="context-tip" role="note" aria-label="Подсказка о подаче">До победного порога подача меняется после двух подач. После достижения порога — после каждого очка, пока не появится отрыв в два.</p>
        </fieldset>
      </Dialog>
    </form>
  );
}
