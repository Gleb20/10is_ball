import { randomUUID } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";

const email = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const password = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";
const ownedMatches = new WeakMap<Page, string>();

type ServerMatch = {
  id: string;
  status: string;
  version: number;
  scoreA: number;
  scoreB: number;
  idempotencyKeys: string[];
  activeJudge?: { userId?: string } | null;
};

async function mutationHeaders(page: Page) {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "tab10_csrf");
  return {
    ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {}),
    "idempotency-key": randomUUID(),
  };
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const onboarding = await page.request.patch("/api/v1/me/onboarding", {
    data: { action: "complete" },
    headers: await mutationHeaders(page),
  });
  expect(onboarding.status(), await onboarding.text()).toBe(200);
}

async function createStartedMatch(page: Page, title: string) {
  await page.goto("/matches/new");
  await page.getByLabel("Название").fill(title);
  await expect(page.getByLabel("Создатель играет", { exact: true })).not.toBeChecked();
  await page
    .getByRole("group", { name: "Игрок A: тип участника", exact: true })
    .getByRole("button", { name: "Гость", exact: true })
    .click();
  await page.getByLabel("Игрок A — гость (Имя Фамилия)").fill("Stage4 Alpha");
  await page
    .getByRole("group", { name: "Соперник: тип участника", exact: true })
    .getByRole("button", { name: "Гость", exact: true })
    .click();
  await page.getByLabel("Гость (Имя Фамилия)", { exact: true }).fill("Stage4 Beta");
  await page.getByRole("button", { name: "Создать матч", exact: true }).click();
  await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
  const matchId = page.url().split("/").at(-1)!;
  ownedMatches.set(page, matchId);
  await page.getByRole("button", { name: "Судить", exact: true }).click();
  await expect(page.getByTestId("judge-setup")).toBeVisible();
  await page.getByRole("radio", { name: /Stage4 Alpha/ }).check();
  await page.getByRole("button", { name: "Начать матч", exact: true }).click();
  await expect(page.getByRole("group", { name: "Счёт матча", exact: true })).toBeVisible();
  return matchId;
}

async function readMatch(page: Page, matchId: string): Promise<ServerMatch> {
  const response = await page.request.get(`/api/v1/matches/${matchId}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).match as ServerMatch;
}

async function cleanupMatch(page: Page, matchId: string) {
  const current = await readMatch(page, matchId);
  if (current.status === "waiting") {
    const cancelled = await page.request.post(`/api/v1/matches/${matchId}/cancel`, {
      data: { expectedVersion: current.version },
      headers: await mutationHeaders(page),
    });
    expect(cancelled.status(), await cancelled.text()).toBe(200);
  } else if (current.status === "in_progress" || current.status === "pending_confirmation") {
    const stopped = await page.request.post(`/api/v1/matches/${matchId}/stop`, {
      data: {
        winnerSide: "A",
        reasonCode: "other",
        reasonText: "Синтетическая Stage 4 проверка завершена",
      },
      headers: await mutationHeaders(page),
    });
    expect(stopped.status(), await stopped.text()).toBe(200);
  }
  expect((await readMatch(page, matchId)).activeJudge).toBeNull();
}

test.afterEach(async ({ page }, info) => {
  const matchId = ownedMatches.get(page);
  ownedMatches.delete(page);
  if (!matchId) return;
  try {
    await cleanupMatch(page, matchId);
  } catch (error) {
    if (info.status === info.expectedStatus) throw error;
    info.annotations.push({
      type: "cleanup-failure",
      description: error instanceof Error ? error.message : String(error),
    });
  }
});

async function noHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
}

async function checkRecoveryWidths(page: Page) {
  const recovery = page.getByRole("region", { name: "Восстановление счёта", exact: true });
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(recovery).toBeVisible();
    await noHorizontalOverflow(page);
  }
}

async function fulfillSnapshot(route: Route, payload: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

test("Stage4 point recovery survives Home/return, proves the exact key, and sends one POST", async ({
  page,
}, info) => {
  await login(page);
  const me = (await (await page.request.get("/api/v1/auth/me")).json()).user as { id: string };
  const matchId = await createStartedMatch(page, `Stage4 point ${info.project.name}`);
  const prewriteResponse = await page.request.get(`/api/v1/matches/${matchId}`);
  const prewritePayload = await prewriteResponse.json();
  const prewrite = prewritePayload.match as ServerMatch;
  let pointPosts = 0;
  let staleReadPending = false;
  let pointKey = "";

  await page.route(new RegExp(`/api/v1/matches/${matchId}$`), async (route) => {
    if (route.request().method() === "GET" && staleReadPending) {
      staleReadPending = false;
      await fulfillSnapshot(route, prewritePayload);
      return;
    }
    await route.continue();
  });
  await page.route(new RegExp(`/api/v1/matches/${matchId}/points$`), async (route) => {
    pointPosts += 1;
    pointKey = route.request().headers()["idempotency-key"] ?? "";
    const committed = await route.fetch();
    expect(committed.status(), await committed.text()).toBe(200);
    staleReadPending = true;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "UNAVAILABLE", message: "Синтетическая потеря ответа" }),
    });
  });

  await page.getByRole("button", { name: /\+1 очко: Stage4 Alpha/i }).click();
  const recovery = page.getByRole("region", { name: "Восстановление счёта", exact: true });
  await expect(recovery).toContainText("Сервер не подтвердил");
  expect(pointPosts).toBe(1);
  await expect(page.getByRole("button", { name: "Отменить последнее очко", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Ещё", exact: true })).toBeDisabled();
  await expect(page.getByTestId("judge-side-A").locator(".judge-side__score")).toHaveText("0");
  await checkRecoveryWidths(page);

  await page.getByRole("button", { name: "На главную", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const released = await readMatch(page, matchId);
  expect(released.activeJudge).toBeNull();
  expect(released.scoreA).toBe(1);
  expect(released.version).toBeGreaterThan(prewrite.version);
  expect(released.idempotencyKeys).toContain(pointKey);

  await page.goto(`/matches/${matchId}/judge`);
  await expect(page.getByRole("group", { name: "Счёт матча", exact: true })).toBeVisible();
  await expect(recovery).toHaveCount(0);
  expect(pointPosts).toBe(1);
  const reacquired = await readMatch(page, matchId);
  expect(reacquired.activeJudge?.userId).toBe(me.id);
  expect(reacquired.scoreA).toBe(1);
  expect(reacquired.idempotencyKeys).toContain(pointKey);
});

test("Stage4 correction recovery keeps keyboard focus and exact absolute readback", async ({
  page,
}, info) => {
  await login(page);
  const matchId = await createStartedMatch(page, `Stage4 correction ${info.project.name}`);
  const prewriteResponse = await page.request.get(`/api/v1/matches/${matchId}`);
  const prewritePayload = await prewriteResponse.json();
  const prewrite = prewritePayload.match as ServerMatch;
  let correctionPosts = 0;
  let correctionKey = "";
  let staleReadPending = false;
  let releaseLostResponse!: () => void;
  const lostResponseGate = new Promise<void>((resolve) => {
    releaseLostResponse = resolve;
  });
  let committedCorrection!: () => void;
  const committedGate = new Promise<void>((resolve) => {
    committedCorrection = resolve;
  });

  await page.route(new RegExp(`/api/v1/matches/${matchId}$`), async (route) => {
    if (route.request().method() === "GET" && staleReadPending) {
      staleReadPending = false;
      await fulfillSnapshot(route, prewritePayload);
      return;
    }
    await route.continue();
  });
  await page.route(new RegExp(`/api/v1/matches/${matchId}/manual-correction$`), async (route) => {
    correctionPosts += 1;
    correctionKey = route.request().headers()["idempotency-key"] ?? "";
    const committed = await route.fetch();
    expect(committed.status(), await committed.text()).toBe(200);
    staleReadPending = true;
    committedCorrection();
    await lostResponseGate;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "UNAVAILABLE", message: "Синтетическая потеря ответа" }),
    });
  });

  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page.getByRole("button", { name: "Исправить счёт и подачу", exact: true }).click();
  const heading = page.getByRole("heading", { name: "Ручная коррекция", exact: true });
  const scoreA = page.getByLabel("Счёт стороны A", { exact: true });
  const scoreB = page.getByLabel("Счёт стороны B", { exact: true });
  const server = page.getByLabel("Текущий подающий", { exact: true });
  const save = page.getByRole("button", { name: "Сохранить коррекцию", exact: true });
  const cancel = page.getByRole("button", { name: "Отмена", exact: true });
  await expect(heading).toBeFocused();
  if (info.project.name.includes("desktop")) {
    await page.screenshot({
      path: info.outputPath("stage4-correction-heading-focus-desktop.png"),
      fullPage: true,
    });
  }
  for (const control of [scoreA, scoreB, server, save, cancel]) {
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
  }
  await page.keyboard.press("Enter");
  const correctionTrigger = page.getByRole("button", { name: "Исправить счёт и подачу", exact: true });
  await expect(correctionTrigger).toBeFocused();

  await correctionTrigger.click();
  await scoreA.fill("4");
  await scoreB.fill("2");
  await save.click();
  await committedGate;
  expect(correctionPosts).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Ручная коррекция", exact: true })).toBeVisible();
  releaseLostResponse();

  const recovery = page.getByRole("region", { name: "Восстановление счёта", exact: true });
  await expect(recovery).toContainText("Сервер не подтвердил");
  await expect(recovery).toContainText("Отправляли 4:2");
  await expect(recovery).toContainText("На сервере сейчас 0:0");
  await expect(page.getByRole("button", { name: "Отменить последнее очко", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Ещё", exact: true })).toBeDisabled();
  await checkRecoveryWidths(page);

  await recovery.getByRole("button", { name: "Проверить состояние", exact: true }).click();
  await expect(recovery).toHaveCount(0);
  await expect(page.getByTestId("judge-side-A").locator(".judge-side__score")).toHaveText("4");
  await expect(page.getByRole("button", { name: "Ещё", exact: true })).toBeFocused();
  await expect(page.getByRole("status")).toContainText("Коррекция сохранена");
  expect(correctionPosts).toBe(1);

  const authoritative = await readMatch(page, matchId);
  expect(authoritative.scoreA).toBe(4);
  expect(authoritative.scoreB).toBe(2);
  expect(authoritative.version).toBeGreaterThan(prewrite.version);
  expect(authoritative.idempotencyKeys).toContain(`manual-correction:${correctionKey}`);
});

test("Stage4 no-key review sends zero automatic POSTs and keeps queued taps explicit", async ({
  page,
}, info) => {
  await login(page);
  const matchId = await createStartedMatch(page, `Stage4 no-key ${info.project.name}`);
  let pointPosts = 0;
  const pointKeys: string[] = [];
  let releaseFirstFailure!: () => void;
  const firstFailureGate = new Promise<void>((resolve) => {
    releaseFirstFailure = resolve;
  });

  await page.route(new RegExp(`/api/v1/matches/${matchId}/points$`), async (route) => {
    pointPosts += 1;
    pointKeys.push(route.request().headers()["idempotency-key"] ?? "");
    if (pointPosts === 1) {
      await firstFailureGate;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "UNAVAILABLE", message: "Синтетический отказ до записи" }),
      });
      return;
    }
    await route.continue();
  });

  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label^="+1 очко:"]'));
    if (buttons.length !== 2) throw new Error("Expected two score buttons");
    buttons[0]!.click();
    buttons[1]!.click();
    buttons[0]!.click();
  });
  await expect.poll(() => pointPosts).toBe(1);
  releaseFirstFailure();

  const recovery = page.getByRole("region", { name: "Восстановление счёта", exact: true });
  await expect(recovery).toContainText("Сервер не подтвердил");
  await expect(recovery).toContainText("Не отправлено: 2");
  await expect(page.getByRole("button", { name: "Отменить последнее очко", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Ещё", exact: true })).toBeDisabled();
  await checkRecoveryWidths(page);
  if (info.project.name.includes("mobile")) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: info.outputPath("stage4-recovery-panel-mobile-390.png"),
      fullPage: true,
    });
  }

  await recovery.getByRole("button", { name: "Принять показанный счёт", exact: true }).click();
  const confirmation = page.getByRole("region", { name: "Подтверждение показанного счёта", exact: true });
  await expect(confirmation).toContainText("Stage4 Alpha: 0");
  if (info.project.name.includes("mobile")) {
    await page.screenshot({
      path: info.outputPath("stage4-score-confirmation-mobile-390.png"),
      fullPage: true,
    });
  }
  await confirmation.getByRole("button", { name: "Отменить принятие", exact: true }).click();
  expect(pointPosts).toBe(1);
  await recovery.getByRole("button", { name: "Принять показанный счёт", exact: true }).click();
  await confirmation.getByRole("button", { name: "Подтвердить показанный счёт", exact: true }).click();
  expect(pointPosts).toBe(1);

  await recovery.getByRole("button", { name: /Добавить новое очко: Stage4 Alpha/i }).click();
  await expect.poll(() => pointPosts).toBe(2);
  const continueQueue = recovery.getByRole("button", { name: "Отправить оставшиеся нажатия", exact: true });
  await expect(continueQueue).toBeEnabled();

  const continueBranch = info.project.name.includes("desktop");
  if (continueBranch) {
    await continueQueue.click();
    await expect.poll(() => pointPosts).toBe(4);
  } else {
    const discard = recovery.getByRole("button", { name: "Не отправлять оставшиеся", exact: true });
    await discard.click();
    await recovery.getByRole("button", { name: "Подтвердить: не отправлять", exact: true }).click();
    expect(pointPosts).toBe(2);
  }
  await expect(recovery).toHaveCount(0);

  const authoritative = await readMatch(page, matchId);
  expect(authoritative.scoreA).toBe(continueBranch ? 2 : 1);
  expect(authoritative.scoreB).toBe(continueBranch ? 1 : 0);
  expect(authoritative.idempotencyKeys).not.toContain(pointKeys[0]);
  for (const key of continueBranch ? pointKeys.slice(1) : pointKeys.slice(1, 2)) {
    expect(authoritative.idempotencyKeys).toContain(key);
  }
});
