import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const mode = process.argv[2];
if (mode !== "red" && mode !== "green") throw new Error("Expected red or green");
const root = path.resolve(import.meta.dirname, "../../../..");
const output = import.meta.dirname;
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const processLog = createWriteStream(`/private/tmp/tab10-wo2-r2/${mode}-vite.log`, { flags: "w" });
const child = spawn("pnpm", ["--filter", "@tab10/web", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root,
  env: {
    PATH: `/Users/liubavskii/.local/share/mise/installs/node/24.20.0/bin:${process.env.PATH ?? ""}`,
    NODE_ENV: "development", VITE_API_BASE_URL: "",
    TAB10_API_PROXY_TARGET: "http://127.0.0.1:1",
  },
  detached: true, stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.pipe(processLog);
child.stderr.pipe(processLog);
let browser;

async function ready() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(`${origin}/login`)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Vite did not start");
}

async function authPage(routeName) {
  const context = await browser.newContext({ viewport: { width: 360, height: 844 } });
  await context.route("**/api/v1/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const restricted = routeName === "first-password";
    if (pathname === "/api/v1/auth/me") {
      return route.fulfill({ status: restricted ? 200 : 401, contentType: "application/json", body: JSON.stringify(restricted ? {
        user: { id: "wo2-r2", email: "wo2-r2@example.invalid", role: "user", mustChangePassword: true, firstName: "Тест", lastName: "Фокуса" },
      } : { code: "UNAUTHORIZED", message: "No session" }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "NOT_FOUND" }) });
  });
  const page = await context.newPage();
  await page.goto(`${origin}/${routeName}`);
  await page.getByRole("heading", { name: restrictedName(routeName) }).waitFor();
  return { context, page };
}

function restrictedName(routeName) {
  return routeName === "first-password" ? "Смена пароля" : "Вход";
}

async function font(page, selector) {
  return page.locator(selector).evaluate((input) => {
    const style = getComputedStyle(input);
    const rect = input.getBoundingClientRect();
    return { fontSize: style.fontSize, lineHeight: style.lineHeight, width: rect.width, height: rect.height };
  });
}

try {
  await ready();
  browser = await chromium.launch({ headless: true });
  const login = await authPage("login");
  const loginEmail = await font(login.page, "#login-email");
  const loginPassword = await font(login.page, "#login-password");
  await login.page.locator("#login-email").focus();
  await login.page.screenshot({ path: path.join(output, `${mode}-login-font-360.png`) });
  await login.context.close();

  const first = await authPage("first-password");
  const newPassword = await font(first.page, "#first-password-new");
  const confirmPassword = await font(first.page, "#first-password-confirm");
  const password = first.page.locator("#first-password-new");
  const confirm = first.page.locator("#first-password-confirm");
  await first.page.evaluate(() => {
    window.__wo2r2New = document.querySelector("#first-password-new");
    window.__wo2r2Confirm = document.querySelector("#first-password-confirm");
  });
  await password.fill("alpha");
  await confirm.fill("beta");
  const save = first.page.getByRole("button", { name: "Сохранить" });
  await save.click();
  const alert = first.page.getByRole("alert");
  await alert.waitFor();
  const firstFocused = await alert.evaluate((element) => element === document.activeElement);
  await save.click();
  const secondFocused = await alert.evaluate((element) => element === document.activeElement);
  const alertCount = await first.page.getByRole("alert").count();
  const associations = await first.page.evaluate(() => {
    const alert = document.querySelector('[role="alert"]');
    const newField = document.querySelector("#first-password-new");
    const confirmField = document.querySelector("#first-password-confirm");
    return {
      newLinked: newField.getAttribute("aria-describedby")?.split(" ").includes(alert.id) ?? false,
      confirmLinked: confirmField.getAttribute("aria-describedby")?.split(" ").includes(alert.id) ?? false,
      newLength: newField.value.length, confirmLength: confirmField.value.length,
      sameNodes: window.__wo2r2New === newField && window.__wo2r2Confirm === confirmField,
    };
  });
  await first.page.screenshot({ path: path.join(output, `${mode}-repeated-mismatch-360.png`) });
  await confirm.fill("betax");
  const editKeepsFocus = await confirm.evaluate((element) => element === document.activeElement);
  const staleErrorCleared = (await first.page.getByRole("alert").count()) === 0;
  await confirm.press("Tab");
  const tabToToggle = await first.page.getByRole("button", { name: "Показать повторный пароль" }).evaluate((element) => element === document.activeElement);
  await first.page.keyboard.press("Shift+Tab");
  const shiftTabToConfirm = await confirm.evaluate((element) => element === document.activeElement);
  const result = {
    mode, viewport: "360x844", inputFonts: { loginEmail, loginPassword, newPassword, confirmPassword },
    firstFocused, secondFocused, alertCount, associations, editKeepsFocus,
    staleErrorCleared, tabToToggle, shiftTabToConfirm,
  };
  await writeFile(path.join(output, `${mode}-focus-font.json`), JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify(result) + "\n");
  await first.context.close();
  if (mode === "red" && secondFocused) throw new Error("Expected old repeated mismatch focus failure");
  if (mode === "green" && (!firstFocused || !secondFocused || alertCount !== 1 || !associations.newLinked || !associations.confirmLinked || !associations.sameNodes || associations.newLength !== 5 || associations.confirmLength !== 4 || !editKeepsFocus || !staleErrorCleared || !tabToToggle || !shiftTabToConfirm)) {
    throw new Error("Repeated mismatch focus regression failed");
  }
  if (mode === "green" && Object.values(result.inputFonts).some((item) => parseFloat(item.fontSize) < 16)) {
    throw new Error("Auth input font remains under 16px");
  }
} finally {
  await browser?.close();
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
  processLog.end();
}
