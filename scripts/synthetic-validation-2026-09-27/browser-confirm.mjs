// One pass through the real UI, to confirm the operator's screen reports the same number the API did.
//
// The API runs already proved what NH computes. This proves an operator would SEE it — a different
// claim, and one no server test can make. It drives the same two screens a pilot uses: propose and
// activate the bar, then upload and run the governed execution.
//
// It asserts one thing above all: the figure on screen equals `observedUnpaidMinor` from score.json,
// formatted. If the screen and the server disagree, that is the finding.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = `${ROOT}/e2e/fixtures/synthetic-validation-2026-09-27`;
const API_PORT = Number(process.env.SV_API_PORT ?? 4200);
const UI_PORT = Number(process.env.SV_UI_PORT ?? 5299);
const UI = `http://127.0.0.1:${UI_PORT}/`;
const CHROMIUM = "/opt/pw-browsers/chromium";

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required."); process.exit(2); }

const truth = JSON.parse(readFileSync(`${DIR}/ground-truth.json`, "utf8"));
const prediction = JSON.parse(readFileSync(`${DIR}/prediction.json`, "utf8"));
const score = JSON.parse(readFileSync(`${DIR}/score.json`, "utf8"));
const apiRun = score.datasets.find((d) => d.label === "permissive/dataset");
const expectedHeadlineMinor = apiRun.money.observedUnpaid.nhMinor;
const expectedHeadline = (expectedHeadlineMinor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const RUN = randomUUID().slice(0, 8);
const BOUNDARY = `sv-browser-${RUN}`;
const POLICY_ID = `sv-browser-bar-${RUN}`;
const BAR = prediction.admissionPolicyPermissive;
// EP-26b · The definition the screen must CITE rather than let anyone type. Same frozen values the API
// runs read under, so the browser and the API are answering the same question.
const TERMS = prediction.governedAssessmentPolicies.primary;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} · ${name}${detail ? ` · ${detail}` : ""}`);
};

function startProcess(label, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT, detached: true, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (b) => process.env.SV_VERBOSE && console.log(`[${label}] ${b}`));
  child.stderr.on("data", (b) => process.env.SV_VERBOSE && console.error(`[${label}] ${b}`));
  return child;
}
const stop = (c) => { try { process.kill(-c.pid, "SIGTERM"); } catch { /* gone */ } };
const api = startProcess("api", [resolve(ROOT, "node_modules/.bin/vite-node"), "server/index.ts"], {
  PORT: String(API_PORT), HOST: "127.0.0.1",
  NH_AGENTS_ENABLED: "true", NH_AGENT_BOUNDARIES: BOUNDARY, NH_AGENT_IDLE_DELAY_MS: "200",
  NH_PILOT_ASSESSMENT_AGENT_ENABLED: "true",
  NH_PILOT_INPUT_TERMINAL_GRACE_HOURS: "24", NH_PILOT_INPUT_ABANDONED_RETENTION_DAYS: "7",
});
const ui = startProcess("ui", [resolve(ROOT, "node_modules/vite/bin/vite.js"),
  "--port", String(UI_PORT), "--strictPort", "--host", "127.0.0.1"], { API_PORT: String(API_PORT) });

let browser;
try {
  for (const probe of [`http://127.0.0.1:${API_PORT}/health`, UI]) {
    let up = false;
    for (let i = 0; i < 300 && !up; i += 1) {
      try { up = (await fetch(probe)).ok; } catch { /* not yet */ }
      if (!up) await new Promise((r) => setTimeout(r, 200));
    }
    if (!up) throw new Error(`never became ready: ${probe}`);
  }

  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? CHROMIUM });
  const page = await browser.newPage();
  await page.goto(UI, { waitUntil: "domcontentloaded" });

  // ── Governance: propose as the operator, activate as the steward ─────────────────────────────────
  await page.getByRole("button", { name: "Pilot Policy Governance" }).click();
  await page.getByLabel("Boundary (tenant)").fill(BOUNDARY);
  await page.getByLabel("Policy id").fill(POLICY_ID);
  await page.getByLabel("Policy version").fill("1.0.0");
  for (const [label, value] of [
    ["Min accepted rows", String(BAR.minAcceptedRows)],
    ["Min distinct entities", String(BAR.minDistinctEntities)],
    ["Min coverage (days)", String(BAR.minCoverageDays)],
    ["Max missing recommended cols", String(BAR.maxMissingRecommendedColumns)],
    ["Max rejection rate", String(BAR.maxRejectionRate)],
    ["Max single-reason share", String(BAR.maxSingleReasonShare)],
    ["Max duplicate rate", String(BAR.maxDuplicateRate)],
    ["Max ordering-defect rate", String(BAR.maxOrderingDefectRate)],
  ]) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel("I have reviewed lifecycle coverage").check();
  for (const state of BAR.requiredLifecycleStates) {
    await page.getByRole("group", { name: "Required lifecycle states" }).getByLabel(state, { exact: true }).check();
  }
  await page.getByLabel("Require provenance declaration").selectOption(String(BAR.requireProvenanceDeclaration));
  await page.getByLabel("Rationale (required on every act)").fill("synthetic validation, browser confirmation");
  await page.getByRole("button", { name: /^Propose as / }).click();
  await page.getByText("DRAFT", { exact: true }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  await page.getByRole("button", { name: /^Activate as / }).click();
  const lifecycle = () => page.getByText("3 · Lifecycle", { exact: true }).locator("..");
  await lifecycle().getByText("ACTIVE", { exact: true }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  check("the bar is ACTIVE before any data is uploaded",
    await lifecycle().getByText("ACTIVE", { exact: true }).isVisible());

  // ── EP-26b · Governance also puts the DEFINITION in force, as two identities ────────────────────
  // The cut-off, the stall threshold and the currency were typed on the upload screen when this script
  // was first written. They are not there any more, and the operator cites a definition instead — so this
  // script has to do what a pilot does, on the same screen, before any data exists.
  await page.getByLabel("Analysis-terms tenant").fill(BOUNDARY);
  await page.getByLabel("Terms id").fill(TERMS.termsId);
  await page.getByLabel("Terms version").fill(TERMS.termsVersion);
  await page.getByLabel("Analysis as-of date").fill(TERMS.asOf);
  await page.getByLabel("Stall threshold N (days)").fill(String(TERMS.stallThresholdDays));
  await page.getByLabel("Assessment currency").fill(TERMS.currency);
  await page.getByLabel("Reason for this terms act").fill("synthetic validation, browser confirmation of the definition");
  await page.getByRole("button", { name: /^Propose terms as / }).click();
  const termsState = page.getByLabel("Analysis terms state");
  await termsState.getByText("DRAFT", { exact: true }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  await page.getByRole("button", { name: /^Activate terms as / }).click();
  await termsState.getByText("ACTIVE", { exact: true }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  check("the DEFINITION is ACTIVE before any data is uploaded, activated by a second identity",
    (await termsState.getByText("ACTIVE", { exact: true }).isVisible()) &&
    (await page.getByLabel("Analysis terms lifecycle").innerText())
      .includes("two different identities, which is the point."));

  // ── Assessment: upload the frozen dataset and run the governed execution ─────────────────────────
  await page.getByRole("button", { name: "Revenue Opportunity Assessment" }).click();
  await page.getByLabel("Admission policy id").fill(POLICY_ID);
  await page.getByLabel("Admission policy version").fill("1.0.0");
  await page.getByLabel("Pilot boundary").fill(BOUNDARY);
  // EP-26b · THE LEVER IS GONE, asserted as an absence on the screen that benefits from the figure. A
  // server rule can be correct while the UI still offers a way past it, and this is the only place that
  // distinction can be measured.
  check("the upload screen offers NO way to type a cut-off, a stall threshold or a currency",
    (await page.getByLabel("Analysis as-of date").count()) === 0 &&
    (await page.getByLabel("Stall threshold N (days)").count()) === 0 &&
    (await page.getByLabel("Currency", { exact: true }).count()) === 0);
  await page.getByLabel("Dataset label").fill(`sv-browser-${RUN}`);
  await page.getByLabel("Contract system of record").fill("synthetic-crm");
  await page.getByLabel("Billing system of record").fill("synthetic-billing");
  await page.getByLabel("Product/telemetry source").fill("synthetic-telemetry");
  await page.getByLabel("Data owner (role, not a person)").fill("synthetic-revenue-operations");
  await page.getByLabel("Extraction method").fill("deterministic synthetic generator");
  await page.getByLabel("Extracted at (UTC)").fill("2026-06-30T00:00:00.000Z");
  await page.getByLabel("Coverage start").fill(truth.provenanceCoverage.start);
  await page.getByLabel("Coverage end").fill(truth.provenanceCoverage.end);

  // A SELECTION from the menu governance activated, carrying its own as-of and N — not two values the
  // operator supplies. The option must be there before the file is sent, or the submission has no
  // definition to be read under and is refused.
  const termsOption = `${TERMS.termsId}@${TERMS.termsVersion}`;
  const termsMenu = page.getByLabel("Governed analysis terms");
  await termsMenu.locator(`option[value="${termsOption}"]`)
    .waitFor({ state: "attached", timeout: 15_000 }).catch(() => undefined);
  await termsMenu.selectOption(termsOption).catch(() => undefined);
  check(`the operator cites a governed definition from a menu (${termsOption})`,
    (await termsMenu.inputValue().catch(() => "")) === termsOption);

  await page.setInputFiles('input[type="file"]', `${DIR}/dataset.csv`);

  const readiness = page.getByRole("button", { name: "Pilot readiness →" });
  await readiness.waitFor({ timeout: 60_000 }).catch(() => undefined);
  check("the synthetic dataset is admitted through the UI", await readiness.isVisible());

  await readiness.click();
  await page.getByRole("button", { name: "Observed result →" }).click();
  await page.getByRole("button", { name: "Run governed execution" }).click();
  await page.getByText("Completed — an observation was recorded")
    .waitFor({ timeout: 180_000 }).catch(() => undefined);
  const main = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check("the governed execution completed in the browser",
    main.includes("Completed — an observation was recorded"));

  // THE POINT OF THIS SCRIPT, and it must be SCOPED. `main` also carries the browser's own local
  // preview, which computes the same figure from the same bytes — so asserting against `main` could
  // pass on the preview while the governed panel showed nothing. Everything below is read out of the
  // panel that renders ONLY from the server's finding.
  const governed = page.getByText("Observation — Revenue Opportunity, never money returned").locator("..");
  await governed.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
  const governedVisible = await governed.isVisible();
  check("the governed observation panel rendered, which happens only from a server finding", governedVisible);

  const panel = ((await governed.innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  check(`the governed panel shows the same headline the API reported ($${expectedHeadline})`,
    panel.includes(expectedHeadline), panel.slice(0, 220));

  // And the figure must carry its claim boundary where the figure is, not somewhere else on the page.
  // Case-insensitive on purpose: the label is CSS-uppercased, so innerText returns it shouting.
  check("the governed figure is labelled Revenue Opportunity and denies money returned",
    /revenue opportunity/i.test(panel) && /never money returned/i.test(panel));

  // WHICH of the five server figures the operator is actually shown. The panel renders observedUnpaid,
  // grossEligible and excludedValue — partialOutstanding and unknownValue are computed by the server and
  // do not appear here. Measured rather than assumed, and reported as a coverage observation.
  const partial = (apiRun.money.partialOutstanding.nhMinor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
  const unknown = (apiRun.money.unknownValue.nhMinor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
  check("the governed panel omits partialOutstanding and unknownValue (a reported observation, not a pass/fail of NH)",
    !panel.includes(partial) && !panel.includes(unknown),
    `partialOutstanding $${partial} and unknownValue $${unknown} are absent from the governed panel`);
} catch (e) {
  check("harness error", false, e instanceof Error ? e.message : String(e));
} finally {
  if (browser) await browser.close().catch(() => undefined);
  stop(ui); stop(api);
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} browser confirmation checks passed`);
process.exit(passed === results.length ? 0 : 1);
