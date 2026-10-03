import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

const baseURL = process.env.TAB10_E2E_BASE_URL ?? "http://localhost:4273";
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";

async function mutate(
  api: APIRequestContext,
  path: string,
  data: unknown,
  method = "POST",
) {
  const csrf = (await api.storageState()).cookies.find(
    (entry) => entry.name === "tab10_csrf",
  );
  const response = await api.fetch(path, {
    method,
    data,
    headers: csrf
      ? { "x-csrf-token": decodeURIComponent(csrf.value) }
      : {},
  });
  expect(response.status(), path).toBeLessThan(300);
  return response.json();
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(adminEmail);
  await page.getByLabel("Пароль", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("GAP-028 exact-id recovery keeps D17 closed and confirms only the existing emergency action", async ({ page }, info) => {
  const admin = await request.newContext({ baseURL });
  const creator = await request.newContext({ baseURL });
  const suffix = `${info.project.name}-${Date.now()}`;
  const creatorEmail = `gap028-${suffix}@tab10.test`;
  const creatorPassword = "Gap028Browser9!";
  const secretTitle = `SECRET GAP-028 ${suffix}`;
  const secretGuest = `Скрытый-${suffix}`;

  try {
    await mutate(admin, "/api/v1/auth/login", {
      email: adminEmail,
      password: adminPassword,
    });
    const created = await mutate(admin, "/api/v1/admin/users", {
      email: creatorEmail,
      firstName: "Автор",
      lastName: "Скрытого матча",
      role: "user",
    });
    const creatorLogin = await mutate(creator, "/api/v1/auth/login", {
      email: creatorEmail,
      password: created.temporaryPassword,
    });
    await mutate(creator, "/api/v1/auth/password/first-change", {
      newPassword: creatorPassword,
    });
    await mutate(creator, "/api/v1/me/onboarding", { action: "complete" }, "PATCH");
    const match = await mutate(creator, "/api/v1/matches", {
      title: secretTitle,
      format: "1v1",
      firstServerMethod: "manual",
      source: "manual",
      sendPlayerInvitations: false,
      participants: [
        { side: "A", userId: creatorLogin.user.id },
        { side: "B", guestFirstName: secretGuest, guestLastName: "Игрок" },
      ],
    });
    const matchId = match.match.id as string;

    expect((await admin.get(`/api/v1/matches/${matchId}`)).status()).toBe(403);
    const safeRead = await admin.get(`/api/v1/admin/matches/${matchId}/recovery`);
    expect(safeRead.status()).toBe(200);
    expect(Object.keys((await safeRead.json()).recovery).sort()).toEqual([
      "allowedEmergencyAction",
      "id",
      "kind",
      "status",
      "version",
    ]);

    await login(page);
    await page.goto("/admin");
    await page.getByLabel("ID матча").fill("bad-id");
    await page.getByRole("button", { name: "Найти матч" }).click();
    await expect(page.getByText("Введите UUID матча полностью")).toBeVisible();
    await page.getByLabel("ID матча").fill(matchId);
    await page.getByRole("button", { name: "Найти матч" }).click();
    const region = page.getByRole("region", { name: "Аварийное завершение матча" });
    await expect(region.getByText(matchId)).toBeVisible();
    await expect(region.getByText("Аварийное завершение доступно")).toBeVisible();
    await expect(region).not.toContainText(secretTitle);
    await expect(region).not.toContainText(secretGuest);

    await region.getByRole("button", { name: "Аварийно завершить" }).click();
    const dialog = page.getByRole("dialog", {
      name: `Аварийно завершить матч ${matchId}?`,
    });
    await dialog.getByRole("button", { name: "Отмена" }).click();
    expect((await admin.get(`/api/v1/admin/matches/${matchId}/recovery`)).status()).toBe(200);

    await region.getByRole("button", { name: "Аварийно завершить" }).click();
    await dialog.getByRole("button", { name: `Завершить матч ${matchId}` }).click();
    await expect(page.getByText(`Матч ${matchId} аварийно завершён`)).toBeVisible();
    await expect(region.getByText("Отменён", { exact: true })).toBeVisible();
    await expect(region.getByText("Недоступно", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await creator.dispose();
    await admin.dispose();
  }
});
