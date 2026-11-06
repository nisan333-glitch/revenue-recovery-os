// THE CORRECTION LEDGER, IN A REAL BROWSER · Issue #18 Priority 2.
//
// WHY A SEPARATE SCRIPT AND NOT A SECTION IN `journey.mjs`. Ownership. `journey.mjs` carries the proof
// arc, which ChatGPT owns; a scoped addition that cannot collide with it is one that does not touch it.
// This harness reuses the same shape — real API process, real Vite dev server, real Chromium, real
// Postgres — so it is the same KIND of evidence, in its own file.
//
// WHY THE VITE DEV SERVER. `src/data/apiClient.ts` attaches the development identity headers only when
// `import.meta.env.DEV`, so against a production build every governed call would arrive
// unauthenticated and 401. This is the same reason `journey.mjs` gives.
//
// WHAT IT PROVES, and each is one of the owner's five named requirements:
//   1 · AuditRead authorization — the screen reads as an approver; an operator is refused 403.
//   2 · `null` renders NOT ESTABLISHABLE, never $0.00.
//   3 · upward and downward are two figures and never a difference.
//   4 · exact cents.
//   5 · no Revenue Returned claim anywhere on the page.
//
// WHAT IT DOES NOT PROVE, stated here so the run cannot be over-read: no billing action, no settlement,
// no collected money. Every figure is OBSERVED exposure under dispute on SYNTHETIC data.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API_PORT = Number(process.env.LEDGER_API_PORT ?? 4010);
const UI_PORT = Number(process.env.LEDGER_UI_PORT ?? 5209);
const UI_BASE = `http://127.0.0.1:${UI_PORT}/`;
const CHROMIUM = "/opt/pw-browsers/chromium";
const executablePath = existsSync(CHROMIUM) ? CHROMIUM : undefined;
const BOUNDARY = `ledger-${randomUUID().slice(0, 8)}`;

let failures = 0;
const recorded = [];
function check(name, ok, detail = "") {
  const line = `${ok ? "PASS" : "FAIL"} · ${name}${detail ? ` · ${detail}` : ""}`;
  recorded.push(line);
  console.log(line);
  if (!ok) failures += 1;
}
function halt(reason) {
  console.error(`HALTED · ${reason}`);
  failures += 1;
  throw new Error(reason);
}

function startProcess(label, command, args, env) {
  const child = spawn(command, args, {
    cwd: ROOT, detached: true, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (b) => process.env.LEDGER_VERBOSE && console.log(`[${label}] ${b}`));
  child.stderr.on("data", (b) => console.error(`[${label}] ${b}`));
  return child;
}

async function waitFor(label, probe, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try { if (await probe()) return; } catch (e) { last = e instanceof Error ? e.message : String(e); }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${label} unreachable within ${timeoutMs}ms${last ? ` (${last})` : ""}`);
}

const stop = (child) => {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
};

let api, ui, browser;
try {
  // The observations the ledger will read. The seeder prints what it wrote, and every expectation
  // below is taken from THAT report rather than restated here — two copies of a number drift.
  const seeded = JSON.parse(execFileSync("npx", [
    "vite-node", "scripts/seed-ledger-observations.ts", BOUNDARY,
  ], { cwd: ROOT, encoding: "utf8", env: process.env }));
  check(
    "correction observations are seeded for this boundary",
    seeded.expectedIdentities === 3 && seeded.expectedWithCorrections === 2,
    `${seeded.expectedIdentities} identities · ${seeded.expectedWithCorrections} corrections · ` +
      `${seeded.expectedOrderNotEstablishable} unorderable`,
  );

  api = startProcess("api", process.execPath,
    [resolve(ROOT, "node_modules/.bin/vite-node"), "server/index.ts"],
    { PORT: String(API_PORT), HOST: "127.0.0.1" });
  ui = startProcess("ui", process.execPath,
    [resolve(ROOT, "node_modules/vite/bin/vite.js"),
     "--port", String(UI_PORT), "--strictPort", "--host", "127.0.0.1"],
    { API_PORT: String(API_PORT) });
  await waitFor("api", async () => (await fetch(`http://127.0.0.1:${API_PORT}/health`)).ok);
  await waitFor("ui", async () => (await fetch(UI_BASE)).ok);

  // ── 1 · AUTHORIZATION, at the API, before the browser ────────────────────────────────────────────
  // The browser always asks as an approver by construction, which is itself the control — so the
  // operator refusal is asserted against the API directly. Both halves are labelled, because "the
  // screen does not offer it" and "the server refuses it" are different guarantees.
  const asRole = (role) => fetch(
    `http://127.0.0.1:${API_PORT}/candidate-corrections?boundaryId=${encodeURIComponent(BOUNDARY)}`,
    { headers: { "x-actor-id": `${role}@company`, "x-actor-role": role } },
  );
  const operator = await asRole("operator");
  check("API · an OPERATOR is refused 403 — the beneficiary does not read the ledger",
    operator.status === 403, `status=${operator.status}`);
  const author = await asRole("author");
  check("API · an AUTHOR is refused 403", author.status === 403, `status=${author.status}`);
  const anon = await fetch(
    `http://127.0.0.1:${API_PORT}/candidate-corrections?boundaryId=${encodeURIComponent(BOUNDARY)}`);
  check("API · an unauthenticated read is 401", anon.status === 401, `status=${anon.status}`);
  const approver = await asRole("approver");
  check("API · an APPROVER is allowed 200", approver.status === 200, `status=${approver.status}`);
  const injected = await fetch(
    `http://127.0.0.1:${API_PORT}/candidate-corrections?boundaryId=${encodeURIComponent(BOUNDARY)}&precedence=last_wins`,
    { headers: { "x-actor-id": "cfo@company", "x-actor-role": "approver" } });
  check("API · an injected precedence parameter is a 400, never a silent strip",
    injected.status === 400, `status=${injected.status}`);

  const payload = await approver.json();
  check("API · no identifier is in the response — no sourceRef, obligationRef or identity",
    !JSON.stringify(payload).includes("hmac-sha256:")
      && payload.records.every((r) => !("sourceRef" in r) && !("obligationRef" in r)),
    `${payload.records.length} records, each keyed by digest only`);

  // ── 2 · THE SCREEN, IN THE BROWSER ───────────────────────────────────────────────────────────────
  browser = await chromium.launch({ executablePath });
  const context = await browser.newContext();
  const page = await context.newPage();
  const requested = [];
  page.on("request", (r) => requested.push(r.url()));
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto(UI_BASE, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Correction Ledger" }).click();
  const ledger = page.getByTestId("correction-ledger");
  if (!(await ledger.count())) halt("the Correction Ledger screen did not render");

  // The screen states the capability it needs BEFORE anything is read, so a reviewer who lacks it
  // learns why rather than seeing an empty page.
  const beforeRead = await page.locator("main").innerText();
  check("the screen states the AuditRead requirement before any read",
    /AuditRead capability/i.test(beforeRead) && /operator is refused/i.test(beforeRead));

  const readButton = page.getByRole("button", { name: "Read ledger" });
  check("a blank boundary cannot be read — the button is disabled",
    await readButton.isDisabled());

  await page.getByLabel("Pilot boundary ID").fill(BOUNDARY);
  check("with a boundary the read becomes available", await readButton.isEnabled());
  await readButton.click();
  await page.getByTestId("precedence-notice").waitFor({ timeout: 15_000 });

  // ── 3 · THE FIVE REQUIREMENTS ────────────────────────────────────────────────────────────────────
  const totals = {
    identities: (await page.getByTestId("total-identities").innerText()).trim(),
    corrections: (await page.getByTestId("total-corrections").innerText()).trim(),
    upward: (await page.getByTestId("total-upward").innerText()).trim(),
    downward: (await page.getByTestId("total-downward").innerText()).trim(),
  };
  check("the ledger shows the seeded identities and corrections",
    totals.identities === String(seeded.expectedIdentities)
      && totals.corrections === String(seeded.expectedWithCorrections),
    JSON.stringify(totals));

  // EXACT CENTS. $200.00 and $400.00, not $200 and $400 — a disputed $0.50 must not round away.
  check("EXACT CENTS · the two magnitudes carry their cents",
    totals.upward === "$200.00" && totals.downward === "$400.00",
    `up=${totals.upward} down=${totals.downward}`);

  // NEVER NETTED. The difference would be -$200.00 and must appear nowhere.
  const pageText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check("NEVER NETTED · the two figures are separate and their difference is absent",
    !pageText.includes("-$200.00") && /never netted/i.test(pageText));

  // NULL IS NOT ESTABLISHABLE. The tied identity has no stored figure, and $0.00 would claim the store
  // holds nothing — a different and false statement.
  const unorderable = page.locator('[data-state="ORDER_NOT_ESTABLISHABLE"]');
  check("the unorderable identity is rendered as its own refusal state",
    (await unorderable.count()) === seeded.expectedOrderNotEstablishable,
    `${await unorderable.count()} card(s)`);
  const unorderableText = (await unorderable.first().innerText()).replace(/\s+/g, " ");
  check("NULL IS NOT ESTABLISHABLE · the tied identity shows no figure and no zero",
    unorderableText.includes("NOT ESTABLISHABLE") && !unorderableText.includes("$0.00"),
    unorderableText.slice(0, 120));
  check("the tied identity still lists every amount observed — the doubt is about ORDER",
    unorderableText.includes("$300.00") && unorderableText.includes("$900.00"));
  check("and it is excluded from both monetary figures, said in words",
    /excluded from both figures/i.test(
      (await page.getByTestId("order-uncertain-count").innerText())));

  // NO REVENUE RETURNED CLAIM. The term appears only inside its own negation, so the ban is on the
  // CLAIM and not on the word — a guard that matched the term would fail on the sentence that makes
  // the point.
  const claims = [/Revenue Returned[^.]{0,20}\$/, /\bRecovered\b[^.]{0,20}\$/, /\bCollected\b[^.]{0,20}\$/,
    /was recovered/i, /money returned/i, /has been collected/i];
  check("NO MONEY CLAIM · the page asserts no recovered or collected amount",
    claims.every((c) => !c.test(pageText)));
  check("and it says so explicitly: the figures are never summed into Revenue Returned",
    /never summed into Revenue Returned/i.test(pageText));

  // The dispute is reported in the SERVER's words, not the screen's paraphrase.
  check("the precedence notice is the server's own wording",
    /is NOT decided here/i.test(await page.getByTestId("precedence-notice").innerText()));
  // THE OFFER, NOT THE WORD. The first form of this banned the word "authoritative" and failed on the
  // server's own notice — "which statement is authoritative is NOT decided here" — which is the
  // sentence that makes the point. A guard that matches a term rather than a claim is the trap this
  // repository keeps recording, and this is its third appearance in my own instruments. What is banned
  // is a LABELLED FIGURE: an authoritative amount is only ever offered as a label beside a number.
  const offers = [
    /Corrected amount[^$]{0,20}\$/i, /Authoritative[^$]{0,20}\$/i,
    /Effective amount[^$]{0,20}\$/i, /Resolved amount[^$]{0,20}\$/i,
    /Use this amount/i, /Apply correction/i,
  ];
  check("no authoritative amount is OFFERED anywhere on the page",
    offers.every((o) => !o.test(pageText)));
  check("and the only use of the word is the server's own refusal to decide",
    /authoritative is NOT decided here/i.test(pageText));

  // ── 4 · HYGIENE ──────────────────────────────────────────────────────────────────────────────────
  check("no raw pseudonymous reference is shown on the page",
    !pageText.includes("hmac-sha256:"));
  check("the page made no request outside its own origin",
    requested.every((u) => u.startsWith(UI_BASE) || u.startsWith(`http://127.0.0.1:${UI_PORT}`)),
    `${requested.length} request(s)`);
  check("no uncaught page error occurred", pageErrors.length === 0, pageErrors.join(" | "));
} catch (error) {
  console.error(`LEDGER JOURNEY ERROR · ${error instanceof Error ? error.message : String(error)}`);
  failures = Math.max(failures, 1);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  stop(ui);
  stop(api);
}

console.log(`\n${recorded.length - failures}/${recorded.length} recorded checks passed`);
console.log(
  "SYNTHETIC · every figure above is OBSERVED exposure under dispute. No billing action was taken, " +
  "no settlement was observed, and no money was collected.",
);
if (failures > 0) {
  console.error(`LEDGER JOURNEY FAILED (${failures} problem(s))`);
  process.exit(1);
}
console.log("LEDGER JOURNEY PASSED");
