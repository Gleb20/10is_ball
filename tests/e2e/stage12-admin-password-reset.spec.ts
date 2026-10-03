import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { ADMIN_PASSWORD_RESET_ENABLED } from "../../apps/web/src/adminPasswordResetFeature";

const baseURL = process.env.TAB10_E2E_BASE_URL ?? "http://localhost:4273";
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";

test.use({ screenshot: "off", trace: "off", video: "off" });

async function csrfHeaders(context: APIRequestContext) {
  const state = await context.storageState();
  const csrf = state.cookies.find((cookie) => cookie.name === "tab10_csrf");
  return csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {};
}

async function loginApi() {
  const context = await request.newContext({ baseURL });
  const response = await context.post("/api/v1/auth/login", {
    data: { email: adminEmail, password: adminPassword },
  });
  expect(response.ok()).toBeTruthy();
  return context;
}

async function loginBrowser(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(adminEmail);
  await page.getByLabel("Пароль", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/(?:onboarding)?$/);
  const onboarding = await page.request.patch("/api/v1/me/onboarding", {
    headers: await csrfHeaders(page.request),
    data: { action: "complete" },
  });
  expect(onboarding.status(), await onboarding.text()).toBe(200);
  if (new URL(page.url()).pathname === "/onboarding") await page.goto("/");
}

test("Stage 12 reset verifies the held UI or the enabled one-response secret flow", async ({ page }, info) => {
  let resetPosts = 0;
  page.on("request", (outgoing) => {
    if (
      outgoing.method() === "POST" &&
      new URL(outgoing.url()).pathname.endsWith("/reset-password")
    ) resetPosts += 1;
  });
  await loginBrowser(page);

  if (!ADMIN_PASSWORD_RESET_ENABLED) {
    await page.goto("/admin");
    const row = page.locator(".list-row--admin").filter({ hasText: adminEmail });
    await expect(row).toHaveCount(1);
    const accountPath = await row.getByRole("link").getAttribute("href");
    expect(accountPath).toMatch(/^\/admin\/users\/[0-9a-f-]+$/);
    await row.getByRole("button", { name: "Действия", exact: true }).click();
    await expect(row.getByRole("button", { name: "Сбросить пароль", exact: true })).toBeDisabled();
    await expect(row.getByText("Временно недоступно во время безопасного обновления", { exact: true })).toBeVisible();

    await page.goto(accountPath!);
    await page.getByRole("button", { name: "Действия", exact: true }).click();
    await expect(page.getByRole("button", { name: "Сбросить пароль", exact: true })).toBeDisabled();
    await expect(page.getByText("Временно недоступно во время безопасного обновления", { exact: true })).toBeVisible();
    expect(resetPosts).toBe(0);
    return;
  }

  const admin = await loginApi();
  const targetEmail = `stage12-reset-${info.project.name}@tab10.test`;
  try {
    const create = await admin.post("/api/v1/admin/users", {
      headers: await csrfHeaders(admin),
      data: {
        email: targetEmail,
        firstName: "Синтетический",
        lastName: "Сброс",
        role: "user",
      },
    });
    expect(create.ok()).toBeTruthy();

    const catalog = await admin.get(`/api/v1/admin/users?q=${encodeURIComponent(targetEmail)}`);
    expect(catalog.ok()).toBeTruthy();
    const listed = await catalog.json() as { users: Array<{ id: string }> };
    const targetId = listed.users[0]?.id;
    expect(targetId).toBeTruthy();

    await page.goto(`/admin/users/${targetId}`);
    await page.getByRole("button", { name: "Действия", exact: true }).click();
    await page.getByRole("button", { name: "Сбросить пароль", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Сбросить пароль?" });
    await expect(confirm).toContainText(targetEmail);
    const screenshotDirectory = process.env.STAGE12_CAPTURE_SCREENSHOTS_DIR?.trim();
    if (screenshotDirectory) {
      await mkdir(screenshotDirectory, { recursive: true });
      await page.screenshot({
        path: path.join(screenshotDirectory, `${info.project.name}-reset-confirmation.png`),
        fullPage: true,
      });
    }

    const resetResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/v1/admin/users/${targetId}/reset-password`,
    );
    await confirm.getByRole("button", { name: "Подтвердить сброс", exact: true }).click();
    const response = await resetResponse;
    expect(response.status()).toBe(200);
    expect(resetPosts).toBe(1);
    const requestId = await response.request().headerValue("idempotency-key");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/i);

    const secret = page.getByRole("dialog", { name: "Пароль выдан" });
    await expect(secret.getByTestId("temp-password-value")).toBeVisible();
    expect(await page.evaluate(() => {
      for (let index = 0; index < sessionStorage.length; index += 1) {
        const value = sessionStorage.getItem(sessionStorage.key(index) ?? "") ?? "";
        if (/temporaryPassword|password|secret/i.test(value)) return false;
      }
      return true;
    })).toBe(true);

    await secret.getByRole("button", { name: "Закрыть", exact: true }).last().click();
    await expect(page.getByRole("dialog", { name: "Пароль выдан" })).toHaveCount(0);
    await expect(page.getByTestId("temp-password-value")).toHaveCount(0);

    const receipt = await admin.get(
      `/api/v1/admin/users/${targetId}/reset-password/requests/${requestId}`,
    );
    expect(receipt.ok()).toBeTruthy();
    expect(await receipt.json()).toMatchObject({
      requestId,
      targetUserId: targetId,
      outcome: "applied",
      secretAvailable: false,
      current: true,
    });
  } finally {
    await admin.dispose();
  }
});
