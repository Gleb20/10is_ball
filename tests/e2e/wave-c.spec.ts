import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";
const baseURL = process.env.TAB10_E2E_BASE_URL ?? "http://localhost:4273";
const email = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const password = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";
let sequence = 0;
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const values: string[] = []; errors.set(page, values); page.on("pageerror", (e) => values.push(e.message)); });
test.afterEach(async ({ page }, info) => {
  expect(errors.get(page)).toEqual([]);
  if (info.status === info.expectedStatus) await page.screenshot({ path: info.outputPath("verified-state.png"), fullPage: true });
});
async function headers(context: APIRequestContext) {
  const cookie = (await context.storageState()).cookies.find((c) => c.name === "tab10_csrf");
  return { ...(cookie ? { "x-csrf-token": decodeURIComponent(cookie.value) } : {}), "idempotency-key": `cccccccc-0000-4000-8000-${String(++sequence).padStart(12, "0")}` };
}
async function mutate(context: APIRequestContext, method: "POST" | "PATCH", path: string, data: unknown) {
  const response = await context.fetch(path, { method, data, headers: await headers(context) });
  expect(response.status(), `${method} ${path}`).toBeLessThan(300); return response.json();
}
async function fixture(name: string) {
  const admin = await request.newContext({ baseURL });
  expect((await (await admin.get("/health")).json()).release.environment).toBe("test");
  const { user: actor } = await mutate(admin, "POST", "/api/v1/auth/login", { email, password });
  await mutate(admin, "PATCH", "/api/v1/me/onboarding", { action: "complete" });
  const created = await mutate(admin, "POST", "/api/v1/admin/users", { email: `${name}@tab10.test`, firstName: "Судья", lastName: name });
  const target = await request.newContext({ baseURL });
  await mutate(target, "POST", "/api/v1/auth/login", { email: created.user.email, password: created.temporaryPassword });
  await mutate(target, "POST", "/api/v1/auth/password/first-change", { newPassword: "WaveCFixture9!" });
  await mutate(target, "PATCH", "/api/v1/me/onboarding", { action: "complete" });
  return { admin, actor, target, user: created.user };
}
async function login(page: Page) {
  await page.goto("/login"); await page.getByLabel("Email").fill(email); await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click(); await expect(page).toHaveURL(/\/$/);
}
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }

test("Wave C AT-MATCH-013_016 2v2 team selection, rules, no-show and revenge", async ({ page }, info) => {
  const name = `c-roster-${info.project.name}`;
  const { admin, actor, target, user } = await fixture(name);
  try {
    const { team } = await mutate(admin, "POST", "/api/v1/teams", { name });
    const { invitation } = await mutate(admin, "POST", `/api/v1/teams/${team.id}/invite`, { userId: user.id });
    await mutate(target, "POST", `/api/v1/team-invitations/${invitation.id}/respond`, { accept: true });
    await login(page); await page.goto("/matches/new");
    await page.getByLabel("Название", { exact: true }).fill(name);
    await page.getByRole("button", { name: "2 × 2", exact: true }).click();
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByLabel("Очков до победы", { exact: true }).fill("7");
    await page.getByRole("checkbox", { name: /Сухая победа/ }).uncheck();
    for (const label of ["Партнёр", "Соперник 2"]) {
      await page.getByRole("group", { name: label, exact: true }).getByRole("button", { name: "Гость", exact: true }).click();
      await page.getByLabel(`${label} — гость (Имя Фамилия)`, { exact: true }).fill(`${label} Гость`);
    }
    await noOverflow(page); await page.screenshot({ path: info.outputPath("create-2v2.png"), fullPage: true });
    await page.getByRole("button", { name: "Создать матч", exact: true }).click();
    await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
    const id = page.url().split("/").at(-1)!;
    const detail = (await (await admin.get(`/api/v1/matches/${id}`)).json()).match;
    expect(detail).toMatchObject({ format: "2v2", pointsToWin: 7, mercyEnabled: false, firstServerMethod: "manual" });
    expect(detail.participants).toHaveLength(4);
    expect(detail.participants.filter((p: { userId?: string }) => p.userId).map((p: { userId: string }) => p.userId).sort()).toEqual([actor.id, user.id].sort());
    await page.getByRole("button", { name: "Зафиксировать неявку", exact: true }).click();
    await page.getByLabel("Комментарий (необязательно)", { exact: true }).fill("Синтетическая проверка неявки");
    await page.getByRole("button", { name: "Завершить по неявке", exact: true }).click();
    await expect(page.getByText("Матч завершён из-за неявки", { exact: true })).toBeVisible();
    expect((await (await admin.get(`/api/v1/matches/${id}`)).json()).match).toMatchObject({ status: "stopped", winnerSide: "A", scoreA: 0, scoreB: 0, finishReason: "no_show" });
    await page.getByRole("button", { name: "Создать реванш", exact: true }).click();
    await expect(page.getByLabel("Название", { exact: true })).toHaveValue(`Реванш: ${name}`);
    await expect(page.getByLabel("Очков до победы", { exact: true })).toHaveValue("7");
    await page.getByRole("button", { name: "Создать матч", exact: true }).click();
    await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
    const revengeId = page.url().split("/").at(-1)!;
    const revenge = (await (await admin.get(`/api/v1/matches/${revengeId}`)).json()).match;
    expect(revenge).toMatchObject({ source: "revenge", format: "2v2", pointsToWin: 7 });
    await mutate(admin, "POST", `/api/v1/matches/${revengeId}/cancel`, { expectedVersion: revenge.version });
    await page.reload(); await expect(page.getByText("Отменён", { exact: true }).first()).toBeVisible(); await noOverflow(page);
  } finally { await Promise.all([admin.dispose(), target.dispose()]); }
});

test("Wave C AT-JUDGE-004_010 correction, undo and two-client handover preserve authority", async ({ page, browser }, info) => {
  const { admin, actor, target, user } = await fixture(`c-judge-${info.project.name}`);
  const targetBrowser = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, storageState: await target.storageState() });
  const targetPage = await targetBrowser.newPage(); const targetErrors: string[] = []; targetPage.on("pageerror", (e) => targetErrors.push(e.message));
  try {
    const before = (await (await admin.get("/api/v1/profile/me")).json()).profile.stats.judgedMatches;
    const { match } = await mutate(admin, "POST", "/api/v1/matches", { title: `C handover ${info.project.name}`, format: "1v1", firstServerMethod: "manual", pointsToWin: 11, mercyEnabled: false, participants: [{ side: "A", userId: actor.id }, { side: "B", userId: user.id }] });
    await login(page); await page.goto(`/matches/${match.id}/judge`);
    await expect(page.getByTestId("judge-setup")).toBeVisible();
    await expect(page.getByRole("button", { name: "Начать матч", exact: true })).toBeDisabled();
    await page.getByRole("radio", { name: /Tab10 Admin/ }).check();
    await page.getByRole("button", { name: "Начать матч", exact: true }).click();
    await expect(page.getByRole("group", { name: "Счёт матча", exact: true })).toBeVisible();
    const sideB = match.participants.find((p: { side: string }) => p.side === "B").id;
    async function correct(a: string, b: string) {
      await page.getByRole("button", { name: "Ещё", exact: true }).click();
      await page.getByRole("button", { name: "Исправить счёт и подачу", exact: true }).click();
      await page.getByLabel("Счёт стороны A", { exact: true }).fill(a); await page.getByLabel("Счёт стороны B", { exact: true }).fill(b);
      await page.getByRole("combobox", { name: "Текущий подающий", exact: true }).selectOption(sideB);
      await page.getByRole("button", { name: "Сохранить коррекцию", exact: true }).click();
      await expect(page.getByRole("region", { name: "Ручная коррекция", exact: true })).toHaveCount(0);
    }
    await correct("4", "4");
    await page.getByRole("button", { name: /\+1 очко: Tab10 Admin/ }).click();
    await expect(page.getByTestId("judge-side-A").locator(".judge-side__score")).toHaveText("5");
    expect((await (await admin.get(`/api/v1/matches/${match.id}`)).json()).match.currentServerParticipantId).toBe(sideB);
    await page.getByRole("button", { name: "Отменить последнее очко", exact: true }).click();
    await expect(page.getByTestId("judge-side-A").locator(".judge-side__score")).toHaveText("4");
    await correct("10", "9");
    await page.getByRole("button", { name: "Ещё", exact: true }).click();
    await page.getByRole("combobox", { name: "Передать судейство", exact: true }).selectOption(user.id);
    await page.getByRole("button", { name: "Передать слот", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/matches/${match.id}$`));
    const reserved = (await (await admin.get(`/api/v1/matches/${match.id}`)).json()).match;
    expect(reserved.activeJudge).toBeNull(); expect(reserved.judgeReservation.userId).toBe(user.id);
    const stale = await page.context().request.post(`/api/v1/matches/${match.id}/points`, { data: { side: "A", expectedVersion: reserved.version }, headers: await headers(page.context().request) });
    expect(stale.status()).toBe(400); expect((await stale.json()).code).toBe("JUDGE_REQUIRED");
    await targetPage.goto(`/matches/${match.id}/judge`);
    await expect(targetPage.getByRole("group", { name: "Счёт матча", exact: true })).toBeVisible();
    await noOverflow(targetPage); await targetPage.screenshot({ path: info.outputPath("target-judge-390.png"), fullPage: true });
    await targetPage.getByRole("button", { name: /\+1 очко: Tab10 Admin/ }).click();
    await targetPage.getByRole("button", { name: "Подтвердить результат", exact: true }).click();
    await expect(targetPage).toHaveURL(new RegExp(`/matches/${match.id}$`));
    const finished = (await (await admin.get(`/api/v1/matches/${match.id}`)).json()).match;
    expect(finished).toMatchObject({ status: "finished", scoreA: 11, scoreB: 9, winnerSide: "A", activeJudge: null });
    expect(finished.eventLog.some((event: { type: string; undonePoint?: unknown }) => event.type === "point_undone" && event.undonePoint)).toBe(true);
    expect((await (await admin.get("/api/v1/profile/me")).json()).profile.stats.judgedMatches).toBe(before + 1);
    expect((await (await target.get("/api/v1/profile/me")).json()).profile.stats.judgedMatches).toBe(1);
    await page.reload(); await expect(page.getByText("Завершён", { exact: true }).first()).toBeVisible(); await noOverflow(page);
    expect(targetErrors).toEqual([]);
  } finally { await targetBrowser.close(); await Promise.all([admin.dispose(), target.dispose()]); }
});

test("Wave C AT-JUDGE-001 creator starts while another club judge retains the slot", async ({ page, browser }, info) => {
  const { admin, actor, target, user } = await fixture(`c-start-${info.project.name}`);
  const judgeContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, storageState: await target.storageState() });
  const judge = await judgeContext.newPage();
  const judgeErrors: string[] = []; judge.on("pageerror", (e) => judgeErrors.push(e.message));
  try {
    const { match } = await mutate(admin, "POST", "/api/v1/matches", { title: `Creator start ${info.project.name}`, format: "1v1", firstServerMethod: "manual", participants: [{ side: "A", userId: actor.id }, { side: "B", guestFirstName: "Гость", guestLastName: "Проверка" }] });
    await judge.goto(`/matches/${match.id}/judge`);
    await judge.getByRole("radio", { name: /Tab10 Admin/ }).check();
    await judge.getByRole("button", { name: "Сохранить подготовку", exact: true }).click();
    await expect(judge.getByRole("status", { name: "Ожидаем запуска", exact: true })).toBeVisible();
    const waiting = (await (await admin.get(`/api/v1/matches/${match.id}`)).json()).match;
    expect(waiting.status).toBe("waiting"); expect(waiting.startedAt).toBeNull(); expect(waiting.activeJudge.userId).toBe(user.id);
    await login(page); await page.goto(`/matches/${match.id}`);
    await page.getByRole("button", { name: "Старт", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: /Tab10 Admin/ }).check();
    await dialog.getByRole("button", { name: "Начать матч", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(judge.getByRole("group", { name: "Счёт матча", exact: true })).toBeVisible({ timeout: 35000 });
    const started = (await (await admin.get(`/api/v1/matches/${match.id}`)).json()).match;
    expect(started.status).toBe("in_progress"); expect(started.startedAt).toBeTruthy(); expect(started.activeJudge.userId).toBe(user.id);
    await judge.getByRole("button", { name: /\+1 очко: Tab10 Admin/ }).click();
    await expect(judge.getByTestId("judge-side-A").locator(".judge-side__score")).toHaveText("1");
    await noOverflow(judge); await judge.screenshot({ path: info.outputPath("club-judge-after-creator-start.png"), fullPage: true });
    await mutate(target, "POST", `/api/v1/matches/${match.id}/stop`, { winnerSide: "A", reasonCode: "other", reasonText: "Синтетическая проверка завершена" });
    await page.reload(); await expect(page.getByText("Остановлен", { exact: true }).first()).toBeVisible();
    expect(judgeErrors).toEqual([]);
  } finally { await judgeContext.close(); await Promise.all([admin.dispose(), target.dispose()]); }
});
