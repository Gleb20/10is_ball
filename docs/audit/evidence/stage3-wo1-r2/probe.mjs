import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const root = "docs/audit/evidence/stage3-wo1-r2";
const stage = process.env.WO1_PROBE_STAGE ?? "green";
const mode = process.env.WO1_PROBE_MODE ?? "page";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.addInitScript(() => {
  const original = Element.prototype.scrollIntoView;
  window.__r2ScrollIntoViewCalls = 0;
  Element.prototype.scrollIntoView = function (...args) {
    window.__r2ScrollIntoViewCalls += 1;
    return original.apply(this, args);
  };
});
await page.goto(`http://127.0.0.1:4179/wo1-r2.html${mode === "dialog" ? "?dialog=1" : ""}`);
const input = page.getByRole("combobox", { name: "Игрок" });
await input.fill("Игрок");
for (let i = 0; i < 20; i++) await input.press("ArrowDown");
const measure = () => page.evaluate(() => {
  const field = document.querySelector("[role=combobox]");
  const clip = document.querySelector('[data-probe="clip"]');
  const outer = document.querySelector('[data-probe="outer"]');
  const menu = document.querySelector('[data-name="menu"]');
  const list = document.querySelector('[role="listbox"]');
  const active = document.getElementById(field?.getAttribute("aria-activedescendant") ?? "");
  const rect = (element) => element?.getBoundingClientRect().toJSON();
  const f = rect(field), c = rect(clip), m = rect(menu), a = rect(active);
  const hit = a && document.elementFromPoint((a.left + a.right) / 2, (a.top + a.bottom) / 2);
  return {
    field: f, clip: c, menu: m, active: a,
    above: f?.top - c?.top - 8, below: c?.bottom - f?.bottom - 8,
    menuPosition: menu ? getComputedStyle(menu).position : null,
    menuStyleTop: menu?.style.top, outerScrollTop: outer?.scrollTop,
    listScrollTop: list?.scrollTop,
    activeVisibleInClip: Boolean(a && c && a.top >= c.top && a.bottom <= c.bottom),
    activeVisibleOnScreen: Boolean(a && a.top >= 0 && a.bottom <= innerHeight),
    activeHitTest: Boolean(active && hit && (active === hit || active.contains(hit))),
    scrollIntoViewCalls: window.__r2ScrollIntoViewCalls,
    focusRetained: document.activeElement === field,
    selectedId: document.querySelector('[data-probe="selected"]')?.textContent,
    selectedValue: field?.value,
  };
});
const initial = await measure();
await page.screenshot({ path: `${root}/${stage}-${mode}-short-clip.png`, fullPage: true });
await page.locator('[data-probe="outer"]').evaluate((element) => { element.scrollTop += 30; });
await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const afterManualScroll = await measure();
await input.press("Enter");
const afterEnter = await measure();
const result = { mode, viewport: "390x844", initial, afterManualScroll, afterEnter };
writeFileSync(`${root}/${stage}-${mode}-short-clip.json`, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
if (stage === "green" && !(initial.above < 60 && initial.below < 60 && initial.menuPosition === "fixed" && initial.activeVisibleOnScreen && initial.activeHitTest && initial.focusRetained && initial.selectedId === "" && afterManualScroll.scrollIntoViewCalls === initial.scrollIntoViewCalls && afterEnter.selectedId === "u20" && afterEnter.focusRetained)) {
  throw new Error("R2 constrained-clip acceptance failed");
}
await browser.close();
