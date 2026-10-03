import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../auth";
import { TournamentDetailPage } from "./TournamentDetailPage";
import { TournamentsPage } from "./TournamentsPage";

const me = vi.fn();
const getTournament = vi.fn();
const createTournament = vi.fn();
const addTournamentParticipant = vi.fn();
const directory = vi.fn();

vi.mock("../api", () => ({
  api: {
    me: (...args: unknown[]) => me(...args),
    getTournament: (...args: unknown[]) => getTournament(...args),
    createTournament: (...args: unknown[]) => createTournament(...args),
    addTournamentParticipant: (...args: unknown[]) => addTournamentParticipant(...args),
    directory: (...args: unknown[]) => directory(...args),
    listTournaments: vi.fn().mockResolvedValue({ tournaments: [] }),
    patchTournament: vi.fn(), generateBracket: vi.fn(), dissolveBracket: vi.fn(),
    startTournament: vi.fn(), stopTournament: vi.fn(), withdrawTournament: vi.fn(),
    cancelTournament: vi.fn(), removeTournamentParticipant: vi.fn(),
    inviteTournament: vi.fn(), cancelTournamentInvitation: vi.fn(),
    patchTournamentBracket: vi.fn(),
  },
}));

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/tournaments/t1"]}>
      <AuthProvider>
        <Routes><Route path="/tournaments/:id" element={<TournamentDetailPage />} /></Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("GAP-012 tournament setup", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    directory.mockResolvedValue({ users: [{ id: "u2", displayName: "Борис Игрок" }] });
    createTournament.mockResolvedValue({ tournament: { id: "t1" } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000012201");
  });

  it("GAP-029 creates direct-roster tournaments without a consent selector", async () => {
    render(<MemoryRouter><TournamentsPage createOnly /></MemoryRouter>);
    expect(screen.queryByLabelText("Требовать согласие приглашённых участников")).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole("form", { name: "Создание турнира" }));
    await waitFor(() => expect(createTournament).toHaveBeenCalledWith(expect.objectContaining({
      requireParticipantConsent: false,
      organizerParticipates: true,
    })));
  });

  it("Stage 7 creates a tournament from player-language rules with the complete safe payload", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TournamentsPage createOnly /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Шаг 1 из 3 · Правила" })).toBeInTheDocument();
    const losersBracket = screen.getByRole("group", { name: "Сетка проигравших" });
    await user.click(within(losersBracket).getByRole("button", { name: "Включена" }));
    fireEvent.change(screen.getByLabelText("Очков для победы"), { target: { value: "15" } });
    await user.click(screen.getByRole("checkbox", { name: "Завершать матч при сухом счёте" }));
    fireEvent.change(screen.getByLabelText("Очков для сухой победы"), { target: { value: "5" } });
    fireEvent.submit(screen.getByRole("form", { name: "Создание турнира" }));

    await waitFor(() => expect(createTournament).toHaveBeenCalledWith({
      title: expect.stringMatching(/^Турнир /),
      format: "double_elimination",
      organizerParticipates: true,
      pointsToWin: 15,
      mercyEnabled: true,
      mercyPoints: 5,
      requireParticipantConsent: false,
    }));
  });

  it("Stage 7 freezes one creation payload and restores the unchanged form after a known rejection", async () => {
    let rejectCreate!: (error: Error) => void;
    createTournament.mockReturnValueOnce(new Promise((_, reject) => {
      rejectCreate = reject;
    }));
    const user = userEvent.setup();
    render(<MemoryRouter><TournamentsPage createOnly /></MemoryRouter>);

    const title = screen.getByLabelText("Название");
    await user.clear(title);
    await user.type(title, "Осенний кубок");
    await user.click(within(screen.getByRole("group", { name: "Сетка проигравших" })).getByRole("button", { name: "Включена" }));
    await user.clear(screen.getByLabelText("Очков для победы"));
    await user.type(screen.getByLabelText("Очков для победы"), "15");
    await user.click(screen.getByRole("checkbox", { name: "Завершать матч при сухом счёте" }));
    await user.clear(screen.getByLabelText("Очков для сухой победы"));
    await user.type(screen.getByLabelText("Очков для сухой победы"), "5");
    await user.click(screen.getByRole("checkbox", { name: "Организатор участвует" }));
    await user.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() => expect(createTournament).toHaveBeenCalledTimes(1));
    expect(createTournament).toHaveBeenCalledWith({
      title: "Осенний кубок",
      format: "double_elimination",
      organizerParticipates: false,
      pointsToWin: 15,
      mercyEnabled: true,
      mercyPoints: 5,
      requireParticipantConsent: false,
    });
    expect(title).toBeDisabled();
    expect(within(screen.getByRole("group", { name: "Сетка проигравших" })).getByRole("button", { name: "Включена" })).toBeDisabled();
    expect(screen.getByLabelText("Очков для победы")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Завершать матч при сухом счёте" })).toBeDisabled();
    expect(screen.getByLabelText("Очков для сухой победы")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Организатор участвует" })).toBeDisabled();

    await act(async () => rejectCreate(new Error("Название уже занято")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Название уже занято");
    expect(title).toBeEnabled();
    expect(title).toHaveValue("Осенний кубок");
    expect(within(screen.getByRole("group", { name: "Сетка проигравших" })).getByRole("button", { name: "Включена" })).toBeEnabled();
    expect(screen.getByLabelText("Очков для победы")).toHaveValue(15);
    expect(screen.getByRole("checkbox", { name: "Завершать матч при сухом счёте" })).toBeChecked();
    expect(screen.getByLabelText("Очков для сухой победы")).toHaveValue(5);
    expect(screen.getByRole("checkbox", { name: "Организатор участвует" })).not.toBeChecked();
  });

  it("Stage 7 orders setup, reveals a one-off guest, and directly adds in ordinary collecting", async () => {
    me.mockResolvedValue({ user: { id: "organizer", role: "user" } });
    const collecting = {
      id: "t1", title: "Кубок без приглашений", status: "collecting",
      format: "single_elimination", createdByUserId: "organizer",
      organizerParticipates: true, requireParticipantConsent: false,
      pointsToWin: 11, mercyEnabled: false, mercyPoints: null,
      participants: [
        { id: "p1", userId: "organizer", displayName: "Организатор", status: "active" },
        { id: "p2", userId: "u3", displayName: "Вера Игрок", status: "active" },
        { id: "p3", userId: "u4", displayName: "Глеб СверхдлиннаяФамилияКотораяДолжнаПереноситьсяВСтрокеУчастника", status: "active" },
      ],
      invitations: [], matches: [], bracketJson: null,
    };
    getTournament.mockResolvedValue({ tournament: collecting });
    addTournamentParticipant.mockResolvedValue({ participant: { id: "p4" }, tournament: collecting });
    const user = userEvent.setup();
    renderDetail();

    const rules = await screen.findByRole("heading", { name: "Шаг 1 из 3 · Правила" });
    const roster = screen.getByRole("heading", { name: /Шаг 2 из 3 · Состав/ });
    const bracket = screen.getByRole("heading", { name: "Шаг 3 из 3 · Сетка" });
    expect(rules.compareDocumentPosition(roster) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(roster.compareDocumentPosition(bracket) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const rosterSection = roster.closest("section")!;
    const picker = within(rosterSection).getByRole("combobox", { name: "Добавить игрока" });
    const addButton = within(rosterSection).getByRole("button", { name: "Добавить в состав" });
    const guestToggle = within(rosterSection).getByRole("button", { name: "Добавить разового гостя" });
    const participantList = rosterSection.querySelector(".tournament-setup__roster")!;
    expect(picker.compareDocumentPosition(participantList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(addButton.compareDocumentPosition(participantList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(guestToggle.compareDocumentPosition(participantList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const longName = screen.getByText("Глеб СверхдлиннаяФамилияКотораяДолжнаПереноситьсяВСтрокеУчастника");
    const longNameRow = longName.closest("li")!;
    const compactRemove = within(longNameRow).getByRole("button", { name: "Удалить Глеб СверхдлиннаяФамилияКотораяДолжнаПереноситьсяВСтрокеУчастника из состава" });
    expect(compactRemove).toHaveClass("tournament-setup__remove");
    expect(compactRemove.querySelector("svg")).toBeInTheDocument();
    expect(compactRemove).not.toHaveTextContent("Удалить");
    expect(screen.queryByRole("button", { name: "Обновить" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Проверить изменения состава" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Имя и фамилия разового гостя")).not.toBeInTheDocument();
    await user.click(screen.getByText("Добавить разового гостя"));
    expect(screen.getByLabelText("Имя и фамилия разового гостя")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Добавить игрока" }));
    await user.click(await screen.findByText("Борис Игрок"));
    await user.click(screen.getByRole("button", { name: "Добавить в состав" }));
    await waitFor(() => expect(addTournamentParticipant).toHaveBeenCalledWith(
      "t1",
      { userId: "u2" },
      "00000000-0000-4000-8000-000000012201",
    ));
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("Stage 7 preserves confirmation outside ordinary collecting", async () => {
    me.mockResolvedValue({ user: { id: "organizer", role: "user" } });
    const tournament = {
      id: "t1", title: "Кубок на перестройке", status: "needs_regeneration",
      format: "single_elimination", createdByUserId: "organizer",
      organizerParticipates: false, requireParticipantConsent: false,
      pointsToWin: 11, mercyEnabled: false, mercyPoints: null,
      participants: [], invitations: [], matches: [], bracketJson: null,
    };
    getTournament.mockResolvedValue({ tournament });
    addTournamentParticipant.mockResolvedValue({ participant: { id: "p2" }, tournament });
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("combobox", { name: "Добавить игрока" }));
    await user.click(await screen.findByText("Борис Игрок"));
    await user.click(screen.getByRole("button", { name: "Добавить в состав" }));
    await waitFor(() => expect(addTournamentParticipant).toHaveBeenCalledWith(
      "t1",
      { userId: "u2" },
      "00000000-0000-4000-8000-000000012201",
    ));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/Кубок на перестройке.*добавить напрямую в состав/));
  });

  it("Stage 7 gives a participant the read-only setup order without empty results", async () => {
    me.mockResolvedValue({ user: { id: "participant", role: "user" } });
    getTournament.mockResolvedValue({ tournament: {
      id: "t1", title: "Кубок для просмотра", status: "collecting",
      format: "double_elimination", createdByUserId: "organizer",
      organizerParticipates: false, requireParticipantConsent: false,
      pointsToWin: 11, mercyEnabled: true, mercyPoints: 5,
      participants: [{ id: "p1", userId: "participant", displayName: "Участник", status: "active" }],
      matches: [], bracketJson: null,
      summary: { durationSeconds: null, playedMatchCount: 0, top3: [], results: [], matchParticipants: [] },
    } });
    renderDetail();

    await screen.findByRole("heading", { name: "Шаг 1 из 3 · Правила" });
    expect(screen.getByRole("heading", { name: /Шаг 2 из 3 · Состав/ })).toBeInTheDocument();
    expect(screen.getByText("Участник")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Добавить игрока" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Добавить разового гостя" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Шаг 3 из 3 · Сетка" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Итоги" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Обновить" })).not.toBeInTheDocument();
    const refreshCalls = getTournament.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Проверить изменения состава" }));
    await waitFor(() => expect(getTournament.mock.calls.length).toBeGreaterThan(refreshCalls));
  });

  it("gives an outsider admin only roster visibility and one confirmed registered-add action", async () => {
    me.mockResolvedValue({ user: { id: "admin", role: "admin" } });
    const scoped = {
      id: "t1", title: "Кубок consent", status: "collecting",
      format: "single_elimination", createdByUserId: "organizer",
      requireParticipantConsent: true,
      participants: [{ id: "p1", userId: "u1", displayName: "Анна Игрок", status: "active" }],
    };
    getTournament.mockResolvedValue({ tournament: scoped });
    addTournamentParticipant.mockResolvedValue({
      participant: { id: "p2", userId: "u2" },
      tournament: { ...scoped, participants: [...scoped.participants, { id: "p2", userId: "u2", displayName: "Борис Игрок", status: "active" }] },
    });
    const user = userEvent.setup();
    renderDetail();
    await screen.findByText("Кубок consent");
    expect(screen.queryByRole("button", { name: "Изменить" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Пригласить игрока")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Добавить гостя/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Удалить" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Добавить игрока" }));
    await user.click(await screen.findByText("Борис Игрок"));
    await user.click(screen.getByRole("button", { name: "Добавить в состав" }));
    await waitFor(() => expect(addTournamentParticipant).toHaveBeenCalledWith(
      "t1",
      { userId: "u2", confirmManualOverride: true },
      "00000000-0000-4000-8000-000000012201",
    ));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/Борис Игрок.*Кубок consent.*без ответа/));
  });

  it("names the bracket consequence and confirms atomic regeneration for an organizer add", async () => {
    me.mockResolvedValue({ user: { id: "organizer", role: "user" } });
    const tournament = {
      id: "t1", title: "Кубок с сеткой", status: "bracket_generated",
      format: "single_elimination", createdByUserId: "organizer",
      organizerParticipates: false, requireParticipantConsent: false,
      pointsToWin: 11, mercyEnabled: false, mercyPoints: null,
      participants: [], invitations: [], matches: [], bracketJson: null,
    };
    getTournament.mockResolvedValue({ tournament });
    addTournamentParticipant.mockResolvedValue({ participant: { id: "p2" }, tournament });
    const user = userEvent.setup();
    renderDetail();
    await user.click(await screen.findByRole("combobox", { name: "Добавить игрока" }));
    await user.click(await screen.findByText("Борис Игрок"));
    await user.click(screen.getByRole("button", { name: "Добавить в состав" }));
    await waitFor(() => expect(addTournamentParticipant).toHaveBeenCalledWith(
      "t1",
      { userId: "u2", confirmBracketRegeneration: true },
      "00000000-0000-4000-8000-000000012201",
    ));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/Кубок с сеткой.*перестроить уже созданную сетку/));
  });
});
