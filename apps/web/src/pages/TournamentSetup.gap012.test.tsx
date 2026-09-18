import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
