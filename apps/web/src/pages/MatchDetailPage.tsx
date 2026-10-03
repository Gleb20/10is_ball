import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Autocomplete, Avatar, Button, Dialog, TextField } from "../ui";
import { PageLayout } from "../layout";
import {
  AsyncState,
  FilterBar,
  RefreshButton,
  StatusChip,
} from "../patterns";
import { api, type MatchParticipantInput } from "../api";
import { useAuth } from "../auth";
import {
  formatMatchDuration,
  type ActiveJudge,
} from "../judgeUi";
import {
  acceptMatchFacts,
  eventProvenance,
  firstServerLabel,
  formatFactDateTime,
  freezeMatchFacts,
  monotonicNow,
  playingClockView,
  type MatchFactsSnapshot,
} from "../matchFactsUi";
import { initialsFromName } from "../rankingUi";
import { avatarSrc } from "../avatarSrc";
import { useVisibleRefresh } from "../useVisibleRefresh";
import { useLifecycleSingleFlight } from "./useLifecycleSingleFlight";
import { createReplaySeed } from "./matchPreparation";
import "./MatchDetailPage.css";

type AdminConfirm = "force-close" | "delete" | null;
type ScoreSnapshot = { scoreA?: number; scoreB?: number };
type MatchEvent = {
  type: string;
  side?: "A" | "B";
  undonePoint?: { type?: string; side?: "A" | "B" };
  from?: ScoreSnapshot;
  to?: ScoreSnapshot;
  occurredAt?: string;
  actorUserId?: string;
  judgeSessionId?: string;
};
type MatchFormat = "1v1" | "2v2";
type FirstServerMethod = "random" | "manual" | "rally";
type EditorParticipant = {
  id?: string;
  side: "A" | "B";
  userId?: string | null;
  guestFirstName?: string | null;
  guestLastName?: string | null;
  displayName?: string;
  avatarKey?: string | null;
};
type EditorSlot = {
  mode: "user" | "guest";
  userId: string;
  userLabel?: string;
  guestName: string;
  originalId?: string;
  originalSide?: "A" | "B";
  originalIdentity?: string;
};

const emptyEditorSlot = (): EditorSlot => ({ mode: "user", userId: "", guestName: "" });

function participantIdentity(participant: Pick<EditorParticipant, "userId" | "guestFirstName" | "guestLastName">) {
  return participant.userId
    ? `user:${participant.userId}`
    : `guest:${participant.guestFirstName ?? ""}:${participant.guestLastName ?? ""}`;
}

function editorSlotFrom(participant?: EditorParticipant): EditorSlot {
  if (!participant) return emptyEditorSlot();
  return {
    mode: participant.userId ? "user" : "guest",
    userId: participant.userId ?? "",
    userLabel: participant.userId ? participant.displayName ?? "" : undefined,
    guestName: participant.userId ? "" : [participant.guestFirstName, participant.guestLastName].filter(Boolean).join(" "),
    originalId: participant.id,
    originalSide: participant.side,
    originalIdentity: participantIdentity(participant),
  };
}

function editorSlotPayload(slot: EditorSlot, side: "A" | "B"): MatchParticipantInput {
  let participant: MatchParticipantInput;
  if (slot.mode === "user") {
    if (!slot.userId) throw new Error("Выберите всех игроков из списка");
    participant = { side, userId: slot.userId };
  } else {
    const parts = slot.guestName.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) throw new Error("Для гостя укажите имя и фамилию");
    participant = { side, guestFirstName: parts[0]!, guestLastName: parts.slice(1).join(" ") };
  }
  if (
    slot.originalId &&
    slot.originalSide === side &&
    slot.originalIdentity === participantIdentity(participant)
  ) participant.id = slot.originalId;
  return participant;
}

function EditSlotField({
  label,
  slot,
  options,
  onChange,
}: {
  label: string;
  slot: EditorSlot;
  options: Array<{ value: string; label: string }>;
  onChange: (slot: EditorSlot) => void;
}) {
  const [inputText, setInputText] = useState(() => options.find((option) => option.value === slot.userId)?.label ?? slot.userLabel ?? "");
  const inputDirtyRef = useRef(false);
  const selectionIdentity = `${slot.mode}:${slot.userId}:${slot.originalId ?? ""}`;
  const selectionIdentityRef = useRef(selectionIdentity);
  const selectedLabel = options.find((option) => option.value === slot.userId)?.label;
  useEffect(() => {
    const selectionChanged = selectionIdentityRef.current !== selectionIdentity;
    selectionIdentityRef.current = selectionIdentity;
    if (!selectionChanged && (inputDirtyRef.current || !slot.userId || !selectedLabel)) return;
    inputDirtyRef.current = false;
    setInputText(selectedLabel ?? slot.userLabel ?? "");
  }, [selectedLabel, selectionIdentity, slot.userId, slot.userLabel]);
  return (
    <fieldset className="match-create__slot stack">
      <legend>{label}</legend>
      <FilterBar
        label={`${label}: тип участника`}
        value={slot.mode}
        onChange={(mode) => onChange({ ...emptyEditorSlot(), mode: mode as "user" | "guest" })}
        options={[{ value: "user", label: "Игрок" }, { value: "guest", label: "Гость" }]}
      />
      {slot.mode === "user" ? (
        <Autocomplete
          label={label}
          options={options}
          value={slot.userId}
          inputValue={inputText}
          onInputChange={(value) => { inputDirtyRef.current = true; setInputText(value); }}
          onChange={(userId) => onChange({ ...slot, userId, userLabel: options.find((option) => option.value === userId)?.label ?? "" })}
          clearable
          fullWidth
        />
      ) : (
        <TextField
          label={`${label} — гость (Имя Фамилия)`}
          value={slot.guestName}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...slot, guestName: event.target.value })}
        />
      )}
    </fieldset>
  );
}

function scoreSnapshotLabel(snapshot?: ScoreSnapshot): string | null {
  if (
    typeof snapshot?.scoreA !== "number" ||
    typeof snapshot.scoreB !== "number"
  ) return null;
  return `${snapshot.scoreA}:${snapshot.scoreB}`;
}

export function MatchDetailPage() {
  const { id } = useParams();
  const currentIdRef = useRef(id);
  currentIdRef.current = id;
  const navigate = useNavigate();
  const { user } = useAuth();
  const [match, setMatch] = useState<Record<string, unknown> | null>(null);
  const matchRef = useRef<Record<string, unknown> | null>(null);
  const [factsSnapshot, setFactsSnapshot] = useState<MatchFactsSnapshot | null>(null);
  const factsSnapshotRef = useRef<MatchFactsSnapshot | null>(null);
  const [factsNow, setFactsNow] = useState(monotonicNow);
  const [actionError, setActionError] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [startServerId, setStartServerId] = useState("");
  const [stopOpen, setStopOpen] = useState(false);
  const [stopSide, setStopSide] = useState<"A" | "B">("A");
  const [stopReason, setStopReason] = useState("injury");
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [absentSide, setAbsentSide] = useState<"A" | "B">("B");
  const [noShowReason, setNoShowReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [adminConfirm, setAdminConfirm] = useState<AdminConfirm>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editFormat, setEditFormat] = useState<MatchFormat>("1v1");
  const [editPoints, setEditPoints] = useState("11");
  const [editMercyEnabled, setEditMercyEnabled] = useState(true);
  const [editMercyPoints, setEditMercyPoints] = useState("5");
  const [editFirstServer, setEditFirstServer] = useState<FirstServerMethod>("manual");
  const [editSlots, setEditSlots] = useState<{ playerA: EditorSlot; partner: EditorSlot; opponent1: EditorSlot; opponent2: EditorSlot }>({
    playerA: emptyEditorSlot(), partner: emptyEditorSlot(), opponent1: emptyEditorSlot(), opponent2: emptyEditorSlot(),
  });
  const [directoryOptions, setDirectoryOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const action = useLifecycleSingleFlight();
  const responseSequence = useRef(0);
  const interactionContextKey = `${id ?? "none"}:${user?.id ?? "anonymous"}`;
  const interactionContext = useRef({
    key: interactionContextKey,
    actorId: user?.id ?? null,
    generation: 0,
    active: false,
  });
  if (interactionContext.current.key !== interactionContextKey) {
    interactionContext.current = {
      key: interactionContextKey,
      actorId: user?.id ?? null,
      generation: interactionContext.current.generation + 1,
      active: false,
    };
  }
  const mutationContextRef = useRef<typeof interactionContext.current | null>(null);

  const isCurrentInteraction = useCallback(
    (context: typeof interactionContext.current) =>
      context.active && interactionContext.current === context,
    [],
  );

  const applyFreshFacts = useCallback((nextMatch: Record<string, unknown>) => {
    const next = acceptMatchFacts(
      factsSnapshotRef.current,
      nextMatch.matchFacts as MatchFactsSnapshot["facts"] | undefined,
      Number(nextMatch.version ?? -1),
      String(nextMatch.status ?? "unknown"),
    );
    factsSnapshotRef.current = next;
    setFactsSnapshot(next);
    setFactsNow(next.receivedAtPerformanceMs);
  }, []);

  const freezeFacts = useCallback(() => {
    const next = freezeMatchFacts(factsSnapshotRef.current);
    factsSnapshotRef.current = next;
    setFactsSnapshot(next);
    if (next) setFactsNow(next.receivedAtPerformanceMs);
  }, []);

  const load = useCallback(async () => {
    const requestedId = currentIdRef.current;
    const operationContext = interactionContext.current;
    if (!requestedId || !operationContext.actorId || !operationContext.active || mutationContextRef.current === operationContext) return;
    const sequence = ++responseSequence.current;
    const res = await api.getMatch(requestedId);
    if (currentIdRef.current === requestedId && sequence === responseSequence.current && isCurrentInteraction(operationContext)) {
      const currentVersion = Number(matchRef.current?.version ?? -1);
      const incomingVersion = Number(res.match.version ?? -1);
      if (incomingVersion < currentVersion) return;
      matchRef.current = res.match;
      setMatch(res.match);
      applyFreshFacts(res.match);
    }
  }, [applyFreshFacts, isCurrentInteraction]);

  useEffect(() => {
    const activeContext = {
      ...interactionContext.current,
      generation: interactionContext.current.generation + 1,
      active: true,
    };
    interactionContext.current = activeContext;
    action.resume();
    responseSequence.current += 1;
    mutationContextRef.current = null;
    matchRef.current = null;
    setMatch(null);
    factsSnapshotRef.current = null;
    setFactsSnapshot(null);
    setActionError(null);
    setStartOpen(false);
    setStopOpen(false);
    setNoShowOpen(false);
    setCancelOpen(false);
    setCancelReason("");
    setVoidOpen(false);
    setVoidReason("");
    setAdminConfirm(null);
    setEditOpen(false);
    setEditError(null);
    return () => {
      action.invalidate();
      if (interactionContext.current !== activeContext) return;
      interactionContext.current = {
        ...activeContext,
        generation: activeContext.generation + 1,
        active: false,
      };
    };
  }, [action.invalidate, action.resume, interactionContextKey]);

  useEffect(() => {
    const clock = factsSnapshot?.facts.playingClock;
    if (factsSnapshot?.certainty !== "fresh" || clock?.state !== "available" || !clock.running) return;
    const tick = window.setInterval(() => setFactsNow(monotonicNow()), 1_000);
    return () => window.clearInterval(tick);
  }, [factsSnapshot]);

  const pollingEnabled =
    match === null ||
    match.status === "waiting" ||
    match.status === "in_progress" ||
    match.status === "pending_confirmation";
  const {
    error: refreshError,
    refreshing,
    refreshNow,
  } = useVisibleRefresh(load, { pollingEnabled, refreshKey: interactionContextKey });

  const participants = (match?.participants as EditorParticipant[] | undefined) ?? [];

  const activeJudge = match?.activeJudge as ActiveJudge | null | undefined;
  const judgeTakenByOther =
    activeJudge != null && activeJudge.userId !== user?.id;

  const isActiveStatus =
    match?.status === "waiting" ||
    match?.status === "in_progress" ||
    match?.status === "pending_confirmation";

  const isCreator = Boolean(user?.id) && match?.createdByUserId === user?.id;
  const creatorIsParticipant = participants.some(
    (participant) => participant.userId === match?.createdByUserId,
  );
  const isCurrentJudge =
    Boolean(user?.id) && activeJudge?.userId === user?.id;
  const canStart = match?.status === "waiting" && isCreator;
  const canStop =
    (match?.status === "in_progress" ||
      match?.status === "pending_confirmation") &&
    (isCreator || isCurrentJudge);
  const canNoShow = isActiveStatus && (isCreator || isCurrentJudge);

  const sideName = (side: "A" | "B") =>
    participants
      .filter((participant) => participant.side === side)
      .map((participant) => participant.displayName ?? `Сторона ${side}`)
      .join(" + ") || `Сторона ${side}`;
  const journal = ((match?.eventLog as MatchEvent[] | undefined) ?? []).flatMap(
    (event, index) => {
      if (event.type === "point_awarded" && event.side) {
        return [{ key: `${index}-point`, kind: "point", label: `+1 · ${sideName(event.side)}`, event }];
      }
      if (event.type === "manual_correction") {
        const from = scoreSnapshotLabel(event.from);
        const to = scoreSnapshotLabel(event.to);
        return [{
          key: `${index}-correction`,
          kind: "correction",
          label: from && to ? `Коррекция счёта: ${from} → ${to}` : "Коррекция счёта",
          event,
        }];
      }
      if (event.type === "point_undone") {
        const side = event.undonePoint?.side;
        return [{
          key: `${index}-undo`,
          kind: "undo",
          label: side ? `Отменено: +1 · ${sideName(side)}` : "Отменено последнее очко",
          event,
        }];
      }
      return [];
    },
  );

  const canCancel =
    match?.kind === "standalone" &&
    isActiveStatus &&
    (isCreator || user?.role === "admin");
  const canVoid =
    (match?.kind === "standalone" || match?.kind === "tournament") &&
    (match?.status === "finished" || match?.status === "stopped") &&
    (isCreator || user?.role === "admin");

  const isAdminStandalone =
    user?.role === "admin" && match?.kind === "standalone";
  const canForceClose = isAdminStandalone && isActiveStatus;
  const canAdminPurge =
    isAdminStandalone &&
    match?.status !== "finished" &&
    match?.status !== "stopped" &&
    match?.status !== "voided";

  const isTerminalStatus =
    match?.status === "finished" ||
    match?.status === "stopped" ||
    match?.status === "cancelled" ||
    match?.status === "voided";
  const replaySeed = match && user?.id ? createReplaySeed(match, user.id) : null;
  const hasContextActions =
    canStop || canNoShow || canCancel || canVoid || canForceClose || canAdminPurge;

  const clockView = playingClockView(factsSnapshot, factsNow);
  const durationLabel = clockView.state === "available"
    ? formatMatchDuration(clockView.elapsedMs)
    : "Недоступно";
  const initialServer = firstServerLabel(
    factsSnapshot?.facts.initialServer ?? { state: "unavailable" },
    participants,
  );

  useEffect(() => {
    if (!editOpen) return;
    let current = true;
    void api.matchCreateOptions().then((response) => {
      if (current) setDirectoryOptions(response.users.map((candidate) => ({
        value: candidate.id,
        label: `${candidate.firstName} ${candidate.lastName}`.trim(),
      })));
    }).catch(() => undefined);
    return () => { current = false; };
  }, [editOpen]);

  async function runMutation(task: (sequence: number, requestedId: string, operationContext: typeof interactionContext.current) => Promise<void>) {
    if (!id) return;
    const requestedId = id;
    const operationContext = interactionContext.current;
    if (!operationContext.active || !operationContext.actorId) return;
    await action.run(async () => {
      if (!isCurrentInteraction(operationContext)) return;
      freezeFacts();
      mutationContextRef.current = operationContext;
      const sequence = ++responseSequence.current;
      try {
        await task(sequence, requestedId, operationContext);
      } finally {
        if (mutationContextRef.current === operationContext) {
          mutationContextRef.current = null;
        }
        if (isCurrentInteraction(operationContext) && currentIdRef.current === requestedId) {
          void load();
        }
      }
    });
  }

  function applyMatch(sequence: number, requestedId: string, operationContext: typeof interactionContext.current, nextMatch: Record<string, unknown>) {
    if (isCurrentMutation(sequence, requestedId, operationContext)) {
      matchRef.current = nextMatch;
      setMatch(nextMatch);
    }
  }

  function isCurrentMutation(sequence: number, requestedId: string, operationContext: typeof interactionContext.current) {
    return sequence === responseSequence.current && requestedId === currentIdRef.current && isCurrentInteraction(operationContext);
  }

  function openEditor() {
    if (!match) return;
    const creator = participants.find((participant) => participant.userId === match.createdByUserId);
    const creatorSide = creator?.side ?? "A";
    const sideA = participants.filter((participant) => participant.side === "A");
    const sideB = participants.filter((participant) => participant.side === "B");
    const sameSide = participants.filter((participant) => participant.side === creatorSide && participant !== creator);
    const otherSide = participants.filter((participant) => participant.side !== creatorSide);
    setEditTitle(String(match.title ?? ""));
    setEditFormat(match.format === "2v2" ? "2v2" : "1v1");
    setEditPoints(String(match.pointsToWin ?? 11));
    setEditMercyEnabled(Boolean(match.mercyEnabled));
    setEditMercyPoints(String(match.mercyPoints ?? 5));
    setEditFirstServer(["random", "manual", "rally"].includes(String(match.firstServerMethod)) ? match.firstServerMethod as FirstServerMethod : "manual");
    setEditSlots({
      playerA: editorSlotFrom(creator ?? sideA[0]),
      partner: editorSlotFrom(creator ? sameSide[0] : sideA[1]),
      opponent1: editorSlotFrom(creator ? otherSide[0] : sideB[0]),
      opponent2: editorSlotFrom(creator ? otherSide[1] : sideB[1]),
    });
    setEditError(null);
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!match) return;
    const pointsToWin = Number(editPoints);
    const mercyPoints = Number(editMercyPoints);
    if (!editTitle.trim()) return setEditError("Укажите название матча");
    if (!Number.isInteger(pointsToWin) || pointsToWin < 1) return setEditError("Очки до победы должны быть положительным целым числом");
    if (editMercyEnabled && (!Number.isInteger(mercyPoints) || mercyPoints < 1)) return setEditError("Порог сухой победы должен быть положительным целым числом");
    try {
      const creator = participants.find((participant) => participant.userId === match.createdByUserId);
      const nextParticipants: MatchParticipantInput[] = creator?.id && creator.userId
        ? [
            { id: creator.id, side: creator.side, userId: creator.userId },
            ...(editFormat === "2v2" ? [editorSlotPayload(editSlots.partner, creator.side)] : []),
            editorSlotPayload(editSlots.opponent1, creator.side === "A" ? "B" : "A"),
            ...(editFormat === "2v2" ? [editorSlotPayload(editSlots.opponent2, creator.side === "A" ? "B" : "A")] : []),
          ]
        : [
            editorSlotPayload(editSlots.playerA, "A"),
            ...(editFormat === "2v2" ? [editorSlotPayload(editSlots.partner, "A")] : []),
            editorSlotPayload(editSlots.opponent1, "B"),
            ...(editFormat === "2v2" ? [editorSlotPayload(editSlots.opponent2, "B")] : []),
          ];
      const registeredIds = nextParticipants.flatMap((participant) => participant.userId ? [participant.userId] : []);
      if (new Set(registeredIds).size !== registeredIds.length) throw new Error("Один игрок не может занимать несколько мест");
      await runMutation(async (sequence, requestedId, operationContext) => {
        if (isCurrentMutation(sequence, requestedId, operationContext)) setEditError(null);
        try {
          const response = await api.updateMatch(requestedId, {
            title: editTitle.trim(),
            format: editFormat,
            pointsToWin,
            mercyEnabled: editMercyEnabled,
            mercyPoints: editMercyEnabled ? mercyPoints : null,
            firstServerMethod: editFirstServer,
            participants: nextParticipants,
          });
          applyMatch(sequence, requestedId, operationContext, response.match);
          if (isCurrentMutation(sequence, requestedId, operationContext)) setEditOpen(false);
        } catch (error) {
          if ((error as Error & { status?: number }).status !== 401 && isCurrentMutation(sequence, requestedId, operationContext)) setEditError((error as Error).message);
        }
      });
    } catch (error) {
      setEditError((error as Error).message);
    }
  }

  async function onStart() {
    if (!id || !match) return;
    const method = String(match.firstServerMethod ?? "manual");
    if (method !== "random" && !startServerId) return;
    await runMutation(async (sequence, requestedId, operationContext) => {
      if (isCurrentMutation(sequence, requestedId, operationContext)) setActionError(null);
      try {
        const result = await api.startMatch(
          requestedId,
          method === "random"
            ? {}
            : { firstServerParticipantId: startServerId },
        );
        applyMatch(sequence, requestedId, operationContext, result.match);
        if (isCurrentMutation(sequence, requestedId, operationContext)) setStartOpen(false);
      } catch (error) {
        if (isCurrentMutation(sequence, requestedId, operationContext)) setActionError((error as Error).message);
      }
    });
  }

  async function onStop() {
    await runMutation(async (sequence, requestedId, operationContext) => {
      if (isCurrentMutation(sequence, requestedId, operationContext)) setActionError(null);
      try {
        const res = await api.stopMatch(requestedId, {
          winnerSide: stopSide,
          reasonCode: stopReason,
        });
        applyMatch(sequence, requestedId, operationContext, res.match);
        if (isCurrentMutation(sequence, requestedId, operationContext)) setStopOpen(false);
      } catch (e) {
        if (isCurrentMutation(sequence, requestedId, operationContext)) setActionError((e as Error).message);
      }
    });
  }

  async function onNoShow() {
    if (!id) return;
    await runMutation(async (sequence, requestedId, operationContext) => {
      if (isCurrentMutation(sequence, requestedId, operationContext)) setActionError(null);
      try {
        const result = await api.noShowMatch(
          requestedId,
          {
            expectedVersion: Number(match?.version),
            absentSide,
            reasonText: noShowReason.trim() || undefined,
          },
          crypto.randomUUID(),
        );
        applyMatch(sequence, requestedId, operationContext, result.match);
        if (isCurrentMutation(sequence, requestedId, operationContext)) setNoShowOpen(false);
      } catch (error) {
        if (isCurrentMutation(sequence, requestedId, operationContext)) setActionError((error as Error).message);
      }
    });
  }

  async function onCancelConfirm() {
    if (!id || !match) return;
    const payload = {
      expectedVersion: Number(match.version),
      idempotencyKey: crypto.randomUUID(),
      reasonText: cancelReason.trim() || undefined,
    };
    await runMutation(async (sequence, requestedId, operationContext) => {
      if (isCurrentMutation(sequence, requestedId, operationContext)) setActionError(null);
      try {
        const res = await api.cancelMatch(
          requestedId,
          payload.expectedVersion,
          payload.idempotencyKey,
          payload.reasonText,
        );
        applyMatch(sequence, requestedId, operationContext, res.match);
        if (isCurrentMutation(sequence, requestedId, operationContext)) {
          setCancelOpen(false);
          setCancelReason("");
        }
      } catch (e) {
        if (!isCurrentMutation(sequence, requestedId, operationContext)) return;
        const error = e as Error & { status?: number };
        setActionError(
          typeof error.status === "number"
            ? error.message
            : "Не удалось проверить, был ли матч отменён. Обновите матч перед новым действием; повтор автоматически не отправлен.",
        );
      }
    });
  }

  async function onVoidConfirm() {
    if (!id) return;
    await runMutation(async (sequence, requestedId, operationContext) => {
      if (isCurrentMutation(sequence, requestedId, operationContext)) setActionError(null);
      try {
        const res = await api.voidMatch(
          requestedId,
          Number(match?.version),
          crypto.randomUUID(),
          voidReason.trim() || undefined,
        );
        applyMatch(sequence, requestedId, operationContext, res.match);
        if (isCurrentMutation(sequence, requestedId, operationContext)) {
          setVoidOpen(false);
          setVoidReason("");
        }
      } catch (e) {
        if (isCurrentMutation(sequence, requestedId, operationContext)) {
          setActionError((e as Error).message);
          setVoidOpen(false);
        }
      }
    });
  }

  async function onAdminConfirm() {
    if (!adminConfirm || !id) return;
    const operation = adminConfirm;
    await runMutation(async (sequence, requestedId, operationContext) => {
      if (isCurrentMutation(sequence, requestedId, operationContext)) setActionError(null);
      try {
        if (operation === "force-close") {
          const res = await api.adminForceCloseMatch(
            requestedId,
            Number(match?.version),
            crypto.randomUUID(),
          );
          applyMatch(sequence, requestedId, operationContext, res.match);
          if (isCurrentMutation(sequence, requestedId, operationContext)) setAdminConfirm(null);
        } else {
          await api.adminDeleteMatch(requestedId);
          if (!isCurrentMutation(sequence, requestedId, operationContext)) return;
          setAdminConfirm(null);
          navigate("/history");
        }
      } catch (e) {
        if (isCurrentMutation(sequence, requestedId, operationContext)) {
          setActionError((e as Error).message);
          setAdminConfirm(null);
        }
      }
    });
  }

  return (
    <PageLayout
      title={match ? String(match.title) : "Матч"}
      action={
        <RefreshButton refreshing={refreshing} onRefresh={refreshNow} />
      }
    >
      <AsyncState
        loading={!match && !refreshError}
        error={!match ? refreshError : null}
      >
        {match ? (
          <>
            {refreshError ? (
              <Alert
                type="warning"
                variant="tonal"
                title="Не удалось обновить"
                description={refreshError}
              />
            ) : null}
            <div className="card stack match-detail__summary">
              <div className="match-detail__status">
                <StatusChip status={String(match.status)} />
              </div>
              <div className="match-detail__scoreboard" aria-label="Счёт матча">
                <span className="visually-hidden" aria-hidden="true">
                  {`${String(match.scoreA ?? 0)} : ${String(match.scoreB ?? 0)}`}
                </span>
                {(["A", "B"] as const).map((side) => {
                  const sideParticipants = participants.filter((participant) => participant.side === side);
                  const winner = match.winnerSide === side;
                  return (
                    <section
                      key={side}
                      className={`match-detail__side${winner ? " match-detail__side--winner" : ""}`}
                      role="group"
                      aria-label={`Сторона ${side}${winner ? ", победитель" : ""}`}
                    >
                      <div className="match-detail__side-copy">
                        <span className="match-detail__side-label">Сторона {side}</span>
                        <div className="match-detail__players">
                          {sideParticipants.length > 0 ? sideParticipants.map((participant) => (
                            <div className="match-detail__player" key={String(participant.id ?? `${side}-${participant.displayName}`)}>
                              <Avatar
                                size="sm"
                                variant="tonal"
                                src={avatarSrc(participant.avatarKey)}
                                initials={initialsFromName(participant.displayName ?? side)}
                                alt={participant.displayName}
                              />
                              <span>{participant.displayName ?? `Сторона ${side}`}</span>
                            </div>
                          )) : <span>Состав не указан</span>}
                        </div>
                      </div>
                      <strong
                        className="match-detail__score"
                        aria-label={`Счёт стороны ${side}: ${String(match[`score${side}`] ?? 0)}`}
                      >
                        {String(match[`score${side}`] ?? 0)}
                      </strong>
                    </section>
                  );
                })}
                <span className="match-detail__score-divider" aria-hidden="true">:</span>
              </div>
              <dl className="match-detail__rules" role="group" aria-label="Правила матча">
                <div><dt>Формат</dt><dd>{match.format === "2v2" ? "2 × 2" : "1 × 1"}</dd></div>
                <div><dt>Победа</dt><dd>{match.pointsToWin == null ? "Не указано" : `до ${String(match.pointsToWin)} очков`}</dd></div>
                <div><dt>Сухая победа</dt><dd>{match.mercyEnabled ? `при ${String(match.mercyPoints)}:0` : "выключена"}</dd></div>
                <div>
                  <dt>Выбор первой подачи</dt>
                  <dd>{match.firstServerMethod === "random" ? "случайно" : match.firstServerMethod === "rally" ? "розыгрыш" : "вручную"}</dd>
                </div>
              </dl>
              <dl className="match-detail__facts" role="group" aria-label="Факты матча">
                <div>
                  <dt>Первым подавал</dt>
                  <dd>{initialServer}</dd>
                </div>
                <div>
                  <dt>Игровое время</dt>
                  <dd className="match-detail__clock" aria-live="off">{durationLabel}</dd>
                </div>
              </dl>
              {clockView.certainty === "checking" ? (
                <p className="muted match-detail__facts-status" role="status" aria-live="polite">
                  Проверяем игровое время…
                </p>
              ) : null}
              {activeJudge ? (
                <p className="muted">Судит: {activeJudge.displayName}</p>
              ) : match.judgeReservation ? (
                <p className="muted">
                  Судейство передаётся: {String((match.judgeReservation as { displayName?: string }).displayName ?? "назначенному пользователю")}
                </p>
              ) : (
                <p className="muted">Судья не назначен</p>
              )}
              {match.finishReason === "no_show" ? (
                <Alert
                  type="warning"
                  variant="tonal"
                  title="Матч завершён из-за неявки"
                  description={`Не явилась сторона ${match.winnerSide === "A" ? "B" : "A"}. Победитель: ${sideName(String(match.winnerSide) as "A" | "B")}. Причина: ${String(match.stopReasonText ?? "Неявка")}. Счёт сохранён без вымышленных очков.`}
                />
              ) : null}
            </div>
            <div className="card stack">
              <h2>Журнал изменений счёта</h2>
              {journal.length > 0 ? (
                <ol className="match-detail__journal" aria-label="Журнал изменений счёта">
                  {journal.map((entry) => {
                    const provenance = eventProvenance(entry.event, factsSnapshot);
                    return (
                      <li key={entry.key} data-kind={entry.kind}>
                        <span>{entry.label}</span>
                        <span className="match-detail__journal-meta">
                          {entry.event.occurredAt ? (
                            <time dateTime={entry.event.occurredAt}>{formatFactDateTime(entry.event.occurredAt)}</time>
                          ) : "Время недоступно"}
                          <span aria-hidden="true"> · </span>
                          {provenance.state === "known"
                            ? provenance.displayName
                            : "Судейская сессия недоступна"}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="muted">Изменений счёта пока нет.</p>
              )}
            </div>
            <section className="card stack" aria-labelledby="match-judge-history-heading">
              <h2 id="match-judge-history-heading">История судейства</h2>
              {factsSnapshot?.facts.judgeHistory.state === "unavailable" || !factsSnapshot ? (
                <p className="muted">История судейства недоступна.</p>
              ) : (
                <>
                  {factsSnapshot.facts.judgeHistory.state === "partial" ? (
                    <Alert
                      type="warning"
                      variant="tonal"
                      title="История может быть неполной"
                      description="Показаны только подтверждённые судейские сессии."
                    />
                  ) : null}
                  {factsSnapshot.facts.judgeHistory.sessions.length > 0 ? (
                    <ol className="match-detail__judge-history">
                      {factsSnapshot.facts.judgeHistory.sessions.map((session) => (
                        <li key={session.id}>
                          <strong>{session.displayName}</strong>
                          <span className="muted">
                            <time dateTime={session.startedAt}>{formatFactDateTime(session.startedAt)}</time>
                            <span aria-hidden="true"> — </span>
                            {session.endedAt ? (
                              <time dateTime={session.endedAt}>{formatFactDateTime(session.endedAt)}</time>
                            ) : "сейчас"}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="muted">Подтверждённых судейских сессий пока нет.</p>
                  )}
                </>
              )}
            </section>
            <div className="match-detail__actions">
              <div className="match-detail__primary" role="group" aria-label="Основное действие">
                {canStart ? (
                  <Button
                    disabled={action.pending}
                    onClick={() => {
                      setStartServerId("");
                      setStartOpen(true);
                    }}
                  >
                    Старт
                  </Button>
                ) : isActiveStatus ? (
                  judgeTakenByOther ? (
                    <Button onClick={() => navigate(`/matches/${id}/judge?mode=readonly`)}>
                      Открыть счёт
                    </Button>
                  ) : (
                    <Button onClick={() => navigate(`/matches/${id}/judge`)}>
                      Судить
                    </Button>
                  )
                ) : isTerminalStatus ? (
                  replaySeed ? (
                    <Button onClick={() => navigate("/matches/new", { state: { matchReplaySeed: replaySeed } })}>
                      Сыграть снова
                    </Button>
                  ) : (
                    <Button onClick={() => navigate("/matches/new")}>Новый матч</Button>
                  )
                ) : null}
              </div>
              <div className="match-detail__quick-actions">
              {match.status === "waiting" && isCreator ? (
                <Button variant="secondary" disabled={action.pending} onClick={openEditor}>Изменить матч</Button>
              ) : null}
              {isActiveStatus ? (
                <>
                  {(canStart || judgeTakenByOther) ? (
                    <Button
                      variant="secondary"
                      disabled={judgeTakenByOther}
                      onClick={() => navigate(`/matches/${id}/judge`)}
                    >
                      Судить
                    </Button>
                  ) : null}
                  {(!judgeTakenByOther || canStart) ? (
                    <Button
                      variant="secondary"
                      onClick={() => navigate(`/matches/${id}/judge?mode=readonly`)}
                    >
                      Открыть счёт
                    </Button>
                  ) : null}
                  {judgeTakenByOther ? (
                    <p className="muted">
                      Матч уже судит {activeJudge?.displayName}. Можно открыть
                      счёт в режиме просмотра.
                    </p>
                  ) : null}
                </>
              ) : null}
              {match.tournamentId ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    navigate(`/tournaments/${String(match.tournamentId)}`)
                  }
                >
                  К турниру
                </Button>
              ) : null}
              </div>
              {hasContextActions ? (
                <details className="match-detail__context-actions">
                  <summary>Другие действия</summary>
                  <div className="match-detail__context-buttons" role="group" aria-label="Другие действия с матчем">
                    {canStop ? (
                      <Button variant="secondary" disabled={action.pending} onClick={() => setStopOpen((value) => !value)}>
                        {stopOpen ? "Скрыть остановку" : "Остановить матч"}
                      </Button>
                    ) : null}
                    {canNoShow ? (
                      <Button variant="secondary" disabled={action.pending} onClick={() => setNoShowOpen(true)}>
                        Зафиксировать неявку
                      </Button>
                    ) : null}
                    {canCancel ? (
                      <Button
                        variant="secondary"
                        disabled={action.pending}
                        onClick={() => {
                          setActionError(null);
                          setCancelReason("");
                          setCancelOpen(true);
                        }}
                      >
                        Отменить матч
                      </Button>
                    ) : null}
                    {canVoid ? (
                      <Button variant="secondary" disabled={action.pending} onClick={() => setVoidOpen(true)}>
                        Аннулировать результат
                      </Button>
                    ) : null}
                    {canForceClose ? (
                      <Button variant="secondary" disabled={action.pending} onClick={() => setAdminConfirm("force-close")}>
                        Принудительно закрыть
                      </Button>
                    ) : null}
                    {canAdminPurge ? (
                      <Button variant="secondary" disabled={action.pending} onClick={() => setAdminConfirm("delete")}>
                        Удалить из истории
                      </Button>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </div>
            <Dialog
              open={editOpen}
              onClose={() => { if (!action.pending) setEditOpen(false); }}
              title="Изменить матч"
              width="md"
              secondaryButtonLabel="Отмена"
              onSecondaryButton={() => { if (!action.pending) setEditOpen(false); }}
              mainButtonLabel={action.pending ? "Сохраняем…" : "Сохранить изменения"}
              onMainButton={() => void saveEdit()}
            >
              <div className="stack">
                <TextField label="Название" value={editTitle} maxLength={200} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEditTitle(event.target.value)} />
                <FilterBar
                  label="Формат"
                  value={editFormat}
                  onChange={(value) => setEditFormat(value as MatchFormat)}
                  options={[{ value: "1v1", label: "1 × 1" }, { value: "2v2", label: "2 × 2" }]}
                />
                <TextField label="Очков до победы" type="number" min={1} step={1} value={editPoints} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEditPoints(event.target.value)} />
                <label className="match-create__check">
                  <input type="checkbox" checked={editMercyEnabled} onChange={(event) => setEditMercyEnabled(event.target.checked)} />
                  Сухая победа
                </label>
                {editMercyEnabled ? <TextField label="Порог сухой победы" type="number" min={1} step={1} value={editMercyPoints} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEditMercyPoints(event.target.value)} /> : null}
                <FilterBar
                  label="Первый подающий"
                  value={editFirstServer}
                  onChange={(value) => setEditFirstServer(value as FirstServerMethod)}
                  options={[{ value: "manual", label: "Вручную" }, { value: "random", label: "Случайно" }, { value: "rally", label: "Розыгрыш" }]}
                />
                <p className="muted">
                  {creatorIsParticipant
                    ? "Создатель матча остаётся в составе."
                    : "Создатель управляет матчем, но не занимает игровое место."}
                </p>
                {!creatorIsParticipant ? <EditSlotField label="Игрок A" slot={editSlots.playerA} options={directoryOptions} onChange={(slot) => setEditSlots((current) => ({ ...current, playerA: slot }))} /> : null}
                {editFormat === "2v2" ? <EditSlotField label="Партнёр" slot={editSlots.partner} options={directoryOptions} onChange={(slot) => setEditSlots((current) => ({ ...current, partner: slot }))} /> : null}
                <EditSlotField label={editFormat === "2v2" ? "Соперник 1" : "Соперник"} slot={editSlots.opponent1} options={directoryOptions} onChange={(slot) => setEditSlots((current) => ({ ...current, opponent1: slot }))} />
                {editFormat === "2v2" ? <EditSlotField label="Соперник 2" slot={editSlots.opponent2} options={directoryOptions} onChange={(slot) => setEditSlots((current) => ({ ...current, opponent2: slot }))} /> : null}
                {editError ? <Alert type="error" variant="tonal" title="Матч не сохранён" description={editError} /> : null}
              </div>
            </Dialog>
            <Dialog
              open={startOpen}
              onClose={() => (!action.pending ? setStartOpen(false) : undefined)}
              title="Начать матч?"
              width="sm"
              secondaryButtonLabel="Отмена"
              onSecondaryButton={() => {
                if (!action.pending) setStartOpen(false);
              }}
              mainButtonLabel={action.pending ? "Запускаем…" : "Начать матч"}
              onMainButton={() => void onStart()}
            >
              {match.firstServerMethod === "random" ? (
                <p>Первый подающий будет выбран случайно.</p>
              ) : (
                <fieldset className="judge-server-picker">
                  <legend>
                    {match.firstServerMethod === "rally"
                      ? "Победитель розыгрыша за подачу"
                      : "Первый подающий"}
                  </legend>
                  {participants.map((participant) => (
                    <label key={String(participant.id)}>
                      <input
                        type="radio"
                        name="match-start-server"
                        checked={
                          startServerId ===
                          String(participant.id ?? "")
                        }
                        onChange={() =>
                          setStartServerId(
                            String(participant.id ?? ""),
                          )
                        }
                      />
                      {participant.displayName ?? `Сторона ${participant.side}`}
                    </label>
                  ))}
                </fieldset>
              )}
            </Dialog>
            {actionError && !cancelOpen ? (
              <Alert
                type="error"
                variant="tonal"
                title="Не удалось выполнить действие"
                description={actionError}
              />
            ) : null}
            {stopOpen ? (
              <div className="card stack">
                <p className="muted">
                  Зафиксируйте победителя и причину досрочной остановки.
                </p>
                <FilterBar
                  label="Победитель"
                  value={stopSide}
                  onChange={(v) => setStopSide(v as "A" | "B")}
                  options={[
                    {
                      value: "A",
                      label:
                        participants.find((p) => p.side === "A")?.displayName ??
                        "Сторона A",
                    },
                    {
                      value: "B",
                      label:
                        participants.find((p) => p.side === "B")?.displayName ??
                        "Сторона B",
                    },
                  ]}
                />
                <FilterBar
                  label="Причина"
                  value={stopReason}
                  onChange={setStopReason}
                  options={[
                    { value: "injury", label: "Травма" },
                    { value: "time", label: "Нехватка времени" },
                    { value: "other", label: "Другое" },
                  ]}
                />
                <Button disabled={action.pending} onClick={() => void onStop()}>
                  {action.pending ? "Сохранение…" : "Подтвердить остановку"}
                </Button>
              </div>
            ) : null}
            <Dialog
              open={noShowOpen}
              onClose={() => (!action.pending ? setNoShowOpen(false) : undefined)}
              title="Зафиксировать неявку?"
              width="sm"
              secondaryButtonLabel="Отмена"
              onSecondaryButton={() => setNoShowOpen(false)}
              mainButtonLabel={action.pending ? "…" : "Завершить по неявке"}
              onMainButton={() => void onNoShow()}
            >
              <div className="stack">
                <p>Победителем будет признана противоположная сторона. Текущий счёт сохранится без добавления очков.</p>
                <FilterBar
                  label="Не явилась"
                  value={absentSide}
                  onChange={(value) => setAbsentSide(value as "A" | "B")}
                  options={[
                    { value: "A", label: sideName("A") },
                    { value: "B", label: sideName("B") },
                  ]}
                />
                <TextField
                  label="Комментарий (необязательно)"
                  value={noShowReason}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNoShowReason(event.target.value)}
                />
              </div>
            </Dialog>
            <Dialog
              open={cancelOpen}
              onClose={() => {
                if (!action.pending) {
                  setCancelOpen(false);
                  setCancelReason("");
                }
              }}
              title="Отменить матч?"
              width="sm"
              secondaryButtonLabel="Не отменять"
              onSecondaryButton={() => {
                if (!action.pending) {
                  setCancelOpen(false);
                  setCancelReason("");
                }
              }}
              mainButtonLabel={action.pending ? "Отменяем…" : "Отменить матч"}
              onMainButton={() => void onCancelConfirm()}
            >
              <div className="stack">
                <p><strong>{String(match.title)}</strong></p>
                <p>
                  Матч будет отменён без победителя и влияния на статистику.
                  Ведение счёта завершится, игроки освободятся для других матчей.
                </p>
                <TextField
                  label="Причина (необязательно)"
                  value={cancelReason}
                  maxLength={500}
                  disabled={action.pending}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCancelReason(event.target.value)}
                />
                {actionError ? (
                  <Alert type="error" variant="tonal" title="Матч не отменён" description={actionError} />
                ) : null}
              </div>
            </Dialog>
            <Dialog
              open={voidOpen}
              onClose={() => (!action.pending ? setVoidOpen(false) : undefined)}
              title="Аннулировать результат?"
              width="sm"
              secondaryButtonLabel="Отмена"
              onSecondaryButton={() =>
                !action.pending ? setVoidOpen(false) : undefined
              }
              mainButtonLabel={
                action.pending ? "…" : "Подтвердить аннулирование"
              }
              onMainButton={() => void onVoidConfirm()}
            >
              <div className="stack">
                <p>
                  Исходный результат матча «{String(match.title)}» сохранится в
                  журнале аудита. Уже учтённые победы, поражения и рейтинг будут
                  компенсированы.
                </p>
                {match.kind === "tournament" ? (
                  <p>
                    Остальная турнирная сетка сохранится без изменений: уже
                    продвинутые участники, следующие матчи и уведомления не
                    будут пересчитаны.
                  </p>
                ) : null}
                <TextField
                  label="Причина (необязательно)"
                  value={voidReason}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setVoidReason(event.target.value)
                  }
                />
              </div>
            </Dialog>
            <Dialog
              open={adminConfirm !== null}
              onClose={() =>
                !action.pending ? setAdminConfirm(null) : undefined
              }
              title={
                adminConfirm === "force-close"
                  ? "Принудительно закрыть матч?"
                  : "Удалить матч из истории?"
              }
              width="sm"
              secondaryButtonLabel="Отмена"
              onSecondaryButton={() =>
                !action.pending ? setAdminConfirm(null) : undefined
              }
              mainButtonLabel={
                action.pending
                  ? "…"
                  : adminConfirm === "force-close"
                    ? "Закрыть"
                    : "Удалить"
              }
              onMainButton={() => void onAdminConfirm()}
            >
              <p>
                {adminConfirm === "force-close"
                  ? `Матч «${String(match.title)}» будет аннулирован (статус «Отменён») без победителя и без влияния на рейтинг. Игроки снова смогут участвовать в других матчах.`
                  : `Незавершённый матч «${String(match.title)}» будет удалён безвозвратно. Завершённые и остановленные результаты удалить нельзя.`}
              </p>
            </Dialog>
          </>
        ) : null}
      </AsyncState>
    </PageLayout>
  );
}
