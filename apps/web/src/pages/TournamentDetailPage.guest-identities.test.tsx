import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { GuestIdentity } from "@tab10/shared";
import { AuthProvider } from "../auth";
import { TournamentDetailPage } from "./TournamentDetailPage";

const me = vi.fn();
const getTournament = vi.fn();
const addTournamentParticipant = vi.fn();
const directory = vi.fn();
const listGuests = vi.fn();

vi.mock("../api", () => ({
  api: {
    me: (...args: unknown[]) => me(...args),
    getTournament: (...args: unknown[]) => getTournament(...args),
    addTournamentParticipant: (...args: unknown[]) => addTournamentParticipant(...args),
    directory: (...args: unknown[]) => directory(...args),
    listGuests: (...args: unknown[]) => listGuests(...args),
  },
}));

const savedGuest: GuestIdentity = {
  id: "00000000-0000-4000-8000-000000000042",
  firstName: "Анна",
  lastName: "Первая",
  displayName: "Первая Анна",
  avatarKey: "avatar_1",
  version: 0,
  canRename: true,
  createdAt: "2026-10-03T12:00:00.000Z",
  updatedAt: "2026-10-03T12:00:00.000Z",
};

const collectingTournament = {
  id: "t1",
  title: "Кубок гостей",
  status: "collecting",
  format: "single_elimination",
  createdByUserId: "organizer",
  organizerParticipates: true,
  requireParticipantConsent: false,
  pointsToWin: 11,
  mercyEnabled: false,
  mercyPoints: null,
  participants: [
    { id: "p1", userId: "organizer", displayName: "Организатор", status: "active" },
  ],
  invitations: [],
  matches: [],
  bracketJson: null,
};

describe("GAP-040 reusable guests in tournament roster", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    me.mockResolvedValue({ user: { id: "organizer", role: "user" } });
    getTournament.mockResolvedValue({ tournament: collectingTournament });
    directory.mockResolvedValue({ users: [] });
    listGuests.mockResolvedValue({ guests: [savedGuest], nextCursor: null });
    addTournamentParticipant.mockResolvedValue({ tournament: collectingTournament });
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000040001");
  });

  it("adds only the explicitly selected saved guest id", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/tournaments/t1"]}>
        <AuthProvider>
          <Routes><Route path="/tournaments/:id" element={<TournamentDetailPage />} /></Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    const rosterHeading = await screen.findByRole("heading", { name: /Шаг 2 из 3 · Состав/ });
    const rosterSection = rosterHeading.closest("section")!;
    await user.click(within(within(rosterSection).getByRole("group", { name: "Тип участника" })).getByRole("button", { name: "Гость" }));
    await user.click(within(within(rosterSection).getByRole("group", { name: "Вид гостя" })).getByRole("button", { name: "Сохранённый" }));

    const picker = within(rosterSection).getByRole("combobox", { name: "Добавить сохранённого гостя" });
    await waitFor(() => expect(picker).toBeEnabled());
    await user.click(picker);
    await user.click(within(rosterSection).getByRole("option", { name: "Первая Анна · № 000042" }));
    await user.click(within(rosterSection).getByRole("button", { name: "Добавить гостя в состав" }));

    await waitFor(() => expect(addTournamentParticipant).toHaveBeenCalledWith(
      "t1",
      { guestIdentityId: savedGuest.id },
      "00000000-0000-4000-8000-000000040001",
    ));
    expect(addTournamentParticipant).not.toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ guestFirstName: expect.anything() }),
      expect.anything(),
    );
  });
});
