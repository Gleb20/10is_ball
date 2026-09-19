import { createRequire } from "node:module";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = "/Users/liubavskii/.codex/worktrees/c870/tab10";
const require = createRequire(path.join(root, "package.json"));
const { chromium } = require("@playwright/test");
const bracketLib = await import(pathToFileURL(path.join(root, "packages/shared/dist/bracket-v2/index.js")).href);
const output = "/private/tmp/tab10-wo4-check";
await mkdir(output, { recursive: true });
const socket = createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const previewLog = createWriteStream(path.join(output, "preview.log"), { flags: "w" });
const child = spawn("pnpm", ["--filter", "@tab10/web", "exec", "vite", "preview", "--outDir", path.join(output, "dist"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root,
  env: { ...process.env, PATH: `/Users/liubavskii/.local/share/mise/installs/node/24.20.0/bin:${process.env.PATH ?? ""}`, VITE_API_BASE_URL: "", TAB10_API_PROXY_TARGET: "http://127.0.0.1:1" },
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.pipe(previewLog);
child.stderr.pipe(previewLog);
const user = { id: "u1", email: "wo4@example.invalid", role: "admin", firstName: "Анна", lastName: "Оператор", mustChangePassword: false, onboardingCompletedAt: "2026-01-01T00:00:00Z" };
const users = [
  { id: "u1", firstName: "Анна", lastName: "Оператор", email: "wo4@example.invalid", role: "admin", status: "active", createdAt: "2026-01-01T00:00:00Z", lastLoginAt: "2026-09-19T00:00:00Z" },
  { id: "u2", firstName: "Борис", lastName: "Игрок", email: "boris@example.invalid", role: "user", status: "blocked", createdAt: "2026-01-02T00:00:00Z", lastLoginAt: null },
];
const participants = [
  { id: "p-a", side: "A", userId: "u1", displayName: "Анна Оператор" },
  { id: "p-b", side: "B", userId: "u2", displayName: "Борис Игрок" },
];
const match = (id, status) => ({ id, title: `Матч ${status} — длинное синтетическое название для проверки переноса`, kind: "standalone", status, format: "1v1", createdByUserId: "u1", scoreA: status === "finished" ? 11 : 4, scoreB: status === "finished" ? 9 : 3, winnerSide: status === "finished" ? "A" : null, version: 2, pointsToWin: 11, mercyEnabled: false, mercyPoints: 5, firstServerMethod: "manual", currentServerParticipantId: "p-a", startedAt: status === "waiting" ? null : "2026-09-19T00:00:00Z", participants, activeJudge: status === "waiting" ? null : { userId: "u1", expiresAt: "2026-09-19T03:00:00Z" }, scoreEvents: [] });
const matchRows = ["waiting", "in_progress", "pending_confirmation", "finished", "stopped", "cancelled", "voided"].map((status) => match(`m-${status}`, status));
const tournament = (id, status) => ({ id, title: `Кубок ${status} — длинное синтетическое название для проверки переноса`, status, format: "single_elimination", createdByUserId: "u1", requireParticipantConsent: false, organizerParticipates: true, pointsToWin: 11, mercyEnabled: false, mercyPoints: 5, bracketJson: null, participants: [
  { id: "tp1", userId: "u1", displayName: "Анна Оператор", status: "active" },
  { id: "tp2", userId: "u2", displayName: "Борис Игрок", status: "active" },
  { id: "tp3", userId: "u3", displayName: "Вера Игрок", status: "active" },
  { id: "tp4", userId: "u4", displayName: "Глеб Игрок", status: "active" },
], invitations: [], matches: [], summary: { durationSeconds: null, playedMatchCount: 0, results: [], top3: [], matchParticipants: [] } });
const tournamentRows = ["collecting", "bracket_generated", "needs_regeneration", "in_progress", "finished", "stopped", "cancelled", "dissolved"].map((status) => tournament(`t-${status}`, status));
const bracketSeeds = ["tp1", "tp2", "tp3", "tp4"];
const seFinal = bracketLib.simulateBracket(bracketLib.generateSingleEliminationV2({ seedOrder: bracketSeeds, thirdPlaceEnabled: false }));
let dePartial = bracketLib.generateDoubleEliminationV2({ seedOrder: bracketSeeds });
const deOpening = dePartial.matches.find((node) => node.id === "W0_0");
const deSides = bracketLib.getMatchSides(dePartial, deOpening);
dePartial = bracketLib.applyBracketResult(dePartial, { bracketMatchId: deOpening.id, winnerParticipantId: deSides.a.participantId, loserParticipantId: deSides.b.participantId });
tournamentRows.find((row) => row.id === "t-finished").bracketJson = seFinal;
Object.assign(tournamentRows.find((row) => row.id === "t-in_progress"), { format: "double_elimination", bracketJson: dePartial });
const team = (id, status) => ({ id, name: `Команда ${status}`, status, slogan: "Играем вместе", welcomeText: "Добро пожаловать", captainUserId: "u1", createdAt: "2026-01-01T00:00:00Z", archivedAt: status === "archived" ? "2026-09-19T00:00:00Z" : null, isMember: true, isCaptain: true, members: [{ id: "tm1", userId: "u1", displayName: "Анна Оператор", avatarKey: null, joinedAt: "2026-01-01T00:00:00Z" }, { id: "tm2", userId: "u3", displayName: "Вера Игрок", avatarKey: null, joinedAt: "2026-01-02T00:00:00Z" }], invitations: ["pending", "accepted", "declined", "expired", "cancelled"].map((state, index) => ({ id: `ti${index}`, invitedUserId: `u${index + 5}`, displayName: `Гость ${index + 1}`, status: state, expiresAt: "2026-09-20T00:00:00Z", respondedAt: null })) });
const profile = { isOwn: true, canChallenge: false, identity: { id: "u1", firstName: "Анна", lastName: "Оператор", displayName: "Анна Оператор", email: "wo4@example.invalid", avatarKey: null, organizationText: null, positionText: null, birthDate: null }, avatar: { key: null, editable: false }, stats: { matchesPlayed: 9, wins: 6, losses: 3, winRate: 2 / 3, averagePoints: 8, tournamentsPlayed: 2, tournamentWins: 1, tournamentsCreated: 1, judgedMatches: 3, rank: 7 }, facts: { longestMatch: null, bestWinningScore: null, frequentOpponent: null, rival: null }, teams: [{ id: "team-active", name: "Команда active", role: "captain" }] };
const home = { rankingPeriod: "all_time", recentRole: "all", myStats: { rank: 7, matchesPlayed: 9, wins: 6, losses: 3, winRate: 2 / 3, averagePoints: 8, displayName: "Анна Оператор", avatarKey: null, rival: null }, activeEvents: { match: null, tournament: null }, currentTasks: [
  { type: "match", id: "m-waiting", title: "Подготовка пары", status: "waiting", scoreA: 0, scoreB: 0, sideA: "Анна Оператор", sideB: "Борис Игрок", currentRoles: ["organizer"], updatedAt: "2026-09-19T02:00:00Z" },
  { type: "match", id: "m-in_progress", title: "Партия сейчас", status: "in_progress", scoreA: 4, scoreB: 3, sideA: "Анна Оператор", sideB: "Борис Игрок", currentRoles: ["current_judge"], updatedAt: "2026-09-19T01:00:00Z" },
  { type: "match", id: "m-pending_confirmation", title: "Проверка результата", status: "pending_confirmation", scoreA: 11, scoreB: 9, sideA: "Анна Оператор", sideB: "Борис Игрок", currentRoles: ["player"], updatedAt: "2026-09-19T00:00:00Z" },
  { type: "tournament", id: "t-collecting", title: "Кубок в сборе", status: "collecting", currentRoles: ["organizer"], updatedAt: "2026-09-18T23:00:00Z" },
], recentEvents: [
  { type: "match", id: "m-finished", title: "Завершённый матч", status: "finished", scoreA: 11, scoreB: 9, sideA: "Одинаковое Имя", sideB: "Одинаковое Имя", winnerSide: "B", durationSeconds: 500, userRole: "participant" },
  { type: "match", id: "m-stopped", title: "Остановленный матч", status: "stopped", scoreA: 4, scoreB: 3, sideA: "Анна Оператор", sideB: "Борис Игрок", userRole: "judge" },
  { type: "tournament", id: "t-finished", title: "Финал кубка", status: "finished", topThree: ["Анна", "Борис", "Вера"], userRole: "organizer" },
], topRankings: [{ userId: "u1", displayName: "Анна Оператор", wins: 6, avatarKey: null }], unreadNotifications: [], unreadCount: 1, notificationView: "available" };
const history = [
  ...matchRows.map((row) => ({ type: "match", id: row.id, title: row.title, status: row.status, occurredAt: "2026-09-19T00:00:00Z", roles: ["judge"], result: row.status === "finished" ? "win" : null, matchKind: "standalone", scoreA: row.scoreA, scoreB: row.scoreB, format: "1v1" })),
  ...tournamentRows.slice(0, 4).map((row) => ({ type: "tournament", id: row.id, title: row.title, status: row.status, occurredAt: "2026-09-19T00:00:00Z", roles: ["organizer"], result: null, matchKind: null, scoreA: null, scoreB: null, format: "single_elimination" })),
];
const notifications = ["new", "read", "accepted", "declined", "expired", "cancelled"].map((lifecycle, index) => ({ id: `n${index}`, type: "team_invitation", title: `Команда: ${lifecycle}`, body: `Синтетическое приглашение ${lifecycle}`, lifecycle, actionable: lifecycle === "new", readAt: lifecycle === "new" ? null : "2026-09-19T00:00:00Z", createdAt: "2026-09-19T00:00:00Z", payload: { invitationId: `ti${index}` } }));
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const failure = (route, message, status = 404) => json(route, { code: "SYNTHETIC", message }, status);
const result = { source: "WO4 StatusChip sample built into private/tmp; entirely synthetic intercepted API", baseManifestSha256: "54860798d7c0744a838e7d1b299a2f44ea34f03c7e6176f7663afe51adc030fd", cases: [], unknownRequests: [] };
let browser;
async function waitReady() { for (let n = 0; n < 120; n += 1) { try { if ((await fetch(`${origin}/login`)).ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 250)); } throw new Error("Preview did not start"); }
function contrast(foreground, background) { const rgb = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number); const lum = (value) => rgb(value).map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0); const a = lum(foreground), b = lum(background); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }
async function newContext(width, height, { anonymous = false, homeMode = "normal", colorScheme = "light" } = {}) {
  const session = await browser.newContext({ viewport: { width, height }, colorScheme });
  await session.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname, method = route.request().method();
    if (p === "/api/v1/auth/me") return anonymous ? failure(route, "Нет сессии", 401) : json(route, { user });
    if (p === "/api/v1/home") {
      if (homeMode === "pending") return new Promise(() => {});
      return homeMode === "error" ? failure(route, "Синтетическая ошибка загрузки", 503) : json(route, homeMode === "empty" ? { ...home, currentTasks: [], recentEvents: [], topRankings: [] } : home);
    }
    if (p === "/api/v1/matches") return json(route, { matches: matchRows });
    if (/^\/api\/v1\/matches\/m-/.test(p) && method === "GET") { const id = p.split("/").at(-1); return json(route, { match: matchRows.find((row) => row.id === id) ?? match("m-in_progress", "in_progress") }); }
    if (p === "/api/v1/tournaments") return json(route, { tournaments: tournamentRows });
    if (/^\/api\/v1\/tournaments\/t-/.test(p) && method === "GET") { const id = p.split("/").at(-1); return json(route, { tournament: tournamentRows.find((row) => row.id === id) ?? tournament("t-collecting", "collecting") }); }
    if (p === "/api/v1/history") return json(route, { items: history, nextCursor: null });
    if (p === "/api/v1/admin/users") return json(route, { users });
    if (p === "/api/v1/teams") return json(route, { teams: [team("team-active", "active"), team("team-archived", "archived")] });
    if (/^\/api\/v1\/teams\/team-/.test(p) && method === "GET") { const id = p.split("/").at(-1); return json(route, { team: team(id, id.endsWith("archived") ? "archived" : "active") }); }
    if (p === "/api/v1/profile/me") return json(route, { profile });
    if (p === "/api/v1/auth/sessions") return json(route, { sessions: [{ id: "s1", userAgent: "Synthetic Browser", createdAt: "2026-09-18T00:00:00Z", lastSeenAt: "2026-09-19T00:00:00Z", current: true }, { id: "s2", userAgent: "Other synthetic", createdAt: "2026-09-17T00:00:00Z", lastSeenAt: "2026-09-18T00:00:00Z", current: false }] });
    if (p === "/api/v1/notifications" && method === "GET") return json(route, { notifications, notificationView: "available", unreadCount: 1 });
    if (p.includes("notifications") && method === "POST") return json(route, { notifications: notifications.map((row) => ({ id: row.id, readAt: "2026-09-19T00:00:00Z" })), ok: true });
    if (p === "/api/v1/users/directory") return json(route, { users: [] });
    if (p === "/api/v1/matches/create-options") return json(route, { users: [], teams: [], recentOpponentIds: [], frequentOpponentIds: [] });
    result.unknownRequests.push({ path: p, method });
    return failure(route, `Synthetic route missing: ${p}`);
  });
  return session;
}
async function inspect(page) {
  return page.evaluate(() => {
    const parse = (value) => { const n = value.match(/[\d.]+/g)?.map(Number) ?? []; return { rgb: n.slice(0, 3), alpha: n.length > 3 ? n[3] : 1 }; };
    const blend = (top, bottom) => ({ rgb: top.rgb.map((v, i) => v * top.alpha + bottom.rgb[i] * (1 - top.alpha)), alpha: 1 });
    const format = (rgb) => rgb.map((v) => Math.round(v));
    const luminance = (rgb) => rgb.map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2)); };
    const actualColors = (element) => {
      const chain = []; let node = element;
      while (node instanceof Element) { chain.unshift(node); node = node.parentElement; }
      let background = { rgb: [255, 255, 255], alpha: 1 };
      const warnings = [];
      for (const layer of chain) { const style = getComputedStyle(layer); background = blend(parse(style.backgroundColor), background); if (style.backgroundImage !== 'none') warnings.push(`${layer.tagName}:background-image`); if (style.opacity !== '1') warnings.push(`${layer.tagName}:opacity=${style.opacity}`); }
      const foreground = blend(parse(getComputedStyle(element).color), background);
      return { composedBackground: format(background.rgb), composedForeground: format(foreground.rgb), contrast: ratio(foreground.rgb, background.rgb), compositingWarnings: warnings };
    };
    const chipRoots = Array.from(document.querySelectorAll('span[class*="_root_1fdwx_"]'));
    const chipData = chipRoots.map((element) => {
      const css = getComputedStyle(element), rect = element.getBoundingClientRect();
      const icon = element.querySelector('[class*="_startIcon_1fdwx_"]');
      const parentAction = element.closest('a,button');
      return { text: element.textContent?.trim(), tag: element.tagName, role: element.getAttribute('role'), tabIndex: element.tabIndex, visible: rect.width > 0 && rect.height > 0, cursor: css.cursor, parentCursor: getComputedStyle(parentAction ?? element.parentElement).cursor, color: css.color, background: css.backgroundColor, width: rect.width, height: rect.height, icon: Boolean(icon), iconAriaHidden: icon?.getAttribute('aria-hidden') ?? null, isStatusChip: element.classList.contains('status-chip'), parentActionTag: parentAction?.tagName ?? null, parentHref: parentAction?.getAttribute('href') ?? null, ...actualColors(element) };
    });
    const named = (selector) => Array.from(document.querySelectorAll(selector)).map((element) => ({ text: element.textContent?.trim().slice(0, 140), tag: element.tagName, role: element.getAttribute('role'), tabIndex: element.tabIndex, ariaLabel: element.getAttribute('aria-label'), title: element.getAttribute('title') }));
    const trophy = Array.from(document.querySelectorAll('.home-event__winner-mark')).map((element) => ({ label: element.getAttribute('aria-label'), sideText: element.parentElement?.textContent?.trim(), sideIndex: Array.from(element.closest('.home-event__names')?.querySelectorAll('.home-event__side') ?? []).indexOf(element.parentElement) }));
    return { chips: chipData, trophy, judge: named('.judge-status, .judge-readonly-badge, .judge-pending-badge, .judge-serve-badge, .judge-deuce'), bracket: named('.tournament-bracket__fate, .tournament-bracket__champion'), notification: named('.list-row__trailing'), alerts: named('[role="alert"]'), statuses: named('[role="status"]'), buttons: Array.from(document.querySelectorAll('button')).map((element) => ({ text: element.textContent?.trim().slice(0, 70), ariaLabel: element.getAttribute('aria-label'), pressed: element.getAttribute('aria-pressed'), disabled: element.disabled })).filter((item) => item.text || item.ariaLabel), horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
  });
}
const scenarios = [
  { name: "home", route: "/", marker: "Анна Оператор", widths: [360, 390, 1440] },
  { name: "home-os-dark", route: "/", marker: "Анна Оператор", widths: [390], colorScheme: "dark" },
  { name: "home-pending", route: "/", marker: "Главная: начните событие", widths: [390], homeMode: "pending" },
  { name: "home-empty", route: "/", marker: "Начать матч", widths: [390], homeMode: "empty" },
  { name: "home-error", route: "/", marker: "Не удалось загрузить главную", widths: [390], homeMode: "error" },
  { name: "matches", route: "/matches", marker: "Матчи", widths: [360, 390, 1440] },
  { name: "match-detail", route: "/matches/m-waiting", marker: "Матч waiting", widths: [360, 390, 1440] },
  { name: "tournaments", route: "/tournaments", marker: "Турниры", widths: [360, 390, 1440] },
  { name: "tournament-detail", route: "/tournaments/t-collecting", marker: "Кубок collecting", widths: [360, 390, 1440] },
  { name: "tournament-bracket-se", route: "/tournaments/t-finished", marker: "Кубок finished", widths: [390] },
  { name: "tournament-bracket-de", route: "/tournaments/t-in_progress", marker: "Кубок in_progress", widths: [390] },
  { name: "history", route: "/history", marker: "История", widths: [360, 390, 1440] },
  { name: "admin", route: "/admin", marker: "Пользователи", widths: [360, 390, 1440] },
  { name: "judge-readonly", route: "/matches/m-in_progress/judge?mode=readonly", marker: "Только просмотр", widths: [360, 390, 1440] },
  { name: "judge-readonly-os-dark", route: "/matches/m-in_progress/judge?mode=readonly", marker: "Только просмотр", widths: [390], colorScheme: "dark" },
  { name: "team-detail", route: "/teams/team-active", marker: "Команда active", widths: [390] },
  { name: "team-archived", route: "/teams/team-archived", marker: "Команда archived", widths: [390] },
  { name: "notifications", route: "/notifications", marker: "Уведомления", widths: [390] },
  { name: "profile", route: "/profile", marker: "Анна Оператор", widths: [390] },
  { name: "login-eye", route: "/login", marker: "Войти", widths: [390], anonymous: true },
];
try {
  await waitReady();
  browser = await chromium.launch({ headless: true });
  for (const scenario of scenarios) {
    for (const width of scenario.widths) {
      const height = width === 1440 ? 900 : width === 360 ? 800 : 844;
      const session = await newContext(width, height, { anonymous: scenario.anonymous, homeMode: scenario.homeMode, colorScheme: scenario.colorScheme });
      const page = await session.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${origin}${scenario.route}`);
      if (scenario.name === "home-pending") await page.getByRole("status", { name: "Загружаем главную" }).waitFor({ timeout: 8000 });
      try { await page.getByText(scenario.marker, { exact: false }).first().waitFor({ timeout: 8000 }); } catch { /* captured below */ }
      if (scenario.name === "home" && await page.getByRole("button", { name: /Ещё \d+ текущ/ }).count()) {
        await page.getByRole("button", { name: /Ещё \d+ текущ/ }).click();
        await page.getByRole("button", { name: "Скрыть остальные" }).waitFor({ timeout: 3000 });
      }
      if (scenario.name === "notifications") { const box = page.getByRole("checkbox", { name: "Актуальные" }); if (await box.count()) await box.uncheck(); }
      const observed = await inspect(page);
      const screenshot = `${scenario.name}-${width}.png`;
      await page.screenshot({ path: path.join(output, screenshot) });
      const row = { name: scenario.name, route: scenario.route, width, height, urlAfterLoad: page.url().replace(origin, ""), markerVisible: await page.getByText(scenario.marker, { exact: false }).first().isVisible().catch(() => false), screenshot, ...observed, pageErrors: errors };
      if (observed.chips.length) {
        const visibleChip = page.locator('span[class*="_root_1fdwx_"]').filter({ visible: true }).first();
        if (await visibleChip.count()) {
          await visibleChip.scrollIntoViewIfNeeded();
          row.statusScreenshot = `${scenario.name}-chip-${width}.png`;
          await page.screenshot({ path: path.join(output, row.statusScreenshot) });
        }
      }
      if (["home", "matches", "match-detail", "tournaments", "tournament-detail", "history", "admin"].includes(scenario.name)) {
        row.hoverChecks = [];
        const chips = page.locator('.status-chip:visible');
        for (let i = 0, total = await chips.count(); i < total; i += 1) {
          const chip = chips.nth(i);
          await chip.evaluate((el) => { el.style.transition = 'none'; });
          const read = () => chip.evaluate((el) => { const s = getComputedStyle(el); return { background: s.backgroundColor, border: s.borderColor, color: s.color, cursor: s.cursor }; });
          const before = await read();
          await chip.hover();
          const after = await read();
          row.hoverChecks.push({ text: (await chip.textContent())?.trim(), before, after, unchanged: before.background === after.background && before.border === after.border && before.color === after.color });
        }
      }
      if (width === 390 && ["home", "matches", "match-detail", "tournaments", "tournament-detail", "history", "admin"].includes(scenario.name)) {
        row.keyboardFocus = [];
        for (let step = 0; step < 24; step += 1) {
          await page.keyboard.press("Tab");
          row.keyboardFocus.push(await page.evaluate(() => {
            const el = document.activeElement;
            return { tag: el?.tagName, text: el?.textContent?.trim().slice(0, 65), ariaLabel: el?.getAttribute("aria-label"), isChip: Boolean(el?.matches('span[class*="_root_1fdwx_"]')), containsChip: Boolean(el?.querySelector('span[class*="_root_1fdwx_"]')) };
          }));
        }
      }
      if ((scenario.name === "matches" || scenario.name === "match-detail" || scenario.name === "home") && observed.chips.length) {
        const first = page.locator('span[class*="_root_1fdwx_"]').first();
        await first.click();
        row.urlAfterChipClick = page.url().replace(origin, "");
      }
      if (scenario.name === "login-eye") {
        const eye = page.locator(".auth-password-field__toggle").first();
        row.eye = { count: await eye.count() };
        if (row.eye.count) { row.eye.type = await eye.getAttribute("type"); row.eye.nameBefore = await eye.getAttribute("aria-label"); row.eye.pressedBefore = await eye.getAttribute("aria-pressed"); await eye.click(); row.eye.nameAfter = await eye.getAttribute("aria-label"); row.eye.pressedAfter = await eye.getAttribute("aria-pressed"); }
      }
      result.cases.push(row);
      await writeFile(path.join(output, "runtime.json"), JSON.stringify(result, null, 2) + "\n");
      await session.close();
      process.stdout.write(`${scenario.name} ${width} chips=${row.chips.length} marker=${row.markerVisible} errors=${errors.length}\n`);
    }
  }
  await writeFile(path.join(output, "runtime.json"), JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(`RESULT ${path.join(output, "runtime.json")}\n`);
} finally {
  await browser?.close();
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
}
