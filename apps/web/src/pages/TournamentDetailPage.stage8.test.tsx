import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Activity, useState } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import type { BracketGraphV2 } from "@tab10/shared";
import { AuthProvider, useAuth } from "../auth";
import { BRACKET_ALGORITHM_DIALOG } from "../bracketAlgorithmCopy";
import { TournamentDetailPage } from "./TournamentDetailPage";

const getTournament = vi.fn();
const getBracketGenerationContext = vi.fn();
const generateBracket = vi.fn();
const dissolveBracket = vi.fn();
const withdrawTournament = vi.fn();
const cancelTournament = vi.fn();
const startTournament = vi.fn();

vi.mock("../api", () => ({
  api: {
    me: vi.fn().mockResolvedValue({ user: { id: "u1", role: "user" } }),
    getTournament: (...args: unknown[]) => getTournament(...args),
    getBracketGenerationContext: (...args: unknown[]) => getBracketGenerationContext(...args),
    generateBracket: (...args: unknown[]) => generateBracket(...args),
    dissolveBracket: (...args: unknown[]) => dissolveBracket(...args),
    withdrawTournament: (...args: unknown[]) => withdrawTournament(...args),
    cancelTournament: (...args: unknown[]) => cancelTournament(...args),
    startTournament: (...args: unknown[]) => startTournament(...args),
    stopTournament: vi.fn(),
    patchTournament: vi.fn(),
    patchTournamentBracket: vi.fn(),
    addTournamentParticipant: vi.fn(),
    removeTournamentParticipant: vi.fn(),
    inviteTournament: vi.fn(),
    cancelTournamentInvitation: vi.fn(),
    searchUsers: vi.fn().mockResolvedValue({ users: [] }),
    directory: vi.fn().mockResolvedValue({ users: [] }),
  },
}));

const graph: BracketGraphV2 = {
  schemaVersion: 2,
  format: "single_elimination",
  constructionAlgorithm: "power_of_two",
  bracketSize: 4,
  participantCount: 4,
  seedOrder: ["p1", "p2", "p3", "p4"],
  thirdPlaceEnabled: false,
  matches: [],
  championParticipantId: null,
  runnerUpParticipantId: null,
  thirdPlaceParticipantId: null,
};

function tournament(status = "bracket_generated", tournamentId = "t1") {
  return {
    id: tournamentId,
    title: tournamentId === "t2" ? "Второй кубок" : "Осенний кубок",
    status,
    format: "single_elimination",
    createdByUserId: "u1",
    organizerParticipates: true,
    requireParticipantConsent: false,
    pointsToWin: 11,
    mercyEnabled: false,
    mercyPoints: 2,
    bracketJson: graph as BracketGraphV2 | null,
    stopReasonText: undefined as string | undefined,
    bracketStateVersion: 1,
    participants: [
      { id: "p1", userId: "u1", displayName: "Анна", status: "active", seed: 1 },
      { id: "p2", userId: "u2", displayName: "Борис", status: "active", seed: 2 },
      { id: "p3", userId: "u3", displayName: "Вера", status: "active", seed: 3 },
      { id: "p4", userId: "u4", displayName: "Глеб", status: "active", seed: 4 },
    ],
    invitations: [],
    matches: [
      { id: "m1", title: "Полуфинал", status: "in_progress", scoreA: 3, scoreB: 2 },
      { id: "m2", title: "Финал", status: "waiting", scoreA: 0, scoreB: 0 },
    ],
    summary: {
      durationSeconds: 754,
      playedMatchCount: 2,
      top3: ["p1", "p2", "p3", "p4"],
      results: [
        { participantId: "p3", points: 99, playedMatches: 2, place: 3 },
        { participantId: "p1", points: 11, playedMatches: 2, place: 1 },
        { participantId: "p4", points: 4, playedMatches: 2, place: 3 },
        { participantId: "p2", points: 42, playedMatches: 2, place: 2 },
      ],
      matchParticipants: [
        { matchId: "m1", participantIds: ["p1", "p2"] },
        { matchId: "m2", participantIds: ["p1", "p3"] },
      ],
    },
  };
}

type Fixture = ReturnType<typeof tournament>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function RouteSwitch() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/tournaments/t2")}>Открыть второй турнир</button>;
}

function ActivityTournamentPage() {
  const [mode, setMode] = useState<"visible" | "hidden">("visible");
  return (
    <>
      <button onClick={() => setMode("hidden")}>Скрыть турнир</button>
      <button onClick={() => setMode("visible")}>Вернуть турнир</button>
      <Activity mode={mode}>
        <Routes>
          <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
        </Routes>
      </Activity>
    </>
  );
}

function AuthControl() {
  const { setUser } = useAuth();
  return (
    <>
      <button onClick={() => setUser(null)}>Оборвать сессию</button>
      <button onClick={() => setUser({ id: "u1", role: "user" } as never)}>Восстановить сессию</button>
    </>
  );
}

function renderPage(withSwitch = false) {
  return render(
    <MemoryRouter initialEntries={["/tournaments/t1"]}>
      <AuthProvider>
        {withSwitch ? <RouteSwitch /> : null}
        <Routes>
          <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function precedes(first: Element, second: Element) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("Stage 8 tournament detail W4-W6", () => {
  let current: Fixture;

  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
    vi.stubGlobal("scrollTo", vi.fn());
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    current = tournament();
    getTournament.mockImplementation(async (id: string) => ({
      tournament: id === "t2" ? tournament("bracket_generated", "t2") : current,
    }));
    getBracketGenerationContext.mockImplementation(async () => ({ tournament: current }));
    cancelTournament.mockImplementation(async () => {
      current = { ...current, status: "cancelled", bracketJson: null };
      return { tournament: current };
    });
    dissolveBracket.mockImplementation(async () => {
      current = { ...current, status: "collecting", bracketJson: null };
      return { tournament: current };
    });
    withdrawTournament.mockImplementation(async () => {
      current = {
        ...current,
        status: current.status === "bracket_generated" ? "needs_regeneration" : current.status,
        participants: current.participants.map((participant) =>
          participant.userId === "u1" ? { ...participant, status: "withdrawn" } : participant,
        ),
      };
      return { tournament: current };
    });
  });

  it("puts the generated start task, own match and bracket before read-only rules and hides premature results", async () => {
    renderPage();
    await screen.findByText("Осенний кубок");

    const start = screen.getByRole("button", { name: "Старт" });
    const own = screen.getByRole("heading", { name: "Ваши матчи" });
    const bracket = screen.getByRole("heading", { name: /^Сетка/ });
    const rules = screen.getByRole("heading", { name: "Правила" });

    expect(precedes(start, own)).toBe(true);
    expect(precedes(own, bracket)).toBe(true);
    expect(precedes(bracket, rules)).toBe(true);
    expect(screen.queryByRole("heading", { name: "Итоги" })).not.toBeInTheDocument();
  });

  it("keeps active play and the bracket ahead of secondary controls without zero-result copy", async () => {
    current = tournament("in_progress");
    renderPage();
    await screen.findByText("Осенний кубок");

    const matches = screen.getByRole("heading", { name: "Текущие матчи" });
    const bracket = screen.getByRole("heading", { name: /^Сетка/ });
    const stop = screen.getByRole("button", { name: "Остановить турнир" });
    expect(precedes(matches, bracket)).toBe(true);
    expect(precedes(bracket, stop)).toBe(true);
    expect(screen.queryByText("Итогов пока нет")).not.toBeInTheDocument();
  });

  it("renders the server-provided finished places including a shared third place before the bracket", async () => {
    current = tournament("finished");
    current = {
      ...current,
      bracketJson: { ...graph, championParticipantId: "p1", runnerUpParticipantId: "p2", thirdPlaceParticipantId: "p3" },
    };
    renderPage();
    await screen.findByText("Осенний кубок");

    const places = screen.getByRole("heading", { name: "Призовые места" });
    const bracket = screen.getByRole("heading", { name: /^Сетка/ });
    expect(precedes(places, bracket)).toBe(true);
    expect(within(places.parentElement!).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "1 место · Анна",
      "2 место · Борис",
      "3 место · Вера",
      "3 место · Глеб",
    ]);
    expect(screen.getByText("Полная статистика")).toBeInTheDocument();
  });

  it("shows a stopped reason and played statistics without a champion or prize podium", async () => {
    current = { ...tournament("stopped"), stopReasonText: "Травма" };
    renderPage();
    await screen.findByText("Осенний кубок");

    expect(screen.getByText("Причина остановки: Травма")).toBeInTheDocument();
    expect(screen.queryByText(/Чемпион:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Призовые места" })).not.toBeInTheDocument();
    expect(screen.getByText("Полная статистика")).toBeInTheDocument();
  });

  it("confirms cancellation by name, sends one write, then uses an authoritative GET", async () => {
    renderPage();
    await screen.findByText("Осенний кубок");
    const trigger = screen.getByTestId("tournament-cancel");
    const readsBefore = getTournament.mock.calls.length;

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Отменить турнир «Осенний кубок»?" });
    expect(cancelTournament).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/продолжить его будет нельзя/i)).toBeInTheDocument();
    const safe = within(dialog).getByRole("button", { name: "Оставить турнир" });
    await waitFor(() => expect(safe).toHaveFocus());
    fireEvent.click(safe);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Отменить турнир" }));
    await waitFor(() => expect(cancelTournament).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getTournament.mock.calls.length).toBeGreaterThan(readsBefore));
    expect(await screen.findByText("Турнир отменён")).toBeInTheDocument();
  });

  it("guards dissolve with its distinct consequence and authoritative readback", async () => {
    renderPage();
    await screen.findByText("Осенний кубок");
    fireEvent.click(screen.getByRole("button", { name: "Распустить сетку" }));
    const dialog = screen.getByRole("dialog", { name: "Распустить сетку турнира «Осенний кубок»?" });
    expect(dissolveBracket).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/состав сохранится/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Распустить сетку" }));
    await waitFor(() => expect(dissolveBracket).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Сетка распущена")).toBeInTheDocument();
    expect(getTournament).toHaveBeenCalledWith("t1");
  });

  it("blocks a repeated destructive write when its authoritative readback is unavailable", async () => {
    renderPage();
    await screen.findByText("Осенний кубок");
    getTournament.mockRejectedValueOnce(new Error("Чтение недоступно"));

    fireEvent.click(screen.getByTestId("tournament-cancel"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Отменить турнир" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/состояние не удалось подтвердить/i);
    expect(within(dialog).getByRole("button", { name: "Отменить турнир" })).toBeDisabled();
    expect(cancelTournament).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole("button", { name: "Проверить состояние" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(cancelTournament).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Состояние турнира подтверждено")).toBeInTheDocument();
  });

  it("guards withdrawal from a generated bracket but keeps collecting withdrawal direct", async () => {
    renderPage();
    await screen.findByText("Осенний кубок");
    fireEvent.click(screen.getByRole("button", { name: "Выйти из турнира" }));
    const dialog = screen.getByRole("dialog", { name: "Выйти из турнира «Осенний кубок»?" });
    expect(withdrawTournament).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/потребуется построить её заново/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Выйти из турнира" }));
    await waitFor(() => expect(withdrawTournament).toHaveBeenCalledTimes(1));
    expect(getTournament).toHaveBeenCalledWith("t1");

    current = { ...tournament("collecting"), bracketJson: null };
    renderPage();
    await screen.findAllByText("Осенний кубок");
    const direct = screen.getAllByRole("button", { name: "Выйти из турнира" }).at(-1)!;
    fireEvent.click(direct);
    await waitFor(() => expect(withdrawTournament).toHaveBeenCalledTimes(2));
  });

  it("ignores a late confirmed mutation after route activity changes", async () => {
    const held = deferred<{ tournament: Fixture }>();
    cancelTournament.mockReturnValueOnce(held.promise);
    renderPage(true);
    await screen.findByText("Осенний кубок");
    fireEvent.click(screen.getByTestId("tournament-cancel"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Отменить турнир" }));
    fireEvent.click(screen.getByRole("button", { name: "Открыть второй турнир" }));
    expect(await screen.findByText("Второй кубок")).toBeInTheDocument();

    await act(async () => held.resolve({ tournament: { ...tournament("cancelled"), bracketJson: null } }));
    await waitFor(() => expect(screen.getByText("Второй кубок")).toBeInTheDocument());
    expect(screen.queryByText("Турнир отменён")).not.toBeInTheDocument();
  });

  it("invalidates an Activity mutation lifecycle so late A cannot unlock or overwrite pending B", async () => {
    const first = deferred<{ tournament: Fixture }>();
    const second = deferred<{ tournament: Fixture }>();
    startTournament.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(
      <MemoryRouter initialEntries={["/tournaments/t1"]}>
        <AuthProvider><ActivityTournamentPage /></AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByText("Осенний кубок");
    fireEvent.click(screen.getByRole("button", { name: "Старт" }));
    fireEvent.click(screen.getByRole("button", { name: "Скрыть турнир" }));
    fireEvent.click(screen.getByRole("button", { name: "Вернуть турнир" }));
    const resumedStart = await screen.findByRole("button", { name: "Старт" });
    await waitFor(() => expect(resumedStart).toBeEnabled());
    fireEvent.click(resumedStart);
    expect(startTournament).toHaveBeenCalledTimes(2);
    expect(resumedStart).toBeDisabled();

    await act(async () => first.resolve({ tournament: { ...current, status: "in_progress", title: "Старый ответ" } }));
    expect(resumedStart).toBeDisabled();
    expect(screen.queryByText("Старый ответ")).not.toBeInTheDocument();

    current = { ...current, status: "in_progress" };
    await act(async () => second.resolve({ tournament: current }));
    expect(await screen.findByText("Турнир стартовал")).toBeInTheDocument();
  });

  it("ignores a late GET after same-user reauthentication changes the auth lifecycle", async () => {
    const staleRead = deferred<{ tournament: Fixture }>();
    render(
      <MemoryRouter initialEntries={["/tournaments/t1"]}>
        <AuthProvider>
          <AuthControl />
          <Routes><Route path="/tournaments/:id" element={<TournamentDetailPage />} /></Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByText("Осенний кубок");
    getTournament.mockReturnValueOnce(staleRead.promise);
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    fireEvent.click(screen.getByRole("button", { name: "Оборвать сессию" }));
    fireEvent.click(screen.getByRole("button", { name: "Восстановить сессию" }));
    await screen.findByText("Осенний кубок");

    await act(async () => staleRead.resolve({ tournament: { ...current, title: "Старое чтение" } }));
    expect(screen.queryByText("Старое чтение")).not.toBeInTheDocument();
  });

  it("keeps collecting withdrawal blocked after POST success and failed GET until explicit recovery", async () => {
    current = { ...tournament("collecting"), bracketJson: null, bracketStateVersion: 0 };
    renderPage();
    await screen.findByText("Осенний кубок");
    getTournament.mockRejectedValueOnce(new Error("Чтение недоступно"));
    fireEvent.click(screen.getByRole("button", { name: "Выйти из турнира" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/запрос на выход отправлен.*не подтверждено/i);
    expect(screen.queryByText("Вы вышли из турнира")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Выйти из турнира" })).toBeDisabled();
    expect(withdrawTournament).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Проверить состояние" }));
    expect(await screen.findByText("Состояние турнира подтверждено")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Выйти из турнира" })).not.toBeInTheDocument();
    expect(withdrawTournament).toHaveBeenCalledTimes(1);
  });

  it("keeps collecting withdrawal blocked after a stale GET and never repeats its POST", async () => {
    current = { ...tournament("collecting"), bracketJson: null, bracketStateVersion: 0 };
    withdrawTournament.mockResolvedValueOnce({ tournament: current });
    renderPage();
    await screen.findByText("Осенний кубок");
    fireEvent.click(screen.getByRole("button", { name: "Выйти из турнира" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/состояние не подтверждено/i);
    const withdraw = screen.getByRole("button", { name: "Выйти из турнира" });
    expect(withdraw).toBeDisabled();
    fireEvent.click(withdraw);
    expect(withdrawTournament).toHaveBeenCalledTimes(1);

    current = {
      ...current,
      participants: current.participants.map((participant) =>
        participant.userId === "u1" ? { ...participant, status: "withdrawn" } : participant,
      ),
    };
    fireEvent.click(screen.getByRole("button", { name: "Проверить состояние" }));
    expect(await screen.findByText("Состояние турнира подтверждено")).toBeInTheDocument();
    expect(withdrawTournament).toHaveBeenCalledTimes(1);
  });

  it("keeps an Activity-interrupted generation unknown and blocks a related second POST", async () => {
    current = { ...tournament("collecting"), bracketJson: null, bracketStateVersion: 0 };
    const held = deferred<{ tournament: Fixture }>();
    generateBracket.mockReturnValueOnce(held.promise);
    render(
      <MemoryRouter initialEntries={["/tournaments/t1"]}>
        <AuthProvider><ActivityTournamentPage /></AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByText("Осенний кубок");
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit }));
    await waitFor(() => expect(generateBracket).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Скрыть турнир" }));
    fireEvent.click(screen.getByRole("button", { name: "Вернуть турнир" }));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/экран был прерван.*повторное построение заблокировано/i);
    expect(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit })).toBeDisabled();
    current = tournament("bracket_generated");
    await act(async () => held.resolve({ tournament: current }));
    expect(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit })).toBeDisabled();
    expect(screen.queryByText("Сетка построена")).not.toBeInTheDocument();
    expect(generateBracket).toHaveBeenCalledTimes(1);
  });

  it("lets the generation dialog close while the write continues and reports the later result on the page", async () => {
    current = { ...tournament("collecting"), bracketJson: null, bracketStateVersion: 0 };
    const held = deferred<{ tournament: Fixture }>();
    generateBracket.mockReturnValueOnce(held.promise);
    renderPage();
    await screen.findByText("Осенний кубок");
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit }));
    const close = within(screen.getByRole("dialog")).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.cancel });
    expect(close).toBeEnabled();
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    current = tournament("bracket_generated");
    await act(async () => held.resolve({ tournament: current }));
    expect(await screen.findByText("Сетка построена")).toBeInTheDocument();
    expect(generateBracket).toHaveBeenCalledTimes(1);
  });
});
