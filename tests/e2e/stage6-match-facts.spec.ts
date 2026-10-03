import { randomUUID } from "node:crypto";
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

const baseURL = process.env.TAB10_E2E_BASE_URL ?? "http://localhost:4273";
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";

async function mutationHeaders(api: APIRequestContext) {
  const csrf = (await api.storageState()).cookies.find((cookie) => cookie.name === "tab10_csrf");
  return {
    ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {}),
    "idempotency-key": randomUUID(),
  };
}

async function mutate(
  api: APIRequestContext,
  path: string,
  data: unknown,
  method: "POST" | "PATCH" = "POST",
) {
  const response = await api.fetch(path, { method, data, headers: await mutationHeaders(api) });
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBeLessThan(300);
  return response.json();
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(adminEmail);
  await page.getByLabel("Пароль", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/(?:onboarding)?$/);
  if (new URL(page.url()).pathname === "/onboarding") {
    await mutate(page.request, "/api/v1/me/onboarding", { action: "complete" }, "PATCH");
    await page.goto("/");
  }
}

test("GAP-032 shows authoritative first serve, playing clock, judge history and event provenance", async ({ page }, info) => {
  test.setTimeout(90_000);
  const admin = await request.newContext({ baseURL });
  let matchId: string | null = null;
  try {
    const loginResult = await mutate(admin, "/api/v1/auth/login", {
      email: adminEmail,
      password: adminPassword,
    });
    await mutate(admin, "/api/v1/me/onboarding", { action: "complete" }, "PATCH");
    const judgeDisplayName = `${loginResult.user.lastName} ${loginResult.user.firstName}`.trim();
    const { match } = await mutate(admin, "/api/v1/matches", {
      title: `GAP-032 facts ${info.project.name}`,
      format: "1v1",
      firstServerMethod: "manual",
      pointsToWin: 11,
      mercyEnabled: false,
      sendPlayerInvitations: false,
      participants: [
        { side: "A", userId: loginResult.user.id },
        { side: "B", guestFirstName: "Факты", guestLastName: "Соперник" },
      ],
    });
    matchId = match.id;
    const firstServer = match.participants.find((participant: { side: string }) => participant.side === "A");
    const participantDisplayName = firstServer.displayName;

    await login(page);
    await page.goto(`/matches/${match.id}/judge`);
    await expect(page.getByTestId("judge-setup")).toBeVisible();
    await page.getByRole("radio", { name: new RegExp(participantDisplayName) }).check();
    await page.getByRole("button", { name: "Начать матч", exact: true }).click();
    await expect(page.getByRole("group", { name: "Счёт матча", exact: true })).toBeVisible();
    await expect(page.locator(".judge-timer")).not.toHaveText("Время недоступно");
    await page.getByRole("button", { name: new RegExp(`\\+1 очко: ${participantDisplayName}`) }).click();
    await expect(page.getByTestId("judge-side-A").locator(".judge-side__score")).toHaveText("1");

    await page.goto(`/matches/${match.id}`);
    const facts = page.getByRole("group", { name: "Факты матча" });
    await expect(facts).toContainText(participantDisplayName);
    await expect(facts).not.toContainText("Игровое времяНедоступно");
    const history = page.getByRole("region", { name: "История судейства" });
    await expect(history).toContainText(judgeDisplayName);
    const journalEntry = page.getByRole("list", { name: "Журнал изменений счёта" }).getByRole("listitem").first();
    await expect(journalEntry).toContainText(judgeDisplayName);
    await expect(journalEntry.getByRole("time")).toHaveAttribute("datetime", /T/);

    const detail = (await (await admin.get(`/api/v1/matches/${match.id}`)).json()).match;
    expect(detail.matchFacts.initialServer).toEqual({
      state: "known",
      participantId: firstServer.id,
    });
    expect(detail.matchFacts.playingClock).toMatchObject({ state: "available", running: true });
    expect(detail.matchFacts.judgeHistory.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: loginResult.user.id, displayName: judgeDisplayName }),
    ]));
  } finally {
    if (matchId) {
      const response = await admin.get(`/api/v1/matches/${matchId}`);
      if (response.ok()) {
        const current = (await response.json()).match;
        if (["waiting", "in_progress", "pending_confirmation"].includes(current.status)) {
          await mutate(admin, `/api/v1/matches/${matchId}/stop`, {
            winnerSide: "A",
            reasonCode: "other",
            reasonText: "Синтетическая проверка GAP-032 завершена",
          });
        }
      }
    }
    await admin.dispose();
  }
});
