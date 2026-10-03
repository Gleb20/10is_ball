import { Activity } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { OnboardingPage } from "./OnboardingPage";
import type { User } from "../api";

const mocks = vi.hoisted(() => ({
  user: null as User | null,
  setUser: vi.fn(),
  navigate: vi.fn(),
  me: vi.fn(),
  setOnboardingStep: vi.fn(),
  completeOnboarding: vi.fn(),
  tutorial: vi.fn(),
}));

vi.mock("../auth", () => ({
  useAuth: () => ({ user: mocks.user, setUser: mocks.setUser }),
}));

vi.mock("../api", () => ({
  api: {
    me: (...args: unknown[]) => mocks.me(...args),
    setOnboardingStep: (...args: unknown[]) => mocks.setOnboardingStep(...args),
    completeOnboarding: (...args: unknown[]) => mocks.completeOnboarding(...args),
    tutorial: (...args: unknown[]) => mocks.tutorial(...args),
  },
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

function user(id: string, step: number): User {
  return {
    id,
    email: `${id}@tab10.test`,
    role: "user",
    mustChangePassword: false,
    onboardingStep: step,
    onboardingCompletedAt: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = user("actor-a", 0);
});

it("ignores actor A progress success after unmount and actor B remount", async () => {
  const request = deferred<{ user: User }>();
  mocks.setOnboardingStep.mockReturnValue(request.promise);
  const first = render(<MemoryRouter><OnboardingPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Далее" }));

  first.unmount();
  mocks.user = user("actor-b", 0);
  render(<MemoryRouter><OnboardingPage /></MemoryRouter>);
  await act(async () => request.resolve({ user: user("actor-a", 1) }));

  expect(mocks.setUser).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Главная" })).toHaveFocus();
});

it("ignores actor A completion after unmount and actor B remount", async () => {
  const request = deferred<{ user: User }>();
  mocks.completeOnboarding.mockReturnValue(request.promise);
  const first = render(<MemoryRouter><OnboardingPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Закрыть обучение" }));

  first.unmount();
  mocks.user = user("actor-b", 0);
  render(<MemoryRouter><OnboardingPage /></MemoryRouter>);
  await act(async () => request.resolve({
    user: { ...user("actor-a", 6), onboardingCompletedAt: "2026-10-03T09:00:00.000Z" },
  }));

  expect(mocks.setUser).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("keeps a new tutorial request pending when an interrupted Activity request settles late", async () => {
  const firstTutorial = deferred<{ match: { id: string } }>();
  const secondTutorial = deferred<{ match: { id: string } }>();
  mocks.user = user("actor-a", 6);
  mocks.setOnboardingStep.mockResolvedValue({ user: user("actor-a", 6) });
  mocks.tutorial
    .mockReturnValueOnce(firstTutorial.promise)
    .mockReturnValueOnce(secondTutorial.promise);
  const viewFor = (mode: "visible" | "hidden") => (
    <MemoryRouter>
      <Activity mode={mode}><OnboardingPage /></Activity>
    </MemoryRouter>
  );
  const interaction = userEvent.setup();
  const view = render(viewFor("visible"));
  await interaction.click(screen.getByRole("button", { name: "Матч с Призрачным Олегом" }));
  await waitFor(() => expect(mocks.tutorial).toHaveBeenCalledTimes(1));

  view.rerender(viewFor("hidden"));
  view.rerender(viewFor("visible"));
  expect(await screen.findByText(/учебный матч мог быть создан/i)).toBeVisible();
  expect(screen.getByRole("alert")).toHaveFocus();
  const retry = screen.getByRole("button", { name: "Начать ещё один учебный матч" });
  expect(retry).toBeEnabled();

  await interaction.click(retry);
  await waitFor(() => expect(mocks.tutorial).toHaveBeenCalledTimes(2));
  const pendingRetry = screen.getByRole("button", { name: "Запускаем учебный матч…" });
  expect(pendingRetry).toBeDisabled();
  const setUserCallsBeforeLateResult = mocks.setUser.mock.calls.length;
  const focusBeforeLateResult = document.activeElement;
  await act(async () => firstTutorial.resolve({ match: { id: "tutorial-a" } }));

  expect(mocks.setUser).toHaveBeenCalledTimes(setUserCallsBeforeLateResult);
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Запускаем учебный матч…" })).toBeDisabled();
  expect(document.activeElement).toBe(focusBeforeLateResult);

  await act(async () => secondTutorial.resolve({ match: { id: "tutorial-b" } }));
  expect(mocks.navigate).toHaveBeenCalledWith("/matches/tutorial-b/judge?tutorial=1");
});

it("recovers interrupted tutorial progress with GET only and never auto-creates a match", async () => {
  const progressRequest = deferred<{ user: User }>();
  mocks.user = user("actor-a", 6);
  mocks.setOnboardingStep.mockReturnValue(progressRequest.promise);
  mocks.me.mockResolvedValue({ user: user("actor-a", 6) });
  const viewFor = (mode: "visible" | "hidden") => (
    <MemoryRouter>
      <Activity mode={mode}><OnboardingPage /></Activity>
    </MemoryRouter>
  );
  const view = render(viewFor("visible"));
  fireEvent.click(screen.getByRole("button", { name: "Матч с Призрачным Олегом" }));

  view.rerender(viewFor("hidden"));
  view.rerender(viewFor("visible"));

  expect(await screen.findByText("Прогресс сохранён")).toBeVisible();
  expect(mocks.me).toHaveBeenCalledTimes(1);
  expect(mocks.tutorial).not.toHaveBeenCalled();
  const setUserCallsBeforeLateResult = mocks.setUser.mock.calls.length;
  await act(async () => progressRequest.resolve({ user: user("actor-a", 6) }));
  expect(mocks.setUser).toHaveBeenCalledTimes(setUserCallsBeforeLateResult);
  expect(mocks.tutorial).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
});

it("ignores a late actor A error without moving focus in actor B", async () => {
  const request = deferred<{ user: User }>();
  mocks.setOnboardingStep.mockReturnValue(request.promise);
  const first = render(<MemoryRouter><OnboardingPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Далее" }));

  first.unmount();
  mocks.user = user("actor-b", 0);
  render(<MemoryRouter><OnboardingPage /></MemoryRouter>);
  await act(async () => request.reject(new TypeError("late failure")));

  expect(mocks.me).not.toHaveBeenCalled();
  expect(mocks.setUser).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Главная" })).toHaveFocus();
});
