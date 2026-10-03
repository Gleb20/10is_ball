import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  request,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const API_BASE_URL = process.env.TAB10_E2E_BASE_URL ?? "http://localhost:4273";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ??
  "DeliveryVerify9!";

async function csrfHeaders(context: APIRequestContext) {
  const state = await context.storageState();
  const csrf = state.cookies.find((cookie) => cookie.name === "tab10_csrf");
  return csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {};
}

async function loginApi(userAgent: string) {
  const context = await request.newContext({
    baseURL: API_BASE_URL,
    extraHTTPHeaders: { "user-agent": userAgent },
  });
  const health = await context.get("/health");
  expect(health.ok()).toBeTruthy();
  expect(await health.json()).toMatchObject({ release: { environment: "test" } });

  const login = await context.post("/api/v1/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
  return context;
}

async function prepareAdmin() {
  const context = await loginApi("tab10-tech-002-fixture");
  const onboarding = await context.patch("/api/v1/me/onboarding", {
    headers: await csrfHeaders(context),
    data: { action: "complete" },
  });
  expect(onboarding.ok()).toBeTruthy();
  const logout = await context.post("/api/v1/auth/logout", {
    headers: await csrfHeaders(context),
  });
  expect(logout.ok()).toBeTruthy();
  await context.dispose();
}

async function loginBrowser(page: Page) {
  await page.goto("/login");
  await expect(page).toHaveTitle(/Tab-10/i);
  await expect(page.getByRole("form", { name: "Форма входа" })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  await expectNoHorizontalOverflow(page);
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Пароль", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("link", { name: /Профиль: Admin/ }),
  ).toBeVisible();
}

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const violations = results.violations.filter(
    (violation) =>
      violation.impact === "critical" || violation.impact === "serious",
  );
  expect(
    violations,
    violations
      .map(
        (violation) =>
          `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
      )
      .join("\n"),
  ).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth);
}

test.use({ userAgent: "tab10-tech-002-browser" });

const browserErrors = new WeakMap<Page, string[]>();
const ownedMatches = new WeakMap<Page, string>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await prepareAdmin();
});
test.afterEach(async ({ page }, testInfo) => {
  const matchId = ownedMatches.get(page);
  if (matchId) {
    const currentResponse = await page.request.get(`/api/v1/matches/${matchId}`);
    expect(currentResponse.status()).toBe(200);
    const current = (await currentResponse.json()).match;
    if (["in_progress", "pending_confirmation"].includes(current.status)) {
      const stopped = await page.request.post(`/api/v1/matches/${matchId}/stop`, {
        data: { winnerSide: "A", reasonCode: "other", reasonText: "Очистка синтетического critical сценария" },
        headers: { ...await csrfHeaders(page.request), "idempotency-key": randomUUID() },
      });
      expect(stopped.status(), await stopped.text()).toBe(200);
      expect((await stopped.json()).match.activeJudge).toBeNull();
    }
    ownedMatches.delete(page);
  }
  expect(browserErrors.get(page) ?? []).toEqual([]);
  if (testInfo.status === testInfo.expectedStatus) {
    await page.screenshot({ path: testInfo.outputPath("verified-state.png"), fullPage: true });
  }
});

test("E2E_auth_match_judge__AT-MATCH-001_005_008_AT-JUDGE-001_003_006_007__finishes_disposable_match", async ({
  page,
}) => {
  await loginBrowser(page);
  await expectNoSeriousAxeViolations(page);
  await expectNoHorizontalOverflow(page);

  await page.goto("/matches/new");
  await expect(page.getByRole("form", { name: "Создание матча" })).toBeVisible();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Настройки матча", exact: true });
  await settings.getByLabel("Название").fill("TECH-002 critical journey");
  await settings.getByLabel("Создатель играет", { exact: true }).check();
  await settings.getByRole("button", { name: "Готово", exact: true }).click();
  await page
    .getByRole("group", { name: "Соперник: тип участника", exact: true })
    .getByRole("button", { name: "Гость", exact: true })
    .click();
  await page.getByLabel("Соперник — гость (Имя Фамилия)").fill("Гость E2E");
  await page.getByRole("button", { name: "Начать", exact: true }).click();
  await page.getByRole("button", { name: /Admin Tab10.*Подаёт первым/ }).click();
  await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+\/judge$/);
  ownedMatches.set(page, new URL(page.url()).pathname.split("/")[2]!);
  await expect(page.getByTestId("judge-setup")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Счёт матча" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const point = page.getByRole("button", { name: /\+1 очко: Tab10 Admin/i });
  for (let index = 0; index < 5; index += 1) await point.click();
  await expect(
    page.getByRole("button", { name: "Подтвердить результат" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("judge-side-A").locator(".judge-side__score"),
  ).toHaveText("5");
  // Measure the settled decision layer, not an intermediate frame of its 140ms fade.
  await expect(page.getByRole("dialog", { name: "Подтвердить результат?", exact: true })).toHaveCSS("opacity", "1");
  await expectNoSeriousAxeViolations(page);

  await page.getByRole("button", { name: "Подтвердить результат" }).click();
  await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
  await page.reload();
  await expect(page.getByText("Завершён", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Сторона A, победитель", exact: true })).toContainText("5");
  await expect(page.getByRole("group", { name: "Сторона B", exact: true })).toContainText("0");
  await expectNoHorizontalOverflow(page);
});

test("E2E_runtime_session_recovery__AT-AUTH-009__preserves_route_and_draft_without_replaying_mutation", async ({
  page,
}) => {
  await loginBrowser(page);
  await page.goto("/matches/new");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Настройки матча", exact: true });
  await settings.getByLabel("Название").fill("TECH-002 revoked draft");
  await settings.getByLabel("Создатель играет", { exact: true }).check();
  await settings.getByRole("button", { name: "Готово", exact: true }).click();
  await page
    .getByRole("group", { name: "Соперник: тип участника", exact: true })
    .getByRole("button", { name: "Гость", exact: true })
    .click();
  await page.getByLabel("Соперник — гость (Имя Фамилия)").fill("Черновик E2E");

  const revoker = await loginApi("tab10-tech-002-revoker");
  const sessionsResponse = await revoker.get("/api/v1/auth/sessions");
  expect(sessionsResponse.ok()).toBeTruthy();
  const sessions = (await sessionsResponse.json()).sessions as Array<{
    id: string;
    current: boolean;
    createdAt: string;
    userAgent: string | null;
  }>;
  const browserSession = sessions
    .filter(
      (session) =>
        !session.current &&
        session.userAgent === "tab10-tech-002-browser",
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  expect(browserSession).toBeDefined();

  const revoke = await revoker.delete(
    `/api/v1/auth/sessions/${browserSession!.id}`,
    { headers: await csrfHeaders(revoker) },
  );
  expect(revoke.ok()).toBeTruthy();

  await page.getByRole("button", { name: "Начать", exact: true }).click();
  await page.getByRole("button", { name: /Admin Tab10.*Подаёт первым/ }).click();
  await expect(page).toHaveURL(/\/matches\/new$/);
  await expect(
    page.getByText(
      "Сессия завершена. Войдите снова, чтобы продолжить с этого места.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Email")).toBeFocused();

  const matchesResponse = await revoker.get("/api/v1/matches");
  expect(matchesResponse.ok()).toBeTruthy();
  const matches = (await matchesResponse.json()).matches as Array<{
    title: string;
  }>;
  expect(
    matches.some((match) => match.title === "TECH-002 revoked draft"),
  ).toBeFalsy();

  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Пароль", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/matches\/new$/);
  await expect(page.getByText("TECH-002 revoked draft", { exact: true })).toBeVisible();
  await expect(page.getByText("Результат запуска ещё не подтверждён", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Проверить ещё раз", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Начать", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Название")).toHaveCount(0);
  await expect(page.getByText("Требуется вход", { exact: true })).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);
  await expectNoHorizontalOverflow(page);

  await revoker.dispose();
});
