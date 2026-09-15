import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, request } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const baseURL = "http://localhost:4717";
const outDir = new URL("./", import.meta.url).pathname;
const privateFixturePath = "/private/tmp/tab10-ux-auth-private.json";
const { adminEmail, adminPassword } = JSON.parse(await readFile(privateFixturePath, "utf8"));
const runSuffix = randomBytes(5).toString("hex");
let sequence = 0;

await mkdir(outDir, { recursive: true });

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function writeJson(name, value) {
  await writeFile(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function mutationHeaders(api) {
  const csrf = (await api.storageState()).cookies.find((cookie) => cookie.name === "tab10_csrf");
  return {
    ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {}),
    "idempotency-key": randomUUID(),
  };
}

async function mutate(api, url, data, method = "POST") {
  const response = await api.fetch(url, { method, data, headers: await mutationHeaders(api) });
  check(response.status() < 300, `${method} ${url} returned ${response.status()}`);
  return response.json();
}

async function createUser(admin, label, { completed = false } = {}) {
  const password = `Aa9!${randomBytes(14).toString("hex")}`;
  const created = await mutate(admin, "/api/v1/admin/users", {
    email: `ux-auth-${label}-${runSuffix}@tab10.test`,
    firstName: label === "first" ? "ОченьДлинноеИмяДляПроверки" : `Тест-${label}`,
    lastName: "Пользователь",
    role: "user",
  });
  if (!completed) return { ...created, password: created.temporaryPassword };
  const api = await request.newContext({ baseURL, userAgent: `Tab10 AUTH ${label} fixture` });
  await mutate(api, "/api/v1/auth/login", { email: created.user.email, password: created.temporaryPassword });
  await mutate(api, "/api/v1/auth/password/first-change", { newPassword: password });
  await mutate(api, "/api/v1/me/onboarding", { action: "complete" }, "PATCH");
  return { ...created, password, api };
}

async function loginPage(page, email, password) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(outDir, name), fullPage: false });
}

async function activeDescriptor(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) return null;
    return {
      tag: el.tagName.toLowerCase(),
      name: el.getAttribute("aria-label") ?? el.getAttribute("name") ?? el.textContent?.trim().slice(0, 80) ?? "",
      id: el.id || null,
    };
  });
}

async function tabSequence(page, count) {
  const result = [];
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press("Tab");
    result.push(await activeDescriptor(page));
  }
  return result;
}

async function viewportGeometry(page, selectors) {
  return page.evaluate((entries) => {
    const rows = {};
    for (const [name, selector] of Object.entries(entries)) {
      const el = document.querySelector(selector);
      if (!el) { rows[name] = null; continue; }
      const rect = el.getBoundingClientRect();
      rows[name] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom };
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight },
      rows,
    };
  }, selectors);
}

async function contrastSample(page, selector) {
  return page.locator(selector).first().evaluate((el, sampledSelector) => {
    const rgba = (value) => {
      const parts = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    const composite = (fg, bg) => {
      const a = fg[3];
      return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
    };
    const luminance = (rgb) => {
      const channel = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    };
    let background = [255, 255, 255, 1];
    let current = el;
    while (current) {
      const parsed = rgba(getComputedStyle(current).backgroundColor);
      if (parsed[3] > 0) { background = composite(parsed, background); if (parsed[3] === 1) break; }
      current = current.parentElement;
    }
    const foreground = composite(rgba(getComputedStyle(el).color), background);
    const a = luminance(foreground), b = luminance(background);
    return {
      selector: sampledSelector,
      color: getComputedStyle(el).color,
      background: `rgb(${background.slice(0, 3).map((v) => Math.round(v)).join(", ")})`,
      ratio: Number(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2)),
    };
  }, selector);
}

const admin = await request.newContext({ baseURL, userAgent: "Tab10 AUTH audit admin fixture" });
const health = await admin.get("/health");
check(health.ok(), "health failed");
const healthBody = await health.json();
check(healthBody.release?.environment === "test", "runtime is not test");
await mutate(admin, "/api/v1/auth/login", { email: adminEmail, password: adminPassword });
await mutate(admin, "/api/v1/me/onboarding", { action: "complete" }, "PATCH");

const first = await createUser(admin, "first");
const returning = await createUser(admin, "returning", { completed: true });
const alternate = await createUser(admin, "alternate", { completed: true });
const blocked = await createUser(admin, "blocked", { completed: true });
await mutate(admin, `/api/v1/admin/users/${blocked.user.id}/block`, {});
await writeJson("fixture-index.json", {
  kind: "synthetic disposable PostgreSQL fixtures; no credentials retained",
  baseURL,
  databaseProject: "tab10-ux-auth-4717",
  databasePort: 33017,
  actors: {
    first: { id: first.user.id, email: first.user.email, status: first.user.status, mustChangePasswordInitially: true, onboardingInitially: "incomplete" },
    returning: { id: returning.user.id, email: returning.user.email, status: returning.user.status, mustChangePassword: false, onboarding: "complete" },
    alternate: { id: alternate.user.id, email: alternate.user.email, status: alternate.user.status, mustChangePassword: false, onboarding: "complete" },
    blocked: { id: blocked.user.id, email: blocked.user.email, status: "blocked", mustChangePassword: false, onboarding: "complete" },
  },
});

const browser = await chromium.launch();
const version = browser.version();
const consoleErrors = [];
const results = { browser: `Chromium ${version}`, baseURL, runtime: healthBody.release };

try {
  const firstContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, userAgent: "Tab10 AUTH audit mobile390" });
  const firstPage = await firstContext.newPage();
  firstPage.on("pageerror", (error) => consoleErrors.push(`first:${error.message}`));
  await firstPage.goto("/history?from=deep#latest");
  await firstPage.getByRole("heading", { name: "Вход", exact: true }).waitFor();
  await screenshot(firstPage, "a01-login-390.png");
  const loginTabs = await tabSequence(firstPage, 5);

  await loginPage(firstPage, first.user.email, "DefinitelyWrong9!");
  const knownError = await firstPage.getByRole("alert").textContent();
  const knownErrorFocus = await activeDescriptor(firstPage);
  const emailPreserved = await firstPage.getByLabel("Email", { exact: true }).inputValue();
  await screenshot(firstPage, "a01-login-error-390.png");

  await firstPage.getByLabel("Пароль", { exact: true }).fill(first.password);
  await firstPage.getByRole("button", { name: "Войти", exact: true }).click();
  await firstPage.getByRole("heading", { name: "Смена пароля", exact: true }).waitFor();
  await firstPage.setViewportSize({ width: 1440, height: 900 });
  await screenshot(firstPage, "a01-first-password-1440.png");
  await firstPage.setViewportSize({ width: 390, height: 844 });

  await firstPage.getByRole("button", { name: "Выйти", exact: true }).click();
  await firstPage.getByRole("heading", { name: "Вход", exact: true }).waitFor();
  const authAfterFirstPasswordExit = await firstPage.request.get("/api/v1/auth/me");
  const firstPasswordExit = {
    url: new URL(firstPage.url()).pathname,
    authStatus: authAfterFirstPasswordExit.status(),
    sessionStillAuthenticated: authAfterFirstPasswordExit.status() === 200,
  };
  await screenshot(firstPage, "a01-first-password-exit-still-authenticated-390.png");
  await firstPage.goto("/first-password");
  await firstPage.getByRole("heading", { name: "Смена пароля", exact: true }).waitFor();

  await firstPage.getByLabel("Новый пароль", { exact: true }).fill("ValidCandidate9!");
  await firstPage.getByLabel("Повторите пароль", { exact: true }).fill("OtherCandidate9!");
  await firstPage.getByRole("button", { name: "Сохранить", exact: true }).click();
  const mismatchFocus = await activeDescriptor(firstPage);
  const mismatchSemantics = await firstPage.evaluate(() => ({
    alert: document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
    invalidCount: document.querySelectorAll('[aria-invalid="true"]').length,
    describedBy: Array.from(document.querySelectorAll('input')).map((el) => el.getAttribute('aria-describedby')),
  }));
  await screenshot(firstPage, "a01-first-password-mismatch-390.png");

  await firstPage.getByLabel("Новый пароль", { exact: true }).fill("short");
  await firstPage.getByLabel("Повторите пароль", { exact: true }).fill("short");
  await firstPage.getByRole("button", { name: "Сохранить", exact: true }).click();
  await firstPage.getByRole("alert").waitFor();
  const policyError = await firstPage.getByRole("alert").textContent();
  const policyFocus = await activeDescriptor(firstPage);
  await screenshot(firstPage, "a01-first-password-policy-error-390.png");

  const firstPassword = `Aa9!${randomBytes(14).toString("hex")}`;
  await firstPage.getByLabel("Новый пароль", { exact: true }).fill(firstPassword);
  await firstPage.getByLabel("Повторите пароль", { exact: true }).fill(firstPassword);
  await firstPage.getByRole("button", { name: "Сохранить", exact: true }).click();
  await firstPage.getByRole("heading", { name: "Главная", exact: true }).waitFor();
  check(new URL(firstPage.url()).pathname === "/onboarding", "first password did not enter onboarding");
  const step0Focus = await activeDescriptor(firstPage);
  await screenshot(firstPage, "a01-onboarding-step1-390.png");
  await firstPage.getByRole("button", { name: "Пропустить шаг", exact: true }).click();
  await firstPage.getByRole("heading", { name: "Рейтинг", exact: true }).waitFor();
  await firstPage.getByRole("button", { name: "Далее", exact: true }).click();
  await firstPage.getByRole("heading", { name: "История", exact: true }).waitFor();
  await firstPage.getByRole("button", { name: "Далее", exact: true }).click();
  await firstPage.getByRole("heading", { name: "Уведомления", exact: true }).waitFor();
  await screenshot(firstPage, "a01-onboarding-notifications-390.png");
  await firstPage.getByRole("button", { name: "Далее", exact: true }).click();
  await firstPage.getByRole("heading", { name: "Профиль", exact: true }).waitFor();
  await firstPage.reload();
  await firstPage.getByRole("heading", { name: "Профиль", exact: true }).waitFor();
  const persistedStep = await firstPage.getByText("Шаг 5 из 7", { exact: true }).isVisible();
  await firstPage.getByRole("button", { name: "Далее", exact: true }).click();
  await firstPage.getByRole("heading", { name: "Начать", exact: true }).waitFor();
  await firstPage.getByRole("button", { name: "Далее", exact: true }).click();
  await firstPage.getByRole("heading", { name: "Учебный матч", exact: true }).waitFor();
  await screenshot(firstPage, "a01-onboarding-tutorial-390.png");
  await firstPage.getByRole("button", { name: "Матч с Призрачным Олегом", exact: true }).click();
  await firstPage.getByTestId("judge-setup").waitFor();
  const tutorialURL = firstPage.url();
  await screenshot(firstPage, "a01-tutorial-entry-390.png");
  await firstPage.getByRole("button", { name: "Отмена", exact: true }).click();
  await firstPage.getByRole("heading", { name: "Учебный матч", exact: true }).waitFor();
  const incompleteAfterTutorial = (await (await firstPage.request.get("/api/v1/auth/me")).json()).user.onboardingCompletedAt === null;
  await firstPage.getByRole("button", { name: "Завершить без учебного матча", exact: true }).click();
  await firstPage.getByRole("heading", { name: /Привет,/ }).waitFor();
  await firstPage.getByText("Активных событий нет", { exact: true }).waitFor();

  const home390 = await viewportGeometry(firstPage, {
    heading: ".page-header",
    stats: ".hero-card",
    begin: ".hero-card + button",
    active: "section[aria-labelledby='active-events-title']",
    shortcuts: ".home-shortcuts",
    ranking: "section[aria-labelledby='home-ranking-title']",
    recent: "section[aria-labelledby='recent-events-title']",
    nav: ".bottom-nav",
  });
  const homeText = await firstPage.locator("main").innerText();
  const homeContrast = await Promise.all([
    contrastSample(firstPage, ".hero-card .muted"),
    contrastSample(firstPage, ".hero-card strong"),
    contrastSample(firstPage, ".bottom-nav__item.active"),
  ]);
  await screenshot(firstPage, "a03-home-empty-390.png");
  const homeAxe = await new AxeBuilder({ page: firstPage }).analyze();
  await firstPage.setViewportSize({ width: 1440, height: 900 });
  await screenshot(firstPage, "a03-home-empty-1440.png");
  const home1440 = await viewportGeometry(firstPage, { shell: ".app-shell", stats: ".hero-card", begin: ".hero-card + button", nav: ".bottom-nav" });
  await firstPage.setViewportSize({ width: 360, height: 800 });
  await screenshot(firstPage, "a03-home-empty-360.png");
  const home360 = await viewportGeometry(firstPage, { shell: ".app-shell", heading: ".page-header", stats: ".hero-card", nav: ".bottom-nav" });

  await firstPage.setViewportSize({ width: 390, height: 844 });
  await firstPage.goto("/profile");
  await firstPage.getByRole("heading", { name: "Профиль", exact: true }).waitFor();
  await firstPage.getByText("Текущая", { exact: true }).waitFor();
  await screenshot(firstPage, "a03-profile-sessions-390.png");
  const sessionRows = await firstPage.locator("section[aria-labelledby='profile-stats-title']").count();
  await firstPage.getByText("Пройти онбординг заново", { exact: true }).click();
  await firstPage.getByRole("heading", { name: "Главная", exact: true }).waitFor();
  const restartURL = firstPage.url();
  await firstPage.getByRole("button", { name: "Закрыть онбординг", exact: true }).click();
  await firstPage.getByRole("heading", { name: /Привет,/ }).waitFor();

  await firstPage.goto("/help");
  await firstPage.getByRole("heading", { name: "Помощь", exact: true }).waitFor();
  await firstPage.getByText("Матчи", { exact: true }).first().waitFor();
  const helpControl = await firstPage.getByLabel("Сообщение", { exact: true }).evaluate((el) => ({
    tagName: el.tagName.toLowerCase(),
    type: el.getAttribute("type"),
    maxLength: el.getAttribute("maxlength"),
    multiline: el.tagName.toLowerCase() === "textarea",
  }));
  const helpActiveNav = await firstPage.locator(".bottom-nav__item.active").allTextContents();
  const helpContrast = await Promise.all([
    contrastSample(firstPage, ".card .muted"),
    contrastSample(firstPage, ".section-title"),
  ]);
  await screenshot(firstPage, "a03-help-390.png");
  const helpAxe = await new AxeBuilder({ page: firstPage }).analyze();

  await firstPage.route("**/api/v1/faq", async (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "TEMPORARY", message: "Справка временно недоступна" }) }));
  await firstPage.reload();
  await firstPage.getByText("Справка временно недоступна", { exact: true }).waitFor();
  await screenshot(firstPage, "a03-help-load-error-390.png");
  const helpErrorFocusBeforeRetry = await activeDescriptor(firstPage);
  await firstPage.unroute("**/api/v1/faq");
  await firstPage.getByRole("button", { name: "Повторить загрузку справки", exact: true }).click();
  await firstPage.getByText("Матчи", { exact: true }).first().waitFor();

  await firstPage.route("**/api/v1/feedback", async (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "TEMPORARY", message: "Отправка временно недоступна" }) }));
  const feedback = firstPage.getByLabel("Сообщение", { exact: true });
  await feedback.fill("Проверочный вопрос со ссылкой https://example.test/material");
  await firstPage.getByRole("button", { name: "Отправить", exact: true }).click();
  await firstPage.getByText("Отправка временно недоступна", { exact: true }).waitFor();
  const feedbackPreserved = await feedback.inputValue();
  await screenshot(firstPage, "a03-feedback-error-390.png");
  await firstPage.unroute("**/api/v1/feedback");
  await firstPage.getByRole("button", { name: "Отправить", exact: true }).click();
  await firstPage.getByText("Сообщение отправлено.", { exact: true }).waitFor();

  await writeJson("run-sc-a01.json", {
    runId: "AUTH-A01",
    scenario: "SC-A01",
    browser: `Chromium ${version}`,
    viewport: "390x844 plus first-password 1440x900",
    fixture: { id: first.user.id, email: first.user.email, status: first.user.status, mustChangePassword: true, label: `${first.user.lastName} ${first.user.firstName}` },
    results: {
      login: { result: "PASS", knownError, knownErrorFocus, emailPreserved: emailPreserved === first.user.email, tabSequence: loginTabs },
      firstPassword: { result: "PASS_WITH_UX_FINDINGS", firstPasswordExit, mismatchFocus, mismatchSemantics, policyError, policyFocus },
      onboarding: { result: "PASS_WITH_UX_FINDING", step0Focus, persistedStep, tutorialURL: new URL(tutorialURL).pathname + new URL(tutorialURL).search, incompleteAfterTutorial },
    },
    evidence: ["a01-login-390.png", "a01-login-error-390.png", "a01-first-password-1440.png", "a01-first-password-exit-still-authenticated-390.png", "a01-first-password-mismatch-390.png", "a01-first-password-policy-error-390.png", "a01-onboarding-step1-390.png", "a01-onboarding-notifications-390.png", "a01-onboarding-tutorial-390.png", "a01-tutorial-entry-390.png"],
  });
  await writeJson("run-sc-a03.json", {
    runId: "AUTH-A03",
    scenario: "SC-A03",
    browser: `Chromium ${version}`,
    results: {
      emptyHome: { result: "PASS_WITH_HIERARCHY_HYPOTHESIS", geometry390: home390, geometry1440: home1440, geometry360: home360, emptyExplanationsPresent: ["Первые результаты впереди", "Активных событий нет", "Рейтинг пока пуст", "История пока пуста"].filter((x) => homeText.includes(x)), contrast: homeContrast },
      profile: { result: "PASS", activeSessionSectionRendered: sessionRows === 1, restartURL: new URL(restartURL).pathname },
      help: { result: "PASS_WITH_UX_FINDINGS", control: helpControl, activeBottomNavItems: helpActiveNav, loadErrorFocusBeforeRetry: helpErrorFocusBeforeRetry, feedbackValuePreservedOn503: feedbackPreserved.length > 0, contrast: helpContrast },
      axeSample: { homeViolations: homeAxe.violations, helpViolations: helpAxe.violations },
    },
    evidence: ["a03-home-empty-390.png", "a03-home-empty-1440.png", "a03-home-empty-360.png", "a03-profile-sessions-390.png", "a03-help-390.png", "a03-help-load-error-390.png", "a03-feedback-error-390.png"],
  });
  await firstContext.close();

  const recoveryControl = await request.newContext({ baseURL, userAgent: "Tab10 AUTH recovery control" });
  await mutate(recoveryControl, "/api/v1/auth/login", { email: returning.user.email, password: returning.password });
  const recoveryContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, userAgent: "Tab10 AUTH recovery browser" });
  const recoveryPage = await recoveryContext.newPage();
  recoveryPage.on("pageerror", (error) => consoleErrors.push(`recovery:${error.message}`));
  await recoveryPage.goto("/login");
  await loginPage(recoveryPage, returning.user.email, returning.password);
  await recoveryPage.getByRole("heading", { name: /Привет,/ }).waitFor();
  await recoveryPage.goto("/matches/new?source=manual#form");
  await recoveryPage.getByLabel("Название", { exact: true }).fill("Черновик после перерыва");
  await recoveryPage.getByLabel("Создатель играет", { exact: true }).check();
  await recoveryPage.getByRole("group", { name: "Соперник: тип участника", exact: true }).getByRole("button", { name: "Гость", exact: true }).click();
  await recoveryPage.getByLabel("Гость (Имя Фамилия)", { exact: true }).fill("Гость Возвратный");
  const sessions = await recoveryControl.get("/api/v1/auth/sessions");
  const sessionList = (await sessions.json()).sessions;
  const browserSession = sessionList.find((item) => !item.current && item.userAgent?.includes("recovery browser"));
  check(browserSession, "browser session not found for recovery revoke");
  const revoke = await recoveryControl.delete(`/api/v1/auth/sessions/${browserSession.id}`, { headers: await mutationHeaders(recoveryControl) });
  check(revoke.ok(), `revoke returned ${revoke.status()}`);
  let createRequests = 0;
  recoveryPage.on("request", (requestEvent) => { if (requestEvent.method() === "POST" && requestEvent.url().endsWith("/api/v1/matches")) createRequests += 1; });
  await recoveryPage.getByRole("button", { name: "Создать матч", exact: true }).click();
  await recoveryPage.getByRole("heading", { name: "Вход", exact: true }).waitFor();
  const recoveryFocus = await activeDescriptor(recoveryPage);
  await screenshot(recoveryPage, "a02-session-expired-login-390.png");
  await loginPage(recoveryPage, returning.user.email, returning.password);
  await recoveryPage.getByLabel("Название", { exact: true }).waitFor();
  const restored = {
    url: new URL(recoveryPage.url()).pathname + new URL(recoveryPage.url()).search + new URL(recoveryPage.url()).hash,
    title: await recoveryPage.getByLabel("Название", { exact: true }).inputValue(),
    guest: await recoveryPage.getByLabel("Гость (Имя Фамилия)", { exact: true }).inputValue(),
    createRequests,
  };
  const createRequestsAfterSameActorRecovery = createRequests;
  await screenshot(recoveryPage, "a02-session-restored-draft-390.png");

  const secondSessions = (await (await recoveryControl.get("/api/v1/auth/sessions")).json()).sessions;
  const secondBrowserSession = secondSessions.find((item) => !item.current && item.userAgent?.includes("recovery browser"));
  check(secondBrowserSession, "second browser session not found");
  const revokeSecond = await recoveryControl.delete(`/api/v1/auth/sessions/${secondBrowserSession.id}`, { headers: await mutationHeaders(recoveryControl) });
  check(revokeSecond.ok(), `second revoke returned ${revokeSecond.status()}`);
  await recoveryPage.getByRole("button", { name: "Создать матч", exact: true }).click();
  await recoveryPage.getByRole("heading", { name: "Вход", exact: true }).waitFor();
  await loginPage(recoveryPage, alternate.user.email, alternate.password);
  await recoveryPage.getByLabel("Название", { exact: true }).waitFor();
  const clearedForOtherActor = {
    title: await recoveryPage.getByLabel("Название", { exact: true }).inputValue(),
    oldGuestVisible: await recoveryPage.locator("input").evaluateAll((inputs) => inputs.filter((input) => input.value === "Гость Возвратный").length),
  };

  const profilePage = await recoveryContext.newPage();
  await profilePage.goto("/profile");
  await profilePage.getByRole("heading", { name: "Профиль", exact: true }).waitFor();
  await profilePage.getByText("Текущая", { exact: true }).waitFor();
  await screenshot(profilePage, "a02-active-sessions-390.png");
  const sessionButtons = await profilePage.getByRole("button", { name: /Завершить/ }).count();
  await writeJson("run-sc-a02.json", {
    runId: "AUTH-A02",
    scenario: "SC-A02",
    browser: `Chromium ${version}`,
    fixture: { returningId: returning.user.id, alternateId: alternate.user.id, status: "active", onboarding: "complete" },
    results: {
      sameActorRecovery: { result: "PASS", focus: recoveryFocus, restored, rejectedMutationWasNotReplayed: createRequestsAfterSameActorRecovery === 1 },
      differentActorRecovery: { result: "PASS", clearedForOtherActor },
      activeSessions: { result: "PASS", rendered: true, sessionButtonsProbe: sessionButtons },
    },
    evidence: ["a02-session-expired-login-390.png", "a02-session-restored-draft-390.png", "a02-active-sessions-390.png"],
  });
  await profilePage.close();
  await recoveryContext.close();
  await recoveryControl.dispose();

  const negative = await request.newContext({ baseURL, userAgent: "Tab10 AUTH negative account probes" });
  const unknownResponse = await negative.post("/api/v1/auth/login", { data: { email: `unknown-${runSuffix}@tab10.test`, password: "Wrong9!Wrong" } });
  const blockedResponse = await negative.post("/api/v1/auth/login", { data: { email: blocked.user.email, password: blocked.password } });
  const rateStatuses = [];
  let rateMessage = null;
  for (let index = 0; index < 11; index += 1) {
    const response = await negative.post("/api/v1/auth/login", { data: { email: `limit-${runSuffix}@tab10.test`, password: "Wrong9!Wrong" } });
    rateStatuses.push(response.status());
    if (response.status() === 429) rateMessage = (await response.json()).message;
  }
  await writeJson("negative-auth-probes.json", {
    runId: "AUTH-NEG-01",
    fixture: { blockedUserId: blocked.user.id, blockedStatusVerifiedByAdminMutation: true, neverLoggedUserId: first.user.id, dimensionsKeptSeparate: true },
    accountExistenceCopy: {
      unknown: { status: unknownResponse.status(), message: (await unknownResponse.json()).message },
      blocked: { status: blockedResponse.status(), message: (await blockedResponse.json()).message },
    },
    rateLimit: { statuses: rateStatuses, message: rateMessage },
  });
  await negative.dispose();

  await writeJson("fixture-index.json", {
    kind: "synthetic disposable PostgreSQL fixtures; no credentials retained",
    baseURL,
    databaseProject: "tab10-ux-auth-4717",
    databasePort: 33017,
    actors: {
      first: { id: first.user.id, email: first.user.email, status: "active", mustChangePasswordInitially: true, onboardingInitially: "incomplete" },
      returning: { id: returning.user.id, email: returning.user.email, status: "active", mustChangePassword: false, onboarding: "complete" },
      alternate: { id: alternate.user.id, email: alternate.user.email, status: "active", mustChangePassword: false, onboarding: "complete" },
      blocked: { id: blocked.user.id, email: blocked.user.email, status: "blocked", mustChangePassword: false, onboarding: "complete" },
    },
  });
  await writeJson("runtime.json", {
    ...results,
    ports: { web: 4717, api: 4718, postgres: 33017 },
    databaseProject: "tab10-ux-auth-4717",
    sourceFingerprint: "8e8762575a07e71a17192da327cbe1b5906ca33c1c2ef762c0f9a37463b94cb3",
    consoleErrors,
  });
} finally {
  await Promise.allSettled([
    admin.dispose(),
    returning.api?.dispose(),
    alternate.api?.dispose(),
    blocked.api?.dispose(),
  ]);
  await browser.close();
}
