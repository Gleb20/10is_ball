import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.TAB10_E2E_BASE_URL ?? "http://localhost:4273";
const email = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const password = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";

async function mutate(api: APIRequestContext, pathName: string, data: unknown, method = "POST") {
  const cookie = (await api.storageState()).cookies.find((entry) => entry.name === "tab10_csrf");
  const response = await api.fetch(pathName, {
    method, data,
    headers: cookie ? { "x-csrf-token": decodeURIComponent(cookie.value) } : {},
  });
  expect(response.status(), pathName).toBeLessThan(300);
  return response.json();
}

async function login(page: Page, loginEmail = email, loginPassword = password) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(loginEmail);
  await page.getByLabel("Пароль", { exact: true }).fill(loginPassword);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
}

test("Wave E ADM catalog, account workspace, audit and authority lifecycle", async ({ page, browser }, info) => {
  const admin = await request.newContext({ baseURL });
  expect((await (await admin.get("/health")).json()).release.environment).toBe("test");
  const adminLogin = await mutate(admin, "/api/v1/auth/login", { email, password });
  await mutate(admin, "/api/v1/me/onboarding", { action: "complete" }, "PATCH");
  const targetEmail = `e-admin-${info.project.name}@tab10.test`;
  const member = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const memberPage = await member.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  memberPage.on("pageerror", (error) => errors.push(error.message));

  try {
    await login(page);
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/admin");
    await page.getByRole("button", { name: "Добавить пользователя", exact: true }).click();
    const create = page.getByRole("form", { name: "Создание пользователя" });
    await create.getByLabel("Email", { exact: true }).fill(targetEmail);
    await create.getByLabel("Имя", { exact: true }).fill("Новый");
    await create.getByLabel("Фамилия", { exact: true }).fill("Проверочный");
    await create.getByRole("button", { name: "Создать", exact: true }).click();
    const temporary = await page.getByTestId("temp-password-value").innerText();
    await page.getByRole("dialog").getByRole("button", { name: "Готово", exact: true }).click();

    await page.getByLabel("Имя или email").fill(targetEmail);
    await page.getByRole("button", { name: "Найти", exact: true }).click();
    const row = page.locator(".list-row--admin").filter({ hasText: targetEmail });
    const targetLink = row.getByRole("link", { name: "Проверочный Новый", exact: true });
    await expect(row).toHaveCount(1);
    const listed = await (await admin.get(`/api/v1/admin/users?q=${encodeURIComponent(targetEmail)}`)).json();
    const targetId = listed.users[0].id as string;
    for (let index = 0; index < 21; index += 1) {
      await mutate(admin, `/api/v1/admin/users/${targetId}`, {
        positionText: `Проверка аудита ${index}`,
      }, "PATCH");
    }
    await targetLink.click();
    await expect(page).toHaveURL(/\/admin\/users\/[0-9a-f-]+$/);
    const initialAudit = page.getByRole("region", { name: "История изменений" });
    await expect(initialAudit.locator("li")).toHaveCount(20);
    await initialAudit.getByRole("button", { name: "Показать ещё", exact: true }).click();
    await expect(initialAudit.locator("li")).toHaveCount(22);
    await expect(initialAudit).toContainText("Аккаунт создан");

    const freshCatalog = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v1/admin/users" && response.request().method() === "GET");
    await page.getByRole("button", { name: "К пользователям", exact: true }).click();
    expect((await freshCatalog).status()).toBe(200);
    await expect(page.getByLabel("Имя или email")).toHaveValue(targetEmail);
    await expect(targetLink).toBeFocused();
    await targetLink.click();

    await login(memberPage, targetEmail, temporary);
    await expect(memberPage).toHaveURL(/\/first-password$/);
    await memberPage.getByLabel("Новый пароль", { exact: true }).fill("WaveEAdmin9!");
    await memberPage.getByLabel("Повторите пароль", { exact: true }).fill("WaveEAdmin9!");
    await memberPage.getByRole("button", { name: /Сохранить/ }).click();
    await expect(memberPage).toHaveURL(/\/onboarding$/);
    await memberPage.getByRole("button", { name: "Закрыть обучение", exact: true }).click();
    await expect(memberPage).toHaveURL(/\/$/);
    expect((await member.request.get("/api/v1/admin/users")).status()).toBe(403);

    await page.getByRole("button", { name: "Редактировать", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Профиль пользователя" });
    await expect(edit.getByLabel("Email", { exact: true })).toHaveAttribute("readonly", "");
    await edit.getByLabel("Имя", { exact: true }).fill("Обновлённый");
    await edit.getByLabel("Дата рождения").fill("1990-02-03");
    await edit.getByLabel("Организация").fill("Синтетический клуб");
    await edit.getByLabel("Должность").fill("Участник");
    await edit.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(edit).toHaveCount(0);

    await page.getByRole("button", { name: "Действия", exact: true }).click();
    await page.getByRole("button", { name: "Сделать администратором", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Подтвердить", exact: true }).click();
    const demote = page.getByRole("button", { name: "Снять права администратора", exact: true });
    const actions = page.getByRole("button", { name: "Действия", exact: true });
    await expect(page.getByRole("region", { name: "Данные аккаунта" })).toContainText("Администратор");
    if (await actions.getAttribute("aria-expanded") !== "true") await actions.click();
    await expect(demote).toBeVisible();
    expect((await member.request.get("/api/v1/auth/me")).status()).toBe(401);
    await demote.click();
    await page.getByRole("dialog").getByRole("button", { name: "Подтвердить", exact: true }).click();

    await login(memberPage, targetEmail, "WaveEAdmin9!");
    await expect(memberPage).toHaveURL(/\/$/);
    await memberPage.goto(`/admin/users/${targetId}`);
    await expect(memberPage).toHaveURL(/\/$/);

    if (await actions.getAttribute("aria-expanded") !== "true") await actions.click();
    await page.getByRole("button", { name: "Заблокировать", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Подтвердить", exact: true }).click();
    if (await actions.getAttribute("aria-expanded") !== "true") await actions.click();
    await page.getByRole("button", { name: "Разблокировать", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Подтвердить", exact: true }).click();
    expect((await member.request.get("/api/v1/auth/me")).status()).toBe(401);

    const audit = page.getByRole("region", { name: "История изменений" });
    await expect(audit).toContainText("Профиль изменён");
    await expect(audit).toContainText("Роль изменена");
    await expect(audit).toContainText("Аккаунт заблокирован");
    await expect(audit).toContainText("Аккаунт разблокирован");
    const evidenceDir = process.env.VERIFY_EVIDENCE_DIR;
    if (evidenceDir) {
      const screenshotDir = path.join(evidenceDir, "screenshots");
      await mkdir(screenshotDir, { recursive: true });
      await page.screenshot({
        path: path.join(screenshotDir, `admin-account-${info.project.name}.png`), fullPage: true,
      });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.goto(`/admin/users/${adminLogin.user.id}`);
    await page.getByRole("button", { name: "К пользователям", exact: true }).click();
    await expect(page.getByLabel("Имя или email")).toHaveValue("");
    expect(errors).toEqual([]);
  } finally {
    await member.close();
    await admin.dispose();
  }
});
