import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

const baseURL = process.env.TAB10_E2E_BASE_URL ?? "http://localhost:4273";
const email = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const password = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const collected: string[] = [];
  errors.set(page, collected);
  page.on("pageerror", (error) => collected.push(error.message));
});
test.afterEach(async ({ page }, info) => {
  expect(errors.get(page) ?? []).toEqual([]);
  if (info.status === info.expectedStatus) await page.screenshot({ path: info.outputPath("verified-state.png"), fullPage: true });
});

let mutationSequence = 0;
async function mutate(context: APIRequestContext, method: "POST" | "PATCH", path: string, data: unknown) {
  const csrf = (await context.storageState()).cookies.find((cookie) => cookie.name === "tab10_csrf");
  const response = await context.fetch(path, { method, data, headers: { ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {}), "idempotency-key": `00000000-0000-4000-8000-${String(++mutationSequence).padStart(12, "0")}` } });
  expect(response.status(), `${method} ${path}`).toBeLessThan(300);
  return response.json();
}
async function adminContext(agent: string) {
  const context = await request.newContext({ baseURL, extraHTTPHeaders: { "user-agent": agent } });
  const health = await context.get("/health");
  expect((await health.json()).release.environment).toBe("test");
  const login = await mutate(context, "POST", "/api/v1/auth/login", { email, password });
  await mutate(context, "PATCH", "/api/v1/me/onboarding", { action: "complete" });
  return { context, user: login.user };
}
async function browserLogin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("Wave B AT-PROFILE-001..005 AT-RANK-005..006 own edit, revoke, team and private public card", async ({ page }, info) => {
  const suffix = info.project.name;
  const { context: admin } = await adminContext(`wave-b-fixture-${suffix}`);
  const { context: extra } = await adminContext(`wave-b-revoke-${suffix}`);
  const created = await mutate(admin, "POST", "/api/v1/admin/users", {
    email: `rival-${suffix}@tab10.test`, firstName: "Соперник", lastName: suffix,
  });
  const rival = await request.newContext({ baseURL });
  await mutate(rival, "POST", "/api/v1/auth/login", { email: created.user.email, password: created.temporaryPassword });
  await mutate(rival, "POST", "/api/v1/auth/password/first-change", { newPassword: "BrowserRival9!" });
  const team = await mutate(admin, "POST", "/api/v1/teams", { name: `Команда ${suffix}` });
  try {
    await browserLogin(page);
    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Статистика", exact: true })).toBeVisible();
    await expect(page.getByText(/Аватар назначается автоматически/)).toBeVisible();
    await page.getByRole("button", { name: "Редактировать профиль" }).click();
    await page.getByLabel("Организация", { exact: true }).fill(`Проверка ${suffix}`);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByRole("form", { name: "Редактирование профиля" })).toHaveCount(0);
    expect((await (await admin.get("/api/v1/profile/me")).json()).profile.identity.organizationText).toBe(`Проверка ${suffix}`);
    const sessions = await (await admin.get("/api/v1/auth/sessions")).json();
    const target = sessions.sessions.find((session: { userAgent: string }) => session.userAgent === `wave-b-revoke-${suffix}`);
    expect(target).toBeDefined();
    const row = page.locator(".list-row").filter({ hasText: `wave-b-revoke-${suffix}` });
    await row.getByRole("button", { name: "Завершить", exact: true }).click();
    await page.getByRole("button", { name: "Завершить сессию", exact: true }).click();
    await expect(row).toHaveCount(0);
    expect((await extra.get("/api/v1/auth/me")).status()).toBe(401);
    await noOverflow(page);

    await page.screenshot({ path: info.outputPath("profile.png"), fullPage: true });
    await page.goto("/rankings");
    await page.getByRole("button", { name: team.team.name, exact: true }).click();
    await expect(page.getByLabel("Итог команды")).toBeVisible();
    await page.getByRole("button", { name: "Неделя", exact: true }).click();
    await page.getByRole("button", { name: "Месяц", exact: true }).click();
    await expect(page.getByRole("link", { name: /Открыть карточку/ })).toHaveCount(1);
    await page.getByRole("button", { name: "Общий", exact: true }).click();
    await page.getByRole("button", { name: "Всё время", exact: true }).click();
    await expect(page.getByRole("link", { name: `Открыть карточку ${suffix} Соперник` })).toBeVisible();
    await page.screenshot({ path: info.outputPath("rankings.png"), fullPage: true });
    await page.getByRole("link", { name: `Открыть карточку ${suffix} Соперник` }).click();
    await expect(page).toHaveURL(new RegExp(`/players/${created.user.id}$`));
    await expect(page.getByRole("button", { name: "Бросить вызов" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Статистика", exact: true })).toBeVisible();
    await expect(page.getByText(created.user.email, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Личные данные" })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("public-profile.png"), fullPage: true });
    await page.getByRole("button", { name: "Бросить вызов" }).click();
    await expect(page).toHaveURL(new RegExp(`opponentId=${created.user.id}`));
    await noOverflow(page);
  } finally {
    await Promise.all([admin.dispose(), extra.dispose(), rival.dispose()]);
  }
});

test("Wave B AT-VIS-003 history pagination and detail return keep context", async ({ page }, info) => {
  const prefix = `history-${info.project.name}`;
  const { context: admin, user } = await adminContext(`wave-b-history-${info.project.name}`);
  try {
    for (let index = 0; index < 21; index += 1) {
      const created = await mutate(admin, "POST", "/api/v1/matches", {
        title: `${prefix} ${index}`, format: "1v1", pointsToWin: 11,
        participants: [{ side: "A", userId: user.id }, { side: "B", guestFirstName: prefix, guestLastName: "Игрок" }],
      });
      await mutate(admin, "POST", `/api/v1/matches/${created.match.id}/cancel`, { expectedVersion: created.match.version });
    }
    await browserLogin(page);
    await page.goto("/history");
    await page.getByRole("searchbox", { name: "Поиск", exact: true }).fill(prefix);
    await page.getByRole("button", { name: "Найти", exact: true }).click();
    await page.getByRole("button", { name: /^Фильтры/ }).click();
    await page.getByRole("combobox", { name: "Тип события", exact: true }).selectOption("match");
    await page.getByRole("combobox", { name: "Роль", exact: true }).selectOption("player");
    await page.getByRole("button", { name: "Применить", exact: true }).click();
    const cards = page.getByRole("link", { name: new RegExp(prefix) });
    await expect(cards).toHaveCount(20);
    await page.getByRole("button", { name: "Показать ещё" }).click();
    await expect(cards).toHaveCount(21);
    await cards.first().click();
    await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
    await page.goBack();
    await expect(page.getByRole("searchbox", { name: "Поиск", exact: true })).toHaveValue(prefix);
    await expect(cards).toHaveCount(21);
    await expect(page.getByRole("button", { name: "Показать ещё" })).toHaveCount(0);
    await noOverflow(page);
  } finally { await admin.dispose(); }
});
