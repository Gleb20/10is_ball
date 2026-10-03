import { expect, test, type Page } from "@playwright/test";

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(adminEmail);
  await page.getByLabel("Пароль", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "tab10_csrf");
  const onboarding = await page.request.patch("/api/v1/me/onboarding", {
    data: { action: "complete" },
    headers: csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {},
  });
  expect(onboarding.status(), await onboarding.text()).toBe(200);
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("BUG-036 keeps invalid drafts and reviews an unknown save with GET only", async ({ page }, info) => {
  test.setTimeout(60_000);
  await login(page);
  const initial = (await (await page.request.get("/api/v1/profile/me")).json()).profile.identity as {
    firstName: string;
    lastName: string;
    birthDate?: string | null;
    organizationText?: string | null;
    positionText?: string | null;
  };
  const organization = `Stage 10 ${info.project.name}`;
  let patchRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && new URL(request.url()).pathname === "/api/v1/profile/me") {
      patchRequests += 1;
    }
  });

  try {
    await page.goto("/profile");
    await page.getByRole("button", { name: "Редактировать профиль", exact: true }).click();
    const form = page.getByRole("form", { name: "Редактирование профиля", exact: true });
    const organizationField = form.getByLabel("Организация", { exact: true });
    const invalidDraft = "Я".repeat(201);
    await organizationField.fill(invalidDraft);
    await form.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(organizationField).toBeFocused();
    await expect(organizationField).toHaveAttribute("aria-invalid", "true");
    await expect(organizationField).toHaveValue(invalidDraft);
    await expect(form.getByText(/Не более 200 символов/)).toBeVisible();
    expect(patchRequests).toBe(0);
    if (info.project.name.includes("mobile")) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: info.outputPath("stage10-profile-local-error-mobile-390.png"),
        fullPage: true,
      });
    }

    await organizationField.fill(organization);
    await page.route(/\/api\/v1\/profile\/me$/, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    });
    await form.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(form.getByText("Не удалось проверить сохранение", { exact: true })).toBeVisible();
    await expect(form.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
    await expect(organizationField).toHaveValue(organization);
    expect(patchRequests).toBe(1);

    const reviewResponse = page.waitForResponse((response) =>
      response.request().method() === "GET" && new URL(response.url()).pathname === "/api/v1/profile/me",
    );
    await form.getByRole("button", { name: "Обновить данные", exact: true }).click();
    expect((await reviewResponse).status()).toBe(200);
    await expect(form.getByText("Данные обновлены", { exact: true })).toBeVisible();
    expect(patchRequests).toBe(1);
    const persisted = (await (await page.request.get("/api/v1/profile/me")).json()).profile.identity;
    expect(persisted.organizationText).toBe(organization);

    await expectNoOverflow(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(form).toBeVisible();
    await expectNoOverflow(page);
  } finally {
    await page.unroute(/\/api\/v1\/profile\/me$/);
    const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "tab10_csrf");
    const restored = await page.request.patch("/api/v1/profile/me", {
      data: {
        firstName: initial.firstName,
        lastName: initial.lastName,
        birthDate: initial.birthDate ?? null,
        organizationText: initial.organizationText ?? null,
        positionText: initial.positionText ?? null,
      },
      headers: csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {},
    });
    expect(restored.status(), await restored.text()).toBe(200);
  }
});

test("BUG-037 applies confirmed reads, preserves partial rows, terminal state, and focus", async ({ page }) => {
  await login(page);
  const readAt = "2026-09-19T12:00:00.000Z";
  let releaseRead!: () => void;
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  let requestedIds: string[] = [];

  await page.route(/\/api\/v1\/notifications\?notificationView=available$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        notificationView: "available",
        unreadCount: 3,
        notifications: [
          { id: "plain", type: "account_access_changed", title: "Обычное", body: "Подтверждаем чтение", lifecycle: "new", actionable: false, readAt: null },
          { id: "team", type: "team_invitation", title: "Команда", body: "Действие остаётся", lifecycle: "new", actionable: true, readAt: null, payload: { invitationId: "synthetic-team-invite" } },
          { id: "omitted", type: "account_access_changed", title: "Не подтверждено", body: "Сервер пропустил строку", lifecycle: "new", actionable: false, readAt: null },
          { id: "terminal", type: "team_invitation", title: "Завершённое", body: "Ответ уже принят", lifecycle: "accepted", actionable: false, readAt, lifecycleAt: readAt, payload: { invitationId: "terminal-invite" } },
        ],
      }),
    }),
  );
  await page.route(/\/api\/v1\/notifications\/read-visible\?notificationView=available$/, async (route) => {
    requestedIds = (route.request().postDataJSON() as { notificationIds: string[] }).notificationIds;
    await readGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        updated: 2,
        notifications: ["plain", "team"].map((id) => ({ id, readAt })),
      }),
    });
  });

  await page.goto("/notifications");
  const plainRead = page.getByRole("group", { name: "Обычное", exact: true })
    .getByRole("button", { name: "Отметить прочитанным", exact: true });
  await expect(plainRead).toBeVisible();
  plainRead.focus();
  await expect(plainRead).toBeFocused();
  releaseRead();

  await expect(page.getByRole("group", { name: "Обычное", exact: true })).toHaveCount(0);
  await expect(page.getByText(/не удалось подтвердить чтение части уведомлений/i)).toBeVisible();
  const team = page.getByRole("group", { name: "Команда", exact: true });
  await expect(team).toBeFocused();
  await expect(team.getByText("Прочитано", { exact: true })).toBeVisible();
  await expect(team.getByRole("button", { name: "Принять", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Не подтверждено", exact: true })
    .getByText("Новое", { exact: true })).toBeVisible();
  expect(requestedIds.sort()).toEqual(["omitted", "plain", "team"]);

  await page.getByLabel("Актуальные", { exact: true }).uncheck();
  const terminal = page.getByRole("group", { name: "Завершённое", exact: true });
  await expect(terminal.getByText("Принято", { exact: true })).toBeVisible();
  await expect(terminal.getByRole("button", { name: /Принять|Отклонить/ })).toHaveCount(0);
  await expectNoOverflow(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(team).toBeVisible();
  await expect(terminal).toBeVisible();
  await expectNoOverflow(page);
});
