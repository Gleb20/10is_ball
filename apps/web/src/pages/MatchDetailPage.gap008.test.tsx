import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MatchDetailPage } from "./MatchDetailPage";

const getMatch = vi.fn();
const matchCreateOptions = vi.fn();
const updateMatch = vi.fn();
const respondMatchInvitation = vi.fn();
const createMatchInvitation = vi.fn();
const startMatch = vi.fn();
let currentUser = {
  id: "u1",
  email: "creator@example.test",
  role: "user",
  mustChangePassword: false,
  firstName: "Creator",
  lastName: "User",
};

vi.mock("../auth", () => ({
  useAuth: () => ({ user: currentUser }),
}));

vi.mock("../api", () => ({
  api: {
    getMatch: (...args: unknown[]) => getMatch(...args),
    matchCreateOptions: (...args: unknown[]) => matchCreateOptions(...args),
    updateMatch: (...args: unknown[]) => updateMatch(...args),
    respondMatchInvitation: (...args: unknown[]) => respondMatchInvitation(...args),
    createMatchInvitation: (...args: unknown[]) => createMatchInvitation(...args),
    startMatch: (...args: unknown[]) => startMatch(...args),
    stopMatch: vi.fn(),
    noShowMatch: vi.fn(),
    cancelMatch: vi.fn(),
    voidMatch: vi.fn(),
    adminForceCloseMatch: vi.fn(),
    adminDeleteMatch: vi.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const participants = [
  { id: "p1", side: "A", userId: "u1", displayName: "Creator User", avatarKey: null },
  { id: "p2", side: "B", userId: "u2", displayName: "Rival Player", avatarKey: null },
];

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-player",
    matchId: "m1",
    matchParticipantId: "p2",
    participantSide: "B",
    invitedUserId: "u2",
    invitedByUserId: "u1",
    kind: "player",
    status: "pending",
    expiresAt: "2026-09-14T10:00:00.000Z",
    respondedAt: null,
    expiryReason: null,
    createdAt: "2026-09-13T10:00:00.000Z",
    ...overrides,
  };
}

function waitingMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    title: "Consent match",
    kind: "standalone",
    status: "waiting",
    version: 0,
    format: "1v1",
    pointsToWin: 11,
    mercyEnabled: true,
    mercyPoints: 5,
    firstServerMethod: "manual",
    scoreA: 0,
    scoreB: 0,
    createdByUserId: "u1",
    participants,
    invitations: [invitation()],
    activeJudge: null,
    eventLog: [],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/matches/m1"]}>
      <Routes><Route path="/matches/:id" element={<MatchDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe("GAP-008 match consent and prestart editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = {
      id: "u1",
      email: "creator@example.test",
      role: "user",
      mustChangePassword: false,
      firstName: "Creator",
      lastName: "User",
    };
    getMatch.mockResolvedValue({ match: waitingMatch() });
    matchCreateOptions.mockResolvedValue({
      users: [
        { id: "u1", firstName: "Creator", lastName: "User" },
        { id: "u2", firstName: "Rival", lastName: "Player" },
        { id: "u3", firstName: "Third", lastName: "Player" },
      ],
      teams: [],
      recentOpponentIds: [],
      frequentOpponentIds: [],
    });
  });

  afterEach(cleanup);

  it("blocks creator start only for a player whose linked consent is still missing", async () => {
    renderPage();

    expect(await screen.findByText("Rival Player")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^старт$/i })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/после согласия.*rival player/i);

    cleanup();
    getMatch.mockResolvedValue({
      match: waitingMatch({
        invitations: [invitation({ id: "inv-judge", kind: "judge", matchParticipantId: null, participantSide: null, invitedUserId: "u3" })],
      }),
    });
    renderPage();
    expect(await screen.findByRole("button", { name: /^старт$/i })).toBeEnabled();
  });

  it("lets the invited user answer once and reloads the persisted invitation state", async () => {
    currentUser = { ...currentUser, id: "u2", email: "rival@example.test", firstName: "Rival", lastName: "Player" };
    const accepted = waitingMatch({ invitations: [invitation({ status: "accepted", respondedAt: "2026-09-13T10:05:00.000Z" })] });
    respondMatchInvitation.mockResolvedValue({ invitation: invitation({ status: "accepted" }) });
    getMatch.mockResolvedValueOnce({ match: waitingMatch() }).mockResolvedValue({ match: accepted });
    const user = userEvent.setup();
    renderPage();

    const accept = await screen.findByRole("button", { name: "Принять" });
    await Promise.all([user.click(accept), user.click(accept)]);

    expect(respondMatchInvitation).toHaveBeenCalledTimes(1);
    expect(respondMatchInvitation).toHaveBeenCalledWith("inv-player", true);
    expect(await screen.findByText("Принято")).toBeInTheDocument();
  });

  it("offers one re-invite for the latest declined consent and never after acceptance", async () => {
    const declined = invitation({ status: "declined", respondedAt: "2026-09-13T10:05:00.000Z" });
    const accepted = invitation({ id: "inv-accepted", status: "accepted", createdAt: "2026-09-13T10:10:00.000Z" });
    getMatch.mockResolvedValue({ match: waitingMatch({ invitations: [declined] }) });
    createMatchInvitation.mockResolvedValue({ invitation: invitation({ id: "inv-retry" }) });
    const user = userEvent.setup();
    const view = renderPage();

    await user.click(await screen.findByRole("button", { name: "Пригласить снова" }));
    expect(createMatchInvitation).toHaveBeenCalledWith("m1", { userId: "u2", kind: "player" });

    getMatch.mockResolvedValue({ match: waitingMatch({ invitations: [declined, accepted] }) });
    view.unmount();
    renderPage();
    await screen.findByText("Принято");
    expect(screen.queryByRole("button", { name: "Пригласить снова" })).not.toBeInTheDocument();
  });

  it("sends the full roster, retains unchanged participant ids, and drops the id for a replacement", async () => {
    const updated = waitingMatch({ title: "Edited match", invitations: [] });
    updateMatch.mockResolvedValue({ match: updated });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Изменить матч" }));
    const dialog = screen.getByRole("dialog", { name: "Изменить матч" });
    fireEvent.change(within(dialog).getByLabelText("Название"), { target: { value: "Edited match" } });
    const opponent = screen.getByRole("combobox", { name: "Соперник" });
    await waitFor(() => expect(matchCreateOptions).toHaveBeenCalled());
    await user.clear(opponent);
    await user.type(opponent, "Third");
    await user.click(await screen.findByText("Third Player"));
    await user.click(screen.getByRole("button", { name: "Сохранить изменения" }));

    expect(updateMatch).toHaveBeenCalledWith("m1", expect.objectContaining({
      title: "Edited match",
      participants: [
        { id: "p1", side: "A", userId: "u1" },
        { side: "B", userId: "u3" },
      ],
    }));
    expect(await screen.findByText("Edited match")).toBeInTheDocument();
  });

  it("keeps the saved match when an older refresh resolves after the mutation", async () => {
    const oldRefresh = deferred<{ match: Record<string, unknown> }>();
    const fresh = waitingMatch({ title: "Saved title", invitations: [] });
    updateMatch.mockResolvedValue({ match: fresh });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Consent match");
    getMatch.mockReturnValueOnce(oldRefresh.promise);
    await user.click(screen.getByRole("button", { name: "Обновить" }));
    await user.click(screen.getByRole("button", { name: "Изменить матч" }));
    const dialog = screen.getByRole("dialog", { name: "Изменить матч" });
    fireEvent.change(within(dialog).getByLabelText("Название"), { target: { value: "Saved title" } });
    await user.click(screen.getByRole("button", { name: "Сохранить изменения" }));
    await waitFor(() => expect(updateMatch).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Saved title")).toBeInTheDocument();

    oldRefresh.resolve({ match: waitingMatch({ title: "Stale title" }) });
    await waitFor(() => expect(screen.queryByText("Stale title")).not.toBeInTheDocument());
    expect(screen.getByText("Saved title")).toBeInTheDocument();
  });

  it("keeps the loaded match and typed draft after a failed save, then allows a retry", async () => {
    updateMatch
      .mockRejectedValueOnce(new Error("Сохранение временно недоступно"))
      .mockResolvedValueOnce({ match: waitingMatch({ title: "Retry title", invitations: [] }) });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Изменить матч" }));
    const dialog = screen.getByRole("dialog", { name: "Изменить матч" });
    fireEvent.change(within(dialog).getByLabelText("Название"), { target: { value: "Retry title" } });
    await user.click(within(dialog).getByRole("button", { name: "Сохранить изменения" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Сохранение временно недоступно");
    expect(within(dialog).getByLabelText("Название")).toHaveValue("Retry title");
    expect(screen.getByRole("heading", { name: "Consent match" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Сохранить изменения" }));
    expect(updateMatch).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("heading", { name: "Retry title" })).toBeInTheDocument();
  });
});
