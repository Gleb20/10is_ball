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

  it("keeps creator start available while a voluntary player invitation is pending", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Consent match" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^старт$/i })).toBeEnabled();
    expect(screen.queryByText(/приглашения добровольные/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Приглашения матча" })).not.toBeInTheDocument();

    cleanup();
    getMatch.mockResolvedValue({
      match: waitingMatch({
        invitations: [invitation({ id: "inv-judge", kind: "judge", matchParticipantId: null, participantSide: null, invitedUserId: "u3" })],
      }),
    });
    renderPage();
    expect(await screen.findByRole("button", { name: /^старт$/i })).toBeEnabled();
  });

  it("GAP-029 keeps a pending invitation hidden for its recipient", async () => {
    currentUser = { ...currentUser, id: "u2", email: "rival@example.test", firstName: "Rival", lastName: "Player" };
    renderPage();
    expect(await screen.findByRole("heading", { name: "Consent match" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Принять" })).not.toBeInTheDocument();
    expect(screen.queryByText("Согласования")).not.toBeInTheDocument();
    expect(respondMatchInvitation).not.toHaveBeenCalled();
  });

  it("GAP-029 never offers reinvitation from old declined or accepted rows", async () => {
    const declined = invitation({ status: "declined", respondedAt: "2026-09-13T10:05:00.000Z" });
    const accepted = invitation({ id: "inv-accepted", status: "accepted", createdAt: "2026-09-13T10:10:00.000Z" });
    getMatch.mockResolvedValue({ match: waitingMatch({ invitations: [declined] }) });
    const view = renderPage();
    await screen.findByRole("heading", { name: "Consent match" });
    expect(screen.queryByRole("button", { name: "Пригласить снова" })).not.toBeInTheDocument();

    getMatch.mockResolvedValue({ match: waitingMatch({ invitations: [declined, accepted] }) });
    view.unmount();
    renderPage();
    await screen.findByRole("heading", { name: "Consent match" });
    expect(screen.queryByRole("button", { name: "Пригласить снова" })).not.toBeInTheDocument();
    expect(createMatchInvitation).not.toHaveBeenCalled();
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

  it("edits a nonplaying creator's roster without inserting the creator", async () => {
    const operatorMatch = waitingMatch({
      title: "Operator match",
      participants: [
        { id: "p2", side: "A", userId: "u2", displayName: "Rival Player", avatarKey: null },
        { id: "p3", side: "B", userId: "u3", displayName: "Third Player", avatarKey: null },
      ],
      invitations: [],
    });
    getMatch.mockResolvedValue({ match: operatorMatch });
    updateMatch.mockResolvedValue({ match: { ...operatorMatch, title: "Operator edited" } });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Изменить матч" }));
    const dialog = screen.getByRole("dialog", { name: "Изменить матч" });
    expect(within(dialog).getByText("Создатель управляет матчем, но не занимает игровое место.")).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Игрок A" })).toHaveValue("Rival Player");
    fireEvent.change(within(dialog).getByLabelText("Название"), { target: { value: "Operator edited" } });
    await user.click(within(dialog).getByRole("button", { name: "Сохранить изменения" }));

    expect(updateMatch).toHaveBeenCalledWith("m1", expect.objectContaining({
      participants: [
        { id: "p2", side: "A", userId: "u2" },
        { id: "p3", side: "B", userId: "u3" },
      ],
    }));
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
