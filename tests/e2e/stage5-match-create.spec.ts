import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, request, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const baseURL = process.env.TAB10_E2E_BASE_URL ?? "http://localhost:4273";
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";
const evidenceDir = process.env.VERIFY_EVIDENCE_DIR ?? path.join("/private/tmp", "tab10-stage5-browser");

async function mutationHeaders(api: APIRequestContext) {
  const csrf = (await api.storageState()).cookies.find((cookie) => cookie.name === "tab10_csrf");
  return {
    ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {}),
    "idempotency-key": randomUUID(),
  };
}

async function mutate(api: APIRequestContext, method: "POST" | "PATCH", url: string, data: unknown = {}) {
  const response = await api.fetch(url, { method, data, headers: await mutationHeaders(api) });
  expect(response.status(), `${method} ${url}: ${await response.text()}`).toBeLessThan(300);
  return response.json();
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(adminEmail);
  await page.getByLabel("Пароль", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/(?:onboarding)?$/);
  await mutate(page.request, "PATCH", "/api/v1/me/onboarding", { action: "complete" });
  if (new URL(page.url()).pathname === "/onboarding") await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
}

async function createActiveUser(admin: APIRequestContext, label: string, index: number) {
  const fixtureId = randomUUID().slice(0, 8);
  const email = `stage5-${label}-${fixtureId}@tab10.test`;
  const firstName = `Игрок${index}-${fixtureId.slice(0, 4)}`;
  const lastName = `${label} СверхдлиннаяФамилияДляПроверкиПереноса`;
  const created = await mutate(admin, "POST", "/api/v1/admin/users", { email, firstName, lastName });
  const actor = await request.newContext({ baseURL });
  await mutate(actor, "POST", "/api/v1/auth/login", {
    email,
    password: created.temporaryPassword,
  });
  await mutate(actor, "POST", "/api/v1/auth/password/first-change", {
    newPassword: "Stage5Fixture9!",
  });
  await mutate(actor, "PATCH", "/api/v1/me/onboarding", { action: "complete" });
  return { context: actor, user: created.user, name: `${firstName} ${lastName}` };
}

async function choosePlayer(page: Page, field: string, name: string) {
  const input = page.getByRole("combobox", { name: field, exact: true });
  await input.fill(name);
  await page.getByRole("option", { name, exact: true }).click();
}

async function expectNoDocumentOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function measuredContrast(locator: Locator) {
  return locator.evaluate((element) => {
    const parse = (value: string) => {
      const channels = (value.match(/[\d.]+/g) ?? []).map(Number);
      return { r: channels[0] ?? 0, g: channels[1] ?? 0, b: channels[2] ?? 0, a: channels[3] ?? 1 };
    };
    const linear = (value: number) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    };
    const luminance = ({ r, g, b }: ReturnType<typeof parse>) =>
      0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    const foregroundCss = getComputedStyle(element).color;
    let surface: Element | null = element;
    let backgroundCss = "rgb(255, 255, 255)";
    while (surface) {
      const candidate = getComputedStyle(surface).backgroundColor;
      if (parse(candidate).a >= 0.99) {
        backgroundCss = candidate;
        break;
      }
      surface = surface.parentElement;
    }
    const foreground = luminance(parse(foregroundCss));
    const background = luminance(parse(backgroundCss));
    return {
      foreground: foregroundCss,
      background: backgroundCss,
      ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
    };
  });
}

test("Stage 5 keeps the operator outside a long 2x2 roster and preserves an unknown create", async ({ page }, info) => {
  test.setTimeout(120_000);
  const admin = await request.newContext({ baseURL });
  const users: Awaited<ReturnType<typeof createActiveUser>>[] = [];
  const screenshots = path.join(evidenceDir, "screenshots");
  await mkdir(screenshots, { recursive: true });
  try {
    await mutate(admin, "POST", "/api/v1/auth/login", { email: adminEmail, password: adminPassword });
    for (const [index, label] of ["Альфа", "Бета", "Гамма", "Дельта"].entries()) {
      users.push(await createActiveUser(admin, label, index + 1));
    }
    const { team } = await mutate(admin, "POST", "/api/v1/teams", {
      name: `Команда Stage5 ${info.project.name}`,
    });
    for (const member of users.slice(2)) {
      const { invitation } = await mutate(admin, "POST", `/api/v1/teams/${team.id}/invite`, {
        userId: member.user.id,
      });
      await mutate(member.context, "POST", `/api/v1/team-invitations/${invitation.id}/respond`, {
        accept: true,
      });
    }

    await login(page);
    await page.goto("/matches/new");
    await expect(page.getByRole("form", { name: "Создание матча" })).toBeVisible();
    await expect(page.getByLabel("Создатель играет", { exact: true })).not.toBeChecked();
    const participantType = page.getByRole("group", { name: "Игрок A: тип участника", exact: true });
    await participantType.getByRole("button", { name: "Гость", exact: true }).click();
    const guestContrast = await measuredContrast(participantType.getByRole("button", { name: "Гость", exact: true }));
    await writeFile(
      path.join(evidenceDir, `stage5-selected-contrast-${info.project.name}.json`),
      `${JSON.stringify(guestContrast, null, 2)}\n`,
    );
    expect(guestContrast.ratio).toBeGreaterThanOrEqual(4.5);
    await participantType.getByRole("button", { name: "Игрок", exact: true }).click();
    await page.getByRole("button", { name: "2 × 2", exact: true }).click();
    await choosePlayer(page, "Игрок A", users[0]!.name);
    await choosePlayer(page, "Партнёр", users[1]!.name);

    await page.getByRole("button", { name: `Команда Stage5 ${info.project.name}`, exact: true }).click();
    const preview = page.getByRole("region", { name: "Предпросмотр быстрого выбора" });
    await expect(preview).toContainText("B1:");
    await expect(preview).toContainText("B2:");
    await expect(preview).toContainText(users[2]!.name);
    await expect(preview).toContainText(users[3]!.name);
    await preview.getByRole("button", { name: "Применить", exact: true }).click();

    await page.getByRole("button", { name: "Изменить правила", exact: true }).click();
    await page.getByRole("group", { name: "Очков до победы", exact: true }).getByRole("button", { name: "Своё", exact: true }).click();
    const customPoints = page.getByLabel("Своё значение", { exact: true });
    const mercy = page.getByLabel("Порог", { exact: true });
    await customPoints.fill("12");
    await expect(mercy).toHaveValue("6");
    await page.getByRole("button", { name: "Увеличить очки до победы", exact: true }).click();
    await page.getByRole("button", { name: "Уменьшить очки до победы", exact: true }).click();
    await expect(customPoints).toHaveValue("12");
    await mercy.fill("4");
    await page.getByRole("button", { name: "Увеличить очки до победы", exact: true }).click();
    await expect(mercy).toHaveValue("4");
    await page.getByRole("button", { name: "Уменьшить очки до победы", exact: true }).click();

    await customPoints.fill("0");
    await page.getByRole("button", { name: "Скрыть правила", exact: true }).click();
    await page.getByRole("button", { name: "Создать матч", exact: true }).click();
    await expect(customPoints).toBeFocused();
    await expect(page.getByRole("alert")).toContainText("положительным целым числом");
    await customPoints.fill("12");
    await expect(page.getByText(/До 12 · сухая 4:0 · первая подача вручную/)).toBeVisible();

    await expectNoDocumentOverflow(page);
    await page.screenshot({
      path: path.join(screenshots, `stage5-long-2v2-${info.project.name}.png`),
      fullPage: true,
    });

    let postCount = 0;
    let holdSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => { holdSecond = resolve; });
    let secondSeen!: () => void;
    const secondRequest = new Promise<void>((resolve) => { secondSeen = resolve; });
    await page.route(/\/api\/v1\/matches$/, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      postCount += 1;
      if (postCount === 1) return route.abort("connectionfailed");
      secondSeen();
      await secondGate;
      return route.continue();
    });

    await page.getByRole("button", { name: "Создать матч", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Игрок A", exact: true })).toHaveValue(users[0]!.name);
    expect(postCount).toBe(1);

    const createAgain = page.getByRole("button", { name: "Создать матч", exact: true }).click();
    await secondRequest;
    await expect(page.getByRole("button", { name: "Создание…", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Создатель играет", { exact: true })).toBeDisabled();
    holdSecond();
    await createAgain;
    await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
    expect(postCount).toBe(2);

    const matchId = page.url().split("/").at(-1)!;
    const response = await admin.get(`/api/v1/matches/${matchId}`);
    expect(response.status(), await response.text()).toBe(200);
    const match = (await response.json()).match;
    expect(match).toMatchObject({
      format: "2v2",
      pointsToWin: 12,
      mercyEnabled: true,
      mercyPoints: 4,
      createdByUserId: expect.any(String),
    });
    expect(match.participants).toHaveLength(4);
    expect(
      match.participants
        .filter((participant: { side?: string }) => participant.side === "B")
        .map((participant: { userId?: string }) => participant.userId)
        .sort(),
    ).toEqual([users[2]!.user.id, users[3]!.user.id].sort());
    expect(match.participants.some((participant: { userId?: string }) => participant.userId === match.createdByUserId)).toBe(false);
  } finally {
    await Promise.all(users.map((entry) => entry.context.dispose()));
    await admin.dispose();
  }
});

test("Stage 5 keeps one 401 mutation and returns to authentication", async ({ page }) => {
  await login(page);
  await page.goto("/matches/new");
  await page.getByLabel("Создатель играет", { exact: true }).check();
  await page.getByRole("group", { name: "Соперник", exact: true }).getByRole("button", { name: "Гость", exact: true }).click();
  await page.getByLabel("Гость (Имя Фамилия)", { exact: true }).fill("Синтетический Соперник");
  let postCount = 0;
  await page.route(/\/api\/v1\/matches$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    postCount += 1;
    return route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ code: "UNAUTHORIZED", message: "Сессия истекла" }),
    });
  });
  await page.getByRole("button", { name: "Создать матч", exact: true }).click();
  await expect(page).toHaveURL(/\/matches\/new$/);
  await expect(page.getByRole("heading", { name: "Вход", exact: true })).toBeVisible();
  await expect(page.getByText("Сессия завершена. Войдите снова, чтобы продолжить с этого места.")).toBeVisible();
  expect(postCount).toBe(1);
});
