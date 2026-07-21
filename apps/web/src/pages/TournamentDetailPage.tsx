import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, Button, TextField } from "../ui";
import { PageLayout } from "../layout";
import { AsyncState, StatusChip, formatLabel } from "../patterns";
import { api } from "../api";
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
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tournament, setTournament] = useState<Record<string, unknown> | null>(
    null,
  );
  const [guest, setGuest] = useState("");
  const [pickUserId, setPickUserId] = useState("");
  const [pickInput, setPickInput] = useState("");
  const [inviteUserId, setInviteUserId] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionHint, setActionHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [algoDialogOpen, setAlgoDialogOpen] = useState(false);
  const [algoSelected, setAlgoSelected] =
    useState<BracketConstructionAlgorithm>("compact");

  async function load() {
    const res = await api.getTournament(id!);
    setTournament(res.tournament);
    setLoadError(null);
  }

  useEffect(() => {
    void load().catch((e) => setLoadError(e.message));
  }, [id]);

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
  const status = String(tournament?.status ?? "");
  const canEditRoster =
    status === "collecting" || status === "needs_regeneration";
  const canGenerate = canEditRoster && activeParticipants.length >= 3;
  const canStart = status === "bracket_generated";
  const canStop = status === "in_progress";
  const canWithdraw =
    status !== "finished" &&
    status !== "stopped" &&
    status !== "in_progress";
  const canDissolve =
    status === "bracket_generated" || status === "needs_regeneration";
  const canChangeAlgorithm =
    (status === "bracket_generated" || status === "needs_regeneration") &&
    hasBracket;
  const canBuildBracket = canGenerate || canChangeAlgorithm;

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
    if (format === "double_elimination") {
      setAlgoSelected("power_of_two");
    } else if (
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

  async function runAction(fn: () => Promise<void>, okHint?: string) {
    setBusy(true);
    setActionError(null);
    setActionHint(null);
    try {
      await fn();
      if (okHint) setActionHint(okHint);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function participantLabel(p: Participant) {
    return (
      p.displayName ||
      [p.guestFirstName, p.guestLastName].filter(Boolean).join(" ") ||
      "Участник"
    );
  }

  return (
    <PageLayout title={tournament ? String(tournament.title) : "Турнир"}>
      <AsyncState loading={!tournament && !loadError} error={loadError}>
        {tournament ? (
          <div className="stack page-layout">
            <div className="row">
              <StatusChip
                status={String(tournament.status)}
                domain="tournament"
              />
              <span className="muted">
                {formatLabel(String(tournament.format))}
              </span>
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
                      await load();
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
                      setTournament(r.tournament);
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
                  onClick={() =>
                    void runAction(async () => {
                      const r = await api.stopTournament(id!, {
                        code: "other",
                      });
                      setTournament(r.tournament);
                    })
                  }
                >
                  Остановить турнир
                </Button>
              ) : null}
              {canWithdraw ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () => {
                      const r = await api.withdrawTournament(id!);
                      setTournament(
                        (r as { tournament: Record<string, unknown> })
                          .tournament,
                      );
                    })
                  }
                >
                  Выйти из турнира
                </Button>
              ) : null}
            </div>

            {canEditRoster ? (
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
                          await load();
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
                        await load();
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
                    await load();
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
                    await load();
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
                    await load();
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
                {bracketV2 ? (
                  <TournamentBracket
                    graph={bracketV2}
                    names={nameMap}
                    matches={matches}
                    avatars={avatarMap}
                    seeds={seedMap}
                  />
                ) : bracketV1 ? (
                  <TournamentBracket
                    bracket={bracketV1}
                    names={nameMap}
                    matches={matches}
                    avatars={avatarMap}
                    seeds={seedMap}
                  />
                ) : null}
              </div>
            ) : null}

            {status === "finished" || status === "stopped" ? (
              <p className="muted">
                Турнир завершён. Можно открыть сыгранные матчи из сетки.
              </p>
            ) : null}
          </div>
        ) : null}
      </AsyncState>

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
            await load();
          }, "Сетка построена");
        }}
      />
    </PageLayout>
  );
}
