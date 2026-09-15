import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, request } from "@playwright/test";

const baseURL = process.env.TAB10_AUDIT_BASE_URL;
const adminEmail = process.env.TAB10_AUDIT_ADMIN_EMAIL;
const adminPassword = process.env.TAB10_AUDIT_ADMIN_PASSWORD;
const fixturePassword = process.env.TAB10_AUDIT_FIXTURE_PASSWORD;
const databaseURL = process.env.TAB10_AUDIT_DATABASE_URL;
if (!baseURL || !adminEmail || !adminPassword || !fixturePassword || !databaseURL) throw new Error("Missing TAB10_AUDIT_* variables");
for (const raw of [baseURL, databaseURL]) assert.ok(["localhost", "127.0.0.1"].includes(new URL(raw).hostname));

const output = path.resolve("docs/audits/2026-09-13-ux-ui/admin/evidence");
const screenshots = path.join(output, "screenshots");
await mkdir(screenshots, { recursive: true });
const createdAt = new Date().toISOString();
const runTag = Date.now().toString(36).slice(-6);
let sequence = 0;
const fixtures = [];
const observations = {
  schemaVersion: 1,
  createdAt,
  baseline: { baseHead: "9f71b9f4c91f6f7184e8c34716d7b57b7c27a221", candidate: "GAP012-r6", sourceFingerprint: "8e8762575a07e71a17192da327cbe1b5906ca33c1c2ef762c0f9a37463b94cb3", version: "3.0.0", published: false },
  runs: {}, dialogs: [], console: [],
};

async function headers(api) {
  const csrf = (await api.storageState()).cookies.find((cookie) => cookie.name === "tab10_csrf");
  return { ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {}), "idempotency-key": randomUUID() };
}
async function fetchMutation(api, method, route, data = {}, extraHeaders = {}) {
  return api.fetch(route, { method, data, headers: { ...(await headers(api)), ...extraHeaders } });
}
async function mutate(api, method, route, data = {}, extraHeaders = {}) {
  const response = await fetchMutation(api, method, route, data, extraHeaders);
  const text = await response.text();
  assert.ok(response.status() < 300, `${method} ${route}: ${response.status()} ${text}`);
  return text ? JSON.parse(text) : {};
}
async function session(email, password) {
  const api = await request.newContext({ baseURL });
  await mutate(api, "POST", "/api/v1/auth/login", { email, password });
  return api;
}
const admin = await session(adminEmail, adminPassword);
await mutate(admin, "PATCH", "/api/v1/me/onboarding", { action: "complete" });
const requireFromApi = createRequire(path.resolve("apps/api/package.json"));
const postgres = requireFromApi("postgres");
const db = postgres(databaseURL, { max: 1 });

async function createUser(key, firstName, options = {}) {
  const email = `admin-audit-${key}-${runTag}-${++sequence}@audit.invalid`;
  const created = await mutate(admin, "POST", "/api/v1/admin/users", { email, firstName: `${firstName} ${runTag}`, lastName: options.lastName ?? "Проверочный", role: options.role ?? "user" });
  let api = null;
  if (options.complete !== false) {
    api = await session(email, created.temporaryPassword);
    await mutate(api, "POST", "/api/v1/auth/password/first-change", { newPassword: fixturePassword });
    await mutate(api, "PATCH", "/api/v1/me/onboarding", { action: "complete" });
  }
  const actor = { key, id: created.user.id, email, label: `${options.lastName ?? "Проверочный"} ${firstName} ${runTag}`, api, role: options.role ?? "user" };
  fixtures.push({ key, id: actor.id, label: actor.label, role: actor.role, status: "active" });
  return actor;
}

const resetUser = await createUser("reset", "Сброс");
const lostResetUser = await createUser("lost-reset", "ПотерянныйОтвет");
const blockedUser = await createUser("blocked", "Блокировка");
const roleUser = await createUser("role", "Роль");
const creator = await createUser("creator", "Создатель");
const playerA = await createUser("player-a", "ИгрокА");
const playerB = await createUser("player-b", "ИгрокБ");
const tournamentOrganizer = await createUser("t-organizer", "Организатор");
const tournamentTarget = await createUser("t-target", "АдминДобавляет");

async function newBrowserPage(actor, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ baseURL, viewport, locale: "ru-RU", timezoneId: "Europe/Moscow" });
  const page = await context.newPage();
  page.on("pageerror", (error) => observations.console.push({ actor: actor.key, type: "pageerror", text: error.message }));
  page.on("console", (message) => { if (message.type() === "error") observations.console.push({ actor: actor.key, type: "console", text: message.text() }); });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(actor.email);
  await page.getByLabel("Пароль", { exact: true }).fill(actor.password ?? fixturePassword);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL(/\/$/);
  return { context, page };
}
async function newAdminPage(viewport = { width: 390, height: 844 }) {
  return newBrowserPage({ key: "admin", email: adminEmail, password: adminPassword }, viewport);
}
async function shot(page, name, fullPage = false) { await page.screenshot({ path: path.join(screenshots, name), fullPage }); }
async function searchUser(page, actor, status = "") {
  const search = page.getByRole("search", { name: "Поиск пользователей" });
  await search.getByLabel("Имя или email").fill(actor.email);
  if (status) await search.getByLabel("Статус").selectOption(status);
  await search.getByRole("button", { name: "Найти", exact: true }).click();
  await page.getByText(actor.email, { exact: false }).waitFor();
  return page.locator(".list-row--admin").filter({ hasText: actor.email });
}
async function confirmRowAction(page, actor, label) {
  const row = await searchUser(page, actor);
  await row.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog");
  const text = (await dialog.textContent())?.replace(/\s+/g, " ").trim();
  const dialogId = await dialog.getAttribute("data-app-dialog-id");
  observations.dialogs.push({ actor: actor.key, action: label, text });
  await dialog.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await page.locator(`[data-app-dialog-id="${dialogId}"]`).waitFor({ state: "detached" });
  return dialog;
}
async function loginStatus(email, password) {
  const probe = await request.newContext({ baseURL });
  const response = await fetchMutation(probe, "POST", "/api/v1/auth/login", { email, password });
  const body = await response.json().catch(() => ({}));
  await probe.dispose();
  return { status: response.status(), code: body.code ?? null, mustChangePassword: body.user?.mustChangePassword ?? null };
}

const browser = await chromium.launch({ headless: true });

// A-RUN-001: route hierarchy, create/list order, loading/error/empty, narrow and desktop geometry.
const admin390 = await newAdminPage();
const page = admin390.page;
await page.goto("/profile");
const adminLink = page.getByRole("link", { name: /^Админка/ });
await adminLink.waitFor();
await adminLink.click();
await page.waitForURL(/\/admin$/);
await page.getByRole("heading", { name: "Пользователи", exact: true }).waitFor();
await page.evaluate(() => scrollTo(0, 0));
const hierarchy390 = await page.evaluate(() => {
  const heading = [...document.querySelectorAll("h2")].find((node) => node.textContent?.trim() === "Пользователи");
  const create = document.querySelector('form[aria-label="Создание пользователя"]');
  const search = document.querySelector('form[aria-label="Поиск пользователей"]');
  const bottomCurrent = document.querySelector("nav")?.querySelector('[aria-current="page"]');
  return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth, createTop: create?.getBoundingClientRect().top, usersTop: heading?.getBoundingClientRect().top, searchTop: search?.getBoundingClientRect().top, searchInitiallyVisible: Boolean(search && search.getBoundingClientRect().top < innerHeight), activeBottomLabel: bottomCurrent?.textContent?.trim() ?? null, backLinks: [...document.querySelectorAll("a")].filter((node) => /Назад|Профиль/.test(node.textContent ?? "")).length };
});
await shot(page, "a01-admin-landing-390.png", true);
await page.setViewportSize({ width: 360, height: 800 });
const longRow = await searchUser(page, lostResetUser);
await longRow.getByRole("button", { name: "Редактировать", exact: true }).focus();
const narrow360 = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth, focused: document.activeElement?.textContent?.trim() }));
await shot(page, "a01-admin-row-focus-360.png", true);
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto("/admin");
await page.getByRole("heading", { name: "Пользователи", exact: true }).waitFor();
await page.evaluate(() => scrollTo(0, 0));
const desktop = await page.evaluate(() => ({ viewport: innerWidth, content: document.querySelector("main")?.getBoundingClientRect().toJSON(), documentWidth: document.documentElement.scrollWidth }));
await shot(page, "a01-admin-landing-1440.png", true);

const statePageBundle = await newAdminPage({ width: 390, height: 844 });
const statePage = statePageBundle.page;
let releaseUsers;
let markUsersRequested;
const usersRequested = new Promise((resolve) => { markUsersRequested = resolve; });
await statePage.route("**/api/v1/admin/users", async (route) => { markUsersRequested(); await new Promise((resolve) => { releaseUsers = resolve; }); await route.continue(); });
const loadingNavigation = statePage.goto("/admin");
await usersRequested;
const skeletonCount = await statePage.locator('[data-variant="rectangular"]').count();
await shot(statePage, "a01-users-loading-390.png");
releaseUsers();
await loadingNavigation;
await statePage.unroute("**/api/v1/admin/users");
await statePage.route("**/api/v1/admin/users?**", (route) => route.abort("failed"));
await statePage.getByRole("search").getByLabel("Имя или email").fill(`none-${runTag}`);
await statePage.getByRole("search").getByRole("button", { name: "Найти", exact: true }).click();
await statePage.getByText("Не удалось загрузить пользователей", { exact: true }).waitFor();
await shot(statePage, "a01-users-error-390.png");
await statePage.unroute("**/api/v1/admin/users?**");
await statePage.getByRole("button", { name: "Повторить", exact: true }).click();
await statePage.getByText("Пользователи не найдены", { exact: true }).waitFor();
await shot(statePage, "a01-users-empty-390.png");
observations.runs["A-RUN-001"] = { scenarios: ["SC-AD01", "SC-AD08"], result: "FAIL_FINDINGS", hierarchy390, narrow360, desktop, states: { loading: true, skeletonCount, error: true, retryToEmpty: true } };

// A-RUN-002: UI creation, duplicate, one-time temporary password and profile edit.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("/admin");
const newEmail = `admin-audit-ui-${runTag}@audit.invalid`;
const createForm = page.getByRole("form", { name: "Создание пользователя" });
await createForm.getByLabel("Email").fill(newEmail);
await createForm.getByLabel("Имя", { exact: true }).fill("ОченьДлинноеИмяПроверки");
await createForm.getByLabel("Фамилия", { exact: true }).fill("ОченьДлиннаяФамилияПроверки");
await createForm.getByRole("button", { name: "Создать", exact: true }).click();
const tempDialog = page.getByRole("dialog", { name: "Временный пароль" });
await tempDialog.waitFor();
const tempValue = (await tempDialog.locator(".temp-password__value").textContent())?.trim() ?? "";
assert.ok(tempValue.length >= 12);
const copyVisible = await tempDialog.getByRole("button", { name: /Скопировать/ }).isVisible();
await tempDialog.locator(".temp-password__value").evaluate((node) => { node.textContent = "[СКРЫТО — одноразовый пароль]"; });
await shot(page, "a02-created-temp-password-masked-390.png");
await tempDialog.getByRole("button", { name: "Готово", exact: true }).click();
await createForm.getByLabel("Email").fill(newEmail.toUpperCase());
await createForm.getByLabel("Имя", { exact: true }).fill("Дубликат");
await createForm.getByLabel("Фамилия", { exact: true }).fill("Проверочный");
await createForm.getByRole("button", { name: "Создать", exact: true }).click();
await page.getByText("Действие не выполнено", { exact: true }).waitFor();
const duplicateText = await page.getByRole("alert").filter({ hasText: "Действие не выполнено" }).textContent();
const createdActor = { key: "ui-created", email: newEmail };
const createdRow = await searchUser(page, createdActor);
await createdRow.getByRole("button", { name: "Редактировать", exact: true }).click();
const profileDialog = page.getByRole("dialog", { name: "Профиль пользователя" });
await profileDialog.getByLabel("Организация").fill("Исследовательская лаборатория пользовательских операций");
await profileDialog.getByLabel("Должность").fill("Ответственный за безопасное управление доступом");
await profileDialog.getByRole("button", { name: "Сохранить", exact: true }).click();
await page.getByText("Исследовательская лаборатория", { exact: false }).count();
observations.runs["A-RUN-002"] = { scenarios: ["SC-AD01", "SC-AD02"], result: "PASS_WITH_FINDING", tempPassword: { length: tempValue.length, copyVisible, persisted: false }, duplicate: { blocked: true, message: duplicateText?.replace(/\s+/g, " ").trim() }, profile: { editDialog: true, stableDetailUrl: false, auditHistoryVisible: false } };

// A-RUN-003: reset success, revoked session, old password rejection and new temporary credential.
const resetSessionBefore = await resetUser.api.get("/api/v1/auth/me");
assert.equal(resetSessionBefore.status(), 200);
await confirmRowAction(page, resetUser, "Сброс");
const resetTempDialog = page.getByRole("dialog", { name: "Временный пароль" });
await resetTempDialog.waitFor();
const resetTempValue = (await resetTempDialog.locator(".temp-password__value").textContent())?.trim() ?? "";
assert.ok(resetTempValue.length >= 12);
await resetTempDialog.locator(".temp-password__value").evaluate((node) => { node.textContent = "[СКРЫТО — одноразовый пароль]"; });
await shot(page, "a03-reset-temp-password-masked-390.png");
await resetTempDialog.getByRole("button", { name: "Готово", exact: true }).click();
const resetSessionAfter = await resetUser.api.get("/api/v1/auth/me");
const oldLoginAfterReset = await loginStatus(resetUser.email, fixturePassword);
const newLoginAfterReset = await loginStatus(resetUser.email, resetTempValue);
observations.runs["A-RUN-003"] = { scenarios: ["SC-AD03"], result: "PASS", previousSession: { before: resetSessionBefore.status(), after: resetSessionAfter.status() }, oldLoginAfterReset, newLoginAfterReset, tempSecretPersisted: false };

// A-RUN-004: lost reset response. The synthetic reset is applied, the response is aborted, and no retry is sent.
await page.goto("/admin");
const lostRoute = `**/api/v1/admin/users/${lostResetUser.id}/reset-password`;
let appliedStatus = null;
let resetPosts = 0;
let adminGetsAfterFailure = 0;
page.on("request", (req) => {
  if (req.method() === "POST" && req.url().includes(`/admin/users/${lostResetUser.id}/reset-password`)) resetPosts += 1;
  if (req.method() === "GET" && req.url().includes("/api/v1/admin/users")) adminGetsAfterFailure += 1;
});
await page.route(lostRoute, async (route) => { const response = await route.fetch(); appliedStatus = response.status(); await route.abort("failed"); });
const lostRow = await searchUser(page, lostResetUser);
adminGetsAfterFailure = 0;
await lostRow.getByRole("button", { name: "Сброс", exact: true }).click();
await page.getByRole("dialog", { name: "Сбросить пароль?" }).getByRole("button", { name: "Подтвердить", exact: true }).click();
await page.getByText("Действие не выполнено", { exact: true }).waitFor();
await shot(page, "a04-reset-lost-response-390.png");
const lostOldLogin = await loginStatus(lostResetUser.email, fixturePassword);
const lostOldSession = await lostResetUser.api.get("/api/v1/auth/me");
observations.runs["A-RUN-004"] = { scenarios: ["SC-AD03"], result: "FAIL_FINDING", appliedStatus, resetPosts, getFirstAfterFailure: adminGetsAfterFailure, dialogStillOpen: await page.getByRole("dialog", { name: "Сбросить пароль?" }).isVisible(), confirmStillEnabled: await page.getByRole("dialog", { name: "Сбросить пароль?" }).getByRole("button", { name: "Подтвердить", exact: true }).isEnabled(), oldLogin: lostOldLogin, oldSessionStatus: lostOldSession.status(), secretRecovered: false, blindRetryPerformed: false };
await page.unroute(lostRoute);
await page.getByRole("dialog", { name: "Сбросить пароль?" }).getByRole("button", { name: "Отмена", exact: true }).click();

// A-RUN-005: block/unblock, stale session recovery, directory/history effects.
const blockedBrowser = await newBrowserPage(blockedUser);
await blockedBrowser.page.goto("/profile");
await confirmRowAction(page, blockedUser, "Блок");
await page.getByText("Пользователи не найдены", { exact: true }).waitFor().catch(() => {});
const blockedSession = await blockedUser.api.get("/api/v1/auth/me");
const blockedLogin = await loginStatus(blockedUser.email, fixturePassword);
const directoryAfterBlock = await (await creator.api.get(`/api/v1/users/directory?q=${encodeURIComponent(runTag)}`)).json();
await blockedBrowser.page.goto("/history");
await blockedBrowser.page.getByRole("heading", { name: "Вход", exact: true }).waitFor();
const staleRecovery = { url: new URL(blockedBrowser.page.url()).pathname, emailFocused: await blockedBrowser.page.getByLabel("Email", { exact: true }).evaluate((el) => el === document.activeElement), bottomNavVisible: await blockedBrowser.page.locator("nav").count() };
await page.goto("/admin");
const blockedRow = await searchUser(page, blockedUser, "blocked");
await shot(page, "a05-blocked-filter-390.png", true);
  await blockedRow.getByRole("button", { name: "Разблокировать", exact: true }).click();
  const unblockDialog = page.getByRole("dialog");
  const unblockDialogId = await unblockDialog.getAttribute("data-app-dialog-id");
  await unblockDialog.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await page.locator(`[data-app-dialog-id="${unblockDialogId}"]`).waitFor({ state: "detached" });
  await blockedRow.waitFor({ state: "detached" });
const loginAfterUnblock = await loginStatus(blockedUser.email, fixturePassword);
const directoryAfterUnblock = await (await creator.api.get(`/api/v1/users/directory?q=${encodeURIComponent(runTag)}`)).json();
observations.runs["A-RUN-005"] = { scenarios: ["SC-AD04", "SC-AD07"], result: "PASS", blocked: { sessionStatus: blockedSession.status(), login: blockedLogin, directoryContains: directoryAfterBlock.users.some((u) => u.id === blockedUser.id) }, staleRecovery, unblocked: { login: loginAfterUnblock, revokedSessionStillStatus: (await blockedUser.api.get("/api/v1/auth/me")).status(), directoryContains: directoryAfterUnblock.users.some((u) => u.id === blockedUser.id) } };

// A-RUN-006: role lifecycle, session revocation and self/last-admin guards.
await page.goto("/admin");
await confirmRowAction(page, roleUser, "Сделать админом");
const promotedSession = await roleUser.api.get("/api/v1/auth/me");
const promotedFresh = await loginStatus(roleUser.email, fixturePassword);
await confirmRowAction(page, roleUser, "Снять админа");
const selfPatch = await fetchMutation(admin, "PATCH", `/api/v1/admin/users/${(await (await admin.get("/api/v1/auth/me")).json()).user.id}`, { role: "user" });
const selfBlock = await fetchMutation(admin, "POST", `/api/v1/admin/users/${(await (await admin.get("/api/v1/auth/me")).json()).user.id}/block`, {});
await page.goto("/admin");
const selfRow = page.locator(".list-row--admin").filter({ hasText: adminEmail });
await selfRow.waitFor();
observations.runs["A-RUN-006"] = { scenarios: ["SC-AD05"], result: "PASS", promoted: { oldSessionStatus: promotedSession.status(), freshLogin: promotedFresh }, demoted: true, selfUI: { roleButtons: await selfRow.getByRole("button", { name: /Сделать админом|Снять админа/ }).count(), blockButtons: await selfRow.getByRole("button", { name: "Блок", exact: true }).count(), resetButtons: await selfRow.getByRole("button", { name: "Сброс", exact: true }).count() }, directGuards: { roleStatus: selfPatch.status(), roleCode: (await selfPatch.json()).code, blockStatus: selfBlock.status(), blockCode: (await selfBlock.json()).code } };

// A-RUN-007: D17 remains closed; D23 mutation exists but ADMIN has no discoverable recovery path.
const createdMatch = (await mutate(creator.api, "POST", "/api/v1/matches", { title: `Застрявший матч ${runTag}`, format: "1v1", pointsToWin: 11, firstServerMethod: "manual", source: "manual", sendPlayerInvitations: false, participants: [{ side: "A", userId: playerA.id }, { side: "B", userId: playerB.id }] })).match;
const startedMatch = (await mutate(creator.api, "POST", `/api/v1/matches/${createdMatch.id}/start`, { firstServerParticipantId: createdMatch.participants[0].id })).match;
const adminExact = await admin.get(`/api/v1/matches/${createdMatch.id}`);
const adminList = await (await admin.get("/api/v1/matches")).json();
const adminHistory = await (await admin.get("/api/v1/history")).json();
await page.goto(`/matches/${createdMatch.id}`);
await page.getByRole("alert").waitFor();
const ordinaryDetailError = (await page.getByRole("alert").textContent())?.replace(/\s+/g, " ").trim();
await shot(page, "a07-active-match-d17-403-390.png");
await page.goto("/admin");
const adminPageText = await page.locator("main").textContent();
const forceClosed = await mutate(admin, "POST", `/api/v1/admin/matches/${createdMatch.id}/force-close`, { expectedVersion: startedMatch.version, reasonText: "Изолированная проверка D23" });
observations.runs["A-RUN-007"] = { scenarios: ["SC-AD06"], result: "BLOCKED_DECISION", d17: { exactGetStatus: adminExact.status(), listContains: adminList.matches.some((m) => m.id === createdMatch.id), historyContains: adminHistory.items.some((m) => m.id === createdMatch.id), ordinaryDetail403Expected: true, ordinaryDetailError }, adminEntry: { route: "/admin", containsMatchIdField: /ID матча|Матч по ID/.test(adminPageText ?? ""), forceCloseButtons: await page.getByRole("button", { name: /Закрыть матч принудительно/ }).count() }, d23: { directMutationStatus: forceClosed.match.status, priorVersion: startedMatch.version, resultingVersion: forceClosed.match.version } };

// A-RUN-008: repeat only the necessary scoped-admin tournament path from accepted supporting package.
const tournament = (await mutate(tournamentOrganizer.api, "POST", "/api/v1/tournaments", { title: `Admin scoped ${runTag}`, format: "single_elimination", organizerParticipates: false, requireParticipantConsent: true })).tournament;
for (const index of [1, 2, 3]) await mutate(tournamentOrganizer.api, "POST", `/api/v1/tournaments/${tournament.id}/participants`, { guestFirstName: `Гость${index}`, guestLastName: runTag });
await mutate(tournamentOrganizer.api, "POST", `/api/v1/tournaments/${tournament.id}/bracket`, { constructionAlgorithm: "compact" });
const beforeTournament = (await (await tournamentOrganizer.api.get(`/api/v1/tournaments/${tournament.id}`)).json()).tournament;
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto("/start");
await page.getByRole("button", { name: "Турнир", exact: true }).click();
await page.getByText(tournament.title, { exact: true }).click();
await page.waitForURL(new RegExp(`/tournaments/${tournament.id}$`));
await shot(page, "a08-scoped-admin-before-1440.png", true);
const picker = page.getByRole("combobox", { name: "Добавить игрока", exact: true });
await picker.fill(tournamentTarget.label.split(" ").at(-2));
await page.getByRole("option", { name: tournamentTarget.label, exact: true }).click();
let namedConfirm = null;
page.once("dialog", async (dialog) => { namedConfirm = dialog.message(); await dialog.accept(); });
await page.getByRole("button", { name: "Добавить в состав", exact: true }).click();
await page.getByText("Игрок добавлен", { exact: true }).waitFor();
const afterTournament = (await (await tournamentOrganizer.api.get(`/api/v1/tournaments/${tournament.id}`)).json()).tournament;
await page.setViewportSize({ width: 390, height: 844 });
await shot(page, "a08-scoped-admin-after-390.png", true);
const forbiddenSettings = await fetchMutation(admin, "PATCH", `/api/v1/tournaments/${tournament.id}`, { pointsToWin: 7 });
const forbiddenStart = await fetchMutation(admin, "POST", `/api/v1/tournaments/${tournament.id}/start`, {});
observations.runs["A-RUN-008"] = { scenarios: ["SC-AD06"], result: "PASS", entry: "/start → /tournaments → detail", namedConfirm, added: { userId: tournamentTarget.id, exists: afterTournament.participants.some((p) => p.userId === tournamentTarget.id), additionSource: afterTournament.participants.find((p) => p.userId === tournamentTarget.id)?.additionSource, bracketVersionBefore: beforeTournament.bracketStateVersion, bracketVersionAfter: afterTournament.bracketStateVersion }, authority: { settingsStatus: forbiddenSettings.status(), startStatus: forbiddenStart.status(), organizerControlsVisible: await page.getByRole("button", { name: /Старт|Распустить|Отменить турнир/ }).count() } };

const auditedIds = [resetUser.id, lostResetUser.id, blockedUser.id, roleUser.id];
const auditRows = await db`SELECT entity_id, action, created_at FROM audit_logs WHERE entity_id = ANY(${auditedIds}) ORDER BY created_at`;
const passwordIssues = await db`SELECT user_id, count(*)::int AS issue_count, max(issued_at) AS latest_issued_at FROM temporary_password_issues WHERE user_id = ANY(${[resetUser.id, lostResetUser.id]}) GROUP BY user_id ORDER BY user_id`;
observations.auditPersistence = {
  rows: auditRows.map((row) => ({ entityId: row.entity_id, action: row.action, createdAt: row.created_at })),
  temporaryPasswordIssues: passwordIssues.map((row) => ({ userId: row.user_id, issueCount: row.issue_count, latestIssuedAt: row.latest_issued_at })),
  secretsPersisted: false,
};

await writeFile(path.join(output, "runtime-observations.json"), `${JSON.stringify(observations, null, 2)}\n`);
await writeFile(path.join(output, "fixture-index.json"), `${JSON.stringify({ schemaVersion: 1, createdAt, fixtures }, null, 2)}\n`);
await Promise.all([admin390.context.close(), statePageBundle.context.close(), blockedBrowser.context.close()]);
await browser.close();
await Promise.all([admin.dispose(), resetUser.api.dispose(), lostResetUser.api.dispose(), blockedUser.api.dispose(), roleUser.api.dispose(), creator.api.dispose(), playerA.api.dispose(), playerB.api.dispose(), tournamentOrganizer.api.dispose(), tournamentTarget.api.dispose()]);
await db.end({ timeout: 5 });
const screenshotCount = (await readdir(screenshots)).filter((name) => name.endsWith(".png")).length;
console.log(JSON.stringify({ status: "complete", runs: Object.keys(observations.runs).length, screenshots: screenshotCount, consoleErrors: observations.console.length }));
