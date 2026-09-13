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
import { api, type MatchInvitation, type MatchParticipantInput } from "../api";
import { useAuth } from "../auth";
import {
  elapsedMs,
  formatMatchDuration,
  type ActiveJudge,
} from "../judgeUi";
import { initialsFromName } from "../rankingUi";
import { avatarSrc } from "../avatarSrc";
import { useVisibleRefresh } from "../useVisibleRefresh";
import { useSingleFlight } from "../useSingleFlight";

type AdminConfirm = "force-close" | "delete" | null;
type MatchEvent = { type: string; side?: "A" | "B" };
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
          key={`${label}-${slot.userId}`}
          label={label}
          options={options}
          value={slot.userId}
          defaultInputValue={options.find((option) => option.value === slot.userId)?.label ?? ""}
          onChange={(userId) => onChange({ ...slot, userId })}
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

function InvitationStatus({ status }: { status: MatchInvitation["status"] }) {
  const labels: Record<MatchInvitation["status"], string> = {
    pending: "Ожидает ответа",
    accepted: "Принято",
    declined: "Отклонено",
    expired: "Истекло",
    cancelled: "Отменено",
  };
  return <span>{labels[status]}</span>;
}

function cleanPointLog(events: MatchEvent[]): Array<"A" | "B"> {
  const points: Array<"A" | "B"> = [];
  for (const event of events) {
    if (event.type === "manual_correction") points.length = 0;
    else if (event.type === "point_awarded" && event.side) points.push(event.side);
  }
  return points;
}

export function MatchDetailPage() {
  const { id } = useParams();
  const currentIdRef = useRef(id);
  currentIdRef.current = id;
  const navigate = useNavigate();
  const { user } = useAuth();
  const [match, setMatch] = useState<Record<string, unknown> | null>(null);
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
  const [editSlots, setEditSlots] = useState<{ partner: EditorSlot; opponent1: EditorSlot; opponent2: EditorSlot }>({
    partner: emptyEditorSlot(), opponent1: emptyEditorSlot(), opponent2: emptyEditorSlot(),
  });
  const [directoryOptions, setDirectoryOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const action = useSingleFlight();
  const [now, setNow] = useState(() => new Date());
  const responseSequence = useRef(0);
  const mutationInFlight = useRef(false);

  const load = useCallback(async () => {
    const requestedId = id;
    if (!requestedId || mutationInFlight.current) return;
    const sequence = ++responseSequence.current;
    const res = await api.getMatch(requestedId);
    if (currentIdRef.current === requestedId && sequence === responseSequence.current) setMatch(res.match);
  }, [id]);

  useEffect(() => {
    responseSequence.current += 1;
    setMatch(null);
    setEditOpen(false);
    setEditError(null);
  }, [id]);

  const pollingEnabled =
    match === null ||
    match.status === "waiting" ||
    match.status === "in_progress" ||
    match.status === "pending_confirmation";
  const {
    error: refreshError,
    refreshing,
    refreshNow,
  } = useVisibleRefresh(load, { pollingEnabled, refreshKey: id });

  useEffect(() => {
    if (match?.status !== "in_progress") return;
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(tick);
  }, [match?.status]);

  const participants = (match?.participants as EditorParticipant[] | undefined) ?? [];
  const invitations = (match?.invitations as MatchInvitation[] | undefined) ?? [];

  const activeJudge = match?.activeJudge as ActiveJudge | null | undefined;
  const judgeTakenByOther =
    activeJudge != null && activeJudge.userId !== user?.id;

  const isActiveStatus =
    match?.status === "waiting" ||
    match?.status === "in_progress" ||
    match?.status === "pending_confirmation";

  const isCreator = Boolean(user?.id) && match?.createdByUserId === user?.id;
  const isCurrentJudge =
    Boolean(user?.id) && activeJudge?.userId === user?.id;
  const canStart = match?.status === "waiting" && isCreator;
  const consentBlockedParticipants = participants.filter((participant) => {
    if (!participant.id || !participant.userId || participant.userId === match?.createdByUserId) return false;
    const linked = invitations.filter(
      (invitation) => invitation.kind === "player" && invitation.matchParticipantId === participant.id,
    );
    return linked.length > 0 && !linked.some((invitation) => invitation.status === "accepted");
  });
  const consentBlocksStart = consentBlockedParticipants.length > 0;
  const canStop =
    (match?.status === "in_progress" ||
      match?.status === "pending_confirmation") &&
    (isCreator || isCurrentJudge);
  const canNoShow = isActiveStatus && (isCreator || isCurrentJudge);
  const currentUserParticipates = participants.some((p) => p.userId === user?.id);
  const canCreateRevenge =
    match?.kind === "standalone" &&
    ["finished", "stopped"].includes(String(match?.status)) &&
    currentUserParticipates;

  const sideName = (side: "A" | "B") =>
    participants
      .filter((participant) => participant.side === side)
      .map((participant) => participant.displayName ?? `Сторона ${side}`)
      .join(" + ") || `Сторона ${side}`;
  const pointLog = cleanPointLog((match?.eventLog as MatchEvent[] | undefined) ?? []);

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

  const durationLabel =
    match?.startedAt != null
      ? formatMatchDuration(
          elapsedMs(
            String(match.startedAt),
            now,
            match.finishedAt ? String(match.finishedAt) : null,
            String(match.status),
          ),
        )
      : null;

  useEffect(() => {
    if (!editOpen && invitations.length === 0) return;
    let current = true;
    void api.matchCreateOptions().then((response) => {
      if (current) setDirectoryOptions(response.users.map((candidate) => ({
        value: candidate.id,
        label: `${candidate.firstName} ${candidate.lastName}`.trim(),
      })));
    }).catch(() => undefined);
    return () => { current = false; };
  }, [editOpen, invitations.length]);

  async function runMutation(task: (sequence: number, requestedId: string) => Promise<void>) {
    if (!id) return;
    const requestedId = id;
    await action.run(async () => {
      mutationInFlight.current = true;
      const sequence = ++responseSequence.current;
      try {
        await task(sequence, requestedId);
      } finally {
        mutationInFlight.current = false;
      }
    });
  }

  function applyMatch(sequence: number, requestedId: string, nextMatch: Record<string, unknown>) {
    if (sequence === responseSequence.current && requestedId === currentIdRef.current) setMatch(nextMatch);
  }

  function openEditor() {
    if (!match) return;
    const creator = participants.find((participant) => participant.userId === match.createdByUserId);
    const creatorSide = creator?.side ?? "A";
    const sameSide = participants.filter((participant) => participant.side === creatorSide && participant !== creator);
    const otherSide = participants.filter((participant) => participant.side !== creatorSide);
    setEditTitle(String(match.title ?? ""));
    setEditFormat(match.format === "2v2" ? "2v2" : "1v1");
    setEditPoints(String(match.pointsToWin ?? 11));
    setEditMercyEnabled(Boolean(match.mercyEnabled));
    setEditMercyPoints(String(match.mercyPoints ?? 5));
    setEditFirstServer(["random", "manual", "rally"].includes(String(match.firstServerMethod)) ? match.firstServerMethod as FirstServerMethod : "manual");
    setEditSlots({
      partner: editorSlotFrom(sameSide[0]),
      opponent1: editorSlotFrom(otherSide[0]),
      opponent2: editorSlotFrom(otherSide[1]),
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
      if (!creator?.id || !creator.userId) throw new Error("Создатель должен оставаться участником матча");
      const ownSide = creator.side;
      const otherSide = ownSide === "A" ? "B" : "A";
      const nextParticipants: MatchParticipantInput[] = [
        { id: creator.id, side: ownSide, userId: creator.userId },
        ...(editFormat === "2v2" ? [editorSlotPayload(editSlots.partner, ownSide)] : []),
        editorSlotPayload(editSlots.opponent1, otherSide),
        ...(editFormat === "2v2" ? [editorSlotPayload(editSlots.opponent2, otherSide)] : []),
      ];
      const registeredIds = nextParticipants.flatMap((participant) => participant.userId ? [participant.userId] : []);
      if (new Set(registeredIds).size !== registeredIds.length) throw new Error("Один игрок не может занимать несколько мест");
      await runMutation(async (sequence, requestedId) => {
        setEditError(null);
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
          applyMatch(sequence, requestedId, response.match);
          if (sequence === responseSequence.current && requestedId === currentIdRef.current) setEditOpen(false);
        } catch (error) {
          if ((error as Error & { status?: number }).status !== 401) setEditError((error as Error).message);
        }
      });
    } catch (error) {
      setEditError((error as Error).message);
    }
  }

  async function respondToInvitation(invitation: MatchInvitation, accept: boolean) {
    await runMutation(async (sequence, requestedId) => {
      setActionError(null);
      try {
        await api.respondMatchInvitation(invitation.id, accept);
        const response = await api.getMatch(requestedId);
        applyMatch(sequence, requestedId, response.match);
      } catch (error) {
        if ((error as Error & { status?: number }).status !== 401) setActionError((error as Error).message);
      }
    });
  }

  async function reinvite(invitation: MatchInvitation) {
    await runMutation(async (sequence, requestedId) => {
      setActionError(null);
      try {
        await api.createMatchInvitation(requestedId, { userId: invitation.invitedUserId, kind: invitation.kind });
        const response = await api.getMatch(requestedId);
        applyMatch(sequence, requestedId, response.match);
      } catch (error) {
        if ((error as Error & { status?: number }).status !== 401) setActionError((error as Error).message);
      }
    });
  }

  function invitationName(invitation: MatchInvitation) {
    const participant = participants.find((candidate) => candidate.id === invitation.matchParticipantId);
    if (participant?.displayName) return participant.displayName;
    const directoryName = directoryOptions.find((option) => option.value === invitation.invitedUserId)?.label;
    if (directoryName) return directoryName;
    if (invitation.invitedUserId === user?.id) return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
    return invitation.kind === "judge" ? "Приглашённый судья" : "Приглашённый игрок";
  }

  function canReinvite(invitation: MatchInvitation) {
    if (!isCreator || (invitation.status !== "expired" && invitation.status !== "declined")) return false;
    const sameTarget = invitations.filter((candidate) =>
      candidate.kind === invitation.kind &&
      candidate.invitedUserId === invitation.invitedUserId &&
      candidate.matchParticipantId === invitation.matchParticipantId,
    );
    if (sameTarget.some((candidate) => candidate.status === "accepted" || candidate.status === "pending")) return false;
    const latest = sameTarget.reduce((current, candidate) =>
      candidate.createdAt > current.createdAt ? candidate : current,
    invitation);
    return latest.id === invitation.id;
  }

  async function onStart() {
    if (!id || !match) return;
    const method = String(match.firstServerMethod ?? "manual");
    if (method !== "random" && !startServerId) return;
    await runMutation(async (sequence, requestedId) => {
      setActionError(null);
      try {
        const result = await api.startMatch(
          id,
          method === "random"
            ? {}
            : { firstServerParticipantId: startServerId },
        );
        applyMatch(sequence, requestedId, result.match);
        setStartOpen(false);
      } catch (error) {
        setActionError((error as Error).message);
      }
    });
  }

  async function onStop() {
    await runMutation(async (sequence, requestedId) => {
      setActionError(null);
      try {
        const res = await api.stopMatch(id!, {
          winnerSide: stopSide,
          reasonCode: stopReason,
        });
        applyMatch(sequence, requestedId, res.match);
        setStopOpen(false);
      } catch (e) {
        setActionError((e as Error).message);
      }
    });
  }

  async function onNoShow() {
    if (!id) return;
    await runMutation(async (sequence, requestedId) => {
      setActionError(null);
      try {
        const result = await api.noShowMatch(
          id,
          {
            expectedVersion: Number(match?.version),
            absentSide,
            reasonText: noShowReason.trim() || undefined,
          },
          crypto.randomUUID(),
        );
        applyMatch(sequence, requestedId, result.match);
        setNoShowOpen(false);
      } catch (error) {
        setActionError((error as Error).message);
      }
    });
  }

  async function onCancelConfirm() {
    if (!id) return;
    await runMutation(async (sequence, requestedId) => {
      setActionError(null);
      try {
        const res = await api.cancelMatch(
          id,
          Number(match?.version),
          crypto.randomUUID(),
        );
        applyMatch(sequence, requestedId, res.match);
        setCancelOpen(false);
      } catch (e) {
        setActionError((e as Error).message);
        setCancelOpen(false);
      }
    });
  }

  async function onVoidConfirm() {
    if (!id) return;
    await runMutation(async (sequence, requestedId) => {
      setActionError(null);
      try {
        const res = await api.voidMatch(
          id,
          Number(match?.version),
          crypto.randomUUID(),
          voidReason.trim() || undefined,
        );
        applyMatch(sequence, requestedId, res.match);
        setVoidOpen(false);
        setVoidReason("");
      } catch (e) {
        setActionError((e as Error).message);
        setVoidOpen(false);
      }
    });
  }

  async function onAdminConfirm() {
    if (!adminConfirm || !id) return;
    await runMutation(async (sequence, requestedId) => {
      setActionError(null);
      try {
        if (adminConfirm === "force-close") {
          const res = await api.adminForceCloseMatch(
            id,
            Number(match?.version),
            crypto.randomUUID(),
          );
          applyMatch(sequence, requestedId, res.match);
          setAdminConfirm(null);
        } else {
          await api.adminDeleteMatch(id);
          setAdminConfirm(null);
          navigate("/history");
        }
      } catch (e) {
        setActionError((e as Error).message);
        setAdminConfirm(null);
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
            <div className="card stack">
              <div className="row">
                <StatusChip status={String(match.status)} />
              </div>
              <p className="score-display">
                {String(match.scoreA)} : {String(match.scoreB)}
              </p>
              <div className="match-rules" aria-label="Правила матча">
                <strong>{match.format === "2v2" ? "2 × 2" : "1 × 1"}</strong>
                <span>до {String(match.pointsToWin)} очков</span>
                <span>
                  {match.mercyEnabled
                    ? `сухая победа при ${String(match.mercyPoints)}:0`
                    : "без правила сухой победы"}
                </span>
                <span>
                  первая подача: {match.firstServerMethod === "random" ? "случайно" : match.firstServerMethod === "rally" ? "розыгрыш" : "вручную"}
                </span>
              </div>
              {durationLabel ? (
                <p className="muted">Длительность: {durationLabel}</p>
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
              {participants.length > 0 ? (
                <div className="stack">
                  {participants.map((p) => (
                    <div
                      key={`${p.side}-${p.displayName}`}
                      className="row"
                    >
                      <Avatar
                        size="sm"
                        variant="tonal"
                        src={avatarSrc(p.avatarKey)}
                        initials={initialsFromName(p.displayName ?? p.side)}
                        alt={p.displayName}
                      />
                      <span>
                        {p.side}: {p.displayName ?? "—"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {match.finishReason === "no_show" ? (
                <Alert
                  type="warning"
                  variant="tonal"
                  title="Матч завершён из-за неявки"
                  description={`Не явилась сторона ${match.winnerSide === "A" ? "B" : "A"}. Победитель: ${sideName(String(match.winnerSide) as "A" | "B")}. Причина: ${String(match.stopReasonText ?? "Неявка")}. Счёт сохранён без вымышленных очков.`}
                />
              ) : null}
            </div>
            {match.status === "waiting" && invitations.length > 0 ? (
              <section className="card stack" aria-label="Приглашения матча">
                <h2>Согласования</h2>
                {invitations.map((invitation) => (
                  <div className="list-row list-row--static" key={invitation.id}>
                    <div className="list-row__body">
                      <strong>{invitationName(invitation)}</strong>
                      <span className="muted">
                        {invitation.kind === "judge" ? "Судья" : `Игрок · сторона ${invitation.participantSide ?? "—"}`}
                      </span>
                      <InvitationStatus status={invitation.status} />
                    </div>
                    {invitation.invitedUserId === user?.id && invitation.status === "pending" ? (
                      <div className="row">
                        <Button size="sm" disabled={action.pending} onClick={() => void respondToInvitation(invitation, true)}>Принять</Button>
                        <Button size="sm" variant="secondary" disabled={action.pending} onClick={() => void respondToInvitation(invitation, false)}>Отклонить</Button>
                      </div>
                    ) : null}
                    {canReinvite(invitation) ? (
                      <Button size="sm" variant="secondary" disabled={action.pending} onClick={() => void reinvite(invitation)}>Пригласить снова</Button>
                    ) : null}
                  </div>
                ))}
              </section>
            ) : null}
            <div className="card stack" aria-label="Журнал очков">
              <h2>Журнал очков</h2>
              {pointLog.length > 0 ? (
                <ol className="match-point-log">
                  {pointLog.map((side, index) => (
                    <li key={`${index}-${side}`}>{sideName(side)} — очко</li>
                  ))}
                </ol>
              ) : (
                <p className="muted">Подтверждённых очков после последней коррекции нет.</p>
              )}
              {(match.eventLog as MatchEvent[] | undefined)?.some((event) => event.type === "manual_correction") ? (
                <p className="muted">Техническая коррекция учтена в текущем счёте и не показана как игровое очко.</p>
              ) : null}
            </div>
            <div className="stack stack--actions">
              {match.status === "waiting" && isCreator ? (
                <Button variant="secondary" disabled={action.pending} onClick={openEditor}>Изменить матч</Button>
              ) : null}
              {canStart && (
                <Button
                  disabled={action.pending || consentBlocksStart}
                  onClick={() => {
                    setStartServerId("");
                    setStartOpen(true);
                  }}
                >
                  Старт
                </Button>
              )}
              {canStart && consentBlocksStart ? (
                <p className="muted" role="status">
                  Старт станет доступен после согласия приглашённых игроков: {consentBlockedParticipants.map((participant) => participant.displayName ?? "участник").join(", ")}.
                </p>
              ) : null}
              {(match.status === "in_progress" ||
                match.status === "pending_confirmation" ||
                match.status === "waiting") && (
                <>
                  <Button
                    disabled={judgeTakenByOther}
                    onClick={() => navigate(`/matches/${id}/judge`)}
                  >
                    Судить
                  </Button>
                  {judgeTakenByOther ? (
                    <p className="muted">
                      Матч уже судит {activeJudge?.displayName}. Можно открыть
                      счёт в режиме просмотра.
                    </p>
                  ) : null}
                  <Button
                    variant="secondary"
                    onClick={() => navigate(`/matches/${id}/judge?mode=readonly`)}
                  >
                    Открыть счёт
                  </Button>
                </>
              )}
              {canStop && (
                <Button
                  variant="secondary"
                  disabled={action.pending}
                  onClick={() => setStopOpen((v) => !v)}
                >
                  {stopOpen ? "Скрыть остановку" : "Остановить матч"}
                </Button>
              )}
              {canNoShow ? (
                <Button
                  variant="secondary"
                  disabled={action.pending}
                  onClick={() => setNoShowOpen(true)}
                >
                  Зафиксировать неявку
                </Button>
              ) : null}
              {canCreateRevenge ? (
                <Button onClick={() => navigate(`/matches/new?revengeOf=${id}`)}>
                  Создать реванш
                </Button>
              ) : null}
              {canCancel ? (
                <Button
                  variant="secondary"
                  disabled={action.pending}
                  onClick={() => setCancelOpen(true)}
                >
                  Отменить матч
                </Button>
              ) : null}
              {canVoid ? (
                <Button
                  variant="secondary"
                  disabled={action.pending}
                  onClick={() => setVoidOpen(true)}
                >
                  Аннулировать результат
                </Button>
              ) : null}
              {canForceClose ? (
                <Button
                  variant="secondary"
                  disabled={action.pending}
                  onClick={() => setAdminConfirm("force-close")}
                >
                  Принудительно закрыть
                </Button>
              ) : null}
              {canAdminPurge ? (
                <Button
                  variant="secondary"
                  disabled={action.pending}
                  onClick={() => setAdminConfirm("delete")}
                >
                  Удалить из истории
                </Button>
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
              <Button variant="secondary" onClick={() => navigate(-1)}>
                Назад
              </Button>
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
                <p className="muted">Создатель матча остаётся в составе.</p>
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
            {actionError ? (
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
              onClose={() => (!action.pending ? setCancelOpen(false) : undefined)}
              title="Отменить матч?"
              width="sm"
              secondaryButtonLabel="Нет"
              onSecondaryButton={() =>
                !action.pending ? setCancelOpen(false) : undefined
              }
              mainButtonLabel={action.pending ? "…" : "Отменить матч"}
              onMainButton={() => void onCancelConfirm()}
            >
              <p>
                Матч «{String(match.title)}» будет аннулирован без победителя и
                без влияния на рейтинг.
                Участники снова смогут играть в других матчах и турнирах.
              </p>
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
