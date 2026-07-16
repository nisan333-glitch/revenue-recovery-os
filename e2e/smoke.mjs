// Durable end-to-end regression smoke test for the Design Partner-facing Assessment flow.
//
// Smallest useful guard: the critical happy path + the key fail-closed paths, plus the privacy
// invariant (zero external egress). It is NOT exhaustive browser testing. Self-contained: it builds
// nothing itself (run `npm run test:e2e`, which builds first), starts its own `vite preview`, drives
// Chromium via the already-present `playwright` dependency, and tears everything down. Deterministic:
// fixed CSV fixtures and the app's default asOf (2026-03-01). Exits non-zero on any failure.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4173;
const URL_BASE = `http://localhost:${PORT}/`;
// Pre-installed Chromium in this environment; fall back to Playwright's managed browser elsewhere.
const CHROMIUM = "/opt/pw-browsers/chromium";
const execPath = existsSync(CHROMIUM) ? CHROMIUM : undefined;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} · ${name}${detail ? ` · ${detail}` : ""}`);
};

// --- Fixtures --------------------------------------------------------------------------------------
const CANONICAL =
  "entity_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency\n" +
  "E1,2026-01-01,,2026-02-01,10000.00,USD\n" + // stalled + unpaid → Observed $10,000.00
  "E2,2026-01-01,2026-01-10,2026-02-01,5000.00,USD"; // activated → reference
const FOREIGN =
  "customer_id,created_at,activated_at,invoice_due_date,amount,ccy\n" + // synonyms → guided mapping
  "E1,2026-01-01,,2026-02-01,10000.00,USD";
const AMBIG =
  "entity_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency\n" +
  "E1,2026-01-01,,2026-02-01,1.200,USD"; // "1.200" ambiguous → fails closed until a format is chosen
// Duplicate header → parseCsv fails closed → error surfaces on Upload (never guesses which column).
const INVALID =
  "entity_id,signed_at,next_invoice_due_at,next_invoice_amount,next_invoice_amount,currency\n" +
  "E1,2026-01-01,2026-02-01,10000.00,5000.00,USD";

// --- Preview server --------------------------------------------------------------------------------
function startPreview() {
  const vite = resolve(ROOT, "node_modules/vite/bin/vite.js");
  const child = spawn(process.execPath, [vite, "preview", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child;
}
async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(URL_BASE);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("preview server did not become reachable");
}
function stopPreview(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* ignore */
  }
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
}

// --- Run -------------------------------------------------------------------------------------------
const preview = startPreview();
let browser;
const netlog = [];
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true, ...(execPath ? { executablePath: execPath } : {}) });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("request", (r) => netlog.push(r.url()));

  const upload = (content, name) =>
    page.locator('input[type=file]').setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(content, "utf8") });
  const gotoAssessment = () => page.getByRole("button", { name: "Revenue Opportunity Assessment" }).click();
  const freshAssessment = async () => {
    await page.goto(URL_BASE, { waitUntil: "load" });
    await gotoAssessment();
  };

  // 1 · Valid canonical CSV → Data Quality + Observed (known value).
  await freshAssessment();
  await upload(CANONICAL, "canonical.csv");
  await page.getByText("Data quality & cohort").waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: "Observed result →" }).click();
  await page.getByText("Observed unpaid", { exact: true }).waitFor({ timeout: 8000 });
  const observedOk = (await page.locator("body").innerText()).includes("$10,000.00");
  check("1 valid canonical CSV → Observed $10,000.00", observedOk);

  // 2 · Foreign-header CSV → guided mapping → results.
  await freshAssessment();
  await upload(FOREIGN, "foreign.csv");
  await page.getByText("Confirm your columns").waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: "Run assessment →" }).click();
  const mappedOk = await page.getByText("Data quality & cohort").isVisible({ timeout: 8000 }).catch(() => false);
  check("2 foreign headers → guided mapping → results", mappedOk);

  // 3 · Ambiguous amount fails closed under auto, resolves under an explicit EU format.
  await freshAssessment();
  await upload(AMBIG, "ambig.csv");
  await page.getByText("Data quality & cohort").waitFor({ timeout: 8000 });
  const failsClosed = (await page.locator("body").innerText()).includes("ambiguous_amount");
  await freshAssessment();
  await page.getByLabel("Amount format").selectOption("EU");
  await upload(AMBIG, "ambig-eu.csv");
  await page.getByText("Data quality & cohort").waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: "Observed result →" }).click();
  await page.getByText("Observed unpaid", { exact: true }).waitFor({ timeout: 8000 });
  const resolvedEU = (await page.locator("body").innerText()).includes("$1,200.00");
  check("3 ambiguous amount fails closed (auto) and resolves (EU)", failsClosed && resolvedEU, `failsClosed=${failsClosed} eu=${resolvedEU}`);

  // 4 · Invalid input → visible error, no crash.
  await freshAssessment();
  await upload(INVALID, "invalid.csv");
  await page.waitForTimeout(300);
  const errVisible = await page.getByText(/duplicate column header/i).isVisible();
  const stillAlive = await page.getByRole("button", { name: "Download template" }).isVisible();
  check("4 invalid input → visible error, no crash", errVisible && stillAlive, `err=${errVisible} alive=${stillAlive}`);

  // 5 · Refresh clears session-only state.
  await freshAssessment();
  await upload(CANONICAL, "canonical.csv");
  await page.getByText("Data quality & cohort").waitFor({ timeout: 8000 });
  await page.reload({ waitUntil: "load" });
  await gotoAssessment();
  const backToUpload = await page.getByText("Upload your CSV").isVisible();
  const dqGone = !(await page.getByText("Data quality & cohort").isVisible().catch(() => false));
  check("5 refresh clears session-only state", backToUpload && dqGone, `upload=${backToUpload} dqGone=${dqGone}`);

  // 6 · No external network egress across the whole run.
  const origin = new global.URL(URL_BASE).origin;
  const external = netlog.filter((u) => !u.startsWith(origin) && !u.startsWith("data:") && !u.startsWith("blob:"));
  const csvInUrl = netlog.filter((u) => /entity_id|customer_id|E1,2026/.test(decodeURIComponent(u)));
  check("6 no external egress", external.length === 0 && csvInUrl.length === 0, `total=${netlog.length} external=${external.length} csvInUrl=${csvInUrl.length}`);
} catch (e) {
  check("harness", false, String(e));
} finally {
  if (browser) await browser.close().catch(() => {});
  stopPreview(preview);
}

const passed = results.filter((r) => r.ok).length;
console.log(`\nSMOKE: ${passed}/${results.length} passed`);
process.exit(passed === results.length && results.length > 0 ? 0 : 1);
