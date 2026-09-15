import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { chromium, request } from "@playwright/test";

const baseURL = "http://localhost:4717";
const out = new URL("./first-password-exit-probe.json", import.meta.url);
const shot = new URL("./a01-first-password-exit-minimal-390.png", import.meta.url).pathname;
const { adminEmail, adminPassword } = JSON.parse(await readFile("/private/tmp/tab10-ux-auth-private.json", "utf8"));

function check(value, message) {
  if (!value) throw new Error(message);
}

async function mutationHeaders(context) {
  const csrf = (await context.storageState()).cookies.find((cookie) => cookie.name === "tab10_csrf");
  return { ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {}), "idempotency-key": randomUUID() };
}

const admin = await request.newContext({ baseURL, userAgent: "Tab10 AUTH minimal exit fixture" });
const browser = await chromium.launch();
try {
  const login = await admin.post("/api/v1/auth/login", { data: { email: adminEmail, password: adminPassword }, headers: await mutationHeaders(admin) });
  check(login.ok(), `admin login ${login.status()}`);
  const email = `ux-auth-exit-${randomBytes(5).toString("hex")}@tab10.test`;
  const createdResponse = await admin.post("/api/v1/admin/users", {
    data: { email, firstName: "Проверка", lastName: "Выхода", role: "user" },
    headers: await mutationHeaders(admin),
  });
  check(createdResponse.ok(), `create fixture ${createdResponse.status()}`);
  const created = await createdResponse.json();

  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, userAgent: "Tab10 AUTH minimal exit browser" });
  const page = await context.newPage();
  let logoutPosts = 0;
  page.on("request", (event) => {
    if (event.method() === "POST" && event.url().endsWith("/api/v1/auth/logout")) logoutPosts += 1;
  });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(created.temporaryPassword);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByRole("heading", { name: "Смена пароля", exact: true }).waitFor();
  const cookiesBefore = await context.cookies();
  const authBefore = await page.request.get("/api/v1/auth/me");

  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.getByRole("heading", { name: "Вход", exact: true }).waitFor();
  await page.waitForTimeout(100);
  const cookiesAfter = await context.cookies();
  const authAfter = await page.request.get("/api/v1/auth/me");
  await page.screenshot({ path: shot, fullPage: false });

  const independent = await browser.newContext({ baseURL, userAgent: "Tab10 AUTH exit negative control" });
  const independentPage = await independent.newPage();
  const independentAuth = await independentPage.request.get("/api/v1/auth/me");
  await independent.close();

  const evidence = {
    runId: "AUTH-EXIT-MIN-01",
    browser: `Chromium ${browser.version()}`,
    viewport: "390x844",
    fixture: { id: created.user.id, status: created.user.status, mustChangePassword: true },
    before: { authStatus: authBefore.status(), sessionCookiePresent: cookiesBefore.some((cookie) => cookie.name === "tab10_session") },
    action: { label: "Выйти", resultingPath: new URL(page.url()).pathname, logoutPostCount: logoutPosts },
    after: { authStatus: authAfter.status(), sessionCookiePresent: cookiesAfter.some((cookie) => cookie.name === "tab10_session") },
    negativeControl: { freshContextAuthStatus: independentAuth.status(), sessionCookiePresent: false },
    source: "apps/web/src/pages/FirstPasswordPage.tsx:93-100",
    verdict: logoutPosts === 0 && authAfter.status() === 200 ? "REPRODUCED" : "NOT_REPRODUCED",
  };
  await writeFile(out, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  check(evidence.verdict === "REPRODUCED", `unexpected verdict ${evidence.verdict}`);
  await context.close();
} finally {
  await Promise.allSettled([admin.dispose(), browser.close()]);
}
