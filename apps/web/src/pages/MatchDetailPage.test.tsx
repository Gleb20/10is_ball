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

vi.mock("../api", () => ({
  api: {
    me: (...a: unknown[]) => me(...a),
    getMatch: (...a: unknown[]) => getMatch(...a),
    startMatch: (...a: unknown[]) => startMatch(...a),
    stopMatch: (...a: unknown[]) => stopMatch(...a),
    cancelMatch: (...a: unknown[]) => cancelMatch(...a),
    voidMatch: (...a: unknown[]) => voidMatch(...a),
    adminForceCloseMatch: (...a: unknown[]) => adminForceCloseMatch(...a),
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
