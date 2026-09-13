import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "../auth";
import { AUTH_UNAUTHORIZED_EVENT } from "../authEvents";
import type { BracketGraphV2 } from "@tab10/shared";
import { TournamentDetailPage } from "./TournamentDetailPage";

const getTournament = vi.fn();
const patchTournament = vi.fn();
const patchTournamentBracket = vi.fn();
const stopTournament = vi.fn();
const me = vi.fn();

vi.mock("../api", () => ({
  api: {
    me: (...args: unknown[]) => me(...args),
    getTournament: (...args: unknown[]) => getTournament(...args),
    patchTournament: (...args: unknown[]) => patchTournament(...args),
    patchTournamentBracket: (...args: unknown[]) => patchTournamentBracket(...args),
    generateBracket: vi.fn(), dissolveBracket: vi.fn(), startTournament: vi.fn(),
    stopTournament: (...args: unknown[]) => stopTournament(...args), withdrawTournament: vi.fn(), cancelTournament: vi.fn(),
    addTournamentParticipant: vi.fn(), removeTournamentParticipant: vi.fn(),
    inviteTournament: vi.fn(), cancelTournamentInvitation: vi.fn(),
    searchUsers: vi.fn().mockResolvedValue({ users: [] }),
    directory: vi.fn().mockResolvedValue({ users: [] }),
  },
}));

const graph: BracketGraphV2 = {
  schemaVersion: 2,
  format: "single_elimination",
  constructionAlgorithm: "power_of_two",
  bracketSize: 4,
  participantCount: 3,
  seedOrder: ["p1", "p2", "p3", ""],
  thirdPlaceEnabled: true,
  matches: [],
  championParticipantId: null,
  runnerUpParticipantId: null,
  thirdPlaceParticipantId: null,
};

function tournament(status = "bracket_generated") {
  return {
    id: "t1", title: "Кубок", status, format: "single_elimination",
    createdByUserId: "u1", organizerParticipates: true, pointsToWin: 11,
    mercyEnabled: false, mercyPoints: 2, bracketJson: graph,
    participants: [
      { id: "p1", userId: "u1", displayName: "Анна", status: "active", seed: 1 },
      { id: "p2", userId: "u2", displayName: "Борис", status: "active", seed: 2 },
      { id: "p3", userId: "u3", displayName: "Вера", status: "active", seed: 3 },
    ],
    invitations: [],
    matches: [
      { id: "m1", title: "Полуфинал", status: "in_progress", scoreA: 3, scoreB: 2 },
      { id: "m2", title: "Финал", status: "waiting" },
    ],
    summary: {
      durationSeconds: 754,
      playedMatchCount: 1,
      top3: ["p1", "p2", "p3"],
      results: [
        { participantId: "p1", points: 11, playedMatches: 1, place: 1 },
      ],
      matchParticipants: [
        { matchId: "m1", participantIds: ["p1", "p2"] },
        { matchId: "m2", participantIds: ["p1", "p3"] },
      ],
    },
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/tournaments/t1"]}>
      <AuthProvider><Routes><Route path="/tournaments/:id" element={<TournamentDetailPage />} /></Routes></AuthProvider>
    </MemoryRouter>,
  );
}

function Controls() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  return <><button onClick={() => navigate("/tournaments/t2")}>Другой турнир</button><button onClick={() => void refresh()}>Повторный вход</button></>;
}

describe("GAP-006 tournament detail", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    me.mockResolvedValue({ user: { id: "u1", role: "user" } });
    getTournament.mockResolvedValue({ tournament: tournament() });
    patchTournament.mockResolvedValue({ tournament: tournament("needs_regeneration") });
    patchTournamentBracket.mockResolvedValue({});
    stopTournament.mockResolvedValue({ tournament: { ...tournament("stopped"), stopReasonText: "Травма" } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("shows rules, own current/next matches and the tournament summary", async () => {
    renderPage();
    await screen.findByText("Кубок");
    expect(screen.getByText(/До 11 очков/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Текущий матч: Полуфинал/ })).toHaveAttribute("href", "/matches/m1");
    expect(screen.getByRole("link", { name: /Следующий матч: Финал/ })).toHaveAttribute("href", "/matches/m2");
    expect(screen.getByText(/Длительность: 12 мин/)).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("11")).toBeInTheDocument();
  });

  it("saves the complete editable settings payload once", async () => {
    renderPage();
    await screen.findByText("Кубок");
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Новый кубок" } });
    fireEvent.change(screen.getByLabelText("Формат"), { target: { value: "double_elimination" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(patchTournament).toHaveBeenCalledTimes(1));
    expect(patchTournament).toHaveBeenCalledWith("t1", expect.objectContaining({ title: "Новый кубок", format: "double_elimination" }));
  });

  it("confirms and sends one-based seed slots including a bye", async () => {
    renderPage();
    await screen.findByText("Кубок");
    fireEvent.change(screen.getByLabelText("Первая позиция"), { target: { value: "seed:2" } });
    fireEvent.change(screen.getByLabelText("Вторая позиция"), { target: { value: "seed:4" } });
    fireEvent.click(screen.getByRole("button", { name: "Поменять позиции" }));
    await waitFor(() => expect(patchTournamentBracket).toHaveBeenCalledWith("t1", [{ slotIdA: "seed:2", slotIdB: "seed:4" }]));
    expect(window.confirm).toHaveBeenCalled();
  });

  it("does not show places or top three for a stopped tournament", async () => {
    const stopped = tournament("stopped");
    stopped.summary.top3 = [];
    (stopped.summary.results[0] as { place: number | null }).place = null;
    getTournament.mockResolvedValue({ tournament: stopped });
    renderPage();
    await screen.findByText("Кубок");
    expect(screen.queryByText(/Призовые места:/)).not.toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("—")).toBeInTheDocument();
  });

  it("leaves a 401 mutation to global reauthentication without stale feedback", async () => {
    patchTournament.mockRejectedValueOnce(Object.assign(new Error("Требуется вход"), { status: 401 }));
    renderPage();
    await screen.findByText("Кубок");
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(patchTournament).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Требуется вход")).not.toBeInTheDocument();
  });

  it("does not let an older refresh overwrite a completed mutation", async () => {
    let resolveRefresh!: (value: { tournament: ReturnType<typeof tournament> }) => void;
    const oldRefresh = new Promise<{ tournament: ReturnType<typeof tournament> }>((resolve) => { resolveRefresh = resolve; });
    renderPage();
    await screen.findByText("Кубок");
    getTournament.mockReturnValueOnce(oldRefresh);
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    const updated = tournament("needs_regeneration"); updated.title = "Новый кубок";
    patchTournament.mockResolvedValueOnce({ tournament: updated });
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Новый кубок" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Новый кубок")).toBeInTheDocument();
    await act(async () => resolveRefresh({ tournament: tournament() }));
    expect(screen.getByText("Новый кубок")).toBeInTheDocument();
  });

  it("clears a settings draft on route change but preserves it for same-user reauthentication", async () => {
    getTournament.mockImplementation((id: string) => ({ tournament: { ...tournament(), id, title: id === "t2" ? "Второй кубок" : "Кубок" } }));
    render(<MemoryRouter initialEntries={["/tournaments/t1"]}><AuthProvider><Controls /><Routes><Route path="/tournaments/:id" element={<TournamentDetailPage />} /></Routes></AuthProvider></MemoryRouter>);
    await screen.findByText("Кубок");
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Черновик" } });
    window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
    fireEvent.click(screen.getByRole("button", { name: "Повторный вход" }));
    await waitFor(() => expect(screen.getByLabelText("Название")).toHaveValue("Черновик"));
    fireEvent.click(screen.getByRole("button", { name: "Другой турнир" }));
    expect(await screen.findByText("Второй кубок")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Черновик")).not.toBeInTheDocument();
  });

  it("requires and persists an explicit stop reason", async () => {
    getTournament.mockResolvedValue({ tournament: tournament("in_progress") });
    renderPage();
    await screen.findByText("Кубок");
    fireEvent.click(screen.getByRole("button", { name: "Остановить турнир" }));
    const confirm = screen.getByRole("button", { name: "Подтвердить остановку" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Причина остановки"), { target: { value: "  Травма  " } });
    fireEvent.click(confirm);
    await waitFor(() => expect(stopTournament).toHaveBeenCalledWith("t1", { code: "other", text: "Травма" }));
    expect(await screen.findByText("Причина остановки: Травма")).toBeInTheDocument();
  });

  it("does not present a completed auto-bye node as a next match", async () => {
    const finished = tournament("finished");
    finished.matches = [];
    finished.summary.matchParticipants = [];
    finished.bracketJson = {
      ...graph,
      championParticipantId: "p1",
      matches: [{
        id: "auto-bye", stage: "winners", roundIndex: 0, orderInRound: 0,
        displayNumber: 2, sourceA: { type: "seed", seed: 1 },
        sourceB: { type: "empty" }, winnerParticipantId: "p1",
        loserParticipantId: null, actualMatchId: null, cancelled: false,
        activationCondition: null,
      }],
    };
    getTournament.mockResolvedValue({ tournament: finished });
    renderPage();
    await screen.findByText("Кубок");
    expect(screen.queryByText(/Следующий матч:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/формируется/)).not.toBeInTheDocument();
  });
});
