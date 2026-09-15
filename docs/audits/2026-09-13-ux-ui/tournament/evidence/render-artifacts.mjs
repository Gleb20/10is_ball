import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve("docs/audits/2026-09-13-ux-ui/tournament");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1200 }, deviceScaleFactor: 1 });
await page.goto(new URL(`file://${path.join(root, "annotated-before-after.html")}`).href);
await page.locator('[data-render="mobile"]').screenshot({ path: path.join(root, "annotated-before-after-390.png") });
await page.locator('[data-render="desktop"]').screenshot({ path: path.join(root, "annotated-before-after-desktop.png") });
await browser.close();
console.log("rendered annotated before/after: mobile + desktop");
