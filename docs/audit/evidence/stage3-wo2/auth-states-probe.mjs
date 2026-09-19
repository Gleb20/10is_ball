import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../../../..");
const output = import.meta.dirname;
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const webUrl = `http://127.0.0.1:${port}`;
const log = createWriteStream("/private/tmp/tab10-wo2/states-web.log", { flags: "w" });
const child = spawn("pnpm", ["--filter", "@tab10/web", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root,
  env: {
    PATH: `/Users/liubavskii/.local/share/mise/installs/node/24.20.0/bin:${process.env.PATH ?? ""}`,
    NODE_ENV: "development",
    VITE_API_BASE_URL: "",
    TAB10_API_PROXY_TARGET: "http://127.0.0.1:1",
  },
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.pipe(log);
child.stderr.pipe(log);
let browser;

async function waitForWeb() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${webUrl}/login`)).ok) return;
    } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Vite did not start");
}

const restrictedUser = {
  id: "wo2-user", email: "wo2.member@tab10.local", firstName: "Тест", lastName: "Формы",
  role: "user", mustChangePassword: true,
};

async function createPage(phase, width, zoom = 100, colorScheme = "light", hasTouch = false) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme, hasTouch });
  let loginPosts = 0;
  let firstChangePosts = 0;
  await context.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const json = (status, payload) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
    if (pathname === "/api/v1/auth/me") {
      return phase === "login"
        ? json(401, { code: "UNAUTHORIZED", message: "No session" })
        : json(200, { user: restrictedUser });
    }
    if (pathname === "/api/v1/auth/login") {
      loginPosts += 1;
      return json(401, { code: "INVALID_CREDENTIALS", message: "Неверный email или пароль" });
    }
    if (pathname === "/api/v1/auth/password/first-change") {
      firstChangePosts += 1;
      return json(400, { code: "PASSWORD_POLICY", message: "Пароль не соответствует политике", details: { errors: ["TOO_SHORT", "MISSING_UPPERCASE", "MISSING_SPECIAL"] } });
    }
    return json(404, { code: "NOT_FOUND", message: "Not in fixture" });
  });
  const page = await context.newPage();
  await page.goto(`${webUrl}/${phase === "login" ? "login" : "first-password"}`);
  await page.getByRole("heading", { name: phase === "login" ? "Вход" : "Смена пароля" }).waitFor();
  if (zoom !== 100) await page.evaluate((value) => { document.documentElement.style.zoom = `${value}%`; }, zoom);
  return { context, page, counts: () => ({ loginPosts, firstChangePosts }) };
}

async function geometry(page, phase) {
  return page.evaluate((kind) => {
    const selectors = kind === "login"
      ? ["#login-email", "#login-password", 'button[type="submit"]']
      : ["#first-password-new", "#first-password-confirm", 'button[type="submit"]', '.stack--actions button[type="button"]'];
    const elements = selectors.map((selector) => document.querySelector(selector));
    const rects = elements.map((element) => {
      if (!element) return null;
      const target = element instanceof HTMLInputElement
        ? element.closest('[class*="_control_6cpf7_"]') ?? element
        : element;
      const rect = target.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const card = document.querySelector(".auth-layout__card").getBoundingClientRect();
    return {
      rects,
      card: { x: card.x, y: card.y, width: card.width, height: card.height },
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollY: window.scrollY,
      zoom: document.documentElement.style.zoom || "100%",
      theme: document.documentElement.dataset.theme,
      inputFontSize: getComputedStyle(elements[1]).fontSize,
    };
  }, phase);
}

function assertLayout(measure, width, zoom) {
  const effectiveWidth = width / (zoom / 100);
  if (measure.scrollWidth > measure.clientWidth + 1) throw new Error(`Horizontal overflow at ${width}/${zoom}`);
  if (measure.rects.some((rect) => !rect || rect.height < 44 - 0.5)) throw new Error(`Touch target under 44 at ${width}/${zoom}`);
  if (Math.abs(measure.rects[0].width - measure.rects[1].width) > 1 || Math.abs(measure.rects[1].width - measure.rects[2].width) > 1) {
    throw new Error(`Field/action widths differ at ${width}/${zoom}: ${measure.rects.map((rect) => rect.width).join(",")}`);
  }
  if (measure.card.x < -1 || measure.card.x + measure.card.width > width + 1) throw new Error(`Card outside viewport at ${width}/${zoom}`);
  if (measure.scrollY === 0 && measure.card.y < -1) throw new Error(`Card top clipped at ${width}/${zoom}: ${measure.card.y}`);
  if (parseFloat(measure.inputFontSize) < 16) throw new Error(`Input font too small at ${width}/${zoom}`);
  return effectiveWidth;
}

try {
  await waitForWeb();
  browser = await chromium.launch({ headless: true });
  const states = [];
  for (const [width, zoom, colorScheme] of [[360, 100, "light"], [390, 100, "light"], [1440, 100, "light"], [720, 200, "light"], [390, 100, "dark"]]) {
    for (const phase of ["login", "first-password"]) {
      const { context, page, counts } = await createPage(phase, width, zoom, colorScheme, width === 390);
      const empty = await geometry(page, phase);
      const effectiveWidth = assertLayout(empty, width, zoom);
      const password = page.locator(phase === "login" ? "#login-password" : "#first-password-new");
      const revealName = phase === "login" ? "Показать пароль" : "Показать новый пароль";
      const hideName = phase === "login" ? "Скрыть пароль" : "Скрыть новый пароль";
      await password.fill("short1");
      await page.evaluate((selector) => {
        const input = document.querySelector(selector);
        window.__wo2Input = input;
        input.focus();
        input.setSelectionRange(0, 0);
      }, phase === "login" ? "#login-password" : "#first-password-new");
      await password.press("Shift+ArrowRight");
      await password.press("Shift+ArrowRight");
      await password.press("Shift+ArrowRight");
      const nativeSelection = await password.evaluate((input) => ({ start: input.selectionStart, end: input.selectionEnd }));
      await password.press("Tab");
      const tabReachedToggle = await page.getByRole("button", { name: revealName }).evaluate((button) => button === document.activeElement);
      await page.keyboard.press("Shift+Tab");
      const shiftTabReturned = await password.evaluate((input) => input === document.activeElement);
      if (!tabReachedToggle || !shiftTabReturned) throw new Error(`Tab order failed at ${width}/${zoom}/${phase}`);
      if (width === 390) await page.getByRole("button", { name: revealName }).tap();
      else await page.getByRole("button", { name: revealName }).click();
      const revealed = await password.evaluate((input) => ({ type: input.type, sameNode: input === window.__wo2Input, length: input.value.length }));
      await page.getByRole("button", { name: hideName }).click();
      const hiddenAgain = await password.evaluate((input) => ({ type: input.type, sameNode: input === window.__wo2Input }));
      if (nativeSelection.start !== 0 || nativeSelection.end !== 3 || revealed.type !== "text" || !revealed.sameNode || hiddenAgain.type !== "password" || !hiddenAgain.sameNode) {
        throw new Error(`Password selection/reveal failed at ${width}/${zoom}/${phase}: ${JSON.stringify({ nativeSelection, revealed, hiddenAgain })}`);
      }
      await password.press("Escape");
      if ((await password.getAttribute("type")) !== "password" || counts().loginPosts !== 0 || counts().firstChangePosts !== 0) {
        throw new Error(`Escape changed the auth form at ${width}/${zoom}/${phase}`);
      }
      const filled = await geometry(page, phase);
      assertLayout(filled, width, zoom);
      let error;
      let postEdit = null;
      const name = `${phase}-${width}-zoom${zoom}-${colorScheme}`;
      if (phase === "login") {
        await page.locator("#login-email").fill("wo2.member@tab10.local");
        await password.press("Enter");
        const alert = page.getByRole("alert");
        await alert.waitFor();
        if (!(await alert.evaluate((element) => element === document.activeElement))) throw new Error("Login error did not receive focus");
        const wrongCredentials = await alert.innerText();
        if (!wrongCredentials.includes("Неверный email или пароль")) throw new Error("Login error changed specificity");
        error = await geometry(page, phase);
        assertLayout(error, width, zoom);
        await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
        await page.locator("#login-email").fill("wo2.edited@tab10.local");
        if (await page.getByRole("alert").count()) throw new Error("Login error did not clear on edit");
        postEdit = await geometry(page, phase);
        assertLayout(postEdit, width, zoom);
      } else {
        await page.locator("#first-password-confirm").fill("other1");
        await page.getByRole("button", { name: "Сохранить" }).click();
        const mismatch = page.getByRole("alert");
        await mismatch.waitFor();
        const mismatchId = await mismatch.getAttribute("id");
        const association = await page.locator("#first-password-new").getAttribute("aria-describedby");
        if (association !== mismatchId || !(await mismatch.evaluate((element) => element === document.activeElement))) throw new Error("Mismatch association/focus failed");
        await page.locator("#first-password-confirm").fill("short1");
        if (await page.getByRole("alert").count()) throw new Error("Mismatch did not clear on edit");
        await page.getByRole("button", { name: "Сохранить" }).click();
        const policy = page.getByRole("alert");
        await policy.waitFor();
        if (!(await policy.evaluate((element) => element === document.activeElement))) throw new Error("Policy error did not receive focus");
        const policyText = await policy.innerText();
        if (policyText.includes("TOO_SHORT") || !policyText.includes("Не менее 10 символов")) throw new Error("Policy translation failed");
        error = await geometry(page, phase);
        assertLayout(error, width, zoom);
        await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
      }
      states.push({ name, effectiveWidth, empty, filled, error, postEdit, nativeSelection, tabReachedToggle, shiftTabReturned, touchToggle: width === 390, revealed, hiddenAgain, counts: counts(), placeholder: "none; visible label" });
      await context.close();
    }
  }
  const pendingStates = [];
  {
    const { context, page } = await createPage("login", 390);
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let posts = 0;
    await page.route("**/api/v1/auth/login", async (route) => {
      posts += 1;
      await held;
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "INVALID_CREDENTIALS", message: "Неверный email или пароль" }) });
    });
    await page.locator("#login-email").fill("wo2.member@tab10.local");
    await page.locator("#login-password").fill("short1");
    await page.locator('button[type="submit"]').dispatchEvent("click");
    await page.getByRole("button", { name: "Вход…" }).waitFor();
    const disabled = await page.evaluate(() => ["#login-email", "#login-password", 'button[type="submit"]', ".auth-password-field__toggle"].every((selector) => document.querySelector(selector).disabled));
    await page.evaluate(() => document.querySelector('form[aria-label="Форма входа"]').requestSubmit());
    if (!disabled || posts !== 1) throw new Error(`Pending login guard failed: disabled=${disabled}, posts=${posts}`);
    await page.screenshot({ path: path.join(output, "login-pending-390.png") });
    release();
    const alert = page.getByRole("alert");
    await alert.waitFor();
    if (!(await alert.evaluate((element) => element === document.activeElement))) throw new Error("Login failure focus missing after pending");
    pendingStates.push({ phase: "login", posts, disabled, errorFocused: true });
    await context.close();
  }
  {
    const { context, page, counts } = await createPage("first-password", 390);
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let logoutPosts = 0;
    await page.route("**/api/v1/auth/logout", async (route) => {
      logoutPosts += 1;
      await held;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "UNAVAILABLE", message: "Service unavailable" }) });
    });
    await page.locator("#first-password-new").fill("short1");
    await page.locator("#first-password-confirm").fill("short1");
    await page.getByRole("button", { name: "Выйти" }).dispatchEvent("click");
    await page.getByRole("button", { name: "Выход…" }).waitFor();
    const disabled = await page.evaluate(() => ["#first-password-new", "#first-password-confirm", 'button[type="submit"]', '.stack--actions button[type="button"]', ".auth-password-field__toggle"].every((selector) => document.querySelector(selector).disabled));
    await page.evaluate(() => document.querySelector('form[aria-label="Форма смены пароля"]').requestSubmit());
    if (!disabled || logoutPosts !== 1 || counts().firstChangePosts !== 0) throw new Error("Pending logout/save guard failed");
    await page.screenshot({ path: path.join(output, "first-password-logout-pending-390.png") });
    release();
    const alert = page.getByRole("alert");
    await alert.waitFor();
    const retained = await page.evaluate(() => ({ newLength: document.querySelector("#first-password-new").value.length, confirmLength: document.querySelector("#first-password-confirm").value.length }));
    if (!(await alert.evaluate((element) => element === document.activeElement)) || retained.newLength !== 6 || retained.confirmLength !== 6) throw new Error("Known logout failure lost focus or draft");
    await page.screenshot({ path: path.join(output, "first-password-logout-error-390.png") });
    pendingStates.push({ phase: "first-password", logoutPosts, savePosts: counts().firstChangePosts, disabled, errorFocused: true, retainedLengths: retained });
    await context.close();
  }
  await writeFile(path.join(output, "auth-states.json"), JSON.stringify(states, null, 2) + "\n");
  await writeFile(path.join(output, "pending-states.json"), JSON.stringify(pendingStates, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ cases: states.length, names: states.map((item) => item.name), pending: pendingStates }) + "\n");
} finally {
  await browser?.close();
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
  log.end();
}
