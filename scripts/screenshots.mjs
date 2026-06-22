// Captures a screenshot of every module against the running dev/preview server.
//
// Usage (locally, where the Chromium download is permitted):
//   npx playwright install chromium
//   npm run build && npm run preview &   # or: npm run dev
//   node scripts/screenshots.mjs [baseUrl]
//
// Output: docs/screenshots/*.png
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const baseUrl = process.argv[2] ?? "http://localhost:4173";
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../docs/screenshots");
mkdirSync(outDir, { recursive: true });

// [nav label, output filename]. Labels match the sidebar buttons in App.tsx.
const SHOTS = [
  ["Executive Dashboard", "01-executive-dashboard"],
  ["CFO Proof View", "02-cfo-proof-view"],
  ["Reconciliation", "03-reconciliation"],
  ["Attribution Engine", "04-attribution-engine"],
  ["Recovery Queue", "05-recovery-queue"],
  ["Recovery Events", "06-recovery-events"],
  ["Recovery Reasons", "07-recovery-reasons"],
  ["Confidence Score", "08-confidence-score"],
  ["Audit Trail", "09-audit-trail"],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
await page.goto(baseUrl, { waitUntil: "networkidle" });

for (const [label, file] of SHOTS) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.waitForTimeout(350);
  const path = `${outDir}/${file}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log("captured", path);
}

// Bonus: open an event detail drawer on the Events table for the workflow view.
await page.getByRole("button", { name: "Recovery Events", exact: true }).click();
await page.waitForTimeout(300);
await page.getByText("Northwind Trading").first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/10-event-detail.png`, fullPage: true });
console.log("captured", `${outDir}/10-event-detail.png`);

await browser.close();
console.log("\nDone. Screenshots written to docs/screenshots/");
