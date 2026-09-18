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

test("GAP-012 operator creates A-vs-B, edits it and starts without player consent", async ({ page }, info) => {
  test.setTimeout(90_000);
  const fixture = await adminApi();
  const key = info.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const playerA = await createUser(fixture.api, `gap012-a-${key}`, `Первый ${key}`);
  const playerB = await createUser(fixture.api, `gap012-b-${key}`, `Второй ${key}`);
  const judge = await createUser(fixture.api, `e-judge-${key}`, `Судья ${key}`);
  const errors = collectPageErrors(page);
  const title = `GAP-012 ${info.project.name}`;
  let createdMatchId: string | undefined;

  try {
    await login(page);
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/matches/new");
    await page.getByLabel("Название", { exact: true }).fill(title);
    await expect(page.getByLabel("Создатель играет", { exact: true })).not.toBeChecked();
    await expect(page.getByLabel("Пригласить выбранных игроков", { exact: true })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Игрок A", exact: true }).fill(playerA.label);
    await page.getByRole("option", { name: playerA.label, exact: true }).click();
    await page.getByRole("combobox", { name: "Соперник", exact: true }).fill(playerB.label);
    await page.getByRole("option", { name: playerB.label, exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Судья (необязательно)", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Создать матч", exact: true }).click();
    await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
    const matchId = page.url().split("/").at(-1)!;
    createdMatchId = matchId;

    let match = (await (await fixture.api.get(`/api/v1/matches/${matchId}`)).json()).match;
    expect(match.createdByUserId).toBe(fixture.user.id);
    expect(match.participants.map((row: { userId?: string }) => row.userId).sort()).toEqual(
      [playerA.user.id, playerB.user.id].sort(),
    );
    expect(match.participants.some((row: { userId?: string }) => row.userId === fixture.user.id)).toBe(false);
    expect(match.invitations).toEqual([]);
    const { invitation: judgeInvitation } = await mutate(fixture.api, `/api/v1/matches/${matchId}/invitations`, { userId: judge.user.id, kind: "judge" });
    expect(judgeInvitation).toMatchObject({ invitedUserId: judge.user.id, status: "pending" });
    await expect(page.getByRole("button", { name: "Старт", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Изменить матч", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Изменить матч", exact: true });
    await expect(editor.getByText("Создатель управляет матчем, но не занимает игровое место.")).toBeVisible();
    await expect(editor.getByRole("combobox", { name: "Игрок A", exact: true })).toHaveValue(playerA.label);
    await editor.getByLabel("Название", { exact: true }).fill(`${title} edited`);
    await editor.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
    await expect(editor).toHaveCount(0);
    match = (await (await fixture.api.get(`/api/v1/matches/${matchId}`)).json()).match;
    expect(match.title).toBe(`${title} edited`);
    expect(match.participants.map((row: { userId?: string }) => row.userId).sort()).toEqual(
      [playerA.user.id, playerB.user.id].sort(),
    );

    await page.getByRole("button", { name: "Старт", exact: true }).click();
    const start = page.getByRole("dialog", { name: "Начать матч?", exact: true });
    await expect(start.getByRole("checkbox")).toHaveCount(0);
    await start.getByRole("radio").first().check();
    await start.getByRole("button", { name: "Начать матч", exact: true }).click();
    await expect(page.getByText("Идёт", { exact: true })).toBeVisible();
    match = (await (await fixture.api.get(`/api/v1/matches/${matchId}`)).json()).match;
    expect(match.status).toBe("in_progress");
    expect(match.invitations.find((row: { id: string }) => row.id === judgeInvitation.id)).toMatchObject({
      status: "cancelled",
      expiryReason: "match_started",
    });
    const judgeNotifications = (await (await judge.api.get("/api/v1/notifications")).json()).notifications;
    expect(judgeNotifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ payload: expect.objectContaining({ invitationId: judgeInvitation.id }), readAt: expect.any(String) }),
    ]));
    await expectNoOverflow(page);
    await page.screenshot({ path: info.outputPath("gap-012-operator-match.png"), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    if (createdMatchId) {
      const current = (await (await fixture.api.get(`/api/v1/matches/${createdMatchId}`)).json()).match;
      if (current?.status === "waiting") {
        const cancelled = await fixture.api.post(`/api/v1/matches/${createdMatchId}/cancel`, {data:{expectedVersion:current.version},headers:{...await mutationHeaders(fixture.api),"idempotency-key":randomUUID()}});
        expect(cancelled.status()).toBe(200);
      }
    }
    await Promise.all([
      fixture.api.dispose(),
      playerA.api.dispose(),
      playerB.api.dispose(),
      judge.api.dispose(),
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
