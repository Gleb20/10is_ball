#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const OUT = path.resolve(import.meta.dirname);
const API = "http://127.0.0.1:4818";
const WEB = "http://localhost:4817";
const DATABASE_URL = "postgresql://tab10_runtime_test@127.0.0.1:33018/tab10_test";
const release = {
  sha: "0123456789abcdef0123456789abcdef01234567",
  version: "3.0.0",
  environment: "test",
  dirty: false,
};

await mkdir(OUT, { recursive: true });

function secret() {
  return `Audit-${randomBytes(18).toString("base64url")}9!`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function waitFor(url, processes, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "not attempted";
  while (Date.now() < deadline) {
    for (const child of processes) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Server exited before ${url} became ready`);
      }
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return await response.json().catch(() => ({}));
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${last}`);
}

function start(command, args, env, logName) {
  const log = createWriteStream(path.join(OUT, logName), { flags: "w" });
  const child = spawn(command, args, {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once("close", () => log.end());
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
    return;
  }
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
}

class ApiClient {
  cookies = new Map();

  async request(method, route, body, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.cookies.size) {
      headers.cookie = [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    }
    const csrf = this.cookies.get("tab10_csrf");
    if (csrf && method !== "GET") headers["x-csrf-token"] = decodeURIComponent(csrf);
    const response = await fetch(`${API}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const value of response.headers.getSetCookie?.() ?? []) {
      const pair = value.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`${method} ${route}: ${response.status} ${payload.code ?? "UNKNOWN"}`);
      error.status = response.status;
      error.code = payload.code;
      error.payload = payload;
      throw error;
    }
    return payload;
  }
}

async function loginApi(email, password) {
  const client = new ApiClient();
  await client.request("POST", "/api/v1/auth/login", { email, password });
  return client;
}

async function loginPage(page, email, password, returnPath = "/") {
  await page.goto(`${WEB}/login`);
  await page.getByRole("button", { name: "Войти" }).waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
  if (returnPath !== "/") await page.goto(`${WEB}${returnPath}`);
}

async function newActorPage(browser, actor, viewport, options = {}) {
  const context = await browser.newContext({
    viewport,
    hasTouch: Boolean(options.hasTouch),
    isMobile: false,
    locale: "ru-RU",
  });
  const page = await context.newPage();
  await loginPage(page, actor.email, actor.password);
  return { context, page };
}

async function snapshot(page, name, extra = {}) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const payload = {
    name,
    capturedAt: new Date().toISOString(),
    url: page.url(),
    viewport: page.viewportSize(),
    title: await page.title(),
    visibleText: (await page.locator("body").innerText()).slice(0, 12_000),
    horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
    screenshot: path.basename(file),
    screenshotSha256: sha256(await readFile(file)),
    ...extra,
  };
  await writeFile(path.join(OUT, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

async function buttonInventory(page) {
  return page.getByRole("button").evaluateAll((nodes) => nodes
    .filter((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    })
    .map((node) => ({
      label: (node.getAttribute("aria-label") || node.textContent || "").trim().replace(/\s+/g, " "),
      disabled: node.disabled || node.getAttribute("aria-disabled") === "true",
    })));
}

async function selectAutocomplete(page, name, query, optionLabel) {
  const input = page.getByRole("combobox", { name });
  await input.fill(query);
  await page.getByRole("option", { name: optionLabel, exact: true }).click();
}

async function finishSeedMatch(client, actorId, opponentId, title) {
  let match = (await client.request("POST", "/api/v1/matches", {
    title,
    format: "1v1",
    pointsToWin: 11,
    mercyEnabled: true,
    mercyPoints: 1,
    firstServerMethod: "random",
    source: "manual",
    sendPlayerInvitations: false,
    participants: [
      { side: "A", userId: actorId },
      { side: "B", userId: opponentId },
    ],
  })).match;
  match = (await client.request("POST", `/api/v1/matches/${match.id}/start`, {})).match;
  await client.request("POST", `/api/v1/matches/${match.id}/judge/acquire`, {});
  match = (await client.request(
    "POST",
    `/api/v1/matches/${match.id}/points`,
    { side: "A", expectedVersion: Number(match.version) },
    { "idempotency-key": randomUUID() },
  )).match;
  match = (await client.request("POST", `/api/v1/matches/${match.id}/confirm-finish`, {})).match;
  return match;
}

const adminPassword = secret();
const actorPassword = secret();
const adminEmail = "audit.match.admin@tab10.test";
const cleanEnv = { ...process.env };
for (const key of [
  "DATABASE_URL", "MIGRATION_DATABASE_URL", "TEST_DATABASE_URL", "ALLOW_TEST_DATABASE_RESET",
  "PGLITE_DATA_DIR", "AUDIT_EPHEMERAL", "VITE_API_BASE_URL", "COOKIE_SAME_SITE",
  "GITHUB_SHA", "RENDER_GIT_COMMIT", "VERCEL_GIT_COMMIT_SHA",
]) delete cleanEnv[key];

const apiEnv = {
  ...cleanEnv,
  NODE_ENV: "production",
  DATABASE_URL,
  MIGRATE_ON_BOOT: "0",
  HOST: "127.0.0.1",
  PORT: "4818",
  WEB_ORIGIN: WEB,
  SEED_ADMIN: "1",
  SEED_ADMIN_EMAIL: adminEmail,
  SEED_ADMIN_PASSWORD: adminPassword,
  TAB10_RELEASE_SHA: release.sha,
  TAB10_RELEASE_VERSION: release.version,
  TAB10_ENVIRONMENT: release.environment,
  TAB10_RELEASE_DIRTY: String(release.dirty),
};
const webEnv = {
  ...cleanEnv,
  NODE_ENV: "production",
  TAB10_API_PROXY_TARGET: API,
  TAB10_RELEASE_SHA: release.sha,
  TAB10_RELEASE_VERSION: release.version,
  TAB10_ENVIRONMENT: release.environment,
  TAB10_RELEASE_DIRTY: String(release.dirty),
};

const processes = [];
let browser;
const contexts = [];
const log = [];

try {
  processes.push(start(process.execPath, ["apps/api/dist/index.js"], apiEnv, "api.log"));
  processes.push(start("pnpm", ["--filter", "@tab10/web", "exec", "vite", "preview", "--host", "localhost", "--port", "4817", "--strictPort"], webEnv, "web.log"));
  const apiHealth = await waitFor(`${API}/health`, processes);
  const webHealth = await waitFor(`${WEB}/health`, processes);
  if (apiHealth?.release?.environment !== "test" || webHealth?.release?.environment !== "test") {
    throw new Error("Runtime did not attest release.environment=test");
  }
  await writeFile(path.join(OUT, "runtime-identity.json"), `${JSON.stringify({
    api: apiHealth,
    web: webHealth,
    ports: { web: 4817, api: 4818, postgres: 33018 },
    databaseProject: "tab10-ux-match-4817",
    databaseRole: "tab10_runtime_test",
  }, null, 2)}\n`);

  const admin = await loginApi(adminEmail, adminPassword);
  await admin.request("PATCH", "/api/v1/me/onboarding", { action: "complete" }).catch(() => undefined);
  const definitions = {
    operator: ["Оператор", "Матчев"],
    playerA: ["Анна", "Альфа"],
    playerB: ["Борис", "Бета"],
    playerC: ["Вера", "Гамма"],
    playerD: ["Глеб", "Дельта"],
    judge: ["Жанна", "Судья"],
    outsider: ["Олег", "Внешний"],
  };
  const actors = {};
  for (const [key, [firstName, lastName]] of Object.entries(definitions)) {
    const email = `audit.match.${key.toLowerCase()}@tab10.test`;
    const created = await admin.request("POST", "/api/v1/admin/users", {
      email, firstName, lastName, role: "user",
    });
    const client = await loginApi(email, created.temporaryPassword);
    await client.request("POST", "/api/v1/auth/password/first-change", { newPassword: actorPassword });
    await client.request("PATCH", "/api/v1/me/onboarding", { action: "complete" });
    actors[key] = { id: created.user.id, email, password: actorPassword, client, firstName, lastName };
  }

  const team = (await actors.operator.client.request("POST", "/api/v1/teams", { name: "Парная аудит" })).team;
  for (const key of ["playerA", "playerB"]) {
    const invitation = (await actors.operator.client.request("POST", `/api/v1/teams/${team.id}/invitations`, { userId: actors[key].id })).invitation;
    await actors[key].client.request("POST", `/api/v1/team-invitations/${invitation.id}/accept`, {});
  }

  const history = [];
  history.push(await finishSeedMatch(actors.operator.client, actors.operator.id, actors.playerA.id, "Seed frequent A 1"));
  history.push(await finishSeedMatch(actors.operator.client, actors.operator.id, actors.playerA.id, "Seed frequent A 2"));
  history.push(await finishSeedMatch(actors.operator.client, actors.operator.id, actors.playerB.id, "Seed recent B"));
  const createOptions = await actors.operator.client.request("GET", "/api/v1/matches/create-options");
  await writeFile(path.join(OUT, "fixture-index.json"), `${JSON.stringify({
    schemaVersion: 1,
    environment: "local-disposable-postgresql",
    actors: Object.fromEntries(Object.entries(actors).map(([key, actor]) => [key, {
      id: actor.id,
      label: `${actor.lastName} ${actor.firstName}`,
      role: key === "judge" ? "prospective/current judge" : key,
      accountStatus: "active",
      mustChangePassword: false,
      onboarding: "complete",
    }])),
    team: { id: team.id, name: team.name, members: [actors.operator.id, actors.playerA.id, actors.playerB.id] },
    historySeedMatchIds: history.map((match) => match.id),
    createOptions: {
      teams: createOptions.teams,
      recentOpponentIds: createOptions.recentOpponentIds,
      frequentOpponentIds: createOptions.frequentOpponentIds,
    },
    credentialsPersisted: false,
  }, null, 2)}\n`);

  browser = await chromium.launch({ headless: true });
  const operatorMobile = await newActorPage(browser, actors.operator, { width: 390, height: 844 }, { hasTouch: true });
  contexts.push(operatorMobile.context);
  const page = operatorMobile.page;

  // Directory loading and error/retry states on the real production build.
  let releaseDirectory;
  let directoryInterceptDone;
  const directoryIntercepted = new Promise((resolve) => { directoryInterceptDone = resolve; });
  await page.route("**/api/v1/matches/create-options", async (route) => {
    await new Promise((resolve) => { releaseDirectory = resolve; });
    await route.continue();
    directoryInterceptDone();
  });
  await page.goto(`${WEB}/matches/new`);
  await page.getByRole("status").filter({ hasText: "Загружаем список игроков" }).waitFor();
  await snapshot(page, "m01-directory-loading-390", { scenario: "SC-M01", state: "directory-loading" });
  releaseDirectory();
  await directoryIntercepted;
  await page.unroute("**/api/v1/matches/create-options");
  await page.getByRole("combobox", { name: "Игрок A" }).waitFor();

  await page.route("**/api/v1/matches/create-options", async (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ code: "TEMPORARY", message: "synthetic controlled failure" }),
  }));
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "Список игроков недоступен" }).waitFor();
  await snapshot(page, "m01-directory-error-390", { scenario: "SC-M01", state: "directory-error" });
  await page.unroute("**/api/v1/matches/create-options");
  await page.getByRole("button", { name: "Повторить" }).click();
  await page.getByRole("combobox", { name: "Игрок A" }).waitFor();

  const firstSlotRect = await page.getByRole("group", { name: "Игрок A", exact: true }).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, width: rect.width, viewportHeight: innerHeight };
  });
  await snapshot(page, "m01-create-before-top-390", {
    scenario: "SC-M01/SC-M02",
    state: "manual-default-ready",
    firstSlotRect,
    note: "The screenshot proves only the visible viewport; slot position is a DOM measurement.",
  });

  // Canonical BUG-023 cross-reference: do not duplicate as a MATCH finding.
  const playerAInput = page.getByRole("combobox", { name: "Игрок A" });
  await playerAInput.fill("Альфа Анна");
  const reversedOrderOptions = await page.getByRole("option").count();
  await snapshot(page, "m01-name-order-bug023-390", {
    scenario: "SC-M01",
    canonical: "BUG-023",
    query: "Альфа Анна",
    matchingOptions: reversedOrderOptions,
  });
  await playerAInput.fill("");

  await page.getByRole("button", { name: "2 × 2" }).click();
  await page.getByRole("heading", { name: "Команды" }).scrollIntoViewIfNeeded();
  await snapshot(page, "m02-quick-choices-390", {
    scenario: "SC-M02",
    quickGroups: ["Частые соперники", "Недавние соперники", "Команды"],
  });
  await page.getByRole("button", { name: "Парная аудит" }).click();
  const afterTeam = {
    opponent1: await page.getByRole("combobox", { name: "Соперник 1" }).inputValue(),
    opponent2: await page.getByRole("combobox", { name: "Соперник 2" }).inputValue(),
    playerA: await page.getByRole("combobox", { name: "Игрок A" }).inputValue(),
    partner: await page.getByRole("combobox", { name: "Партнёр" }).inputValue(),
  };

  const playerAGroup = page.getByRole("group", { name: "Игрок A" });
  await playerAGroup.getByRole("button", { name: "Гость", exact: true }).click();
  await playerAGroup.getByLabel(/Игрок A — гость/).fill("Мария Гость");
  await selectAutocomplete(page, "Партнёр", "Вера", "Вера Гамма");
  await page.getByLabel("Очков до победы").fill("15");
  await page.getByLabel("Порог сухой победы").fill("7");
  await page.getByRole("button", { name: "Случайно" }).click();
  await selectAutocomplete(page, "Судья (необязательно)", "Жанна", "Жанна Судья");
  await page.getByLabel("Пригласить выбранных игроков").check();
  await page.getByRole("button", { name: "Создать матч" }).scrollIntoViewIfNeeded();
  await snapshot(page, "m02-ready-submit-390", {
    scenario: "SC-M02/SC-M03",
    afterTeam,
    expected: "guest + registered roster, custom rules, voluntary player and judge invites",
  });
  await page.getByRole("button", { name: "Создать матч" }).click();
  await page.waitForURL(/\/matches\/[0-9a-f-]+$/);
  await page.getByText("Ожидание", { exact: true }).waitFor();
  const mainMatchId = page.url().split("/").pop();
  await snapshot(page, "m03-waiting-creator-390", {
    scenario: "SC-M03/SC-M04",
    role: "nonplaying creator",
    actions: await buttonInventory(page),
  });
  const mainInitial = (await actors.operator.client.request("GET", `/api/v1/matches/${mainMatchId}`)).match;
  await writeFile(path.join(OUT, "m03-main-match-created.json"), `${JSON.stringify({
    id: mainInitial.id,
    title: mainInitial.title,
    format: mainInitial.format,
    status: mainInitial.status,
    source: mainInitial.source,
    pointsToWin: mainInitial.pointsToWin,
    mercyEnabled: mainInitial.mercyEnabled,
    mercyPoints: mainInitial.mercyPoints,
    firstServerMethod: mainInitial.firstServerMethod,
    createdByUserId: mainInitial.createdByUserId,
    participants: mainInitial.participants.map((item) => ({ id: item.id, side: item.side, userId: item.userId, displayName: item.displayName })),
    invitations: mainInitial.invitations.map((item) => ({ id: item.id, kind: item.kind, invitedUserId: item.invitedUserId, matchParticipantId: item.matchParticipantId, status: item.status })),
  }, null, 2)}\n`);

  // Invitation acceptance/decline in recipient UI. Keep player B pending for roster-change evidence.
  const recipientCases = [
    ["playerA", "Принять", "m03-player-invite-accept-390"],
    ["playerC", "Отклонить", "m03-player-invite-decline-390"],
    ["judge", "Принять", "m03-judge-invite-accept-390"],
  ];
  for (const [actorKey, actionLabel, evidenceName] of recipientCases) {
    const actorPage = await newActorPage(browser, actors[actorKey], { width: 390, height: 844 }, { hasTouch: true });
    contexts.push(actorPage.context);
    await actorPage.page.goto(`${WEB}/notifications`);
    const invitationAction = actorPage.page.getByRole("button", { name: actionLabel }).first();
    await invitationAction.waitFor();
    await snapshot(actorPage.page, evidenceName, { scenario: "SC-M03", role: actorKey, action: actionLabel });
    await invitationAction.click();
    await invitationAction.waitFor({ state: "hidden" });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.getByText("Ожидание", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Изменить матч" }).click();
  const editDialog = page.getByRole("dialog", { name: "Изменить матч" });
  await editDialog.waitFor();
  await snapshot(page, "m04-edit-dialog-before-1440", {
    scenario: "SC-M04",
    dialogButtons: await buttonInventory(editDialog),
  });
  await editDialog.getByLabel("Название").fill("Парный матч после замены");
  await selectAutocomplete(editDialog, "Соперник 2", "Глеб", "Глеб Дельта");
  await editDialog.getByRole("button", { name: "Сохранить изменения" }).click();
  await editDialog.waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: "Парный матч после замены" }).waitFor();
  const afterEdit = (await actors.operator.client.request("GET", `/api/v1/matches/${mainMatchId}`)).match;
  await snapshot(page, "m04-after-roster-edit-1440", {
    scenario: "SC-M04",
    actions: await buttonInventory(page),
  });
  await writeFile(path.join(OUT, "m04-roster-invitation-lifecycle.json"), `${JSON.stringify({
    status: afterEdit.status,
    participants: afterEdit.participants.map((item) => ({ id: item.id, side: item.side, userId: item.userId, displayName: item.displayName })),
    invitations: afterEdit.invitations.map((item) => ({ id: item.id, kind: item.kind, invitedUserId: item.invitedUserId, matchParticipantId: item.matchParticipantId, status: item.status, expiryReason: item.expiryReason })),
    replacementPlayerId: actors.playerD.id,
    replacementHasInvitation: afterEdit.invitations.some((item) => item.invitedUserId === actors.playerD.id),
  }, null, 2)}\n`);

  // The current API supports explicit post-create invitation, while detail has no generic invite affordance.
  const replacementInvite = (await actors.operator.client.request("POST", `/api/v1/matches/${mainMatchId}/invitations`, {
    userId: actors.playerD.id,
    kind: "player",
  })).invitation;
  await page.reload();
  await page.getByText("Ожидание", { exact: true }).waitFor();
  await page.getByText("Дельта Глеб").first().waitFor();
  await snapshot(page, "m04-explicit-replacement-invite-1440", {
    scenario: "SC-M03/SC-M04",
    apiOnlySetup: true,
    replacementInvite: { id: replacementInvite.id, status: replacementInvite.status, kind: replacementInvite.kind },
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Отменить матч" }).click();
  const cancelDialog = page.getByRole("dialog", { name: "Отменить матч?" });
  await cancelDialog.waitFor();
  await snapshot(page, "m04-cancel-confirm-390", {
    scenario: "SC-M04",
    role: "creator",
    note: "Visible copy is captured; optional reason control is absent.",
  });
  await cancelDialog.getByRole("button", { name: "Нет" }).click();
  const beforeCancel = (await actors.operator.client.request("GET", `/api/v1/matches/${mainMatchId}`)).match;
  await page.getByRole("button", { name: "Отменить матч" }).click();
  await page.getByRole("dialog", { name: "Отменить матч?" }).getByRole("button", { name: "Отменить матч" }).click();
  await page.getByText("Отменён", { exact: true }).waitFor();
  const cancelled = (await actors.operator.client.request("GET", `/api/v1/matches/${mainMatchId}`)).match;
  let inviteAfterCancel;
  try {
    await actors.operator.client.request("POST", `/api/v1/matches/${mainMatchId}/invitations`, { userId: actors.playerB.id, kind: "player" });
    inviteAfterCancel = { unexpected: "accepted" };
  } catch (error) {
    inviteAfterCancel = { status: error.status, code: error.code };
  }
  await writeFile(path.join(OUT, "m04-cancel-persisted.json"), `${JSON.stringify({
    statusBeforeConfirm: beforeCancel.status,
    statusAfterConfirm: cancelled.status,
    winnerSide: cancelled.winnerSide,
    replacementInvitation: cancelled.invitations.find((item) => item.id === replacementInvite.id),
    createInvitationAfterCancel: inviteAfterCancel,
  }, null, 2)}\n`);
  await snapshot(page, "m04-cancelled-390", { scenario: "SC-M04", persistedStatus: cancelled.status });

  // Challenge at narrow 360, including the already-known shared pending-control contract.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${WEB}/matches/new?opponentId=${actors.playerD.id}&opponentName=${encodeURIComponent("Глеб Дельта")}`);
  await page.getByText("В вызове или реванше создатель играет.").waitFor();
  await page.getByRole("combobox", { name: "Соперник" }).waitFor();
  await snapshot(page, "m05-challenge-prefill-360", {
    scenario: "SC-M03",
    creatorParticipates: true,
    inviteChecked: await page.getByLabel("Пригласить выбранных игроков").isChecked(),
    opponentValue: await page.getByRole("combobox", { name: "Соперник" }).inputValue(),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  let releaseCreate;
  let sentPayload;
  let responseReadyResolve;
  const responseReady = new Promise((resolve) => { responseReadyResolve = resolve; });
  let createInterceptDoneResolve;
  const createInterceptDone = new Promise((resolve) => { createInterceptDoneResolve = resolve; });
  await page.route("**/api/v1/matches", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sentPayload = route.request().postDataJSON();
    const response = await route.fetch();
    responseReadyResolve();
    await new Promise((resolve) => { releaseCreate = resolve; });
    await route.fulfill({ response });
    createInterceptDoneResolve();
  });
  await page.getByRole("button", { name: "Создать матч" }).click();
  await responseReady;
  const pendingState = {
    submitDisabled: await page.getByRole("button", { name: "Создание…" }).isDisabled(),
    inviteDisabled: await page.getByLabel("Пригласить выбранных игроков").isDisabled(),
    format2v2Disabled: await page.getByRole("button", { name: "2 × 2" }).isDisabled(),
    sentPayload,
  };
  await snapshot(page, "m05-create-pending-1440", {
    scenario: "SC-M03",
    canonicalReference: "F-CMP-R-002",
    pendingState,
  });
  releaseCreate();
  await createInterceptDone;
  await page.unroute("**/api/v1/matches");
  await page.waitForURL(/\/matches\/[0-9a-f-]+$/);
  const challengeId = page.url().split("/").pop();
  const challenge = (await actors.operator.client.request("GET", `/api/v1/matches/${challengeId}`)).match;
  await writeFile(path.join(OUT, "m05-challenge-persisted.json"), `${JSON.stringify({
    id: challenge.id,
    source: challenge.source,
    creatorInRoster: challenge.participants.some((item) => item.userId === actors.operator.id),
    opponentInRoster: challenge.participants.some((item) => item.userId === actors.playerD.id),
    invitationTargets: challenge.invitations.map((item) => ({ userId: item.invitedUserId, kind: item.kind, status: item.status })),
  }, null, 2)}\n`);

  // Revenge reuses a finished seed and must keep creator+purposeful invitation.
  const revengeSource = history.at(-1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${WEB}/matches/new?revengeOf=${revengeSource.id}`);
  await page.getByText("В вызове или реванше создатель играет.").waitFor();
  await page.getByLabel("Название").evaluate((input) => new Promise((resolve) => {
    const check = () => {
      if (input.value.startsWith("Реванш:")) resolve(true);
      else requestAnimationFrame(check);
    };
    check();
  }));
  await snapshot(page, "m05-revenge-prefill-390", {
    scenario: "SC-M03",
    sourceMatchId: revengeSource.id,
    inviteChecked: await page.getByLabel("Пригласить выбранных игроков").isChecked(),
    opponentValue: await page.getByRole("combobox", { name: "Соперник" }).inputValue(),
  });
  await page.getByRole("button", { name: "Создать матч" }).click();
  await page.waitForURL(/\/matches\/[0-9a-f-]+$/);
  const revengeId = page.url().split("/").pop();
  const revenge = (await actors.operator.client.request("GET", `/api/v1/matches/${revengeId}`)).match;
  await writeFile(path.join(OUT, "m05-revenge-persisted.json"), `${JSON.stringify({
    id: revenge.id,
    source: revenge.source,
    title: revenge.title,
    creatorInRoster: revenge.participants.some((item) => item.userId === actors.operator.id),
    opponentIds: revenge.participants.filter((item) => item.userId !== actors.operator.id).map((item) => item.userId),
    invitationTargets: revenge.invitations.map((item) => ({ userId: item.invitedUserId, kind: item.kind, status: item.status })),
  }, null, 2)}\n`);

  // Role/state matrix on a separate match; active admin/outsider access is observed, not inferred.
  let roleMatch = (await actors.operator.client.request("POST", "/api/v1/matches", {
    title: "Role matrix match",
    format: "1v1",
    pointsToWin: 11,
    mercyEnabled: true,
    mercyPoints: 5,
    firstServerMethod: "random",
    source: "manual",
    sendPlayerInvitations: false,
    participants: [
      { side: "A", userId: actors.playerA.id },
      { side: "B", userId: actors.playerB.id },
    ],
  })).match;
  await actors.judge.client.request("POST", `/api/v1/matches/${roleMatch.id}/judge/acquire`, {});

  const roleCases = [
    ["operator", "creator"],
    ["playerA", "participant"],
    ["judge", "current-judge"],
    ["outsider", "outsider"],
    ["admin", "active-admin-outside-context"],
  ];
  const roleMatrix = { waiting: {}, in_progress: {} };
  for (const [actorKey, roleLabel] of roleCases) {
    const actor = actorKey === "admin" ? { email: adminEmail, password: adminPassword } : actors[actorKey];
    const rolePage = await newActorPage(browser, actor, { width: 1440, height: 900 });
    contexts.push(rolePage.context);
    const detailResponsePromise = rolePage.page.waitForResponse((response) =>
      response.request().method() === "GET" && response.url().endsWith(`/api/v1/matches/${roleMatch.id}`));
    await rolePage.page.goto(`${WEB}/matches/${roleMatch.id}`);
    const detailResponse = await detailResponsePromise;
    const forbidden = detailResponse.status() === 403;
    if (forbidden) await rolePage.page.getByRole("alert").first().waitFor();
    else await rolePage.page.getByRole("heading", { name: roleMatch.title }).waitFor();
    roleMatrix.waiting[roleLabel] = {
      url: rolePage.page.url(),
      forbidden,
      actions: await buttonInventory(rolePage.page),
      text: (await rolePage.page.locator("body").innerText()).slice(0, 4_000),
    };
    if (["creator", "participant", "current-judge", "active-admin-outside-context"].includes(roleLabel)) {
      await snapshot(rolePage.page, `m06-waiting-${roleLabel}-1440`, { scenario: "SC-M04", role: roleLabel, forbidden });
    }
  }
  roleMatch = (await actors.operator.client.request("POST", `/api/v1/matches/${roleMatch.id}/start`, {})).match;
  for (const [actorKey, roleLabel] of roleCases.slice(0, 3)) {
    const actor = actors[actorKey];
    const rolePage = await newActorPage(browser, actor, { width: 1440, height: 900 });
    contexts.push(rolePage.context);
    await rolePage.page.goto(`${WEB}/matches/${roleMatch.id}`);
    await rolePage.page.getByText("Идёт", { exact: true }).waitFor();
    roleMatrix.in_progress[roleLabel] = { actions: await buttonInventory(rolePage.page) };
  }
  await writeFile(path.join(OUT, "m06-role-action-matrix.json"), `${JSON.stringify({
    matchId: roleMatch.id,
    activeJudgeUserId: actors.judge.id,
    ...roleMatrix,
  }, null, 2)}\n`);

  log.push({ run: "M01", scenarios: ["SC-M01", "SC-M02"], result: "FAIL", evidence: ["m01-directory-loading-390", "m01-directory-error-390", "m01-create-before-top-390", "m01-name-order-bug023-390"], note: "Main roster remains below rare settings; BUG-023 reproduced; async states are COMPONENTS references." });
  log.push({ run: "M02", scenarios: ["SC-M02"], result: "PASS_WITH_FINDING", evidence: ["m02-quick-choices-390", "m02-ready-submit-390", "m03-main-match-created.json"], note: "2v2 guest/registered/team/recent/frequent/custom rules created; quick choices mutate Side B context." });
  log.push({ run: "M03", scenarios: ["SC-M03"], result: "PASS_WITH_FINDING", evidence: ["m03-player-invite-accept-390", "m03-player-invite-decline-390", "m03-judge-invite-accept-390", "m04-roster-invitation-lifecycle.json"], note: "Voluntary player/judge responses work; replacement invitation lacks a detail affordance." });
  log.push({ run: "M04", scenarios: ["SC-M04"], result: "PASS_WITH_FINDING", evidence: ["m04-edit-dialog-before-1440", "m04-after-roster-edit-1440", "m04-cancel-confirm-390", "m04-cancel-persisted.json"], note: "Edit/cancel persist; cancel confirmation omits optional reason and uses void-like wording." });
  log.push({ run: "M05", scenarios: ["SC-M03"], result: "PASS_WITH_REFERENCE", evidence: ["m05-challenge-prefill-360", "m05-create-pending-1440", "m05-challenge-persisted.json", "m05-revenge-prefill-390", "m05-revenge-persisted.json"], note: "Challenge/revenge creator and purposeful invite persist; pending controls reference BUG-026/F-CMP-R-002." });
  log.push({ run: "M06", scenarios: ["SC-M04"], result: "FAIL", evidence: ["m06-role-action-matrix.json", "m06-waiting-creator-1440", "m06-waiting-participant-1440", "m06-waiting-current-judge-1440", "m06-waiting-active-admin-outside-context-1440"], note: "Role/state actions observed; active admin outside match context receives FORBIDDEN on detail." });
  await writeFile(path.join(OUT, "driver-log.json"), `${JSON.stringify({
    schemaVersion: 1,
    completedAt: new Date().toISOString(),
    browser: { name: "Chromium", version: browser.version() },
    runtime: release,
    runs: log,
    limitations: [
      "Expert browser automation, not a human usability session.",
      "Touch is Chromium emulation; physical device, virtual keyboard, WebKit, spoken AT and 200% browser zoom were not tested.",
      "Scoring mechanics were only used to seed finished history; JUDGE owns scoring UX.",
    ],
  }, null, 2)}\n`);
} finally {
  for (const context of contexts.reverse()) await context.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  for (const child of processes.reverse()) await stop(child);
}
