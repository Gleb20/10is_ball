import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { TournamentDetailPage } from "../pages/TournamentDetailPage";
import { AuthProvider, useAuth } from "../auth";
import { BRACKET_ALGORITHM_DIALOG } from "../bracketAlgorithmCopy";

const generateBracket = vi.fn().mockResolvedValue({});
const getTournament = vi.fn();
const getBracketGenerationContext = vi.fn();
const addTournamentParticipant = vi.fn();
const directory = vi.fn();
const builtGraph = { schemaVersion: 2, format: "single_elimination", constructionAlgorithm: "compact", bracketSize: 4, participantCount: 3, seedOrder: ["p1", "p2", "p3", ""], thirdPlaceEnabled: false, matches: [], championParticipantId: null, runnerUpParticipantId: null, thirdPlaceParticipantId: null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Match AppRoutes: a protected page mounts only after authentication bootstrap.
function AuthenticatedTournament() {
  const { loading } = useAuth();
  return loading ? null : <TournamentDetailPage />;
}

function SwitchTournament() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/tournaments/t2")}>Другой турнир</button>;
}

vi.mock("../api", () => ({
  api: {
    me: vi.fn().mockResolvedValue({
      user: { id: "u1", role: "user", firstName: "A", lastName: "B" },
    }),
    getTournament: (...args: unknown[]) => getTournament(...args),
    getBracketGenerationContext: (...args: unknown[]) => getBracketGenerationContext(...args),
    generateBracket: (...args: unknown[]) => generateBracket(...args),
    dissolveBracket: vi.fn(),
    startTournament: vi.fn(),
    stopTournament: vi.fn(),
    withdrawTournament: vi.fn(),
    cancelTournament: vi.fn(),
    addTournamentParticipant: (...args: unknown[]) => addTournamentParticipant(...args),
    removeTournamentParticipant: vi.fn(),
    inviteTournament: vi.fn(),
    cancelTournamentInvitation: vi.fn(),
    searchUsers: vi.fn().mockResolvedValue({ users: [] }),
    directory: (...args: unknown[]) => directory(...args),
  },
}));

describe("TournamentDetailPage algorithm dialog wiring", () => {
  beforeEach(() => {
    generateBracket.mockReset();
    generateBracket.mockResolvedValue({});
    getTournament.mockReset();
    getBracketGenerationContext.mockReset();
    addTournamentParticipant.mockReset();
    directory.mockResolvedValue({ users: [{ id: "u4", displayName: "Галина Игрок" }] });
    const tournament = {
        id: "t1",
        title: "Cup",
        status: "collecting",
        format: "single_elimination",
        createdByUserId: "u1",
        participants: [
          { id: "p1", displayName: "A", status: "active", userId: "u1" },
          { id: "p2", displayName: "B", status: "active", userId: "u2" },
          { id: "p3", displayName: "C", status: "active", userId: "u3" },
        ],
        invitations: [],
        matches: [],
        bracketJson: null,
      };
    getTournament.mockResolvedValue({ tournament });
    getBracketGenerationContext.mockResolvedValue({
      tournament: { ...tournament, bracketStateVersion: 0 },
    });
  });

  it("BUG-026 keeps the submitted manual roster target visible and disabled until known rejection", async () => {
    let reject!: (reason: unknown) => void;
    const held = new Promise((_, no) => { reject = no; });
    addTournamentParticipant.mockReturnValueOnce(held);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await screen.findByText("Cup");
    const input = await screen.findByRole("combobox", { name: "Добавить игрока" });
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "Галина" } });
    fireEvent.click(await screen.findByRole("option", { name: "Галина Игрок" }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить в состав" }));
    expect(addTournamentParticipant).toHaveBeenCalledWith("t1", { userId: "u4" }, expect.any(String));
    expect(input).toBeDisabled();
    expect(input).toHaveValue("Галина Игрок");
    reject(Object.assign(new Error("Добавление отклонено"), { status: 409, code: "VALIDATION" }));
    expect(await screen.findByText("Добавление отклонено")).toBeInTheDocument();
    expect(input).toBeEnabled();
    expect(input).toHaveValue("Галина Игрок");
  });

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={["/tournaments/t1"]}>
        <AuthProvider>
          <Routes>
            <Route path="/tournaments/:id" element={<AuthenticatedTournament />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  it("BUG-022 reads a versioned context before sending the compact generation intent", async () => {
    renderPage();
    await screen.findByText("Cup");
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    expect(
      screen.getByTestId("bracket-algorithm-dialog"),
    ).toBeInTheDocument();
    const submitButtons = screen.getAllByRole("button", {
      name: BRACKET_ALGORITHM_DIALOG.submit,
    });
    fireEvent.click(submitButtons[submitButtons.length - 1]!);
    await waitFor(() => {
      expect(getBracketGenerationContext).toHaveBeenCalledWith("t1");
      expect(generateBracket).toHaveBeenCalledWith("t1", {
        expectedVersion: 0,
        constructionAlgorithm: "compact",
      });
    });
  });

  it("BUG-022 keeps closed-window pending and unknown generation visible on the page without replay", async () => {
    const held = deferred<unknown>();
    generateBracket.mockReturnValueOnce(held.promise);
    renderPage();
    await screen.findByText("Cup");
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit }));
    await waitFor(() => expect(generateBracket).toHaveBeenCalledTimes(1));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Закрыть" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Построение сетки" })).toHaveTextContent("Строим сетку");
    held.reject(Object.assign(new Error("Ответ потерян"), { status: 503 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Исход построения неизвестен");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(generateBracket).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Открыть состояние построения" }));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("Исход построения неизвестен");
    expect(generateBracket).toHaveBeenCalledTimes(1);
  });

  it("cancel does not call generateBracket", async () => {
    renderPage();
    await screen.findByText("Cup");
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    const cancelButtons = screen.getAllByRole("button", {
      name: BRACKET_ALGORITHM_DIALOG.cancel,
    });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]!);
    expect(generateBracket).not.toHaveBeenCalled();
  });

  it("BUG-022 fails closed when the versioned context endpoint is unavailable", async () => {
    getBracketGenerationContext.mockRejectedValueOnce(
      Object.assign(new Error("Маршрут не найден"), { status: 404, code: "NOT_FOUND" }),
    );
    renderPage();
    await screen.findByText("Cup");
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/обновите страницу|позже/i);
    expect(generateBracket).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit })).toBeDisabled();
  });

  it("BUG-022 permits a safe retry when the pre-write context read fails", async () => {
    getBracketGenerationContext.mockRejectedValueOnce(new Error("Сеть недоступна"));
    renderPage();
    await screen.findByText("Cup");
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/запрос на построение не отправлен/i);
    expect(generateBracket).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit })).toBeEnabled();
  });

  it("BUG-022 resolves a stale version with GET only and requires a new explicit intent", async () => {
    const initial = (await getTournament.mock.results[0]?.value)?.tournament ?? {
      id: "t1", title: "Cup", status: "collecting", bracketJson: null,
    };
    getBracketGenerationContext
      .mockResolvedValueOnce({ tournament: { ...initial, bracketStateVersion: 2 } })
      .mockResolvedValueOnce({ tournament: { ...initial, bracketStateVersion: 3 } });
    generateBracket.mockRejectedValueOnce(
      Object.assign(new Error("Состав изменился"), { status: 409, code: "BRACKET_VERSION_CONFLICT" }),
    );
    renderPage();
    await screen.findByText("Cup");
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/состояние турнира изменилось/i);
    expect(generateBracket).toHaveBeenCalledWith("t1", {
      expectedVersion: 2,
      constructionAlgorithm: "compact",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Проверить состояние" }));
    await waitFor(() => {
      expect(getBracketGenerationContext).toHaveBeenCalledTimes(2);
      expect(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit })).toBeEnabled();
    });
    expect(generateBracket).toHaveBeenCalledTimes(1);
  });

  it("BUG-022 fences an unknown attempt after a higher-version GET and requires a new confirmation without false success", async () => {
    generateBracket.mockRejectedValueOnce(Object.assign(new Error("Ответ построения потерян"), { status: 503 }));
    renderPage();
    await screen.findByText("Cup");
    const initial = (await getTournament.mock.results[0]?.value).tournament;
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/исход.*неизвестен/i);
    expect(within(dialog).getByRole("button", { name: /проверить состояние/i })).toBeEnabled();
    const readsBeforeCheck = getBracketGenerationContext.mock.calls.length;
    getBracketGenerationContext.mockResolvedValueOnce({ tournament: { ...initial, status: "bracket_generated", bracketJson: builtGraph, bracketStateVersion: 1 } });
    fireEvent.click(within(dialog).getByRole("button", { name: /проверить состояние/i }));
    await waitFor(() => expect(getBracketGenerationContext.mock.calls.length).toBeGreaterThan(readsBeforeCheck));
    expect(await within(dialog).findByText(/Состояние изменилось.*Проверьте состав и сетку/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit })).toBeEnabled();
    expect(screen.queryByText("Сетка построена")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.cancel }));
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit })).toBeEnabled();
    expect(generateBracket).toHaveBeenCalledTimes(1);
  });

  it("BUG-022 offers only an exact frozen retry after an explicit same-version GET", async () => {
    generateBracket
      .mockRejectedValueOnce(Object.assign(new Error("Ответ потерян"), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error("Версия изменилась"), {
        status: 409,
        code: "BRACKET_VERSION_CONFLICT",
      }));
    renderPage();
    await screen.findByText("Cup");
    const initial = (await getTournament.mock.results[0]?.value).tournament;
    getBracketGenerationContext
      .mockResolvedValueOnce({ tournament: { ...initial, bracketStateVersion: 7 } })
      .mockResolvedValueOnce({ tournament: { ...initial, bracketStateVersion: 7 } })
      .mockResolvedValueOnce({ tournament: { ...initial, bracketStateVersion: 8 } });
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("bracket-algo-card-power_of_two"));
    fireEvent.click(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/исход.*неизвестен/i);
    fireEvent.click(within(dialog).getByRole("button", { name: "Проверить состояние" }));
    const retry = await within(dialog).findByRole("button", { name: "Повторить этот запрос" });
    expect(retry).toBeEnabled();
    expect(within(dialog).getByRole("radio", { name: /классическая сетка/i })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /компактная сетка/i })).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: /классическая сетка/i })).toBeDisabled();
    expect(generateBracket).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);
    await waitFor(() => expect(generateBracket).toHaveBeenCalledTimes(2));
    expect(generateBracket.mock.calls[0]).toEqual([
      "t1",
      { expectedVersion: 7, constructionAlgorithm: "power_of_two" },
    ]);
    expect(generateBracket.mock.calls[1]).toEqual(generateBracket.mock.calls[0]);
    await waitFor(() => expect(getBracketGenerationContext).toHaveBeenCalledTimes(3));
    expect(await within(dialog).findByText(/Состояние изменилось.*Проверьте состав и сетку/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit })).toBeEnabled();
    expect(generateBracket).toHaveBeenCalledTimes(2);
  });

  it("BUG-021 keeps an unknown bracket outcome blocked after the state check fails", async () => {
    generateBracket.mockRejectedValueOnce(Object.assign(new Error("Ответ потерян"), { status: 503 }));
    renderPage();
    await screen.findByText("Cup");
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit }));
    await within(dialog).findByRole("alert");
    getBracketGenerationContext.mockRejectedValueOnce(new Error("Проверка недоступна"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Проверить состояние" }));
    expect(await within(dialog).findByText(/Не удалось обновить состояние турнира/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.cancel }));
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit })).toBeDisabled();
    expect(generateBracket).toHaveBeenCalledTimes(1);
  });

  it("BUG-021 never repeats a confirmed bracket write when its readback fails", async () => {
    renderPage();
    await screen.findByText("Cup");
    const initial = (await getTournament.mock.results[0]?.value).tournament;
    const built = { ...initial, status: "bracket_generated", bracketJson: builtGraph, bracketStateVersion: 1 };
    generateBracket.mockResolvedValueOnce({ tournament: built });
    getBracketGenerationContext
      .mockResolvedValueOnce({ tournament: { ...initial, bracketStateVersion: 0 } })
      .mockRejectedValueOnce(new Error("Чтение недоступно"));
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/сетка построена/i);
    expect(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.cancel }));
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit })).toBeDisabled();
    getBracketGenerationContext.mockResolvedValueOnce({ tournament: built });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Проверить состояние" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit })).toBeEnabled();
    expect(generateBracket).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "missing version", readbackVersion: undefined },
    { name: "non-numeric version", readbackVersion: "invalid" },
    { name: "older version", readbackVersion: 4 },
  ])("WO3 R2 holds a confirmed versioned write on $name until an explicit current GET", async ({ readbackVersion }) => {
    renderPage();
    await screen.findByText("Cup");
    const initial = (await getTournament.mock.results[0]?.value).tournament;
    const built = { ...initial, status: "bracket_generated", bracketJson: builtGraph, bracketStateVersion: 5 };
    const { bracketStateVersion: _version, ...withoutVersion } = built;
    const stale = readbackVersion === undefined ? withoutVersion : { ...built, bracketStateVersion: readbackVersion };
    generateBracket.mockResolvedValueOnce({ tournament: built });
    getBracketGenerationContext
      .mockResolvedValueOnce({ tournament: { ...initial, bracketStateVersion: 4 } })
      .mockResolvedValueOnce({ tournament: stale });
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/сетка построена/i);
    expect(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit })).toBeDisabled();
    expect(generateBracket).toHaveBeenCalledTimes(1);
    getBracketGenerationContext.mockResolvedValueOnce({ tournament: stale });
    fireEvent.click(within(dialog).getByRole("button", { name: "Проверить состояние" }));
    expect(await within(dialog).findByText(/актуальная сетка пока не отображается/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit })).toBeDisabled();
    getBracketGenerationContext.mockResolvedValueOnce({ tournament: built });
    fireEvent.click(within(dialog).getByRole("button", { name: "Проверить состояние" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Сетка построена")).toBeInTheDocument();
    expect(generateBracket).toHaveBeenCalledTimes(1);
  });

  it("BUG-021 focuses a correctable error inside the open dialog and keeps the algorithm", async () => {
    generateBracket.mockRejectedValueOnce(Object.assign(new Error("Выберите другой способ"), { status: 400, code: "BRACKET_ALGORITHM_MISMATCH" }));
    renderPage();
    await screen.findByText("Cup");
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("bracket-algo-card-power_of_two"));
    fireEvent.click(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Выберите другой способ");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(within(dialog).getByRole("radio", { name: /классическая сетка/i })).toBeChecked();
    expect(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit })).toBeEnabled();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("BUG-021 serializes state checks and ignores a late failed GET from another tournament", async () => {
    const initial = {
      id: "t1", title: "Cup", status: "collecting", format: "single_elimination", createdByUserId: "u1",
      participants: [
        { id: "p1", displayName: "A", status: "active", userId: "u1" },
        { id: "p2", displayName: "B", status: "active", userId: "u2" },
        { id: "p3", displayName: "C", status: "active", userId: "u3" },
      ], invitations: [], matches: [], bracketJson: null,
    };
    getTournament.mockImplementation((id: string) => Promise.resolve({ tournament: { ...initial, id, title: id === "t2" ? "Second Cup" : "Cup" } }));
    generateBracket.mockRejectedValueOnce(Object.assign(new Error("Ответ потерян"), { status: 503 }));
    render(<MemoryRouter initialEntries={["/tournaments/t1"]}><AuthProvider><SwitchTournament /><Routes><Route path="/tournaments/:id" element={<AuthenticatedTournament />} /></Routes></AuthProvider></MemoryRouter>);
    await screen.findByText("Cup");
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit }));
    await within(screen.getByRole("dialog")).findByRole("alert");
    const held = deferred<{ tournament: typeof initial }>();
    getBracketGenerationContext.mockReturnValueOnce(held.promise);
    const callsBefore = getBracketGenerationContext.mock.calls.length;
    const check = within(screen.getByRole("dialog")).getByRole("button", { name: "Проверить состояние" });
    fireEvent.click(check);
    fireEvent.click(check);
    expect(getBracketGenerationContext.mock.calls.length).toBe(callsBefore + 1);
    expect(check).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Другой турнир" }));
    expect(await screen.findByText("Second Cup")).toBeInTheDocument();
    held.reject(new Error("Старый GET отклонён"));
    await waitFor(() => expect(check).not.toBeInTheDocument());
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    expect(within(screen.getByRole("dialog")).queryByText(/Старый GET отклонён|Исход построения неизвестен/)).not.toBeInTheDocument();
  });

  it("BUG-021 blocks a revoked organizer rather than offering a useless second generation", async () => {
    generateBracket.mockRejectedValueOnce(Object.assign(new Error("Доступ изменился"), { status: 403, code: "FORBIDDEN" }));
    renderPage();
    await screen.findByText("Cup");
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/доступ изменился/i);
    expect(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.cancel }));
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit })).toBeDisabled();
    expect(generateBracket).toHaveBeenCalledTimes(1);
  });

  it("BUG-021 reports success only after the generated response and current GET agree", async () => {
    const initial = {
      id: "t1", title: "Cup", status: "collecting", format: "single_elimination", createdByUserId: "u1",
      participants: [
        { id: "p1", displayName: "A", status: "active", userId: "u1" },
        { id: "p2", displayName: "B", status: "active", userId: "u2" },
        { id: "p3", displayName: "C", status: "active", userId: "u3" },
      ], invitations: [], matches: [], bracketJson: null, bracketStateVersion: 0,
    };
    const graph = { schemaVersion: 2, format: "single_elimination", constructionAlgorithm: "compact", bracketSize: 4, participantCount: 3, seedOrder: ["p1", "p2", "p3", ""], thirdPlaceEnabled: false, matches: [], championParticipantId: null, runnerUpParticipantId: null, thirdPlaceParticipantId: null };
    const built = { ...initial, status: "bracket_generated", bracketJson: graph, bracketStateVersion: 1 };
    let persisted: typeof initial | typeof built = initial;
    getTournament.mockImplementation(async () => ({ tournament: persisted }));
    getBracketGenerationContext.mockImplementation(async () => ({ tournament: persisted }));
    generateBracket.mockImplementationOnce(async () => { persisted = built; return { tournament: built }; });
    renderPage();
    await screen.findByText("Cup");
    fireEvent.click(screen.getByTestId("tournament-build-bracket"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: BRACKET_ALGORITHM_DIALOG.submit }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Сетка построена")).toBeInTheDocument();
    expect(getBracketGenerationContext).toHaveBeenCalled();
    expect(generateBracket).toHaveBeenCalledTimes(1);
  });
});
