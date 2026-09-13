import { randomUUID } from "node:crypto";
import {
  expect,
  request,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const baseURL = process.env.TAB10_E2E_BASE_URL ?? "http://localhost:4273";
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";
const fixturePassword = "WaveEUser9!";
let sequence = 0;

async function mutationHeaders(api: APIRequestContext) {
  const csrf = (await api.storageState()).cookies.find((cookie) => cookie.name === "tab10_csrf");
  return {
    ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {}),
    "idempotency-key": `eeeeeeee-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  };
}

async function mutate(
  api: APIRequestContext,
  path: string,
  data: unknown,
  method: "POST" | "PATCH" = "POST",
) {
  const response = await api.fetch(path, {
    method,
    data,
    headers: await mutationHeaders(api),
  });
  expect(response.status(), `${method} ${path}`).toBeLessThan(300);
  return response.json();
}

async function adminApi() {
  const api = await request.newContext({ baseURL });
  const health = await api.get("/health");
  expect(health.ok()).toBeTruthy();
  expect((await health.json()).release.environment).toBe("test");
  const login = await mutate(api, "/api/v1/auth/login", {
    email: adminEmail,
    password: adminPassword,
  });
  await mutate(api, "/api/v1/me/onboarding", { action: "complete" }, "PATCH");
  return { api, user: login.user as { id: string } };
}

async function createUser(
  admin: APIRequestContext,
  suffix: string,
  firstName: string,
) {
  const created = await mutate(admin, "/api/v1/admin/users", {
    email: `${suffix}@tab10.test`,
    firstName,
    lastName: "Проверочный",
  });
  const api = await request.newContext({ baseURL });
  await mutate(api, "/api/v1/auth/login", {
    email: created.user.email,
    password: created.temporaryPassword,
  });
  await mutate(api, "/api/v1/auth/password/first-change", {
    newPassword: fixturePassword,
  });
  await mutate(api, "/api/v1/me/onboarding", { action: "complete" }, "PATCH");
  return {
    api,
    user: created.user as { id: string; email: string },
    label: `${firstName} Проверочный`,
  };
}

async function login(page: Page, email = adminEmail, password = adminPassword) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

function collectPageErrors(...pages: Page[]) {
  const errors: string[] = [];
  for (const page of pages) page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("Wave E match consent, optional judge and prestart roster editing", async ({ page, browser }, info) => {
  test.setTimeout(90_000);
  const fixture = await adminApi();
  const key = info.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const outsider = await createUser(fixture.api, `e-outsider-${key}`, `Игрок ${key}`);
  const judge = await createUser(fixture.api, `e-judge-${key}`, `Судья ${key}`);
  const replacement = await createUser(fixture.api, `e-replacement-${key}`, `Замена ${key}`);
  const outsiderBrowser = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    storageState: await outsider.api.storageState(),
  });
  const outsiderPage = await outsiderBrowser.newPage();
  const errors = collectPageErrors(page, outsiderPage);
  const title = `E consent ${info.project.name}`;
  let createdMatchId: string | undefined;

  try {
    await login(page);
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/matches/new");
    await page.getByLabel("Название", { exact: true }).fill(title);
    await page.getByRole("combobox", { name: "Соперник", exact: true }).fill(outsider.label);
    await page.getByRole("option", { name: outsider.label, exact: true }).click();
    await page.getByRole("combobox", { name: "Судья (необязательно)", exact: true }).fill(judge.label);
    await page.getByRole("option", { name: judge.label, exact: true }).click();
    await page.getByRole("button", { name: "Создать матч", exact: true }).click();
    await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
    const matchId = page.url().split("/").at(-1)!;
    createdMatchId = matchId;

    let match = (await (await fixture.api.get(`/api/v1/matches/${matchId}`)).json()).match;
    const initialOutsider = match.participants.find((row: { userId?: string }) => row.userId === outsider.user.id);
    const playerInvitation = match.invitations.find((row: { kind: string }) => row.kind === "player");
    const judgeInvitation = match.invitations.find((row: { kind: string }) => row.kind === "judge");
    expect(initialOutsider).toBeTruthy();
    expect(playerInvitation).toMatchObject({ invitedUserId: outsider.user.id, status: "pending" });
    expect(judgeInvitation).toMatchObject({ invitedUserId: judge.user.id, status: "pending" });
    await expect(page.getByRole("button", { name: "Старт", exact: true })).toBeDisabled();
    await expect(page.getByRole("status")).toContainText(initialOutsider.displayName);
    const blocked = await fixture.api.post(`/api/v1/matches/${matchId}/start`, {
      data: { firstServerParticipantId: match.participants[0].id },
      headers: await mutationHeaders(fixture.api),
    });
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).code).toBe("PLAYER_CONSENT_REQUIRED");

    await outsiderPage.goto("/notifications");
    const playerNotice = outsiderPage.locator(".card").filter({ hasText: "Приглашение в матч" });
    await expect(playerNotice).toHaveCount(1);
    await playerNotice.getByRole("button", { name: "Принять", exact: true }).click();
    await expect(outsiderPage).toHaveURL(new RegExp(`/matches/${matchId}$`));
    await expect(outsiderPage.getByText("Принято", { exact: true })).toBeVisible();

    await mutate(judge.api, `/api/v1/match-invitations/${judgeInvitation.id}/accept`, {});
    match = (await (await fixture.api.get(`/api/v1/matches/${matchId}`)).json()).match;
    expect(match.activeJudge).toBeNull();
    expect(match.judgeReservation ?? null).toBeNull();
    expect(match.invitations.find((row: { id: string }) => row.id === judgeInvitation.id).status).toBe("accepted");

    await page.reload();
    await expect(page.getByRole("button", { name: "Старт", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Изменить матч", exact: true }).click();
    const stableEditor = page.getByRole("dialog", { name: "Изменить матч", exact: true });
    await stableEditor.getByLabel("Название", { exact: true }).fill(`${title} stable`);
    await stableEditor.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
    await expect(stableEditor).toHaveCount(0);
    match = (await (await fixture.api.get(`/api/v1/matches/${matchId}`)).json()).match;
    expect(match.participants.find((row: { userId?: string }) => row.userId === outsider.user.id).id).toBe(initialOutsider.id);
    expect(match.invitations.find((row: { id: string }) => row.id === playerInvitation.id).status).toBe("accepted");

    await page.getByRole("button", { name: "Изменить матч", exact: true }).click();
    const replacementEditor = page.getByRole("dialog", { name: "Изменить матч", exact: true });
    const opponent = replacementEditor.getByRole("combobox", { name: "Соперник", exact: true });
    await opponent.fill(replacement.label);
    await page.getByRole("option", { name: replacement.label, exact: true }).click();
    await replacementEditor.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
    await expect(replacementEditor).toHaveCount(0);
    match = (await (await fixture.api.get(`/api/v1/matches/${matchId}`)).json()).match;
    const replacementParticipant = match.participants.find((row: { userId?: string }) => row.userId === replacement.user.id);
    expect(replacementParticipant.id).not.toBe(initialOutsider.id);
    expect(match.invitations.some((row: { matchParticipantId: string; status: string }) =>
      row.matchParticipantId === replacementParticipant.id && row.status === "pending",
    )).toBe(true);
    await expect(page.getByRole("button", { name: "Старт", exact: true })).toBeDisabled();
    await expect(page.getByRole("status")).toContainText(replacementParticipant.displayName);
    await expectNoOverflow(page);
    await page.screenshot({ path: info.outputPath("match-consent-editor.png"), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    if (createdMatchId) {
      const current = (await (await fixture.api.get(`/api/v1/matches/${createdMatchId}`)).json()).match;
      if (current?.status === "waiting") {
        const cancelled = await fixture.api.post(`/api/v1/matches/${createdMatchId}/cancel`, {data:{expectedVersion:current.version},headers:{...await mutationHeaders(fixture.api),"idempotency-key":randomUUID()}});
        expect(cancelled.status()).toBe(200);
      }
    }
    await outsiderBrowser.close();
    await Promise.all([
      fixture.api.dispose(),
      outsider.api.dispose(),
      judge.api.dispose(),
      replacement.api.dispose(),
    ]);
  }
});

test("Wave E onboarding resume, tutorial return, restart and Help feedback", async ({ page }, info) => {
  test.setTimeout(90_000);
  const fixture = await adminApi();
  const key = info.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const created = await mutate(fixture.api, "/api/v1/admin/users", {
    email: `e-onboarding-${key}@tab10.test`,
    firstName: "Новый",
    lastName: "Пользователь",
  });
  const errors = collectPageErrors(page);

  try {
    await login(page, created.user.email, created.temporaryPassword);
    await expect(page).toHaveURL(/\/first-password$/);
    await page.getByLabel("Новый пароль", { exact: true }).fill(fixturePassword);
    await page.getByLabel("Повторите пароль", { exact: true }).fill(fixturePassword);
    await page.getByRole("button", { name: /Сохранить/ }).click();
    await expect(page).toHaveURL(/\/onboarding$/);

    const navigation = page.getByRole("navigation", { name: "Основная навигация", exact: true });
    const expectGuide = async (heading: string, navTarget?: string) => {
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeFocused();
      if (navTarget) {
        await expect(navigation.getByText(navTarget, { exact: true }).locator("..")).toHaveAttribute("data-onboarding-target", "true");
      } else {
        await expect(navigation.locator("[data-onboarding-target='true']")).toHaveCount(0);
      }
    };

    await expectGuide("Главная", "Главная");
    await page.getByRole("button", { name: "Пропустить шаг", exact: true }).click();
    await expectGuide("Рейтинг", "Рейтинг");
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    await expectGuide("История", "История");
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    await expectGuide("Уведомления");
    await expect(page.getByRole("note", { name: "Где найти уведомления", exact: true })).toContainText(/Главной.*Профиле/);
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    await expectGuide("Профиль", "Профиль");
    await page.reload();
    await expectGuide("Профиль", "Профиль");
    await expect(page.getByText("Шаг 5 из 7", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    await expectGuide("Начать", "Начать");
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    await expectGuide("Учебный матч");
    await page.getByRole("button", { name: "Матч с Призрачным Олегом", exact: true }).click();
    await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+\/judge\?tutorial=1$/);
    await expect(page.getByTestId("judge-setup")).toBeVisible();
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expectGuide("Учебный матч");
    const incomplete = (await (await page.request.get("/api/v1/auth/me")).json()).user;
    expect(incomplete.onboardingCompletedAt).toBeNull();
    await page.getByRole("button", { name: "Завершить без учебного матча", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/profile");
    await page.getByText("Пройти онбординг заново", { exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expectGuide("Главная", "Главная");
    await page.getByRole("button", { name: "Закрыть онбординг", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/help");
    for (const category of ["Матчи", "Турниры", "Подача", "Рейтинг", "Команды", "Уведомления"]) {
      await expect(page.getByText(category, { exact: true }).first()).toBeVisible();
    }
    const feedbackMessage = `Идея Wave E ${info.project.name}: https://example.test/material`;
    await page.getByLabel("Категория", { exact: true }).selectOption("idea");
    await page.getByLabel("Сообщение", { exact: true }).fill(feedbackMessage);
    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/v1/feedback") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    const feedbackResponse = await responsePromise;
    expect(feedbackResponse.status()).toBe(200);
    expect((await feedbackResponse.json()).feedback).toMatchObject({
      userId: created.user.id,
      kind: "idea",
      message: feedbackMessage,
    });
    await expect(page.getByText("Сообщение отправлено.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Сообщение", { exact: true })).toHaveValue("");
    await expectNoOverflow(page);
    await page.screenshot({ path: info.outputPath("onboarding-help-feedback.png"), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await fixture.api.dispose();
  }
});
