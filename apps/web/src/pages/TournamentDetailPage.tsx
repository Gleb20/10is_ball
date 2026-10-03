import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Dialog, Icon, IconButton, TextField } from "../ui";
import { PageLayout } from "../layout";
import {
  AsyncState,
  FilterBar,
  RefreshButton,
  StatusChip,
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
import "./TournamentSetup.css";

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

type MatchRow = {
  id: string;
  title?: string;
  status?: string;
  scoreA?: number | null;
  scoreB?: number | null;
  tournamentSlotId?: string | null;
};

function definitiveBracketRejection(error: unknown): boolean {
  const response = error as Error & { status?: number; code?: string };
  return Boolean(response.status && response.status >= 400 && response.status < 500 &&
    response.status !== 408 && response.status !== 429 &&
    (response.code || response.status === 403 || response.status === 404));
}

function bracketRetryBlocked(error: unknown): boolean {
  const response = error as Error & { status?: number; code?: string };
  return !["BRACKET_ALGORITHM_MISMATCH", "LEGACY_BRACKET_ALGORITHM_REQUIRED", "INVALID_BRACKET_CONSTRUCTION_ALGORITHM"].includes(response.code ?? "");
}

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
  const [guestFormOpen, setGuestFormOpen] = useState(false);
  const [pickUserId, setPickUserId] = useState("");
  const [pickInput, setPickInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionHint, setActionHint] = useState<string | null>(null);
  const { pending: busy, run: runSingleFlight } = useSingleFlight();
  const [algoDialogOpen, setAlgoDialogOpen] = useState(false);
  const algoReturnFocusRef = useRef<HTMLElement | null>(null);
  const [algoSelected, setAlgoSelected] =
    useState<BracketConstructionAlgorithm>("compact");
  const [algoError, setAlgoError] = useState<string | null>(null);
  const [algoErrorTitle, setAlgoErrorTitle] = useState("Не удалось построить сетку");
  const [algoErrorRevision, setAlgoErrorRevision] = useState(0);
  const [algoRetryBlocked, setAlgoRetryBlocked] = useState(false);
  const algoNoRepeatRef = useRef(false);
  const algoConfirmedReadbackRef = useRef<number | null>(null);
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
    setGuest("");
    setGuestFormOpen(false);
    setPickUserId("");
    setPickInput("");
    setEditingSettings(false);
    setSwapA("seed:1");
    setSwapB("seed:2");
    setStopDialogOpen(false);
    setStopReason("");
    setActionError(null);
    setActionHint(null);
    setAlgoError(null);
    setAlgoErrorTitle("Не удалось построить сетку");
    setAlgoRetryBlocked(false);
    algoNoRepeatRef.current = false;
    algoConfirmedReadbackRef.current = null;
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
      return res.tournament;
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
  } = useVisibleRefresh(async () => { await load(); }, {
    pollingEnabled: tournamentIsActive,
    refreshKey: id,
  });

  const participants = (tournament?.participants as Participant[]) ?? [];
  const activeParticipants = participants.filter(
    (p) => !p.status || p.status === "active",
  );
  const rosterUserIds = useMemo(
    () =>
      activeParticipants
        .map((p) => p.userId)
        .filter((uid): uid is string => Boolean(uid)),
    [activeParticipants],
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
  const setupStage = status === "collecting" || status === "needs_regeneration";
  const isOrganizer = Boolean(
    user?.id && tournament?.createdByUserId === user.id,
  );
  const isAdmin = user?.role === "admin";
  const isScopedAdminView = Boolean(
    isAdmin && !isOrganizer && tournament && !("organizerParticipates" in tournament),
  );
  const canEditRoster =
    status === "collecting" || status === "needs_regeneration";
  const canAddRegistered =
    (isOrganizer || isAdmin) &&
    (canEditRoster || status === "bracket_generated");
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

  useEffect(() => {
    if (algoDialogOpen || !algoReturnFocusRef.current) return;
    const trigger = algoReturnFocusRef.current;
    algoReturnFocusRef.current = null;
    if (trigger.isConnected) trigger.focus();
  }, [algoDialogOpen]);

  function openAlgorithmDialog(trigger: HTMLElement) {
    algoReturnFocusRef.current = trigger;
    if (!algoNoRepeatRef.current &&
      detectedAlgo.kind === "algorithm" &&
      (detectedAlgo.algorithm === "compact" ||
        detectedAlgo.algorithm === "power_of_two")
    ) {
      setAlgoSelected(detectedAlgo.algorithm);
    } else if (!algoNoRepeatRef.current) {
      setAlgoSelected("compact");
    }
    if (!algoNoRepeatRef.current) {
      setAlgoError(null);
      setAlgoErrorTitle("Не удалось построить сетку");
      setAlgoRetryBlocked(false);
    }
    setAlgoDialogOpen(true);
  }

  async function confirmAlgorithm() {
    if (!id || algoNoRepeatRef.current || algoRetryBlocked) return;
    const submittedAlgorithm = algoSelected;
    const requestedId = id;
    const requestedUserId = user?.id;
    await runSingleFlight(async () => {
      mutationPendingRef.current = true;
      requestSequence.current += 1;
      setActionError(null);
      setAlgoError(null);
      let writeConfirmed = false;
      try {
        const generated = await api.generateBracket(requestedId, { constructionAlgorithm: submittedAlgorithm }) as Tournament;
        if (generated.status !== "bracket_generated" || !generated.bracketJson) {
          throw new Error("Ответ построения не подтвердил состояние сетки");
        }
        writeConfirmed = true;
        const generatedVersion = Number(generated.bracketStateVersion);
        algoConfirmedReadbackRef.current = Number.isFinite(generatedVersion) && generatedVersion > 0 ? generatedVersion : 0;
        const fresh = await load(true);
        const freshVersion = Number(fresh?.bracketStateVersion);
        if (!fresh || fresh.status !== "bracket_generated" || !fresh.bracketJson ||
          (Number.isFinite(generatedVersion) && generatedVersion > 0 &&
            (!Number.isFinite(freshVersion) || freshVersion < generatedVersion))) {
          throw new Error("Не удалось подтвердить сохранённую сетку");
        }
        if (currentIdRef.current === requestedId && (!requestedUserId || currentUserIdRef.current === requestedUserId)) {
          algoConfirmedReadbackRef.current = null;
          algoNoRepeatRef.current = false;
          setAlgoDialogOpen(false);
          setActionHint("Сетка построена");
        }
      } catch (error) {
        if (currentIdRef.current !== requestedId || (requestedUserId && currentUserIdRef.current !== requestedUserId)) return;
        if (writeConfirmed) {
          algoNoRepeatRef.current = true;
          setAlgoRetryBlocked(true);
          setAlgoErrorTitle("Сетка построена, состояние не загружено");
          setAlgoError("Сетка построена, но обновлённое состояние пока недоступно. Проверьте его здесь; повторное построение заблокировано.");
        } else if (!definitiveBracketRejection(error)) {
          algoNoRepeatRef.current = true;
          setAlgoRetryBlocked(true);
          setAlgoErrorTitle("Исход построения неизвестен");
          setAlgoError("Ответ не получен. Сетка могла быть построена и ещё может измениться. Проверьте её состояние; повторное построение в этом окне заблокировано.");
        } else if (bracketRetryBlocked(error)) {
          algoNoRepeatRef.current = true;
          setAlgoRetryBlocked(true);
          setAlgoErrorTitle("Построение сейчас недоступно");
          setAlgoError(`Сетка сейчас недоступна для построения: ${(error as Error).message}. Проверьте состояние турнира или выйдите из окна.`);
        } else {
          setAlgoErrorTitle("Не удалось построить сетку");
          setAlgoError((error as Error).message);
        }
        setAlgoErrorRevision((revision) => revision + 1);
      } finally {
        mutationPendingRef.current = false;
      }
    });
  }

  async function checkAlgorithmState() {
    if (!id) return;
    const requestedId = id;
    const requestedUserId = user?.id;
    await runSingleFlight(async () => {
      try {
        const fresh = await load(true);
        if (currentIdRef.current !== requestedId || (requestedUserId && currentUserIdRef.current !== requestedUserId)) return;
        const expectedVersion = algoConfirmedReadbackRef.current;
        if (expectedVersion !== null) {
          const freshVersion = Number(fresh?.bracketStateVersion);
          if (fresh?.status === "bracket_generated" && fresh.bracketJson &&
            (expectedVersion === 0 || (Number.isFinite(freshVersion) && freshVersion >= expectedVersion))) {
            algoConfirmedReadbackRef.current = null;
            algoNoRepeatRef.current = false;
            setAlgoRetryBlocked(false);
            setAlgoError(null);
            setAlgoDialogOpen(false);
            setActionHint("Сетка построена");
          } else {
            setAlgoErrorTitle("Сетка построена, состояние не подтверждено");
            setAlgoError("Сетка построена, но актуальная сетка пока не отображается. Проверьте состояние ещё раз; повторное построение заблокировано.");
            setAlgoErrorRevision((revision) => revision + 1);
          }
        }
      } catch (error) {
        if (currentIdRef.current !== requestedId || (requestedUserId && currentUserIdRef.current !== requestedUserId) || (error as { status?: number }).status === 401) return;
        setAlgoError((message) => `${message ?? "Исход построения неизвестен."} Не удалось обновить состояние турнира.`);
        setAlgoErrorRevision((revision) => revision + 1);
      }
    });
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

  const buildBracketAction = canBuildBracket && activeParticipants.length >= 3 ? (
    <Button
      disabled={busy}
      data-testid="tournament-build-bracket"
      onClick={(event: MouseEvent<HTMLButtonElement>) => openAlgorithmDialog(event.currentTarget)}
    >
      {hasBracket
        ? BRACKET_ALGORITHM_DIALOG.changeAction
        : BRACKET_ALGORITHM_DIALOG.buildAction}
    </Button>
  ) : null;

  const dissolveAction = canDissolve ? (
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
  ) : null;

  const startAction = canStart ? (
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
  ) : null;

  const stopAction = canStop ? (
    <Button
      variant="secondary"
      disabled={busy}
      onClick={() => setStopDialogOpen(true)}
    >
      Остановить турнир
    </Button>
  ) : null;

  const cancelAction = canCancel ? (
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
  ) : null;

  const withdrawAction = canWithdraw ? (
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
  ) : null;

  return (
    <PageLayout
      title={tournament ? String(tournament.title) : "Турнир"}
      action={
        setupStage ? undefined : <RefreshButton refreshing={refreshing} onRefresh={refreshNow} />
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
                Сетка проигравших {format === "double_elimination" ? "включена" : "выключена"}
              </span>
            </div>

            {!isScopedAdminView ? <section className="card stack tournament-setup" aria-labelledby="tournament-rules-heading">
              <div className="row tournament-setup__heading-row">
                <h2 id="tournament-rules-heading" className="section-title">
                  {setupStage ? "Шаг 1 из 3 · Правила" : "Правила"}
                </h2>
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
                    Изменить правила
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
                  <div className="stack tournament-setup__choice">
                    <span className="tournament-setup__choice-label">Сетка проигравших</span>
                    <FilterBar
                      label="Сетка проигравших"
                      value={settings.format}
                      onChange={(value) =>
                        setSettings((current) => ({
                          ...current,
                          format: value as typeof current.format,
                        }))
                      }
                      options={[
                        { value: "single_elimination", label: "Выключена" },
                        { value: "double_elimination", label: "Включена" },
                      ]}
                    />
                  </div>
                  <TextField
                    label="Очков для победы"
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={String(settings.pointsToWin)}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setSettings((current) => ({
                        ...current,
                        pointsToWin: Number(event.target.value),
                      }))
                    }
                  />
                  <label className="match-create__check">
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
                  <label className="match-create__check">
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
                    Завершать матч при сухом счёте
                  </label>
                  {settings.mercyEnabled ? (
                    <TextField
                      label="Очков для сухой победы"
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={String(settings.mercyPoints)}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setSettings((current) => ({
                          ...current,
                          mercyPoints: Number(event.target.value),
                        }))
                      }
                    />
                  ) : null}
                  {settings.mercyEnabled ? (
                    <p className="muted tournament-setup__hint">
                      Матч завершится при счёте {settings.mercyPoints}:0 или выше у лидера, пока у соперника 0.
                    </p>
                  ) : null}
                  <div className="row">
                    <Button
                      disabled={busy || !settings.title.trim() || settings.pointsToWin < 1 || (settings.mercyEnabled && settings.mercyPoints < 1)}
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
                <ul className="tournament-setup__rule-summary">
                  <li>Сетка проигравших: {format === "double_elimination" ? "включена" : "выключена"}</li>
                  <li>До {Number(tournament.pointsToWin ?? 11)} очков</li>
                  <li>
                    {tournament.mercyEnabled
                      ? `Сухая победа при ${Number(tournament.mercyPoints ?? 2)}:0`
                      : "Сухая победа выключена"}
                  </li>
                  <li>{tournament.organizerParticipates === false ? "Организатор не участвует" : "Организатор участвует"}</li>
                </ul>
              )}
            </section> : null}

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

            {!setupStage ? (
              <div className="row tournament-setup__actions">
                {buildBracketAction}
                {dissolveAction}
                {startAction}
                {stopAction}
                {cancelAction}
                {withdrawAction}
              </div>
            ) : null}

            {setupStage || canAddRegistered || (canEditRoster && isOrganizer) ? (
            <section className="card stack tournament-setup" aria-labelledby="tournament-roster-heading">
              <h2 id="tournament-roster-heading" className="section-title">
                {setupStage ? "Шаг 2 из 3 · Состав" : "Участники"} ({activeParticipants.length})
              </h2>
              {canAddRegistered ? <UserPicker
                label="Добавить игрока"
                value={pickUserId}
                onChange={setPickUserId}
                inputValue={pickInput}
                onInputChange={setPickInput}
                disabled={busy}
                excludeUserIds={rosterUserIds}
                excludeSelf={false}
              /> : null}
              {canAddRegistered ? <Button
                disabled={busy || !pickUserId}
                onClick={() => {
                  const playerName = pickInput.trim() || "выбранного игрока";
                  const requiresOverride = Boolean(tournament.requireParticipantConsent) || !isOrganizer;
                  const regeneratesBracket = status === "bracket_generated";
                  const ordinaryOrganizerAdd = isOrganizer && status === "collecting" && !tournament.requireParticipantConsent;
                  const consequence = [
                    requiresOverride ? "добавить без ответа на приглашение" : "добавить напрямую в состав",
                    regeneratesBracket ? "и сразу перестроить уже созданную сетку" : null,
                  ].filter(Boolean).join(" ");
                  if (!ordinaryOrganizerAdd && !window.confirm(`Добавить ${playerName} в турнир «${String(tournament.title)}»: ${consequence}?`)) return;
                  const submittedUserId = pickUserId;
                  void runAction(async () => {
                    const response = await api.addTournamentParticipant(id!, {
                      userId: submittedUserId,
                      ...(requiresOverride ? { confirmManualOverride: true } : {}),
                      ...(regeneratesBracket ? { confirmBracketRegeneration: true } : {}),
                    }, crypto.randomUUID());
                    setPickUserId("");
                    setPickInput("");
                    replaceTournamentIfCurrent(response.tournament);
                  }, "Игрок добавлен")
                }}
              >
                Добавить в состав
              </Button> : null}
              {isOrganizer && canEditRoster ? (
                <div className="stack tournament-setup__guest">
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-expanded={guestFormOpen}
                    aria-controls="tournament-one-off-guest"
                    onClick={() => setGuestFormOpen((open) => !open)}
                  >
                    Добавить разового гостя
                  </Button>
                  {guestFormOpen ? <div id="tournament-one-off-guest" className="stack">
                    <TextField
                      label="Имя и фамилия разового гостя"
                      value={guest}
                      disabled={busy}
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
                          const response = await api.addTournamentParticipant(id!, {
                            guestFirstName: first,
                            guestLastName: rest.join(" ") || "Гость",
                          }, crypto.randomUUID());
                          setGuest("");
                          replaceTournamentIfCurrent(response.tournament);
                        }, "Гость добавлен");
                      }}
                    >
                      Добавить гостя
                    </Button>
                  </div> : null}
                </div>
              ) : null}
              {activeParticipants.length === 0 ? (
                <p className="muted">Пока никого нет</p>
              ) : (
                <ul className="tournament-setup__roster">
                  {activeParticipants.map((p) => (
                  <li key={p.id} className="tournament-setup__roster-item">
                    <span className="tournament-setup__participant">
                      {participantLabel(p)}
                      {p.seed ? (
                        <span className="muted"> · посев {p.seed}</span>
                      ) : null}
                      {p.userId === user?.id ? (
                        <span className="muted"> · вы</span>
                      ) : null}
                    </span>
                    {isOrganizer && canEditRoster ? <IconButton
                      variant="outlined"
                      size="sm"
                      className="tournament-setup__remove"
                      aria-label={`Удалить ${participantLabel(p)} из состава`}
                      disabled={busy}
                      icon={<Icon path="Office & Editing/TrashSimple" size={20} />}
                      onClick={() =>
                        void runAction(async () => {
                          await api.removeTournamentParticipant(id!, p.id);
                          await load(true);
                        })
                      }
                    /> : null}
                  </li>
                  ))}
                </ul>
              )}
            </section>
            ) : null}

            {setupStage && isOrganizer ? (
              <section className="card stack tournament-setup" aria-labelledby="tournament-bracket-step-heading">
                <h2 id="tournament-bracket-step-heading" className="section-title">Шаг 3 из 3 · Сетка</h2>
                {buildBracketAction ?? (
                  <p className="muted">Чтобы построить сетку, добавьте минимум трёх участников.</p>
                )}
              </section>
            ) : null}

            {setupStage ? (
              <div className="row tournament-setup__actions" aria-label="Дополнительные действия турнира">
                <Button
                  variant="secondary"
                  disabled={refreshing || busy}
                  onClick={() => void refreshNow()}
                >
                  {refreshing ? "Проверяем изменения…" : "Проверить изменения состава"}
                </Button>
                {dissolveAction}
                {cancelAction}
                {withdrawAction}
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
                        state={{ returnTo: `/tournaments/${id}`, returnLabel: "К турниру" }}
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
                          onClick={() => navigate(`/matches/${m.id}/judge`, { state: { returnTo: `/tournaments/${id}`, returnLabel: "К турниру" } })}
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
                  <Link to={`/matches/${currentOwnMatch.id}`} state={{ returnTo: `/tournaments/${id}`, returnLabel: "К турниру" }}>
                    Текущий матч: {currentOwnMatch.title ?? "Открыть"}
                  </Link>
                ) : null}
                {nextOwnMatch ? (
                  <Link to={`/matches/${nextOwnMatch.id}`} state={{ returnTo: `/tournaments/${id}`, returnLabel: "К турниру" }}>
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
                    onClick={(event: MouseEvent<HTMLButtonElement>) => openAlgorithmDialog(event.currentTarget)}
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
                    tournamentId={id}
                    userId={user?.id}
                    names={nameMap}
                    matches={matches}
                    avatars={avatarMap}
                    seeds={seedMap}
                    highlightedParticipantIds={ownParticipantIds}
                  />
                ) : bracketV1 ? (
                  <TournamentBracket
                    bracket={bracketV1}
                    tournamentId={id}
                    userId={user?.id}
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
            {summary && !setupStage ? (
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
        error={algoError}
        errorTitle={algoErrorTitle}
        errorRevision={algoErrorRevision}
        retryBlocked={algoRetryBlocked}
        onCheckState={() => void checkAlgorithmState()}
        showRegenWarning={hasBracket}
        onConfirm={() => void confirmAlgorithm()}
      />
    </PageLayout>
  );
}
