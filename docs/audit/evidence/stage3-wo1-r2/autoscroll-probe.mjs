import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const root = "docs/audit/evidence/stage3-wo1-r2";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 500 } });
await page.goto("http://127.0.0.1:4179/wo1-r2-full.html");
const initial = await page.evaluate(() => ({ scrollY, field: document.querySelector('[role="combobox"]')?.getBoundingClientRect().toJSON() }));
await page.evaluate(() => document.querySelector('[role="combobox"]')?.focus({ preventScroll: true }));
const input = page.getByRole("combobox", { name: "Игрок" });
await input.getAttribute("aria-expanded");
for (let index = 0; index < 20; index++) await input.press("ArrowDown");
const after = await page.evaluate(() => {
  const field = document.querySelector('[role="combobox"]');
  const menu = document.querySelector('[data-name="menu"]');
  const active = document.getElementById(field?.getAttribute("aria-activedescendant") ?? "");
  const f = field?.getBoundingClientRect(), m = menu?.getBoundingClientRect(), a = active?.getBoundingClientRect();
  const hit = a && document.elementFromPoint((a.left + a.right) / 2, (a.top + a.bottom) / 2);
  return { scrollY, field: f?.toJSON(), menu: m?.toJSON(), menuTopStyle: menu?.style.top,
    active: a?.toJSON(), activeHitTest: Boolean(active && hit && (active === hit || active.contains(hit))),
    focusRetained: document.activeElement === field, expanded: field?.getAttribute("aria-expanded") };
});
const result = { viewport: "390x500", method: "native focus({preventScroll:true}) while field starts below viewport", initial, after };
writeFileSync(`${root}/autoscroll-remeasure.json`, JSON.stringify(result, null, 2) + "\n");
await page.screenshot({ path: `${root}/autoscroll-remeasure.png`, fullPage: true });
console.log(JSON.stringify(result));
if (!(initial.field.top > 500 && after.scrollY > 0 && after.field.top >= 0 && after.field.bottom <= 500 && after.menuTopStyle !== "0px" && after.activeHitTest && after.focusRetained && after.expanded === "true")) throw new Error("Post-scroll placement was stale");
await browser.close();
