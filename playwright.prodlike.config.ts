import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const evidenceDir = process.env.VERIFY_EVIDENCE_DIR?.trim() ||
  path.join(os.tmpdir(), "tab10-evidence", `browser-${process.pid}`);
const requestedBaseUrl = process.env.TAB10_E2E_BASE_URL?.trim() ||
  "http://localhost:4273";
const baseUrl = new URL(requestedBaseUrl);
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
if (!loopbackHosts.has(baseUrl.hostname.toLowerCase())) {
  throw new Error("State-changing production-like E2E is restricted to loopback");
}
if (baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash) {
  throw new Error("TAB10_E2E_BASE_URL must contain only an origin");
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(evidenceDir, "playwright-output"),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(evidenceDir, "playwright-results.json") }],
    ["html", { outputFolder: path.join(evidenceDir, "playwright-report"), open: "never" }],
  ],
  use: {
    baseURL: baseUrl.origin,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "chromium-mobile-390",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
