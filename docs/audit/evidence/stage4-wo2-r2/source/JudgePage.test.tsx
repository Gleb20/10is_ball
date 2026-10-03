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
  useNavigate,
} from "react-router-dom";
import { JudgePage } from "./JudgePage";
import {
  acceptReviewedPointScore,
  appendPointIntent,
  beginPointAttempt,
  createScoreRecoveryRecord,
  markPointAttemptError,
  persistScoreRecoveryRecord,
  reconcilePointAttempts,
  resetScoreRecoveryForTests,
  scoreRecoveryStorageKey,
} from "./judgeScoreRecovery";

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
const directory = vi.fn();
const handoverJudge = vi.fn();
const manualCorrection = vi.fn();

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
    directory: (...a: unknown[]) => directory(...a),
    handoverJudge: (...a: unknown[]) => handoverJudge(...a),
    manualCorrection: (...a: unknown[]) => manualCorrection(...a),
  },
}));

vi.mock("../auth", () => ({
  useAuth: () => ({ user: { id: "judge-user" }, reauthRequired: false }),
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
  const navigate = useNavigate();
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
      {label === "home" ? (
        <button type="button" onClick={() => navigate("/matches/m1/judge")}>Вернуться к судейству</button>
      ) : null}
    </div>
  );
}

function renderJudge(path = "/matches/m1/judge") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Destination label="home" />} />
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
    resetScoreRecoveryForTests();
    window.sessionStorage.clear();
    getMatch.mockResolvedValue({ match: matchBody });
    startMatch.mockResolvedValue({ match: matchBody });
    acquireJudge.mockResolvedValue({ ok: true });
    heartbeatJudge.mockResolvedValue({ ok: true });
    releaseJudge.mockResolvedValue({ ok: true });
    directory.mockResolvedValue({ users: [] });
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

  it("GAP-011 announces score once and exposes ordinary keyboard judge actions", async () => {
    renderJudge();
    const more = await screen.findByRole("button", { name: "Ещё" });
    expect(screen.getByTestId("judge-score-announcement")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("judge-score-announcement")).toHaveTextContent("Анна А: 3");
    expect(screen.getByTestId("judge-score-announcement")).toHaveTextContent("Борис Б: 2");
    fireEvent.click(more);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    const actions = screen.getByRole("group", { name: "Действия судьи" });
    const action = within(actions).getByRole("button", { name: "Поменять местами на экране" });
    action.focus(); fireEvent.keyDown(action, { key: "Escape" });
    expect(more).toHaveFocus(); expect(more).toHaveAttribute("aria-expanded", "false");
  });

  it("BUG-025 keeps handover unavailable while directory loads and retries a failed GET", async () => {
    const pending = deferred<{ users: Array<{ id: string; displayName: string }> }>();
    directory.mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ users: [{ id: "u2", displayName: "Новый Судья" }] });
    const user = userEvent.setup();
    renderJudge();
    await user.click(await screen.findByRole("button", { name: "Ещё" }));
    const select = screen.getByLabelText("Передать судейство");
    expect(select).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Загружаем пользователей");
    await act(async () => pending.reject(new Error("offline")));
    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось загрузить пользователей");
    expect(select).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Повторить загрузку пользователей" }));
    await waitFor(() => expect(select).toBeEnabled());
    expect(select).toHaveFocus();
    expect(directory).toHaveBeenCalledTimes(2);
  });

  it("BUG-025 keeps handover retry focused if its GET fails again", async () => {
    directory.mockRejectedValueOnce(new Error("offline"));
    directory.mockRejectedValueOnce(new Error("still offline"));
    const user = userEvent.setup();
    renderJudge();
    await user.click(await screen.findByRole("button", { name: "Ещё" }));
    await user.click(await screen.findByRole("button", { name: "Повторить загрузку пользователей" }));
    const retry = await screen.findByRole("button", { name: "Повторить загрузку пользователей" });
    await waitFor(() => expect(retry).toHaveFocus());
    expect(screen.getByLabelText("Передать судейство")).toBeDisabled();
    expect(directory).toHaveBeenCalledTimes(2);
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
    expect(screen.getByRole("note", { name: "Подсказка судье" })).toHaveTextContent(
      /активный судья.*undo.*последнее действующее очко/i,
    );
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

  it("AT-JUDGE-002 lets a nonparticipant acquire from a known writable judge URL", async () => {
    getMatch
      .mockRejectedValueOnce(
        Object.assign(new Error("Нет доступа к активному матчу"), {
          code: "FORBIDDEN",
          status: 403,
        }),
      )
      .mockResolvedValue({ match: matchBody });

    renderJudge();

    expect(await screen.findByTestId("judge-screen")).toBeInTheDocument();
    expect(acquireJudge).toHaveBeenCalledTimes(1);
    expect(getMatch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("AT-JUDGE-002 does not acquire after a 403 on a readonly judge URL", async () => {
    getMatch.mockRejectedValue(
      Object.assign(new Error("Нет доступа к активному матчу"), {
        code: "FORBIDDEN",
        status: 403,
      }),
    );

    renderJudge("/matches/m1/judge?mode=readonly");

    expect(await screen.findByTestId("judge-blocked")).toBeInTheDocument();
    expect(acquireJudge).not.toHaveBeenCalled();
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

  it("AT-JUDGE-007 proves no-write on version conflict but keeps the old queue paused", async () => {
    const user = userEvent.setup();
    const pointRequest = deferred<{ match: typeof matchBody }>();
    awardPoint.mockImplementationOnce(() => pointRequest.promise);
    renderJudge();
    const btn = await screen.findByRole("button", {
      name: /\+1 очко: анна а/i,
    });

    await user.click(btn);
    fireEvent.click(screen.getByRole("button", { name: /\+1 очко: борис б/i }));
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
      /запрос не изменил счёт/i,
    );
    expect(
      within(screen.getByTestId("judge-side-A")).getByText("4"),
    ).toBeInTheDocument();
    const recoveryRegion = screen.getByRole("region", { name: /восстановление счёта/i });
    expect(recoveryRegion).toHaveTextContent(/не отправлено: 1/i);
    await waitFor(() => expect(recoveryRegion).toHaveFocus());
    expect(screen.queryByTestId("judge-lost-lock")).not.toBeInTheDocument();
    expect(btn).toBeDisabled();
    expect(screen.getByRole("button", { name: /отправить оставшиеся нажатия/i })).toBeEnabled();
    expect(awardPoint).toHaveBeenCalledTimes(1);
  });

  it("BUG-029 restores an interrupted send as unknown, checks GET first, and never replays it", async () => {
    const user = userEvent.setup();
    let record = appendPointIntent(
      createScoreRecoveryRecord("judge-user", "m1", 5),
      { id: "intent-a", side: "A", idempotencyKey: "point-a" },
    );
    record = beginPointAttempt(record, 5).record;
    record = appendPointIntent(record, { id: "intent-b", side: "B", idempotencyKey: "point-b" });
    persistScoreRecoveryRecord(record, window.sessionStorage);
    getMatch.mockResolvedValue({ match: { ...matchBody, idempotencyKeys: [] } });

    renderJudge();

    expect(await screen.findByRole("region", { name: /восстановление счёта/i })).toHaveTextContent(
      /сервер не подтвердил/i,
    );
    expect(getMatch).toHaveBeenCalled();
    expect(awardPoint).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /принять показанный счёт/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /отменить последнее очко/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /принять показанный счёт/i }));
    expect(awardPoint).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: /подтверждение показанного счёта/i })).toHaveTextContent(
      /анна а: 3.*борис б: 2/i,
    );
    await user.click(screen.getByRole("button", { name: /отменить принятие/i }));
    expect(awardPoint).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /принять показанный счёт/i }));
    await user.click(screen.getByRole("button", { name: /подтвердить показанный счёт/i }));
    expect(awardPoint).not.toHaveBeenCalled();
    awardPoint
      .mockResolvedValueOnce({ match: { ...matchBody, scoreA: 4, version: 6 } })
      .mockResolvedValueOnce({ match: { ...matchBody, scoreA: 4, scoreB: 3, version: 7 } });
    await user.click(screen.getByRole("button", { name: /добавить новое очко: анна а/i }));
    await waitFor(() => expect(awardPoint).toHaveBeenCalledTimes(1));
    expect(awardPoint).toHaveBeenCalledWith("m1", "A", 5, expect.any(String));
    expect(awardPoint.mock.calls[0]?.[3]).not.toBe("point-a");
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(awardPoint).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /отправить оставшиеся нажатия/i }));
    await waitFor(() => expect(awardPoint).toHaveBeenCalledTimes(2));
    expect(awardPoint).toHaveBeenNthCalledWith(2, "m1", "B", 6, "point-b");
  });

  it("BUG-029 binds score acceptance to the reviewed snapshot and does not steal focus on a later GET", async () => {
    const timers: Array<{ callback: TimerHandler; delay?: number }> = [];
    vi.spyOn(window, "setInterval").mockImplementation((callback, delay) => {
      timers.push({ callback, delay });
      return timers.length as never;
    });
    vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
    let record = appendPointIntent(
      createScoreRecoveryRecord("judge-user", "m1", 5),
      { id: "a", side: "A", idempotencyKey: "key-a" },
    );
    record = markPointAttemptError(beginPointAttempt(record, 5).record, "a");
    persistScoreRecoveryRecord(record, window.sessionStorage);
    getMatch.mockResolvedValue({ match: { ...matchBody, idempotencyKeys: [] } });
    const user = userEvent.setup();
    renderJudge();
    const recovery = await screen.findByRole("region", { name: /восстановление счёта/i });
    await user.click(screen.getByRole("button", { name: /принять показанный счёт/i }));
    const confirm = screen.getByRole("button", { name: /подтвердить показанный счёт/i });
    confirm.focus();

    getMatch.mockResolvedValue({
      match: { ...matchBody, scoreA: 4, version: 6, idempotencyKeys: [] },
    });
    const liveTimer = timers.find(({ delay }) => delay === 30_000);
    expect(liveTimer).toBeDefined();
    await act(async () => {
      await (liveTimer!.callback as () => Promise<void>)();
    });
    expect(recovery).not.toHaveFocus();
    await user.click(confirm);

    expect(await screen.findByRole("alert")).toHaveTextContent(/изменился во время подтверждения/i);
    expect(screen.queryByRole("region", { name: /подтверждение показанного счёта/i })).not.toBeInTheDocument();
    expect(awardPoint).not.toHaveBeenCalled();
  });

  it("BUG-029 keeps an explicit new point pinned to the confirmed reviewed version after a newer GET", async () => {
    const timers: Array<{ callback: TimerHandler; delay?: number }> = [];
    vi.spyOn(window, "setInterval").mockImplementation((callback, delay) => {
      timers.push({ callback, delay });
      return timers.length as never;
    });
    vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
    let record = appendPointIntent(
      createScoreRecoveryRecord("judge-user", "m1", 7),
      { id: "a", side: "A", idempotencyKey: "key-a" },
    );
    record = markPointAttemptError(beginPointAttempt(record, 7).record, "a");
    record = appendPointIntent(record, { id: "b", side: "B", idempotencyKey: "key-b" });
    persistScoreRecoveryRecord(record, window.sessionStorage);
    getMatch.mockResolvedValue({
      match: { ...matchBody, scoreA: 5, version: 7, idempotencyKeys: [] },
    });
    const user = userEvent.setup();
    renderJudge();
    await user.click(await screen.findByRole("button", { name: /принять показанный счёт/i }));
    await user.click(screen.getByRole("button", { name: /подтвердить показанный счёт/i }));
    getMatch.mockResolvedValue({
      match: { ...matchBody, scoreA: 6, version: 8, idempotencyKeys: [] },
    });
    const liveTimer = timers.find(({ delay }) => delay === 30_000);
    await act(async () => {
      await (liveTimer!.callback as () => Promise<void>)();
    });
    awardPoint.mockRejectedValueOnce(
      Object.assign(new Error("stale"), { status: 409, code: "VERSION_CONFLICT" }),
    );

    await user.click(screen.getByRole("button", { name: /добавить новое очко: анна а/i }));

    await waitFor(() => expect(awardPoint).toHaveBeenCalledTimes(1));
    expect(awardPoint).toHaveBeenCalledWith("m1", "A", 7, expect.any(String));
    const recovery = await screen.findByRole("region", { name: /восстановление счёта/i });
    expect(recovery).toHaveTextContent(/не отправлено: 1/i);
    expect(screen.getByRole("button", { name: /отправить оставшиеся нажатия/i })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /добавить новое очко/i })).not.toBeInTheDocument();
  });

  it("BUG-029 keeps an unsaved tap visible and sends no POST when durable storage fails", async () => {
    const storageWrite = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementationOnce(() => {
        throw new Error("quota");
      });
    const user = userEvent.setup();
    const rendered = renderJudge();

    await user.click(await screen.findByRole("button", { name: /\+1 очко: анна а/i }));

    expect(awardPoint).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: /восстановление счёта/i })).toHaveTextContent(
      /сохранено только в этой вкладке/i,
    );
    expect(screen.getByRole("button", { name: /\+1 очко: анна а/i })).toBeDisabled();
    expect(screen.queryByText(/отправка очка/i)).not.toBeInTheDocument();
    storageWrite.mockRestore();

    rendered.unmount();
    renderJudge();
    expect(await screen.findByRole("region", { name: /восстановление счёта/i })).toHaveTextContent(
      /осталось нажатий: 1/i,
    );
    expect(awardPoint).not.toHaveBeenCalled();
  });

  it("BUG-029 does not retry storage or send a queued tap when its write failed during an active request", async () => {
    const realSetItem = Storage.prototype.setItem;
    let writeCount = 0;
    const storageWrite = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        writeCount += 1;
        if (writeCount === 3) throw new Error("quota");
        return realSetItem.call(this, key, value);
      });
    const firstPoint = deferred<{ match: typeof matchBody }>();
    awardPoint
      .mockImplementationOnce(() => firstPoint.promise)
      .mockResolvedValueOnce({ match: { ...matchBody, scoreA: 4, scoreB: 3, version: 7 } });
    renderJudge();
    const pointA = await screen.findByRole("button", { name: /\+1 очко: анна а/i });
    const pointB = screen.getByRole("button", { name: /\+1 очко: борис б/i });

    fireEvent.click(pointA);
    fireEvent.click(pointB);
    expect(awardPoint).toHaveBeenCalledTimes(1);
    await act(async () => {
      firstPoint.resolve({ match: { ...matchBody, scoreA: 4, version: 6 } });
      await firstPoint.promise;
    });

    await waitFor(() => {
      expect(screen.getByRole("region", { name: /восстановление счёта/i })).toHaveTextContent(
        /сохранено только в этой вкладке/i,
      );
    });
    expect(awardPoint).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /повторить сохранение/i })).toBeEnabled();
    storageWrite.mockRestore();
    getMatch.mockResolvedValue({ match: { ...matchBody, scoreA: 4, version: 6, idempotencyKeys: [] } });
    await userEvent.setup().click(screen.getByRole("button", { name: /повторить сохранение/i }));
    expect(await screen.findByRole("button", { name: /отправить оставшиеся нажатия/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /\+1 очко: анна а/i }));
    expect(awardPoint).toHaveBeenCalledTimes(1);
    await userEvent.setup().click(screen.getByRole("button", { name: /отправить оставшиеся нажатия/i }));
    await waitFor(() => expect(awardPoint).toHaveBeenCalledTimes(2));
    expect(awardPoint).toHaveBeenNthCalledWith(2, "m1", "B", 6, expect.any(String));
  });

  it("BUG-029 requires explicit continuation for queued taps after exact-key reconciliation", async () => {
    const user = userEvent.setup();
    const firstPoint = deferred<{ match: typeof matchBody }>();
    awardPoint
      .mockImplementationOnce(() => firstPoint.promise)
      .mockResolvedValueOnce({ match: { ...matchBody, scoreA: 4, scoreB: 3, version: 7 } });
    renderJudge();
    const pointA = await screen.findByRole("button", { name: /\+1 очко: анна а/i });
    const pointB = screen.getByRole("button", { name: /\+1 очко: борис б/i });

    fireEvent.click(pointA);
    fireEvent.click(pointB);
    const firstKey = String(awardPoint.mock.calls[0]?.[3]);
    getMatch.mockResolvedValue({
      match: { ...matchBody, scoreA: 4, version: 6, idempotencyKeys: [firstKey] },
    });
    await act(async () => {
      firstPoint.reject(Object.assign(new Error("network"), { code: "NETWORK" }));
      await firstPoint.promise.catch(() => undefined);
    });

    expect(awardPoint).toHaveBeenCalledTimes(1);
    const continueButton = await screen.findByRole("button", {
      name: /отправить оставшиеся нажатия/i,
    });
    await user.click(continueButton);

    await waitFor(() => expect(awardPoint).toHaveBeenCalledTimes(2));
    expect(awardPoint).toHaveBeenNthCalledWith(2, "m1", "B", 6, expect.any(String));
  });

  it("BUG-029 exact-proves a lost explicit fence while B/C remain paused for Continue", async () => {
    let record = appendPointIntent(
      createScoreRecoveryRecord("judge-user", "m1", 5),
      { id: "a", side: "A", idempotencyKey: "key-a" },
    );
    record = markPointAttemptError(beginPointAttempt(record, 5).record, "a");
    record = appendPointIntent(record, { id: "b", side: "B", idempotencyKey: "key-b" });
    record = appendPointIntent(record, { id: "c", side: "A", idempotencyKey: "key-c" });
    persistScoreRecoveryRecord(record, window.sessionStorage);
    getMatch.mockResolvedValue({ match: { ...matchBody, idempotencyKeys: [] } });
    const explicitPoint = deferred<{ match: typeof matchBody }>();
    awardPoint.mockImplementationOnce(() => explicitPoint.promise);
    const user = userEvent.setup();
    renderJudge();
    await user.click(await screen.findByRole("button", { name: /принять показанный счёт/i }));
    await user.click(screen.getByRole("button", { name: /подтвердить показанный счёт/i }));
    await user.click(screen.getByRole("button", { name: /добавить новое очко: анна а/i }));
    const fenceKey = String(awardPoint.mock.calls[0]?.[3]);
    getMatch.mockResolvedValue({
      match: { ...matchBody, scoreA: 4, version: 6, idempotencyKeys: [fenceKey] },
    });
    await act(async () => {
      explicitPoint.reject(new Error("network"));
      await explicitPoint.promise.catch(() => undefined);
    });

    expect(awardPoint).toHaveBeenCalledTimes(1);
    const recovery = await screen.findByRole("region", { name: /восстановление счёта/i });
    expect(recovery).toHaveTextContent(/не отправлено: 2/i);
    expect(screen.getByRole("button", { name: /отправить оставшиеся нажатия/i })).toBeEnabled();
  });

  it("BUG-029 restores a sent attempt with B/C queued and performs zero automatic POSTs", async () => {
    let record = appendPointIntent(
      createScoreRecoveryRecord("judge-user", "m1", 5),
      { id: "a", side: "A", idempotencyKey: "key-a" },
    );
    record = beginPointAttempt(record, 5).record;
    record = appendPointIntent(record, { id: "b", side: "B", idempotencyKey: "key-b" });
    record = appendPointIntent(record, { id: "c", side: "A", idempotencyKey: "key-c" });
    persistScoreRecoveryRecord(record, window.sessionStorage);
    getMatch.mockResolvedValue({ match: { ...matchBody, idempotencyKeys: [] } });

    renderJudge();

    const recovery = await screen.findByRole("region", { name: /восстановление счёта/i });
    expect(recovery).toHaveTextContent(/сервер не подтвердил/i);
    expect(recovery).toHaveTextContent(/отправленные очки.*анна а/i);
    expect(recovery).toHaveTextContent(/не отправлено.*2/i);
    expect(recovery).toHaveTextContent(/не отправлять оставшиеся/i);
    expect(awardPoint).not.toHaveBeenCalled();
  });

  it("BUG-029 keeps only the unresolved B attempt after exact proof for A", async () => {
    let record = createScoreRecoveryRecord("judge-user", "m1", 5);
    record = appendPointIntent(record, { id: "a", side: "A", idempotencyKey: "key-a" });
    record = beginPointAttempt(record, 5).record;
    record = markPointAttemptError(record, "a");
    record = acceptReviewedPointScore(reconcilePointAttempts(record, 5, []).record);
    record = appendPointIntent(record, { id: "b", side: "B", idempotencyKey: "key-b" });
    record = beginPointAttempt(record, 5, true).record;
    record = markPointAttemptError(record, "b");
    persistScoreRecoveryRecord(record, window.sessionStorage);
    getMatch.mockResolvedValue({
      match: { ...matchBody, scoreA: 4, version: 6, idempotencyKeys: ["key-a"] },
    });

    renderJudge();

    expect(await screen.findByRole("region", { name: /восстановление счёта/i })).toHaveTextContent(
      /сервер не подтвердил/i,
    );
    expect(screen.getByRole("button", { name: /отменить последнее очко/i })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Ещё" }));
    expect(screen.getByRole("button", { name: /исправить счёт и подачу/i })).toBeDisabled();
    expect(awardPoint).not.toHaveBeenCalled();
  });

  it("BUG-029 retains informational correlation after judge ownership is lost", async () => {
    awardPoint.mockRejectedValueOnce(
      Object.assign(new Error("expired"), { status: 401, code: "UNAUTHORIZED" }),
    );
    getMatch.mockResolvedValue({ match: { ...matchBody, idempotencyKeys: [] } });
    const user = userEvent.setup();
    renderJudge();

    await user.click(await screen.findByRole("button", { name: /\+1 очко: анна а/i }));

    expect(await screen.findByTestId("judge-lost-lock")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /восстановление счёта/i })).toHaveTextContent(
      /требует заново занять слот судьи/i,
    );
    expect(screen.queryByRole("button", { name: /добавить новое очко/i })).not.toBeInTheDocument();
    expect(awardPoint).toHaveBeenCalledTimes(1);
  });

  it("BUG-029 returns Home and re-enters through GET and judge ownership with zero automatic POSTs", async () => {
    let record = appendPointIntent(
      createScoreRecoveryRecord("judge-user", "m1", 5),
      { id: "a", side: "A", idempotencyKey: "key-a" },
    );
    record = markPointAttemptError(beginPointAttempt(record, 5).record, "a");
    persistScoreRecoveryRecord(record, window.sessionStorage);
    getMatch.mockResolvedValue({ match: { ...matchBody, idempotencyKeys: [] } });
    const user = userEvent.setup();
    renderJudge();
    await screen.findByRole("region", { name: /восстановление счёта/i });
    const readsBeforeExit = getMatch.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "На главную" }));
    expect(await screen.findByText("home")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /вернуться к судейству/i }));

    expect(await screen.findByRole("region", { name: /восстановление счёта/i })).toBeInTheDocument();
    expect(getMatch.mock.calls.length).toBeGreaterThan(readsBeforeExit);
    expect(acquireJudge).toHaveBeenCalledTimes(2);
    expect(awardPoint).not.toHaveBeenCalled();
  });

  it("BUG-029 ignores a completed POST callback from an earlier mount", async () => {
    const pendingPoint = deferred<{ match: typeof matchBody }>();
    awardPoint.mockImplementationOnce(() => pendingPoint.promise);
    const firstMount = renderJudge();
    fireEvent.click(await screen.findByRole("button", { name: /\+1 очко: анна а/i }));
    expect(awardPoint).toHaveBeenCalledTimes(1);

    firstMount.unmount();
    getMatch.mockResolvedValue({ match: { ...matchBody, idempotencyKeys: [] } });
    renderJudge();
    expect(await screen.findByRole("region", { name: /восстановление счёта/i })).toBeInTheDocument();
    await act(async () => {
      pendingPoint.resolve({ match: { ...matchBody, scoreA: 9, version: 6 } });
      await pendingPoint.promise;
    });

    expect(within(screen.getByTestId("judge-side-A")).getByText("3")).toBeInTheDocument();
    expect(awardPoint).toHaveBeenCalledTimes(1);
  });

  it("BUG-029 never lets a late point response roll back a newer accepted server version", async () => {
    const timers: Array<{ callback: TimerHandler; delay?: number }> = [];
    vi.spyOn(window, "setInterval").mockImplementation((callback, delay) => {
      timers.push({ callback, delay });
      return timers.length as never;
    });
    vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
    const pendingPoint = deferred<{ match: typeof matchBody }>();
    awardPoint.mockImplementationOnce(() => pendingPoint.promise);
    renderJudge();
    fireEvent.click(await screen.findByRole("button", { name: /\+1 очко: анна а/i }));
    getMatch.mockResolvedValue({
      match: { ...matchBody, scoreA: 8, version: 7, idempotencyKeys: [] },
    });
    const liveTimer = timers.find(({ delay }) => delay === 30_000);
    expect(liveTimer).toBeDefined();
    await act(async () => {
      await (liveTimer!.callback as () => Promise<void>)();
    });
    expect(within(screen.getByTestId("judge-side-A")).getByText("8")).toBeInTheDocument();

    await act(async () => {
      pendingPoint.resolve({ match: { ...matchBody, scoreA: 4, version: 6 } });
      await pendingPoint.promise;
    });

    expect(within(screen.getByTestId("judge-side-A")).getByText("8")).toBeInTheDocument();
  });

  it("BUG-029 fails closed on a corrupt stored record without deleting it", async () => {
    const key = scoreRecoveryStorageKey("judge-user", "m1");
    window.sessionStorage.setItem(key, "{broken-json");
    renderJudge();

    expect(await screen.findByRole("region", { name: /восстановление счёта/i })).toHaveTextContent(
      /повреждено/i,
    );
    expect(screen.getByRole("button", { name: /\+1 очко: анна а/i })).toBeDisabled();
    expect(window.sessionStorage.getItem(key)).toBe("{broken-json");
    expect(awardPoint).not.toHaveBeenCalled();
  });

  it("BUG-029 survives a sessionStorage getter failure and retains SPA-memory recovery", async () => {
    const record = appendPointIntent(
      createScoreRecoveryRecord("judge-user", "m1", 5),
      { id: "a", side: "A", idempotencyKey: "key-a" },
    );
    persistScoreRecoveryRecord(record, {
      getItem: () => null,
      setItem: () => { throw new Error("storage unavailable"); },
      removeItem: () => undefined,
    });
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    renderJudge();

    expect(await screen.findByRole("region", { name: /восстановление счёта/i })).toHaveTextContent(
      /сохранено только в этой вкладке/i,
    );
    expect(screen.getByRole("button", { name: /\+1 очко: анна а/i })).toBeDisabled();
    expect(awardPoint).not.toHaveBeenCalled();
  });

  it("BUG-029 keeps Undo, correction and Finish closed after no-key acceptance", async () => {
    let record = appendPointIntent(
      createScoreRecoveryRecord("judge-user", "m1", 5),
      { id: "a", side: "A", idempotencyKey: "key-a" },
    );
    record = beginPointAttempt(record, 5).record;
    record = markPointAttemptError(record, "a");
    persistScoreRecoveryRecord(record, window.sessionStorage);
    getMatch.mockResolvedValue({
      match: { ...matchBody, status: "pending_confirmation", idempotencyKeys: [] },
    });
    const user = userEvent.setup();
    renderJudge();
    await user.click(await screen.findByRole("button", { name: /принять показанный счёт/i }));
    await user.click(screen.getByRole("button", { name: /подтвердить показанный счёт/i }));

    expect(screen.getByRole("button", { name: /отменить последнее очко/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Ещё" }));
    expect(screen.getByRole("button", { name: /исправить счёт и подачу/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /подтвердить результат/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /продолжить игру/i })).toBeDisabled();
    expect(undoPoint).not.toHaveBeenCalled();
    expect(confirmFinish).not.toHaveBeenCalled();
    expect(revertFinish).not.toHaveBeenCalled();
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
    expect(screen.queryByTestId("serve-racket")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /\+1 очко/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /начать матч/i })).toBeDisabled();

    await user.click(screen.getByTestId("judge-side-B"));
    expect(screen.getByTestId("serve-racket")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /начать матч/i }));
    expect(judgeSetup).toHaveBeenCalled();
  });

  it("BUG-026 keeps a confirmed start and immutable second-step payload through known setup failure", async () => {
    const user = userEvent.setup();
    const waiting = { ...matchBody, scoreA: 0, scoreB: 0, version: 0, status: "waiting", startedAt: null, firstServerMethod: "manual", currentServerParticipantId: null };
    const started = { ...waiting, status: "in_progress", currentServerParticipantId: "p-b" };
    const held = deferred<{ match: typeof started }>();
    getMatch.mockResolvedValue({ match: waiting });
    startMatch.mockResolvedValue({ match: started });
    judgeSetup.mockReturnValueOnce(held.promise).mockResolvedValueOnce({ match: { ...started, currentServerParticipantId: "p-a" } });
    renderJudge();
    await screen.findByTestId("judge-setup");
    await user.click(screen.getByRole("radio", { name: /борис/i }));
    await user.click(screen.getByRole("button", { name: /начать матч/i }));
    await waitFor(() => expect(judgeSetup).toHaveBeenCalledTimes(1));
    expect(startMatch).toHaveBeenCalledTimes(1);
    expect(judgeSetup).toHaveBeenCalledWith("m1", { firstServerParticipantId: "p-b", swapSides: false });
    expect(screen.getByRole("radio", { name: /борис/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /поменять стороны/i })).toBeDisabled();
    await act(async () => held.reject(Object.assign(new Error("Выберите подающего"), { status: 400, code: "VALIDATION" })));
    expect(await screen.findByRole("alert")).toHaveTextContent("Выберите подающего");
    await user.click(screen.getByRole("radio", { name: /анна/i }));
    await user.click(screen.getByRole("button", { name: /начать матч/i }));
    await waitFor(() => expect(judgeSetup).toHaveBeenCalledTimes(2));
    expect(judgeSetup).toHaveBeenLastCalledWith("m1", { firstServerParticipantId: "p-a", swapSides: false });
    expect(startMatch).toHaveBeenCalledTimes(1);
  });

  it("BUG-026 never repeats an unknown judgeSetup after a GET", async () => {
    const user = userEvent.setup();
    const waiting = { ...matchBody, scoreA: 0, scoreB: 0, version: 0, status: "waiting", startedAt: null, firstServerMethod: "random", currentServerParticipantId: null };
    const started = { ...waiting, status: "in_progress", currentServerParticipantId: "p-b" };
    getMatch.mockResolvedValue({ match: waiting });
    startMatch.mockResolvedValue({ match: started });
    judgeSetup.mockRejectedValueOnce(Object.assign(new Error("Нет ответа"), { status: 503 }));
    renderJudge();
    await screen.findByTestId("judge-setup");
    await user.click(screen.getByRole("button", { name: /начать матч/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/исход.*неизвестен/i);
    const readsBefore = getMatch.mock.calls.length;
    await act(async () => setDocumentVisibility("hidden"));
    await act(async () => setDocumentVisibility("visible"));
    await waitFor(() => expect(getMatch.mock.calls.length).toBeGreaterThan(readsBefore));
    expect(screen.getByRole("button", { name: /начать матч/i })).toBeDisabled();
    expect(startMatch).toHaveBeenCalledTimes(1);
    expect(judgeSetup).toHaveBeenCalledTimes(1);
  });

  it("BUG-026 does not replay an unknown first start after an early waiting GET", async () => {
    const waiting = { ...matchBody, scoreA: 0, scoreB: 0, status: "waiting", startedAt: null, firstServerMethod: "manual", currentServerParticipantId: null };
    getMatch.mockResolvedValue({ match: waiting });
    startMatch.mockRejectedValueOnce(Object.assign(new Error("Ответ потерян"), { status: 503 }));
    const user = userEvent.setup();
    renderJudge();
    await screen.findByTestId("judge-setup");
    await user.click(screen.getByRole("radio", { name: /борис/i }));
    await user.click(screen.getByRole("button", { name: /начать матч/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/исход.*неизвестен/i);
    const readsBefore = getMatch.mock.calls.length;
    await act(async () => setDocumentVisibility("hidden"));
    await act(async () => setDocumentVisibility("visible"));
    await waitFor(() => expect(getMatch.mock.calls.length).toBeGreaterThan(readsBefore));
    expect(screen.getByRole("button", { name: /начать матч/i })).toBeDisabled();
    expect(startMatch).toHaveBeenCalledTimes(1);
    expect(judgeSetup).not.toHaveBeenCalled();
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

  it("GAP-030 Home waits for judge release and reports success at Home", async () => {
    const user = userEvent.setup();
    const release = deferred<{ ok: boolean }>();
    releaseJudge.mockReturnValue(release.promise);
    renderJudge();

    await screen.findByTestId("judge-screen");
    await user.click(screen.getByRole("button", { name: "На главную" }));
    expect(releaseJudge).toHaveBeenCalledWith("m1");
    expect(screen.getByTestId("judge-screen")).toBeInTheDocument();

    await act(async () => {
      release.resolve({ ok: true });
      await release.promise;
    });
    expect(await screen.findByText("home")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/слот судьи освобождён/i);
  });

  it("GAP-005 blocks setup cancellation while start is pending", async () => {
    const user = userEvent.setup();
    const start = deferred<{ match: typeof matchBody }>();
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
    startMatch.mockReturnValueOnce(start.promise);
    renderJudge();

    await screen.findByTestId("judge-setup");
    await user.click(screen.getByTestId("judge-side-B"));
    await user.click(screen.getByRole("button", { name: /начать матч/i }));

    const cancel = screen.getByRole("button", { name: "Отмена" });
    expect(cancel).toBeDisabled();
    await user.click(cancel);
    expect(releaseJudge).not.toHaveBeenCalled();
    expect(screen.getByTestId("judge-setup")).toBeInTheDocument();
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

  it("GAP-005 visibly blocks navigation and More while confirmation is pending", async () => {
    const user = userEvent.setup();
    const confirmation = deferred<{ match: typeof matchBody }>();
    getMatch.mockResolvedValue({
      match: { ...matchBody, status: "pending_confirmation" },
    });
    confirmFinish.mockReturnValueOnce(confirmation.promise);
    renderJudge();
    await screen.findByTestId("judge-screen");

    await user.click(screen.getByRole("button", { name: /подтвердить результат/i }));

    expect(screen.getByRole("button", { name: "Назад" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ещё" })).toBeDisabled();
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

  it("GAP-005 lets the active judge make an auditable score and server correction", async () => {
    const user = userEvent.setup();
    manualCorrection.mockResolvedValue({
      match: { ...matchBody, scoreA: 4, scoreB: 4, version: 6 },
    });
    renderJudge();
    await screen.findByTestId("judge-screen");
    await user.click(screen.getByRole("button", { name: "Ещё" }));
    await user.click(screen.getByRole("button", { name: /исправить счёт и подачу/i }));
    const labelA = screen.getByText("Счёт стороны A", { selector: "label" });
    const labelB = screen.getByText("Счёт стороны B", { selector: "label" });
    expect(labelA).toHaveAttribute("for", screen.getByRole("spinbutton", { name: "Счёт стороны A" }).id);
    expect(labelB).toHaveAttribute("for", screen.getByRole("spinbutton", { name: "Счёт стороны B" }).id);
    expect(labelA.getAttribute("for")).not.toBe(labelB.getAttribute("for"));
    await user.click(labelA);
    expect(screen.getByRole("spinbutton", { name: "Счёт стороны A" })).toHaveFocus();
    await user.clear(screen.getByLabelText("Счёт стороны A"));
    await user.type(screen.getByLabelText("Счёт стороны A"), "4");
    await user.clear(screen.getByLabelText("Счёт стороны B"));
    await user.type(screen.getByLabelText("Счёт стороны B"), "4");
    await user.click(screen.getByRole("button", { name: /сохранить коррекцию/i }));

    expect(manualCorrection).toHaveBeenCalledWith("m1", {
      scoreA: 4,
      scoreB: 4,
      currentServerParticipantId: "p-a",
      expectedVersion: 5,
    }, expect.any(String));
  });

  it("GAP-005 blocks scoring and every exit while a correction is open or pending", async () => {
    const user = userEvent.setup();
    const pendingCorrection = deferred<{ match: typeof matchBody }>();
    manualCorrection.mockReturnValueOnce(pendingCorrection.promise);
    renderJudge();
    await screen.findByTestId("judge-screen");
    await user.click(screen.getByRole("button", { name: "Ещё" }));
    await user.click(screen.getByRole("button", { name: /исправить счёт и подачу/i }));

    expect(screen.getByRole("button", { name: /\+1 очко: анна/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Назад" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /сохранить коррекцию/i }));
    expect(screen.getByRole("button", { name: /сохраняем/i })).toBeDisabled();
    expect(awardPoint).not.toHaveBeenCalled();
    expect(releaseJudge).not.toHaveBeenCalled();

    pendingCorrection.resolve({ match: { ...matchBody, version: 6 } });
    await waitFor(() => expect(screen.queryByRole("region", { name: /ручная коррекция/i })).not.toBeInTheDocument());
  });

  it("GAP-005 visibly blocks navigation and More while undo is pending", async () => {
    const user = userEvent.setup();
    const pendingUndo = deferred<{ match: typeof matchBody }>();
    undoPoint.mockReturnValueOnce(pendingUndo.promise);
    renderJudge();
    await screen.findByTestId("judge-screen");

    await user.click(screen.getByRole("button", { name: /отменить последнее очко/i }));

    expect(screen.getByRole("button", { name: "Назад" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ещё" })).toBeDisabled();
  });

  it("GAP-005 reserves handover for a selected active user before leaving", async () => {
    const user = userEvent.setup();
    directory.mockResolvedValue({ users: [{ id: "u2", displayName: "Новый Судья" }] });
    handoverJudge.mockResolvedValue({ reservation: { userId: "u2", displayName: "Новый Судья" } });
    renderJudge();
    await screen.findByTestId("judge-screen");
    await user.click(screen.getByRole("button", { name: "Ещё" }));
    await user.selectOptions(await screen.findByLabelText("Передать судейство"), "u2");
    await user.click(screen.getByRole("button", { name: /передать слот/i }));

    expect(handoverJudge).toHaveBeenCalledWith("m1", "u2");
    expect(await screen.findByText("match-detail")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/судейство передано/i);
  });

  it("MATCH-008: a noncreator judge saves setup and waits for creator start", async () => {
    const waiting = {
      ...matchBody,
      status: "waiting",
      startedAt: null,
      scoreA: 0,
      scoreB: 0,
      version: 0,
      firstServerMethod: "manual",
      currentServerParticipantId: null,
      createdByUserId: "creator",
      activeJudge: { userId: "judge", displayName: "Judge User" },
    };
    getMatch.mockResolvedValue({ match: waiting });
    judgeSetup.mockResolvedValue({
      match: { ...waiting, currentServerParticipantId: "p-b" },
    });
    const user = userEvent.setup();
    renderJudge();
    await screen.findByTestId("judge-setup");
    await user.click(screen.getByRole("radio", { name: /борис/i }));
    await user.click(screen.getByRole("button", { name: /сохранить подготовку/i }));

    expect(judgeSetup).toHaveBeenCalledWith("m1", {
      firstServerParticipantId: "p-b",
      swapSides: false,
    });
    expect(startMatch).not.toHaveBeenCalled();
    expect(await screen.findByRole("status", { name: /ожидаем запуска/i })).toBeInTheDocument();
  });

  it("blocks confirm, revert, undo and exit while handover is pending", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ reservation: { userId: string; displayName: string } }>();
    getMatch.mockResolvedValue({
      match: { ...matchBody, status: "pending_confirmation" },
    });
    directory.mockResolvedValue({ users: [{ id: "u2", displayName: "Новый Судья" }] });
    handoverJudge.mockReturnValueOnce(pending.promise);
    renderJudge();
    await screen.findByTestId("judge-screen");
    await user.click(screen.getByRole("button", { name: "Ещё" }));
    await user.selectOptions(await screen.findByLabelText("Передать судейство"), "u2");
    await user.click(screen.getByRole("button", { name: /передать слот/i }));

    for (const button of screen.getAllByRole("button", { name: /подтвердить результат/i })) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: /продолжить игру/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /отменить последнее очко/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Назад" })).toBeDisabled();
    expect(confirmFinish).not.toHaveBeenCalled();
    expect(revertFinish).not.toHaveBeenCalled();
    expect(undoPoint).not.toHaveBeenCalled();
    expect(releaseJudge).not.toHaveBeenCalled();

    pending.resolve({ reservation: { userId: "u2", displayName: "Новый Судья" } });
    expect(await screen.findByText("match-detail")).toBeInTheDocument();
  });
});
