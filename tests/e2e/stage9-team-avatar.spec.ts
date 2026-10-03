import { expect, request, test, type APIRequestContext } from "@playwright/test";

const baseURL = process.env.TAB10_E2E_BASE_URL ?? "http://localhost:4273";
const email = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const password = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";

async function login(api: APIRequestContext) {
  const response = await api.post("/api/v1/auth/login", {
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  const csrf = (await api.storageState()).cookies.find((cookie) => cookie.name === "tab10_csrf")!;
  expect((await api.patch("/api/v1/me/onboarding", { data: { action: "complete" }, headers: { "x-csrf-token": decodeURIComponent(csrf.value), "idempotency-key": crypto.randomUUID() } })).status()).toBe(200);
}

test("GAP-025 team avatar create, edit, clear, fallback and unknown-outcome review", async ({ page }, info) => {
  const api = await request.newContext({ baseURL });
  const name = `ГАП Аватар ${info.project.name}`;
  await login(api);

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.route("**/avatars/avatar_7.png", (route) => route.abort("failed"));
    await page.goto("/teams");
    await page.getByRole("button", { name: "Создать команду", exact: true }).click();
    await page.getByLabel("Название команды", { exact: true }).fill(name);

    const avatarSeven = page.getByRole("radio", { name: "Аватар 7" });
    await avatarSeven.focus();
    await page.keyboard.press("Space");
    await expect(avatarSeven).toBeChecked();
    const target = await avatarSeven.locator("xpath=..").boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(64);
    expect(target?.height).toBeGreaterThanOrEqual(64);

    await page.getByRole("button", { name: "Создать", exact: true }).click();
    await page.getByRole("link", { name: new RegExp(name) }).click();
    const teamId = page.url().split("/").at(-1)!;

    const about = page.getByRole("region", { name: "О команде" });
    await expect(about.locator("img")).toHaveCount(0);
    await expect(about.getByText("ГА", { exact: true })).toBeVisible();
    expect((await (await api.get(`/api/v1/teams/${teamId}`)).json()).team.avatarKey)
      .toBe("avatar_7");

    const settings = page.getByRole("form", { name: "Редактирование команды" });
    await settings.getByRole("radio", { name: "Аватар 4" }).locator("xpath=..").click();
    await settings.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(settings.getByText("Изменения сохранены.", { exact: true })).toBeVisible();
    expect((await (await api.get(`/api/v1/teams/${teamId}`)).json()).team.avatarKey)
      .toBe("avatar_4");

    await settings.getByRole("radio", { name: "Без аватара" }).locator("xpath=..").click();
    await settings.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(settings.getByText("Изменения сохранены.", { exact: true })).toBeVisible();
    expect((await (await api.get(`/api/v1/teams/${teamId}`)).json()).team.avatarKey)
      .toBeNull();

    let patchCount = 0;
    await page.route(`**/api/v1/teams/${teamId}`, async (route) => {
      if (route.request().method() === "PATCH") {
        patchCount += 1;
        await route.abort("connectionfailed");
        return;
      }
      await route.continue();
    });
    await settings.getByRole("radio", { name: "Аватар 5" }).locator("xpath=..").click();
    await settings.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(settings.getByRole("alert")).toContainText("Не удалось проверить сохранение");
    await expect(settings.getByRole("radio", { name: "Аватар 5" })).toBeChecked();
    await settings.getByRole("button", { name: "Обновить данные", exact: true }).click();
    expect(patchCount).toBe(1);
    await expect(settings.getByText(/Сервер сейчас:/)).toContainText("аватар не выбран");
    await expect(settings.getByRole("radio", { name: "Аватар 5" })).toBeChecked();
  } finally {
    await api.dispose();
  }
});
