import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, "wireframes");
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(here, "target-wireframes.html")).href);
  for (const id of ["judge-landscape-target", "match-detail-desktop-target", "judge-mobile-recovery-target"]) {
    const frame = page.locator(`#${id}`);
    if ((await frame.count()) !== 1) throw new Error(`Missing unique wireframe: ${id}`);
    await page.locator(`#${id}`).screenshot({ path: path.join(output, `${id}.png`) });
  }

  await page.goto(pathToFileURL(path.join(here, "..", "flow-report.html")).href);
  const reportText = await page.locator("body").innerText();
  if (reportText.includes("{{")) throw new Error("Unresolved placeholder in flow-report.html");
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflows) throw new Error("Horizontal overflow in flow-report.html");
} finally {
  await browser.close();
}
