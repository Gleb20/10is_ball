import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { App } from "../App";
import { HelpPage } from "./HelpPage";
import { TeamsPage } from "./TeamsPage";
import { TournamentsPage } from "./TournamentsPage";

const me = vi.fn();
const firstPasswordChange = vi.fn();
const faq = vi.fn();
const feedback = vi.fn();
const tutorial = vi.fn();
const completeOnboarding = vi.fn();
const setOnboardingStep = vi.fn();
const listTeams = vi.fn();
const createTeam = vi.fn();
const listTournaments = vi.fn();
const createTournament = vi.fn();

vi.mock("../api", () => ({
  api: {
    me: (...args: unknown[]) => me(...args),
    firstPasswordChange: (...args: unknown[]) =>
      firstPasswordChange(...args),
    faq: (...args: unknown[]) => faq(...args),
    feedback: (...args: unknown[]) => feedback(...args),
    tutorial: (...args: unknown[]) => tutorial(...args),
    completeOnboarding: (...args: unknown[]) =>
      completeOnboarding(...args),
    setOnboardingStep: (...args: unknown[]) => setOnboardingStep(...args),
    listTeams: (...args: unknown[]) => listTeams(...args),
    createTeam: (...args: unknown[]) => createTeam(...args),
    listTournaments: (...args: unknown[]) => listTournaments(...args),
    createTournament: (...args: unknown[]) => createTournament(...args),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("BUG-009 scoped critical form submission guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    me.mockResolvedValue({
      user: {
        id: "u1",
        email: "user@tab10.local",
        role: "user",
        mustChangePassword: true,
        firstName: "Test",
        lastName: "User",
      },
    });
    faq.mockResolvedValue({ articles: [] });
    listTeams.mockResolvedValue({ teams: [] });
    listTournaments.mockResolvedValue({ tournaments: [] });
  });

  it.each([
    {
      name: "team create",
      apiMock: createTeam,
      renderPage: () =>
        render(
          <MemoryRouter>
            <TeamsPage />
          </MemoryRouter>,
        ),
      buttonName: /^создать$/i,
    },
    {
      name: "tournament create",
      apiMock: createTournament,
      renderPage: () =>
        render(
          <MemoryRouter initialEntries={["/tournaments"]}>
            <Routes>
              <Route path="/tournaments" element={<TournamentsPage />} />
            </Routes>
          </MemoryRouter>,
        ),
      buttonName: /^создать$/i,
    },
    {
      name: "feedback",
      apiMock: feedback,
      renderPage: () =>
        render(
          <MemoryRouter>
            <HelpPage />
          </MemoryRouter>,
        ),
      buttonName: /^отправить$/i,
    },
  ])("keeps $name single-flight", async ({ apiMock, renderPage, buttonName }) => {
    const request = deferred<Record<string, unknown>>();
    apiMock.mockReturnValue(request.promise);
    renderPage();
    const submit = await screen.findByRole("button", { name: buttonName });
    const form = submit.closest("form") as HTMLFormElement;

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();
    request.resolve(
      apiMock === createTournament
        ? { tournament: { id: "t1" } }
        : apiMock === createTeam
          ? { team: { id: "team1" } }
          : { ok: true },
    );
    if (apiMock !== createTournament) {
      await waitFor(() => expect(submit).not.toBeDisabled());
    }
  });

  it("keeps first-password submit single-flight", async () => {
    const request = deferred<{ ok: boolean }>();
    firstPasswordChange.mockReturnValue(request.promise);
    render(
      <MemoryRouter initialEntries={["/first-password"]}>
        <App />
      </MemoryRouter>,
    );
    const form = (await screen.findByLabelText(
      "Форма смены пароля",
    )) as HTMLFormElement;
    const fields = within(form).getAllByLabelText(/пароль/i);
    fireEvent.change(fields[0]!, { target: { value: "Password12!" } });
    fireEvent.change(fields[1]!, { target: { value: "Password12!" } });

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(firstPasswordChange).toHaveBeenCalledTimes(1);
    const submit = within(form).getByRole("button", { name: /сохранение/i });
    expect(submit).toBeDisabled();
    request.resolve({ ok: true });
  });

  it("uses one guard across both onboarding actions", async () => {
    const request = deferred<{ match: { id: string } }>();
    tutorial.mockReturnValue(request.promise);
    me.mockResolvedValueOnce({
      user: {
        id: "u1",
        email: "user@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "Test",
        lastName: "User",
        onboardingStep: 6,
        onboardingCompletedAt: null,
      },
    });
    setOnboardingStep.mockResolvedValue({
      user: {
        id: "u1",
        email: "user@tab10.local",
        role: "user",
        mustChangePassword: false,
        onboardingStep: 6,
        onboardingCompletedAt: null,
      },
    });
    render(
      <MemoryRouter initialEntries={["/onboarding"]}>
        <App />
      </MemoryRouter>,
    );
    const tutorialButton = await screen.findByRole("button", {
      name: /матч с призрачным олегом/i,
    });
    const skipButton = screen.getByRole("button", { name: /завершить/i });

    fireEvent.click(tutorialButton);
    fireEvent.click(tutorialButton);
    fireEvent.click(skipButton);

    await waitFor(() => expect(tutorial).toHaveBeenCalledTimes(1));
    expect(completeOnboarding).not.toHaveBeenCalled();
    expect(tutorialButton).toBeDisabled();
    expect(skipButton).toBeDisabled();
    request.resolve({ match: { id: "tutorial-1" } });
  });
});
