import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Page, type Request } from "@playwright/test";

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";

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
}

function shortGuestNumber(id: string) {
  return id.replace(/[^0-9a-z]/gi, "").slice(-6).toUpperCase();
}

function frozenAttempt(request: Request) {
  return {
    body: request.postDataJSON(),
    key: request.headers()["idempotency-key"],
  };
}

test("GAP-040 saves, reuses, replays and renames an exact guest identity", async ({ page }, info) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  const firstName = `Гость${suffix}`;
  const lastName = "Повторяемый";
  const originalName = `${lastName} ${firstName}`;
  // Match participants keep the original match snapshot, including its display order.
  const historicalName = `${firstName} ${lastName}`;
  const screenshotDirectory = join(process.env.VERIFY_EVIDENCE_DIR ?? test.info().outputDir, "screenshots");
  await mkdir(screenshotDirectory, { recursive: true });
  const renamedFirstName = `Новый${suffix}`;
  const renamedName = `${lastName} ${renamedFirstName}`;
  let matchId: string | null = null;
  let tournamentId: string | null = null;

  try {
    await login(page);
    await page.goto("/guests");

  const createAttempts: Array<{ body: unknown; key: string | undefined }> = [];
  await page.route(/\/api\/v1\/guests$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    createAttempts.push(frozenAttempt(route.request()));
    if (createAttempts.length === 1) return route.abort("connectionfailed");
    return route.continue();
  });

  await page.getByRole("button", { name: "Создать гостя", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "Новый сохранённый гость", exact: true });
  await createDialog.getByLabel("Имя", { exact: true }).fill(firstName);
  await createDialog.getByLabel("Фамилия", { exact: true }).fill(lastName);
  await createDialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(createDialog.getByText("Статус сохранения неизвестен", { exact: true })).toBeVisible();
  await createDialog.getByRole("button", { name: "Проверить статус", exact: true }).click();
  await expect(createDialog.getByText("Статус сохранения неизвестен", { exact: true })).toBeVisible();
  await createDialog.getByRole("button", { name: "Повторить ту же попытку", exact: true }).click();
  await expect(createDialog).toBeHidden();
  expect(createAttempts).toHaveLength(2);
  expect(createAttempts[1]).toEqual(createAttempts[0]);
  await page.unroute(/\/api\/v1\/guests$/);

  await page.getByRole("button", { name: "Создать гостя", exact: true }).click();
  const secondDialog = page.getByRole("dialog", { name: "Новый сохранённый гость", exact: true });
  await secondDialog.getByLabel("Имя", { exact: true }).fill(firstName);
  await secondDialog.getByLabel("Фамилия", { exact: true }).fill(lastName);
  await secondDialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(secondDialog).toBeHidden();

  const catalogueResponse = await page.request.get(`/api/v1/guests?q=${encodeURIComponent(firstName)}&limit=50`);
  expect(catalogueResponse.status(), await catalogueResponse.text()).toBe(200);
  const catalogue = (await catalogueResponse.json()) as { guests: Array<{ id: string; displayName: string }> };
  const sameNameGuests = catalogue.guests.filter((guest) => guest.displayName === originalName);
  expect(sameNameGuests).toHaveLength(2);
  expect(new Set(sameNameGuests.map((guest) => guest.id)).size).toBe(2);
  const selectedGuest = sameNameGuests[1]!;
  const selectedRecord = `№ ${shortGuestNumber(selectedGuest.id)}`;
  await expect(page.getByRole("listitem").filter({ hasText: originalName })).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: join(screenshotDirectory, `${info.project.name}-guest-catalogue.png`), fullPage: true });


  await page.goto("/matches/new");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Настройки матча", exact: true });
  await settings.getByLabel("Создатель играет", { exact: true }).check();
  await settings.getByRole("button", { name: "Готово", exact: true }).click();

  const opponent = page.getByRole("group", { name: "Соперник", exact: true });
  await opponent.getByRole("button", { name: "Гость", exact: true }).click();
  await opponent.getByRole("button", { name: "Сохранённый", exact: true }).click();
  const guestPicker = opponent.getByRole("combobox", { name: "Соперник — сохранённый гость", exact: true });
  await expect(guestPicker).toBeEnabled();
  await guestPicker.click();
  await opponent.getByRole("option", { name: `${originalName} · ${selectedRecord}`, exact: true }).click();


  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: join(screenshotDirectory, `${info.project.name}-guest-match-draft.png`), fullPage: true });
  const sideA = await page.locator(".match-create__side").first().boundingBox();
  const sideB = await page.locator(".match-create__side").last().boundingBox();
  if (page.viewportSize()!.width <= 720) {
    expect(sideB!.y).toBeGreaterThanOrEqual(sideA!.y + sideA!.height);
    expect(sideB!.width).toBeGreaterThan(page.viewportSize()!.width - 50);
  }
  const launchRequest = page.waitForRequest((request) =>
    request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/matches/launches",
  );
  await page.getByRole("button", { name: "Начать", exact: true }).click();
  await page.getByRole("button", { name: /Подаёт первым/ }).first().click();
  const launch = await launchRequest;
  expect(launch.postDataJSON()).toMatchObject({
    roster: { B1: { guestIdentityId: selectedGuest.id } },
  });
  expect(launch.postDataJSON()).not.toMatchObject({
    roster: { B1: { guestFirstName: expect.anything() } },
  });
  await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+\/judge$/);
  matchId = page.url().split("/").at(-2) ?? null;
  expect(matchId).toBeTruthy();

  await mutate(page.request, `/api/v1/matches/${matchId}/stop`, {
    winnerSide: "A",
    reasonCode: "other",
    reasonText: "Синтетическая проверка GAP-040 завершена",
  });
  const savedMatch = await page.request.get(`/api/v1/matches/${matchId}`);
  expect(savedMatch.status()).toBe(200);
  expect((await savedMatch.json()).match.participants).toEqual(expect.arrayContaining([expect.objectContaining({ guestIdentityId: selectedGuest.id, displayName: historicalName })]));
  await page.goto(`/matches/${matchId}`);
  await page.getByRole("button", { name: "Сыграть снова", exact: true }).click();
  await expect(page).toHaveURL(/\/matches\/new$/);
  await expect(page.getByTestId("selected-guest")).toContainText(historicalName);
  await expect(page.getByTestId("selected-guest")).toContainText(selectedRecord);

  await page.goto(`/guests/${selectedGuest.id}`);
  const historicalRow = page.getByRole("listitem").filter({ hasText: originalName }).first();
  await expect(historicalRow).toBeVisible();
  await page.getByRole("button", { name: "Переименовать", exact: true }).click();
  const renameDialog = page.getByRole("dialog", { name: "Переименовать гостя", exact: true });
  await renameDialog.getByLabel("Имя", { exact: true }).fill(renamedFirstName);
  await renameDialog.getByRole("button", { name: "Сохранить имя", exact: true }).click();
  await expect(renameDialog).toBeHidden();
  await expect(page.getByRole("region", { name: "Карточка гостя", exact: true })).toContainText(renamedName);
  await expect(historicalRow).toContainText(originalName);
  await page.screenshot({ path: join(screenshotDirectory, `${info.project.name}-guest-card-history.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);


  const createdTournament = await mutate(page.request, "/api/v1/tournaments", {
    title: `GAP-040 ${suffix}`,
    format: "single_elimination",
    organizerParticipates: true,
    pointsToWin: 11,
    mercyEnabled: false,
    mercyPoints: null,
    requireParticipantConsent: false,
  }) as { tournament: { id: string } };
  tournamentId = createdTournament.tournament.id;
  await page.goto(`/tournaments/${tournamentId}`);
  const roster = page.getByRole("heading", { name: /Шаг 2 из 3 · Состав/ }).locator("..");
  await roster.getByRole("group", { name: "Тип участника", exact: true }).getByRole("button", { name: "Гость", exact: true }).click();
  await roster.getByRole("group", { name: "Вид гостя", exact: true }).getByRole("button", { name: "Сохранённый", exact: true }).click();
  const tournamentPicker = roster.getByRole("combobox", { name: "Добавить сохранённого гостя", exact: true });
  await expect(tournamentPicker).toBeEnabled();
  await tournamentPicker.click();
  await roster.getByRole("option", { name: `${renamedName} · ${selectedRecord}`, exact: true }).click();
  const participantRequest = page.waitForRequest((request) =>
    request.method() === "POST" && new URL(request.url()).pathname === `/api/v1/tournaments/${tournamentId}/participants`,
  );
  await roster.getByRole("button", { name: "Добавить гостя в состав", exact: true }).click();
  expect((await participantRequest).postDataJSON()).toEqual({ guestIdentityId: selectedGuest.id });
    await expect(page.getByText("Гость добавлен", { exact: true })).toBeVisible();
  } finally {
    if (tournamentId) {
      const current = await page.request.get(`/api/v1/tournaments/${tournamentId}`);
      if (current.ok()) {
        const status = ((await current.json()) as { tournament: { status: string } }).tournament.status;
        if (["collecting", "needs_regeneration", "bracket_generated"].includes(status)) {
          await mutate(page.request, `/api/v1/tournaments/${tournamentId}/cancel`);
        }
      }
    }
    if (matchId) {
      const current = await page.request.get(`/api/v1/matches/${matchId}`);
      if (current.ok()) {
        const status = ((await current.json()) as { match: { status: string } }).match.status;
        if (["in_progress", "pending_confirmation"].includes(status)) {
          await mutate(page.request, `/api/v1/matches/${matchId}/stop`, {
            winnerSide: "A",
            reasonCode: "other",
            reasonText: "Очистка синтетической проверки GAP-040",
          });
        }
      }
    }
  }
});
