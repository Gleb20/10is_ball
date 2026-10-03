import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { MatchCreatePage } from "./MatchCreatePage";
import { AuthProvider, useAuth } from "../auth";
import {
  emptyPreparationSlots,
  holdPreparationForGuestCatalogue,
} from "./matchPreparation";
import { clearHeldGuestIdentityMutationForTests } from "../useGuestIdentityMutation";

const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const U4 = "44444444-4444-4444-8444-444444444444";
const U5 = "55555555-5555-4555-8555-555555555555";
const GUEST = "66666666-6666-4666-8666-666666666666";
const MATCH = "99999999-9999-4999-8999-999999999999";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const mocks = vi.hoisted(() => ({
  matchCreateOptions: vi.fn(),
  launchMatch: vi.fn(),
  getMatchLaunchOutcome: vi.fn(),
  getMatch: vi.fn(),
  heartbeatJudge: vi.fn(),
  listGuests: vi.fn(),
  createGuest: vi.fn(),
}));

vi.mock("../api", () => ({
  api: {
    me: vi.fn().mockResolvedValue({
      user: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        email: "operator@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "Ольга",
        lastName: "Оператор",
      },
    }),
    matchCreateOptions: (...args: unknown[]) => mocks.matchCreateOptions(...args),
    launchMatch: (...args: unknown[]) => mocks.launchMatch(...args),
    getMatchLaunchOutcome: (...args: unknown[]) => mocks.getMatchLaunchOutcome(...args),
    getMatch: (...args: unknown[]) => mocks.getMatch(...args),
    heartbeatJudge: (...args: unknown[]) => mocks.heartbeatJudge(...args),
    listGuests: (...args: unknown[]) => mocks.listGuests(...args),
    createGuest: (...args: unknown[]) => mocks.createGuest(...args),
  },
}));

const { matchCreateOptions, launchMatch, getMatchLaunchOutcome, getMatch, heartbeatJudge, listGuests, createGuest } = mocks;
let restoreRandomUUID: (() => void) | undefined;

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}|{JSON.stringify(location.state)}</output>;
}

function renderPage(entry: string | { pathname: string; state?: unknown } = "/matches/new") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <Routes>
          <Route path="/matches/new" element={<><MatchCreatePage /><LocationProbe /></>} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function SameActorReauth() {
  const { user, setUser } = useAuth();
  return <button type="button" disabled={!user} onClick={() => {
    if (!user) return;
    setUser(null);
    setUser(user);
  }}>Reauthenticate same actor</button>;
}

function activityPage(mode: "visible" | "hidden") {
  return (
    <MemoryRouter initialEntries={["/matches/new"]}>
      <AuthProvider>
        <SameActorReauth />
        <Activity mode={mode}>
          <Routes>
            <Route path="/matches/new" element={<MatchCreatePage />} />
            <Route path="*" element={<div>Destination</div>} />
          </Routes>
        </Activity>
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>
  );
}

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole("button", { name: "Настройки" });
  await user.click(button);
  return screen.getByRole("dialog", { name: "Настройки матча" });
}

async function selectPlayer(user: ReturnType<typeof userEvent.setup>, field: string, label: string) {
  const input = screen.getByRole("combobox", { name: field });
  await user.click(input);
  await user.click(await screen.findByRole("option", { name: label }));
}

async function useGuest(user: ReturnType<typeof userEvent.setup>, groupName: string, guestName: string) {
  const group = screen.getByRole("group", { name: groupName });
  await user.click(within(group).getByRole("button", { name: "Гость" }));
  await user.type(within(group).getByRole("textbox", { name: /гость/i }), guestName);
}

describe("GAP-013 atomic judge-shaped preparation", () => {
  afterEach(() => {
    vi.useRealTimers();
    restoreRandomUUID?.();
    restoreRandomUUID = undefined;
  });

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    clearHeldGuestIdentityMutationForTests();
    matchCreateOptions.mockResolvedValue({
      users: [
        { id: U2, firstName: "Альфа", lastName: "Один" },
        { id: U3, firstName: "Альфа", lastName: "Два" },
        { id: U4, firstName: "Бета", lastName: "Один" },
        { id: U5, firstName: "Бета", lastName: "Два" },
      ],
      teams: [{ id: "t1", name: "Бета команда", userIds: [U4, U5] }],
      recentOpponentIds: [U4],
      frequentOpponentIds: [U5],
    });
    launchMatch.mockResolvedValue({ requestId: "ignored", matchId: MATCH });
    getMatchLaunchOutcome.mockResolvedValue({ outcome: "unknown" });
    getMatch.mockResolvedValue({ match: { id: MATCH, status: "in_progress" } });
    heartbeatJudge.mockResolvedValue({ ok: true });
    listGuests.mockResolvedValue({
      guests: [{
        id: GUEST,
        firstName: "Гость",
        lastName: "Сохранённый",
        displayName: "Сохранённый Гость",
        avatarKey: "avatar_6",
        version: 0,
        canRename: true,
        createdAt: "2026-10-03T12:00:00.000Z",
        updatedAt: "2026-10-03T12:00:00.000Z",
      }],
      nextCursor: null,
    });
  });

  it("opens directly as the dark two-side surface with the operator outside and no server draft", async () => {
    const { container } = renderPage();
    const form = await screen.findByRole("form", { name: "Создание матча" });
    expect(form).toHaveClass("judge-screen", "match-create");
    expect(container.querySelectorAll(".judge-side")).toHaveLength(2);
    expect(screen.getByRole("group", { name: "Игрок A" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Соперник" })).toBeVisible();
    expect(screen.queryByText("Оператор играет")).not.toBeInTheDocument();
    expect(launchMatch).not.toHaveBeenCalled();
    expect(getMatchLaunchOutcome).not.toHaveBeenCalled();
  });

  it("keeps settings in the corner dialog, returns focus, and applies D38 12 to 5 until manually overridden", async () => {
    const user = userEvent.setup();
    renderPage();
    const trigger = await screen.findByRole("button", { name: "Настройки" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Своё" }));
    const points = screen.getByRole("spinbutton", { name: "Своё значение" });
    const mercy = screen.getByRole("spinbutton", { name: "Порог" });
    await user.clear(points);
    await user.type(points, "12");
    expect(mercy).toHaveValue(5);
    await user.clear(mercy);
    await user.type(mercy, "7");
    await user.click(screen.getByRole("button", { name: "21" }));
    expect(mercy).toHaveValue(7);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps exact B1/B2 quick-choice preview and submits one swapped canonical 2x2 launch", async () => {
    const held = deferred<{ requestId: string; matchId: string }>();
    launchMatch.mockReturnValueOnce(held.promise);
    const user = userEvent.setup();
    renderPage();
    const settings = await openSettings(user);
    await user.click(within(settings).getByRole("button", { name: "2 × 2" }));
    await user.click(within(settings).getByRole("button", { name: "Готово" }));
    await selectPlayer(user, "Игрок A", "Альфа Один");
    await selectPlayer(user, "Партнёр", "Альфа Два");
    await user.click(screen.getByRole("button", { name: "Бета команда" }));
    const preview = screen.getByRole("region", { name: "Предпросмотр быстрого выбора" });
    expect(preview).toHaveTextContent("B1: Бета Один");
    expect(preview).toHaveTextContent("B2: Бета Два");
    await user.click(within(preview).getByRole("button", { name: "Применить" }));

    await user.click(screen.getByRole("button", { name: "Начать" }));
    expect(launchMatch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Поменять стороны стола" }));
    await user.click(screen.getByRole("button", { name: /Бета Два.*Подаёт первым/ }));

    expect(launchMatch).toHaveBeenCalledTimes(1);
    const payload = launchMatch.mock.calls[0]![0];
    expect(payload).toMatchObject({
      format: "2v2",
      firstServerMethod: "manual",
      firstServerSlot: "A2",
      roster: {
        A1: { userId: U4 }, A2: { userId: U5 },
        B1: { userId: U2 }, B2: { userId: U3 },
      },
    });
    expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByText(/Проверяем запуск матча/)).toBeVisible();
    held.resolve({ requestId: payload.requestId, matchId: MATCH });
  });

  it("backs out of serve selection without a POST and retains the draft", async () => {
    const user = userEvent.setup();
    renderPage();
    await selectPlayer(user, "Игрок A", "Альфа Один");
    await useGuest(user, "Соперник", "Гость Второй");
    await user.click(screen.getByRole("button", { name: "Начать" }));
    await user.click(screen.getByRole("button", { name: "Назад к составу" }));
    expect(launchMatch).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Игрок A" })).toHaveValue("Альфа Один");
    expect(screen.getByRole("textbox", { name: /Соперник — гость/i })).toHaveValue("Гость Второй");
  });

  it("launches only the explicitly selected reusable guest id", async () => {
    const user = userEvent.setup();
    renderPage();
    await selectPlayer(user, "Игрок A", "Альфа Один");
    const group = screen.getByRole("group", { name: "Соперник" });
    await user.click(within(group).getByRole("button", { name: "Гость" }));
    await user.click(within(group).getByRole("button", { name: "Сохранённый" }));
    const picker = within(group).getByRole("combobox", { name: "Соперник — сохранённый гость" });
    await waitFor(() => expect(picker).toBeEnabled());
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: "Сохранённый Гость · № 666666" }));

    await user.click(screen.getByRole("button", { name: "Начать" }));
    await user.click(screen.getByRole("button", { name: /Альфа Один.*Подаёт первым/ }));

    expect(launchMatch.mock.calls[0]?.[0]).toMatchObject({
      roster: {
        A1: { userId: U2 },
        B1: { guestIdentityId: GUEST },
      },
    });
    expect(launchMatch.mock.calls[0]?.[0].roster.B1).not.toHaveProperty("guestFirstName");
  });

  it("sends random explicitly without a server slot and never calls a point mutation", async () => {
    const held = deferred<{ requestId: string; matchId: string }>();
    launchMatch.mockReturnValueOnce(held.promise);
    const user = userEvent.setup();
    renderPage();
    const settings = await openSettings(user);
    await user.click(within(settings).getByRole("button", { name: "Случайно" }));
    await user.click(within(settings).getByRole("button", { name: "Готово" }));
    await selectPlayer(user, "Игрок A", "Альфа Один");
    await useGuest(user, "Соперник", "Гость Второй");
    await user.click(screen.getByRole("button", { name: "Начать" }));
    await user.click(screen.getByRole("button", { name: "Определить подачу случайно" }));
    const payload = launchMatch.mock.calls[0]![0];
    expect(payload.firstServerMethod).toBe("random");
    expect(payload).not.toHaveProperty("firstServerSlot");
    expect(launchMatch).toHaveBeenCalledTimes(1);
  });

  it("returns a known busy rejection to the editable draft without a phantom match", async () => {
    launchMatch.mockRejectedValueOnce(Object.assign(new Error("Игрок уже занят"), { status: 409 }));
    const user = userEvent.setup();
    renderPage();
    await selectPlayer(user, "Игрок A", "Альфа Один");
    await useGuest(user, "Соперник", "Гость Второй");
    await user.click(screen.getByRole("button", { name: "Начать" }));
    await user.click(screen.getByRole("button", { name: /Альфа Один.*Подаёт первым/ }));
    expect(await screen.findByText("Игрок уже занят")).toBeVisible();
    expect(screen.getByRole("button", { name: "Начать" })).toBeEnabled();
    expect(getMatch).not.toHaveBeenCalled();
  });

  it("reconciles a lost response by GET, never auto-reposts, and retries only the frozen key and payload", async () => {
    launchMatch.mockRejectedValueOnce(new Error("connection lost"));
    getMatchLaunchOutcome.mockResolvedValueOnce({ outcome: "unknown" });
    const retry = deferred<{ requestId: string; matchId: string }>();
    launchMatch.mockReturnValueOnce(retry.promise);
    const user = userEvent.setup();
    renderPage();
    await selectPlayer(user, "Игрок A", "Альфа Один");
    await useGuest(user, "Соперник", "Гость Второй");
    await user.click(screen.getByRole("button", { name: "Начать" }));
    await user.click(screen.getByRole("button", { name: /Альфа Один.*Подаёт первым/ }));

    expect(await screen.findByText("Результат запуска ещё не подтверждён")).toBeVisible();
    expect(getMatchLaunchOutcome).toHaveBeenCalledTimes(1);
    expect(launchMatch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Начать" })).not.toBeInTheDocument();
    const frozen = launchMatch.mock.calls[0]![0];
    await user.click(screen.getByRole("button", { name: "Повторить тот же запуск" }));
    expect(launchMatch).toHaveBeenCalledTimes(2);
    expect(launchMatch.mock.calls[1]![0]).toBe(frozen);
  });

  it("moves an indefinitely pending launch to frozen unknown recovery without another POST", async () => {
    launchMatch.mockReturnValueOnce(new Promise(() => {}));
    const user = userEvent.setup();
    renderPage();
    await selectPlayer(user, "Игрок A", "Альфа Один");
    await useGuest(user, "Соперник", "Гость Второй");
    await user.click(screen.getByRole("button", { name: "Начать" }));

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: /Альфа Один.*Подаёт первым/ }));
    expect(launchMatch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });

    expect(screen.getByText("Результат запуска ещё не подтверждён")).toBeVisible();
    expect(screen.getByRole("button", { name: "Проверить ещё раз" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Повторить тот же запуск" })).not.toBeInTheDocument();
    expect(getMatchLaunchOutcome).not.toHaveBeenCalled();
    expect(launchMatch).toHaveBeenCalledTimes(1);
  });

  it("returns an indefinitely pending receipt GET to unknown recovery without a POST", async () => {
    launchMatch.mockRejectedValueOnce(new Error("connection lost"));
    getMatchLaunchOutcome.mockReturnValueOnce(new Promise(() => {}));
    const user = userEvent.setup();
    renderPage();
    await selectPlayer(user, "Игрок A", "Альфа Один");
    await useGuest(user, "Соперник", "Гость Второй");
    await user.click(screen.getByRole("button", { name: "Начать" }));

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: /Альфа Один.*Подаёт первым/ }));
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(getMatchLaunchOutcome).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Результат запуска ещё не подтверждён")).toBeVisible();
    expect(screen.getByRole("button", { name: "Проверить ещё раз" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Повторить тот же запуск" })).not.toBeInTheDocument();
    expect(launchMatch).toHaveBeenCalledTimes(1);
  });

  it("resumes from an interrupted Activity launch and lets only the fresh receipt navigate", async () => {
    const staleLaunch = deferred<{ requestId: string; matchId: string }>();
    const freshReceipt = deferred<{ outcome: "committed"; matchId: string }>();
    launchMatch.mockReturnValueOnce(staleLaunch.promise);
    getMatchLaunchOutcome.mockReturnValueOnce(freshReceipt.promise);
    const user = userEvent.setup();
    const view = render(activityPage("visible"));
    await selectPlayer(user, "Игрок A", "Альфа Один");
    await useGuest(user, "Соперник", "Гость Второй");
    await user.click(screen.getByRole("button", { name: "Начать" }));
    await user.click(screen.getByRole("button", { name: /Альфа Один.*Подаёт первым/ }));
    expect(launchMatch).toHaveBeenCalledTimes(1);

    view.rerender(activityPage("hidden"));
    view.rerender(activityPage("visible"));
    expect(await screen.findByText("Результат запуска ещё не подтверждён")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Проверить ещё раз" }));
    expect(getMatchLaunchOutcome).toHaveBeenCalledTimes(1);

    await act(async () => staleLaunch.resolve({ requestId: "stale", matchId: MATCH }));
    expect(getMatch).not.toHaveBeenCalled();
    expect(screen.getByTestId("location")).toHaveTextContent("/matches/new");

    await act(async () => freshReceipt.resolve({ outcome: "committed", matchId: MATCH }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/matches/${MATCH}/judge`));
    expect(getMatch).toHaveBeenCalledTimes(1);
    expect(heartbeatJudge).toHaveBeenCalledTimes(1);
  });

  it("ignores the old lifecycle watchdog while fresh receipt verification completes", async () => {
    launchMatch.mockReturnValueOnce(new Promise(() => {}));
    getMatchLaunchOutcome.mockResolvedValueOnce({ outcome: "committed", matchId: MATCH });
    const freshMatch = deferred<{ match: { id: string; status: string } }>();
    getMatch.mockReturnValueOnce(freshMatch.promise);
    const user = userEvent.setup();
    const view = render(activityPage("visible"));
    await selectPlayer(user, "Игрок A", "Альфа Один");
    await useGuest(user, "Соперник", "Гость Второй");
    await user.click(screen.getByRole("button", { name: "Начать" }));

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: /Альфа Один.*Подаёт первым/ }));
    view.rerender(activityPage("hidden"));
    view.rerender(activityPage("visible"));
    expect(screen.getByText("Результат запуска ещё не подтверждён")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Проверить ещё раз" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(getMatch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Проверяем запуск матча/)).toBeVisible();

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByText(/Проверяем запуск матча/)).toBeVisible();
    expect(screen.queryByText("Результат запуска ещё не подтверждён")).not.toBeInTheDocument();

    await act(async () => freshMatch.resolve({ match: { id: MATCH, status: "in_progress" } }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/matches/${MATCH}/judge`);
    expect(heartbeatJudge).toHaveBeenCalledTimes(1);
  });

  it("ignores a delayed directory response from before same-actor reauthentication", async () => {
    const staleDirectory = deferred<Awaited<ReturnType<typeof matchCreateOptions>>>();
    matchCreateOptions
      .mockReturnValueOnce(staleDirectory.promise)
      .mockResolvedValueOnce({
        users: [{ id: U3, firstName: "Новый", lastName: "Игрок" }],
        teams: [], recentOpponentIds: [], frequentOpponentIds: [],
      });
    const user = userEvent.setup();
    render(activityPage("visible"));
    await waitFor(() => expect(matchCreateOptions).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Reauthenticate same actor" }));
    await waitFor(() => expect(matchCreateOptions).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("combobox", { name: "Игрок A" }));
    expect(await screen.findByRole("option", { name: "Новый Игрок" })).toBeVisible();

    await act(async () => staleDirectory.resolve({
      users: [{ id: U2, firstName: "Старый", lastName: "Игрок" }],
      teams: [], recentOpponentIds: [], frequentOpponentIds: [],
    }));
    expect(screen.getByRole("option", { name: "Новый Игрок" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "Старый Игрок" })).not.toBeInTheDocument();
  });

  it("ignores a delayed directory response from a hidden Activity lifecycle", async () => {
    const staleDirectory = deferred<Awaited<ReturnType<typeof matchCreateOptions>>>();
    matchCreateOptions
      .mockReturnValueOnce(staleDirectory.promise)
      .mockResolvedValueOnce({
        users: [{ id: U4, firstName: "Свежий", lastName: "Игрок" }],
        teams: [], recentOpponentIds: [], frequentOpponentIds: [],
      });
    const user = userEvent.setup();
    const view = render(activityPage("visible"));
    await waitFor(() => expect(matchCreateOptions).toHaveBeenCalledTimes(1));
    view.rerender(activityPage("hidden"));
    view.rerender(activityPage("visible"));
    await waitFor(() => expect(matchCreateOptions).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("combobox", { name: "Игрок A" }));
    expect(await screen.findByRole("option", { name: "Свежий Игрок" })).toBeVisible();

    await act(async () => staleDirectory.resolve({
      users: [{ id: U2, firstName: "Старый", lastName: "Игрок" }],
      teams: [], recentOpponentIds: [], frequentOpponentIds: [],
    }));
    expect(screen.getByRole("option", { name: "Свежий Игрок" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "Старый Игрок" })).not.toBeInTheDocument();
  });

  it("uses committed receipt then fresh match GET and heartbeat before judge handoff", async () => {
    launchMatch.mockRejectedValueOnce(new Error("connection lost"));
    getMatchLaunchOutcome.mockResolvedValueOnce({ outcome: "committed", matchId: MATCH });
    const user = userEvent.setup();
    renderPage();
    await selectPlayer(user, "Игрок A", "Альфа Один");
    await useGuest(user, "Соперник", "Гость Второй");
    await user.click(screen.getByRole("button", { name: "Начать" }));
    await user.click(screen.getByRole("button", { name: /Альфа Один.*Подаёт первым/ }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/matches/${MATCH}/judge`));
    expect(getMatch).toHaveBeenCalledWith(MATCH);
    expect(heartbeatJudge).toHaveBeenCalledWith(MATCH);
    expect(getMatch.mock.invocationCallOrder[0]).toBeLessThan(heartbeatJudge.mock.invocationCallOrder[0]);
  });

  it("treats a committed match that fresh GET cannot find as terminal and never launches another", async () => {
    launchMatch.mockResolvedValueOnce({ requestId: "ignored", matchId: MATCH });
    getMatch.mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }));
    const user = userEvent.setup();
    renderPage();
    await selectPlayer(user, "Игрок A", "Альфа Один");
    await useGuest(user, "Соперник", "Гость Второй");
    await user.click(screen.getByRole("button", { name: "Начать" }));
    await user.click(screen.getByRole("button", { name: /Альфа Один.*Подаёт первым/ }));
    expect(await screen.findByText(/создан, но больше недоступен/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Открыть матч" })).toBeVisible();
    expect(launchMatch).toHaveBeenCalledTimes(1);
    expect(heartbeatJudge).not.toHaveBeenCalled();
  });

  it("keeps autocomplete focus behavior and directory retry while supporting guest fallback", async () => {
    matchCreateOptions.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ users: [{ id: U2, firstName: "Альфа", lastName: "Один" }], teams: [], recentOpponentIds: [], frequentOpponentIds: [] });
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("Список игроков недоступен")).toBeVisible();
    await useGuest(user, "Игрок A", "Гость Первый");
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(matchCreateOptions).toHaveBeenCalledTimes(2));
    const group = screen.getByRole("group", { name: "Игрок A" });
    await user.click(within(group).getByRole("button", { name: "Игрок" }));
    const input = within(group).getByRole("combobox", { name: "Игрок A" });
    await user.type(input, "Альфа");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(input).toHaveValue("Альфа Один");
    expect(input).toHaveFocus();
  });

  it("consumes a matching replay seed once and clears router state so reload cannot recreate it", async () => {
    renderPage({
      pathname: "/matches/new",
      state: {
        matchReplaySeed: {
          actorId: ACTOR,
          title: "Повтор финала",
          format: "1v1",
          pointsToWin: 11,
          mercyEnabled: true,
          mercyPoints: 5,
          firstServerMethod: "rally",
          creatorParticipates: true,
          slots: {
            playerA: { mode: "user", userId: "", userLabel: "", guestName: "" },
            partner: { mode: "user", userId: "", userLabel: "", guestName: "" },
            opponent1: { mode: "guest", userId: "", userLabel: "", guestName: "Борис Второй" },
            opponent2: { mode: "user", userId: "", userLabel: "", guestName: "" },
          },
        },
      },
    });
    expect(await screen.findByText("Повтор финала")).toBeVisible();
    expect(screen.getByText("Оператор играет")).toBeVisible();
    expect(screen.getByRole("textbox", { name: /Соперник — гость/i })).toHaveValue("Борис Второй");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/matches/new|null"));
  });

  it("removes legacy challenge intent without selecting or launching anyone", async () => {
    renderPage("/matches/new?opponentId=legacy&opponentName=Old&source=revenge&returnTo=home");
    expect(await screen.findByTestId("location")).toHaveTextContent("/matches/new?returnTo=home");
    expect(screen.getByRole("combobox", { name: "Соперник" })).toHaveValue("");
    expect(launchMatch).not.toHaveBeenCalled();
  });

  it("keeps an uncertain create owned by its exact 2v2 draft slot and requires explicit recovered selection", async () => {
    const draftA = "11111111-1111-4111-8111-111111111111";
    const requestId = "22222222-2222-4222-8222-222222222222";
    const draftB = "33333333-3333-4333-8333-333333333333";
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(draftA)
      .mockReturnValue(requestId);
    restoreRandomUUID = () => randomUUID.mockRestore();
    createGuest.mockRejectedValueOnce(Object.assign(new Error("network"), { status: 0 }));
    const user = userEvent.setup();
    const first = renderPage();
    const settings = await openSettings(user);
    await user.click(within(settings).getByRole("button", { name: "2 × 2" }));
    await user.click(within(settings).getByRole("button", { name: "Готово" }));

    const partner = screen.getByRole("group", { name: "Партнёр" });
    await user.click(within(partner).getByRole("button", { name: "Гость" }));
    await user.click(within(partner).getByRole("button", { name: "Сохранённый" }));
    await user.click(within(partner).getByRole("button", { name: "Создать гостя" }));
    const dialog = screen.getByRole("dialog", { name: "Новый сохранённый гость" });
    await user.type(within(dialog).getByLabelText("Имя"), "Анна");
    await user.type(within(dialog).getByLabelText("Фамилия"), "Первая");
    await user.click(within(dialog).getByRole("button", { name: "Создать и выбрать" }));
    expect(await within(dialog).findByText("Статус сохранения неизвестен")).toBeInTheDocument();
    await user.click(within(dialog).getAllByRole("button", { name: "Закрыть" })[1]!);
    expect(within(partner).getByText("Статус сохранения неизвестен")).toBeInTheDocument();

    const opponent2 = screen.getByRole("group", { name: "Соперник 2" });
    await user.click(within(opponent2).getByRole("button", { name: "Гость" }));
    await user.click(within(opponent2).getByRole("button", { name: "Сохранённый" }));
    expect(within(opponent2).queryByText("Статус сохранения неизвестен")).not.toBeInTheDocument();
    first.unmount();

    randomUUID.mockReturnValue(draftB);
    const second = renderPage();
    const secondSettings = await openSettings(user);
    await user.click(within(secondSettings).getByRole("button", { name: "2 × 2" }));
    await user.click(within(secondSettings).getByRole("button", { name: "Готово" }));
    const newDraftPartner = screen.getByRole("group", { name: "Партнёр" });
    await user.click(within(newDraftPartner).getByRole("button", { name: "Гость" }));
    await user.click(within(newDraftPartner).getByRole("button", { name: "Сохранённый" }));
    expect(within(newDraftPartner).queryByText("Статус сохранения неизвестен")).not.toBeInTheDocument();
    second.unmount();

    const restoredSlots = emptyPreparationSlots();
    restoredSlots.partner = {
      mode: "guest",
      userId: "",
      userLabel: "",
      guestName: "",
      guestIdentityId: "",
      guestIdentityLabel: "",
    };
    holdPreparationForGuestCatalogue({
      actorId: ACTOR,
      title: "Возврат к слоту A",
      format: "2v2",
      pointsToWin: 11,
      mercyEnabled: true,
      mercyPoints: 5,
      firstServerMethod: "manual",
      creatorParticipates: false,
      slots: restoredSlots,
    }, draftA);
    createGuest.mockResolvedValueOnce({ guest: {
      id: GUEST,
      firstName: "Анна",
      lastName: "Первая",
      displayName: "Первая Анна",
      avatarKey: "avatar_6",
      version: 0,
      canRename: true,
      createdAt: "2026-10-03T12:00:00.000Z",
      updatedAt: "2026-10-03T12:00:00.000Z",
    } });
    renderPage({
      pathname: "/matches/new",
      state: { guestSelectionCancel: { kind: "match", draftToken: draftA, slotKey: "partner" } },
    });
    const restoredPartner = await screen.findByRole("group", { name: "Партнёр" });
    expect(await within(restoredPartner).findByText("Статус сохранения неизвестен")).toBeInTheDocument();
    await user.click(within(restoredPartner).getByRole("button", { name: "Повторить ту же попытку" }));

    expect(createGuest).toHaveBeenCalledTimes(2);
    expect(createGuest.mock.calls[1]?.[0]).toEqual(createGuest.mock.calls[0]?.[0]);
    expect(within(restoredPartner).queryByTestId("selected-guest")).not.toBeInTheDocument();
    await user.click(await within(restoredPartner).findByRole("button", { name: "Выбрать Первая Анна" }));
    expect(within(restoredPartner).getByTestId("selected-guest")).toHaveTextContent("Первая Анна");
  });
});
