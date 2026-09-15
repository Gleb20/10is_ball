#!/usr/bin/env node
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, locale: "ru-RU" });
  await page.goto(`file://${path.join(root, "wireframes.html")}`);
  const captures = [
    ["#create-390", "wireframe-create-390.png"],
    ["#detail-390", "wireframe-detail-390.png"],
    ["#create-1440", "wireframe-create-1440.png"],
    ["#detail-1440", "wireframe-detail-1440.png"],
  ];
  for (const [selector, name] of captures) {
    await page.locator(selector).screenshot({ path: path.join(import.meta.dirname, name) });
  }
  await page.goto(`file://${path.join(root, "flow-report.html")}`);
  await page.screenshot({ path: path.join(import.meta.dirname, "flow-report-preview.png"), fullPage: true });
} finally {
  await browser.close();
}
