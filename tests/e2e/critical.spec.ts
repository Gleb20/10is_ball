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
  await page.getByLabel("Пароль").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Привет, Admin" }),
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
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await prepareAdmin();
});
test.afterEach(async ({ page }, testInfo) => {
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
  await expect(page.getByRole("heading", { name: "Новый матч" })).toBeVisible();
  await page.getByLabel("Название").fill("TECH-002 critical journey");
  await page.getByRole("button", { name: "Гость", exact: true }).click();
  await page.getByLabel("Гость (Имя Фамилия)").fill("Гость E2E");
  await page.getByRole("button", { name: "Создать матч" }).click();
  await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { name: "TECH-002 critical journey" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Судить" }).click();
  await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+\/judge$/);
  await expect(page.getByTestId("judge-setup")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("radio", { name: /Tab10 Admin/ }).check();
  await page.getByRole("button", { name: "Начать матч" }).click();
  await expect(page.getByRole("group", { name: "Счёт матча" })).toBeVisible();

  const point = page.getByRole("button", { name: /\+1 очко: Tab10 Admin/i });
  for (let index = 0; index < 5; index += 1) await point.click();
  await expect(
    page.getByRole("button", { name: "Подтвердить результат" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("judge-side-A").locator(".judge-side__score"),
  ).toHaveText("5");
  await expectNoSeriousAxeViolations(page);

  await page.getByRole("button", { name: "Подтвердить результат" }).click();
  await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
  await page.reload();
  await expect(page.getByText("Завершён", { exact: true })).toBeVisible();
  await expect(page.locator(".score-display")).toHaveText("5 : 0");
  await expectNoHorizontalOverflow(page);
});

test("E2E_runtime_session_recovery__AT-AUTH-009__preserves_route_and_draft_without_replaying_mutation", async ({
  page,
}) => {
  await loginBrowser(page);
  await page.goto("/matches/new");
  await page.getByLabel("Название").fill("TECH-002 revoked draft");
  await page.getByRole("button", { name: "Гость", exact: true }).click();
  await page.getByLabel("Гость (Имя Фамилия)").fill("Черновик E2E");

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

  await page.getByRole("button", { name: "Создать матч" }).click();
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
  await page.getByLabel("Пароль").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/matches\/new$/);
  await expect(page.getByLabel("Название")).toHaveValue(
    "TECH-002 revoked draft",
  );
  await expect(page.getByLabel("Гость (Имя Фамилия)")).toHaveValue(
    "Черновик E2E",
  );
  await expect(page.getByText("Требуется вход", { exact: true })).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);
  await expectNoHorizontalOverflow(page);

  await revoker.dispose();
});
