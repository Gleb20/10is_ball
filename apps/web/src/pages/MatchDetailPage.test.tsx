import { act, fireEvent, render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { MatchDetailPage } from "./MatchDetailPage";
import { AuthProvider, useAuth } from "../auth";

const getMatch = vi.fn();
const me = vi.fn();
const startMatch = vi.fn();
const stopMatch = vi.fn();
const cancelMatch = vi.fn();
const voidMatch = vi.fn();
const adminForceCloseMatch = vi.fn();
const adminDeleteMatch = vi.fn();
const noShowMatch = vi.fn();
const matchCreateOptions = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function ReplayProbe() {
  const location = useLocation();
  return <output data-testid="replay-seed">{JSON.stringify(location.state)}</output>;
}

async function openOtherActions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText("Другие действия"));
  return screen.getByRole("group", { name: "Другие действия с матчем" });
}

function RouteSwitch({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>Открыть другой матч</button>;
}

function AuthControl({ restoreUser }: { restoreUser: Record<string, unknown> }) {
  const { setUser } = useAuth();
  return (
    <>
      <button onClick={() => setUser(null)}>Истечь сессии</button>
      <button onClick={() => setUser(restoreUser as never)}>Восстановить сессию</button>
      <button onClick={() => setUser({
        id: "other-actor",
        email: "other@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "Other",
        lastName: "Actor",
      } as never)}>Сменить пользователя</button>
    </>
  );
}

vi.mock("../api", () => ({
  api: {
    me: (...a: unknown[]) => me(...a),
    getMatch: (...a: unknown[]) => getMatch(...a),
    startMatch: (...a: unknown[]) => startMatch(...a),
    stopMatch: (...a: unknown[]) => stopMatch(...a),
    cancelMatch: (...a: unknown[]) => cancelMatch(...a),
    voidMatch: (...a: unknown[]) => voidMatch(...a),
    adminForceCloseMatch: (...a: unknown[]) => adminForceCloseMatch(...a),
    noShowMatch: (...a: unknown[]) => noShowMatch(...a),
    matchCreateOptions: (...a: unknown[]) => matchCreateOptions(...a),
    adminDeleteMatch: (...a: unknown[]) => adminDeleteMatch(...a),
  },
}));

describe("REQ_ui__admin_match_ops", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    me.mockResolvedValue({
      user: {
        id: "admin1",
        email: "admin@tab10.local",
        role: "admin",
        mustChangePassword: false,
        firstName: "Admin",
        lastName: "User",
      },
    });
    getMatch.mockResolvedValue({
      match: {
        id: "m1",
        title: "Stuck",
        kind: "standalone",
        status: "in_progress",
        version: 0,
        scoreA: 1,
        scoreB: 0,
        createdByUserId: "other",
        participants: [],
        activeJudge: null,
      },
    });
    matchCreateOptions.mockResolvedValue({ users: [] });
  });

  it("BUG-018 keeps the edit-dialog opponent field mounted and focused after choosing another player", async () => {
    const user = userEvent.setup();
    getMatch.mockResolvedValue({ match: {
      id: "m1", title: "Матч", kind: "standalone", status: "waiting", format: "1v1",
      version: 0, scoreA: 0, scoreB: 0, createdByUserId: "admin1",
      participants: [
        { id: "p1", side: "A", userId: "admin1", displayName: "Admin User" },
        { id: "p2", side: "B", userId: "u2", displayName: "Second Player" },
      ], activeJudge: null,
    } });
    matchCreateOptions.mockResolvedValue({ users: [
      { id: "admin1", firstName: "Admin", lastName: "User" },
      { id: "u2", firstName: "Second", lastName: "Player" },
      { id: "u3", firstName: "Third", lastName: "Player" },
    ] });
    render(<MemoryRouter initialEntries={["/matches/m1"]}><AuthProvider><Routes><Route path="/matches/:id" element={<MatchDetailPage />} /></Routes></AuthProvider></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "Изменить матч" }));
    const dialog = screen.getByRole("dialog", { name: "Изменить матч" });
    const input = within(dialog).getByRole("combobox", { name: "Соперник" });
    await waitFor(() => expect(input).toHaveValue("Second Player"));
    await user.clear(input);
    await user.type(input, "Third");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(within(dialog).getByRole("combobox", { name: "Соперник" })).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("Third Player");
  });

  it("BUG-018 preserves a replacement search while edit options finish loading", async () => {
    getMatch.mockResolvedValue({ match: {
      id: "m1", title: "Матч", kind: "standalone", status: "waiting", format: "1v1",
      version: 0, scoreA: 0, scoreB: 0, createdByUserId: "admin1",
      participants: [
        { id: "p1", side: "A", userId: "admin1", displayName: "Admin User" },
        { id: "p2", side: "B", userId: "u2", displayName: "Second Player" },
      ], activeJudge: null,
    } });
    const held = deferred<{ users: Array<{ id: string; firstName: string; lastName: string }> }>();
    matchCreateOptions.mockReturnValueOnce(held.promise);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/matches/m1"]}><AuthProvider><Routes><Route path="/matches/:id" element={<MatchDetailPage />} /></Routes></AuthProvider></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "Изменить матч" }));
    const dialog = screen.getByRole("dialog", { name: "Изменить матч" });
    const input = within(dialog).getByRole("combobox", { name: "Соперник" });
    expect(input).toHaveValue("Second Player");
    await user.clear(input);
    await user.type(input, "Third");
    held.resolve({ users: [
      { id: "u2", firstName: "Second", lastName: "Player" },
      { id: "u3", firstName: "Third", lastName: "Player" },
    ] });
    expect(await within(dialog).findByRole("option", { name: "Third Player" })).toBeVisible();
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveValue("Third");
    await user.keyboard("{Enter}");
    expect(input).toHaveValue("Third Player");
    expect(input).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Очистить" }));
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("BUG-018 resolves an untouched selected label when edit options arrive", async () => {
    getMatch.mockResolvedValue({ match: {
      id: "m1", title: "Матч", kind: "standalone", status: "waiting", format: "1v1",
      version: 0, scoreA: 0, scoreB: 0, createdByUserId: "admin1",
      participants: [
        { id: "p1", side: "A", userId: "admin1", displayName: "Admin User" },
        { id: "p2", side: "B", userId: "u2" },
      ], activeJudge: null,
    } });
    const held = deferred<{ users: Array<{ id: string; firstName: string; lastName: string }> }>();
    matchCreateOptions.mockReturnValueOnce(held.promise);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/matches/m1"]}><AuthProvider><Routes><Route path="/matches/:id" element={<MatchDetailPage />} /></Routes></AuthProvider></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "Изменить матч" }));
    const input = within(screen.getByRole("dialog", { name: "Изменить матч" })).getByRole("combobox", { name: "Соперник" });
    expect(input).toHaveValue("");
    held.resolve({ users: [{ id: "u2", firstName: "Second", lastName: "Player" }] });
    await waitFor(() => expect(input).toHaveValue("Second Player"));
  });

  it("BUG-018 clears a replacement search after edit guest mode resets the slot", async () => {
    getMatch.mockResolvedValue({ match: {
      id: "m1", title: "Матч", kind: "standalone", status: "waiting", format: "1v1",
      version: 0, scoreA: 0, scoreB: 0, createdByUserId: "admin1",
      participants: [
        { id: "p1", side: "A", userId: "admin1", displayName: "Admin User" },
        { id: "p2", side: "B", userId: "u2", displayName: "Second Player" },
      ], activeJudge: null,
    } });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/matches/m1"]}><AuthProvider><Routes><Route path="/matches/:id" element={<MatchDetailPage />} /></Routes></AuthProvider></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "Изменить матч" }));
    const dialog = screen.getByRole("dialog", { name: "Изменить матч" });
    const group = within(dialog).getByRole("group", { name: "Соперник" });
    const input = within(group).getByRole("combobox", { name: "Соперник" });
    await user.clear(input);
    await user.type(input, "Third");
    await user.click(within(group).getByRole("button", { name: "Гость" }));
    await user.click(within(group).getByRole("button", { name: "Игрок" }));
    expect(within(group).getByRole("combobox", { name: "Соперник" })).toHaveValue("");
  });

  it("shows force-close and delete for admin on standalone active match", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/matches/m1"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    const actions = await openOtherActions(user);
    expect(
      within(actions).getByRole("button", { name: /принудительно закрыть/i }),
    ).toBeInTheDocument();
    expect(
      within(actions).getByRole("button", { name: /удалить из истории/i }),
    ).toBeInTheDocument();
  });

  it("hides admin CTAs for non-admin", async () => {
    const user = userEvent.setup();
    me.mockResolvedValue({
      user: {
        id: "u1",
        email: "a@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "A",
        lastName: "User",
      },
    });
    render(
      <MemoryRouter initialEntries={["/matches/m1"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Stuck")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /принудительно закрыть/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /удалить из истории/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Другие действия")).not.toBeInTheDocument();
  });
});

describe("REQ_ui__match_cancel", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["manual", "rally"])(
    "MATCH-008: creator starts a waiting %s match without taking another judge's slot",
    async (firstServerMethod) => {
    const user = userEvent.setup();
    me.mockResolvedValue({
      user: {
        id: "u1",
        email: "creator@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "Creator",
        lastName: "User",
      },
    });
    const waiting = {
      id: "creator-start",
      title: "Creator start",
      kind: "standalone",
      status: "waiting",
      version: 0,
      format: "1v1",
      firstServerMethod,
      scoreA: 0,
      scoreB: 0,
      createdByUserId: "u1",
      participants: [
        { id: "p1", side: "A", userId: "u1", displayName: "Creator User" },
        { id: "p2", side: "B", userId: "u2", displayName: "Rival User" },
      ],
      activeJudge: { userId: "judge", displayName: "Other Judge" },
    };
    getMatch.mockResolvedValue({ match: waiting });
    startMatch.mockResolvedValue({
      match: { ...waiting, status: "in_progress", version: 1, currentServerParticipantId: "p2" },
    });
    render(
      <MemoryRouter initialEntries={["/matches/creator-start"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: /^старт$/i }));
    const dialog = screen.getByRole("dialog", { name: /начать матч/i });
    await user.click(within(dialog).getByRole("radio", { name: /rival user/i }));
    await user.click(within(dialog).getByRole("button", { name: /начать матч/i }));

    expect(startMatch).toHaveBeenCalledWith("creator-start", {
      firstServerParticipantId: "p2",
    });
    expect(await screen.findByText("Идёт")).toBeInTheDocument();
    expect(screen.getAllByText(/other judge/i)).not.toHaveLength(0);
    },
  );

  it("MATCH-008: random start leaves the server choice to the API", async () => {
    me.mockResolvedValue({
      user: {
        id: "u1",
        email: "creator@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "Creator",
        lastName: "User",
      },
    });
    const waiting = {
      id: "random-start",
      title: "Random start",
      kind: "standalone",
      status: "waiting",
      version: 0,
      format: "1v1",
      firstServerMethod: "random",
      scoreA: 0,
      scoreB: 0,
      createdByUserId: "u1",
      participants: [
        { id: "p1", side: "A", userId: "u1", displayName: "Creator User" },
        { id: "p2", side: "B", userId: "u2", displayName: "Rival User" },
      ],
      activeJudge: { userId: "judge", displayName: "Other Judge" },
    };
    getMatch.mockResolvedValue({ match: waiting });
    startMatch.mockResolvedValue({
      match: {
        ...waiting,
        status: "in_progress",
        version: 1,
        currentServerParticipantId: "p1",
      },
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/matches/random-start"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: /^старт$/i }));
    const dialog = screen.getByRole("dialog", { name: /начать матч/i });
    expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /начать матч/i }));

    expect(startMatch).toHaveBeenCalledWith("random-start", {});
    expect(await screen.findByText("Идёт")).toBeInTheDocument();
  });

  it("GAP-005 keeps the start dialog open when cancel is clicked during the request", async () => {
    me.mockResolvedValue({
      user: {
        id: "u1",
        email: "creator@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "Creator",
        lastName: "User",
      },
    });
    const waiting = {
      id: "pending-start",
      title: "Pending start",
      kind: "standalone",
      status: "waiting",
      version: 0,
      format: "1v1",
      firstServerMethod: "manual",
      scoreA: 0,
      scoreB: 0,
      createdByUserId: "u1",
      participants: [
        { id: "p1", side: "A", userId: "u1", displayName: "Creator User" },
        { id: "p2", side: "B", userId: "u2", displayName: "Rival User" },
      ],
      activeJudge: { userId: "judge", displayName: "Other Judge" },
    };
    const pending = deferred<{ match: typeof waiting }>();
    getMatch.mockResolvedValue({ match: waiting });
    startMatch.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/matches/pending-start"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: /^старт$/i }));
    const dialog = screen.getByRole("dialog", { name: /начать матч/i });
    await user.click(within(dialog).getByRole("radio", { name: /rival user/i }));
    await user.click(within(dialog).getByRole("button", { name: /начать матч/i }));
    await screen.findByRole("button", { name: /запускаем/i });
    await user.click(within(dialog).getByRole("button", { name: "Отмена" }));

    expect(screen.getByRole("dialog", { name: /начать матч/i })).toBeInTheDocument();
  });

  it("shows cancel for organizer on waiting standalone match", async () => {
    const user = userEvent.setup();
    me.mockResolvedValue({
      user: {
        id: "u1",
        email: "a@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "A",
        lastName: "User",
      },
    });
    getMatch.mockResolvedValue({
      match: {
        id: "m2",
        title: "Created",
        kind: "standalone",
        status: "waiting",
        version: 0,
        scoreA: 0,
        scoreB: 0,
        createdByUserId: "u1",
        participants: [
          { side: "A", userId: "u1", displayName: "User A" },
          { side: "B", userId: "u2", displayName: "User B" },
        ],
        activeJudge: null,
      },
    });
    render(
      <MemoryRouter initialEntries={["/matches/m2"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByText("Created");
    const actions = await openOtherActions(user);
    expect(within(actions).getByRole("button", { name: /^отменить матч$/i })).toBeInTheDocument();
  });

  it("hides cancel for outsider on waiting match", async () => {
    const user = userEvent.setup();
    me.mockResolvedValue({
      user: {
        id: "outsider",
        email: "x@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "X",
        lastName: "User",
      },
    });
    getMatch.mockResolvedValue({
      match: {
        id: "m3",
        title: "Other",
        kind: "standalone",
        status: "waiting",
        version: 0,
        scoreA: 0,
        scoreB: 0,
        createdByUserId: "u1",
        participants: [
          { side: "A", userId: "u1", displayName: "User A" },
          { side: "B", userId: "u2", displayName: "User B" },
        ],
        activeJudge: null,
      },
    });
    render(
      <MemoryRouter initialEntries={["/matches/m3"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Other")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^отменить матч$/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Другие действия")).not.toBeInTheDocument();
  });

  it("AT-MATCH-CANCEL-004: first click only opens named confirmation", async () => {
    const user = userEvent.setup();
    me.mockResolvedValue({
      user: {
        id: "u1",
        email: "a@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "A",
        lastName: "User",
      },
    });
    getMatch.mockResolvedValue({
      match: {
        id: "m4",
        title: "Личный финал",
        kind: "standalone",
        status: "waiting",
        version: 0,
        scoreA: 0,
        scoreB: 0,
        createdByUserId: "u1",
        participants: [
          { side: "A", userId: "u1", displayName: "User A" },
          { side: "B", userId: "u2", displayName: "User B" },
        ],
        activeJudge: null,
      },
    });
    cancelMatch.mockResolvedValue({
      match: { id: "m4", title: "Личный финал", status: "cancelled", version: 1 },
    });
    render(
      <MemoryRouter initialEntries={["/matches/m4"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await screen.findByText("Личный финал");
    let actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: /^отменить матч$/i }));
    expect(cancelMatch).not.toHaveBeenCalled();
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Личный финал")).toBeInTheDocument();
    expect(within(dialog).getByText(/без победителя и влияния на статистику/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /^не отменять$/i }));
    expect(cancelMatch).not.toHaveBeenCalled();

    actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: /^отменить матч$/i }));
    dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^отменить матч$/i }));
    expect(cancelMatch).toHaveBeenCalledWith("m4", 0, expect.any(String), undefined);
  });

  it("AT-MATCH-START-001/STOP-002: participant sees no start, stop, or cancel action", async () => {
    const user = userEvent.setup();
    me.mockResolvedValue({
      user: {
        id: "u2",
        email: "b@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "B",
        lastName: "User",
      },
    });
    getMatch.mockResolvedValue({
      match: {
        id: "m5",
        title: "Owned elsewhere",
        kind: "standalone",
        status: "in_progress",
        version: 0,
        scoreA: 0,
        scoreB: 0,
        createdByUserId: "u1",
        participants: [
          { side: "A", userId: "u1", displayName: "User A" },
          { side: "B", userId: "u2", displayName: "User B" },
        ],
        activeJudge: null,
      },
    });
    render(
      <MemoryRouter initialEntries={["/matches/m5"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Owned elsewhere")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^старт$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /остановить матч/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^отменить матч$/i })).not.toBeInTheDocument();
  });

  it("AT-MATCH-STOP-001: current active judge sees stop but not cancel", async () => {
    const user = userEvent.setup();
    me.mockResolvedValue({
      user: {
        id: "judge",
        email: "judge@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "J",
        lastName: "User",
      },
    });
    getMatch.mockResolvedValue({
      match: {
        id: "m6",
        title: "Judged match",
        kind: "standalone",
        status: "in_progress",
        version: 0,
        scoreA: 0,
        scoreB: 0,
        createdByUserId: "u1",
        participants: [
          { side: "A", userId: "u1", displayName: "User A" },
          { side: "B", userId: "u2", displayName: "User B" },
        ],
        activeJudge: { userId: "judge", displayName: "Judge User" },
      },
    });
    render(
      <MemoryRouter initialEntries={["/matches/m6"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await screen.findByText("Judged match");
    const actions = await openOtherActions(user);
    expect(within(actions).getByRole("button", { name: /остановить матч/i })).toBeInTheDocument();
    expect(
      within(actions).queryByRole("button", { name: /^отменить матч$/i }),
    ).not.toBeInTheDocument();
  });
});

describe("AT-MATCH-VOID-003 confirmation", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    me.mockResolvedValue({
      user: {
        id: "creator",
        email: "creator@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "Creator",
        lastName: "User",
      },
    });
    getMatch.mockResolvedValue({
      match: {
        id: "void-me",
        title: "Ошибочный финал",
        kind: "standalone",
        status: "finished",
        version: 7,
        scoreA: 11,
        scoreB: 9,
        createdByUserId: "creator",
        participants: [],
        activeJudge: null,
      },
    });
    voidMatch.mockResolvedValue({
      match: {
        id: "void-me",
        title: "Ошибочный финал",
        kind: "standalone",
        status: "voided",
        version: 8,
        scoreA: 11,
        scoreB: 9,
        createdByUserId: "creator",
        participants: [],
        activeJudge: null,
      },
    });
  });

  it("requires a separate confirmation that names soft invalidation and stats impact", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/matches/void-me"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await screen.findByText("Ошибочный финал");
    let actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: /аннулировать результат/i }));
    expect(voidMatch).not.toHaveBeenCalled();
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/ошибочный финал/i)).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/исходный результат.*сохранится/i);
    expect(dialog).toHaveTextContent(/рейтинг.*компенсирован/i);
    fireEvent.change(within(dialog).getByRole("textbox", { name: /причина/i }), {
      target: { value: "Ошибочный победитель" },
    });

    await user.click(within(dialog).getByRole("button", { name: /^отмена$/i }));
    expect(voidMatch).not.toHaveBeenCalled();

    actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: /аннулировать результат/i }));
    dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /подтвердить аннулирование/i }));
    expect(voidMatch).toHaveBeenCalledWith(
      "void-me",
      7,
      expect.any(String),
      "Ошибочный победитель",
    );
    expect(await screen.findByText("Аннулирован")).toBeInTheDocument();
  });

  it("warns the tournament creator that the rest of the bracket is preserved", async () => {
    const user = userEvent.setup();
    getMatch.mockResolvedValue({
      match: {
        id: "tournament-result",
        title: "Турнирный финал",
        kind: "tournament",
        status: "finished",
        version: 4,
        scoreA: 11,
        scoreB: 8,
        createdByUserId: "creator",
        participants: [],
        activeJudge: null,
      },
    });
    voidMatch.mockResolvedValue({
      match: {
        id: "tournament-result",
        title: "Турнирный финал",
        kind: "tournament",
        status: "voided",
        version: 5,
        scoreA: 11,
        scoreB: 8,
        createdByUserId: "creator",
        participants: [],
        activeJudge: null,
      },
    });
    render(
      <MemoryRouter initialEntries={["/matches/tournament-result"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await screen.findByText("Турнирный финал");
    const actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: /аннулировать результат/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/остальная турнирная сетка сохранится/i);
    expect(dialog).toHaveTextContent(
      /следующие матчи и уведомления не будут пересчитаны/i,
    );
  });

  it("hides void for a tournament participant who is not its creator", async () => {
    me.mockResolvedValue({
      user: {
        id: "participant",
        email: "participant@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "Participant",
        lastName: "User",
      },
    });
    getMatch.mockResolvedValue({
      match: {
        id: "tournament-result",
        title: "Турнирный финал",
        kind: "tournament",
        status: "finished",
        version: 4,
        scoreA: 11,
        scoreB: 8,
        createdByUserId: "organizer",
        participants: [{ side: "A", userId: "participant" }],
        activeJudge: null,
      },
    });
    render(
      <MemoryRouter initialEntries={["/matches/tournament-result"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Турнирный финал")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /аннулировать результат/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Другие действия")).not.toBeInTheDocument();
  });
});

describe("BUG-006/BUG-009 match action failures", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    me.mockResolvedValue({
      user: {
        id: "creator",
        email: "creator@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "Creator",
        lastName: "User",
      },
    });
    getMatch.mockResolvedValue({
      match: {
        id: "action-error",
        title: "Матч остаётся видимым",
        kind: "standalone",
        status: "in_progress",
        version: 3,
        scoreA: 4,
        scoreB: 2,
        createdByUserId: "creator",
        participants: [
          { side: "A", userId: "creator", displayName: "Creator User" },
          { side: "B", userId: "rival", displayName: "Rival User" },
        ],
        activeJudge: null,
      },
    });
  });

  it("keeps loaded match context and action-local error while blocking duplicate stop", async () => {
    let rejectStop!: (reason: Error) => void;
    stopMatch.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectStop = reject;
        }),
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/matches/action-error"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Матч остаётся видимым")).toBeInTheDocument();
    const actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: /остановить матч/i }));
    const submit = screen.getByRole("button", {
      name: /подтвердить остановку/i,
    });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(stopMatch).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();
    rejectStop(new Error("Недостаточно прав"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Недостаточно прав",
    );
    expect(screen.getByText("Матч остаётся видимым")).toBeInTheDocument();
    expect(screen.getByLabelText("Счёт стороны A: 4")).toBeInTheDocument();
    expect(screen.getByLabelText("Счёт стороны B: 2")).toBeInTheDocument();
    await waitFor(() => expect(submit).not.toBeDisabled());
  });
});

describe("GAP-005 match detail completion", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    me.mockResolvedValue({
      user: {
        id: "creator",
        email: "creator@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "Creator",
        lastName: "User",
      },
    });
  });

  it("shows rules and clean effective point log without a revenge action", async () => {
    getMatch.mockResolvedValue({
      match: {
        id: "complete",
        title: "Парный финал",
        kind: "standalone",
        status: "finished",
        version: 8,
        format: "2v2",
        pointsToWin: 15,
        mercyEnabled: true,
        mercyPoints: 7,
        firstServerMethod: "rally",
        scoreA: 2,
        scoreB: 1,
        createdByUserId: "creator",
        participants: [
          { side: "A", userId: "creator", displayName: "Creator User" },
          { side: "A", displayName: "Partner One" },
          { side: "B", displayName: "Rival One" },
          { side: "B", displayName: "Rival Two" },
        ],
        eventLog: [
          { type: "point_awarded", side: "A" },
          { type: "manual_correction" },
          { type: "point_awarded", side: "B" },
          { type: "point_undone", undonePoint: { type: "point_awarded", side: "A" } },
          { type: "point_awarded", side: "A" },
        ],
        activeJudge: null,
      },
    });
    render(
      <MemoryRouter initialEntries={["/matches/complete"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("2 × 2")).toBeInTheDocument();
    expect(screen.getByText("до 15 очков")).toBeInTheDocument();
    const log = screen.getByRole("list", { name: "Журнал изменений счёта" });
    expect(within(log).getAllByRole("listitem")).toHaveLength(5);
    expect(within(log).getAllByText("+1 · Creator User + Partner One")).toHaveLength(2);
    expect(within(log).getByText("Коррекция счёта")).toBeInTheDocument();
    expect(within(log).getByText("+1 · Rival One + Rival Two")).toBeInTheDocument();
    expect(within(log).getByText("Отменено: +1 · Creator User + Partner One")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /создать реванш/i })).not.toBeInTheDocument();
  });

  it("records no-show with expected version and preserves the returned score", async () => {
    getMatch.mockResolvedValue({
      match: {
        id: "no-show",
        title: "Матч с неявкой",
        kind: "standalone",
        status: "waiting",
        version: 3,
        format: "1v1",
        pointsToWin: 11,
        mercyEnabled: true,
        mercyPoints: 5,
        firstServerMethod: "manual",
        scoreA: 0,
        scoreB: 0,
        createdByUserId: "creator",
        participants: [
          { side: "A", userId: "creator", displayName: "Creator User" },
          { side: "B", displayName: "Absent Rival" },
        ],
        eventLog: [],
        activeJudge: null,
      },
    });
    noShowMatch.mockResolvedValue({
      match: {
        ...(await getMatch()).match,
        status: "stopped",
        version: 4,
        winnerSide: "A",
        finishReason: "no_show",
        stopReasonText: "Не вышел к столу",
      },
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/matches/no-show"]}>
        <AuthProvider>
          <Routes><Route path="/matches/:id" element={<MatchDetailPage />} /></Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByText("Матч с неявкой");
    const actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: /зафиксировать неявку/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/комментарий/i), {
      target: { value: "Не вышел к столу" },
    });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /завершить по неявке/i }));

    expect(noShowMatch).toHaveBeenCalledWith("no-show", {
      expectedVersion: 3,
      absentSide: "B",
      reasonText: "Не вышел к столу",
    }, expect.any(String));
    expect(await screen.findByLabelText("Счёт стороны A: 0")).toBeInTheDocument();
    expect(screen.getByLabelText("Счёт стороны B: 0")).toBeInTheDocument();
    expect(screen.getByText(/счёт сохранён без вымышленных очков/i)).toBeInTheDocument();
  });
});

describe("Stage 6 W4 bounded MatchDetail UI", () => {
  afterEach(() => cleanup());

  const actor = {
    id: "viewer",
    email: "viewer@tab10.local",
    role: "user",
    mustChangePassword: false,
    firstName: "Viewer",
    lastName: "User",
  };

  const baseMatch = {
    id: "w4",
    title: "Матч W4",
    kind: "standalone",
    status: "finished",
    version: 8,
    format: "2v2",
    pointsToWin: 15,
    mercyEnabled: true,
    mercyPoints: 7,
    firstServerMethod: "manual",
    scoreA: 12,
    scoreB: 15,
    winnerSide: "B",
    createdByUserId: "creator",
    participants: [
      { id: "a1", side: "A", guestFirstName: "Очень", guestLastName: "длинное имя первого игрока", displayName: "Очень длинное имя первого игрока" },
      { id: "a2", side: "A", guestFirstName: "Партнёр", guestLastName: "первого игрока", displayName: "Партнёр первого игрока" },
      { id: "b1", side: "B", guestFirstName: "Соперник", guestLastName: "с длинным именем", displayName: "Соперник с длинным именем" },
      { id: "b2", side: "B", guestFirstName: "Ещё", guestLastName: "один соперник", displayName: "Ещё один соперник" },
    ],
    eventLog: [],
    activeJudge: null,
  };

  function renderW4(
    match: Record<string, unknown>,
    initialEntry = "/matches/w4",
    renderActor = actor,
  ) {
    me.mockResolvedValue({ user: renderActor });
    getMatch.mockResolvedValue({ match });
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
            <Route path="/matches/new" element={<ReplayProbe />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  function renderLifecycleW4(
    renderActor: Record<string, unknown>,
    initialEntry = "/matches/w4",
  ) {
    me.mockResolvedValue({ user: renderActor });
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <AuthProvider>
          <AuthControl restoreUser={renderActor} />
          <RouteSwitch to="/matches/w5" />
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
            <Route path="/history" element={<div>История матчей</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("U01-DETAIL-002 binds long 2v2 names to each score and keeps status and rules read-only", async () => {
    renderW4(baseMatch);

    const sideA = await screen.findByRole("group", { name: "Сторона A" });
    expect(sideA).toHaveTextContent("Очень длинное имя первого игрока");
    expect(sideA).toHaveTextContent("Партнёр первого игрока");
    expect(within(sideA).getByText("12")).toHaveAccessibleName(/счёт стороны a/i);
    const sideB = screen.getByRole("group", { name: "Сторона B, победитель" });
    expect(sideB).toHaveTextContent("Соперник с длинным именем");
    expect(within(sideB).getByText("15")).toHaveAccessibleName(/счёт стороны b/i);

    const status = screen.getByText("Завершён");
    expect(status.closest("button, a")).toBeNull();
    const rules = screen.getByRole("group", { name: "Правила матча" });
    expect(rules).toHaveTextContent("2 × 2");
    expect(within(rules).queryByRole("button")).not.toBeInTheDocument();
    expect(within(rules).queryByRole("combobox")).not.toBeInTheDocument();
  });

  it.each([
    ["waiting", "creator", null, "Старт"],
    ["waiting", "viewer", null, "Судить"],
    ["in_progress", "viewer", null, "Судить"],
    ["pending_confirmation", "viewer", { userId: "other", displayName: "Other Judge" }, "Открыть счёт"],
    ["finished", "viewer", null, "Сыграть снова"],
    ["stopped", "viewer", null, "Сыграть снова"],
    ["cancelled", "viewer", null, "Новый матч"],
    ["voided", "viewer", null, "Новый матч"],
  ])("GAP-017 gives %s/%s one primary action", async (status, userId, activeJudge, expected) => {
    me.mockResolvedValue({ user: { ...actor, id: userId } });
    getMatch.mockResolvedValue({ match: {
      ...baseMatch,
      status,
      createdByUserId: "creator",
      activeJudge,
    } });
    render(
      <MemoryRouter initialEntries={["/matches/w4"]}>
        <AuthProvider><Routes><Route path="/matches/:id" element={<MatchDetailPage />} /></Routes></AuthProvider>
      </MemoryRouter>,
    );

    const primary = await screen.findByRole("group", { name: "Основное действие" });
    expect(within(primary).getAllByRole("button")).toHaveLength(1);
    expect(within(primary).getByRole("button", { name: expected })).toBeInTheDocument();
  });

  it("keeps judge and read-only entry points discoverable while rare mutations stay contextual", async () => {
    renderW4({ ...baseMatch, status: "in_progress", activeJudge: null });

    expect(await screen.findByRole("button", { name: "Судить" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Открыть счёт" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Остановить матч" })).not.toBeInTheDocument();
    expect(screen.queryByText("Другие действия")).not.toBeInTheDocument();
  });

  it("U01-JUDGE-006 renders +1, correction and embedded Undo chronologically without a timestamp", async () => {
    renderW4({
      ...baseMatch,
      eventLog: [
        { type: "point_awarded", side: "A" },
        { type: "manual_correction", from: { scoreA: 1, scoreB: 0 }, to: { scoreA: 4, scoreB: 4 } },
        { type: "point_awarded", side: "B" },
        { type: "point_undone", undonePoint: { type: "point_awarded", side: "A" } },
      ],
    });

    const log = await screen.findByRole("list", { name: "Журнал изменений счёта" });
    const items = within(log).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent(/^\+1 · Очень длинное имя первого игрока/);
    expect(items[1]).toHaveTextContent("Коррекция счёта: 1:0 → 4:4");
    expect(items[2]).toHaveTextContent(/^\+1 · Соперник с длинным именем/);
    expect(items[3]).toHaveTextContent(/^Отменено: \+1 · Очень длинное имя первого игрока/);
    expect(log).not.toHaveTextContent(/\d{1,2}:\d{2}/);
  });

  it("BUG-030 freezes trimmed cancel payload and preserves the dialog and reason after a known refusal", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ match: Record<string, unknown> }>();
    cancelMatch.mockReturnValueOnce(pending.promise);
    renderW4(
      { ...baseMatch, status: "waiting", version: 3 },
      "/matches/w4",
      { ...actor, id: "creator" },
    );

    const actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: "Отменить матч" }));
    const dialog = screen.getByRole("dialog", { name: "Отменить матч?" });
    const reason = within(dialog).getByRole("textbox", { name: "Причина (необязательно)" });
    await user.type(reason, "  Перенос игры  ");
    await user.click(within(dialog).getByRole("button", { name: "Отменить матч" }));

    expect(cancelMatch).toHaveBeenCalledWith("w4", 3, expect.any(String), "Перенос игры");
    expect(reason).toBeDisabled();
    pending.reject(Object.assign(new Error("Версия матча изменилась"), { status: 409 }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Версия матча изменилась");
    expect(reason).toHaveValue("  Перенос игры  ");
    expect(cancelMatch).toHaveBeenCalledTimes(1);
  });

  it("keeps an unknown cancel outcome honest and never retries it automatically", async () => {
    const user = userEvent.setup();
    cancelMatch.mockRejectedValueOnce(new Error("Failed to fetch"));
    renderW4(
      { ...baseMatch, status: "waiting" },
      "/matches/w4",
      { ...actor, id: "creator" },
    );

    const actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: "Отменить матч" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Отменить матч" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/не удалось проверить, был ли матч отменён/i);
    expect(screen.getByRole("dialog", { name: "Отменить матч?" })).toBeInTheDocument();
    expect(cancelMatch).toHaveBeenCalledTimes(1);
  });

  it("does not apply a late cancel failure to the next route generation", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ match: Record<string, unknown> }>();
    me.mockResolvedValue({ user: { ...actor, id: "creator" } });
    getMatch.mockImplementation((matchId: string) => Promise.resolve({ match: {
      ...baseMatch,
      id: matchId,
      title: matchId === "w4" ? "Первый матч" : "Второй матч",
      status: "waiting",
      createdByUserId: "creator",
    } }));
    cancelMatch.mockReturnValueOnce(pending.promise);
    render(
      <MemoryRouter initialEntries={["/matches/w4"]}>
        <AuthProvider>
          <RouteSwitch to="/matches/w5" />
          <Routes><Route path="/matches/:id" element={<MatchDetailPage />} /></Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await screen.findByText("Первый матч");
    const actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: "Отменить матч" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Отменить матч" }));
    await user.click(screen.getByRole("button", { name: "Открыть другой матч" }));
    expect(await screen.findByText("Второй матч")).toBeInTheDocument();

    pending.reject(Object.assign(new Error("Старый отказ"), { status: 409 }));
    await waitFor(() => expect(screen.queryByText("Старый отказ")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog", { name: "Отменить матч?" })).not.toBeInTheDocument();
  });

  it("keeps the next route start dialog and pending state independent from a late start success", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ match: Record<string, unknown> }>();
    const creator = { ...actor, id: "creator" };
    getMatch.mockImplementation((matchId: string) => Promise.resolve({ match: {
      ...baseMatch,
      id: matchId,
      title: matchId === "w4" ? "Старый старт" : "Новый старт",
      status: "waiting",
      firstServerMethod: "random",
      createdByUserId: "creator",
    } }));
    startMatch.mockReturnValueOnce(pending.promise);
    renderLifecycleW4(creator);

    await user.click(await screen.findByRole("button", { name: "Старт" }));
    await user.click(within(screen.getByRole("dialog", { name: "Начать матч?" })).getByRole("button", { name: "Начать матч" }));
    await user.click(screen.getByRole("button", { name: "Открыть другой матч" }));
    expect(await screen.findByText("Новый старт")).toBeInTheDocument();
    const nextStart = screen.getByRole("button", { name: "Старт" });
    expect(nextStart).toBeEnabled();
    await user.click(nextStart);

    pending.resolve({ match: { ...baseMatch, id: "w4", title: "Старый ответ", status: "in_progress" } });
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Начать матч?" })).toBeInTheDocument());
    expect(screen.getByText("Новый старт")).toBeInTheDocument();
  });

  it("ignores a late stop failure after the authenticated actor changes", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ match: Record<string, unknown> }>();
    const creator = { ...actor, id: "creator" };
    getMatch
      .mockResolvedValueOnce({ match: { ...baseMatch, title: "Старый актор", status: "in_progress", createdByUserId: "creator" } })
      .mockResolvedValue({ match: { ...baseMatch, title: "Новый актор", status: "in_progress", createdByUserId: "creator" } });
    stopMatch.mockReturnValueOnce(pending.promise);
    renderLifecycleW4(creator);

    expect(await screen.findByText("Старый актор")).toBeInTheDocument();
    const actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: "Остановить матч" }));
    await user.click(screen.getByRole("button", { name: "Подтвердить остановку" }));
    await user.click(screen.getByRole("button", { name: "Сменить пользователя" }));

    expect(await screen.findByText("Новый актор")).toBeInTheDocument();
    pending.reject(new Error("Старый отказ остановки"));
    await waitFor(() => expect(screen.queryByText("Старый отказ остановки")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Судить" })).toBeEnabled();
  });

  it("keeps a restored same-user session independent from a late no-show success", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ match: Record<string, unknown> }>();
    const creator = { ...actor, id: "creator" };
    getMatch
      .mockResolvedValueOnce({ match: { ...baseMatch, title: "До входа", status: "in_progress", createdByUserId: "creator" } })
      .mockResolvedValue({ match: { ...baseMatch, title: "После нового входа", status: "in_progress", createdByUserId: "creator" } });
    noShowMatch.mockReturnValueOnce(pending.promise);
    renderLifecycleW4(creator);

    expect(await screen.findByText("До входа")).toBeInTheDocument();
    let actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: "Зафиксировать неявку" }));
    await user.click(within(screen.getByRole("dialog", { name: "Зафиксировать неявку?" })).getByRole("button", { name: "Завершить по неявке" }));
    await user.click(screen.getByRole("button", { name: "Истечь сессии" }));
    await user.click(screen.getByRole("button", { name: "Восстановить сессию" }));

    expect(await screen.findByText("После нового входа")).toBeInTheDocument();
    actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: "Зафиксировать неявку" }));
    pending.resolve({ match: { ...baseMatch, title: "Старый ответ", status: "stopped" } });
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Зафиксировать неявку?" })).toBeInTheDocument());
    expect(screen.getByText("После нового входа")).toBeInTheDocument();
  });

  it("keeps the next route void dialog open after a late void failure", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ match: Record<string, unknown> }>();
    const creator = { ...actor, id: "creator" };
    getMatch.mockImplementation((matchId: string) => Promise.resolve({ match: {
      ...baseMatch,
      id: matchId,
      title: matchId === "w4" ? "Старое аннулирование" : "Новое аннулирование",
      status: "finished",
      createdByUserId: "creator",
    } }));
    voidMatch.mockReturnValueOnce(pending.promise);
    renderLifecycleW4(creator);

    let actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: "Аннулировать результат" }));
    await user.click(within(screen.getByRole("dialog", { name: "Аннулировать результат?" })).getByRole("button", { name: "Подтвердить аннулирование" }));
    await user.click(screen.getByRole("button", { name: "Открыть другой матч" }));
    expect(await screen.findByText("Новое аннулирование")).toBeInTheDocument();
    actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: "Аннулировать результат" }));

    pending.reject(new Error("Старый отказ аннулирования"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Аннулировать результат?" })).toBeInTheDocument());
    expect(screen.queryByText("Старый отказ аннулирования")).not.toBeInTheDocument();
  });

  it("does not apply a late admin force-close success after an actor switch", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ match: Record<string, unknown> }>();
    const admin = { ...actor, id: "admin", role: "admin" };
    getMatch
      .mockResolvedValueOnce({ match: { ...baseMatch, title: "Администратор", kind: "standalone", status: "in_progress", createdByUserId: "creator" } })
      .mockResolvedValue({ match: { ...baseMatch, title: "Обычный пользователь", kind: "standalone", status: "in_progress", createdByUserId: "creator" } });
    adminForceCloseMatch.mockReturnValueOnce(pending.promise);
    renderLifecycleW4(admin);

    expect(await screen.findByText("Администратор")).toBeInTheDocument();
    const actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: "Принудительно закрыть" }));
    const closeButtons = within(screen.getByRole("dialog", { name: "Принудительно закрыть матч?" })).getAllByRole("button", { name: "Закрыть" });
    await user.click(closeButtons[closeButtons.length - 1]!);
    await user.click(screen.getByRole("button", { name: "Сменить пользователя" }));
    expect(await screen.findByText("Обычный пользователь")).toBeInTheDocument();

    pending.resolve({ match: { ...baseMatch, title: "Старый ответ администратора", status: "cancelled" } });
    await waitFor(() => expect(screen.queryByText("Старый ответ администратора")).not.toBeInTheDocument());
    expect(screen.getByText("Обычный пользователь")).toBeInTheDocument();
  });

  it("does not navigate to history when an old admin delete resolves on another route", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ ok: boolean }>();
    const admin = { ...actor, id: "admin", role: "admin" };
    getMatch.mockImplementation((matchId: string) => Promise.resolve({ match: {
      ...baseMatch,
      id: matchId,
      title: matchId === "w4" ? "Удаляемый матч" : "Текущий матч",
      kind: "standalone",
      status: "waiting",
      createdByUserId: "creator",
    } }));
    adminDeleteMatch.mockReturnValueOnce(pending.promise);
    renderLifecycleW4(admin);

    let actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: "Удалить из истории" }));
    await user.click(within(screen.getByRole("dialog", { name: "Удалить матч из истории?" })).getByRole("button", { name: "Удалить" }));
    await user.click(screen.getByRole("button", { name: "Открыть другой матч" }));
    expect(await screen.findByText("Текущий матч")).toBeInTheDocument();

    pending.resolve({ ok: true });
    await waitFor(() => expect(screen.queryByText("История матчей")).not.toBeInTheDocument());
    expect(screen.getByText("Текущий матч")).toBeInTheDocument();
  });

  it("keeps a restored same-user cancel dialog free from the previous session failure", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ match: Record<string, unknown> }>();
    const creator = { ...actor, id: "creator" };
    getMatch
      .mockResolvedValueOnce({ match: { ...baseMatch, title: "Старая сессия", status: "waiting", createdByUserId: "creator" } })
      .mockResolvedValue({ match: { ...baseMatch, title: "Новая сессия", status: "waiting", createdByUserId: "creator" } });
    cancelMatch.mockReturnValueOnce(pending.promise);
    renderLifecycleW4(creator);

    expect(await screen.findByText("Старая сессия")).toBeInTheDocument();
    let actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: "Отменить матч" }));
    await user.click(within(screen.getByRole("dialog", { name: "Отменить матч?" })).getByRole("button", { name: "Отменить матч" }));
    await user.click(screen.getByRole("button", { name: "Истечь сессии" }));
    await user.click(screen.getByRole("button", { name: "Восстановить сессию" }));
    expect(await screen.findByText("Новая сессия")).toBeInTheDocument();
    actions = await openOtherActions(user);
    await user.click(within(actions).getByRole("button", { name: "Отменить матч" }));

    pending.reject(Object.assign(new Error("Старый конфликт"), { status: 409 }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Отменить матч?" })).toBeInTheDocument());
    expect(screen.queryByText("Старый конфликт")).not.toBeInTheDocument();
  });

  it("GAP-017 opens an editable one-use roster and rules copy from an ordinary result", async () => {
    const user = userEvent.setup();
    renderW4(baseMatch);
    await user.click(await screen.findByRole("button", { name: "Сыграть снова" }));
    const seed = await screen.findByTestId("replay-seed");
    expect(seed).toHaveTextContent('"title":"Матч W4"');
    expect(seed).toHaveTextContent('"format":"2v2"');
    expect(seed).toHaveTextContent('"guestName":"Очень длинное имя первого игрока"');
    expect(seed).not.toHaveTextContent("invitation");
  });

  it("GAP-017 never offers replay for a tournament result", async () => {
    const user = userEvent.setup();
    renderW4({ ...baseMatch, kind: "tournament", tournamentId: "tournament-1" });

    expect(await screen.findByRole("button", { name: "Новый матч" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Сыграть снова" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Новый матч" }));
    expect(await screen.findByTestId("replay-seed")).toHaveTextContent("null");
  });
});

describe("GAP-032 match facts detail UI", () => {
  const actor = {
    id: "33333333-3333-4333-8333-333333333333",
    email: "judge@tab10.local",
    role: "user",
    mustChangePassword: false,
    firstName: "Судья",
    lastName: "Тест",
  };
  const detail = {
    id: "facts-match",
    title: "Матч с фактами",
    kind: "standalone",
    status: "finished",
    version: 9,
    format: "1v1",
    pointsToWin: 11,
    mercyEnabled: false,
    firstServerMethod: "random",
    scoreA: 11,
    scoreB: 8,
    createdByUserId: actor.id,
    participants: [
      { id: "11111111-1111-4111-8111-111111111111", side: "A", userId: actor.id, displayName: "Анна" },
      { id: "44444444-4444-4444-8444-444444444444", side: "B", displayName: "Борис" },
    ],
    activeJudge: null,
    eventLog: [
      {
        type: "point_awarded",
        side: "A",
        occurredAt: "2026-10-03T09:01:02.000Z",
        actorUserId: actor.id,
        judgeSessionId: "22222222-2222-4222-8222-222222222222",
      },
      { type: "point_awarded", side: "B" },
    ],
    matchFacts: {
      initialServer: { state: "known", participantId: "11111111-1111-4111-8111-111111111111" },
      playingClock: {
        state: "available",
        elapsedMs: 185_000,
        running: false,
        asOf: "2026-10-03T09:05:00.000Z",
      },
      judgeHistory: {
        state: "complete",
        sessions: [{
          id: "22222222-2222-4222-8222-222222222222",
          userId: actor.id,
          displayName: "Тест Судья",
          startedAt: "2026-10-03T08:55:00.000Z",
          endedAt: "2026-10-03T09:05:00.000Z",
        }],
      },
    },
  };

  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    me.mockResolvedValue({ user: actor });
    getMatch.mockResolvedValue({ match: detail });
  });

  function renderFacts() {
    return render(
      <MemoryRouter initialEntries={["/matches/facts-match"]}>
        <AuthProvider>
          <Routes><Route path="/matches/:id" element={<MatchDetailPage />} /></Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  it("shows the immutable first server, authoritative playing time, exact session history and event provenance", async () => {
    renderFacts();
    const facts = await screen.findByRole("group", { name: "Факты матча" });
    expect(within(facts).getByText("Анна")).toBeInTheDocument();
    expect(within(facts).getByText("3:05")).toHaveAttribute("aria-live", "off");
    expect(screen.getByText("случайно")).toBeInTheDocument();

    const history = screen.getByRole("region", { name: "История судейства" });
    expect(within(history).getByText("Тест Судья")).toBeInTheDocument();
    expect(within(history).getAllByRole("time")).toHaveLength(2);

    const entries = within(screen.getByRole("list", { name: "Журнал изменений счёта" }))
      .getAllByRole("listitem");
    expect(entries[0]).toHaveTextContent("Тест Судья");
    expect(within(entries[0]!).getByRole("time")).toHaveAttribute(
      "datetime",
      "2026-10-03T09:01:02.000Z",
    );
    expect(entries[1]).toHaveTextContent("Время недоступно");
    expect(entries[1]).toHaveTextContent("Судейская сессия недоступна");
    expect(document.body).not.toHaveTextContent("22222222-2222-4222-8222-222222222222");
  });

  it("renders explicit unavailable states without legacy guesses", async () => {
    getMatch.mockResolvedValue({ match: {
      ...detail,
      eventLog: [],
      matchFacts: {
        initialServer: { state: "not_selected" },
        playingClock: { state: "unavailable" },
        judgeHistory: { state: "unavailable", sessions: [] },
      },
    } });
    renderFacts();

    const facts = await screen.findByRole("group", { name: "Факты матча" });
    expect(within(facts).getByText("Ещё не выбран")).toBeInTheDocument();
    expect(within(facts).getByText("Недоступно")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "История судейства" }))
      .toHaveTextContent("История судейства недоступна");
  });

  it("distinguishes a partial history from a confirmed complete-empty history", async () => {
    getMatch.mockResolvedValueOnce({ match: {
      ...detail,
      matchFacts: {
        ...detail.matchFacts,
        judgeHistory: { state: "partial", sessions: detail.matchFacts.judgeHistory.sessions },
      },
    } });
    const view = renderFacts();
    expect(await screen.findByText("История может быть неполной")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "История судейства" })).toHaveTextContent("Тест Судья");

    view.unmount();
    getMatch.mockResolvedValueOnce({ match: {
      ...detail,
      matchFacts: {
        ...detail.matchFacts,
        judgeHistory: { state: "complete", sessions: [] },
      },
    } });
    renderFacts();
    expect(await screen.findByRole("region", { name: "История судейства" }))
      .toHaveTextContent("Подтверждённых судейских сессий пока нет");
  });

  it("ignores a detail read started before a newer mutation", async () => {
    const user = userEvent.setup();
    const waiting = {
      ...detail,
      status: "waiting",
      version: 9,
      scoreA: 0,
      scoreB: 0,
      activeJudge: { userId: "other-judge", displayName: "Другой судья" },
    };
    const started = {
      ...waiting,
      status: "in_progress",
      version: 10,
      currentServerParticipantId: waiting.participants[0].id,
    };
    const staleRead = deferred<{ match: typeof waiting }>();
    getMatch
      .mockResolvedValueOnce({ match: waiting })
      .mockReturnValueOnce(staleRead.promise)
      .mockResolvedValueOnce({ match: started });
    startMatch.mockResolvedValueOnce({ match: started });
    renderFacts();

    await screen.findByText("Ожидание");
    await user.click(screen.getByRole("button", { name: "Обновить" }));
    await waitFor(() => expect(getMatch).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: /^старт$/i }));
    await user.click(within(screen.getByRole("dialog", { name: "Начать матч?" }))
      .getByRole("button", { name: "Начать матч" }));

    expect(await screen.findByText("Идёт")).toBeInTheDocument();
    await waitFor(() => expect(getMatch).toHaveBeenCalledTimes(3));
    await act(async () => {
      staleRead.resolve({ match: waiting });
      await staleRead.promise;
    });
    expect(screen.getByText("Идёт")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^старт$/i })).not.toBeInTheDocument();
  });

  it("accepts a post-mutation same-version detail read as authoritative", async () => {
    const user = userEvent.setup();
    const waiting = {
      ...detail,
      status: "waiting",
      version: 9,
      scoreA: 0,
      scoreB: 0,
      activeJudge: { userId: "other-judge", displayName: "Другой судья" },
    };
    const mutationProjection = {
      ...waiting,
      status: "in_progress",
      version: 10,
      currentServerParticipantId: waiting.participants[0].id,
    };
    const authoritativeProjection = {
      ...mutationProjection,
      activeJudge: null,
    };
    getMatch
      .mockResolvedValueOnce({ match: waiting })
      .mockResolvedValueOnce({ match: authoritativeProjection });
    startMatch.mockResolvedValueOnce({ match: mutationProjection });
    renderFacts();

    await user.click(await screen.findByRole("button", { name: /^старт$/i }));
    await user.click(within(screen.getByRole("dialog", { name: "Начать матч?" }))
      .getByRole("button", { name: "Начать матч" }));

    await waitFor(() => expect(getMatch).toHaveBeenCalledTimes(2));
    const primary = screen.getByRole("group", { name: "Основное действие" });
    expect(within(primary).getByRole("button", { name: "Судить" })).toBeInTheDocument();
    expect(within(primary).queryByRole("button", { name: "Открыть счёт" })).not.toBeInTheDocument();
  });
});
