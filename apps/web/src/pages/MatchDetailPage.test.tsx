import { fireEvent, render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MatchDetailPage } from "./MatchDetailPage";
import { AuthProvider } from "../auth";

const getMatch = vi.fn();
const me = vi.fn();
const startMatch = vi.fn();
const stopMatch = vi.fn();
const cancelMatch = vi.fn();
const voidMatch = vi.fn();
const adminForceCloseMatch = vi.fn();
const noShowMatch = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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
    adminDeleteMatch: vi.fn(),
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
  });

  it("shows force-close and delete for admin on standalone active match", async () => {
    render(
      <MemoryRouter initialEntries={["/matches/m1"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("button", { name: /принудительно закрыть/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /удалить из истории/i }),
    ).toBeInTheDocument();
  });

  it("hides admin CTAs for non-admin", async () => {
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
      match: { ...waiting, status: "in_progress", currentServerParticipantId: "p2" },
    });
    const user = userEvent.setup();
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
    expect(
      await screen.findByRole("button", { name: /^отменить матч$/i }),
    ).toBeInTheDocument();
  });

  it("hides cancel for outsider on waiting match", async () => {
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

    await user.click(
      await screen.findByRole("button", { name: /^отменить матч$/i }),
    );
    expect(cancelMatch).not.toHaveBeenCalled();
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/матч «личный финал»/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/без влияния на рейтинг/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /^нет$/i }));
    expect(cancelMatch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^отменить матч$/i }));
    dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^отменить матч$/i }));
    expect(cancelMatch).toHaveBeenCalledWith("m4", 0, expect.any(String));
  });

  it("AT-MATCH-START-001/STOP-002: participant sees no start, stop, or cancel action", async () => {
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

    expect(
      await screen.findByRole("button", { name: /остановить матч/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^отменить матч$/i }),
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

    await user.click(await screen.findByRole("button", { name: /аннулировать результат/i }));
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

    await user.click(screen.getByRole("button", { name: /аннулировать результат/i }));
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

    await user.click(
      await screen.findByRole("button", { name: /аннулировать результат/i }),
    );
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
    await user.click(screen.getByRole("button", { name: /остановить матч/i }));
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
    expect(screen.getByText("4 : 2")).toBeInTheDocument();
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

  it("shows rules, clean effective point log, and revenge for a participant", async () => {
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
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/matches/complete"]}>
        <AuthProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetailPage />} />
            <Route path="/matches/new" element={<span>revenge-create</span>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("2 × 2")).toBeInTheDocument();
    expect(screen.getByText("до 15 очков")).toBeInTheDocument();
    const log = screen.getByRole("list");
    expect(within(log).getAllByRole("listitem")).toHaveLength(2);
    expect(within(log).queryByText(/^Creator User.*очко$/)).toBeInTheDocument();
    expect(within(log).queryByText(/^Rival One.*очко$/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /создать реванш/i }));
    expect(await screen.findByText("revenge-create")).toBeInTheDocument();
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
    await user.click(await screen.findByRole("button", { name: /зафиксировать неявку/i }));
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
    expect(await screen.findByText("0 : 0")).toBeInTheDocument();
    expect(screen.getByText(/счёт сохранён без вымышленных очков/i)).toBeInTheDocument();
  });
});
