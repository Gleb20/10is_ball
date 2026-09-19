import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const root = "docs/audit/evidence/stage3-wo1-r2";
const browser = await chromium.launch({ headless: true });
const rows = [];
for (const zoom of [100, 200]) {
  const viewport = { width: zoom === 100 ? 360 : 720, height: 844 };
  const page = await browser.newPage({ viewport });
  await page.goto("http://127.0.0.1:4179/wo1-r2-states.html");
  if (zoom !== 100) await page.evaluate((value) => { document.documentElement.style.zoom = `${value}%`; }, zoom);
  await page.keyboard.press("Tab");
  const field = await page.evaluate(() => {
    const input = document.querySelector("input");
    const wrapper = input?.parentElement;
    const helper = document.querySelector('[id$="-helper"]');
    return { focusVisible: input?.matches(":focus-visible"), inputOutlineStyle: input ? getComputedStyle(input).outlineStyle : null,
      wrapperOutlineStyle: wrapper ? getComputedStyle(wrapper).outlineStyle : null,
      wrapperOutlineWidth: wrapper ? getComputedStyle(wrapper).outlineWidth : null,
      helperText: helper?.textContent, helperRect: helper?.getBoundingClientRect().toJSON(),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
  });
  const picker = page.getByRole("combobox", { name: "Выбор игрока" });
  await picker.fill("Длинная");
  await picker.press("ArrowDown");
  await picker.press("Enter");
  const selection = await page.evaluate(() => ({ selectedId: document.querySelector('[data-probe="selected"]')?.textContent,
    pickerFocus: document.activeElement?.getAttribute("role") === "combobox",
    pickerRect: document.querySelector('[role="combobox"]')?.getBoundingClientRect().toJSON(),
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth }));
  await page.screenshot({ path: `${root}/states-effective360-csszoom${zoom}.png`, fullPage: true });
  rows.push({ viewport, effectiveCssWidth: 360, method: zoom === 100 ? "normal" : "CSS zoom on documentElement at 720px viewport, not browser UI zoom", zoom, field, selection });
  await page.close();

  const dialog = await browser.newPage({ viewport });
  await dialog.goto("http://127.0.0.1:4179/wo1-r2-states.html?dialog=1");
  if (zoom !== 100) await dialog.evaluate((value) => { document.documentElement.style.zoom = `${value}%`; }, zoom);
  const card = dialog.locator('[data-testid="bracket-algo-card-power_of_two"]');
  await card.click();
  await dialog.keyboard.press("Tab");
  await card.locator("input").focus();
  const radio = await dialog.evaluate(() => {
    const card = document.querySelector('[data-testid="bracket-algo-card-power_of_two"]');
    const input = card?.querySelector("input");
    const panel = document.querySelector('[role="dialog"]');
    return { checked: input?.checked, cardSelected: card?.classList.contains("bracket-algo-card--selected"),
      cardOutlineStyle: card ? getComputedStyle(card).outlineStyle : null,
      cardOutlineWidth: card ? getComputedStyle(card).outlineWidth : null,
      inputOutlineStyle: input ? getComputedStyle(input).outlineStyle : null,
      cardRect: card?.getBoundingClientRect().toJSON(), panelRect: panel?.getBoundingClientRect().toJSON(),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
  });
  await dialog.screenshot({ path: `${root}/radio-effective360-csszoom${zoom}.png`, fullPage: true });
  rows.push({ viewport, effectiveCssWidth: 360, method: zoom === 100 ? "normal" : "CSS zoom on documentElement at 720px viewport, not browser UI zoom", zoom, radio });
  await dialog.close();
}
writeFileSync(`${root}/states-360.json`, JSON.stringify({ browser: "Playwright Chromium", rows }, null, 2) + "\n");
console.log(JSON.stringify(rows));
await browser.close();
