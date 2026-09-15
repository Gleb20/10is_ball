import { chromium, request } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";

const baseURL = process.env.TAB10_E2E_BASE_URL;
const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const out = process.env.JUDGE_EVIDENCE_DIR;
if (!baseURL || !adminEmail || !adminPassword || !out) throw new Error("missing runtime inputs");

await mkdir(path.join(out, "screenshots"), { recursive: true });
const records = [];
const consoleProblems = [];
let requestSeq = 0;

function check(value, message) {
  if (!value) throw new Error(`ASSERT: ${message}`);
}

async function mutationHeaders(api, key = randomUUID()) {
  const state = await api.storageState();
  const csrf = state.cookies.find((cookie) => cookie.name === "tab10_csrf");
  return {
    ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {}),
    "idempotency-key": key,
  };
}

async function mutate(api, endpoint, data = {}, method = "POST", expected = [200, 201]) {
  const response = await api.fetch(endpoint, {
    method,
    data,
    headers: await mutationHeaders(api),
  });
  const body = await response.json().catch(() => ({}));
  if (!expected.includes(response.status())) {
    throw new Error(`${method} ${endpoint} -> ${response.status()} ${body.code ?? body.message ?? ""}`);
  }
  return body;
}

async function createUser(admin, firstName, lastName) {
  const suffix = `${firstName.toLowerCase()}-${Date.now()}-${++requestSeq}`.replace(/[^a-z0-9-]/g, "u");
  const created = await mutate(admin, "/api/v1/admin/users", {
    email: `${suffix}@tab10.test`,
    firstName,
    lastName,
    role: "user",
  });
  const password = `${randomBytes(10).toString("hex")}Aa1!`;
  const api = await request.newContext({ baseURL, userAgent: `tab10-judge-audit-user-${requestSeq}` });
  await mutate(api, "/api/v1/auth/login", {
    email: created.user.email,
    password: created.temporaryPassword,
  });
  await mutate(api, "/api/v1/auth/password/first-change", { newPassword: password });
  await mutate(api, "/api/v1/me/onboarding", { action: "complete" }, "PATCH");
  return {
    api,
    user: created.user,
    password,
    label: `${lastName} ${firstName}`,
  };
}

async function createMatch(creator, players, title, options = {}) {
  return (await mutate(creator.api, "/api/v1/matches", {
    title,
    format: "1v1",
    pointsToWin: options.pointsToWin ?? 9,
    mercyEnabled: options.mercyEnabled ?? false,
    mercyPoints: options.mercyEnabled ? (options.mercyPoints ?? 5) : null,
    firstServerMethod: "manual",
    source: "manual",
    sendPlayerInvitations: false,
    participants: [
      { side: "A", userId: players[0].user.id },
      { side: "B", userId: players[1].user.id },
    ],
  })).match;
}

async function getMatch(api, id) {
  const response = await api.get(`/api/v1/matches/${id}`);
  const body = await response.json().catch(() => ({}));
  return { status: response.status(), body, match: body.match };
}

async function state(page, id, extra = {}) {
  const pageState = await page.evaluate(() => {
    const rect = (node) => node ? Object.fromEntries(["x", "y", "width", "height", "top", "right", "bottom", "left"].map((k) => [k, Math.round(node.getBoundingClientRect()[k] * 100) / 100])) : null;
    const ae = document.activeElement;
    const alertNodes = [...document.querySelectorAll('[role="alert"]')];
    const statusNodes = [...document.querySelectorAll('[role="status"]')];
    const pointButtons = [...document.querySelectorAll('.judge-point-btn')];
    const serve = document.querySelector('.judge-serve-badge:not(.judge-serve-badge--empty)');
    const error = document.querySelector('.judge-error');
    return {
      url: location.pathname + location.search,
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { x: scrollX, y: scrollY, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      activeElement: ae ? { tag: ae.tagName, id: ae.id || null, text: ae.textContent?.trim().slice(0, 120) || null, ariaLabel: ae.getAttribute('aria-label') } : null,
      buttons: [...document.querySelectorAll('button')].filter((n) => n.offsetParent !== null).map((n) => ({ text: n.textContent?.trim(), disabled: n.disabled, rect: rect(n) })),
      alerts: alertNodes.map((n) => n.textContent?.trim()),
      statuses: statusNodes.map((n) => n.textContent?.trim()),
      scores: [...document.querySelectorAll('.judge-side__score')].map((n) => n.textContent?.trim()),
      pointTargets: pointButtons.map((n) => ({ label: n.getAttribute('aria-label'), disabled: n.disabled, rect: rect(n) })),
      serve: serve ? { text: serve.textContent?.trim(), rect: rect(serve), fg: getComputedStyle(serve).color, bg: getComputedStyle(serve).backgroundColor } : null,
      errorStyle: error ? { fg: getComputedStyle(error).color, bg: getComputedStyle(document.querySelector('.judge-side') ?? document.body).backgroundColor } : null,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  const record = { id, capturedAt: new Date().toISOString(), ...pageState, ...extra };
  records.push(record);
  await writeFile(path.join(out, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  await page.screenshot({ path: path.join(out, "screenshots", `${id}.png`), fullPage: false });
  return record;
}

async function pageFor(browser, actor, viewport) {
  const context = await browser.newContext({
    baseURL,
    viewport,
    storageState: await actor.api.storageState(),
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => consoleProblems.push({ type: "pageerror", message: error.message }));
  page.on("console", (message) => {
    if (message.type() === "error") consoleProblems.push({ type: "console", message: message.text() });
  });
  return { context, page };
}

async function actionMatrix(page, matchId, label) {
  await page.goto(`/matches/${matchId}`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(150);
  const value = await page.evaluate(() => ({
    text: document.body.innerText.slice(0, 1000),
    actions: [...document.querySelectorAll("button")].filter((node) => node.offsetParent !== null).map((node) => ({ text: node.textContent?.trim(), disabled: node.disabled })),
    alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent?.trim()),
  }));
  records.push({ id: label, matchId, ...value });
  return value;
}

const admin = await request.newContext({ baseURL, userAgent: "tab10-judge-audit-bootstrap" });
const health = await admin.get("/health");
check(health.ok(), "health");
const healthBody = await health.json();
check(healthBody.release?.environment === "test", "test environment");
await mutate(admin, "/api/v1/auth/login", { email: adminEmail, password: adminPassword });
await mutate(admin, "/api/v1/me/onboarding", { action: "complete" }, "PATCH");

const [creator, playerA, playerB, target, outsider] = await Promise.all([
  createUser(admin, "Оператор", "Синтетический"),
  createUser(admin, "Анна", "Синтетическая"),
  createUser(admin, "Борис", "Синтетический"),
  createUser(admin, "Дарья", "Синтетическая"),
  createUser(admin, "Наблюдатель", "Синтетический"),
]);

await writeFile(path.join(out, "fixture-index.json"), `${JSON.stringify({
  runtime: { baseURL, environment: healthBody.release.environment, version: healthBody.release.version, sha: healthBody.release.sha },
  actors: [creator, playerA, playerB, target, outsider].map((actor, index) => ({
    key: ["creator", "playerA", "playerB", "targetJudge", "outsider"][index],
    id: actor.user.id,
    label: actor.label,
    status: actor.user.status,
    role: actor.user.role,
    credentialStored: false,
  })),
}, null, 2)}\n`);

const browser = await chromium.launch({ headless: true });
const openContexts = [];
try {
  const main = await createMatch(creator, [playerA, playerB], "JUDGE audit main", { pointsToWin: 9 });
  const c = await pageFor(browser, creator, { width: 390, height: 844 });
  openContexts.push(c.context);
  await c.page.goto(`/matches/${main.id}/judge`);
  await c.page.getByTestId("judge-setup").waitFor();
  await state(c.page, "j01-setup-390", { runId: "J-RUN-SETUP" });

  const setupRadios = c.page.getByRole("radio");
  await setupRadios.first().check();
  let releaseStart;
  let startSeenResolve;
  let startHandledResolve;
  const startSeen = new Promise((resolve) => { startSeenResolve = resolve; });
  const startHandled = new Promise((resolve) => { startHandledResolve = resolve; });
  const startGate = new Promise((resolve) => { releaseStart = resolve; });
  const startPattern = new RegExp(`/api/v1/matches/${main.id}/start$`);
  await c.page.route(startPattern, async (route) => {
    startSeenResolve();
    await startGate;
    await route.continue();
    startHandledResolve();
  });
  await c.page.getByRole("button", { name: "Начать матч", exact: true }).click();
  await startSeen;
  const pendingSetup = {
    radioDisabled: await setupRadios.nth(1).isDisabled(),
    swapDisabled: await c.page.getByRole("button", { name: "Поменять стороны", exact: true }).isDisabled(),
    confirmDisabled: await c.page.getByRole("button", { name: "Сохранение…", exact: true }).isDisabled(),
  };
  await setupRadios.nth(1).check();
  await c.page.getByRole("button", { name: "Поменять стороны", exact: true }).click();
  await state(c.page, "j02-setup-pending-controls-390", { runId: "J-RUN-SETUP", pendingSetup });
  releaseStart();
  await startHandled;
  await c.page.unroute(startPattern);
  await c.page.getByRole("group", { name: "Счёт матча", exact: true }).waitFor();
  await state(c.page, "j03-live-390", { runId: "J-RUN-SCORE" });

  await c.page.setViewportSize({ width: 360, height: 800 });
  const narrow = await state(c.page, "j04-live-360", { runId: "J-RUN-RESPONSIVE" });
  check(!narrow.horizontalOverflow, "360 horizontal overflow");
  check(narrow.pointTargets.every((target) => target.rect.width >= 44 && target.rect.height >= 44), "360 point targets");

  await c.page.setViewportSize({ width: 844, height: 390 });
  let releasePoint;
  let pointSeenResolve;
  const pointSeen = new Promise((resolve) => { pointSeenResolve = resolve; });
  const pointGate = new Promise((resolve) => { releasePoint = resolve; });
  const pointPattern = new RegExp(`/api/v1/matches/${main.id}/points$`);
  let heldPointCount = 0;
  await c.page.route(pointPattern, async (route) => {
    heldPointCount += 1;
    if (heldPointCount === 1) {
      pointSeenResolve();
      await pointGate;
    }
    await route.continue();
  });
  const pointA = c.page.getByRole("button", { name: /\+1 очко:/ }).first();
  await pointA.click();
  await pointSeen;
  await pointA.click();
  await c.page.getByText("В очереди: 2", { exact: true }).waitFor();
  await state(c.page, "j05-rapid-queue-landscape", { runId: "J-RUN-RAPID", heldPointCount });
  releasePoint();
  await c.page.waitForFunction(() => document.querySelectorAll('.judge-side__score')[0]?.textContent === "2");
  await c.page.unroute(pointPattern);
  await c.page.getByRole("button", { name: "Отменить последнее очко", exact: true }).click();
  await c.page.waitForFunction(() => document.querySelectorAll('.judge-side__score')[0]?.textContent === "1");
  await state(c.page, "j06-after-undo-landscape", { runId: "J-RUN-RAPID" });

  await c.page.setViewportSize({ width: 1440, height: 900 });
  const more = c.page.getByRole("button", { name: "Ещё", exact: true });
  await more.focus();
  await c.page.keyboard.press("Enter");
  const correctionButton = c.page.getByRole("button", { name: "Исправить счёт и подачу", exact: true });
  await correctionButton.focus();
  await c.page.keyboard.press("Enter");
  await c.page.getByRole("region", { name: "Ручная коррекция", exact: true }).waitFor();
  const correctionOpenFocus = await c.page.evaluate(() => ({ tag: document.activeElement?.tagName, id: document.activeElement?.id || null, text: document.activeElement?.textContent?.trim().slice(0, 80) || null }));
  await state(c.page, "j07-correction-open-focus-1440", { runId: "J-RUN-CORRECTION", correctionOpenFocus });
  const cancelCorrection = c.page.getByRole("button", { name: "Отмена", exact: true });
  await cancelCorrection.focus();
  await c.page.keyboard.press("Enter");
  const correctionCloseFocus = await c.page.evaluate(() => ({ tag: document.activeElement?.tagName, id: document.activeElement?.id || null, text: document.activeElement?.textContent?.trim().slice(0, 80) || null }));
  records.push({ id: "j07b-correction-close-focus", correctionCloseFocus });

  await more.click();
  await c.page.getByRole("button", { name: "Исправить счёт и подачу", exact: true }).click();
  await c.page.getByLabel("Счёт стороны A", { exact: true }).fill("3");
  await c.page.getByLabel("Счёт стороны B", { exact: true }).fill("1");
  const serverSelect = c.page.getByRole("combobox", { name: "Текущий подающий", exact: true });
  await serverSelect.selectOption(main.participants.find((participant) => participant.side === "B").id);
  await c.page.getByRole("button", { name: "Сохранить коррекцию", exact: true }).click();
  await c.page.getByRole("region", { name: "Ручная коррекция", exact: true }).waitFor({ state: "detached" });
  const corrected = (await getMatch(creator.api, main.id)).match;
  check(corrected.scoreA === 3 && corrected.scoreB === 1, "correction persisted");

  await c.page.reload();
  await c.page.getByRole("group", { name: "Счёт матча", exact: true }).waitFor();
  let releaseDirectory;
  let directorySeenResolve;
  let directoryHandledResolve;
  const directorySeen = new Promise((resolve) => { directorySeenResolve = resolve; });
  const directoryHandled = new Promise((resolve) => { directoryHandledResolve = resolve; });
  const directoryGate = new Promise((resolve) => { releaseDirectory = resolve; });
  const directoryPattern = /\/api\/v1\/users\/directory/;
  await c.page.route(directoryPattern, async (route) => {
    directorySeenResolve();
    await directoryGate;
    await route.continue();
    directoryHandledResolve();
  });
  await c.page.getByRole("button", { name: "Ещё", exact: true }).click();
  await directorySeen;
  const handoverSelect = c.page.getByRole("combobox", { name: "Передать судейство", exact: true });
  const directoryPending = {
    selectDisabled: await handoverSelect.isDisabled(),
    optionCount: await handoverSelect.locator("option").count(),
    busyCount: await c.page.locator('[aria-busy="true"]').count(),
    retryCount: await c.page.getByRole("button", { name: /повтор|обнов/i }).count(),
  };
  await state(c.page, "j08-handover-directory-pending-1440", { runId: "J-RUN-HANDOVER-DIRECTORY", directoryPending });
  releaseDirectory();
  await directoryHandled;
  await c.page.unroute(directoryPattern);
  await c.page.waitForFunction(() => document.querySelectorAll('#judge-handover-user option').length > 2);

  await c.page.reload();
  await c.page.getByRole("group", { name: "Счёт матча", exact: true }).waitFor();
  await c.page.route(directoryPattern, async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "SYNTHETIC_DIRECTORY_FAILURE", message: "Синтетическая ошибка каталога" }) });
  });
  await c.page.getByRole("button", { name: "Ещё", exact: true }).click();
  await c.page.getByRole("alert").waitFor();
  const directoryError = {
    selectDisabled: await c.page.getByRole("combobox", { name: "Передать судейство", exact: true }).isDisabled(),
    retryCount: await c.page.getByRole("button", { name: /повтор|обнов/i }).count(),
    alert: await c.page.getByRole("alert").innerText(),
  };
  await state(c.page, "j09-handover-directory-error-1440", { runId: "J-RUN-HANDOVER-DIRECTORY", directoryError });
  await c.page.unroute(directoryPattern);

  await c.page.reload();
  await c.page.getByRole("group", { name: "Счёт матча", exact: true }).waitFor();
  await c.page.route(pointPattern, async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "SYNTHETIC_POINT_FAILURE", message: "Синтетическая ошибка записи" }) });
  });
  const beforeKnown = (await getMatch(creator.api, main.id)).match;
  await c.page.getByRole("button", { name: /\+1 очко:/ }).first().click();
  await c.page.getByRole("alert").waitFor();
  const knownFailure = await state(c.page, "j10-known-write-failure-dark-1440", { runId: "J-RUN-KNOWN-FAILURE", beforeVersion: beforeKnown.version });
  const afterKnown = (await getMatch(creator.api, main.id)).match;
  check(afterKnown.version === beforeKnown.version, "known failure no write");
  await c.page.unroute(pointPattern);

  let unknownIdempotencyKey = "";
  await c.page.route(pointPattern, async (route) => {
    unknownIdempotencyKey = route.request().headers()["idempotency-key"] ?? "";
    await route.fetch();
    await route.abort("failed");
  });
  const beforeUnknown = (await getMatch(creator.api, main.id)).match;
  await c.page.getByRole("button", { name: /\+1 очко:/ }).first().click();
  await c.page.getByRole("alert").waitFor();
  await c.page.waitForFunction((score) => document.querySelectorAll('.judge-side__score')[0]?.textContent === String(score), beforeUnknown.scoreA + 1);
  const unknownFailure = await state(c.page, "j11-unknown-outcome-authoritative-score-1440", { runId: "J-RUN-UNKNOWN-OUTCOME", scoreBefore: beforeUnknown.scoreA, idempotencyKeyCaptured: Boolean(unknownIdempotencyKey) });
  const afterUnknown = (await getMatch(creator.api, main.id)).match;
  check(afterUnknown.scoreA === beforeUnknown.scoreA + 1, "unknown response outcome actually persisted once");
  check(unknownIdempotencyKey && afterUnknown.idempotencyKeys?.includes(unknownIdempotencyKey), "unknown response intent key persisted in authoritative match");
  await c.page.unroute(pointPattern);

  const pageVersionBeforeConflict = afterUnknown.version;
  await mutate(creator.api, `/api/v1/matches/${main.id}/points`, { side: "B", expectedVersion: pageVersionBeforeConflict });
  await c.page.getByRole("button", { name: /\+1 очко:/ }).first().click();
  await c.page.waitForFunction(() => [...document.querySelectorAll('[role="alert"]')].some((node) => node.textContent?.includes("Счёт изменился")));
  const conflict = await state(c.page, "j12-version-conflict-authoritative-refresh-1440", { runId: "J-RUN-VERSION-CONFLICT", staleVersion: pageVersionBeforeConflict });
  check(conflict.alerts.join(" ").includes("Счёт изменился"), "visible version conflict");

  await c.page.reload();
  await c.page.getByRole("group", { name: "Счёт матча", exact: true }).waitFor();
  await c.page.setViewportSize({ width: 390, height: 844 });
  await c.context.setOffline(true);
  await c.page.getByRole("button", { name: /\+1 очко:/ }).first().click();
  await c.page.waitForFunction(() => [...document.querySelectorAll('[role="alert"]')].some((node) => node.textContent?.includes("Failed to fetch")));
  const offline = await state(c.page, "j13-offline-no-recovery-action-390", {
    runId: "J-RUN-OFFLINE",
    refreshButtons: await c.page.getByRole("button", { name: /обнов|повтор/i }).count(),
  });
  await c.context.setOffline(false);
  await c.page.reload();
  await c.page.getByRole("group", { name: "Счёт матча", exact: true }).waitFor();

  await c.page.getByRole("button", { name: "Ещё", exact: true }).click();
  await c.page.getByRole("combobox", { name: "Передать судейство", exact: true }).selectOption(target.user.id);
  await state(c.page, "j14-handover-ready-390", { runId: "J-RUN-HANDOVER" });
  await c.page.getByRole("button", { name: "Передать слот", exact: true }).click();
  await c.page.waitForURL(new RegExp(`/matches/${main.id}$`));
  const reserved = (await getMatch(creator.api, main.id)).match;
  check(reserved.activeJudge === null && reserved.judgeReservation?.userId === target.user.id, "reservation persisted");

  const d = await pageFor(browser, target, { width: 390, height: 844 });
  openContexts.push(d.context);
  await d.page.goto(`/matches/${main.id}/judge`);
  await d.page.getByRole("group", { name: "Счёт матча", exact: true }).waitFor();
  await state(d.page, "j15-handover-target-acquired-390", { runId: "J-RUN-HANDOVER" });

  const staleC = await pageFor(browser, creator, { width: 390, height: 844 });
  openContexts.push(staleC.context);
  await staleC.page.goto(`/matches/${main.id}/judge`);
  await staleC.page.getByTestId("judge-blocked").waitFor();
  await state(staleC.page, "j16-former-owner-blocked-390", { runId: "J-RUN-OWNERSHIP" });

  const secondTargetApi = await request.newContext({ baseURL, userAgent: "tab10-judge-audit-target-second-device" });
  await mutate(secondTargetApi, "/api/v1/auth/login", { email: target.user.email, password: target.password });
  const secondTargetContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, storageState: await secondTargetApi.storageState() });
  openContexts.push(secondTargetContext);
  const secondTargetPage = await secondTargetContext.newPage();
  await secondTargetPage.goto(`/matches/${main.id}/judge`);
  await secondTargetPage.getByTestId("judge-blocked").waitFor();
  await state(secondTargetPage, "j17-same-user-other-device-blocked-390", { runId: "J-RUN-OWNERSHIP" });
  await secondTargetApi.dispose();

  await d.page.getByRole("button", { name: "Ещё", exact: true }).click();
  await d.page.getByRole("button", { name: "Исправить счёт и подачу", exact: true }).click();
  await d.page.getByLabel("Счёт стороны A", { exact: true }).fill("8");
  await d.page.getByLabel("Счёт стороны B", { exact: true }).fill("2");
  await d.page.getByRole("combobox", { name: "Текущий подающий", exact: true }).selectOption(main.participants.find((participant) => participant.side === "A").id);
  await d.page.getByRole("button", { name: "Сохранить коррекцию", exact: true }).click();
  await d.page.getByRole("button", { name: /\+1 очко:/ }).first().click();
  await d.page.getByRole("button", { name: "Подтвердить результат", exact: true }).waitFor();
  await state(d.page, "j18-pending-confirmation-390", { runId: "J-RUN-CONFIRM" });

  const matrixActors = [
    ["creator", creator], ["participant", playerA], ["judge", target], ["outsider", outsider],
  ];
  for (const [name, actor] of matrixActors) {
    const item = await pageFor(browser, actor, { width: 1440, height: 900 });
    openContexts.push(item.context);
    await actionMatrix(item.page, main.id, `matrix-pending-${name}`);
  }

  await d.page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await d.page.getByText("Идёт", { exact: true }).waitFor();
  await state(d.page, "j19-continue-after-proposal-390", { runId: "J-RUN-CONFIRM" });
  await d.page.getByRole("button", { name: /\+1 очко:/ }).first().click();
  await d.page.getByRole("button", { name: "Подтвердить результат", exact: true }).waitFor();
  await d.page.getByRole("button", { name: "Подтвердить результат", exact: true }).click();
  await d.page.waitForURL(new RegExp(`/matches/${main.id}$`));
  const finished = (await getMatch(target.api, main.id)).match;
  check(finished.status === "finished", "finish persisted");
  await state(d.page, "j20-finished-detail-390", { runId: "J-RUN-CONFIRM", persisted: { status: finished.status, scoreA: finished.scoreA, scoreB: finished.scoreB, activeJudge: finished.activeJudge } });
  for (const [name, actor] of matrixActors) {
    const item = await pageFor(browser, actor, { width: 1440, height: 900 });
    openContexts.push(item.context);
    await actionMatrix(item.page, main.id, `matrix-finished-${name}`);
  }

  const waiting = await createMatch(creator, [playerA, playerB], "JUDGE audit waiting", { pointsToWin: 11 });
  for (const [name, actor] of matrixActors) {
    const item = await pageFor(browser, actor, { width: 1440, height: 900 });
    openContexts.push(item.context);
    const matrix = await actionMatrix(item.page, waiting.id, `matrix-waiting-${name}`);
    if (name === "creator") await state(item.page, "j21-waiting-creator-detail-1440", { runId: "J-RUN-ACTOR-MATRIX", actions: matrix.actions });
  }
  const noShowPageItem = await pageFor(browser, creator, { width: 390, height: 844 });
  openContexts.push(noShowPageItem.context);
  await noShowPageItem.page.goto(`/matches/${waiting.id}`);
  await noShowPageItem.page.getByRole("button", { name: "Зафиксировать неявку", exact: true }).click();
  await state(noShowPageItem.page, "j22-no-show-confirm-390", { runId: "J-RUN-NO-SHOW" });
  await noShowPageItem.page.getByRole("button", { name: "Завершить по неявке", exact: true }).click();
  await noShowPageItem.page.getByText("Матч завершён из-за неявки", { exact: true }).waitFor();
  const noShow = (await getMatch(creator.api, waiting.id)).match;
  check(noShow.status === "stopped" && noShow.scoreA === 0 && noShow.scoreB === 0, "no-show no fabricated score");

  const active = await createMatch(creator, [playerA, playerB], "JUDGE audit stop", { pointsToWin: 11 });
  await mutate(creator.api, `/api/v1/matches/${active.id}/start`, { firstServerParticipantId: active.participants[0].id });
  await mutate(target.api, `/api/v1/matches/${active.id}/judge/acquire`, {});
  await mutate(target.api, `/api/v1/matches/${active.id}/judge/setup`, { firstServerParticipantId: active.participants[0].id, swapSides: false });
  for (const [name, actor] of matrixActors) {
    const item = await pageFor(browser, actor, { width: 1440, height: 900 });
    openContexts.push(item.context);
    const matrix = await actionMatrix(item.page, active.id, `matrix-in-progress-${name}`);
    if (name === "judge") await state(item.page, "j23-in-progress-judge-detail-1440", { runId: "J-RUN-ACTOR-MATRIX", actions: matrix.actions });
  }
  const stopItem = await pageFor(browser, target, { width: 390, height: 844 });
  openContexts.push(stopItem.context);
  await stopItem.page.goto(`/matches/${active.id}`);
  await stopItem.page.getByRole("button", { name: "Остановить матч", exact: true }).click();
  await state(stopItem.page, "j24-stop-form-390", { runId: "J-RUN-STOP" });
  await stopItem.page.getByRole("button", { name: "Подтвердить остановку", exact: true }).click();
  await stopItem.page.getByText("Остановлен", { exact: true }).waitFor();
  const stopped = (await getMatch(target.api, active.id)).match;
  check(stopped.status === "stopped" && stopped.winnerSide === "A", "stop persisted");

  const releaseMatch = await createMatch(creator, [playerA, playerB], "JUDGE audit release", { pointsToWin: 11 });
  const releaseItem = await pageFor(browser, creator, { width: 390, height: 844 });
  openContexts.push(releaseItem.context);
  await releaseItem.page.goto(`/matches/${releaseMatch.id}/judge`);
  await releaseItem.page.getByTestId("judge-setup").waitFor();
  const releasePattern = new RegExp(`/api/v1/matches/${releaseMatch.id}/judge/release$`);
  await releaseItem.page.route(releasePattern, async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "SYNTHETIC_RELEASE_FAILURE", message: "Синтетическая ошибка освобождения" }) });
  });
  await releaseItem.page.getByRole("button", { name: "Отмена", exact: true }).click();
  await releaseItem.page.waitForURL(new RegExp(`/matches/${releaseMatch.id}$`));
  await state(releaseItem.page, "j25-release-failure-destination-warning-390", { runId: "J-RUN-RELEASE" });

  const readbacks = {
    main: { id: main.id, status: finished.status, scoreA: finished.scoreA, scoreB: finished.scoreB, winnerSide: finished.winnerSide, activeJudge: finished.activeJudge },
    noShow: { id: waiting.id, status: noShow.status, scoreA: noShow.scoreA, scoreB: noShow.scoreB, winnerSide: noShow.winnerSide, finishReason: noShow.finishReason },
    stopped: { id: active.id, status: stopped.status, scoreA: stopped.scoreA, scoreB: stopped.scoreB, winnerSide: stopped.winnerSide, finishReason: stopped.finishReason },
    releaseWarningMatch: { id: releaseMatch.id, status: (await getMatch(creator.api, releaseMatch.id)).match.status },
  };
  await writeFile(path.join(out, "authoritative-readbacks.json"), `${JSON.stringify(readbacks, null, 2)}\n`);
} finally {
  await Promise.allSettled(openContexts.map((context) => context.close()));
  await browser.close();
  await Promise.allSettled([admin, creator.api, playerA.api, playerB.api, target.api, outsider.api].map((api) => api.dispose()));
  await writeFile(path.join(out, "runtime-states.json"), `${JSON.stringify({ records, consoleProblems }, null, 2)}\n`);
}

console.log(JSON.stringify({ status: "PASS", records: records.length, consoleProblems: consoleProblems.length }));
