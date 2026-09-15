import { chromium } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve("docs/audits/2026-09-13-ux-ui/admin");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(root, "annotated-before-after.html")).href);
  await page.locator("#mobile-artifact").screenshot({ path: path.join(root, "annotated-before-after-390.png") });
  await page.locator("#desktop-artifact").screenshot({ path: path.join(root, "annotated-before-after-1440.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(pathToFileURL(path.join(root, "flow-report.html")).href);
  await page.screenshot({ path: path.join(root, "evidence", "flow-report-preview.png"), fullPage: true });
} finally {
  await browser.close();
}
