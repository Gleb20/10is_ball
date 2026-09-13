import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";
const baseURL = process.env.TAB10_E2E_BASE_URL ?? "http://localhost:4273";
const email = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const password = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";
async function csrf(api: APIRequestContext) {
  const cookie = (await api.storageState()).cookies.find((c) => c.name === "tab10_csrf");
  return cookie ? { "x-csrf-token": decodeURIComponent(cookie.value) } : {};
}
async function mutate(api: APIRequestContext, path: string, data: unknown, method = "POST") {
  const response = await api.fetch(path, { method, data, headers: await csrf(api) });
  expect(response.status(), path).toBeLessThan(300); return response.json();
}
async function player(admin: APIRequestContext, name: string) {
  const { user, temporaryPassword } = await mutate(admin, "/api/v1/admin/users", { email: `${name}@tab10.test`, firstName: "Участник", lastName: name });
  const api = await request.newContext({ baseURL });
  await mutate(api, "/api/v1/auth/login", { email: user.email, password: temporaryPassword });
  await mutate(api, "/api/v1/auth/password/first-change", { newPassword: "WaveDTeam9!" });
  await mutate(api, "/api/v1/me/onboarding", { action: "complete" }, "PATCH");
  return { api, user, displayName: `${name} Участник` };
}
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }

test("Wave D AT-TEAM-001..007 create, accept welcome, transfer, leave and automatic archive", async ({ page, browser }, info) => {
  const name = `D team ${info.project.name}`;
  const admin = await request.newContext({ baseURL });
  expect((await (await admin.get("/health")).json()).release.environment).toBe("test");
  const { user: actor } = await mutate(admin, "/api/v1/auth/login", { email, password });
  await mutate(admin, "/api/v1/me/onboarding", { action: "complete" }, "PATCH");
  const member = await player(admin, `d-member-${info.project.name}`);
  const outsider = await player(admin, `d-outsider-${info.project.name}`);
  const memberContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, storageState: await member.api.storageState() });
  const memberPage = await memberContext.newPage();
  const errors: string[] = []; for (const p of [page, memberPage]) p.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("/login"); await page.getByLabel("Email").fill(email); await page.getByLabel("Пароль").fill(password);
    await page.getByRole("button", { name: "Войти", exact: true }).click(); await expect(page).toHaveURL(/\/$/);
    await page.goto("/teams");
    await page.getByLabel("Название команды", { exact: true }).fill(name);
    await page.getByLabel("Слоган", { exact: true }).fill("Играем вместе");
    await page.getByLabel("Текст приветствия", { exact: true }).fill("Добро пожаловать на синтетическую тренировку");
    await page.getByRole("button", { name: "Создать", exact: true }).click();
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await expect(page).toHaveURL(/\/teams\/[0-9a-f-]+$/);
    const id = page.url().split("/").at(-1)!;
    expect((await outsider.api.get(`/api/v1/teams/${id}`)).status()).toBe(403);
    await expect(page.getByRole("button", { name: "Выйти из команды", exact: true })).toBeDisabled();
    await page.getByRole("combobox", { name: "Пригласить пользователя", exact: true }).fill(member.displayName);
    await page.getByRole("option", { name: member.displayName, exact: true }).click();
    await page.getByRole("button", { name: "Пригласить", exact: true }).click();
    await expect(page.getByText("Приглашение отправлено.", { exact: true })).toBeVisible();
    await memberPage.goto("/notifications");
    await memberPage.getByRole("button", { name: "Принять", exact: true }).click();
    await expect(memberPage).toHaveURL(new RegExp(`/teams/${id}\\?welcome=1$`));
    await expect(memberPage.getByText(`Добро пожаловать в команду «${name}»`, { exact: true })).toBeVisible();
    await expect(memberPage.getByRole("form", { name: "Редактирование команды", exact: true })).toHaveCount(0);
    await noOverflow(memberPage); await memberPage.screenshot({ path: info.outputPath("team-welcome-390.png"), fullPage: true });
    await page.reload();
    await page.getByLabel("Слоган", { exact: true }).fill("Новый состав");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByText("Изменения сохранены.", { exact: true })).toBeVisible();
    expect((await (await admin.get(`/api/v1/teams/${id}`)).json()).team.slogan).toBe("Новый состав");
    await page.getByRole("button", { name: `Передать капитанство ${member.displayName}`, exact: true }).click();
    await expect(page.getByText("Капитанство передано.", { exact: true })).toBeVisible();
    const transferred = (await (await admin.get(`/api/v1/teams/${id}`)).json()).team;
    expect(transferred.captainUserId).toBe(member.user.id); expect(transferred.isCaptain).toBe(false);
    await page.getByRole("button", { name: "Выйти из команды", exact: true }).click();
    await page.getByRole("button", { name: "Подтвердить выход", exact: true }).click();
    await expect(page.getByText("Вы вышли из команды.", { exact: true })).toBeVisible();
    expect((await (await admin.get("/api/v1/matches/create-options")).json()).teams.some((team: { id: string }) => team.id === id)).toBe(false);
    const { invitation } = await mutate(member.api, `/api/v1/teams/${id}/invitations`, { userId: outsider.user.id });
    await mutate(admin, `/api/v1/admin/users/${member.user.id}/block`, {});
    const archived = (await (await admin.get(`/api/v1/teams/${id}`)).json()).team;
    expect(archived.status).toBe("archived"); expect(archived.archivedAt).toBeTruthy(); expect(archived.members).toHaveLength(0);
    const late = await outsider.api.post(`/api/v1/team-invitations/${invitation.id}/accept`, { data: {}, headers: await csrf(outsider.api) });
    expect(late.status()).toBeGreaterThanOrEqual(400);
    await page.reload(); await expect(page.getByText("Команда в архиве", { exact: true })).toBeVisible();
    await expect(page.getByRole("form", { name: "Редактирование команды", exact: true })).toHaveCount(0);
    await noOverflow(page); await page.screenshot({ path: info.outputPath("team-archived.png"), fullPage: true });
    expect(archived.captainUserId).not.toBe(actor.id); expect(errors).toEqual([]);
  } finally { await memberContext.close(); await Promise.all([admin.dispose(), member.api.dispose(), outsider.api.dispose()]); }
});
