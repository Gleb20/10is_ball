import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";

test("AT-HOME-003 Home keeps direct actions and all secondary routes at mobile and desktop", async ({ page }, info) => {
  await page.goto("/history");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Пароль", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/history$/);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Начать матч", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Провести турнир", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Основная навигация" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Профиль:.*Admin/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Уведомления/ })).toBeVisible();
  for (const [label, route] of [["Матчи", "/matches"], ["Турниры", "/tournaments"], ["Команды", "/teams"], ["Помощь", "/help"], ["Админка", "/admin"]] as const) {
    await expect(page.getByRole("navigation", { name: "Другие разделы" }).getByRole("link", { name: label })).toHaveAttribute("href", route);
  }
  await expect(page.getByRole("link", { name: "Смотреть все" })).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("home-stage2.png"), fullPage: true });

  await page.goto("/start");
  await expect(page).toHaveURL(/\/#home-actions$/);
  await expect(page.getByRole("heading", { name: "Главная: начните событие" })).toBeFocused();
  await page.getByRole("link", { name: "Провести турнир", exact: true }).click();
  await expect(page).toHaveURL(/\/tournaments\/new$/);
  await expect(page.getByRole("form", { name: "Создание турнира" })).toBeVisible();
  await page.getByRole("button", { name: "На главную" }).click();
  await page.getByRole("link", { name: "Начать матч", exact: true }).first().click();
  await expect(page).toHaveURL(/\/matches\/new$/);
  await expect(page.getByRole("heading", { name: "Новый матч" })).toBeVisible();

  const emptyNotificationsRequest = /\/api\/v1\/notifications\?notificationView=available$/;
  for (const [route, heading] of [["/history", "История"], ["/rankings", "Рейтинг"], ["/teams", "Команды"], ["/help", "Помощь"], ["/notifications", "Уведомления"], ["/profile", "Профиль"], ["/admin", "Админка"]] as const) {
    if (route === "/notifications") {
      await page.route(emptyNotificationsRequest, (request) => request.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ notifications: [], notificationView: "available", unreadCount: 0 }),
      }));
    }
    await page.goto(route);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    if (route === "/notifications") {
      await expect(page.getByRole("heading", { name: "Нет актуальных уведомлений" })).toBeVisible();
      await expect(page.getByRole("status").getByRole("button", { name: "На главную", exact: true })).toBeVisible();
    }
    await expect(page.getByRole("navigation", { name: "Возврат" }).getByRole("button", { name: "На главную", exact: true })).toBeVisible();
    if (route === "/notifications") await page.unroute(emptyNotificationsRequest);
  }
  await page.goto("/unknown-stage2-route");
  await expect(page.getByRole("heading", { name: "Страница не найдена" })).toBeVisible();
  await page.getByRole("button", { name: "На главную" }).first().click();
  await expect(page).toHaveURL(/\/$/);
});

test("AT-HOME-003 Home keeps navigation after a fetch error", async ({ page }, info) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Пароль", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.route(/\/api\/v1\/home\?/, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "UNAVAILABLE", message: "Синтетическая ошибка" }) }));
  await page.goto("/");
  await expect(page.getByText("Не удалось загрузить главную")).toBeVisible();
  const otherRoutes = page.getByRole("navigation", { name: "Другие разделы" });
  for (const label of ["История", "Рейтинг", "Матчи", "Турниры", "Команды", "Помощь", "Админка"]) {
    await expect(otherRoutes.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: /Профиль:.*Admin/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Уведомления/ })).toBeVisible();
  await expect(page.getByText(/в рейтинге/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("home-error-r2.png"), fullPage: true });
});

test("HOME-007 finished match keeps sides and score first with a side-specific winner mark", async ({ page }, info) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Пароль", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/(?:onboarding)?$/);
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "tab10_csrf");
  const onboarding = await page.request.patch("/api/v1/me/onboarding", {
    data: { action: "complete" },
    headers: { ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {}) },
  });
  expect(onboarding.status(), await onboarding.text()).toBe(200);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  const home = await (await page.request.get("/api/v1/home?period=all_time&recentRole=all&notificationView=available")).json();
  const resultId = "10000000-0000-4000-8000-000000000099";
  const longResultId = "10000000-0000-4000-8000-000000000098";
  const recentEvents = [{
    type: "match", id: resultId, title: "Парный матч", status: "finished",
    sideA: "Александра / Борис", sideB: "Александра / Борис", scoreA: 8, scoreB: 11,
    winnerName: "Александра / Борис", winnerSide: "B", durationSeconds: 781,
    userRole: "participant", occurredAt: new Date().toISOString(),
  }, {
    type: "match", id: longResultId, title: "Длинные имена", status: "finished",
    sideA: "Александра-Виктория Константинопольская / Евгений-Максимилиан Преображенский",
    sideB: "Александра-Виктория Константинопольская / Евгений-Максимилиан Преображенский",
    scoreA: 11, scoreB: 9, winnerSide: "A", durationSeconds: 421,
    userRole: "participant", occurredAt: new Date().toISOString(),
  }];
  await page.route(/\/api\/v1\/home\?/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...home, recentEvents }) }));
  await page.reload();
  const card = page.locator(`a[href="/matches/${resultId}"]`);
  await expect(card).toBeVisible();
  await expect(card.getByRole("img", { name: "Победитель: сторона B" })).toBeVisible();
  await expect(card).toContainText("13 мин");
  await expect(card).not.toContainText("Победитель: Александра / Борис");
  await expect(card).not.toContainText("Завершён");
  const longCard = page.locator(`a[href="/matches/${longResultId}"]`);
  await expect(longCard.getByRole("img", { name: "Победитель: сторона A" })).toBeVisible();
  await expect(longCard).not.toContainText("Завершён");
  const winnerStaysWithName = await longCard.locator(".home-event__side").first().evaluate((side) => {
    const name = side.firstChild;
    const mark = side.querySelector(".home-event__winner-mark");
    if (!name || !mark || name.nodeType !== Node.TEXT_NODE) return false;
    const lastWordStart = name.textContent?.lastIndexOf("Преображенский") ?? -1;
    if (lastWordStart < 0) return false;
    const lastWord = document.createRange();
    lastWord.setStart(name, lastWordStart);
    lastWord.setEnd(name, name.textContent!.length);
    return Math.abs(lastWord.getBoundingClientRect().top - mark.getBoundingClientRect().top) < 3;
  });
  expect(winnerStaysWithName).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("home-result-r2.png"), fullPage: true });
});

test("GAP-031 keeps overflow tasks collapsed until requested", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Пароль", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/$/);
  const home = (await (await page.request.get("/api/v1/home?period=all_time&recentRole=all&notificationView=available")).json());
  const currentTasks = ["Первая задача", "Вторая задача", "Третья задача"].map((title, index) => ({
    type: "match", id: `10000000-0000-4000-8000-00000000000${index + 1}`, title,
    status: "waiting", sideA: title, sideB: "Гость", scoreA: 0, scoreB: 0,
    currentRoles: ["organizer"], updatedAt: new Date().toISOString(), userRole: "organizer",
  }));
  await page.route(/\/api\/v1\/home\?/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...home, currentTasks }) }));
  await page.reload();
  await expect(page.getByText("Первая задача")).toBeVisible();
  await expect(page.getByText("Третья задача")).toBeHidden();
  expect(await page.locator("#home-more-tasks").evaluate((element) => getComputedStyle(element).display)).toBe("none");
  await page.getByRole("button", { name: "Ещё 1 текущее дело" }).click();
  await expect(page.getByText("Третья задача")).toBeVisible();
  expect(await page.locator("#home-more-tasks").evaluate((element) => getComputedStyle(element).display)).toBe("flex");
});

test("GAP-030 explicit Home releases judge slot; Browser Back is measured separately", async ({ page }, info) => {
  let matchPath: string | null = null;
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Пароль", { exact: true }).fill(adminPassword);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/matches/new");
    await page.getByLabel("Название").fill(`Stage 2 exit ${info.project.name}`);
    await expect(page.getByLabel("Создатель играет", { exact: true })).not.toBeChecked();
    await page.getByRole("group", { name: "Игрок A: тип участника", exact: true }).getByRole("button", { name: "Гость", exact: true }).click();
    await page.getByLabel("Игрок A — гость (Имя Фамилия)").fill("Гость Первый");
    await page.getByRole("group", { name: "Соперник: тип участника", exact: true }).getByRole("button", { name: "Гость", exact: true }).click();
    await page.getByLabel("Гость (Имя Фамилия)", { exact: true }).fill("Гость Второй");
    await page.getByRole("button", { name: "Создать матч" }).click();
    await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
    matchPath = new URL(page.url()).pathname;
    await page.getByRole("button", { name: "Судить" }).click();
    await expect(page.getByTestId("judge-setup")).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${matchPath}$`));
    const afterBrowserBack = await (await page.request.get(`/api/v1${matchPath}`)).json();
    info.annotations.push({ type: "browser-back-judge-slot", description: afterBrowserBack.match.activeJudge ? "slot remained active" : "slot released" });

    await page.goto(`${matchPath}/judge`);
    await expect(page.getByTestId("judge-setup")).toBeVisible();
    await page.getByRole("button", { name: "На главную" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Слот судьи освобождён. Другой пользователь может занять его сразу.")).toBeVisible();
    await expect.poll(async () => (await (await page.request.get(`/api/v1${matchPath}`)).json()).match.activeJudge).toBeNull();
  } finally {
    if (matchPath) {
      const current = (await (await page.request.get(`/api/v1${matchPath}`)).json()).match;
      if (current?.status === "waiting") {
        const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "tab10_csrf");
        const cancelled = await page.request.post(`/api/v1${matchPath}/cancel`, {
          data: { expectedVersion: current.version },
          headers: { ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {}), "idempotency-key": randomUUID() },
        });
        expect(cancelled.status(), await cancelled.text()).toBe(200);
        expect((await cancelled.json()).match.status).toBe("cancelled");
      }
    }
  }
});
