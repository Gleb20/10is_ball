import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";
const evidenceDir = process.env.VERIFY_EVIDENCE_DIR ?? path.join("/private/tmp", "tab10-stage7-browser");

async function mutationHeaders(api: APIRequestContext) {
  const csrf = (await api.storageState()).cookies.find((cookie) => cookie.name === "tab10_csrf");
  return {
    ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {}),
    "idempotency-key": randomUUID(),
  };
}

async function mutate(api: APIRequestContext, path: string, data: unknown = {}) {
  const response = await api.post(path, { data, headers: await mutationHeaders(api) });
  expect(response.status(), `POST ${path}: ${await response.text()}`).toBeLessThan(300);
  return response.json();
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(adminEmail);
  await page.getByLabel("Пароль", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/(?:onboarding)?$/);
  const onboarding = await page.request.patch("/api/v1/me/onboarding", {
    data: { action: "complete" },
    headers: await mutationHeaders(page.request),
  });
  expect(onboarding.status(), await onboarding.text()).toBe(200);
  if (new URL(page.url()).pathname === "/onboarding") await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
}

async function expectNoPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("Stage 7 rules, roster, direct add, and bracket step stay authoritative", async ({ page }, info) => {
  test.setTimeout(90_000);
  const screenshots = path.join(evidenceDir, "screenshots");
  await mkdir(screenshots, { recursive: true });
  let tournamentId: string | null = null;
  const suffix = `${info.project.name}-${randomUUID().slice(0, 8)}`;
  const candidateLastName = `Candidate ${suffix} WithAVeryLongSurnameForRosterWrapping`;
  const candidateName = `${candidateLastName} Stage7`;
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });

  try {
    await login(page);
    const createdUser = await mutate(page.request, "/api/v1/admin/users", {
      email: `stage7-candidate-${suffix}@tab10.test`,
      firstName: "Stage7",
      lastName: candidateLastName,
    });

    await page.goto("/tournaments/new");
    await expect(page.getByRole("heading", { name: "Шаг 1 из 3 · Правила" })).toBeVisible();
    await page.getByLabel("Название", { exact: true }).fill(`Stage 7 ${suffix}`);
    await page.getByLabel("Плановая дата (необязательно)", { exact: true }).fill("2028-02-29");
    await page.getByRole("group", { name: "Сетка проигравших" }).getByRole("button", { name: "Включена" }).click();
    await page.getByLabel("Очков для победы", { exact: true }).fill("15");
    await page.getByRole("checkbox", { name: "Завершать матч при сухом счёте" }).check();
    await page.getByLabel("Очков для сухой победы", { exact: true }).fill("5");
    await page.getByRole("button", { name: "Создать", exact: true }).click();
    await expect(page).toHaveURL(/\/tournaments\/[0-9a-f-]+$/);
    tournamentId = new URL(page.url()).pathname.split("/").at(-1) ?? null;
    expect(tournamentId).toBeTruthy();

    const created = (await (await page.request.get(`/api/v1/tournaments/${tournamentId}`)).json()).tournament;
    expect(created).toMatchObject({
      id: tournamentId,
      status: "collecting",
      format: "double_elimination",
      pointsToWin: 15,
      mercyEnabled: true,
      mercyPoints: 5,
      requireParticipantConsent: false,
      plannedDate: "2028-02-29",
      startedAt: null,
    });

    const rules = page.getByRole("heading", { name: "Шаг 1 из 3 · Правила" });
    const roster = page.getByRole("heading", { name: /Шаг 2 из 3 · Состав/ });
    const bracket = page.getByRole("heading", { name: "Шаг 3 из 3 · Сетка" });
    await expect(rules).toBeVisible();
    await expect(roster).toBeVisible();
    await expect(bracket).toBeVisible();
    expect(await page.evaluate(() => {
      const rulesHeading = document.getElementById("tournament-rules-heading");
      const rosterHeading = document.getElementById("tournament-roster-heading");
      const bracketHeading = document.getElementById("tournament-bracket-step-heading");
      if (!rulesHeading || !rosterHeading || !bracketHeading) return false;
      return Boolean(
        rulesHeading.compareDocumentPosition(rosterHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
      ) && Boolean(
        rosterHeading.compareDocumentPosition(bracketHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    })).toBe(true);

    const participantKind = page.getByRole("group", { name: "Тип участника", exact: true });
    const guestKind = participantKind.getByRole("button", { name: "Гость", exact: true });
    await guestKind.focus();
    await guestKind.press("Enter");
    await expect(guestKind).toHaveAttribute("aria-pressed", "true");
    const participantList = page.locator(".tournament-setup__roster");
    const guestToggle = page.getByRole("button", { name: "Добавить разового гостя" });
    await guestToggle.focus();
    await expect(guestToggle).toBeFocused();
    await guestToggle.press("Enter");
    await expect(page.getByLabel("Имя и фамилия разового гостя")).toBeVisible();

    expect(await guestToggle.evaluate((node, list) => Boolean(node.compareDocumentPosition(list as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await participantList.elementHandle())).toBe(true);
    await participantKind.getByRole("button", { name: "Игрок", exact: true }).click();
    const picker = page.getByRole("combobox", { name: "Добавить игрока" });
    await expect(picker).toBeVisible();
    await expect(picker).toBeEnabled();
    await expect(guestToggle).toHaveCount(0);
    expect(await picker.evaluate((node, list) => Boolean(node.compareDocumentPosition(list as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await participantList.elementHandle())).toBe(true);
    await picker.fill(candidateName);
    await page.getByRole("option", { name: candidateName, exact: true }).click();
    await page.getByRole("button", { name: "Добавить в состав", exact: true }).click();
    await expect(page.getByText("Игрок добавлен", { exact: true })).toBeVisible();
    expect(dialogs).toEqual([]);

    const afterAdd = (await (await page.request.get(`/api/v1/tournaments/${tournamentId}`)).json()).tournament;
    expect(afterAdd.status).toBe("collecting");
    expect(afterAdd.participants).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: createdUser.user.id, status: "active" }),
    ]));

    await expect(page.getByText(/Плановая дата: 29 февраля 2028/)).toBeVisible();
    await page.getByRole("button", { name: "Изменить правила", exact: true }).click();
    const plannedDate = page.getByLabel("Плановая дата (необязательно)", { exact: true });
    await plannedDate.focus();
    await expect(plannedDate).toBeFocused();
    await plannedDate.fill("2028-03-01");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByText(/Плановая дата: 1 марта 2028/)).toBeVisible();
    const afterDate = (await (await page.request.get(`/api/v1/tournaments/${tournamentId}`)).json()).tournament;
    expect(afterDate).toMatchObject({ plannedDate: "2028-03-01", status: "collecting", startedAt: null, bracketStateVersion: afterAdd.bracketStateVersion });
    expect(afterDate.participants).toEqual(afterAdd.participants);

    const candidateRow = page.locator(".tournament-setup__roster-item", { hasText: candidateName });
    const removeCandidate = candidateRow.getByRole("button", { name: `Удалить ${candidateName} из состава` });
    await expect(removeCandidate.locator("svg")).toBeVisible();
    await expect(removeCandidate).not.toContainText("Удалить");

    for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await expectNoPageOverflow(page);
      await expect(rules).toBeVisible();
      await expect(roster).toBeVisible();
      await expect(bracket).toBeVisible();
      const [rowBox, buttonBox] = await Promise.all([candidateRow.boundingBox(), removeCandidate.boundingBox()]);
      expect(rowBox).not.toBeNull();
      expect(buttonBox).not.toBeNull();
      expect(buttonBox!.width).toBeGreaterThanOrEqual(44);
      expect(buttonBox!.height).toBeGreaterThanOrEqual(44);
      expect(buttonBox!.y).toBeGreaterThanOrEqual(rowBox!.y);
      expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(rowBox!.y + rowBox!.height + 1);
      await page.screenshot({
        path: path.join(screenshots, `stage7-setup-${info.project.name}-${viewport.width}.png`),
        fullPage: true,
      });
    }
  } finally {
    if (tournamentId) {
      const current = (await (await page.request.get(`/api/v1/tournaments/${tournamentId}`)).json()).tournament;
      if (["collecting", "needs_regeneration", "bracket_generated"].includes(current.status)) {
        await mutate(page.request, `/api/v1/tournaments/${tournamentId}/cancel`);
      }
    }
  }
});
