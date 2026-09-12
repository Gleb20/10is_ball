import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { JudgePage } from "./JudgePage";

const getMatch = vi.fn();
const startMatch = vi.fn();
const acquireJudge = vi.fn();
const heartbeatJudge = vi.fn();
const releaseJudge = vi.fn();
const judgeSetup = vi.fn();
const awardPoint = vi.fn();
const undoPoint = vi.fn();
const confirmFinish = vi.fn();
const revertFinish = vi.fn();

vi.mock("../api", () => ({
  api: {
    getMatch: (...a: unknown[]) => getMatch(...a),
    startMatch: (...a: unknown[]) => startMatch(...a),
    acquireJudge: (...a: unknown[]) => acquireJudge(...a),
    heartbeatJudge: (...a: unknown[]) => heartbeatJudge(...a),
    releaseJudge: (...a: unknown[]) => releaseJudge(...a),
    judgeSetup: (...a: unknown[]) => judgeSetup(...a),
    awardPoint: (...a: unknown[]) => awardPoint(...a),
    undoPoint: (...a: unknown[]) => undoPoint(...a),
    confirmFinish: (...a: unknown[]) => confirmFinish(...a),
    revertFinish: (...a: unknown[]) => revertFinish(...a),
  },
}));

const matchBody = {
  id: "m1",
  status: "in_progress",
  scoreA: 3,
  scoreB: 2,
  version: 5,
  deuceMode: false,
  startedAt: "2026-07-21T10:00:00.000Z",
  currentServerParticipantId: "p-a",
  participants: [
    {
      id: "p-a",
      side: "A",
      guestFirstName: "Анна",
      guestLastName: "А",
    },
    {
      id: "p-b",
      side: "B",
      guestFirstName: "Борис",
      guestLastName: "Б",
    },
  ],
};

function Destination({ label }: { label: string }) {
  const location = useLocation();
  const notice = (
    location.state as
      | { judgeExitNotice?: { kind: "success" | "warning"; message: string } }
      | null
  )?.judgeExitNotice;
  return (
    <div>
      <span>{label}</span>
      {notice ? (
        <p role={notice.kind === "warning" ? "alert" : "status"}>
          {notice.message}
        </p>
      ) : null}
    </div>
  );
}

function renderJudge(path = "/matches/m1/judge") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/matches/:id/judge" element={<JudgePage />} />
        <Route
          path="/matches/:id"
          element={<Destination label="match-detail" />}
        />
        <Route
          path="/tournaments/:id"
          element={<Destination label="tournament-detail" />}
        />
        <Route
          path="/onboarding"
          element={<Destination label="onboarding-resume" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setDocumentVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("REQ_ui__judge_immersive", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    getMatch.mockResolvedValue({ match: matchBody });
    startMatch.mockResolvedValue({ match: matchBody });
    acquireJudge.mockResolvedValue({ ok: true });
    heartbeatJudge.mockResolvedValue({ ok: true });
    releaseJudge.mockResolvedValue({ ok: true });
    setDocumentVisibility("visible");
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 844,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 390,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows scores, side names, serve badge with racket, timer and +1", async () => {
    renderJudge();
    expect(await screen.findByTestId("judge-screen")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Анна А")).toBeInTheDocument();
    expect(screen.getByText("Борис Б")).toBeInTheDocument();
    expect(screen.getByText("Подача")).toBeInTheDocument();
    expect(screen.getByTestId("serve-racket")).toBeInTheDocument();
    expect(screen.getByText(/0:00|:\d{2}/)).toBeInTheDocument();
    const sideA = screen.getByTestId("judge-side-A");
    expect(sideA).toContainElement(
      screen.getByRole("button", { name: /\+1 очко: анна а/i }),
    );
  });

  it("shows landscape hint in portrait", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 844,
    });
    renderJudge();
    expect(
      await screen.findByText(/поверните устройство горизонтально/i),
    ).toBeInTheDocument();
  });

  it("shows blocked screen when acquire fails", async () => {
    acquireJudge.mockRejectedValue(
      Object.assign(new Error("Судейская сессия занята"), {
        code: "JUDGE_TAKEN",
        details: { currentJudge: { userId: "u2", displayName: "L F" } },
      }),
    );
    renderJudge();
    expect(await screen.findByTestId("judge-blocked")).toBeInTheDocument();
    expect(screen.getByText(/уже судит/i)).toBeInTheDocument();
  });

  it("awards point only via +1 button", async () => {
    const user = userEvent.setup();
    awardPoint.mockResolvedValue({
      match: { ...matchBody, scoreA: 4, version: 6 },
    });
    renderJudge();
    const btn = await screen.findByRole("button", {
      name: /\+1 очко: анна а/i,
    });
    await user.click(btn);
    expect(awardPoint).toHaveBeenCalledWith("m1", "A", 5, expect.any(String));
  });

  it("AT-JUDGE-007 serializes two rapid +1 intents with the authoritative version", async () => {
    const user = userEvent.setup();
    const firstPoint = deferred<{ match: typeof matchBody }>();
    const secondPoint = deferred<{ match: typeof matchBody }>();
    awardPoint
      .mockImplementationOnce(() => firstPoint.promise)
      .mockImplementationOnce(() => secondPoint.promise);
    renderJudge();
    const btn = await screen.findByRole("button", {
      name: /\+1 очко: анна а/i,
    });

    await user.click(btn);
    await user.click(btn);

    expect(awardPoint).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("В очереди: 2");
    expect(
      screen.getByRole("button", { name: /отменить последнее очко/i }),
    ).toBeDisabled();
    expect(awardPoint).toHaveBeenNthCalledWith(
      1,
      "m1",
      "A",
      5,
      expect.any(String),
    );

    await act(async () => {
      firstPoint.resolve({
        match: { ...matchBody, scoreA: 4, version: 6 },
      });
      await firstPoint.promise;
    });

    await waitFor(() => expect(awardPoint).toHaveBeenCalledTimes(2));
    expect(awardPoint).toHaveBeenNthCalledWith(
      2,
      "m1",
      "A",
      6,
      expect.any(String),
    );
    expect(awardPoint.mock.calls[1]?.[3]).not.toBe(
      awardPoint.mock.calls[0]?.[3],
    );

    await act(async () => {
      secondPoint.resolve({
        match: { ...matchBody, scoreA: 5, version: 7 },
      });
      await secondPoint.promise;
    });

    await waitFor(() => {
      expect(
        within(screen.getByTestId("judge-side-A")).getByText("5"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /отменить последнее очко/i }),
    ).toBeEnabled();
  });

  it("AT-JUDGE-007 stops the queue and shows authoritative score on version conflict", async () => {
    const user = userEvent.setup();
    const pointRequest = deferred<{ match: typeof matchBody }>();
    awardPoint.mockImplementationOnce(() => pointRequest.promise);
    renderJudge();
    const btn = await screen.findByRole("button", {
      name: /\+1 очко: анна а/i,
    });

    await user.click(btn);
    getMatch.mockResolvedValue({
      match: { ...matchBody, scoreA: 4, version: 6 },
    });
    await act(async () => {
      pointRequest.reject(
        Object.assign(new Error("Версия матча изменилась"), {
          code: "VERSION_CONFLICT",
          status: 409,
        }),
      );
      await pointRequest.promise.catch(() => undefined);
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /счёт изменился на другом устройстве/i,
    );
    expect(
      within(screen.getByTestId("judge-side-A")).getByText("4"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("judge-lost-lock")).not.toBeInTheDocument();
    expect(btn).toBeEnabled();
    expect(awardPoint).toHaveBeenCalledTimes(1);
  });

  it("shows setup as board with swap and start match", async () => {
    const user = userEvent.setup();
    getMatch.mockResolvedValue({
      match: {
        ...matchBody,
        scoreA: 0,
        scoreB: 0,
        version: 0,
        status: "waiting",
        startedAt: null,
      },
    });
    judgeSetup.mockResolvedValue({
      match: {
        ...matchBody,
        scoreA: 0,
        scoreB: 0,
        status: "in_progress",
        startedAt: "2026-07-21T10:00:00.000Z",
      },
    });
    startMatch.mockResolvedValue({
      match: {
        ...matchBody,
        scoreA: 0,
        scoreB: 0,
        status: "in_progress",
        startedAt: null,
      },
    });
    renderJudge();
    expect(await screen.findByTestId("judge-setup")).toBeInTheDocument();
    expect(screen.getByTestId("judge-side-A")).toBeInTheDocument();
    expect(screen.getByTestId("judge-side-B")).toBeInTheDocument();
    const board = screen.getByRole("group", { name: /расположение и подача/i });
    expect(
      within(board).getByRole("button", { name: /поменять стороны/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("serve-racket")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /\+1 очко/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId("judge-side-B"));
    await user.click(screen.getByRole("button", { name: /начать матч/i }));
    expect(judgeSetup).toHaveBeenCalled();
  });

  it("AT-JUDGE-003 Cancel waits for release before navigation and reports success", async () => {
    const user = userEvent.setup();
    const release = deferred<{ ok: boolean }>();
    getMatch.mockResolvedValue({
      match: {
        ...matchBody,
        scoreA: 0,
        scoreB: 0,
        version: 0,
        status: "waiting",
        startedAt: null,
      },
    });
    releaseJudge.mockReturnValue(release.promise);
    renderJudge();

    await screen.findByTestId("judge-setup");
    await user.click(screen.getByRole("button", { name: "Отмена" }));

    expect(releaseJudge).toHaveBeenCalledWith("m1");
    expect(screen.getByTestId("judge-setup")).toBeInTheDocument();

    await act(async () => {
      release.resolve({ ok: true });
      await release.promise;
    });

    expect(await screen.findByText("match-detail")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/слот судьи освобождён/i);
  });

  it("BUG-004 Back releases the lock before leaving scoring", async () => {
    const user = userEvent.setup();
    const release = deferred<{ ok: boolean }>();
    releaseJudge.mockReturnValue(release.promise);
    renderJudge();

    await screen.findByTestId("judge-screen");
    await user.click(screen.getByRole("button", { name: "Назад" }));
    expect(releaseJudge).toHaveBeenCalledWith("m1");
    expect(screen.getByTestId("judge-screen")).toBeInTheDocument();

    await act(async () => {
      release.resolve({ ok: true });
      await release.promise;
    });
    expect(await screen.findByText("match-detail")).toBeInTheDocument();
  });

  it("BUG-004 explicit exit is best-effort and reports release failure after navigation", async () => {
    const user = userEvent.setup();
    releaseJudge.mockRejectedValue(new Error("Сеть недоступна"));
    renderJudge();

    await screen.findByTestId("judge-screen");
    await user.click(screen.getByRole("button", { name: "Ещё" }));
    await user.click(
      screen.getByRole("button", { name: /освободить слот и выйти/i }),
    );

    expect(releaseJudge).toHaveBeenCalledWith("m1");
    expect(await screen.findByText("match-detail")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /не удалось подтвердить освобождение/i,
    );
  });

  it("keeps every exit path closed until rapid score intents drain", async () => {
    const user = userEvent.setup();
    const firstPoint = deferred<{ match: typeof matchBody }>();
    const secondPoint = deferred<{ match: typeof matchBody }>();
    awardPoint
      .mockImplementationOnce(() => firstPoint.promise)
      .mockImplementationOnce(() => secondPoint.promise);
    renderJudge();

    const pointButton = await screen.findByRole("button", {
      name: /\+1 очко: анна а/i,
    });
    await user.click(screen.getByRole("button", { name: "Ещё" }));
    const exitButton = screen.getByRole("button", {
      name: /освободить слот и выйти/i,
    });

    fireEvent.click(pointButton);
    fireEvent.click(pointButton);
    fireEvent.click(exitButton);

    expect(releaseJudge).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Назад" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /освободить слот и выйти/i }),
    ).not.toBeInTheDocument();

    await act(async () => {
      firstPoint.resolve({
        match: { ...matchBody, scoreA: 4, version: 6 },
      });
      await firstPoint.promise;
    });
    await waitFor(() => expect(awardPoint).toHaveBeenCalledTimes(2));
    await act(async () => {
      secondPoint.resolve({
        match: { ...matchBody, scoreA: 5, version: 7 },
      });
      await secondPoint.promise;
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Назад" })).toBeEnabled(),
    );
    expect(releaseJudge).not.toHaveBeenCalled();
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [409, "JUDGE_NOT_ACTIVE"],
  ])(
    "BUG-005 heartbeat %s/%s shows lost-lock state, blocks mutations, and syncs authoritative match",
    async (status, code) => {
      const timers: Array<{ callback: TimerHandler; delay?: number }> = [];
      vi.spyOn(window, "setInterval").mockImplementation((callback, delay) => {
        timers.push({ callback, delay });
        return timers.length as never;
      });
      vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
      renderJudge();
      await screen.findByTestId("judge-screen");

      heartbeatJudge.mockRejectedValue(
        Object.assign(new Error("lock lost"), { status, code }),
      );
      getMatch.mockResolvedValue({
        match: { ...matchBody, scoreA: 8, scoreB: 7, version: 12 },
      });
      await waitFor(() =>
        expect(timers.some(({ delay }) => delay === 30_000)).toBe(true),
      );
      const liveTimer = timers.find(({ delay }) => delay === 30_000);
      expect(liveTimer).toBeDefined();
      await act(async () => {
        await (liveTimer!.callback as () => Promise<void>)();
      });

      expect(await screen.findByTestId("judge-lost-lock")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent(/слот судьи потерян/i);
      expect(
        within(screen.getByTestId("judge-side-A")).getByText("8"),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /\+1 очко/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /отменить последнее очко/i }),
      ).not.toBeInTheDocument();
    },
  );

  it("BUG-005 external terminal change switches the scoring screen to readonly", async () => {
    const timers: Array<{ callback: TimerHandler; delay?: number }> = [];
    vi.spyOn(window, "setInterval").mockImplementation((callback, delay) => {
      timers.push({ callback, delay });
      return timers.length as never;
    });
    vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
    renderJudge();
    await screen.findByTestId("judge-screen");
    getMatch.mockResolvedValue({
      match: {
        ...matchBody,
        status: "finished",
        scoreA: 11,
        scoreB: 7,
        version: 15,
      },
    });

    await act(async () => {
      for (const timer of timers.filter(({ delay }) => (delay ?? 0) >= 30_000)) {
        await (timer.callback as () => Promise<void>)();
      }
    });

    expect(await screen.findByText("Только просмотр")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("judge-side-A")).getByText("11"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /\+1 очко/i }),
    ).not.toBeInTheDocument();
  });

  it("uses authoritative terminal refresh after heartbeat 409 instead of staying lost-lock", async () => {
    const timers: Array<{ callback: TimerHandler; delay?: number }> = [];
    vi.spyOn(window, "setInterval").mockImplementation((callback, delay) => {
      timers.push({ callback, delay });
      return timers.length as never;
    });
    vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
    renderJudge();
    await screen.findByTestId("judge-screen");

    heartbeatJudge.mockRejectedValue(
      Object.assign(new Error("judge session ended"), {
        status: 409,
        code: "JUDGE_NOT_ACTIVE",
      }),
    );
    getMatch.mockResolvedValue({
      match: {
        ...matchBody,
        status: "finished",
        scoreA: 11,
        scoreB: 9,
        version: 16,
      },
    });
    const liveTimer = timers.find(({ delay }) => delay === 30_000);
    expect(liveTimer).toBeDefined();

    await act(async () => {
      await (liveTimer!.callback as () => Promise<void>)();
    });

    expect(await screen.findByText("Только просмотр")).toBeInTheDocument();
    expect(screen.queryByTestId("judge-lost-lock")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("judge-side-A")).getByText("11"),
    ).toBeInTheDocument();
  });

  it("BUG-005 pauses live timers while hidden, resumes immediately once, and cleans up without release", async () => {
    const timers: Array<{ id: number; callback: TimerHandler; delay?: number }> = [];
    const cleared: number[] = [];
    vi.spyOn(window, "setInterval").mockImplementation((callback, delay) => {
      const id = timers.length + 1;
      timers.push({ id, callback, delay });
      return id as never;
    });
    vi.spyOn(window, "clearInterval").mockImplementation((id) => {
      cleared.push(Number(id));
    });
    setDocumentVisibility("hidden");
    const rendered = renderJudge();
    await screen.findByTestId("judge-screen");

    expect(timers.filter(({ delay }) => (delay ?? 0) >= 30_000)).toHaveLength(0);
    expect(heartbeatJudge).not.toHaveBeenCalled();

    const loadsBeforeResume = getMatch.mock.calls.length;
    await act(async () => Promise.resolve());
    act(() => setDocumentVisibility("visible"));
    await waitFor(() => expect(heartbeatJudge).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getMatch.mock.calls.length).toBeGreaterThan(loadsBeforeResume));
    expect(timers.filter(({ delay }) => delay === 30_000)).toHaveLength(1);

    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => Promise.resolve());
    expect(heartbeatJudge).toHaveBeenCalledTimes(1);
    expect(timers.filter(({ delay }) => delay === 30_000)).toHaveLength(1);

    rendered.unmount();
    expect(releaseJudge).not.toHaveBeenCalled();
    expect(cleared).toContain(
      timers.find(({ delay }) => delay === 30_000)?.id,
    );
  });

  it("exits to match detail after confirm finish", async () => {
    const user = userEvent.setup();
    getMatch.mockResolvedValue({
      match: { ...matchBody, status: "pending_confirmation" },
    });
    confirmFinish.mockResolvedValue({
      match: { ...matchBody, status: "finished" },
    });
    renderJudge();
    await screen.findByTestId("judge-screen");
    await user.click(
      screen.getByRole("button", { name: /подтвердить результат/i }),
    );
    expect(await screen.findByText("match-detail")).toBeInTheDocument();
  });

  it("BUG-012 returns a finished tutorial to the persisted onboarding step", async () => {
    const user = userEvent.setup();
    getMatch.mockResolvedValue({
      match: {
        ...matchBody,
        kind: "tutorial",
        status: "pending_confirmation",
      },
    });
    confirmFinish.mockResolvedValue({
      match: { ...matchBody, kind: "tutorial", status: "finished" },
    });
    renderJudge("/matches/m1/judge?tutorial=1");
    await screen.findByTestId("judge-screen");
    await user.click(
      screen.getByRole("button", { name: /подтвердить результат/i }),
    );
    expect(await screen.findByText("onboarding-resume")).toBeInTheDocument();
  });

  it("finished match opens readonly without acquire", async () => {
    getMatch.mockResolvedValue({
      match: { ...matchBody, status: "finished" },
    });
    renderJudge();
    expect(await screen.findByTestId("judge-screen")).toBeInTheDocument();
    expect(acquireJudge).not.toHaveBeenCalled();
  });

  it("exits to tournament after confirm finish when tournamentId set", async () => {
    const user = userEvent.setup();
    getMatch.mockResolvedValue({
      match: {
        ...matchBody,
        status: "pending_confirmation",
        tournamentId: "trn-1",
      },
    });
    confirmFinish.mockResolvedValue({
      match: {
        ...matchBody,
        status: "finished",
        tournamentId: "trn-1",
      },
    });
    renderJudge();
    await screen.findByTestId("judge-screen");
    await user.click(
      screen.getByRole("button", { name: /подтвердить результат/i }),
    );
    expect(await screen.findByText("tournament-detail")).toBeInTheDocument();
  });
});
