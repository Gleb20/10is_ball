import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const root = new URL("../", import.meta.url);
const outputs = [
  { source: "wireframes.html", image: "evidence/target-wireframes-1440.png" },
  { source: "flow-report.html", image: "evidence/flow-report-1440.png" },
];
const browser = await chromium.launch();
const results = [];
try {
  for (const item of outputs) {
    const sourcePath = new URL(item.source, root).pathname;
    const imagePath = new URL(item.image, root).pathname;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(pathToFileURL(sourcePath).href);
    const metrics = await page.evaluate(() => ({
      title: document.title,
      placeholders: document.body.innerText.match(/\{\{[^}]+\}\}/g) ?? [],
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    await page.screenshot({ path: imagePath, fullPage: true });
    results.push({ ...item, ...metrics, noHorizontalOverflow: metrics.scrollWidth === metrics.clientWidth });
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(new URL("./artifact-render-check.json", import.meta.url), `${JSON.stringify({ browser: `Chromium ${browser.version()}`, viewport: "1440x1000", results }, null, 2)}\n`, "utf8");
