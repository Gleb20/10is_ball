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
if (!baseURL || !adminEmail || !adminPassword || !fixturePassword || !databaseURL) {
  throw new Error("Required TAB10_AUDIT_* environment variables are missing");
}
const parsedBase = new URL(baseURL);
assert.ok(["localhost", "127.0.0.1"].includes(parsedBase.hostname));
const parsedDb = new URL(databaseURL);
assert.ok(["localhost", "127.0.0.1"].includes(parsedDb.hostname));

const output = path.resolve("docs/audits/2026-09-13-ux-ui/tournament/evidence");
const screenshots = path.join(output, "screenshots");
await mkdir(screenshots, { recursive: true });
let sequence = 0;
const runTag = Date.now().toString(36).slice(-5);
const now = new Date().toISOString();
const observations = {
  schemaVersion: 1,
  createdAt: now,
  baseline: {
    baseHead: "9f71b9f4c91f6f7184e8c34716d7b57b7c27a221",
    candidate: "GAP012-r6",
    sourceFingerprint: "8e8762575a07e71a17192da327cbe1b5906ca33c1c2ef762c0f9a37463b94cb3",
    version: "3.0.0",
    published: false,
  },
  runs: {},
  dialogs: [],
  console: [],
};
const fixtures = [];

async function headers(api) {
  const csrf = (await api.storageState()).cookies.find((cookie) => cookie.name === "tab10_csrf");
  return {
    ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {}),
    "idempotency-key": randomUUID(),
  };
}

async function fetchMutation(api, method, route, data = {}) {
  return api.fetch(route, { method, data, headers: await headers(api) });
}

async function mutate(api, method, route, data = {}) {
  const response = await fetchMutation(api, method, route, data);
  const text = await response.text();
  assert.ok(response.status() < 300, `${method} ${route}: ${response.status()} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function createSession(email, password) {
  const api = await request.newContext({ baseURL });
  await mutate(api, "POST", "/api/v1/auth/login", { email, password });
  return api;
}

const admin = await createSession(adminEmail, adminPassword);
await mutate(admin, "PATCH", "/api/v1/me/onboarding", { action: "complete" });

async function createUser(key, firstName, { complete = true } = {}) {
  const uniqueFirstName = `${firstName} ${runTag}`;
  const created = await mutate(admin, "POST", "/api/v1/admin/users", {
    email: `tournament-${key}-${Date.now()}-${++sequence}@tab10.test`,
    firstName: uniqueFirstName,
    lastName: "UXT",
  });
  let api;
  if (complete) {
    api = await createSession(created.user.email, created.temporaryPassword);
    await mutate(api, "POST", "/api/v1/auth/password/first-change", {
      newPassword: fixturePassword,
    });
    await mutate(api, "PATCH", "/api/v1/me/onboarding", { action: "complete" });
  }
  const actor = {
    key,
    id: created.user.id,
    label: `UXT ${uniqueFirstName}`,
    role: created.user.role,
    status: created.user.status,
    api,
    email: created.user.email,
  };
  fixtures.push({ key, id: actor.id, label: actor.label, role: actor.role, status: actor.status });
  return actor;
}

const organizer = await createUser("organizer", "Организатор");
const accepted = await createUser("accepted", "Принявший");
const pending = await createUser("pending", "Ожидающий");
const declined = await createUser("declined", "Отказавшийся");
const expired = await createUser("expired", "Просроченный");
const left = await createUser("left", "Вышедший");
const teammate = await createUser("teammate", "Командный");
const lateOrganizer = await createUser("late-organizer", "Опоздавший");
const lateAdmin = await createUser("late-admin", "Админский");
const outsider = await createUser("outsider", "Посторонний");
const playerActors = [];
for (const [key, firstName] of [
  ["player-a", "Игрок Альфа"],
  ["player-b", "Игрок Бета"],
  ["player-c", "Игрок Гамма"],
  ["player-d", "Игрок Дельта"],
  ["player-e", "Игрок Эпсилон"],
]) playerActors.push(await createUser(key, firstName));

const requireFromApi = createRequire(path.resolve("apps/api/package.json"));
const postgres = requireFromApi("postgres");
const db = postgres(databaseURL, { max: 1 });

async function createTournament(api, title, options = {}) {
  const { tournament } = await mutate(api, "POST", "/api/v1/tournaments", {
    title,
    format: options.format ?? "single_elimination",
    organizerParticipates: options.organizerParticipates ?? false,
    requireParticipantConsent: options.requireParticipantConsent ?? false,
  });
  fixtures.push({ key: options.key ?? title, id: tournament.id, kind: "tournament", title });
  return tournament;
}

async function addGuest(api, tournamentId, index) {
  return mutate(api, "POST", `/api/v1/tournaments/${tournamentId}/participants`, {
    guestFirstName: `Гость${index}`,
    guestLastName: "UXT",
  });
}

async function addRegistered(api, tournamentId, actor, extra = {}) {
  return mutate(api, "POST", `/api/v1/tournaments/${tournamentId}/participants`, {
    userId: actor.id,
    ...extra,
  });
}

async function getTournament(api, tournamentId) {
  const response = await api.get(`/api/v1/tournaments/${tournamentId}`);
  const body = await response.text();
  assert.ok(response.ok(), `GET tournament ${response.status()} ${body}`);
  return JSON.parse(body).tournament;
}

async function waitTournamentStatus(api, tournamentId, expectedStatus) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const tournament = await getTournament(api, tournamentId);
    if (tournament.status === expectedStatus) return tournament;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Tournament ${tournamentId} did not reach ${expectedStatus}`);
}

async function scoreUntilPending(api, matchId, startedMatch, side = "A") {
  let current = startedMatch;
  for (let guard = 0; guard < 20 && current.status !== "pending_confirmation"; guard++) {
    current = (await mutate(api, "POST", `/api/v1/matches/${matchId}/points`, {
      side,
      expectedVersion: current.version,
    })).match;
  }
  assert.equal(current.status, "pending_confirmation");
  return current;
}

async function createBrowserPage(actor, viewport = { width: 390, height: 844 }, touch = true) {
  const context = await browser.newContext({
    baseURL,
    viewport,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    isMobile: touch,
    hasTouch: touch,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => observations.console.push({ actor: actor.key, type: "pageerror", text: error.message }));
  page.on("console", (message) => {
    if (message.type() === "error") observations.console.push({ actor: actor.key, type: "console", text: message.text() });
  });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(actor.email);
  await page.getByLabel("Пароль", { exact: true }).fill(fixturePassword);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL(/\/$/);
  return { context, page };
}

async function createAdminPage(viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ baseURL, viewport, locale: "ru-RU", timezoneId: "Europe/Moscow" });
  const page = await context.newPage();
  page.on("pageerror", (error) => observations.console.push({ actor: "admin", type: "pageerror", text: error.message }));
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(adminEmail);
  await page.getByLabel("Пароль", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL(/\/$/);
  return { context, page };
}

async function screenshot(page, name, fullPage = false) {
  await page.screenshot({ path: path.join(screenshots, name), fullPage });
}

async function selectUser(page, inputLabel, actor) {
  const picker = page.getByRole("combobox", { name: inputLabel, exact: true });
  await picker.fill(actor.label.split(" ").at(-1));
  await page.getByRole("option", { name: actor.label, exact: true }).click();
}

async function confirmClick(page, buttonName, runId) {
  let dialogMessage = null;
  page.once("dialog", async (dialog) => {
    dialogMessage = dialog.message();
    observations.dialogs.push({ runId, type: dialog.type(), message: dialogMessage });
    await dialog.accept();
  });
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  await page.waitForTimeout(50);
  return dialogMessage;
}

const browser = await chromium.launch({ headless: true });
const organizerBrowser = await createBrowserPage(organizer);
const page = organizerBrowser.page;

// SC-T01: current creation UI, direct roster, nonplaying organizer, guest and registered participant.
await page.goto("/tournaments");
await page.getByLabel("Название", { exact: true }).fill("UXT Direct 3 SE");
await page.getByLabel("Организатор участвует", { exact: true }).uncheck();
assert.equal(await page.getByLabel("Требовать согласие приглашённых участников", { exact: true }).isChecked(), false);
const createGeometry = await page.evaluate(() => ({
  viewport: { width: innerWidth, height: innerHeight },
  documentWidth: document.documentElement.scrollWidth,
  documentHeight: document.documentElement.scrollHeight,
  title: document.querySelector('input[aria-label="Название"]')?.getBoundingClientRect().toJSON(),
  submit: [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === "Создать")?.getBoundingClientRect().toJSON(),
}));
await screenshot(page, "t01-create-direct-390.png");
await page.getByRole("button", { name: "Создать", exact: true }).click();
await page.waitForURL(/\/tournaments\/[0-9a-f-]+$/);
const directId = page.url().split("/").at(-1);
await page.getByRole("note").waitFor();
await screenshot(page, "t01-empty-room-390.png");
await selectUser(page, "Добавить игрока", accepted);
const directDialog = await confirmClick(page, "Добавить в состав", "T-RUN-001");
await page.getByText("Игрок добавлен", { exact: true }).waitFor();
for (const name of ["Гость Один", "Гость Два"]) {
  await page.getByLabel("Добавить гостя (Имя Фамилия)").fill(name);
  await page.getByRole("button", { name: "Добавить гостя", exact: true }).click();
  await page.getByText("Гость добавлен", { exact: true }).waitFor();
}
let direct = await getTournament(organizer.api, directId);
assert.equal(direct.requireParticipantConsent, false);
assert.equal(direct.organizerParticipates, false);
assert.equal(direct.participants.filter((row) => row.status === "active").length, 3);
assert.equal(direct.participants.some((row) => row.userId === organizer.id), false);
await screenshot(page, "t01-roster-ready-390.png", true);
await page.getByTestId("tournament-build-bracket").click();
await page.getByRole("dialog").waitFor();
await screenshot(page, "t01-algorithm-dialog-390.png");
await page.getByRole("dialog").getByRole("button", { name: "Построить сетку", exact: true }).click();
await page.getByRole("button", { name: "Старт", exact: true }).waitFor();
direct = await getTournament(organizer.api, directId);
assert.equal(direct.status, "bracket_generated");
await page.locator(".tournament-bracket__scroll").first().scrollIntoViewIfNeeded();
await screenshot(page, "t01-generated-bracket-390.png");
await page.setViewportSize({ width: 1440, height: 900 });
await page.locator(".tournament-bracket__scroll").first().scrollIntoViewIfNeeded();
await screenshot(page, "t01-generated-bracket-1440.png");

observations.runs["T-RUN-001"] = {
  scenarios: ["SC-T01"],
  result: "PASS_WITH_FINDING",
  tournamentId: directId,
  createGeometry,
  directAddDialog: directDialog,
  persisted: {
    status: direct.status,
    requireParticipantConsent: direct.requireParticipantConsent,
    organizerParticipates: direct.organizerParticipates,
    activeParticipants: direct.participants.filter((row) => row.status === "active").length,
    organizerInRoster: direct.participants.some((row) => row.userId === organizer.id),
    bracketSchemaVersion: direct.bracketJson?.schemaVersion,
  },
};

// SC-T01/T04 topology matrix: V2 SE/DE, 3/5/8, BYE-bearing Po2 at 3 and 5.
const topology = [];
for (const format of ["single_elimination", "double_elimination"]) {
  for (const size of [3, 5, 8]) {
    const title = `UXT ${format === "single_elimination" ? "SE" : "DE"} ${size}`;
    const t = await createTournament(organizer.api, title, { format, key: `topology-${format}-${size}` });
    for (let index = 1; index <= size; index++) await addGuest(organizer.api, t.id, index);
    await mutate(organizer.api, "POST", `/api/v1/tournaments/${t.id}/bracket`, { constructionAlgorithm: "power_of_two" });
    const generated = await getTournament(organizer.api, t.id);
    await page.goto(`/tournaments/${t.id}`);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.locator(".tournament-bracket__scroll").first().scrollIntoViewIfNeeded();
    await screenshot(page, `t04-${format === "single_elimination" ? "se" : "de"}-${size}-landscape.png`);
    topology.push({
      tournamentId: t.id,
      format,
      size,
      status: generated.status,
      schemaVersion: generated.bracketJson?.schemaVersion,
      constructionAlgorithm: generated.bracketJson?.constructionAlgorithm,
      seedSlots: generated.bracketJson?.seedOrder?.length ?? null,
      byeSlots: generated.bracketJson?.seedOrder?.filter((value) => value == null).length ?? null,
      matchNodes: generated.bracketJson?.matches?.length ?? null,
      renderedBands: await page.locator(".tournament-bracket__band").count(),
      documentOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    });
  }
}
observations.runs["T-RUN-002"] = { scenarios: ["SC-T01", "SC-T04"], result: "PASS", topology };

// Bracket navigation/focus/zoom at 390, 360 and narrow landscape.
const topology8 = topology.find((row) => row.format === "double_elimination" && row.size === 8);
await page.goto(`/tournaments/${topology8.tournamentId}`);
await page.setViewportSize({ width: 390, height: 844 });
const bracketRegion = page.locator(".tournament-bracket__scroll").first();
await bracketRegion.scrollIntoViewIfNeeded();
await bracketRegion.focus();
const focusStyle = await bracketRegion.evaluate((element) => {
  const style = getComputedStyle(element);
  return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor };
});
const beforeEnd = await bracketRegion.evaluate((element) => ({ left: element.scrollLeft, max: element.scrollWidth - element.clientWidth }));
await bracketRegion.press("End");
const afterEnd = await bracketRegion.evaluate((element) => ({ left: element.scrollLeft, max: element.scrollWidth - element.clientWidth }));
await bracketRegion.press("Home");
await page.getByRole("button", { name: /Увеличить сетку: Победители/ }).click();
const zoom125 = await page.getByLabel("Масштаб: Победители").textContent();
await screenshot(page, "t04-de8-keyboard-focus-zoom-390.png");
await page.setViewportSize({ width: 360, height: 800 });
await bracketRegion.scrollIntoViewIfNeeded();
await screenshot(page, "t04-de8-narrow-360.png");
const narrow = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }));
await page.setViewportSize({ width: 844, height: 390 });
await bracketRegion.scrollIntoViewIfNeeded();
await screenshot(page, "t04-de8-bracket-landscape.png");
const landscape = await bracketRegion.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, scrollable: element.scrollWidth > element.clientWidth }));
observations.runs["T-RUN-003"] = {
  scenarios: ["SC-T04"], result: "PASS_WITH_FINDING", focusStyle, beforeEnd, afterEnd, zoom125, narrow, landscape,
};

// SC-T02: consent, accepted/pending/declined/expired/withdrawn and teammate direct addition.
const team = (await mutate(organizer.api, "POST", "/api/v1/teams", { name: "Команда UXT" })).team;
const teamInvite = (await mutate(organizer.api, "POST", `/api/v1/teams/${team.id}/invitations`, { userId: teammate.id })).invitation;
await mutate(teammate.api, "POST", `/api/v1/team-invitations/${teamInvite.id}/accept`, {});
const consentTournament = await createTournament(organizer.api, "UXT Consent states", { requireParticipantConsent: true, key: "consent-states" });
async function invite(actor) {
  return (await mutate(organizer.api, "POST", `/api/v1/tournaments/${consentTournament.id}/invitations`, { userId: actor.id })).invitation;
}
const acceptedInvite = await invite(accepted);
await mutate(accepted.api, "POST", `/api/v1/tournament-invitations/${acceptedInvite.id}/respond`, { accept: true });
const pendingInvite = await invite(pending);
const declinedInvite = await invite(declined);
await mutate(declined.api, "POST", `/api/v1/tournament-invitations/${declinedInvite.id}/respond`, { accept: false });
const expiredInvite = await invite(expired);
await db`UPDATE tournament_invitations SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = ${expiredInvite.id}`;
const expiredResponse = await fetchMutation(expired.api, "POST", `/api/v1/tournament-invitations/${expiredInvite.id}/respond`, { accept: true });
assert.equal(expiredResponse.status(), 400);
const leftInvite = await invite(left);
await mutate(left.api, "POST", `/api/v1/tournament-invitations/${leftInvite.id}/respond`, { accept: true });
await mutate(left.api, "POST", `/api/v1/tournaments/${consentTournament.id}/withdraw`, {});
await addGuest(organizer.api, consentTournament.id, 20);
await page.goto(`/tournaments/${consentTournament.id}`);
await page.setViewportSize({ width: 390, height: 844 });
await selectUser(page, "Добавить игрока", teammate);
const teammateDialog = await confirmClick(page, "Добавить в состав", "T-RUN-004");
await page.getByText("Игрок добавлен", { exact: true }).waitFor();
await screenshot(page, "t02-consent-roster-states-390.png", true);
const consentPersisted = await getTournament(organizer.api, consentTournament.id);
const teammateNotifications = await (await teammate.api.get("/api/v1/notifications")).json();
observations.runs["T-RUN-004"] = {
  scenarios: ["SC-T02"], result: "PASS_WITH_FINDING", tournamentId: consentTournament.id,
  teammateDialog,
  persisted: {
    policy: consentPersisted.requireParticipantConsent,
    participants: consentPersisted.participants.map((row) => ({ id: row.id, userId: row.userId, status: row.status, additionSource: row.additionSource })),
    invitations: consentPersisted.invitations.map((row) => ({ id: row.id, invitedUserId: row.invitedUserId, status: row.status, terminalReason: row.terminalReason })),
    teamNotification: teammateNotifications.notifications?.some((row) => row.type === "tournament_team_added"),
  },
  visible: {
    pending: await page.getByText(/ожидает ответ/).count(),
    declined: await page.getByText(/отказался/).count(),
    expiredLabel: await page.getByText(expired.label, { exact: false }).count(),
    withdrawnLabel: await page.getByText(left.label, { exact: false }).count(),
  },
};

// SC-T03: organizer then scoped-admin confirmed post-bracket additions; permissions and post-start rejection.
await addGuest(organizer.api, consentTournament.id, 21);
await mutate(organizer.api, "POST", `/api/v1/tournaments/${consentTournament.id}/bracket`, { constructionAlgorithm: "compact" });
const generatedBeforeLate = await getTournament(organizer.api, consentTournament.id);
const seedPrefix = [...generatedBeforeLate.bracketJson.seedOrder];
await page.reload();
await selectUser(page, "Добавить игрока", lateOrganizer);
const organizerLateDialog = await confirmClick(page, "Добавить в состав", "T-RUN-005");
await page.getByText("Игрок добавлен", { exact: true }).waitFor();
const afterOrganizerLate = await getTournament(organizer.api, consentTournament.id);
assert.deepEqual(afterOrganizerLate.bracketJson.seedOrder.slice(0, seedPrefix.length), seedPrefix);
await screenshot(page, "t03-organizer-post-bracket-add-390.png", true);

const adminBrowser = await createAdminPage({ width: 1440, height: 900 });
await adminBrowser.page.goto(`/tournaments/${consentTournament.id}`);
await adminBrowser.page.getByRole("note").waitFor();
const scopedAdminControls = {
  settings: await adminBrowser.page.getByRole("heading", { name: "Настройки и правила", exact: true }).count(),
  start: await adminBrowser.page.getByRole("button", { name: "Старт", exact: true }).count(),
  guest: await adminBrowser.page.getByLabel("Добавить гостя (Имя Фамилия)").count(),
  addRegistered: await adminBrowser.page.getByRole("combobox", { name: "Добавить игрока", exact: true }).count(),
};
await screenshot(adminBrowser.page, "t03-scoped-admin-before-add-1440.png", true);
await selectUser(adminBrowser.page, "Добавить игрока", lateAdmin);
const adminLateDialog = await confirmClick(adminBrowser.page, "Добавить в состав", "T-RUN-005");
await adminBrowser.page.getByText("Игрок добавлен", { exact: true }).waitFor();
await screenshot(adminBrowser.page, "t03-scoped-admin-after-add-1440.png", true);
const afterAdminLate = await getTournament(organizer.api, consentTournament.id);

const participantBrowser = await createBrowserPage(accepted, { width: 390, height: 844 });
await participantBrowser.page.goto(`/tournaments/${consentTournament.id}`);
await participantBrowser.page.getByText("UXT Consent states", { exact: true }).waitFor();
await screenshot(participantBrowser.page, "t03-participant-readonly-390.png", true);
const participantControls = {
  start: await participantBrowser.page.getByRole("button", { name: "Старт", exact: true }).count(),
  bracketEdit: await participantBrowser.page.getByRole("button", { name: "Поменять позиции", exact: true }).count(),
  add: await participantBrowser.page.getByRole("combobox", { name: "Добавить игрока", exact: true }).count(),
};
const forbiddenPatch = await fetchMutation(accepted.api, "PATCH", `/api/v1/tournaments/${consentTournament.id}/bracket`, { swaps: [{ slotIdA: "seed:1", slotIdB: "seed:2" }] });
const outsiderGet = await outsider.api.get(`/api/v1/tournaments/${consentTournament.id}`);
const outsiderBrowser = await createBrowserPage(outsider, { width: 390, height: 844 });
await outsiderBrowser.page.goto(`/tournaments/${consentTournament.id}`);
await outsiderBrowser.page.getByRole("alert").waitFor();
await screenshot(outsiderBrowser.page, "t03-outsider-forbidden-390.png", true);
const outsiderVisibleText = await outsiderBrowser.page.getByRole("alert").innerText();
const beforeStartState = await getTournament(organizer.api, consentTournament.id);
await mutate(organizer.api, "POST", `/api/v1/tournaments/${consentTournament.id}/start`, {});
const startedState = await getTournament(organizer.api, consentTournament.id);
await page.reload();
const addAfterStartVisible = await page.getByRole("combobox", { name: "Добавить игрока", exact: true }).count();
const postStartAddResponse = await fetchMutation(admin, "POST", `/api/v1/tournaments/${consentTournament.id}/participants`, {
  userId: outsider.id, confirmManualOverride: true, confirmBracketRegeneration: true,
});
const afterRejectedAdd = await getTournament(organizer.api, consentTournament.id);
observations.runs["T-RUN-005"] = {
  scenarios: ["SC-T03"], result: "PASS_WITH_FINDING", tournamentId: consentTournament.id,
  dialogs: { organizerLateDialog, adminLateDialog }, scopedAdminControls, participantControls,
  forbiddenPatch: { status: forbiddenPatch.status(), body: await forbiddenPatch.json() },
  outsiderGet: { status: outsiderGet.status(), body: await outsiderGet.json(), visibleText: outsiderVisibleText },
  postStart: {
    addVisible: addAfterStartVisible,
    rejectedStatus: postStartAddResponse.status(),
    rejectedBody: await postStartAddResponse.json(),
    participantCountBefore: startedState.participants.filter((row) => row.status === "active").length,
    participantCountAfter: afterRejectedAdd.participants.filter((row) => row.status === "active").length,
    bracketVersionBefore: startedState.bracketStateVersion,
    bracketVersionAfter: afterRejectedAdd.bracketStateVersion,
  },
  persisted: {
    prefixRetainedAfterOrganizerAdd: JSON.stringify(afterOrganizerLate.bracketJson.seedOrder.slice(0, seedPrefix.length)) === JSON.stringify(seedPrefix),
    organizerAdditionSource: afterOrganizerLate.participants.find((row) => row.userId === lateOrganizer.id)?.additionSource,
    adminAdditionSource: afterAdminLate.participants.find((row) => row.userId === lateAdmin.id)?.additionSource,
    statusBeforeStart: beforeStartState.status,
    statusAfterStart: startedState.status,
  },
};

// SC-T04: registered participant's next/current task and tournament-wide live overview.
const journey = await createTournament(organizer.api, "UXT Current next", { key: "current-next" });
await mutate(organizer.api, "PATCH", `/api/v1/tournaments/${journey.id}`, { pointsToWin: 1 });
for (const actor of playerActors) await addRegistered(organizer.api, journey.id, actor);
await mutate(organizer.api, "POST", `/api/v1/tournaments/${journey.id}/bracket`, { constructionAlgorithm: "compact" });
await mutate(organizer.api, "POST", `/api/v1/tournaments/${journey.id}/start`, {});
let journeyState = await getTournament(organizer.api, journey.id);
const waiting = journeyState.matches.find((match) => match.status === "waiting");
assert.ok(waiting);
const matchBefore = (await (await organizer.api.get(`/api/v1/matches/${waiting.id}`)).json()).match;
const participantUserByParticipantId = new Map(journeyState.participants.map((row) => [row.id, row.userId]));
const waitingActor = playerActors.find((actor) => matchBefore.participants.some((part) =>
  part.userId === actor.id || participantUserByParticipantId.get(part.tournamentParticipantId) === actor.id
));
assert.ok(waitingActor);
const journeyParticipantBrowser = await createBrowserPage(waitingActor, { width: 390, height: 844 });
await journeyParticipantBrowser.page.goto(`/tournaments/${journey.id}`);
await journeyParticipantBrowser.page.getByRole("heading", { name: "Ваши матчи", exact: true }).waitFor();
await screenshot(journeyParticipantBrowser.page, "t04-participant-next-390.png", true);
const nextText = await journeyParticipantBrowser.page.getByText(/Следующий матч:/).first().textContent();
await mutate(organizer.api, "POST", `/api/v1/matches/${waiting.id}/judge/acquire`, {});
let startedMatch = (await mutate(organizer.api, "POST", `/api/v1/matches/${waiting.id}/start`, { firstServerParticipantId: matchBefore.participants[0].id })).match;
await journeyParticipantBrowser.page.reload();
await journeyParticipantBrowser.page.getByText(/Текущий матч:/).waitFor();
await screenshot(journeyParticipantBrowser.page, "t04-participant-current-390.png", true);
const currentText = await journeyParticipantBrowser.page.getByText(/Текущий матч:/).textContent();
const winnerSide = matchBefore.participants.some((part) => part.side === "A" && (
  part.userId === waitingActor.id || participantUserByParticipantId.get(part.tournamentParticipantId) === waitingActor.id
)) ? "A" : "B";
startedMatch = await scoreUntilPending(organizer.api, waiting.id, startedMatch, winnerSide);
await mutate(organizer.api, "POST", `/api/v1/matches/${waiting.id}/confirm-finish`, {});
await journeyParticipantBrowser.page.reload();
const afterAdvanceTask = await journeyParticipantBrowser.page.getByText(/Следующий матч:/).first().textContent().catch(() => null);
await screenshot(journeyParticipantBrowser.page, "t04-participant-after-advance-390.png", true);
observations.runs["T-RUN-006"] = {
  scenarios: ["SC-T04"], result: "PASS", tournamentId: journey.id,
  nextText, currentText, afterAdvanceTask, matchId: waiting.id,
};

// SC-T05: dissolve, cancel, stop and finished result.
const dissolveTournament = await createTournament(organizer.api, "UXT Dissolve", { key: "dissolve" });
for (let i = 1; i <= 3; i++) await addGuest(organizer.api, dissolveTournament.id, i + 30);
await mutate(organizer.api, "POST", `/api/v1/tournaments/${dissolveTournament.id}/bracket`, { constructionAlgorithm: "compact" });
await page.goto(`/tournaments/${dissolveTournament.id}`);
await page.setViewportSize({ width: 390, height: 844 });
let dissolveDialogSeen = false;
page.once("dialog", async (dialog) => { dissolveDialogSeen = true; await dialog.accept(); });
await page.getByRole("button", { name: "Распустить сетку", exact: true }).click();
await page.getByTestId("tournament-build-bracket").waitFor();
const dissolveState = await waitTournamentStatus(organizer.api, dissolveTournament.id, "collecting");
await screenshot(page, "t05-dissolve-after-390.png", true);

const cancelTournament = await createTournament(organizer.api, "UXT Cancel", { key: "cancel" });
await page.goto(`/tournaments/${cancelTournament.id}`);
await screenshot(page, "t05-cancel-before-390.png");
let cancelDialogSeen = false;
page.once("dialog", async (dialog) => { cancelDialogSeen = true; await dialog.accept(); });
await page.getByTestId("tournament-cancel").click();
await page.getByText("Турнир отменён", { exact: true }).waitFor();
const cancelState = await waitTournamentStatus(organizer.api, cancelTournament.id, "cancelled");
await screenshot(page, "t05-cancel-after-390.png", true);

const withdrawTournament = await createTournament(organizer.api, "UXT Withdraw warning", { requireParticipantConsent: true, key: "withdraw-warning" });
const withdrawInvite = (await mutate(organizer.api, "POST", `/api/v1/tournaments/${withdrawTournament.id}/invitations`, { userId: accepted.id })).invitation;
await mutate(accepted.api, "POST", `/api/v1/tournament-invitations/${withdrawInvite.id}/respond`, { accept: true });
await addGuest(organizer.api, withdrawTournament.id, 60);
await addGuest(organizer.api, withdrawTournament.id, 61);
await mutate(organizer.api, "POST", `/api/v1/tournaments/${withdrawTournament.id}/bracket`, { constructionAlgorithm: "compact" });
await participantBrowser.page.goto(`/tournaments/${withdrawTournament.id}`);
await participantBrowser.page.getByRole("button", { name: "Выйти из турнира", exact: true }).waitFor();
await screenshot(participantBrowser.page, "t05-withdraw-generated-before-390.png", true);
let withdrawDialogSeen = false;
participantBrowser.page.once("dialog", async (dialog) => { withdrawDialogSeen = true; await dialog.accept(); });
await participantBrowser.page.getByRole("button", { name: "Выйти из турнира", exact: true }).click();
const withdrawState = await waitTournamentStatus(organizer.api, withdrawTournament.id, "needs_regeneration");
await participantBrowser.page.getByText("Нужна перегенерация", { exact: true }).waitFor();
await screenshot(participantBrowser.page, "t05-withdraw-generated-after-390.png", true);

const stopTournament = await createTournament(organizer.api, "UXT Stop", { key: "stop" });
for (let i = 1; i <= 3; i++) await addGuest(organizer.api, stopTournament.id, i + 40);
await mutate(organizer.api, "POST", `/api/v1/tournaments/${stopTournament.id}/bracket`, { constructionAlgorithm: "compact" });
await mutate(organizer.api, "POST", `/api/v1/tournaments/${stopTournament.id}/start`, {});
await page.goto(`/tournaments/${stopTournament.id}`);
await page.getByRole("button", { name: "Остановить турнир", exact: true }).click();
await screenshot(page, "t05-stop-dialog-390.png");
assert.equal(await page.getByRole("button", { name: "Подтвердить остановку", exact: true }).isDisabled(), true);
await page.getByLabel("Причина остановки", { exact: true }).fill("Завершено окно проверки");
await page.getByRole("button", { name: "Подтвердить остановку", exact: true }).click();
await page.getByText("Турнир остановлен", { exact: true }).waitFor();
const stopState = await getTournament(organizer.api, stopTournament.id);
await screenshot(page, "t05-stopped-result-390.png", true);

const finishTournament = await createTournament(organizer.api, "UXT Finished", { key: "finished" });
await mutate(organizer.api, "PATCH", `/api/v1/tournaments/${finishTournament.id}`, { pointsToWin: 1 });
for (let i = 1; i <= 3; i++) await addGuest(organizer.api, finishTournament.id, i + 50);
await mutate(organizer.api, "POST", `/api/v1/tournaments/${finishTournament.id}/bracket`, { constructionAlgorithm: "compact" });
await mutate(organizer.api, "POST", `/api/v1/tournaments/${finishTournament.id}/start`, {});
const completedMatchIds = [];
for (let guard = 0; guard < 20; guard++) {
  const state = await getTournament(organizer.api, finishTournament.id);
  if (state.status === "finished") break;
  const match = state.matches.find((row) => row.status === "waiting" && !completedMatchIds.includes(row.id));
  assert.ok(match, `No playable match at guard ${guard}`);
  const detail = (await (await organizer.api.get(`/api/v1/matches/${match.id}`)).json()).match;
  await mutate(organizer.api, "POST", `/api/v1/matches/${match.id}/judge/acquire`, {});
  const started = (await mutate(organizer.api, "POST", `/api/v1/matches/${match.id}/start`, { firstServerParticipantId: detail.participants[0].id })).match;
  await scoreUntilPending(organizer.api, match.id, started, "A");
  await mutate(organizer.api, "POST", `/api/v1/matches/${match.id}/confirm-finish`, {});
  completedMatchIds.push(match.id);
}
const finishedState = await getTournament(organizer.api, finishTournament.id);
assert.equal(finishedState.status, "finished");
await page.goto(`/tournaments/${finishTournament.id}`);
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("heading", { name: "Итоги", exact: true }).waitFor();
await screenshot(page, "t05-finished-result-390.png", true);
await page.setViewportSize({ width: 1440, height: 900 });
await screenshot(page, "t05-finished-result-1440.png", true);

const adminStopResponse = await fetchMutation(admin, "POST", `/api/v1/tournaments/${journey.id}/stop`, { code: "other", text: "forbidden probe" });
const journeyAfterAdminStop = await getTournament(organizer.api, journey.id);
observations.runs["T-RUN-007"] = {
  scenarios: ["SC-T05"], result: "FAIL_FINDINGS",
  dissolve: { dialogSeen: dissolveDialogSeen, status: dissolveState.status, participants: dissolveState.participants.filter((row) => row.status === "active").length },
  cancel: { dialogSeen: cancelDialogSeen, status: cancelState.status },
  withdrawAfterGeneration: { dialogSeen: withdrawDialogSeen, status: withdrawState.status, activeParticipants: withdrawState.participants.filter((row) => row.status === "active").length },
  stop: { status: stopState.status, reason: stopState.stopReasonText, top3: stopState.summary.top3, resultPlaces: stopState.summary.results.map((row) => row.place) },
  finish: { status: finishedState.status, completedMatchIds, top3: finishedState.summary.top3, playedMatchCount: finishedState.summary.playedMatchCount },
  roleError: { status: adminStopResponse.status(), body: await adminStopResponse.json(), journeyStatusAfter: journeyAfterAdminStop.status },
};

await writeFile(path.join(output, "runtime-observations.json"), `${JSON.stringify(observations, null, 2)}\n`);
await writeFile(path.join(output, "fixture-index.json"), `${JSON.stringify({ schemaVersion: 1, createdAt: now, fixtures }, null, 2)}\n`);

await Promise.all([
  organizerBrowser.context.close(), adminBrowser.context.close(), participantBrowser.context.close(), journeyParticipantBrowser.context.close(), outsiderBrowser.context.close(),
]);
await browser.close();
await Promise.all([admin.dispose(), organizer.api.dispose(), accepted.api.dispose(), pending.api.dispose(), declined.api.dispose(), expired.api.dispose(), left.api.dispose(), teammate.api.dispose(), lateOrganizer.api.dispose(), lateAdmin.api.dispose(), outsider.api.dispose(), ...playerActors.map((actor) => actor.api.dispose())]);
await db.end({ timeout: 5 });
const screenshotCount = (await readdir(screenshots)).filter((name) => name.endsWith(".png")).length;
console.log(JSON.stringify({ status: "complete", runs: Object.keys(observations.runs).length, screenshots: screenshotCount, consoleErrors: observations.console.length }));
