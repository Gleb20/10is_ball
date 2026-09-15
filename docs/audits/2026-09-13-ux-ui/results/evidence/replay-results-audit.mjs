#!/usr/bin/env node

import { chromium, request } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const baseURL = process.env.RESULTS_BASE_URL ?? "http://127.0.0.1:5317";
const outputDir = path.resolve(
  process.env.RESULTS_OUTPUT_DIR ??
    "docs/audits/2026-09-13-ux-ui/results/evidence/runtime",
);
const adminEmail = process.env.RESULTS_ADMIN_EMAIL;
const adminPassword = process.env.RESULTS_ADMIN_PASSWORD;
const composeFile = process.env.RESULTS_COMPOSE_FILE;
const composeProject = process.env.RESULTS_COMPOSE_PROJECT;
const allowEphemeral = process.env.RESULTS_ALLOW_EPHEMERAL_RESET === "1";

if (!adminEmail || !adminPassword) {
  throw new Error("RESULTS_ADMIN_EMAIL and RESULTS_ADMIN_PASSWORD are required");
}
if (!allowEphemeral || !composeFile || composeProject !== "tab10-ux-results-5317") {
  throw new Error(
    "Refusing fixture SQL without RESULTS_ALLOW_EPHEMERAL_RESET=1 and the exact disposable compose project",
  );
}

await mkdir(outputDir, { recursive: true });

const facts = {
  generatedAt: new Date().toISOString(),
  baseURL,
  release: null,
  fixtures: {},
  scenarios: {},
  limitations: [
    "physical_mobile: NOT_TESTED",
    "webkit: NOT_TESTED",
    "spoken_screen_reader: NOT_TESTED",
    "browser_zoom: NOT_TESTED (CSS zoom was not substituted)",
  ],
};

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/password|token|cookie|csrf/i.test(key))
      .map(([key, child]) => [key, redact(child)]),
  );
}

async function apiContext(userAgent = "RESULTS audit API client") {
  return request.newContext({ baseURL, userAgent });
}

async function call(ctx, method, url, body, extraHeaders = {}) {
  const storage = await ctx.storageState();
  const csrf = storage.cookies.find((cookie) => cookie.name === "tab10_csrf")?.value;
  const headers = { ...extraHeaders };
  if (csrf && method !== "GET") headers["X-CSRF-Token"] = csrf;
  const response = await ctx.fetch(url, {
    method,
    headers,
    data: body,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { text };
  }
  if (!response.ok()) {
    throw new Error(`${method} ${url} -> ${response.status()} ${JSON.stringify(redact(payload))}`);
  }
  return payload;
}

async function login(email, password, userAgent) {
  const ctx = await apiContext(userAgent);
  const result = await call(ctx, "POST", "/api/v1/auth/login", { email, password });
  return { ctx, user: result.user };
}

async function createActivatedUser(admin, index, firstName, lastName, complete = true) {
  const email = `results.${index}.${Date.now()}@tab10.test`;
  const created = await call(admin, "POST", "/api/v1/admin/users", {
    email,
    firstName,
    lastName,
  });
  const password = `Results-${randomUUID()}!Aa9`;
  const session = await login(email, created.temporaryPassword, `RESULTS fixture ${index} primary`);
  await call(session.ctx, "POST", "/api/v1/auth/password/first-change", {
    newPassword: password,
  });
  if (complete) {
    await call(session.ctx, "PATCH", "/api/v1/me/onboarding", { action: "complete" });
  }
  return { id: created.user.id, email, firstName, lastName, password, ctx: session.ctx };
}

async function createMatch(creator, participants, title, format = "1v1", sendPlayerInvitations = false) {
  const payload = await call(creator, "POST", "/api/v1/matches", {
    title,
    format,
    pointsToWin: 1,
    firstServerMethod: "random",
    source: "manual",
    sendPlayerInvitations,
    participants,
  });
  return payload.match;
}

async function finishMatch(ctx, match, side = "A") {
  await call(ctx, "POST", `/api/v1/matches/${match.id}/judge/acquire`);
  let scored = (await call(ctx, "POST", `/api/v1/matches/${match.id}/start`, {})).match;
  for (let point = 0; point < 4 && scored.status === "in_progress"; point += 1) {
    scored = (await call(
      ctx,
      "POST",
      `/api/v1/matches/${match.id}/points`,
      { side, expectedVersion: scored.version },
      { "Idempotency-Key": randomUUID() },
    )).match;
  }
  if (scored.status !== "pending_confirmation") {
    throw new Error(`Match ${match.id} did not reach pending_confirmation`);
  }
  const finished = await call(ctx, "POST", `/api/v1/matches/${match.id}/confirm-finish`);
  return { scored, finished: finished.match };
}

function psql(sql) {
  execFileSync(
    "docker",
    [
      "compose",
      "-f",
      composeFile,
      "-p",
      composeProject,
      "exec",
      "-T",
      "postgres-results",
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "tab10_test",
      "-d",
      "tab10_test_results",
      "-c",
      sql,
    ],
    { stdio: "pipe" },
  );
}

async function waitForText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible" });
}

async function snap(page, name, fullPage = true) {
  const target = path.join(outputDir, name);
  await page.screenshot({ path: target, fullPage });
  return path.basename(target);
}

const adminLogin = await login(adminEmail, adminPassword, "RESULTS admin fixture client");
const admin = adminLogin.ctx;

const health = await call(admin, "GET", "/health");
facts.release = health.release;

const actor = await createActivatedUser(admin, "actor", "Роман", "Результатов", false);
const rival = await createActivatedUser(admin, "rival", "Рита", "Соперница");
const teammate = await createActivatedUser(admin, "teammate", "Тарас", "Партнёр");
const blocked = await createActivatedUser(admin, "blocked", "Борис", "Исторический");
const alternate = await createActivatedUser(admin, "alternate", "Алина", "Другая");

facts.fixtures = {
  actor: { id: actor.id, label: `${actor.firstName} ${actor.lastName}` },
  rival: { id: rival.id, label: `${rival.firstName} ${rival.lastName}` },
  teammate: { id: teammate.id, label: `${teammate.firstName} ${teammate.lastName}` },
  blocked: { id: blocked.id, label: `${blocked.firstName} ${blocked.lastName}` },
  alternate: { id: alternate.id, label: `${alternate.firstName} ${alternate.lastName}` },
};

for (let index = 1; index <= 22; index += 1) {
  const isPair = index === 1;
  const participants = isPair
    ? [
        { side: "A", userId: actor.id },
        { side: "A", userId: teammate.id },
        { side: "B", userId: rival.id },
        { side: "B", userId: blocked.id },
      ]
    : [
        { side: "A", userId: actor.id },
        { side: "B", userId: rival.id },
      ];
  const match = await createMatch(
    actor.ctx,
    participants,
    `Клубная встреча ${String(index).padStart(2, "0")}`,
    isPair ? "2v2" : "1v1",
  );
  await finishMatch(actor.ctx, match, index % 5 === 0 ? "B" : "A");
}

const team = (await call(actor.ctx, "POST", "/api/v1/teams", {
  name: "RESULTS Команда",
  slogan: "Результат различим",
})).team;
const teamInvitation = (await call(actor.ctx, "POST", `/api/v1/teams/${team.id}/invitations`, {
  userId: rival.id,
})).invitation;
await call(rival.ctx, "POST", `/api/v1/team-invitations/${teamInvitation.id}/accept`, {});

await call(admin, "POST", `/api/v1/admin/users/${blocked.id}/block`);

const inviteMatch = await createMatch(
  rival.ctx,
  [
    { side: "A", userId: rival.id },
    { side: "B", userId: actor.id },
  ],
  "Ожидающее приглашение",
  "1v1",
  true,
);
const pendingNotifications = await call(actor.ctx, "GET", "/api/v1/notifications");
const pendingInvitation = pendingNotifications.notifications.find(
  (entry) => entry.type === "match_invitation" && entry.payload?.matchId === inviteMatch.id,
);
if (!pendingInvitation) throw new Error("Pending match invitation fixture was not created");

const declineMatch = await createMatch(
  rival.ctx,
  [
    { side: "A", userId: rival.id },
    { side: "B", userId: actor.id },
  ],
  "Отклонённое приглашение",
  "1v1",
  true,
);
const beforeDecline = await call(actor.ctx, "GET", "/api/v1/notifications");
const declineNotification = beforeDecline.notifications.find(
  (entry) => entry.type === "match_invitation" && entry.payload?.matchId === declineMatch.id,
);
await call(actor.ctx, "POST", `/api/v1/match-invitations/${declineNotification.payload.invitationId}/decline`, {});

const expireMatch = await createMatch(
  rival.ctx,
  [
    { side: "A", userId: rival.id },
    { side: "B", userId: actor.id },
  ],
  "Истёкшее приглашение",
  "1v1",
  true,
);
psql(
  `update match_invitations set expires_at = now() - interval '1 minute' where match_id = '${expireMatch.id}' and invited_user_id = '${actor.id}';`,
);

const staleMatch = await createMatch(
  rival.ctx,
  [
    { side: "A", userId: rival.id },
    { side: "B", userId: actor.id },
  ],
  "Недоступный источник",
  "1v1",
  true,
);
await call(admin, "DELETE", `/api/v1/admin/matches/${staleMatch.id}`);

psql(
  `insert into notifications (id,user_id,type,title,body,payload,created_at) values (gen_random_uuid(),'${actor.id}','results_notice','Проверка прочтения','Непригласительное уведомление для проверки фильтра','{}'::jsonb,now());`,
);

const beforeTutorial = {
  history: await call(actor.ctx, "GET", `/api/v1/history?limit=50`),
  profile: await call(actor.ctx, "GET", "/api/v1/profile/me"),
  ranking: await call(actor.ctx, "GET", "/api/v1/rankings?scope=all_time"),
  home: await call(actor.ctx, "GET", "/api/v1/home"),
};
await call(actor.ctx, "PATCH", "/api/v1/me/onboarding", { action: "restart" });
const tutorial = (await call(actor.ctx, "POST", "/api/v1/matches/tutorial", {})).match;
await call(actor.ctx, "POST", `/api/v1/matches/${tutorial.id}/judge/acquire`);
let tutorialState = (await call(actor.ctx, "POST", `/api/v1/matches/${tutorial.id}/start`, {
  firstServerParticipantId: tutorial.participants[0].id,
})).match;
for (let index = 0; index < 11; index += 1) {
  tutorialState = (await call(
    actor.ctx,
    "POST",
    `/api/v1/matches/${tutorial.id}/points`,
    { side: "A", expectedVersion: tutorialState.version },
    { "Idempotency-Key": randomUUID() },
  )).match;
}
await call(actor.ctx, "POST", `/api/v1/matches/${tutorial.id}/confirm-finish`);
const afterTutorialBeforeComplete = await call(actor.ctx, "GET", "/api/v1/auth/me");
const afterTutorial = {
  history: await call(actor.ctx, "GET", `/api/v1/history?limit=50`),
  profile: await call(actor.ctx, "GET", "/api/v1/profile/me"),
  ranking: await call(actor.ctx, "GET", "/api/v1/rankings?scope=all_time"),
  home: await call(actor.ctx, "GET", "/api/v1/home"),
};
await call(actor.ctx, "PATCH", "/api/v1/me/onboarding", { action: "complete" });
const afterExplicitComplete = await call(actor.ctx, "GET", "/api/v1/auth/me");

const snapshotStats = (profilePayload) => profilePayload.profile.stats;
const rankingRow = (payload) => payload.rankings.find((row) => row.userId === actor.id) ?? null;
facts.scenarios.tutorialIsolation = {
  tutorialIdAbsentFromHistory: !afterTutorial.history.items.some((item) => item.id === tutorial.id),
  historyCountUnchanged: beforeTutorial.history.items.length === afterTutorial.history.items.length,
  statsUnchanged: JSON.stringify(snapshotStats(beforeTutorial.profile)) === JSON.stringify(snapshotStats(afterTutorial.profile)),
  rankingUnchanged: JSON.stringify(rankingRow(beforeTutorial.ranking)) === JSON.stringify(rankingRow(afterTutorial.ranking)),
  rivalUnchanged: JSON.stringify(beforeTutorial.home.rival) === JSON.stringify(afterTutorial.home.rival),
  completionStillNullAfterTutorial: afterTutorialBeforeComplete.user.onboardingCompletedAt === null,
  completionSetOnlyExplicitly: Boolean(afterExplicitComplete.user.onboardingCompletedAt),
};

const historicalJudgeMatch = await createMatch(
  actor.ctx,
  [
    { side: "A", userId: rival.id },
    { side: "B", userId: teammate.id },
  ],
  "Свободный судейский слот",
);
await call(actor.ctx, "POST", `/api/v1/matches/${historicalJudgeMatch.id}/judge/acquire`);
await call(actor.ctx, "POST", `/api/v1/matches/${historicalJudgeMatch.id}/start`, {});
await call(actor.ctx, "POST", `/api/v1/matches/${historicalJudgeMatch.id}/judge/release`);
const homeAfterRelease = await call(actor.ctx, "GET", "/api/v1/home");
const matchAfterRelease = await call(actor.ctx, "GET", `/api/v1/matches/${historicalJudgeMatch.id}`);
const releasedCard = homeAfterRelease.activeEvents?.match?.id === historicalJudgeMatch.id
  ? homeAfterRelease.activeEvents.match
  : null;
facts.scenarios.historicalJudge = {
  matchId: historicalJudgeMatch.id,
  activeJudgeIsNull: matchAfterRelease.match.activeJudge === null,
  homeJudgeName: releasedCard?.judgeName ?? null,
  homeUserRole: releasedCard?.userRole ?? null,
  apiRightsInference: "not asserted; detail screen controls were inspected separately",
};

const secondary = await login(actor.email, actor.password, "RESULTS actor secondary session");
const actorStorage = await actor.ctx.storageState();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL,
  storageState: actorStorage,
  viewport: { width: 390, height: 844 },
  locale: "ru-RU",
  timezoneId: "Europe/Moscow",
});
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

await page.goto("/history");
await waitForText(page, "Клубная встреча 22");
facts.scenarios.history = {
  firstPageRows: await page.locator("main .list-row, main a.list-row").count(),
  initialUrl: page.url(),
  screenshots: [await snap(page, "history-390.png")],
};
await page.getByLabel("Поиск").fill("Соперница");
await page.getByRole("search").getByRole("button").click();
await waitForText(page, "Клубная встреча 22");
facts.scenarios.history.searchUrl = page.url();
facts.scenarios.history.searchResultText = await page.locator("main").innerText();
facts.scenarios.history.screenshots.push(await snap(page, "history-search-390.png"));
await page.getByRole("button", { name: /^Фильтры/ }).click();
await page.setViewportSize({ width: 360, height: 780 });
facts.scenarios.history.screenshots.push(await snap(page, "history-filters-360.png"));
await page.keyboard.press("Escape");
await page.getByLabel("Поиск").fill("");
await page.getByRole("search").getByRole("button").click();
await waitForText(page, "Показать ещё");
await page.route("**/api/v1/history?*cursor=*", async (route) => {
  await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "TEMPORARY", message: "Контрольная ошибка следующей страницы" }) });
});
await page.getByRole("button", { name: "Показать ещё" }).click();
await waitForText(page, "Контрольная ошибка следующей страницы");
facts.scenarios.history.paginationErrorPreservedRows = await page.getByText(/Клубная встреча/).count();
facts.scenarios.history.screenshots.push(await snap(page, "history-pagination-error-360.png"));
await page.unroute("**/api/v1/history?*cursor=*");

await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto("/rankings");
await waitForText(page, "Рейтинг");
await page.locator('main [aria-busy="false"]').waitFor({ state: "visible" });
facts.scenarios.rankings = {
  allTimeText: await page.locator("main").innerText(),
  screenshots: [await snap(page, "rankings-all-1440.png")],
};
await Promise.all([
  page.waitForResponse((response) => response.url().includes("/api/v1/rankings?scope=calendar_month")),
  page.getByRole("group", { name: "Период рейтинга" }).getByRole("button", { name: "Месяц" }).click(),
]);
await page.locator('main [aria-busy="false"]').waitFor({ state: "visible" });
facts.scenarios.rankings.monthUrl = page.url();
facts.scenarios.rankings.screenshots.push(await snap(page, "rankings-month-1440.png"));
await Promise.all([
  page.waitForResponse((response) => response.url().includes(`teamId=${team.id}`)),
  page.getByRole("group", { name: "Состав рейтинга" }).getByRole("button", { name: "RESULTS Команда" }).click(),
]);
await waitForText(page, "RESULTS Команда");
facts.scenarios.rankings.teamText = await page.locator("main").innerText();
facts.scenarios.rankings.screenshots.push(await snap(page, "rankings-team-1440.png"));

await page.goto(`/players/${rival.id}`);
await waitForText(page, "Профиль");
await page.locator("main .profile-hero, main [role=alert]").first().waitFor({ state: "visible" });
facts.scenarios.publicProfile = {
  text: await page.locator("main").innerText(),
  emailVisible: (await page.locator("main").innerText()).includes(rival.email),
  birthDateVisible: (await page.locator("main").innerText()).includes("Дата рождения"),
  challengeVisible: await page.getByRole("button", { name: "Бросить вызов" }).isVisible(),
  screenshot: await snap(page, "profile-public-1440.png"),
};

await page.goto(`/players/${blocked.id}`);
await waitForText(page, "Профиль");
await page.locator("main .profile-hero, main [role=alert]").first().waitFor({ state: "visible" });
facts.scenarios.blockedHistoricalProfile = {
  readable: (await page.locator("main").innerText()).includes("Исторический Борис"),
  challengeVisible: await page.getByRole("button", { name: "Бросить вызов" }).isVisible().catch(() => false),
  screenshot: await snap(page, "profile-blocked-historical-1440.png"),
};

await page.setViewportSize({ width: 390, height: 844 });
await page.goto("/profile");
await waitForText(page, "Активные сессии");
const sessionButtonsBefore = await page.getByRole("button", { name: "Завершить" }).count();
await page.getByRole("button", { name: "Редактировать профиль" }).click();
const organization = page.getByLabel("Организация");
await organization.fill("О".repeat(201));
await page.getByRole("button", { name: "Сохранить", exact: true }).click();
await page.getByRole("alert").waitFor({ state: "visible" });
facts.scenarios.profileValidation = {
  draftLengthAfterError: await organization.inputValue().then((value) => value.length),
  ariaInvalid: await organization.getAttribute("aria-invalid"),
  describedBy: await organization.getAttribute("aria-describedby"),
  activeElement: await page.evaluate(() => {
    const element = document.activeElement;
    return element ? `${element.tagName.toLowerCase()}#${element.id}.${element.className}` : null;
  }),
  alertText: await page.getByRole("alert").innerText(),
  screenshot: await snap(page, "profile-validation-error-390.png"),
};
await page.getByRole("button", { name: "Отмена" }).click();
if (sessionButtonsBefore > 0) {
  await page.getByRole("button", { name: "Завершить", exact: true }).first().click();
  await waitForText(page, "Завершить другую сессию?");
  facts.scenarios.sessionRevoke = {
    buttonsBefore: sessionButtonsBefore,
    pendingScreenshot: null,
  };
  await page.route("**/api/v1/auth/sessions/*", async (route) => {
    facts.scenarios.sessionRevoke.pendingScreenshot = await snap(page, "profile-session-revoke-pending-390.png");
    await route.continue();
  }, { times: 1 });
  await page.getByRole("button", { name: "Завершить сессию" }).click();
  await page.waitForResponse((response) => response.url().includes("/api/v1/auth/sessions/") && response.request().method() === "DELETE");
  await page.waitForFunction((before) => document.querySelectorAll("button").length > 0 && [...document.querySelectorAll("button")].filter((button) => button.textContent?.trim() === "Завершить").length < before, sessionButtonsBefore);
  facts.scenarios.sessionRevoke.buttonsAfter = await page.getByRole("button", { name: "Завершить", exact: true }).count();
}

await page.goto("/notifications");
await waitForText(page, "Проверка прочтения");
await waitForText(page, "Прочитано");
const noticeCard = page.locator(".card").filter({ hasText: "Проверка прочтения" });
facts.scenarios.notifications = {
  justReadNonActionableStillVisibleUnderActual: await noticeCard.isVisible(),
  pendingInviteButtonsVisible: await page.getByRole("button", { name: "Принять" }).first().isVisible(),
  screenshotBeforeRefresh: await snap(page, "notifications-actual-after-read-390.png"),
};
await page.getByRole("button", { name: "Обновить уведомления" }).click();
await page.waitForResponse((response) => response.url().includes("/api/v1/notifications") && response.request().method() === "GET");
facts.scenarios.notifications.noticeVisibleAfterRefresh = await noticeCard.isVisible().catch(() => false);
await page.getByRole("checkbox").uncheck();
facts.scenarios.notifications.allText = await page.locator("main").innerText();
facts.scenarios.notifications.screenshotHistory = await snap(page, "notifications-history-390.png");

await page.goto("/");
await waitForText(page, "Свободный судейский слот");
facts.scenarios.home = {
  text: await page.locator("main").innerText(),
  screenshot390: await snap(page, "home-results-390.png"),
};
await page.setViewportSize({ width: 1440, height: 1000 });
facts.scenarios.home.screenshot1440 = await snap(page, "home-results-1440.png");
await page.getByText("Свободный судейский слот", { exact: true }).click();
await waitForText(page, "Свободный судейский слот");
facts.scenarios.historicalJudge.detailText = await page.locator("main").innerText();
facts.scenarios.historicalJudge.detailScreenshot = await snap(page, "match-free-judge-detail-1440.png");

facts.scenarios.consoleErrors = consoleErrors;
await context.close();
await browser.close();
await secondary.ctx.dispose();
await actor.ctx.dispose();
await rival.ctx.dispose();
await teammate.ctx.dispose();
await blocked.ctx.dispose();
await alternate.ctx.dispose();
await admin.dispose();

await writeFile(path.join(outputDir, "runtime-facts.json"), `${JSON.stringify(redact(facts), null, 2)}\n`);
await writeFile(
  path.join(outputDir, "fixture-index.json"),
  `${JSON.stringify({ generatedAt: facts.generatedAt, release: facts.release, fixtures: facts.fixtures }, null, 2)}\n`,
);
console.log(JSON.stringify({ ok: true, outputDir, scenarios: Object.keys(facts.scenarios) }));
