import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../../../..");
const output = import.meta.dirname;
const socket = createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const processLog = createWriteStream("/private/tmp/tab10-wo3-vite.log", { flags: "w" });
const child = spawn("pnpm", ["--filter", "@tab10/web", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root,
  env: { ...process.env, PATH: `/Users/liubavskii/.local/share/mise/installs/node/24.20.0/bin:${process.env.PATH ?? ""}`, VITE_API_BASE_URL: "", TAB10_API_PROXY_TARGET: "http://127.0.0.1:1" },
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.pipe(processLog);
child.stderr.pipe(processLog);
let browser;

const user = { id: "wo3-u1", email: "wo3@example.invalid", role: "user", mustChangePassword: false, firstName: "Тест", lastName: "Ведущий", onboardingCompletedAt: "2026-01-01T00:00:00Z" };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const failure = (route, code, message, status) => json(route, { code, message }, status);
const participantA = { id: "p-a", side: "A", guestFirstName: "Анна", guestLastName: "А" };
const participantB = { id: "p-b", side: "B", guestFirstName: "Борис", guestLastName: "Б" };
const baseMatch = { id: "m1", kind: "standalone", status: "waiting", createdByUserId: user.id, firstServerMethod: "manual", scoreA: 0, scoreB: 0, version: 0, startedAt: null, currentServerParticipantId: null, participants: [participantA, participantB] };
const baseTournament = { id: "t1", title: "Тестовый кубок", status: "collecting", format: "single_elimination", createdByUserId: user.id, requireParticipantConsent: false, organizerParticipates: true, pointsToWin: 11, mercyEnabled: false, mercyPoints: 2, bracketJson: null, participants: [
  { id: "p1", userId: user.id, displayName: "Тест Ведущий", status: "active" },
  { id: "p2", userId: "u2", displayName: "Борис Б", status: "active" },
  { id: "p3", userId: "u3", displayName: "Вера В", status: "active" },
  { id: "p4", guestFirstName: "Гость", guestLastName: "Г", displayName: "Гость Г", status: "active" },
], invitations: [], matches: [] };

async function context(width, height, handle) {
  const session = await browser.newContext({ viewport: { width, height } });
  await session.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/auth/me") return json(route, { user });
    await handle(route, url.pathname, route.request().method());
  });
  return session;
}

async function waitReady() {
  for (let n = 0; n < 120; n += 1) {
    try { if ((await fetch(`${origin}/login`)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Vite failed to start");
}

function contrast(foreground, background) {
  const rgb = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
  const luminance = (value) => rgb(value).map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const result = { viewportCases: [] };
try {
  await waitReady();
  browser = await chromium.launch({ headless: true });

  // Match creation: held request freezes the entire submitted form without hiding Cancel.
  let finishCreate;
  const matchPosts = [];
  const matchContext = await context(390, 844, async (route, pathname, method) => {
    if (pathname === "/api/v1/matches/create-options") return json(route, { users: [], teams: [], frequentOpponentIds: [], recentOpponentIds: [] });
    if (pathname === "/api/v1/matches" && method === "POST") {
      matchPosts.push(JSON.parse(route.request().postData()));
      await new Promise((resolve) => { finishCreate = resolve; });
      return failure(route, "VALIDATION", "Создание отклонено", 409);
    }
    return failure(route, "NOT_FOUND", "Synthetic route", 404);
  });
  const matchPage = await matchContext.newPage();
  await matchPage.goto(`${origin}/matches/new`);
  await matchPage.getByRole("form", { name: "Создание матча" }).waitFor();
  await matchPage.getByLabel("Создатель играет").check();
  await matchPage.getByRole("group", { name: "Соперник" }).getByRole("button", { name: "Гость" }).click();
  await matchPage.getByRole("textbox", { name: /Гость/ }).fill("Иван Иванов");
  await matchPage.getByRole("button", { name: "Создать матч" }).click();
  await expect(matchPage.getByRole("button", { name: "Создание…" })).toBeDisabled();
  const matchPending = { posts: matchPosts.length, payload: matchPosts[0], creatorDisabled: await matchPage.getByLabel("Создатель играет").isDisabled(), guestDisabled: await matchPage.getByRole("textbox", { name: /Гость/ }).isDisabled(), titleDisabled: await matchPage.getByRole("textbox", { name: "Название" }).isDisabled(), formatDisabled: await matchPage.getByRole("button", { name: "1 × 1" }).isDisabled(), cancelEnabled: await matchPage.getByRole("button", { name: "Отмена" }).isEnabled() };
  await matchPage.screenshot({ path: path.join(output, "match-pending-390.png") });
  finishCreate();
  await matchPage.getByText("Создание отклонено").waitFor();
  const matchRejected = { guest: await matchPage.getByRole("textbox", { name: /Гость/ }).inputValue(), enabled: await matchPage.getByRole("textbox", { name: /Гость/ }).isEnabled(), posts: matchPosts.length };
  await matchContext.close();
  result.matchCreate = { pending: matchPending, rejection: matchRejected };

  // A 503 response is deliberately treated as unknown, including after an early GET.
  for (const width of [360, 390, 1440]) {
    let bracketPosts = 0, reads = 0;
    const tournamentContext = await context(width, width === 1440 ? 900 : 844, async (route, pathname, method) => {
      if (pathname === "/api/v1/tournaments/t1" && method === "GET") { reads += 1; return json(route, { tournament: baseTournament }); }
      if (pathname === "/api/v1/users/directory") return json(route, { users: [] });
      if (pathname === "/api/v1/tournaments/t1/bracket" && method === "POST") { bracketPosts += 1; return failure(route, "SERVICE_UNAVAILABLE", "Ответ сервера не получен", 503); }
      return failure(route, "NOT_FOUND", "Synthetic route", 404);
    });
    const page = await tournamentContext.newPage();
    await page.goto(`${origin}/tournaments/t1`);
    await page.getByText("Тестовый кубок").first().waitFor({ timeout: 8000 });
    await page.getByTestId("tournament-build-bracket").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("bracket-algo-card-power_of_two").click();
    await dialog.getByRole("button", { name: "Построить сетку" }).click();
    await dialog.getByRole("alert").waitFor();
    const beforeCheck = reads;
    await dialog.getByRole("button", { name: "Проверить состояние" }).click();
    await expect.poll(() => reads).toBeGreaterThan(beforeCheck);
    const confirmButton = dialog.getByRole("button", { name: "Построить сетку" });
    const bracket = { width, posts: bracketPosts, reads, alertInDialog: await dialog.getByRole("alert").count() === 1, alertFocusedInside: await dialog.evaluate((element) => element.contains(document.activeElement)), algorithmRetained: await dialog.getByRole("radio", { name: /Классическая сетка/ }).isChecked(), confirmDisabled: await confirmButton.isDisabled(), footerInitiallyVisible: await confirmButton.evaluate((element) => element.getBoundingClientRect().bottom <= innerHeight), horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) };
    await page.screenshot({ path: path.join(output, `bracket-unknown-${width}.png`) });
    await confirmButton.scrollIntoViewIfNeeded();
    bracket.footerReachable = await confirmButton.evaluate((element) => { const rect = element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; });
    await page.screenshot({ path: path.join(output, `bracket-footer-${width}.png`) });
    await dialog.getByRole("button", { name: "Отмена" }).click();
    await page.getByTestId("tournament-build-bracket").click();
    bracket.reopenDisabled = await page.getByRole("dialog").getByRole("button", { name: "Построить сетку" }).isDisabled();
    bracket.postsAfterReopen = bracketPosts;
    await page.keyboard.press("Tab");
    bracket.tabInside = await page.getByRole("dialog").evaluate((element) => element.contains(document.activeElement));
    await page.keyboard.press("Shift+Tab");
    bracket.shiftTabInside = await page.getByRole("dialog").evaluate((element) => element.contains(document.activeElement));
    await page.keyboard.press("Escape");
    bracket.escapeClosed = await page.getByRole("dialog").count() === 0;
    bracket.focusReturned = await page.getByTestId("tournament-build-bracket").evaluate((element) => element === document.activeElement);
    bracket.focusAfterEscape = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.trim().slice(0, 80), testId: document.activeElement?.getAttribute("data-testid") }));
    await tournamentContext.close();
    result.viewportCases.push(bracket);
  }

  // Manual roster add: the chosen player remains visible while held, and success reads back from the synthetic store.
  let finishAdd;
  let roster = structuredClone(baseTournament);
  const addPosts = [];
  const rosterContext = await context(390, 844, async (route, pathname, method) => {
    if (pathname === "/api/v1/tournaments/t1" && method === "GET") return json(route, { tournament: roster });
    if (pathname === "/api/v1/users/directory") return json(route, { users: [{ id: "u4", displayName: "Галина Игрок", firstName: "Галина", lastName: "Игрок" }] });
    if (pathname === "/api/v1/tournaments/t1/participants" && method === "POST") {
      addPosts.push(JSON.parse(route.request().postData()));
      if (addPosts.length === 1) { await new Promise((resolve) => { finishAdd = resolve; }); return failure(route, "VALIDATION", "Добавление отклонено", 409); }
      roster = { ...roster, participants: [...roster.participants, { id: "p5", userId: "u4", displayName: "Галина Игрок", status: "active" }] };
      return json(route, { participant: roster.participants.at(-1), tournament: roster });
    }
    return failure(route, "NOT_FOUND", "Synthetic route", 404);
  });
  const rosterPage = await rosterContext.newPage();
  rosterPage.on("dialog", (dialog) => dialog.accept());
  await rosterPage.goto(`${origin}/tournaments/t1`);
  await rosterPage.getByText("Тестовый кубок").first().waitFor({ timeout: 8000 });
  const picker = rosterPage.getByRole("combobox", { name: "Добавить игрока" });
  await expect(picker).toBeEnabled();
  await picker.fill("Галина");
  await rosterPage.getByRole("option", { name: "Галина Игрок" }).click();
  await rosterPage.getByRole("button", { name: "Добавить в состав" }).click();
  await expect(picker).toBeDisabled();
  const addPending = { posts: addPosts.length, payload: addPosts[0], value: await picker.inputValue(), disabled: await picker.isDisabled() };
  await rosterPage.screenshot({ path: path.join(output, "roster-add-pending-390.png") });
  finishAdd();
  await rosterPage.getByText("Добавление отклонено").waitFor();
  const addRejected = { value: await picker.inputValue(), enabled: await picker.isEnabled(), posts: addPosts.length };
  await rosterPage.getByRole("button", { name: "Добавить в состав" }).click();
  await expect.poll(() => addPosts.length).toBe(2);
  await rosterPage.getByRole("button", { name: "Обновить" }).click();
  await rosterPage.getByText("Галина Игрок").first().waitFor();
  result.manualRoster = { pending: addPending, rejected: addRejected, posts: addPosts.length, persistedPlayer: roster.participants.some((person) => person.userId === "u4"), visiblePlayer: await rosterPage.getByText("Галина Игрок").count() > 0 };
  await rosterContext.close();

  // Start succeeds, judge setup is held, then a definitive rejection permits only an explicit setup retry.
  let finishSetup;
  let judgeMatch = structuredClone(baseMatch);
  const judgeRequests = { start: [], setup: [] };
  const judgeContext = await context(390, 844, async (route, pathname, method) => {
    if (pathname === "/api/v1/matches/m1" && method === "GET") return json(route, { match: judgeMatch });
    if (pathname === "/api/v1/matches/m1/judge/acquire" || pathname === "/api/v1/matches/m1/judge/heartbeat") return json(route, { ok: true });
    if (pathname === "/api/v1/matches/m1/start" && method === "POST") {
      judgeRequests.start.push(JSON.parse(route.request().postData()));
      judgeMatch = { ...judgeMatch, status: "in_progress", currentServerParticipantId: "p-b" };
      return json(route, { match: judgeMatch });
    }
    if (pathname === "/api/v1/matches/m1/judge/setup" && method === "POST") {
      judgeRequests.setup.push(JSON.parse(route.request().postData()));
      if (judgeRequests.setup.length === 1) { await new Promise((resolve) => { finishSetup = resolve; }); return failure(route, "VALIDATION", "Выберите подающего", 400); }
      judgeMatch = { ...judgeMatch, startedAt: "2026-01-01T00:00:00Z", currentServerParticipantId: "p-a" };
      return json(route, { match: judgeMatch });
    }
    return failure(route, "NOT_FOUND", "Synthetic route", 404);
  });
  const judgePage = await judgeContext.newPage();
  await judgePage.goto(`${origin}/matches/m1/judge`);
  await judgePage.getByTestId("judge-setup").waitFor();
  await judgePage.getByRole("radio", { name: /Борис/ }).check();
  await judgePage.getByRole("button", { name: "Начать матч" }).click();
  await expect.poll(() => judgeRequests.setup.length).toBe(1);
  const judgePending = { start: judgeRequests.start.length, setup: judgeRequests.setup.length, firstServerDisabled: await judgePage.getByRole("radio", { name: /Борис/ }).isDisabled(), swapDisabled: await judgePage.getByRole("button", { name: "Поменять стороны" }).isDisabled(), boardDisabled: await judgePage.getByTestId("judge-side-A").getAttribute("aria-disabled"), cancelDisabled: await judgePage.getByRole("button", { name: "Отмена" }).isDisabled(), payload: judgeRequests.setup[0] };
  await judgePage.screenshot({ path: path.join(output, "judge-setup-pending-390.png") });
  finishSetup();
  await judgePage.getByRole("alert").getByText("Выберите подающего").waitFor();
  await judgePage.getByRole("radio", { name: /Анна/ }).check();
  await judgePage.getByRole("button", { name: "Начать матч" }).click();
  await expect.poll(() => judgeRequests.setup.length).toBe(2);
  result.judgeSetup = { pending: judgePending, afterRetry: judgeRequests };
  await judgeContext.close();

  // The actual immersive shell owns the error background and correction labels.
  for (const width of [360, 390, 1440]) {
    const match = { ...baseMatch, id: "m2", status: "in_progress", scoreA: 3, scoreB: 2, version: 5, startedAt: "2026-01-01T00:00:00Z", currentServerParticipantId: "p-a" };
    const scoringContext = await context(width, width === 1440 ? 900 : 844, async (route, pathname, method) => {
      if (pathname === "/api/v1/matches/m2" && method === "GET") return json(route, { match });
      if (pathname === "/api/v1/matches/m2/judge/acquire" || pathname === "/api/v1/matches/m2/judge/heartbeat") return json(route, { ok: true });
      if (pathname === "/api/v1/matches/m2/points" && method === "POST") return failure(route, "SERVICE_UNAVAILABLE", "Очко не подтверждено", 503);
      return failure(route, "NOT_FOUND", "Synthetic route", 404);
    });
    const page = await scoringContext.newPage();
    await page.goto(`${origin}/matches/m2/judge`);
    await page.getByTestId("judge-screen").waitFor();
    await page.getByRole("button", { name: /\+1 очко/ }).first().click();
    const error = page.locator(".judge-error");
    await error.waitFor();
    const colors = await error.evaluate((element) => ({ text: getComputedStyle(element).color, background: getComputedStyle(document.querySelector(".app-shell--immersive")).backgroundColor, role: element.getAttribute("role") }));
    await page.getByRole("button", { name: "Ещё" }).click();
    await page.getByRole("button", { name: "Исправить счёт и подачу" }).click();
    const labels = await page.locator(".judge-correction__label").evaluateAll((elements) => elements.map((element) => ({ text: element.textContent, color: getComputedStyle(element).color, background: getComputedStyle(element.closest(".judge-correction")).backgroundColor, forId: element.getAttribute("for"), linked: element.control?.id === element.getAttribute("for") })));
    await page.getByText("Счёт стороны A", { exact: true }).click();
    const clickFocus = await page.getByRole("spinbutton", { name: "Счёт стороны A" }).evaluate((element) => document.activeElement === element);
    await page.screenshot({ path: path.join(output, `judge-error-correction-${width}.png`) });
    result.viewportCases.push({ width, judgeError: { ...colors, ratio: contrast(colors.text, colors.background) }, correctionLabels: labels.map((label) => ({ ...label, ratio: contrast(label.color, label.background) })), clickFocus, horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) });
    await scoringContext.close();
  }

  await writeFile(path.join(output, "browser-results.json"), JSON.stringify(result, null, 2) + "\n");
  if (!result.matchCreate.pending.creatorDisabled || !result.matchCreate.pending.guestDisabled || !result.matchCreate.pending.titleDisabled || !result.matchCreate.pending.formatDisabled || !result.matchCreate.pending.cancelEnabled || result.matchCreate.rejection.guest !== "Иван Иванов") throw new Error("Match pending contract failed");
  if (result.manualRoster.pending.posts !== 1 || result.manualRoster.pending.payload.userId !== "u4" || result.manualRoster.pending.value !== "Галина Игрок" || !result.manualRoster.pending.disabled || !result.manualRoster.rejected.enabled || result.manualRoster.rejected.value !== "Галина Игрок" || result.manualRoster.posts !== 2 || !result.manualRoster.persistedPlayer || !result.manualRoster.visiblePlayer) throw new Error("Manual roster contract failed");
  if (result.viewportCases.some((item) => item.confirmDisabled === false || item.reopenDisabled === false || item.postsAfterReopen > 1 || item.tabInside === false || item.shiftTabInside === false || item.escapeClosed === false || item.focusReturned === false || item.horizontalOverflow || item.footerReachable === false || item.judgeError?.ratio < 4.5 || item.correctionLabels?.some((label) => label.ratio < 4.5 || !label.linked) || item.clickFocus === false)) throw new Error("Dialog/Judge viewport contract failed");
  if (result.judgeSetup.pending.start !== 1 || result.judgeSetup.pending.setup !== 1 || !result.judgeSetup.pending.firstServerDisabled || !result.judgeSetup.pending.swapDisabled || result.judgeSetup.pending.boardDisabled !== "true" || !result.judgeSetup.pending.cancelDisabled || result.judgeSetup.afterRetry.start.length !== 1 || result.judgeSetup.afterRetry.setup.length !== 2) throw new Error("Judge setup contract failed");
  process.stdout.write(JSON.stringify(result) + "\n");
} finally {
  await browser?.close();
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already stopped */ }
  processLog.end();
}
