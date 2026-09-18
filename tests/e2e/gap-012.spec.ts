import { randomUUID } from "node:crypto";
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

const baseURL = process.env.TAB10_E2E_BASE_URL ?? "http://localhost:4273";
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";
const fixturePassword = "Gap012User9!";

async function mutationHeaders(api: APIRequestContext) {
  const csrf = (await api.storageState()).cookies.find((cookie) => cookie.name === "tab10_csrf");
  return {
    ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {}),
    "idempotency-key": randomUUID(),
  };
}

async function mutate(api: APIRequestContext, path: string, data: unknown, method: "POST" | "PATCH" = "POST") {
  const response = await api.fetch(path, { method, data, headers: await mutationHeaders(api) });
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBeLessThan(300);
  return response.json();
}

async function createAdminApi() {
  const api = await request.newContext({ baseURL });
  await mutate(api, "/api/v1/auth/login", { email: adminEmail, password: adminPassword });
  await mutate(api, "/api/v1/me/onboarding", { action: "complete" }, "PATCH");
  return api;
}

async function createUser(
  admin: APIRequestContext,
  suffix: string,
  firstName: string,
  completeLogin: boolean,
): Promise<{ api?: APIRequestContext; user: { id: string; email: string; status: string }; label: string }> {
  const created = await mutate(admin, "/api/v1/admin/users", {
    email: `${suffix}@tab10.test`,
    firstName,
    lastName: "GAP012",
  });
  if (!completeLogin) return { user: created.user, label: `GAP012 ${firstName}` };
  const api = await request.newContext({ baseURL });
  await mutate(api, "/api/v1/auth/login", { email: created.user.email, password: created.temporaryPassword });
  await mutate(api, "/api/v1/auth/password/first-change", { newPassword: fixturePassword });
  await mutate(api, "/api/v1/me/onboarding", { action: "complete" }, "PATCH");
  return { api, user: created.user, label: `GAP012 ${firstName}` };
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("GAP-012 immutable consent policy and scoped admin post-bracket add", async ({ browser, page }, info) => {
  test.setTimeout(90_000);
  const admin = await createAdminApi();
  const key = info.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const organizer = await createUser(admin, `gap012-organizer-${key}`, `Организатор ${key}`, true);
  const late = await createUser(admin, `gap012-late-${key}`, `Поздний ${key}`, false);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const title = `GAP-012 consent ${info.project.name}`;
  const adminContext = await browser.newContext({
    baseURL,
    viewport: page.viewportSize() ?? { width: 1280, height: 800 },
    storageState: await admin.storageState(),
  });
  const adminPage = await adminContext.newPage();
  adminPage.on("pageerror", (error) => errors.push(error.message));

  try {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(organizer.user.email);
    await page.getByLabel("Пароль", { exact: true }).fill(fixturePassword);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/tournaments");
    await expect(page.getByLabel("Требовать согласие приглашённых участников", { exact: true })).toHaveCount(0);
    const { tournament: legacyTournament } = await mutate(organizer.api!, "/api/v1/tournaments", {
      title, format: "single_elimination", organizerParticipates: false, requireParticipantConsent: true,
    });
    const tournamentId = legacyTournament.id;
    await page.goto(`/tournaments/${tournamentId}`);
    await expect(page).toHaveURL(/\/tournaments\/[0-9a-f-]+$/);
    await expect(page.getByText(/требуется согласие/i)).toHaveCount(0);

    for (const name of ["Первый", "Второй", "Третий"]) {
      await mutate(organizer.api!, `/api/v1/tournaments/${tournamentId}/participants`, {
        guestFirstName: name,
        guestLastName: "GAP012",
      });
    }
    await mutate(organizer.api!, `/api/v1/tournaments/${tournamentId}/bracket`, { constructionAlgorithm: "compact" });
    const generated = (await (await organizer.api!.get(`/api/v1/tournaments/${tournamentId}`)).json()).tournament;
    const seedPrefix = generated.bracketJson.seedOrder;

    await adminPage.goto(`/tournaments/${tournamentId}`);
    await expect(adminPage.getByText(/требуется согласие/i)).toHaveCount(0);
    await expect(adminPage.getByRole("heading", { name: "Настройки и правила", exact: true })).toHaveCount(0);
    await expect(adminPage.getByRole("button", { name: "Старт", exact: true })).toHaveCount(0);
    await expect(adminPage.getByLabel("Добавить гостя (Имя Фамилия)")).toHaveCount(0);
    expect(late.user.status).toBe("active");
    const directoryResponse = await admin.get("/api/v1/users/directory");
    expect(directoryResponse.ok()).toBe(true);
    const directory = (await directoryResponse.json()).users as Array<{ id: string; displayName: string }>;
    expect(directory.find((candidate) => candidate.id === late.user.id)).toMatchObject({
      id: late.user.id,
      displayName: late.label,
    });
    const picker = adminPage.getByRole("combobox", { name: "Добавить игрока", exact: true });
    await picker.fill("Поздний");
    await adminPage.getByRole("option", { name: late.label, exact: true }).click();
    adminPage.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain(late.label);
      expect(dialog.message()).toContain(title);
      expect(dialog.message()).toContain("без ответа на приглашение");
      expect(dialog.message()).toContain("перестроить уже созданную сетку");
      await dialog.accept();
    });
    await adminPage.getByRole("button", { name: "Добавить в состав", exact: true }).click();
    await expect(adminPage.getByText("Игрок добавлен", { exact: true })).toBeVisible();

    const after = (await (await organizer.api!.get(`/api/v1/tournaments/${tournamentId}`)).json()).tournament;
    expect(after.status).toBe("bracket_generated");
    expect(after.participants).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: late.user.id, additionSource: "manual_override" }),
    ]));
    expect(after.bracketJson.seedOrder.slice(0, seedPrefix.length)).toEqual(seedPrefix);
    expect(after.bracketJson.seedOrder).toHaveLength(seedPrefix.length + 1);
    await expectNoOverflow(adminPage);
    await adminPage.screenshot({ path: info.outputPath("gap-012-admin-add.png"), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await adminContext.close();
    await admin.dispose();
    await organizer.api!.dispose();
  }
});
