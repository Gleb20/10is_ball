import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, request, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const baseURL = process.env.TAB10_E2E_BASE_URL ?? "http://localhost:4273";
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";
const evidenceDir = process.env.VERIFY_EVIDENCE_DIR ?? path.join("/private/tmp", "tab10-stage6-browser");

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

async function createActiveOpponent(
  admin: APIRequestContext,
  firstName: string,
  lastName: string,
) {
  const email = `stage6-${randomUUID().slice(0, 8)}@tab10.test`;
  const created = await mutate(admin, "POST", "/api/v1/admin/users", {
    email,
    firstName,
    lastName,
  });
  const actor = await request.newContext({ baseURL });
  await mutate(actor, "POST", "/api/v1/auth/login", { email, password: created.temporaryPassword });
  await mutate(actor, "POST", "/api/v1/auth/password/first-change", { newPassword: "Stage6Fixture9!" });
  await mutate(actor, "PATCH", "/api/v1/me/onboarding", { action: "complete" });
  return { actor, user: created.user };
}

async function expectBoardGeometry(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const sideA = page.getByTestId("judge-side-A");
  const sideB = page.getByTestId("judge-side-B");
  const boxes = await Promise.all([
    sideA.boundingBox(),
    sideB.boundingBox(),
  ]);
  expect(boxes[0]).not.toBeNull();
  expect(boxes[1]).not.toBeNull();
  expect(Math.abs(boxes[0]!.width - boxes[1]!.width)).toBeLessThanOrEqual(2);
  const sameRow = Math.abs(boxes[0]!.y - boxes[1]!.y) <= 1;
  if (sameRow) {
    expect(Math.abs(boxes[0]!.height - boxes[1]!.height)).toBeLessThanOrEqual(2);
    const scores = await Promise.all([
      sideA.locator(".judge-side__score").boundingBox(),
      sideB.locator(".judge-side__score").boundingBox(),
    ]);
    expect(scores[0]).not.toBeNull();
    expect(scores[1]).not.toBeNull();
    expect(Math.abs(scores[0]!.y - scores[1]!.y)).toBeLessThanOrEqual(1);
  }
  for (const side of [sideA, sideB]) {
    const nameMetrics = await side.locator(".judge-side__name").evaluate((element) => {
      const name = element.getBoundingClientRect();
      const card = element.parentElement!.getBoundingClientRect();
      return {
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        leftInset: name.left - card.left,
        rightInset: card.right - name.right,
      };
    });
    expect(nameMetrics.scrollWidth).toBeLessThanOrEqual(nameMetrics.clientWidth + 1);
    expect(nameMetrics.leftInset).toBeGreaterThanOrEqual(0);
    expect(nameMetrics.rightInset).toBeGreaterThanOrEqual(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  return { sameRow, boxes };
}

async function measuredElementContrast(locator: Locator) {
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

async function suppressGesture(button: Locator, kind: "move" | "cancel") {
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  const base = { pointerId: 31, pointerType: "touch", clientX: box!.x + 20, clientY: box!.y + 20 };
  await button.dispatchEvent("pointerdown", base);
  if (kind === "move") {
    await button.dispatchEvent("pointermove", { ...base, clientY: base.clientY + 24 });
    await button.dispatchEvent("pointerup", { ...base, clientY: base.clientY + 24 });
  } else {
    await button.dispatchEvent("pointercancel", base);
  }
  await button.dispatchEvent("click", { detail: 1 });
}

test("Stage 6 uses the whole score side without scroll taps and keeps dialogs readable", async ({ page }, info) => {
  test.setTimeout(120_000);
  const screenshots = path.join(evidenceDir, "screenshots");
  await mkdir(screenshots, { recursive: true });
  const admin = await request.newContext({ baseURL });
  const participantContexts: APIRequestContext[] = [];
  let matchId: string | undefined;
  try {
    const loginResult = await mutate(admin, "POST", "/api/v1/auth/login", { email: adminEmail, password: adminPassword });
    const partnerFixture = await createActiveOpponent(admin, "Короткий", "Партнёр");
    const opponentOneFirstName = "ОченьДлинноеИмяПервогоСоперникаБезПробелов";
    const opponentOneLastName = "ДляПроверкиПолногоПереносаБезГоризонтальнойОбрезки";
    const opponentTwoFirstName = "Очень длинное имя второго соперника";
    const opponentTwoLastName = "С предельно длинной фамилией для проверки переноса";
    const opponentOneFixture = await createActiveOpponent(
      admin,
      opponentOneFirstName,
      opponentOneLastName,
    );
    const opponentTwoFixture = await createActiveOpponent(
      admin,
      opponentTwoFirstName,
      opponentTwoLastName,
    );
    participantContexts.push(
      partnerFixture.actor,
      opponentOneFixture.actor,
      opponentTwoFixture.actor,
    );
    const { match } = await mutate(admin, "POST", "/api/v1/matches", {
      title: `Stage6 ${info.project.name}`,
      format: "2v2",
      firstServerMethod: "manual",
      pointsToWin: 11,
      mercyEnabled: false,
      sendPlayerInvitations: false,
      participants: [
        { side: "A", userId: loginResult.user.id },
        { side: "A", userId: partnerFixture.user.id },
        { side: "B", userId: opponentOneFixture.user.id },
        { side: "B", userId: opponentTwoFixture.user.id },
      ],
    });
    matchId = match.id;

    await login(page);
    await page.goto(`/matches/${match.id}/judge`);
    await expect(page.getByTestId("judge-setup")).toBeVisible();
    await page.getByRole("radio", { name: /Tab10 Admin/ }).check();
    await page.getByRole("button", { name: "Начать матч", exact: true }).click();
    await expect(page.getByRole("group", { name: "Счёт матча", exact: true })).toBeVisible();

    const sideA = page.getByTestId("judge-side-A");
    const sideB = page.getByTestId("judge-side-B");
    const sideBName = sideB.locator(".judge-side__name");
    await expect(sideBName).toContainText(opponentOneFirstName);
    await expect(sideBName).toContainText(opponentOneLastName);
    await expect(sideBName).toContainText(opponentTwoFirstName);
    await expect(sideBName).toContainText(opponentTwoLastName);
    await expect(sideA).toHaveRole("button");
    await expectBoardGeometry(page);
    await suppressGesture(sideA, "move");
    await suppressGesture(sideA, "cancel");
    await expect(sideA.locator(".judge-side__score")).toHaveText("0");

    await sideA.evaluate((node) => {
      for (let index = 0; index < 5; index += 1) (node as HTMLButtonElement).click();
    });
    await expect(sideA.locator(".judge-side__score")).toHaveText("5");
    const afterRapid = (await (await admin.get(`/api/v1/matches/${match.id}`)).json()).match;
    expect(afterRapid.scoreA).toBe(5);

    await page.screenshot({
      path: path.join(screenshots, `stage6-score-${info.project.name}.png`),
      fullPage: true,
    });

    await page.getByRole("button", { name: "Ещё", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Действия судьи" })).toBeVisible();
    await page.getByRole("button", { name: "Исправить счёт и подачу", exact: true }).click();
    const correction = page.getByRole("dialog", { name: "Ручная коррекция" });
    await expect(correction).toBeVisible();
    await expect(correction.getByRole("heading", { name: "Ручная коррекция" })).toBeFocused();
    const scoreAInput = correction.getByLabel("Счёт стороны A", { exact: true });
    const labelContrast = await measuredElementContrast(correction.locator(".judge-correction__label").first());
    expect(labelContrast.ratio).toBeGreaterThanOrEqual(4.5);
    const valueContrasts: Record<string, Awaited<ReturnType<typeof measuredElementContrast>>> = {};
    valueContrasts.normal = await measuredElementContrast(scoreAInput);
    await scoreAInput.focus();
    valueContrasts.focused = await measuredElementContrast(scoreAInput);
    await scoreAInput.fill("10");
    valueContrasts.filled = await measuredElementContrast(scoreAInput);
    await scoreAInput.evaluate((input) => { (input as HTMLInputElement).disabled = true; });
    valueContrasts.nativeDisabledStyleProbe = await measuredElementContrast(scoreAInput);
    await scoreAInput.evaluate((input) => { (input as HTMLInputElement).disabled = false; });
    await correction.getByLabel("Счёт стороны B", { exact: true }).fill("9");
    await page.screenshot({
      path: path.join(screenshots, `stage6-correction-${info.project.name}.png`),
      fullPage: true,
    });
    await scoreAInput.fill("-1");
    await correction.getByRole("button", { name: "Сохранить коррекцию", exact: true }).click();
    const validationError = correction.getByRole("alert");
    await expect(validationError).toHaveText("Введите целое неотрицательное значение для стороны A.");
    valueContrasts.runtimeValidationErrorValue = await measuredElementContrast(scoreAInput);
    const errorTextContrast = await measuredElementContrast(validationError);
    expect(errorTextContrast.ratio).toBeGreaterThanOrEqual(4.5);
    for (const measured of Object.values(valueContrasts)) expect(measured.ratio).toBeGreaterThanOrEqual(4.5);
    await writeFile(
      path.join(evidenceDir, `stage6-correction-contrast-${info.project.name}.json`),
      `${JSON.stringify({
        label: labelContrast,
        values: valueContrasts,
        runtimeValidationErrorText: errorTextContrast,
        probes: { nativeDisabled: { componentRuntimeState: false } },
      }, null, 2)}\n`,
    );
    await scoreAInput.fill("10");
    await correction.getByRole("button", { name: "Сохранить коррекцию", exact: true }).click();
    await expect(correction).toHaveCount(0);
    await expect(sideA.locator(".judge-side__score")).toHaveText("10");

    await sideA.click();
    const confirmation = page.getByRole("dialog", { name: "Подтвердить результат?" });
    await expect(confirmation).toBeVisible();
    const modalLayer = confirmation.locator("xpath=..");
    await expect(modalLayer).toHaveCSS("backdrop-filter", "blur(4px)");
    const scoreBeforeDecision = await sideA.locator(".judge-side__score").boundingBox();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(confirmation).toHaveCSS("animation-name", "none");
    expect(await sideA.locator(".judge-side__score").boundingBox()).toEqual(scoreBeforeDecision);

    await expect(confirmation.getByRole("button", { name: "Подтвердить результат", exact: true })).toBeVisible();
    await expect(confirmation.getByRole("button", { name: "Продолжить", exact: true })).toBeVisible();
    await confirmation.getByRole("button", { name: "Продолжить", exact: true }).click();
    await expect(confirmation).toHaveCount(0);

    await page.setViewportSize({ width: 844, height: 390 });
    const landscapeGeometry = await expectBoardGeometry(page);
    expect(landscapeGeometry.sameRow).toBe(true);
    await page.screenshot({
      path: path.join(screenshots, `stage6-landscape-${info.project.name}.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile390Geometry = await expectBoardGeometry(page);
    expect(mobile390Geometry.sameRow).toBe(true);
    await page.setViewportSize({ width: 360, height: 800 });
    const mobile360Geometry = await expectBoardGeometry(page);
    expect(mobile360Geometry.sameRow).toBe(true);
    await page.evaluate(() => { document.documentElement.style.zoom = "200%"; });
    const zoomGeometry = await expectBoardGeometry(page);
    expect(zoomGeometry.sameRow).toBe(false);
    const zoomName = await sideB.locator(".judge-side__name").boundingBox();
    expect(zoomName).not.toBeNull();
    expect(zoomName!.width).toBeGreaterThanOrEqual(140);
    const zoomFontSize = await sideB.locator(".judge-side__name").evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(zoomName!.width / zoomFontSize).toBeGreaterThanOrEqual(8);
    await page.screenshot({
      path: path.join(screenshots, `stage6-css-zoom-200-${info.project.name}.png`),
      fullPage: true,
    });
    await page.evaluate(() => { document.documentElement.style.zoom = ""; });
    await expectBoardGeometry(page);

    expect(sideB).toBeVisible();
  } finally {
    if (matchId) {
      const response = await admin.get(`/api/v1/matches/${matchId}`);
      if (response.status() < 300) {
        const current = (await response.json()).match;
        if (current.status === "waiting") {
          await mutate(admin, "POST", `/api/v1/matches/${matchId}/cancel`, {
            expectedVersion: current.version,
          });
        } else if (current.status === "in_progress" || current.status === "pending_confirmation") {
          await mutate(admin, "POST", `/api/v1/matches/${matchId}/stop`, {
            winnerSide: "A",
            reasonCode: "other",
            reasonText: "Синтетическая Stage 6 проверка завершена",
          });
        }
      }
    }
    await Promise.all([admin.dispose(), ...participantContexts.map((context) => context.dispose())]);
  }
});
