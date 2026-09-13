import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";
const baseURL = process.env.TAB10_E2E_BASE_URL ?? "http://localhost:4273";
const email = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const password = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";
let sequence = 0;
async function mutate(api: APIRequestContext, path: string, data: unknown = {}, method = "POST") {
  const cookie = (await api.storageState()).cookies.find((c) => c.name === "tab10_csrf");
  const response = await api.fetch(path, { method, data, headers: { ...(cookie ? { "x-csrf-token": decodeURIComponent(cookie.value) } : {}), "idempotency-key": `dddddddd-0000-4000-8000-${String(++sequence).padStart(12, "0")}` } });
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBeLessThan(300);
  return response.json();
}
async function login(page: Page) {
  await page.goto("/login"); await page.getByLabel("Email").fill(email); await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click(); await expect(page).toHaveURL(/\/$/);
}
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }

for (const format of ["single_elimination", "double_elimination"] as const) for (const size of [3, 5, 8]) {
  test(`Wave D tournament ${format}/${size} roster, seed edit, complete and results`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const api = await request.newContext({ baseURL });
    expect((await (await api.get("/health")).json()).release.environment).toBe("test");
    await mutate(api, "/api/v1/auth/login", { email, password });
    await mutate(api, "/api/v1/me/onboarding", { action: "complete" }, "PATCH");
    const title = `D ${format} ${size} ${info.project.name}`;
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    try {
      await login(page); await page.goto("/tournaments");
      await page.getByLabel("Название", { exact: true }).fill(title);
      if (format === "double_elimination") await page.getByRole("button", { name: "Double", exact: true }).click();
      await page.getByRole("button", { name: "Создать", exact: true }).click();
      await expect(page).toHaveURL(/\/tournaments\/[0-9a-f-]+$/);
      const id = page.url().split("/").at(-1)!;
      // One roster addition through the UI; remaining synthetic fixtures use the same API.
      await page.getByLabel("Добавить гостя (Имя Фамилия)").fill("Гость Первый");
      await page.getByRole("button", { name: "Добавить гостя", exact: true }).click();
      await expect(page.getByText("Гость добавлен", { exact: true })).toBeVisible();
      for (let n = 2; n < size; n++) await mutate(api, `/api/v1/tournaments/${id}/participants`, { guestFirstName: `Гость${n}`, guestLastName: "Синтетический" });
      await mutate(api, `/api/v1/tournaments/${id}`, { pointsToWin: 3, mercyEnabled: true, mercyPoints: 1 }, "PATCH");
      await page.reload();
      await page.getByTestId("tournament-build-bracket").click();
      await page.getByRole("dialog").getByRole("button", { name: "Построить сетку", exact: true }).click();
      await expect(page.getByRole("button", { name: "Старт", exact: true })).toBeVisible();
      const generated = (await (await api.get(`/api/v1/tournaments/${id}`)).json()).tournament;
      await page.getByLabel("Первая позиция", { exact: true }).selectOption("seed:1");
      await page.getByLabel("Вторая позиция", { exact: true }).selectOption(`seed:${size}`);
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Поменять позиции", exact: true }).click();
      await expect.poll(async () => (await (await api.get(`/api/v1/tournaments/${id}`)).json()).tournament.bracketJson.seedOrder[0]).toBe(generated.bracketJson.seedOrder[size - 1]);
      await noOverflow(page);
      await page.screenshot({ path: info.outputPath("tournament-generated.png"), fullPage: true });
      if (info.project.name.includes("mobile")) {
        await page.setViewportSize({ width: 844, height: 390 }); await noOverflow(page);
        await page.screenshot({ path: info.outputPath("tournament-landscape.png"), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await page.getByRole("button", { name: "Старт", exact: true }).click();
      let tournament = (await (await api.get(`/api/v1/tournaments/${id}`)).json()).tournament;
      await expect.poll(async () => (await (await api.get(`/api/v1/tournaments/${id}`)).json()).tournament.status).toBe("in_progress");
      const completed = new Set<string>();
      for (let step = 0; step < 40; step++) {
        tournament = (await (await api.get(`/api/v1/tournaments/${id}`)).json()).tournament;
        if (tournament.status === "finished") break;
        const next = tournament.matches.find((m: { id: string; status: string }) => m.status === "waiting" && !completed.has(m.id));
        expect(next, `Tournament stalled at ${step}`).toBeTruthy();
        let match = (await (await api.get(`/api/v1/matches/${next.id}`)).json()).match;
        await mutate(api, `/api/v1/matches/${next.id}/judge/acquire`);
        match = (await mutate(api, `/api/v1/matches/${next.id}/start`, { firstServerParticipantId: match.participants[0].id })).match;
        match = (await mutate(api, `/api/v1/matches/${next.id}/points`, { side: "A", expectedVersion: match.version })).match;
        expect(match.status).toBe("pending_confirmation");
        await mutate(api, `/api/v1/matches/${next.id}/confirm-finish`);
        completed.add(next.id);
      }
      tournament = (await (await api.get(`/api/v1/tournaments/${id}`)).json()).tournament;
      expect(tournament.status).toBe("finished");
      expect(tournament.summary.playedMatchCount).toBe(completed.size);
      expect(tournament.summary.results.reduce((sum: number, row: { points: number }) => sum + row.points, 0)).toBe(completed.size);
      expect(tournament.summary.top3).toHaveLength(3);
      await page.reload(); await expect(page.getByRole("heading", { name: "Итоги", exact: true })).toBeVisible();
      await expect(page.getByText(/Призовые места:/)).toBeVisible();
      await expect(page.getByText(/Следующий матч:/)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Старт", exact: true })).toHaveCount(0);
      await noOverflow(page); await page.screenshot({ path: info.outputPath("tournament-finished.png"), fullPage: true });
      expect(errors).toEqual([]);
    } finally { await api.dispose(); }
  });
}

test("Wave D tournament invalidation, dissolve, cancel and reasoned stop", async ({ page }, info) => {
  test.setTimeout(90_000);
  const api = await request.newContext({ baseURL });
  expect((await (await api.get("/health")).json()).release.environment).toBe("test");
  await mutate(api, "/api/v1/auth/login", { email, password });
  await mutate(api, "/api/v1/me/onboarding", { action: "complete" }, "PATCH");
  async function draft(suffix: string) {
    const { tournament } = await mutate(api, "/api/v1/tournaments", { title: `D ${suffix} ${info.project.name}`, organizerParticipates: true });
    for (let n = 0; n < 2; n++) await mutate(api, `/api/v1/tournaments/${tournament.id}/participants`, { guestFirstName: `Гость${n}`, guestLastName: suffix });
    await mutate(api, `/api/v1/tournaments/${tournament.id}/bracket`, { constructionAlgorithm: "compact" });
    return tournament.id as string;
  }
  try {
    await login(page);
    const id = await draft("draft");
    await page.goto(`/tournaments/${id}`);
    await page.getByRole("button", { name: "Выйти из турнира", exact: true }).click();
    await expect.poll(async () => (await (await api.get(`/api/v1/tournaments/${id}`)).json()).tournament.status).toBe("needs_regeneration");
    await expect(page.getByRole("button", { name: "Старт", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Распустить сетку", exact: true }).click();
    await expect.poll(async () => (await (await api.get(`/api/v1/tournaments/${id}`)).json()).tournament.status).toBe("collecting");
    await page.getByTestId("tournament-cancel").click();
    await expect.poll(async () => (await (await api.get(`/api/v1/tournaments/${id}`)).json()).tournament.status).toBe("cancelled");
    const stopping = await draft("stop");
    await page.goto(`/tournaments/${stopping}`);
    await page.getByRole("button", { name: "Старт", exact: true }).click();
    await page.getByRole("button", { name: "Остановить турнир", exact: true }).click();
    await expect(page.getByRole("button", { name: "Подтвердить остановку", exact: true })).toBeDisabled();
    await page.getByLabel("Причина остановки", { exact: true }).fill("Завершено время синтетической проверки");
    await page.getByRole("button", { name: "Подтвердить остановку", exact: true }).click();
    await expect.poll(async () => (await (await api.get(`/api/v1/tournaments/${stopping}`)).json()).tournament.status).toBe("stopped");
    const stopped = (await (await api.get(`/api/v1/tournaments/${stopping}`)).json()).tournament;
    expect(stopped.stopReasonText).toBe("Завершено время синтетической проверки");
    expect(stopped.summary.top3).toEqual([]); expect(stopped.summary.results.every((row: { place: number | null }) => row.place === null)).toBe(true);
    expect(stopped.matches.every((m: { status: string }) => m.status === "cancelled")).toBe(true);
    await page.reload(); await expect(page.getByText("Причина остановки: Завершено время синтетической проверки", { exact: true })).toBeVisible();
    await noOverflow(page); await page.screenshot({ path: info.outputPath("tournament-stopped.png"), fullPage: true });
  } finally { await api.dispose(); }
});
