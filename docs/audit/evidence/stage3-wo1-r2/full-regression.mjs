import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const root = "docs/audit/evidence/stage3-wo1-r2";
const browser = await chromium.launch({ headless: true });
const rows = [];
for (const mode of ["page", "dialog"]) {
  const viewports = mode === "page"
    ? [{ width: 360, height: 844 }, { width: 390, height: 844 }, { width: 1280, height: 800 }, { width: 390, height: 500 }]
    : [{ width: 360, height: 844 }, { width: 390, height: 844 }, { width: 1280, height: 800 }];
  for (const viewport of viewports) {
    const { width } = viewport;
    const page = await browser.newPage({ viewport });
    await page.goto(`http://127.0.0.1:4179/wo1-r2-full.html${mode === "dialog" ? "?dialog=1" : ""}`);
    const input = page.getByRole("combobox", { name: "Игрок" });
    await input.fill("Игрок");
    for (let index = 0; index < 20; index++) await input.press("ArrowDown");
    const active = await page.evaluate(() => {
      const input = document.querySelector('[role="combobox"]');
      const option = document.getElementById(input?.getAttribute("aria-activedescendant") ?? "");
      const list = document.querySelector('[role="listbox"]');
      const rect = (node) => node?.getBoundingClientRect().toJSON();
      const optionRect = rect(option);
      let clipped = false;
      for (let ancestor = option?.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(ancestor).overflowY)) continue;
        const boundary = ancestor.getBoundingClientRect();
        if (optionRect.top < boundary.top - 1 || optionRect.bottom > boundary.bottom + 1) clipped = true;
      }
      return { input: rect(input), option: optionRect, optionId: option?.id, clipped,
        onScreen: Boolean(optionRect && optionRect.top >= 0 && optionRect.bottom <= innerHeight),
        focusRetained: document.activeElement === input, listScrollTop: list?.scrollTop };
    });
    if (width === 360) await page.screenshot({ path: `${root}/${mode}-active-360.png`, fullPage: true });
    await input.press("Enter");
    const selectedId = await page.locator('[data-probe="selected"]').textContent();
    const focusAfterEnter = await input.evaluate((element) => document.activeElement === element);
    await input.fill("Несовпадение");
    const empty = await page.evaluate(() => {
      const input = document.querySelector('[role="combobox"]');
      const status = document.querySelector('[role="status"]');
      const rect = status?.getBoundingClientRect();
      return { listboxExists: Boolean(document.getElementById(input?.getAttribute("aria-controls") ?? "")),
        activeIdref: input?.getAttribute("aria-activedescendant"), statusText: status?.textContent,
        statusOnScreen: Boolean(rect && rect.top >= 0 && rect.bottom <= innerHeight) };
    });
    if (mode === "page") {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    } else {
      await input.evaluate((element) => {
        for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
          if (/(auto|scroll)/.test(getComputedStyle(ancestor).overflowY) && ancestor.scrollHeight > ancestor.clientHeight) {
            ancestor.scrollTop += 600;
            break;
          }
        }
      });
    }
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const expandedAfterManualScroll = await input.getAttribute("aria-expanded");
    const row = { mode, viewport, active, selectedId, focusAfterEnter, empty, expandedAfterManualScroll };
    rows.push(row);
    console.log(JSON.stringify(row));
    if (!(active.onScreen && !active.clipped && active.focusRetained && selectedId === "u20" && focusAfterEnter && empty.listboxExists && empty.activeIdref === null && empty.statusOnScreen && expandedAfterManualScroll === "false")) throw new Error(`${mode} ${width} regression failed`);
    await page.close();
  }
}
writeFileSync(`${root}/full-regression.json`, JSON.stringify({ rows }, null, 2) + "\n");
await browser.close();
