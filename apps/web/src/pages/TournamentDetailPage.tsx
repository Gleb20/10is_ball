import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Dialog, TextField } from "../ui";
import { PageLayout } from "../layout";
import {
  AsyncState,
  RefreshButton,
  StatusChip,
  formatLabel,
} from "../patterns";
import { api, type Tournament } from "../api";
import { useAuth } from "../auth";
import { UserPicker } from "../components/UserPicker";
import { TournamentBracket } from "../components/TournamentBracket";
import { BracketAlgorithmDialog } from "../components/BracketAlgorithmDialog";
import type {
  Bracket,
  BracketConstructionAlgorithm,
  BracketGraphV2,
} from "@tab10/shared";
import {
  detectStoredConstructionAlgorithm,
  parseBracketJson,
} from "@tab10/shared";
import { liveMatchVersusLabel } from "../bracketViewModel";
import {
  algorithmLabel,
  BRACKET_ALGORITHM_DIALOG,
} from "../bracketAlgorithmCopy";
import { statusLabel } from "../statusLabels";
import { useVisibleRefresh } from "../useVisibleRefresh";
import { useSingleFlight } from "../useSingleFlight";

type Participant = {
  id: string;
  userId?: string | null;
  displayName?: string;
  avatarKey?: string | null;
  guestFirstName?: string | null;
  guestLastName?: string | null;
  seed?: number | null;
  status?: string;
};

type InvitationRow = {
  id: string;
  status: string;
  invitedUserId: string;
  displayName?: string;
};

type MatchRow = {
  id: string;
  title?: string;
  status?: string;
  scoreA?: number | null;
  scoreB?: number | null;
  tournamentSlotId?: string | null;
};

export function TournamentDetailPage() {
  const { id } = useParams();
  const currentIdRef = useRef(id);
  currentIdRef.current = id;
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentUserIdRef = useRef(user?.id);
  currentUserIdRef.current = user?.id;
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [guest, setGuest] = useState("");
  const [pickUserId, setPickUserId] = useState("");
  const [pickInput, setPickInput] = useState("");
  const [inviteUserId, setInviteUserId] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionHint, setActionHint] = useState<string | null>(null);
  const { pending: busy, run: runSingleFlight } = useSingleFlight();
  const [algoDialogOpen, setAlgoDialogOpen] = useState(false);
  const [algoSelected, setAlgoSelected] =
    useState<BracketConstructionAlgorithm>("compact");
  const [editingSettings, setEditingSettings] = useState(false);
  const [settings, setSettings] = useState({
    title: "",
    format: "single_elimination" as
      | "single_elimination"
      | "double_elimination",
    organizerParticipates: true,
    pointsToWin: 11,
    mercyEnabled: false,
    mercyPoints: 2,
  });
  const [swapA, setSwapA] = useState("seed:1");
  const [swapB, setSwapB] = useState("seed:2");
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [stopReason, setStopReason] = useState("");
  const requestSequence = useRef(0);
  const mutationPendingRef = useRef(false);

  useEffect(() => {
    requestSequence.current += 1;
    setTournament(null);
    setEditingSettings(false);
    setSwapA("seed:1");
    setSwapB("seed:2");
    setStopDialogOpen(false);
    setStopReason("");
    setActionError(null);
    setActionHint(null);
  }, [id]);

  const load = useCallback(async (allowDuringMutation = false) => {
    const requestedId = id;
    const requestedUserId = user?.id;
    if (!requestedId || (mutationPendingRef.current && !allowDuringMutation)) return;
    const sequence = ++requestSequence.current;
    const res = await api.getTournament(requestedId);
    if (
      sequence === requestSequence.current &&
      currentIdRef.current === requestedId &&
      (!requestedUserId || currentUserIdRef.current === requestedUserId)
    ) {
      setTournament(res.tournament);
    }
  }, [id]);

  const tournamentIsActive =
    tournament === null ||
    !["finished", "stopped", "cancelled", "dissolved"].includes(
      String(tournament.status),
    );
  const {
    error: loadError,
    refreshing,
    refreshNow,
  } = useVisibleRefresh(load, {
    pollingEnabled: tournamentIsActive,
    refreshKey: id,
  });

  const participants = (tournament?.participants as Participant[]) ?? [];
  const invitations = (tournament?.invitations as InvitationRow[]) ?? [];
  const activeParticipants = participants.filter(
    (p) => !p.status || p.status === "active",
  );
  const pendingInvites = invitations.filter((i) => i.status === "pending");
  const declinedInvites = invitations.filter((i) => i.status === "declined");
  const rosterUserIds = useMemo(
    () =>
      activeParticipants
        .map((p) => p.userId)
        .filter((uid): uid is string => Boolean(uid)),
    [activeParticipants],
  );
  const excludeInviteIds = useMemo(
    () => [
      ...rosterUserIds,
      ...pendingInvites.map((i) => i.invitedUserId),
      ...declinedInvites.map((i) => i.invitedUserId),
    ],
    [rosterUserIds, pendingInvites, declinedInvites],
  );
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of participants) {
      const label =
        p.displayName ||
        [p.guestFirstName, p.guestLastName].filter(Boolean).join(" ") ||
        "Участник";
      m.set(p.id, label);
    }
    return m;
  }, [participants]);
  const avatarMap = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const p of participants) {
      m.set(p.id, p.avatarKey ?? null);
    }
    return m;
  }, [participants]);
  const seedMap = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const p of participants) {
      m.set(p.id, p.seed ?? null);
    }
    return m;
  }, [participants]);

  const bracketParsed = parseBracketJson(tournament?.bracketJson);
  const bracketV1 =
    bracketParsed.kind === "v1"
      ? (bracketParsed.raw as Bracket)
      : null;
  const bracketV2 =
    bracketParsed.kind === "v2" ? bracketParsed.graph : null;
  const bracketForLabels: Bracket | BracketGraphV2 | null =
    bracketV2 ?? bracketV1;
  const hasBracket = Boolean(bracketV1?.slots || bracketV2);
  const matches = (tournament?.matches as MatchRow[]) ?? [];
  const summary = tournament?.summary;
  const status = String(tournament?.status ?? "");
  const isOrganizer = Boolean(
    user?.id && tournament?.createdByUserId === user.id,
  );
  const canEditRoster =
    status === "collecting" || status === "needs_regeneration";
  const canGenerate =
    isOrganizer && canEditRoster && activeParticipants.length >= 3;
  const canStart = isOrganizer && status === "bracket_generated";
  const canStop = isOrganizer && status === "in_progress";
  const iAmActiveParticipant = activeParticipants.some(
    (p) => p.userId && user?.id && p.userId === user.id,
  );
  const canWithdraw =
    iAmActiveParticipant &&
    status !== "finished" &&
    status !== "stopped" &&
    status !== "cancelled" &&
    status !== "in_progress";
  const canCancel =
    isOrganizer &&
    (status === "collecting" ||
      status === "bracket_generated" ||
      status === "needs_regeneration");
  const canDissolve =
    isOrganizer &&
    (status === "bracket_generated" || status === "needs_regeneration");
  const canChangeAlgorithm =
    isOrganizer &&
    (status === "bracket_generated" || status === "needs_regeneration") &&
    hasBracket;
  const canBuildBracket = canGenerate || canChangeAlgorithm;
  const canEditSettings =
    isOrganizer &&
    (status === "collecting" ||
      status === "bracket_generated" ||
      status === "needs_regeneration");

  const format = (String(tournament?.format ?? "single_elimination") ===
  "double_elimination"
    ? "double_elimination"
    : "single_elimination") as
    | "single_elimination"
    | "double_elimination";

  const detectedAlgo = detectStoredConstructionAlgorithm(
    tournament?.bracketJson,
  );
  const currentAlgoLabel =
    detectedAlgo.kind === "algorithm"
      ? algorithmLabel(detectedAlgo.algorithm)
      : algorithmLabel(
          (tournament?.bracketConstructionAlgorithm as
            | BracketConstructionAlgorithm
            | undefined) ?? null,
        );

  function openAlgorithmDialog() {
    if (
      detectedAlgo.kind === "algorithm" &&
      (detectedAlgo.algorithm === "compact" ||
        detectedAlgo.algorithm === "power_of_two")
    ) {
      setAlgoSelected(detectedAlgo.algorithm);
    } else {
      setAlgoSelected("compact");
    }
    setAlgoDialogOpen(true);
  }

  const liveMatches = matches.filter(
    (m) =>
      m.status === "waiting" ||
      m.status === "in_progress" ||
      m.status === "pending_confirmation",
  );
  const ownParticipantIds = useMemo(
    () =>
      new Set(
        activeParticipants
          .filter((participant) => participant.userId === user?.id)
          .map((participant) => participant.id),
      ),
    [activeParticipants, user?.id],
  );
  const ownMatchIds = useMemo(
    () =>
      new Set(
        (summary?.matchParticipants ?? [])
          .filter((row) =>
            row.participantIds.some((participantId) =>
              ownParticipantIds.has(participantId),
            ),
          )
          .map((row) => row.matchId),
      ),
    [ownParticipantIds, summary?.matchParticipants],
  );
  const terminalTournament = ["finished", "stopped", "cancelled", "dissolved"].includes(status);
  const currentOwnMatch = terminalTournament
    ? undefined
    : matches.find(
        (match) =>
          ownMatchIds.has(match.id) &&
          (match.status === "in_progress" ||
            match.status === "pending_confirmation"),
      );
  const nextOwnMatch = terminalTournament
    ? undefined
    : matches.find(
        (match) => ownMatchIds.has(match.id) && match.status === "waiting",
      );
  const nextOwnBracketNode = useMemo(() => {
    if (!bracketV2 || nextOwnMatch || terminalTournament) return null;
    const nodesById = new Map(bracketV2.matches.map((node) => [node.id, node]));
    const sourceParticipantId = (source: (typeof bracketV2.matches)[number]["sourceA"]) => {
      if (source.type === "seed") return bracketV2.seedOrder[source.seed - 1] ?? null;
      if (source.type === "winner") {
        return nodesById.get(source.bracketMatchId)?.winnerParticipantId ?? null;
      }
      if (source.type === "loser") {
        return nodesById.get(source.bracketMatchId)?.loserParticipantId ?? null;
      }
      return null;
    };
    return (
      bracketV2.matches.find(
        (node) =>
          !node.actualMatchId &&
          !node.winnerParticipantId &&
          !node.cancelled &&
          [sourceParticipantId(node.sourceA), sourceParticipantId(node.sourceB)].some(
            (participantId) =>
              participantId != null && ownParticipantIds.has(participantId),
          ),
      ) ?? null
    );
  }, [bracketV2, nextOwnMatch, ownParticipantIds, terminalTournament]);
  const seedOrder = bracketV2?.seedOrder ?? [];

  async function runAction(fn: () => Promise<void>, okHint?: string) {
    const actionId = id;
    const actionUserId = user?.id;
    await runSingleFlight(async () => {
      mutationPendingRef.current = true;
      requestSequence.current += 1;
      setActionError(null);
      setActionHint(null);
      try {
        await fn();
        if (
          okHint &&
          currentIdRef.current === actionId &&
          (!actionUserId || currentUserIdRef.current === actionUserId)
        ) {
          setActionHint(okHint);
        }
      } catch (e) {
        if (
          (e as Error & { status?: number }).status !== 401 &&
          currentIdRef.current === actionId &&
          (!actionUserId || currentUserIdRef.current === actionUserId)
        ) {
          setActionError((e as Error).message);
        }
      } finally {
        mutationPendingRef.current = false;
      }
    });
  }

  function replaceTournamentIfCurrent(
    next: Tournament,
    requestedId = id,
    requestedUserId = user?.id,
  ) {
    if (
      requestedId &&
      currentIdRef.current === requestedId &&
      (!requestedUserId || currentUserIdRef.current === requestedUserId)
    ) {
      setTournament(next);
      return true;
    }
    return false;
  }

  function participantLabel(p: Participant) {
    return (
      p.displayName ||
      [p.guestFirstName, p.guestLastName].filter(Boolean).join(" ") ||
      "Участник"
    );
  }

  return (
    <PageLayout
      title={tournament ? String(tournament.title) : "Турнир"}
      action={
        <RefreshButton refreshing={refreshing} onRefresh={refreshNow} />
      }
    >
      <AsyncState
        loading={!tournament && !loadError}
        error={!tournament ? loadError : null}
      >
        {tournament ? (
          <div className="stack page-layout">
            {loadError ? (
              <Alert
                type="warning"
                variant="tonal"
                title="Не удалось обновить"
                description={loadError}
              />
            ) : null}
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
              <div className="row">
                <h2 className="section-title">Настройки и правила</h2>
                {canEditSettings && !editingSettings ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setSettings({
                        title: String(tournament.title ?? ""),
                        format,
                        organizerParticipates:
                          tournament.organizerParticipates !== false,
                        pointsToWin: Number(tournament.pointsToWin ?? 11),
                        mercyEnabled: tournament.mercyEnabled === true,
                        mercyPoints: Number(tournament.mercyPoints ?? 2),
                      });
                      setEditingSettings(true);
                    }}
                  >
                    Изменить
                  </Button>
                ) : null}
              </div>
              {editingSettings ? (
                <>
                  <TextField
                    label="Название"
                    value={settings.title}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setSettings((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                  />
                  <label>
                    Формат
                    <select
                      aria-label="Формат"
                      value={settings.format}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          format: event.target.value as typeof current.format,
                        }))
                      }
                    >
                      <option value="single_elimination">Single elimination</option>
                      <option value="double_elimination">Double elimination</option>
                    </select>
                  </label>
                  <TextField
                    label="Очков для победы"
                    type="number"
                    value={String(settings.pointsToWin)}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setSettings((current) => ({
                        ...current,
                        pointsToWin: Number(event.target.value),
                      }))
                    }
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.organizerParticipates}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          organizerParticipates: event.target.checked,
                        }))
                      }
                    />{" "}
                    Организатор участвует
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.mercyEnabled}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          mercyEnabled: event.target.checked,
                        }))
                      }
                    />{" "}
                    Правило преимущества
                  </label>
                  {settings.mercyEnabled ? (
                    <TextField
                      label="Разница очков"
                      type="number"
                      value={String(settings.mercyPoints)}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setSettings((current) => ({
                          ...current,
                          mercyPoints: Number(event.target.value),
                        }))
                      }
                    />
                  ) : null}
                  <div className="row">
                    <Button
                      disabled={busy || !settings.title.trim()}
                      onClick={() =>
                        void runAction(async () => {
                          const response = await api.patchTournament(id!, {
                            ...settings,
                            title: settings.title.trim(),
                          });
                          if (replaceTournamentIfCurrent(response.tournament)) {
                            setEditingSettings(false);
                          }
                        }, "Настройки сохранены")
                      }
                    >
                      Сохранить
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setEditingSettings(false)}
                    >
                      Отмена
                    </Button>
                  </div>
                </>
              ) : (
                <p className="muted">
                  До {Number(tournament.pointsToWin ?? 11)} очков
                  {tournament.mercyEnabled
                    ? ` · преимущество ${Number(tournament.mercyPoints ?? 2)}`
                    : " · без правила преимущества"}
                  {` · ${tournament.organizerParticipates === false ? "организатор не играет" : "организатор играет"}`}
                </p>
              )}
            </div>

            {actionError ? (
              <Alert
                type="error"
                variant="tonal"
                title="Не удалось выполнить"
                description={actionError}
              />
            ) : null}
            {actionHint ? (
              <Alert
                type="success"
                variant="tonal"
                title="Готово"
                description={actionHint}
              />
            ) : null}

            <div className="row">
              {canBuildBracket && activeParticipants.length >= 3 ? (
                <Button
                  disabled={busy}
                  data-testid="tournament-build-bracket"
                  onClick={() => openAlgorithmDialog()}
                >
                  {hasBracket
                    ? BRACKET_ALGORITHM_DIALOG.changeAction
                    : BRACKET_ALGORITHM_DIALOG.buildAction}
                </Button>
              ) : null}
              {canDissolve ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () => {
                      await api.dissolveBracket(id!);
                      await load(true);
                    })
                  }
                >
                  Распустить сетку
                </Button>
              ) : null}
              {canStart ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () => {
                      const r = await api.startTournament(id!);
                      replaceTournamentIfCurrent(r.tournament);
                    }, "Турнир стартовал")
                  }
                >
                  Старт
                </Button>
              ) : null}
              {canStop ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setStopDialogOpen(true)}
                >
                  Остановить турнир
                </Button>
              ) : null}
              {canCancel ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  data-testid="tournament-cancel"
                  onClick={() =>
                    void runAction(async () => {
                      const r = await api.cancelTournament(id!);
                      replaceTournamentIfCurrent(r.tournament);
                    }, "Турнир отменён")
                  }
                >
                  Отменить турнир
                </Button>
              ) : null}
              {canWithdraw ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () => {
                      const r = await api.withdrawTournament(id!);
                      replaceTournamentIfCurrent(
                        (r as { tournament: Tournament }).tournament,
                      );
                    })
                  }
                >
                  Выйти из турнира
                </Button>
              ) : null}
            </div>

            {canEditRoster && isOrganizer ? (
            <div className="card stack">
              <h2 className="section-title">
                Участники ({activeParticipants.length})
              </h2>
              {activeParticipants.length === 0 ? (
                <p className="muted">Пока никого нет</p>
              ) : (
                activeParticipants.map((p) => (
                  <div key={p.id} className="row">
                    <span>
                      {participantLabel(p)}
                      {p.seed ? (
                        <span className="muted"> · seed {p.seed}</span>
                      ) : null}
                      {p.userId === user?.id ? (
                        <span className="muted"> · вы</span>
                      ) : null}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void runAction(async () => {
                          await api.removeTournamentParticipant(id!, p.id);
                          await load(true);
                        })
                      }
                    >
                      Удалить
                    </Button>
                  </div>
                ))
              )}
              {pendingInvites.map((inv) => (
                <div key={inv.id} className="row">
                  <span>
                    {inv.displayName ?? "Игрок"}
                    <span className="muted"> · ожидает ответ</span>
                  </span>
                </div>
              ))}
              {declinedInvites.map((inv) => (
                <div key={inv.id} className="row">
                  <span>
                    {inv.displayName ?? "Игрок"}
                    <span className="muted"> · отказался</span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void runAction(async () => {
                        await api.cancelTournamentInvitation(id!, inv.id);
                        await load(true);
                      }, "Приглашение удалено")
                    }
                  >
                    Удалить
                  </Button>
                </div>
              ))}
              <UserPicker
                label="Добавить игрока"
                value={pickUserId}
                onChange={setPickUserId}
                inputValue={pickInput}
                onInputChange={setPickInput}
                excludeUserIds={rosterUserIds}
                excludeSelf={false}
              />
              <Button
                disabled={busy || !pickUserId}
                onClick={() =>
                  void runAction(async () => {
                    await api.addTournamentParticipant(id!, {
                      userId: pickUserId,
                    });
                    setPickUserId("");
                    setPickInput("");
                    await load(true);
                  }, "Игрок добавлен")
                }
              >
                Добавить в состав
              </Button>
              <UserPicker
                label="Пригласить игрока"
                value={inviteUserId}
                onChange={setInviteUserId}
                inputValue={inviteInput}
                onInputChange={setInviteInput}
                excludeUserIds={excludeInviteIds}
                excludeSelf
              />
              <Button
                variant="secondary"
                disabled={busy || !inviteUserId}
                onClick={() =>
                  void runAction(async () => {
                    await api.inviteTournament(id!, inviteUserId);
                    setInviteUserId("");
                    setInviteInput("");
                    await load(true);
                  }, "Приглашение отправлено")
                }
              >
                Отправить приглашение
              </Button>
              <TextField
                label="Добавить гостя (Имя Фамилия)"
                value={guest}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setGuest(e.target.value)
                }
              />
              <Button
                variant="secondary"
                disabled={busy || !guest.trim()}
                onClick={() => {
                  const [first, ...rest] = guest.trim().split(/\s+/);
                  void runAction(async () => {
                    await api.addTournamentParticipant(id!, {
                      guestFirstName: first,
                      guestLastName: rest.join(" ") || "Гость",
                    });
                    setGuest("");
                    await load(true);
                  }, "Гость добавлен");
                }}
              >
                Добавить гостя
              </Button>
            </div>
            ) : null}

            {liveMatches.length > 0 ? (
              <div className="card stack">
                <h2 className="section-title">Текущие матчи</h2>
                {liveMatches.map((m) => {
                  const vs = liveMatchVersusLabel(m, bracketForLabels, nameMap);
                  const showScore =
                    m.status === "in_progress" ||
                    m.status === "pending_confirmation";
                  const meta = showScore
                    ? `${statusLabel(String(m.status))} · ${m.scoreA ?? 0}:${m.scoreB ?? 0}`
                    : statusLabel(String(m.status)) || "ожидает";
                  return (
                    <div key={m.id} className="row">
                      <Link
                        to={`/matches/${m.id}`}
                        className="list-row tournament-live-match"
                      >
                        <span className="tournament-live-match__vs">{vs}</span>
                        <span className="tournament-live-match__meta">
                          {meta}
                        </span>
                      </Link>
                      {m.status !== "finished" && m.status !== "stopped" ? (
                        <Button
                          size="sm"
                          onClick={() => navigate(`/matches/${m.id}/judge`)}
                        >
                          Судить
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {currentOwnMatch || nextOwnMatch || nextOwnBracketNode ? (
              <div className="card stack">
                <h2 className="section-title">Ваши матчи</h2>
                {currentOwnMatch ? (
                  <Link to={`/matches/${currentOwnMatch.id}`}>
                    Текущий матч: {currentOwnMatch.title ?? "Открыть"}
                  </Link>
                ) : null}
                {nextOwnMatch ? (
                  <Link to={`/matches/${nextOwnMatch.id}`}>
                    Следующий матч: {nextOwnMatch.title ?? "Открыть"}
                  </Link>
                ) : nextOwnBracketNode ? (
                  <span className="muted">
                    Следующий матч: №{nextOwnBracketNode.displayNumber} формируется
                  </span>
                ) : null}
              </div>
            ) : null}

            {hasBracket ? (
              <div className="card stack">
                <h2 className="section-title">
                  Сетка
                  {bracketV2
                    ? ` (${bracketV2.participantCount})`
                    : bracketV1?.size
                      ? ` (${bracketV1.size})`
                      : ""}
                  {currentAlgoLabel ? (
                    <span className="muted"> · {currentAlgoLabel}</span>
                  ) : null}
                </h2>
                {canChangeAlgorithm ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => openAlgorithmDialog()}
                  >
                    {BRACKET_ALGORITHM_DIALOG.changeAction}
                  </Button>
                ) : null}
                {isOrganizer && status === "bracket_generated" && seedOrder.length > 1 ? (
                  <div className="row" aria-label="Перестановка посева">
                    <select
                      aria-label="Первая позиция"
                      value={swapA}
                      onChange={(event) => setSwapA(event.target.value)}
                    >
                      {seedOrder.map((participantId, index) => (
                        <option key={`a-${index}`} value={`seed:${index + 1}`}>
                          {index + 1}. {nameMap.get(participantId) ?? "BYE"}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Вторая позиция"
                      value={swapB}
                      onChange={(event) => setSwapB(event.target.value)}
                    >
                      {seedOrder.map((participantId, index) => (
                        <option key={`b-${index}`} value={`seed:${index + 1}`}>
                          {index + 1}. {nameMap.get(participantId) ?? "BYE"}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || swapA === swapB}
                      onClick={() => {
                        if (!window.confirm("Поменять выбранные позиции сетки?")) return;
                        void runAction(async () => {
                          await api.patchTournamentBracket(id!, [
                            { slotIdA: swapA, slotIdB: swapB },
                          ]);
                          await load(true);
                        }, "Позиции изменены");
                      }}
                    >
                      Поменять позиции
                    </Button>
                  </div>
                ) : null}
                {bracketV2 ? (
                  <TournamentBracket
                    graph={bracketV2}
                    names={nameMap}
                    matches={matches}
                    avatars={avatarMap}
                    seeds={seedMap}
                    highlightedParticipantIds={ownParticipantIds}
                  />
                ) : bracketV1 ? (
                  <TournamentBracket
                    bracket={bracketV1}
                    names={nameMap}
                    matches={matches}
                    avatars={avatarMap}
                    seeds={seedMap}
                    highlightedParticipantIds={ownParticipantIds}
                  />
                ) : null}
              </div>
            ) : null}

            {status === "finished" || status === "stopped" ? (
              <div className="stack">
                <p className="muted">
                  Турнир завершён. Можно открыть сыгранные матчи из сетки.
                </p>
                {status === "stopped" && tournament.stopReasonText ? (
                  <p>Причина остановки: {String(tournament.stopReasonText)}</p>
                ) : null}
              </div>
            ) : null}
            {summary ? (
              <div className="card stack">
                <h2 className="section-title">Итоги</h2>
                <p className="muted">
                  {summary.durationSeconds == null
                    ? "Длительность не определена"
                    : `Длительность: ${Math.floor(summary.durationSeconds / 60)} мин`}
                  {` · сыграно матчей: ${summary.playedMatchCount}`}
                </p>
                {status === "finished" && summary.top3.length > 0 ? (
                  <p>Призовые места: {summary.top3.map((id) => nameMap.get(id) ?? "Участник").join(", ")}</p>
                ) : null}
                {summary.results.length > 0 ? (
                  <table>
                    <thead><tr><th>Участник</th><th>Место</th><th>Очки</th><th>Матчи</th></tr></thead>
                    <tbody>
                      {summary.results.map((result) => (
                        <tr key={result.participantId}>
                          <td>{nameMap.get(result.participantId) ?? "Участник"}</td>
                          <td>{result.place ?? "—"}</td>
                          <td>{result.points}</td>
                          <td>{result.playedMatches}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="muted">Итогов пока нет</p>}
              </div>
            ) : null}
          </div>
        ) : null}
      </AsyncState>

      <Dialog
        open={stopDialogOpen}
        onClose={() => (!busy ? setStopDialogOpen(false) : undefined)}
        title="Остановить турнир?"
        width="sm"
        secondaryButtonLabel="Отмена"
        onSecondaryButton={() => (!busy ? setStopDialogOpen(false) : undefined)}
      >
        <div className="stack">
          <TextField
            label="Причина остановки"
            value={stopReason}
            maxLength={500}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setStopReason(event.target.value)
            }
          />
          <Button
            disabled={busy || !stopReason.trim()}
            onClick={() => {
              const text = stopReason.trim();
              if (!text || busy) return;
              void runAction(async () => {
                const response = await api.stopTournament(id!, {
                  code: "other",
                  text,
                });
                if (replaceTournamentIfCurrent(response.tournament)) {
                  setStopDialogOpen(false);
                  setStopReason("");
                }
              }, "Турнир остановлен");
            }}
          >
            {busy ? "Сохранение…" : "Подтвердить остановку"}
          </Button>
        </div>
      </Dialog>

      <BracketAlgorithmDialog
        open={algoDialogOpen}
        format={format}
        selected={algoSelected}
        onSelect={setAlgoSelected}
        onCancel={() => setAlgoDialogOpen(false)}
        busy={busy}
        showRegenWarning={hasBracket}
        onConfirm={() => {
          void runAction(async () => {
            await api.generateBracket(id!, {
              constructionAlgorithm: algoSelected,
            });
            setAlgoDialogOpen(false);
            await load(true);
          }, "Сетка построена");
        }}
      />
    </PageLayout>
  );
}
