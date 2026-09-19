import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../../../..");
const output = import.meta.dirname;
const mode = process.argv[2];
if (mode !== "red" && mode !== "green") throw new Error("Expected red or green mode");
const logDirectory = "/private/tmp/tab10-wo2";
await mkdir(logDirectory, { recursive: true });

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const apiPort = await freePort();
const webPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const nodeBin = "/Users/liubavskii/.local/share/mise/installs/node/24.20.0/bin";
const commonEnv = {
  PATH: `${nodeBin}:${process.env.PATH ?? ""}`,
  NODE_ENV: "development",
  DATABASE_URL: "",
  TEST_DATABASE_URL: "",
  PGLITE_DATA_DIR: "",
  AUDIT_EPHEMERAL: "1",
  TAB10_RELEASE_SHA: "local-wo2",
  TAB10_RELEASE_VERSION: "4.1.0",
  TAB10_ENVIRONMENT: "local",
  TAB10_RELEASE_DIRTY: "true",
};

function start(args, env, logName) {
  const log = createWriteStream(path.join(logDirectory, logName), { flags: "w" });
  const child = spawn("pnpm", args, { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return { child, log };
}

async function ready(url) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch { /* server starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local server did not become ready: ${new URL(url).pathname}`);
}

function client() {
  const cookies = new Map();
  return async (method, route, body) => {
    const headers = { "Content-Type": "application/json" };
    if (cookies.size) headers.Cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (cookies.has("tab10_csrf")) headers["X-CSRF-Token"] = decodeURIComponent(cookies.get("tab10_csrf"));
    const response = await fetch(`${apiUrl}${route}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const value of response.headers.getSetCookie()) {
      const [pair] = value.split(";", 1);
      const separator = pair.indexOf("=");
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${method} ${route} returned ${response.status} ${payload.code ?? ""}`);
    return payload;
  };
}

let api;
let web;
let browser;
try {
  const adminPassword = `Aa1!${randomBytes(24).toString("hex")}`;
  api = start(["--filter", "@tab10/api", "exec", "tsx", "src/index.ts"], {
    ...commonEnv,
    HOST: "127.0.0.1", PORT: String(apiPort), WEB_ORIGIN: webUrl,
    SEED_ADMIN: "1", SEED_ADMIN_EMAIL: "wo2.admin@tab10.local", SEED_ADMIN_PASSWORD: adminPassword,
  }, `${mode}-api.log`);
  const health = await (await ready(`${apiUrl}/health`)).json();
  if (health.auditEphemeral !== true) throw new Error("API did not attest an in-memory database");
  const admin = client();
  await admin("POST", "/api/v1/auth/login", { email: "wo2.admin@tab10.local", password: adminPassword });
  const created = await admin("POST", "/api/v1/admin/users", {
    email: "wo2.member@tab10.local", firstName: "Тест", lastName: "Выхода", role: "user",
  });
  if (!created.temporaryPassword) throw new Error("Temporary account was not created");

  web = start(["--filter", "@tab10/web", "dev", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], {
    ...commonEnv, TAB10_API_PROXY_TARGET: apiUrl, VITE_API_BASE_URL: "",
  }, `${mode}-web.log`);
  await ready(`${webUrl}/login`);

  browser = await chromium.launch({ headless: true });
  const first = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const second = await browser.newContext({ viewport: { width: 390, height: 844 } });
  async function login(context) {
    const page = await context.newPage();
    await page.goto(`${webUrl}/login`);
    await page.getByLabel("Email").fill("wo2.member@tab10.local");
    await page.locator('input[name="password"]').fill(created.temporaryPassword);
    await page.getByRole("button", { name: "Войти" }).click();
    await page.getByRole("heading", { name: "Смена пароля" }).waitFor();
    return page;
  }
  const page = await login(first);
  const secondPage = await login(second);
  const before = await first.request.get(`${webUrl}/api/v1/auth/me`);
  if (before.status() !== 200) throw new Error(`First session before exit: ${before.status()}`);
  const otherBefore = await second.request.get(`${webUrl}/api/v1/auth/me`);
  if (otherBefore.status() !== 200) throw new Error(`Second session before exit: ${otherBefore.status()}`);
  let logoutPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/auth/logout") logoutPosts += 1;
  });
  await page.getByRole("button", { name: "Выйти" }).click();
  await page.getByRole("heading", { name: "Вход" }).waitFor();
  const after = await first.request.get(`${webUrl}/api/v1/auth/me`);
  const otherAfter = await second.request.get(`${webUrl}/api/v1/auth/me`);
  if (mode === "red" && (logoutPosts !== 0 || after.status() !== 200)) {
    throw new Error(`Expected old behavior: posts=${logoutPosts}, me=${after.status()}`);
  }
  if (mode === "green" && (logoutPosts !== 1 || after.status() !== 401 || otherAfter.status() !== 200)) {
    throw new Error(`Expected revoked current session only: posts=${logoutPosts}, me=${after.status()}, other=${otherAfter.status()}`);
  }
  await page.goBack();
  await page.getByRole("heading", { name: mode === "red" ? "Смена пароля" : "Вход" }).waitFor();
  await page.screenshot({ path: path.join(output, `${mode}-logout-after-back.png`) });
  const result = {
    mode,
    auditEphemeral: health.auditEphemeral,
    firstSessionBefore: before.status(),
    secondSessionBefore: otherBefore.status(),
    logoutPosts,
    firstSessionAfter: after.status(),
    secondSessionAfter: otherAfter.status(),
    afterBackHeading: mode === "red" ? "Смена пароля" : "Вход",
    credentialsPersisted: false,
  };
  await writeFile(path.join(output, `${mode}-logout.json`), JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify(result) + "\n");
  await secondPage.close();
} finally {
  await browser?.close();
  for (const processRecord of [web, api]) {
    if (!processRecord) continue;
    try { process.kill(-processRecord.child.pid, "SIGTERM"); } catch { /* already exited */ }
    processRecord.log.end();
  }
}
