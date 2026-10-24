// EP-19 · The complete pilot journey, in a real browser, against the real API, worker and database.
//
// WHAT THIS PROVES that no in-process test can: that the screens a pilot actually touches reach a
// governed server finding, and that the figure on the final screen is the SERVER's number rather
// than something the browser worked out for itself. Those two claims are the product.
//
// Three things make this harness different from `e2e/smoke.mjs`:
//
//   1. It uses the Vite DEV server, not `vite preview`. `apiClient.ts` attaches development identity
//      headers only when `import.meta.env.DEV`, so against a production build every governed call
//      would arrive unauthenticated and 401. A preview-based harness could not reach the API at all.
//   2. It starts a real Fastify process with a real worker loop over a real PostgreSQL database.
//   3. The two governance halves are performed by two DIFFERENT identities, because the server
//      refuses them from one — which is the point of the separation, not a detail of the screen.
//
// Deterministic: a fixed synthetic CSV, a fixed as-of date, a boundary derived once per run.
// Exits non-zero on any failure. Never uses real or disguised customer data.
//
// ── THE DATABASE CONTRACT · deliberate, not incidental ────────────────────────────────────────────
//
// THIS HARNESS IS REPEATABLE ON ONE DATABASE, and that is a commitment rather than something that
// happens to work. Every identifier it writes under is derived per run — the tenant boundary, the
// admission-policy id and the analysis-terms id — so two runs against the same database occupy two
// disjoint tenants and cannot collide on a primary key, inherit each other's governance state, or read
// each other's rows. Every count this file asserts is scoped to its own `BOUNDARY` for the same
// reason: a global count would measure other runs and would drift the moment one was repeated.
//
// SO A SECOND RUN ON THE SAME DATABASE IS A REAL TEST, not a convenience — it is the repeat/idempotency
// case, and it must pass with the same number of checks and the same verdicts as the first. The
// precondition below is what makes the claim checkable rather than asserted: this run's boundary must
// hold NOTHING before the run writes anything. A leaked row, a reused identifier or a boundary that
// survived a previous run fails there, by name, instead of surfacing later as an inexplicable count.
//
// WHAT IS NOT CLAIMED: the harness does not clean up after itself and is not required to. Rows
// accumulate, which is correct for append-only storage; they accumulate in other tenants, where this
// run cannot see them.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API_PORT = Number(process.env.JOURNEY_API_PORT ?? 4000);
const UI_PORT = Number(process.env.JOURNEY_UI_PORT ?? 5199);
const UI_BASE = `http://127.0.0.1:${UI_PORT}/`;
const CHROMIUM = "/opt/pw-browsers/chromium";
const executablePath = existsSync(CHROMIUM) ? CHROMIUM : undefined;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — this harness runs against a real database on purpose.");
  process.exit(2);
}

// One boundary per run. The worker polls a fixed boundary list, so it has to be known before the
// server starts; deriving it here (rather than hardcoding) keeps repeat runs from colliding.
const BOUNDARY = `journey-${randomUUID().slice(0, 8)}`;
const RECONCILER_PSEUDONYM_KEY = `journey-${randomUUID()}-${randomUUID()}`;
const POLICY_ID = `journey-bar-${randomUUID().slice(0, 8)}`;
const POLICY_VERSION = "1.0.0";
const AS_OF = "2026-03-01";
// EP-26 · The governed analysis terms this run reads under. A definition, not two form fields.
const TERMS_ID = `journey-terms-${randomUUID().slice(0, 8)}`;
const TERMS_VERSION = "1.0.0";
const STALL_N = "30";
const CURRENCY = "USD";

// ── The synthetic evidence source ─────────────────────────────────────────────────────────────────
//
// Section 13 ingests outcome evidence, which must carry an Ed25519 attestation from the SOURCE system.
// The point of that mechanism is that the beneficiary does not hold the signing key, so the key is
// generated here, per run, and split: the API process is given only the PUBLIC half, and the private
// half reaches `scripts/seed-journey-case-evidence.ts` and nothing else. Nothing is written to disk,
// nothing survives the run, and no deployment ever sees it.
const EVIDENCE_KEY_ID = `JOURNEY-billing-${randomUUID().slice(0, 8)}`;
const evidenceKeys = generateKeyPairSync("ed25519");
const EVIDENCE_PUBLIC_KEYS = JSON.stringify([
  {
    keyId: EVIDENCE_KEY_ID,
    sourceSystem: "billing",
    publicKey: evidenceKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  },
]);
const EVIDENCE_PRIVATE_KEY = evidenceKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const results = [];
let section14Start = -1;
const uiStates = [];
const EVIDENCE_DIR = process.env.JOURNEY_EVIDENCE_DIR ? resolve(process.env.JOURNEY_EVIDENCE_DIR) : null;
if (EVIDENCE_DIR) mkdirSync(EVIDENCE_DIR, { recursive: true });
let failures = 0;
let halted = null;
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} · ${name}${detail ? ` · ${detail}` : ""}`);
  if (!ok) annotate(`FAIL · ${name}${detail ? ` · ${detail}` : ""}`);
}
/**
 * Surface a failure as a GitHub Actions error annotation. Annotations are readable from the check-run
 * record by anyone who can see the run, which a raw job log is not always (log download can be refused
 * where the check-run API is not). It prints a plain line outside Actions, so it is inert locally.
 */
function annotate(message) {
  const text = String(message).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").slice(0, 900);
  console.log(`::error title=journey::${text}`);
}
/**
 * A dev-identity label ("Dana Levy (operator)") reduced to the actor id the API expects.
 *
 * Declared here, with the other pure helpers, because it is used from the database-contract
 * precondition in section 1a — it previously sat below that, where a `const` is hoisted but not yet
 * initialised, so the first use would have thrown a ReferenceError instead of checking anything.
 */
const bareId = (label) => label.replace(/\s*\(.*\)$/, "").trim();

function checkEqual(name, actual, expected) {
  check(name, actual === expected, actual === expected ? "" : `expected ${expected}, got ${actual}`);
}

// ── Structural unreachability ──────────────────────────────────────────────────────────────────────
// A stage can depend on a condition that, if unmet, makes every later step STRUCTURALLY unreachable —
// not merely likely to fail. `Pilot readiness →` is the case in hand: with no ACTIVE admission bar the
// server answers NOT_ASSESSABLE, the gate blocks, and the button is never rendered, so clicking it can
// only spend its 30s timeout and die. NC-17 — activation rewired to an identity lacking
// `ActivatePilotPolicy` — lands exactly there: it recorded its intended authorization failures and then
// fell into a bare `locator.click: Timeout 30000ms exceeded`, an abort with no stated reason.
//
// `haltIf` ends the run at that point, deliberately, with the reason printed. Three properties make it
// a termination rather than a way to go quiet:
//
//   * it is NOT a catch — it swallows no error and suppresses no failure;
//   * it passes nothing. The unreached checks are reported as unreached, never as passes;
//   * it CANNOT fire on a healthy journey. It refuses to halt unless a check has already been
//     recorded as failed, so the cause is on the record before the stop — and a halt requested with
//     a clean record is itself recorded as a failure of this harness.
class JourneyHalted extends Error {
  constructor(reason) {
    super(reason);
    this.name = "JourneyHalted";
  }
}
function haltIf(unreachable, reason) {
  if (!unreachable) return;
  if (failures === 0) {
    check(`the harness halted with no recorded failure to justify it — ${reason}`, false);
  }
  throw new JourneyHalted(reason);
}

// ── Fixture ────────────────────────────────────────────────────────────────────────────────────────
// Generated by the repository's own deterministic generator, so the browser journey and the server
// matrix are exercising the same bytes. Written to a temp file because the screen takes a file pick.
// `npm run test:journey` writes these first, via `scripts/write-journey-fixture.ts`, so the bytes
// come from the same generator the server matrix uses rather than a copy pasted in here.
const CSV_PATH = join(ROOT, "e2e/fixtures/journey.synthetic.csv");
// A SECOND dataset for the frozen-policy section, from the same generator at a different size.
// EP-23 claimed this was forced by the duplicate rule; section 10 shows it was not, because the
// idempotency key includes the dataset LABEL and the frozen section supplies a fresh one. It stays
// because distinct bytes leave no reading under which section 11 could be observing a duplicate.
const FROZEN_CSV_PATH = join(ROOT, "e2e/fixtures/journey.frozen.synthetic.csv");
// The bytes the repeats section re-uploads. It is CSV_PATH — the whole point is that they are the SAME
// bytes the server already accepted — and it exists as its own name only so NC-26 can point it at a
// different file and demonstrate that the section's claim really rests on exact-byte identity rather
// than on "uploading a similar CSV". A harness that cannot be made to fail is not evidence.
const REPEAT_CSV_PATH = CSV_PATH;
// The dataset label the first upload uses, reused verbatim by the repeat. It has to be a known value
// rather than a fresh uuid, because the idempotency identity is derived from
// (boundaryId, datasetId, sha256(csvText)) — the LABEL is part of it. See section 10.
const JOURNEY_DATASET_LABEL = `journey-${randomUUID().slice(0, 8)}`;
for (const path of [CSV_PATH, FROZEN_CSV_PATH]) {
  if (!existsSync(path)) {
    console.error("missing journey fixture — run `npm run fixture:journey` first (test:journey does).");
    process.exit(2);
  }
}
const { policy: SCENARIO_POLICY, scenarios: RISK_SCENARIOS } = JSON.parse(
  readFileSync(join(ROOT, "e2e/fixtures/journey.fixture.json"), "utf8"),
);

// ── Processes ──────────────────────────────────────────────────────────────────────────────────────
function startProcess(label, command, args, env) {
  const child = spawn(command, args, {
    cwd: ROOT,
    detached: true,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (b) => process.env.JOURNEY_VERBOSE && console.log(`[${label}] ${b}`));
  child.stderr.on("data", (b) => console.error(`[${label}] ${b}`));
  return child;
}

function startApi() {
  return startProcess("api", process.execPath, [resolve(ROOT, "node_modules/.bin/vite-node"), "server/index.ts"], {
    PORT: String(API_PORT),
    HOST: "127.0.0.1",
    // The worker must be running for an execution to leave `queued`.
    NH_AGENTS_ENABLED: "true",
    NH_AGENT_BOUNDARIES: BOUNDARY,
    NH_AGENT_IDLE_DELAY_MS: "200",
    // EP-18: the assessment agent publishes no candidates, so it needs no admission-policy registry.
    // Supplying a fabricated RecoveryType:threshold pair here would put an invented number into the
    // configuration of a test whose whole subject is not inventing numbers.
    NH_PILOT_ASSESSMENT_AGENT_ENABLED: "true",
    // Section 13 · the activation detector, which DOES publish candidates and therefore does need an
    // economic bar. The threshold is the journey's own, named here rather than hidden in the seeder,
    // and it is deliberately BELOW the observation's at-risk amount so the candidate is admitted —
    // section 13 asserts the number the screen shows against the number the seeder reports.
    NH_ACTIVATION_DETECTOR_ENABLED: "true",
    // Section 14 adds the reconciliation observer and ITS economic bar. The pseudonym key is the
    // deployment secret that turns a payer reference into the opaque reference the queue shows; it is
    // ephemeral and per run, it lives in the API process only, and the seeder never sees it.
    NH_RECONCILIATION_OBSERVER_ENABLED: "true",
    NH_RECONCILER_PSEUDONYM_KEY: RECONCILER_PSEUDONYM_KEY,
    NH_AGENT_ADMISSION_POLICIES: "ActivationMissed:5000,RevenueUnderBilled:10000",
    // Section 14 · the PRIVATE synthetic demo, which is OFF unless asked for. It generates its own
    // ephemeral signing key inside this process and registers only the public half with the verifier;
    // this harness never holds that key. The boundary is the journey's own, so the worker serves it.
    NH_SYNTHETIC_DEMO_ENABLED: "true",
    NH_SYNTHETIC_DEMO_BOUNDARY: BOUNDARY,
    // Only the PUBLIC half. The API can verify an attestation and cannot produce one.
    NH_EVIDENCE_SOURCE_KEYS: EVIDENCE_PUBLIC_KEYS,
    NH_PILOT_INPUT_TERMINAL_GRACE_HOURS: "24",
    NH_PILOT_INPUT_ABANDONED_RETENTION_DAYS: "7",
  });
}

function startUi() {
  return startProcess("ui", process.execPath, [
    resolve(ROOT, "node_modules/vite/bin/vite.js"),
    "--port", String(UI_PORT), "--strictPort", "--host", "127.0.0.1",
  ], { API_PORT: String(API_PORT) });
}

async function waitFor(label, probe, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${label} did not become reachable within ${timeoutMs}ms${last ? ` (${last})` : ""}`);
}

function stop(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
}

// ── The journey ────────────────────────────────────────────────────────────────────────────────────
let api, ui, browser;
try {
  api = startApi();
  ui = startUi();
  await waitFor("api", async () => (await fetch(`http://127.0.0.1:${API_PORT}/health`)).ok);
  await waitFor("ui", async () => (await fetch(UI_BASE)).ok);

  browser = await chromium.launch({ executablePath });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Every request the page makes, so "no external egress" is a measured claim, not an assumption.
  const requested = [];
  page.on("request", (r) => requested.push(r.url()));
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto(UI_BASE, { waitUntil: "domcontentloaded" });

  // ── 1 · Governance: the operator proposes the bar ────────────────────────────────────────────────
  await page.getByRole("button", { name: "Pilot Policy Governance" }).click();
  await page.getByLabel("Boundary (tenant)").fill(BOUNDARY);
  await page.getByLabel("Policy id").fill(POLICY_ID);
  await page.getByLabel("Policy version").fill(POLICY_VERSION);
  for (const [label, value] of [
    ["Min accepted rows", String(SCENARIO_POLICY.minAcceptedRows)],
    ["Min distinct entities", String(SCENARIO_POLICY.minDistinctEntities)],
    ["Min coverage (days)", String(SCENARIO_POLICY.minCoverageDays)],
    ["Max missing recommended cols", String(SCENARIO_POLICY.maxMissingRecommendedColumns)],
    ["Max rejection rate", String(SCENARIO_POLICY.maxRejectionRate)],
    ["Max single-reason share", String(SCENARIO_POLICY.maxSingleReasonShare)],
    ["Max duplicate rate", String(SCENARIO_POLICY.maxDuplicateRate)],
    ["Max ordering-defect rate", String(SCENARIO_POLICY.maxOrderingDefectRate)],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  // The review gate first: the three state boxes are disabled until it is ticked, so an untouched form
  // cannot half-state a policy.
  await page.getByLabel("I have reviewed lifecycle coverage").check();
  for (const state of SCENARIO_POLICY.requiredLifecycleStates) {
    await page.getByRole("group", { name: "Required lifecycle states" }).getByLabel(state, { exact: true }).check();
  }
  await page.getByLabel("Require provenance declaration").selectOption(String(SCENARIO_POLICY.requireProvenanceDeclaration));
  await page.getByLabel("Rationale (required on every act)").fill("journey fixture bar");

  const proposeButton = page.getByRole("button", { name: /^Propose as / });
  const activateButton = page.getByRole("button", { name: /^Activate as / });

  // An out-of-range threshold must NAME the field. A silently disabled button sends an operator hunting
  // through eight boxes, and `validateAdmissionPolicy` already returns the field and the reason.
  await page.getByLabel("Max duplicate rate", { exact: true }).fill("1.1");
  const defect = page.getByLabel("Policy threshold errors").getByText(/maxDuplicateRate:.*between 0 and 1/);
  // waitFor before sampling: isVisible() reads the DOM as it is right now, so a check that ran before
  // React flushed would report the defect list missing when it had merely not rendered yet. A false
  // FAIL here is noise; the same race in the other direction is how a real gap gets a green tick.
  await defect.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  check("an invalid threshold names the field and blocks proposal",
    (await defect.isVisible()) && !(await proposeButton.isEnabled()));
  await page.getByLabel("Max duplicate rate", { exact: true }).fill(String(SCENARIO_POLICY.maxDuplicateRate));
  const proposerName = (await proposeButton.textContent())?.replace("Propose as ", "").trim() ?? "";
  const stewardName = (await activateButton.textContent())?.replace("Activate as ", "").trim() ?? "";

  // ── 1a · The database contract, checked before this run writes anything ─────────────────────────
  //
  // See the header: this harness is repeatable on one database because every identifier it writes under
  // is derived per run. That is only true if the boundary really is untouched when the run starts, so it
  // is measured rather than assumed — a leaked row, a reused identifier or a boundary that outlived a
  // previous run fails HERE, by name, rather than surfacing later as a count nobody can explain.
  const startingState = await page.evaluate(async ([boundaryId, actorId]) => {
    const get = async (path) => {
      const res = await fetch(path, { headers: { "x-actor-id": actorId, "x-actor-role": "operator" } });
      return { status: res.status, body: res.ok ? await res.json() : await res.text() };
    };
    return {
      executions: await get(`/api/pilot/assessments?boundaryId=${encodeURIComponent(boundaryId)}`),
      terms: await get(`/api/pilot/analysis-terms/list?boundaryId=${encodeURIComponent(boundaryId)}`),
    };
  }, [BOUNDARY, bareId(proposerName)]);
  const startedEmpty =
    startingState.executions.status === 200 &&
    (startingState.executions.body?.length ?? -1) === 0 &&
    startingState.terms.status === 200 &&
    (startingState.terms.body?.terms?.length ?? -1) === 0;
  check(
    "this run's tenant is empty before it writes anything — so a repeat on one database is isolated",
    startedEmpty,
    `executions=${startingState.executions.body?.length} terms=${startingState.terms.body?.terms?.length}`,
  );
  haltIf(!startedEmpty,
    "the tenant this run derived already holds rows, so every scoped count below would be measuring " +
      "another run's state and a passing journey would prove nothing about this one");
  check(
    "the two governance acts are offered as two different identities",
    proposerName !== "" && stewardName !== "" && proposerName !== stewardName,
    `${proposerName} vs ${stewardName}`,
  );

  await proposeButton.click();
  // The state pill and the "judges nothing" verdict are BOTH rendered from the lifecycle read that
  // `act` performs after the write — a read that needs `AuditRead`. So the wait degrades instead of
  // throwing: if the read is refused, this must be a RECORDED failure attributable to this check, not
  // a harness abort that ends the run with nothing said about anything downstream (the NC-7 lesson).
  const barState = page.getByLabel("Admission bar state");
  await barState.getByText("DRAFT", { exact: true }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  check("a proposed bar is DRAFT and judges nothing",
    (await barState.getByText("DRAFT", { exact: true }).isVisible()) &&
    (await barState.getByText("judges nothing").isVisible()));

  // ── 2 · Governance: a DIFFERENT identity puts it in force ────────────────────────────────────────
  await activateButton.click();
  await barState.getByText("ACTIVE", { exact: true }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  check("an activated bar may judge a dataset",
    (await barState.getByText("ACTIVE", { exact: true }).isVisible()) &&
    (await barState.getByText("may judge a dataset").isVisible()));

  // A lifecycle belongs to one exact boundary, policy id and version. Editing any of them must
  // immediately hide the old ACTIVE verdict — the state, the "may judge" pill and the hash together.
  const policyIdInput = page.getByLabel("Policy id", { exact: true });
  await policyIdInput.fill(`${POLICY_ID}-other`);
  check("changing policy identity hides the old ACTIVE verdict",
    (await barState.getByText("not proposed", { exact: true }).isVisible()) &&
    !(await barState.getByText("may judge a dataset").count()) &&
    !(await page.getByText("Policy hash", { exact: false }).count()));
  // Restoring the identity does NOT restore the verdict: it has to be read again, deliberately.
  await policyIdInput.fill(POLICY_ID);
  check("restoring the identity still requires an explicit re-read",
    await barState.getByText("not proposed", { exact: true }).isVisible());
  await page.getByRole("button", { name: "Read lifecycle", exact: true }).click();
  await barState.getByText("ACTIVE", { exact: true }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  check("an explicit re-read restores the ACTIVE verdict for the selected identity",
    (await page.getByText("ACTIVE", { exact: true }).isVisible()) &&
    (await page.getByText("may judge a dataset").isVisible()));

  // SEPARATION OF DUTIES, read out of the SERVER's audit trail — not off the buttons.
  //
  // This check used to be `page.locator("main").innerText()` containing both identity strings. The
  // Propose and Activate buttons are in `main` and render those exact strings, so it passed on the
  // labels alone: suppressing the entire audit panel left it green and the journey at 61/61. It was
  // the assertion claiming to prove two-actor governance, and it proved nothing.
  //
  // Everything below is scoped to the audit panel, which the screen renders ONLY from a successful
  // lifecycle read — and that read requires `AuditRead`, which the operator does not hold. So the
  // panel's mere existence is evidence the UI performed it as a steward.
  const audit = page.getByText("Who decided what", { exact: false }).locator("..");
  await audit.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  check("the governance audit trail loaded, which requires an AuditRead identity",
    await audit.isVisible());

  // Degrade to empty rather than throwing: if the panel is absent the two checks below must be
  // RECORDED failures, not a harness abort that stops the run and reports nothing (the NC-7 lesson).
  const auditText = ((await audit.innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  check("the audit trail records both transitions, each attributed to its own actor",
    auditText.includes("PROPOSED") && auditText.includes("ACTIVATED") &&
    auditText.includes(bareId(proposerName)) && auditText.includes(bareId(stewardName)),
    auditText.slice(0, 200));

  // Rendered from the server's own proposedBy/activatedBy comparison, so it cannot be satisfied by a
  // label. The negative sentence is asserted absent too: the screen says outright when one identity
  // did both, and that wording appearing here would mean the server allowed what it must refuse.
  check("the server recorded two DIFFERENT identities for the two governance acts",
    auditText.includes("two different identities, which is the point.") &&
    !auditText.includes("the same identity, which the server should not have allowed."));

  /**
   * Cite the governed definition on the upload screen.
   *
   * A SELECTION, not two values: the menu is the set of definitions governance activated, and the option
   * carries its own as-of and N so the operator can see what they are citing. The wait is for the menu to
   * arrive — it is fetched per boundary — and it DEGRADES rather than throwing, so a failure here is a
   * recorded check attributable to this step instead of a harness abort (the NC-7 lesson).
   */
  async function selectGovernedTerms() {
    const menu = page.getByLabel("Governed analysis terms");
    const option = `${TERMS_ID}@${TERMS_VERSION}`;
    await menu
      .locator(`option[value="${option}"]`)
      .waitFor({ state: "attached", timeout: 15_000 })
      .catch(() => undefined);
    await menu.selectOption(option).catch(() => undefined);
    return option;
  }

  /**
   * Give a boundary its own ACTIVE analysis-terms version, through the screen, as the two identities.
   *
   * Needed because a definition belongs to ONE boundary: a second tenant does not inherit the first
   * tenant's cut-off, which is the same isolation the admission bar has. Driving it through the UI here
   * rather than calling the API keeps the cross-boundary section honest — the boundary really is usable.
   */
  async function governTermsFor(boundaryId, termsVersion = TERMS_VERSION) {
    await page.goto(UI_BASE, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Pilot Policy Governance" }).click();
    await page.getByLabel("Analysis-terms tenant").fill(boundaryId);
    await page.getByLabel("Terms id").fill(TERMS_ID);
    await page.getByLabel("Terms version").fill(termsVersion);
    await page.getByLabel("Analysis as-of date").fill(AS_OF);
    await page.getByLabel("Stall threshold N (days)").fill(STALL_N);
    await page.getByLabel("Assessment currency").fill(CURRENCY);
    await page.getByLabel("Reason for this terms act")
      .fill(`journey fixture: ${termsVersion} for ${boundaryId}`);
    await page.getByRole("button", { name: /^Propose terms as / }).click();
    await page.getByLabel("Analysis terms state").getByText("DRAFT", { exact: true })
      .waitFor({ timeout: 15_000 }).catch(() => undefined);
    await page.getByRole("button", { name: /^Activate terms as / }).click();
    await page.getByLabel("Analysis terms state").getByText("ACTIVE", { exact: true })
      .waitFor({ timeout: 15_000 }).catch(() => undefined);
  }

  // ── 2b · EP-26 · The analysis terms are governed, and the UI offers no way around it ────────────
  //
  // The server-side suite proves the rule; only a browser can prove there is no LEVER — that the two
  // fields an operator used to type are gone from the screen that benefits from the figure. This is the
  // class of defect this branch keeps finding: a rule can be correct while the UI still offers a way
  // past it.
  await page.getByLabel("Analysis-terms tenant").fill(BOUNDARY);
  await page.getByLabel("Terms id").fill(TERMS_ID);
  await page.getByLabel("Terms version").fill(TERMS_VERSION);
  await page.getByLabel("Analysis as-of date").fill(AS_OF);
  await page.getByLabel("Stall threshold N (days)").fill(STALL_N);
  await page.getByLabel("Assessment currency").fill(CURRENCY);
  await page.getByLabel("Reason for this terms act").fill("journey fixture: the quarter cut-off");

  const proposeTerms = page.getByRole("button", { name: /^Propose terms as / });
  const activateTerms = page.getByRole("button", { name: /^Activate terms as / });
  const termsProposer = (await proposeTerms.textContent())?.replace("Propose terms as ", "").trim() ?? "";
  const termsSteward = (await activateTerms.textContent())?.replace("Activate terms as ", "").trim() ?? "";
  check(
    "proposing and activating the DEFINITION are offered as two different identities",
    termsProposer !== "" && termsSteward !== "" && termsProposer !== termsSteward,
    `${termsProposer} vs ${termsSteward}`,
  );

  // An out-of-range threshold must name the field rather than silently disabling the button.
  await page.getByLabel("Stall threshold N (days)").fill("4000");
  const termsDefect = page.getByLabel("Analysis terms errors").getByText(/stallThresholdDays: must be at most/);
  await termsDefect.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  check("an out-of-range stall threshold names the field and blocks the proposal",
    (await termsDefect.isVisible()) && !(await proposeTerms.isEnabled()));
  await page.getByLabel("Stall threshold N (days)").fill(STALL_N);

  await proposeTerms.click();
  const termsState = page.getByLabel("Analysis terms state");
  // Wait for DRAFT itself. "measures nothing" is the default reading of an unread selection, so waiting
  // on that sentence would be satisfied before the proposal was recorded — a wait that waits for nothing.
  await termsState.getByText("DRAFT", { exact: true }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  check("a proposed definition is DRAFT and measures nothing",
    (await termsState.getByText("DRAFT", { exact: true }).isVisible()) &&
    (await termsState.getByText("measures nothing").isVisible()));

  await activateTerms.click();
  await termsState.getByText("ACTIVE", { exact: true }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  check("an activated definition may measure a dataset",
    (await termsState.getByText("ACTIVE", { exact: true }).isVisible()) &&
    (await termsState.getByText("measures a dataset").isVisible()));

  // Read from the SERVER's own proposedBy/activatedBy comparison, not from the button labels — the
  // NC-19 lesson, applied to the new panel rather than trusted to generalise.
  const termsAudit = await page.getByLabel("Analysis terms lifecycle").innerText();
  check("the server recorded two DIFFERENT identities for the definition's two acts",
    termsAudit.includes("two different identities, which is the point.") &&
    !termsAudit.includes("the same identity, which the server should not have allowed."),
    termsAudit.slice(0, 120));

  // ── 3 · Assessment: intake and admission ────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Revenue Opportunity Assessment" }).click();
  await page.getByLabel("Admission policy id").fill(POLICY_ID);
  await page.getByLabel("Admission policy version").fill(POLICY_VERSION);
  await page.getByLabel("Pilot boundary").fill(BOUNDARY);
  // EP-26 · NO CUT-OFF AND NO THRESHOLD ON THIS SCREEN. Asserted as an absence, because the guard this
  // slice adds is precisely the removal of a lever: if either input came back, a requester could define
  // the measurement again and every server-side assertion would still pass.
  check("the upload screen offers NO way to type a cut-off, a stall threshold or a currency",
    (await page.getByLabel("Analysis as-of date").count()) === 0 &&
    (await page.getByLabel("Stall threshold N (days)").count()) === 0 &&
    (await page.getByLabel("Currency", { exact: true }).count()) === 0);
  // The boundary must be set before the menu of governed definitions can load for it.
  await page.getByLabel("Dataset label").fill(JOURNEY_DATASET_LABEL);
  await page.getByLabel("Contract system of record").fill("synthetic-crm");
  await page.getByLabel("Billing system of record").fill("synthetic-billing");
  await page.getByLabel("Product/telemetry source").fill("synthetic-telemetry");
  await page.getByLabel("Data owner (role, not a person)").fill("synthetic-revenue-operations");
  await page.getByLabel("Extraction method").fill("synthetic deterministic generator");
  await page.getByLabel("Extracted at (UTC)").fill("2026-03-01T00:00:00.000Z");
  await page.getByLabel("Coverage start").fill("2026-01-01");
  await page.getByLabel("Coverage end").fill("2026-03-31");
  await selectGovernedTerms();

  // The server's own receipt for this submission, kept for the repeat section below: its
  // `idempotencyKey` is what the repeat has to collide with. Captured here rather than reconstructed,
  // because a key the harness derived itself would prove only that the harness can hash.
  const firstIntake = page.waitForResponse(
    (r) => r.url().includes("/api/pilot/datasets") && r.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page.setInputFiles('input[type="file"]', CSV_PATH);
  const firstIntakeBody = await firstIntake
    .then((r) => (r.ok() ? r.json() : null))
    .catch(() => null);

  // Admitted ⇒ the flow leaves Upload on its own. Before EP-19 it could not, because the UI never
  // sent an admission policy id and the server therefore always answered NOT_ASSESSABLE.
  // `check(..., true)` used to stand here, with the bare `waitFor` above as the only real gate. That
  // records a PASS for a condition it never sampled, and if the wait ever throws the run aborts with
  // this check never reported at all. Both halves are now the assertion.
  const readiness = page.getByRole("button", { name: "Pilot readiness →" });
  await readiness.waitFor({ timeout: 30_000 }).catch(() => undefined);
  const admitted = await readiness.isVisible();
  check("an admitted dataset leaves the upload screen", admitted);
  // The gate between "a dataset was admitted" and everything that inspects a run. Sections 4-10 read
  // a cohort, a preview, an execution and a ledger that only exist downstream of an admitted dataset,
  // and the first of them clicks this very button. Without it there is nothing to assert against and
  // no way to reach the assertions, so the journey stops here with the cause already recorded above.
  haltIf(!admitted, "no dataset was admitted, so the cohort, preview, governed execution and ledger " +
    "steps have no run to inspect and the button that opens them is not on the page");

  // ── 4 · The browser's own figure is reachable, and is labelled a preview ─────────────────────────
  await readiness.click();
  await page.getByRole("button", { name: "Observed result →" }).click();
  const previewText = await page.locator("main").innerText();
  check(
    "the browser figure says it was computed in this browser",
    /local preview/i.test(previewText) && /in this browser/i.test(previewText),
  );
  check(
    "the browser figure denies being an execution, a Proof or Revenue Returned",
    /not an execution, a Proof, or Revenue Returned/i.test(previewText.replace(/\s+/g, " ")),
  );

  // ── 5 · The governed execution ───────────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Run governed execution" }).click();

  // `completed` is the only acceptable end. A timeout here is a failure of the journey, not a pass:
  // the screen is required to show a timeout as a timeout, and this harness is required to fail.
  // The execution-state pill, specifically — the event log below it also contains the word, and
  // matching either would let a COMPLETED event on a run that is still settling read as a result.
  // Degrading rather than throwing so that a refused or stalled execution is reported by the NAMED
  // check below — a harness abort here would end the run with the execution checks never printed, and
  // an authorization defect in the intake path would look like a broken harness instead of a failure.
  await page.getByText("Completed — an observation was recorded")
    .waitFor({ timeout: 90_000 }).catch(() => undefined);
  // Scoped to <main>, NOT the whole body. The sidebar carries a standing "Auditable recovered"
  // total for the separate proven ledger — that belongs there, and matching it would turn correct
  // two-ledger chrome into a false failure while hiding a real one in the noise.
  const executionText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check(
    "the governed execution reached a server-reported completion",
    /Completed — an observation was recorded/.test(executionText),
  );

  // ── 6 · The displayed figures are the SERVER's, not the browser's ────────────────────────────────
  const proposerId = proposerName.replace(/\s*\(.*\)$/, "").trim();
  const listed = await page.evaluate(async ([boundaryId, actorId]) => {
    const res = await fetch(`/api/pilot/assessments?boundaryId=${encodeURIComponent(boundaryId)}`, {
      headers: { "x-actor-id": actorId, "x-actor-role": "operator" },
    });
    // Surfaced rather than swallowed: an unauthorised read must not be indistinguishable from a
    // boundary that genuinely holds no execution.
    return { status: res.status, body: res.ok ? await res.json() : await res.text() };
  }, [BOUNDARY, proposerId]);
  checkEqual("the execution list is readable by the acting operator", listed.status, 200);
  // The endpoint returns a bare array, not a wrapper object.
  const executions = Array.isArray(listed.body) ? listed.body : [];
  const executionId = executions[0]?.executionId ?? null;
  check("exactly one execution exists for this boundary", executions.length === 1,
    `status=${listed.status} count=${executions.length}`);

  const apiView = executionId
    ? await page.evaluate(async ([boundaryId, id, actorId]) => {
        const res = await fetch(
          `/api/pilot/assessments/${id}?boundaryId=${encodeURIComponent(boundaryId)}`,
          { headers: { "x-actor-id": actorId, "x-actor-role": "operator" } },
        );
        return res.ok ? res.json() : null;
      }, [BOUNDARY, executionId, proposerId])
    : null;

  checkEqual("the API agrees the execution completed", apiView?.state, "completed");
  const finding = apiView?.finding?.finding ?? null;
  check("the API produced a finding", finding !== null);
  if (finding) {
    // The load-bearing comparison of the whole harness: the number on the screen is the number the
    // server computed. A browser-side figure that merely happened to look plausible would fail here.
    check(
      `the screen shows the server's cycle count (${finding.acceptedCycleCount})`,
      executionText.includes(String(finding.acceptedCycleCount)),
    );
    const minorToText = (minor) =>
      (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    check(
      `the screen shows the server's observed unpaid amount (${minorToText(finding.observedUnpaidMinor)})`,
      executionText.includes(minorToText(finding.observedUnpaidMinor)),
    );
    check("the execution is bound to an admission decision", Boolean(apiView.binding?.admissionDecisionId));
  }

  // ── 7 · Nothing on the result claims proven money ────────────────────────────────────────────────
  //
  // Banning the words outright would be the wrong test: this panel SHOULD say "no dollar here has
  // been recovered, proven, or counted", and a check that failed on that would push the honest
  // sentence off the screen. So the rule is the repository's existing one for retracted claims —
  // the proven-ledger vocabulary may appear only inside a denial of itself.
  const NEGATION = /\b(no|not|never|nothing|without)\b/i;
  for (const term of ["Revenue Returned", "Auditable", "recovered", "proven"]) {
    const pattern = new RegExp(`(.{0,60})\\b${term}\\b`, "gi");
    const claims = [];
    for (const match of executionText.matchAll(pattern)) {
      if (!NEGATION.test(match[1] ?? "")) claims.push(`…${match[1]}${term}`);
    }
    check(
      `the governed result mentions "${term}" only to deny it`,
      claims.length === 0,
      claims.slice(0, 2).join(" | "),
    );
  }
  // And the denial must actually be present, not merely un-contradicted: an empty panel would pass
  // every check above while telling the reader nothing about what the figure is not.
  check(
    "the governed result states plainly that nothing here was recovered, proven or counted",
    /no dollar here has been recovered, proven, or counted/i.test(executionText),
  );
  check(
    "the governed result names itself Revenue Opportunity",
    /Revenue Opportunity/i.test(executionText),
  );

  // ── 8 · Each generated data-risk scenario, through the actual upload screen ────────────────────
  // The API/worker matrix checks the domain decision. These checks also catch a browser that shows
  // a misleading verdict, promotes a preflight refusal to a server verdict, or lets a refused
  // dataset leave Upload. Each file gets a fresh screen and dataset id; all share the activated bar.
  /**
   * What the report panel SHOWS, asserted identically whether the dataset was admitted or refused.
   *
   * One helper rather than two copies: a dataset can be correctly admitted by the server and still be
   * displayed with the wrong counts, or with a rejected row's code silently dropped. That is the class
   * of defect only a browser can see, and it is no less serious on the admitted path.
   */
  /**
   * The number a Counter shows, compared EXACTLY.
   *
   * Not `endsWith`: a counter displaying 31 where 1 is expected ends with "1" and would pass. NC-12
   * caught that — sabotaging the panel to show `dataRows` left `one-valid-row` green, because its
   * expected accepted count is 1 and the wrong value was 31. The value is the counter's last token,
   * with the thousands separator `toLocaleString` adds removed.
   */
  function counterValue(text) {
    const last = text.trim().split(/\s+/).pop() ?? "";
    return Number(last.replace(/,/g, ""));
  }

  async function checkVisibleReport(scenario) {
    const report = page.locator("main");
    const accepted = await page.getByText("Accepted", { exact: true }).locator("..").innerText();
    const rejected = await page.getByText("Rejected", { exact: true }).locator("..").innerText();
    check(`${scenario.id}: the visible accepted/rejected counts match the fixture`,
      counterValue(accepted) === scenario.expected.acceptedRows &&
      counterValue(rejected) === scenario.expected.rejectedRows,
      `accepted=${counterValue(accepted)} rejected=${counterValue(rejected)} ` +
      `expected ${scenario.expected.acceptedRows}/${scenario.expected.rejectedRows}`);
    for (const code of scenario.expected.codes) {
      check(`${scenario.id}: the report names ${code}`,
        (await report.getByText(code, { exact: true }).count()) > 0);
    }
  }

  /**
   * A fresh assessment screen with the provenance declaration filled in.
   *
   * Extracted because the frozen-policy section below needs the identical thirteen fields: two copies
   * would drift, and a drifted copy is how a section ends up asserting against a form the product no
   * longer has. `page.goto` first — navigating away unmounts `Assessment` (App.tsx renders screens
   * conditionally), so every upload genuinely starts from an empty screen.
   */
  async function openIntakeScreen(datasetLabel) {
    await page.goto(UI_BASE, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Revenue Opportunity Assessment" }).click();
    await page.getByLabel("Admission policy id").fill(POLICY_ID);
    await page.getByLabel("Admission policy version").fill(POLICY_VERSION);
    await page.getByLabel("Pilot boundary").fill(BOUNDARY);
    await page.getByLabel("Dataset label").fill(datasetLabel);
    await page.getByLabel("Contract system of record").fill("synthetic-crm");
    await page.getByLabel("Billing system of record").fill("synthetic-billing");
    await page.getByLabel("Product/telemetry source").fill("synthetic-telemetry");
    await page.getByLabel("Data owner (role, not a person)").fill("synthetic-revenue-operations");
    await page.getByLabel("Extraction method").fill("synthetic deterministic generator");
    await page.getByLabel("Extracted at (UTC)").fill("2026-03-01T00:00:00.000Z");
    await page.getByLabel("Coverage start").fill("2026-01-01");
    await page.getByLabel("Coverage end").fill("2026-03-31");
    await selectGovernedTerms();
  }

  for (const scenario of RISK_SCENARIOS) {
    await openIntakeScreen(`matrix-${scenario.id}-${randomUUID().slice(0, 8)}`);

    const serverReply = scenario.expected.usableForAssessment
      ? page.waitForResponse(
          (r) => r.url().includes("/api/pilot/datasets") && r.request().method() === "POST",
          { timeout: 30_000 },
        )
      : null;
    await page.setInputFiles('input[type="file"]', {
      name: `${scenario.id}.synthetic.csv`, mimeType: "text/csv",
      buffer: Buffer.from(scenario.csvText, "utf8"),
    });

    if (scenario.expected.admission === "ADMISSIBLE") {
      await page.getByRole("button", { name: "Pilot readiness →" }).waitFor({ timeout: 30_000 });
      const reply = await serverReply;
      const body = reply?.ok() ? await reply.json() : null;
      check(`${scenario.id}: admitted by the server and progressed in the browser`,
        body?.admission?.outcome === "ADMISSIBLE" &&
        body.counts?.acceptedRows === scenario.expected.acceptedRows &&
        body.counts?.rejectedRows === scenario.expected.rejectedRows);

      // The report panel is NOT on screen here: progressing moved the flow to the cohort step, which
      // unmounts it. `validation` survives that move (it is cleared only by the next upload), so going
      // back to Upload re-renders the panel with the SERVER result — deterministically, no race.
      await page.getByRole("button", { name: "← Upload" }).click();
      await page.getByText("Data contract validation", { exact: true }).waitFor({ timeout: 30_000 });
      check(`${scenario.id}: the admitted report is marked server-verified`,
        (await page.locator("main").innerText()).includes("server-verified"));
      await checkVisibleReport(scenario);
    } else {
      await page.getByText("Data contract validation", { exact: true }).waitFor({ timeout: 30_000 });
      const preliminary = !scenario.expected.usableForAssessment;
      if (preliminary) {
        // Preflight knows no active bar; "no policy configured" would misdescribe an activated bar as
        // missing. It reports contract usability only and makes no policy fitness claim.
        await page.getByText("pilot admission not evaluated", { exact: true }).waitFor({ timeout: 30_000 });
        check(`${scenario.id}: preflight makes no policy fitness claim`,
          (await page.locator("main").innerText()).includes("No admission policy was read here") &&
          (await page.getByText("Pilot admission", { exact: true }).count()) === 0);
      } else {
        const admissionPill = page.getByText("Pilot admission", { exact: true }).locator("..");
        await admissionPill.getByText(scenario.expected.admission.replace(/_/g, " ").toLowerCase(),
          { exact: true }).waitFor({ timeout: 30_000 });
      }
      const reply = await serverReply;
      if (!preliminary && !reply) throw new Error(`${scenario.id}: expected server verdict, got no response`);
      // An unusable file stops at local preflight and is labelled as such; a usable but unfit file
      // must receive an authoritative server verdict. Neither may expose the next-step button.
      const report = page.locator("main");
      const text = await report.innerText();
      check(`${scenario.id}: refusal has the correct authority and remains on Upload`,
        text.includes(preliminary ? "preview — not yet confirmed by the server" : "server-verified") &&
        (await page.getByRole("button", { name: "Pilot readiness →" }).count()) === 0);
      await checkVisibleReport(scenario);
      if (reply) {
        const body = await reply.json();
        check(`${scenario.id}: browser refusal agrees with the server`,
          body.admission?.outcome === scenario.expected.admission &&
          body.counts?.acceptedRows === scenario.expected.acceptedRows &&
          body.counts?.rejectedRows === scenario.expected.rejectedRows);
      }
    }
  }

  // ── 9 · A transport failure cannot turn a previous server verdict into permission ───────────────
  // The last matrix case leaves Upload visible. It may still carry an earlier server validation, so
  // interrupting the next submission tests both the error path and stale-verdict clearing.
  // PRECONDITION, asserted rather than assumed. The clearing check below is `count === 0`, which
  // passes trivially if the panel was never there. It IS there today — the last matrix scenario is an
  // admitted one, so the loop returned to Upload with a server-verified report — but that is incidental
  // to the scenario order, not a rule. Without this, reordering the matrix would leave the check green
  // and testing nothing, the same way `endsWith` did before NC-12.
  check("the upload screen still carries the previous server verdict before the failure",
    (await page.locator("main").getByText("server-verified").count()) > 0);

  await page.route("**/api/pilot/datasets", (route) => route.abort("failed"));
  await page.setInputFiles('input[type="file"]', {
    name: `offline-${randomUUID().slice(0, 8)}.synthetic.csv`, mimeType: "text/csv",
    buffer: readFileSync(CSV_PATH),
  });
  await page.getByText(/^Error:/).waitFor({ timeout: 15_000 });
  check("network failure is shown as an error, with no stale verdict or next step",
    (await page.getByText(/^Error:/).isVisible()) &&
    (await page.getByRole("button", { name: "Pilot readiness →" }).count()) === 0 &&
    (await page.locator("main").getByText("server-verified").count()) === 0);
  await page.unroute("**/api/pilot/datasets");

  // ── 10 · Repeating the same upload creates no second governed consequence ───────────────────────
  //
  // THE INVARIANT, read from code rather than assumed:
  //
  //   datasetFingerprint = sha256(csvText)                    src/contract/validateDataset.ts:229
  //   idempotencyKey     = sha256(… , boundaryId, datasetId, datasetFingerprint)            :538-542
  //   prior              = findSubmission(key, boundaryId)         pilotIntakeService.ts:256
  //   prior !== null     -> throw ConflictError("NH-DC-4003: … already submitted on <date>")  -> 409
  //
  // NOTE THE THIRD INPUT. The identity is (boundaryId, datasetId, fingerprint) — NOT boundary + bytes.
  // `datasetId` is the free-text "Dataset label" the uploader types (UploadScreen.tsx:158), so the same
  // bytes re-submitted under a different label are a DIFFERENT identity and are accepted. Checks 6a/6b
  // below measure both halves of that scope rather than describing it. This matters beyond the test:
  // the label is supplied by the party who benefits from the number, which is why it is reported rather
  // than worked around here. Changing the derivation is a constitution question, not a test fix.
  //
  // REFUSE, not reuse: no prior report comes back, the caller gets an error. And `idempotency_key` is
  // the PRIMARY KEY of `pilot_dataset_submissions`, so a second row cannot exist even if that lookup
  // were deleted — the insert would raise P2002 and become a GENERIC 409. Two independent layers,
  // which is why check 3 below pins `NH-DC-4003` specifically rather than "some 409".
  //
  // WHY THIS RUNS HERE. Every other reason this upload could be refused is excluded by placement:
  // CSV_PATH was admitted in section 3, so a prior submission genuinely exists; the bar is ACTIVE and
  // was activated (section 2) BEFORE this dataset was first seen (section 3), so the anti-tuning rule
  // cannot fire; no freeze has happened yet (that is section 11); and the file is the valid fixture.
  // The `NH-DC-4003` assertion then proves it rather than trusting the ordering.
  //
  // NOT PROVABLE HERE: that no second submission ROW was written. No route exposes submissions — the
  // pilot routes are POST /pilot/datasets, the admission-policy and governance routes, and GET/POST
  // /pilot/assessments — and adding one would be a product affordance, not a test. That half rests on
  // the primary key and on `pilotIntake.test.ts` test 5. What the browser CAN show is that no second
  // governed WORK ITEM appeared, which is checked against the server's own execution list.
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const firstBytes = readFileSync(CSV_PATH);
  const repeatBytes = readFileSync(REPEAT_CSV_PATH);

  // PRECONDITION 1 — the first submission actually succeeded, evidenced by the server's own receipt.
  // Without this the refusal below could be a 409 about a submission that never happened.
  const firstKey = typeof firstIntakeBody?.idempotencyKey === "string" ? firstIntakeBody.idempotencyKey : "";
  check("the first upload was accepted and the server issued an idempotency identity for it",
    firstKey !== "" && firstIntakeBody?.boundaryId === BOUNDARY,
    `key=${firstKey.slice(0, 16)}… boundary=${String(firstIntakeBody?.boundaryId)}`);

  // PRECONDITION 2 — the bytes really are identical. The whole claim is about EXACT byte identity, so
  // this is measured and printed: if a fixture ever changes, this fails loudly instead of the section
  // quietly degrading into "uploading a similar CSV", which would prove nothing about idempotency.
  check("the bytes about to be re-uploaded are byte-identical to the accepted ones",
    sha256(firstBytes) === sha256(repeatBytes) && firstBytes.length === repeatBytes.length,
    `${sha256(firstBytes).slice(0, 16)}… vs ${sha256(repeatBytes).slice(0, 16)}…`);

  // PRECONDITION 3 — how many governed work items exist BEFORE the repeat. Read from the server, so
  // check 5 compares two server readings rather than one reading and an assumption.
  const countExecutions = async () => {
    const res = await page.evaluate(async ([boundaryId, actorId]) => {
      const r = await fetch(`/api/pilot/assessments?boundaryId=${encodeURIComponent(boundaryId)}`, {
        headers: { "x-actor-id": actorId, "x-actor-role": "operator" },
      });
      return { status: r.status, body: r.ok ? await r.json() : await r.text() };
    }, [BOUNDARY, proposerId]);
    return { status: res.status, count: Array.isArray(res.body) ? res.body.length : -1 };
  };
  const before = await countExecutions();
  check("the execution list is readable, so the count below is a real reading and not a default",
    before.status === 200 && before.count >= 1, `status=${before.status} count=${before.count}`);

  // THE REPEAT. Same bytes, same boundary AND the same dataset label — all three inputs of the
  // identity. A fresh label here would silently make this a new submission, and the section would be
  // testing nothing; that is exactly the mistake this run caught on its first attempt.
  await openIntakeScreen(JOURNEY_DATASET_LABEL);
  const repeatReply = page.waitForResponse(
    (r) => r.url().includes("/api/pilot/datasets") && r.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page.setInputFiles('input[type="file"]', REPEAT_CSV_PATH);
  const repeatRes = await repeatReply
    .then(async (r) => ({ status: r.status(), text: await r.text() }))
    .catch(() => ({ status: -1, text: "" }));

  // 3 · From the RESPONSE, not the screen. `NH-DC-4003` is emitted by duplicate detection and by
  // nothing else, so this simultaneously proves the repeat was recognised AND rules out every other
  // refusal reason — frozen policy, anti-tuning, a contract rejection, an authorization refusal.
  check("the repeat is refused 409 and the server names the duplicate-submission code",
    repeatRes.status === 409 && repeatRes.text.includes("NH-DC-4003"),
    `status=${repeatRes.status} body=${repeatRes.text.slice(0, 120)}`);

  // 4 · THE WIRING. `conflict` is in apiClient's SAFE_TO_SHOW_VERBATIM, so the server's own sentence
  // is what the operator reads. No server test can see whether that actually reaches the screen.
  // Asserted with it: no next step is offered, and no stale `server-verified` verdict is left behind —
  // a duplicate shown beside a valid-looking report for the file that was NOT accepted is the failure
  // mode worth having (the NC-15 lesson, on a different path).
  await page.getByText(/^Error:/).waitFor({ timeout: 15_000 }).catch(() => undefined);
  const repeatScreen = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check("the screen shows the server's duplicate sentence, with no next step and no stale verdict",
    repeatScreen.includes("NH-DC-4003") &&
    repeatScreen.includes("already submitted") &&
    (await page.getByRole("button", { name: "Pilot readiness →" }).count()) === 0 &&
    (await page.locator("main").getByText("server-verified").count()) === 0,
    repeatScreen.slice(0, 160));

  // 5 · The consequence, read back from the server.
  //
  // An upload on its own never creates an execution — only "Run governed execution" does — so a bare
  // count comparison here would be true whatever happened, which is corroboration dressed up as
  // evidence. So where the guard has FAILED and the repeat was admitted, the section follows it
  // through to the governed run, which is where a second work item would actually appear. That is what
  // makes this check able to fail: NC-26 admits the repeat, runs it, and a second execution shows up.
  const repeatAdmitted = (await page.getByRole("button", { name: "Pilot readiness →" }).count()) > 0;
  if (repeatAdmitted) {
    await page.getByRole("button", { name: "Pilot readiness →" }).click();
    await page.getByRole("button", { name: "Observed result →" }).click();
    await page.getByRole("button", { name: "Run governed execution" }).click();
    await page.getByText("Completed — an observation was recorded")
      .waitFor({ timeout: 90_000 }).catch(() => undefined);
  }
  const after = await countExecutions();
  check("repeating the upload created no second governed work item",
    after.status === 200 && after.count === before.count,
    `before=${before.count} after=${after.count} followedThrough=${repeatAdmitted}`);

  // 6 · KEY SCOPE, measured on both movable inputs. These run AFTER the count check above, because
  // each one submits successfully and would otherwise pollute it.
  //
  // Neither is a tenant-isolation claim and neither may be read as one: dev-header actors receive
  // boundaryIds ["*"], so nothing here tests access control. This is key derivation, nothing more.
  const submitOnce = async (label, boundaryId) => {
    // EP-26 · A different boundary needs its own activated definition before it can measure anything —
    // exactly as it needs its own admission bar. Governed first, through the screen.
    if (boundaryId !== BOUNDARY) await governTermsFor(boundaryId);
    await openIntakeScreen(label);
    if (boundaryId !== BOUNDARY) {
      await page.getByLabel("Pilot boundary").fill(boundaryId);
      // Editing the boundary reloads the menu and clears the selection by design, so cite it again.
      await selectGovernedTerms();
    }
    const reply = page.waitForResponse(
      (r) => r.url().includes("/api/pilot/datasets") && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await page.setInputFiles('input[type="file"]', REPEAT_CSV_PATH);
    return reply.then(async (r) => ({ status: r.status(), text: await r.text() }))
      .catch(() => ({ status: -1, text: "" }));
  };

  // 6a · EP-28 · THE DEFECT, CLOSED — and this check is INVERTED from what it asserted before.
  //
  // It used to read: "the same bytes under a different DATASET LABEL are not a repeat — the label is part of
  // the identity", passing on a 200 with NH-DC-4003 absent. That was a true measurement of a real defect:
  // renaming the dataset defeated duplicate detection, so "a byte-identical re-upload is refused" held only
  // while the uploader kept the label, and the party who benefits from the number controlled the identity.
  // The old wording is retracted here rather than quietly reworded, exactly as the EP-24 retraction was.
  //
  // The v2 submission identity drops the label, so the same bytes in the same boundary under ANY name are the
  // same submission. Asserted from the RESPONSE and pinned to the contract's own code, so it cannot pass on a
  // refusal that happens to be some other rule's.
  const relabelled = await submitOnce(`relabelled-${randomUUID().slice(0, 8)}`, BOUNDARY);
  check("the same bytes under a different DATASET LABEL are now a REPEAT — the label is not the identity",
    relabelled.status === 409 && relabelled.text.includes("NH-DC-4003"),
    `status=${relabelled.status}`);

  // 6b · Same bytes, same label, a different boundary — NOT a repeat. Together with 6a this shows
  // the refusal above was about THIS BOUNDARY having seen these bytes, rather than the file being
  // blacklisted wherever it appears. The pair is what makes each half mean something: 6a alone could be
  // satisfied by a system that refuses every repeat upload anywhere.
  const elsewhere = await submitOnce(JOURNEY_DATASET_LABEL, `${BOUNDARY}-elsewhere`);
  check("the same bytes under a different boundary are not a repeat — the identity is boundary-scoped",
    elsewhere.status === 200 && !elsewhere.text.includes("NH-DC-4003"),
    `status=${elsewhere.status}`);

  // ── 11 · A frozen bar stops judging, and freezing is not decorative ─────────────────────────────
  //
  // WHAT IS PROVABLE HERE, AND WHAT IS NOT. The server enforces the frozen state in TWO independent
  // places: at intake (`pilotIntakeService.ts`, which refuses admission) and again at schedule time
  // (`pilotAssessmentService.ts`, `NH-AX-1007 policy_not_active`, re-checked on a dataset admitted
  // while the bar was still ACTIVE). Only the first is reachable from this UI. `App.tsx` renders
  // screens conditionally, so going to the governance screen UNMOUNTS `Assessment` and discards the
  // admitted dataset; on return the same file is refused earlier, at intake. A browser test aimed at
  // the schedule-time rule would therefore observe the intake refusal and credit it to the wrong
  // rule — so it is not attempted. That rule stays covered at service level.
  //
  // This runs last of the data sections deliberately: everything above needs the bar ACTIVE, and
  // section 9's refusal has to stay a TRANSPORT refusal rather than a governance one.
  const readLifecycle = async () => {
    await page.goto(UI_BASE, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Pilot Policy Governance" }).click();
    await page.getByLabel("Boundary (tenant)").fill(BOUNDARY);
    await page.getByLabel("Policy id").fill(POLICY_ID);
    await page.getByLabel("Policy version").fill(POLICY_VERSION);
    await page.getByLabel("Rationale (required on every act)").fill("journey freeze/resume");
    await page.getByRole("button", { name: "Read lifecycle", exact: true }).click();
  };

  // Scoped to the lifecycle panel, NOT the page: `FROZEN` is both a state and a transition, so it
  // appears in the state pill AND in the audit trail below. An unscoped `getByText("FROZEN")` resolves
  // two elements and Playwright's strict mode throws — and a `.first()` would be a guess about which.
  const lifecycle = () => page.getByText("3 · Lifecycle", { exact: true }).locator("..");

  await readLifecycle();
  // PRECONDITION. Every check below describes a transition away from ACTIVE, so if the lifecycle read
  // did not land the section would be asserting against a blank screen. Nothing here may pass on one.
  await lifecycle().getByText("ACTIVE", { exact: true }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  const wasActive = (await lifecycle().getByText("ACTIVE", { exact: true }).isVisible()) &&
    (await lifecycle().getByText("may judge a dataset").isVisible());
  check("the bar this journey has been judging against is ACTIVE before it is frozen", wasActive);
  haltIf(!wasActive, "the bar was not ACTIVE before the freeze, so a later FROZEN reading would not " +
    "show that freezing changed anything");

  await page.getByRole("button", { name: "Freeze", exact: true }).click();
  await lifecycle().getByText("FROZEN", { exact: true }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  // The state, the verdict and the guidance together. The verdict is the one that matters: a pill
  // reading FROZEN beside "may judge a dataset" would be a screen contradicting itself.
  check("a frozen bar reads FROZEN and judges nothing",
    (await lifecycle().getByText("FROZEN", { exact: true }).isVisible()) &&
    (await lifecycle().getByText("judges nothing").isVisible()) &&
    !(await lifecycle().getByText("may judge a dataset").count()) &&
    (await page.getByText("Paused by pilot governance. It judges nothing until it is resumed.").isVisible()));

  // Scoped to the audit panel, as sections 1-2 are — the server's append-only record, not the buttons.
  const frozenAudit = ((await page.getByText("Who decided what", { exact: false }).locator("..")
    .innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  check("the audit trail records the FROZEN transition against the steward who made it",
    frozenAudit.includes("FROZEN") && frozenAudit.includes(bareId(stewardName)),
    frozenAudit.slice(-160));

  // Everything below needs the bar to be FROZEN. If the freeze was refused the bar is still ACTIVE, so
  // the dataset is ADMITTED, the flow leaves Upload on its own and the report panel unmounts — the
  // "frozen refusal" checks would then be waiting for a panel that cannot appear. NC-21 lands exactly
  // there, so the run stops here with the cause already recorded above rather than spending a timeout.
  const isFrozen = await lifecycle().getByText("FROZEN", { exact: true }).isVisible();
  haltIf(!isFrozen, "the bar is not FROZEN, so there is no frozen state for an intake refusal to come " +
    "from and an admitted dataset would leave the upload screen instead");

  // THE OUTCOME CHECK. A state pill is a claim about governance; this is whether governance bites.
  await openIntakeScreen(`frozen-${randomUUID().slice(0, 8)}`);
  const frozenReply = page.waitForResponse(
    (r) => r.url().includes("/api/pilot/datasets") && r.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page.setInputFiles('input[type="file"]', FROZEN_CSV_PATH);
  // Degrading, not throwing. If the frozen state stops being enforced the dataset is ADMITTED, the flow
  // leaves Upload on its own and this panel unmounts — so a bare wait would abort the run and report
  // `65/65 recorded checks passed` with the refusal check never printed. NC-22 lands exactly there, and
  // the failure has to be attributable to the named check below, not to a timeout.
  await page.getByText("Data contract validation", { exact: true })
    .waitFor({ timeout: 30_000 }).catch(() => undefined);
  const frozenBody = await frozenReply.then((r) => (r.ok() ? r.json() : null)).catch(() => null);
  const frozenText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  // Two checks, not one, so the controls are distinguishable. Removing the intake gate (NC-22) admits
  // the dataset and unmounts the panel, failing BOTH. Breaking only the state label (NC-23) leaves the
  // refusal intact and fails only the second — which is the difference between "governance stopped it"
  // and "the operator can see what stopped it".
  //
  // `server-verified` matters: this is the server refusing admission, NOT the local preflight path.
  // Reading a preflight refusal as a governance refusal is the mistake `cc9029e` made in reverse.
  check("a frozen bar refuses the dataset at intake and keeps it on the upload screen",
    frozenText.includes("server-verified") &&
    frozenText.includes("the policy is frozen by pilot governance and may not judge new datasets") &&
    (await page.getByRole("button", { name: "Pilot readiness →" }).count()) === 0);
  check("the refusal names WHICH lifecycle state stopped it, not merely that something did",
    frozenText.includes("frozen by governance"));
  // The server's payload, not the screen's wording — the two must agree about which state refused.
  check("the server reported the frozen state for that refusal",
    frozenBody?.admissionPolicyState === "FROZEN",
    `admissionPolicyState=${String(frozenBody?.admissionPolicyState)}`);

  // Resuming. ONLY the state round-trip is asserted: `policyGovernanceState` takes the LATEST
  // activation (ACTIVATED or UNFROZEN) as `activatedAt`, so after a resume the anti-tuning rule
  // (`activatedAt > firstSeenAt`) correctly refuses any dataset first seen before it. "It judges
  // again" is therefore FALSE for every dataset this run has already submitted, and no check here
  // claims otherwise — that is a pre-registration rule, not a frozen-policy one.
  await readLifecycle();
  await lifecycle().getByText("FROZEN", { exact: true }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  // The button is labelled "Resume"; the TRANSITION it records is `UNFROZEN`. Asserting the screen's
  // word and the server's word separately is deliberate — they are allowed to differ, and the audit
  // check below is against the server's.
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await lifecycle().getByText("ACTIVE", { exact: true }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  check("resuming a frozen bar restores ACTIVE and its authority to judge",
    (await lifecycle().getByText("ACTIVE", { exact: true }).isVisible()) &&
    (await lifecycle().getByText("may judge a dataset").isVisible()) &&
    !(await lifecycle().getByText("judges nothing").count()));
  const resumedAudit = ((await page.getByText("Who decided what", { exact: false }).locator("..")
    .innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  check("the audit trail records the resume as its own act, leaving the freeze in place",
    resumedAudit.includes("UNFROZEN") && resumedAudit.includes("FROZEN") &&
    resumedAudit.includes(bareId(stewardName)),
    resumedAudit.slice(-160));

  // ── 11b · Re-assessment, through the screen, the API, the database and the worker ────────────────
  //
  // WHAT THIS PROVES that no in-process test can: that an operator can take a result produced under an
  // older calculation method and get a current-method answer for the SAME retained bytes, without
  // re-uploading anything, and that the earlier answer is still there afterwards.
  //
  // WHY HISTORY HAS TO BE SEEDED, stated rather than hidden. A re-assessment only means something
  // across a calculation-method change, and the method is a BUILD CONSTANT — every definition this
  // screen can register is stamped with the method this build implements, so a freshly governed version
  // names the method the execution already used and the server correctly answers NH-AX-1017. A result
  // from before the bump is a fact about the past; `scripts/seed-journey-prebump.ts` records one the way
  // the pre-bump build recorded it, and its own header says why it is written and not run. Everything
  // after that line is the real product: the real screen, the real API, the real worker, the real rows.
  //
  // The bar is ACTIVE again here, restored by section 11's resume, so this section can use it and then
  // freeze it for the refusal check.
  const prebump = JSON.parse(
    execFileSync("npx", ["vite-node", "scripts/seed-journey-prebump.ts", BOUNDARY, executionId ?? ""], {
      cwd: ROOT,
      encoding: "utf8",
      env: process.env,
    }),
  );
  check(
    "a result from before the calculation-method bump exists to re-assess",
    typeof prebump.executionId === "string" && prebump.method !== undefined,
    `${prebump.executionId} · ${prebump.method}`,
  );
  haltIf(
    typeof prebump.executionId !== "string",
    "no pre-bump execution was seeded, so every re-assessment check below would be asserting against " +
      "a screen that has nothing to re-assess",
  );

  // Its finding, as it stands BEFORE anything is re-assessed. The preservation claim is measured
  // against this, not against a memory of it.
  const readExecution = (id) =>
    page.evaluate(async ([boundaryId, executionIdToRead, actorId]) => {
      const res = await fetch(
        `/api/pilot/assessments/${executionIdToRead}?boundaryId=${encodeURIComponent(boundaryId)}`,
        { headers: { "x-actor-id": actorId, "x-actor-role": "operator" } },
      );
      return { status: res.status, body: res.ok ? await res.json() : await res.text() };
    }, [BOUNDARY, id, proposerId]);

  const beforeRevision = await readExecution(prebump.executionId);
  checkEqual("the pre-bump result is readable before re-assessment", beforeRevision.status, 200);
  const historicalFindingHash = beforeRevision.body?.finding?.findingHash ?? null;
  const historicalAssessmentId = beforeRevision.body?.finding?.finding?.assessmentId ?? null;
  check(
    "the pre-bump result carries its own finding under its own method",
    historicalFindingHash !== null &&
      beforeRevision.body?.finding?.finding?.calculationMethodVersion === prebump.method,
    `${historicalAssessmentId} · ${beforeRevision.body?.finding?.finding?.calculationMethodVersion}`,
  );

  // A NEW governed definition blesses this build's method — the real post-bump workflow, proposed and
  // activated by two different identities, through the screen.
  const REVISION_TERMS_VERSION = "1.1.0";
  await governTermsFor(BOUNDARY, REVISION_TERMS_VERSION);
  const revisionTermsRef = `${TERMS_ID}@${REVISION_TERMS_VERSION}`;

  /**
   * Choose one governed definition, and report whether it was actually selectable.
   *
   * NOT swallowed. The first version of this used `.catch(() => undefined)`, so when the locator did
   * not match, the radio stayed unselected, submit stayed disabled, the click did nothing — and the
   * only symptom was a refusal panel that never appeared, blamed on the refusal. A selection that
   * cannot be made is a failure of this harness and has to say so.
   */
  async function chooseDefinition(termsRef) {
    const radio = page.locator(`input[type="radio"][value="${termsRef}"]`);
    await radio.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
    if (!(await radio.count()) || (await radio.isDisabled())) return false;
    await radio.check();
    return radio.isChecked();
  }

  /** Open the re-assessment screen on one execution. */
  async function openReassessment(targetExecutionId) {
    await page.goto(UI_BASE, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Re-assessment", exact: true }).click();
    await page.getByLabel("Re-assessment tenant").fill(BOUNDARY);
    await page.getByLabel("Execution to re-assess").fill(targetExecutionId);
    await page.getByRole("button", { name: "Load this execution" }).click();
    await page.getByLabel("Governed definitions for re-assessment")
      .waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
  }

  // ── 11b.i · GOVERNANCE IS RE-CHECKED NOW, not inherited from the original admission ──────────────
  //
  // Freeze the bar and attempt the re-assessment. The pre-bump execution was admitted while the bar was
  // ACTIVE, so an implementation that trusted the original decision would proceed. NH-AX-1007 on screen
  // is the evidence that it does not. Unlike section 11's note about schedule-time refusals, this one IS
  // reachable from the UI: re-assessment never passes through intake, so nothing earlier can refuse it
  // first and be credited to the wrong rule.
  await readLifecycle();
  await page.getByRole("button", { name: "Freeze", exact: true }).click();
  await lifecycle().getByText("FROZEN", { exact: true }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  const frozenForReassessment = await lifecycle().getByText("FROZEN", { exact: true }).isVisible();
  check("the admission bar is FROZEN before the refused re-assessment", frozenForReassessment);
  haltIf(!frozenForReassessment,
    "the bar was not frozen, so a re-assessment that succeeded below would say nothing about whether " +
      "governance is re-checked");

  await openReassessment(prebump.executionId);
  const chosenWhileFrozen = await chooseDefinition(revisionTermsRef);
  check("the definition is selectable while the bar is frozen — the refusal comes from the server",
    chosenWhileFrozen);
  haltIf(!chosenWhileFrozen,
    "the definition could not be selected, so an absent refusal panel below would say nothing about " +
      "whether a frozen bar refuses a re-assessment");
  await page.getByLabel("Reason for this re-assessment")
    .fill("journey: the calculation method moved; re-scoring the retained input");
  await page.getByRole("button", { name: /^Re-assess under this definition/ }).click();
  const refusalPanel = page.getByLabel("Re-assessment refusal");
  await refusalPanel.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
  const refusalText = ((await refusalPanel.innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  check(
    "a frozen bar refuses the re-assessment NH-AX-1007, on screen, with its remedy",
    refusalText.includes("NH-AX-1007") && /activate or resume the policy/i.test(refusalText),
    refusalText.slice(0, 200),
  );
  check(
    "the refusal says plainly that nothing was created and nothing was changed",
    /Nothing was created and nothing was changed/i.test(refusalText),
  );
  const afterRefusal = await page.evaluate(async ([boundaryId, actorId]) => {
    const res = await fetch(`/api/pilot/assessments?boundaryId=${encodeURIComponent(boundaryId)}`, {
      headers: { "x-actor-id": actorId, "x-actor-role": "operator" },
    });
    return res.ok ? (await res.json()).length : -1;
  }, [BOUNDARY, proposerId]);
  check("the refused re-assessment created no execution", afterRefusal === 2, `executions=${afterRefusal}`);

  // ── 11b.ii · The same request, once the bar is in force again ───────────────────────────────────
  await readLifecycle();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await lifecycle().getByText("ACTIVE", { exact: true }).waitFor({ timeout: 15_000 }).catch(() => undefined);

  await openReassessment(prebump.executionId);
  const optionsText = ((await page.getByLabel("Governed definitions for re-assessment")
    .innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  check(
    "the screen shows the result being re-assessed under its OWN older method",
    (await page.getByLabel("Previous result").innerText().catch(() => "")).includes(prebump.method),
    prebump.method,
  );
  // THE CHECK THAT PROVES THIS IS NOT A NO-OP, and its first form had the premise wrong. It expected the
  // screen to show NH-AX-1017 here, reasoning that the definition the pre-bump execution ran under would
  // be listed as refusable. It is not listed at all: every definition this build can register is stamped
  // with the method this build implements, and the pre-bump method is one no registered definition
  // names. So the evidence is the other way round — the previous method differs from EVERY definition
  // on offer, which is exactly what makes any selection below a real method change.
  check(
    "every definition on offer names a method DIFFERENT from the one the result was computed with",
    optionsText.includes(revisionTermsRef) && !optionsText.includes(prebump.method),
    `offered: ${optionsText.slice(0, 160)}`,
  );

  const chosen = await chooseDefinition(revisionTermsRef);
  check("the new definition is selectable once the bar is in force again", chosen);
  const REVISION_REASON = "journey: the calculation method moved; re-scoring the retained input";
  await page.getByLabel("Reason for this re-assessment").fill(REVISION_REASON);
  const submitReassessment = page.getByRole("button", { name: /^Re-assess under this definition/ });
  const submitWasEnabled = await submitReassessment.isEnabled();
  check("the screen permits the re-assessment once a definition and a reason are given", submitWasEnabled);
  haltIf(!submitWasEnabled,
    "the submit control never became available, so nothing below would be measuring a re-assessment");
  await submitReassessment.click();

  // `Completed` is the only acceptable end: the worker has to claim the revision and record its own
  // finding. A timeout is a failure of this harness, exactly as in section 5.
  //
  // SCOPED TO THE REVISION'S OWN STATE PILL, and the first version was not — it waited on any occurrence of
  // the completion sentence, which the PREVIOUS execution's panel already carries. So the wait returned
  // instantly, every API read below ran while the worker was still going, and five checks failed
  // reporting a revision that in fact completed a second later. Precisely the trap section 5's own
  // comment warns about, met from the other direction. Scoping it to the panel was not enough either:
  // that panel carries TWO state pills, so the locator resolved two elements, Playwright's strict mode
  // threw, and the catch read a finished revision as one that never finished. One named region, one
  // match.
  const revisionState = page.getByLabel("Revision state");
  await revisionState.getByText("Completed — an observation was recorded")
    .waitFor({ timeout: 90_000 }).catch(() => undefined);
  const revisionCompleted = await revisionState
    .getByText("Completed — an observation was recorded").isVisible().catch(() => false);
  check("the re-assessment reached a server-reported completion", revisionCompleted);
  haltIf(!revisionCompleted,
    "the revision never reported completion on screen, so the preservation and delta checks below " +
      "would be reading a run that had not finished");
  const revisionText = (await page.locator("main").innerText()).replace(/\s+/g, " ");

  // ── 11b.iii · The link is PERSISTED, and the earlier result survived ────────────────────────────
  const listedAfter = await page.evaluate(async ([boundaryId, actorId]) => {
    const res = await fetch(`/api/pilot/assessments?boundaryId=${encodeURIComponent(boundaryId)}`, {
      headers: { "x-actor-id": actorId, "x-actor-role": "operator" },
    });
    return res.ok ? await res.json() : [];
  }, [BOUNDARY, proposerId]);
  const revisionId = listedAfter
    .map((row) => row.executionId)
    .find((id) => id !== prebump.executionId && id !== executionId) ?? null;
  check("a third execution now exists — the revision, beside the two originals",
    revisionId !== null && listedAfter.length === 3, `count=${listedAfter.length}`);

  const revisionView = revisionId ? (await readExecution(revisionId)).body : null;
  checkEqual("the API agrees the revision completed", revisionView?.state, "completed");
  // THE PERSISTED LINK, read from the record rather than from the response the screen was given.
  checkEqual("the revision's stored link names the execution it revises",
    revisionView?.revises?.executionId, prebump.executionId);
  checkEqual("the stored revision carries the operator's stated reason",
    revisionView?.revises?.reason, REVISION_REASON);
  check("the stored delta reports the method change and nothing it must not",
    (revisionView?.revises?.delta?.changed ?? []).some((c) =>
      c.field === "calculationMethodVersion" && c.before === prebump.method) &&
    (revisionView?.revises?.delta?.unexpectedChanges ?? []).length === 0,
    JSON.stringify(revisionView?.revises?.delta?.changed ?? []));
  check("the server reports the earlier finding as still stored",
    revisionView?.revises?.previousFindingExists === true);

  // HISTORICAL PRESERVATION, measured. The earlier finding's hash is the same hash it had before any of
  // this happened, which is a stronger statement than "the row is still there".
  const afterRevision = await readExecution(prebump.executionId);
  checkEqual("the earlier result is still readable at its own identifier", afterRevision.status, 200);
  checkEqual("the earlier result still reports its own state", afterRevision.body?.state, "completed");
  checkEqual("the earlier finding is BYTE-IDENTICAL after the re-assessment",
    afterRevision.body?.finding?.findingHash, historicalFindingHash);
  checkEqual("the earlier result still names the method it was computed with",
    afterRevision.body?.finding?.finding?.calculationMethodVersion, prebump.method);
  check("the earlier result was not relabelled as a revision of anything",
    afterRevision.body?.revises === null);

  // THE RESULT CHANGED VISIBLY, and the two answers are distinguishable rather than asserted to differ.
  const revisionAssessmentId = revisionView?.finding?.finding?.assessmentId ?? null;
  check("the revision produced its OWN finding, with its own assessment identity",
    revisionAssessmentId !== null && revisionAssessmentId !== historicalAssessmentId,
    `${historicalAssessmentId} → ${revisionAssessmentId}`);
  checkEqual("the revision's finding names this build's method",
    revisionView?.finding?.finding?.calculationMethodVersion,
    revisionView?.binding?.assessmentPolicy?.calculationMethodVersion);
  check("the screen shows what changed, with both values",
    revisionText.includes("calculationMethodVersion") && revisionText.includes(prebump.method) &&
    revisionText.includes(revisionView?.binding?.assessmentPolicy?.calculationMethodVersion ?? "\u0000"),
  );
  check("the screen shows BOTH observations, naming the earlier one as preserved",
    revisionText.includes(historicalAssessmentId ?? "\u0000") &&
    revisionText.includes(revisionAssessmentId ?? "\u0000") &&
    /preserved, not replaced/i.test(revisionText));
  check("the screen states that the earlier finding is still stored and reproducible",
    /still stored and still reproducible/i.test(revisionText));

  // ── 11b.iv · NH-AX-1017, where it IS reachable: a result already on this build's method ─────────
  //
  // The journey's ORIGINAL execution ran under the method this build implements, which is the method
  // every definition the governance screen can register is stamped with. So for that execution every
  // definition on offer names the method it already used, and the screen must say so in advance rather
  // than let an operator submit and be refused. This is the no-op case from the operator's side — on the
  // one target where a browser can actually reach it.
  await openReassessment(executionId ?? "");
  const noOpOptions = ((await page.getByLabel("Governed definitions for re-assessment")
    .innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  check(
    "a result already on this build's method shows every definition as refusable, NH-AX-1017",
    noOpOptions.includes("NH-AX-1017") && /nothing to re-assess/i.test(noOpOptions),
    noOpOptions.slice(0, 200),
  );
  check(
    "and nothing is selectable, so the no-op cannot be submitted at all",
    (await page.locator('input[type="radio"]:not([disabled])').count()) === 0,
  );
  const noOpSubmit = page.getByRole("button", { name: /^Re-assess under this definition/ });
  check(
    "the submit control stays shut and names what is missing",
    !(await noOpSubmit.isEnabled()) &&
      /choose a governed definition/i.test((await page.getByLabel("Submit blocked reason").innerText().catch(() => "")) || ""),
  );

  // AND IT IS STILL A PILOT ASSESSMENT. Two figures on one screen is exactly where a reader starts
  // believing one of them was proven.
  check("the re-assessment screen states it is a pilot assessment, not proof of recovered revenue",
    /pilot assessment/i.test(revisionText) &&
    /Neither is proof of recovered revenue/i.test(revisionText) &&
    /No recovery case is created/i.test(revisionText));

  // ── 13 · Identify → own → fix → evidence → prove, on ONE Recovery Case ──────────────────────────
  //
  // Everything above is the ASSESSMENT lane: a governed observation that creates no case and claims no
  // money, and says so on its own screen. This section is the other lane, and it is the one the
  // constitution calls the complete loop — a detector finding becomes a case someone owns, acts on,
  // evidences and proves, with the two ledgers visibly apart at every hop.
  //
  // ONLY THE OBSERVATION IS INJECTED. `seed-journey-activation-task.ts` enqueues the payload a system
  // watching the customer's accounts would produce, because NH has no screen that creates one — on
  // purpose, since a UI that let an operator hand-write a finding would let the beneficiary author the
  // thing the review gate exists to judge. The detector, the worker, the candidate store, the review
  // screen, the promotion and every governed write after it are the real product.
  //
  // EVERY FIGURE HERE IS SYNTHETIC, and the at-risk amount is a request INPUT on this path rather than
  // something derived from customer data. That is why nothing below calls it recovered money, and why
  // the case screen's two panels are checked as two different numbers rather than one.
  const seeded = JSON.parse(
    execFileSync("npx", ["vite-node", "scripts/seed-journey-activation-task.ts", BOUNDARY], {
      cwd: ROOT,
      encoding: "utf8",
      env: process.env,
    }),
  );
  check(
    "an activation observation is queued for the real detector",
    typeof seeded.taskId === "string" && seeded.amountAtRiskMinor === 10_000,
    `${seeded.taskId} · ${seeded.amountAtRiskMinor} ${seeded.currency}`,
  );

  await page.getByRole("button", { name: "Candidate Review" }).click();
  await page.getByLabel("Pilot boundary ID").fill(BOUNDARY).catch(async () => {
    await page.locator('input[placeholder="Enter the exact customer/pilot boundary"]').fill(BOUNDARY);
  });

  // The worker polls; the candidate appears when the detector has run and the admission bar has
  // admitted it. Clicking "Load candidates" until one shows is how an operator would actually find out.
  const loadCandidates = page.getByRole("button", { name: "Load candidates" });
  let candidateText = "";
  for (let attempt = 0; attempt < 40 && !/pending review/.test(candidateText); attempt += 1) {
    await loadCandidates.click();
    await page.waitForTimeout(500);
    candidateText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  }
  const candidateVisible = /pending review/.test(candidateText);
  check("the detector's finding reaches the operator's review queue", candidateVisible,
    candidateText.slice(0, 160));
  haltIf(
    !candidateVisible,
    "no candidate reached the review queue, so every later step in this section is unreachable",
  );

  // THE FIRST LEDGER CHECK, before anything is decided. The queue states the figure is an opportunity.
  check(
    "the queue labels the figure Revenue Opportunity and shows Revenue Returned as nothing counted",
    // Case-insensitive: both labels are rendered through a CSS `uppercase`, and `innerText` returns the
    // text as the browser lays it out rather than as the DOM holds it.
    /revenue opportunity · not proven/i.test(candidateText) && /review never counts money/i.test(candidateText),
    candidateText.slice(0, 200),
  );

  // ── 13a · A review decision without a reason is refused by the screen ──────────────────────────
  const acceptButton = page.getByRole("button", { name: "Accept for case creation" });
  await acceptButton.click();
  const noReason = (await page.locator('[role="alert"]').innerText().catch(() => "")) || "";
  check(
    "accepting with no reason is refused, and the refusal says the decision is immutable",
    /review reason is required/i.test(noReason) && /immutable/i.test(noReason),
    noReason.slice(0, 120),
  );
  check(
    "and no Recovery Case was created by the refused attempt",
    !/Recovery Case RC-/.test((await page.locator("body").innerText()).replace(/\s+/g, " ")),
  );

  // ── 13b · Accept, then promote — two separate operator acts ────────────────────────────────────
  await page.locator('input[placeholder="Required immutable review reason"]').fill(
    "journey · confirmed against the account record",
  );
  await acceptButton.click();
  await page.waitForTimeout(400);
  const afterAccept = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  check(
    "acceptance is not promotion — the screen says a separate operator action is still required",
    /Promotion still requires a separate operator action/.test(afterAccept),
    afterAccept.slice(0, 160),
  );

  await page.getByRole("button", { name: "Create Recovery Case" }).click();
  await page.waitForTimeout(600);
  const afterPromote = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const caseIdMatch = afterPromote.match(/Recovery Case (RC-[0-9a-f-]+)/i);
  const recoveryCaseId = caseIdMatch?.[1] ?? "";
  check("promotion creates the authoritative Recovery Case root", recoveryCaseId !== "",
    afterPromote.slice(0, 200));
  haltIf(recoveryCaseId === "", "no Recovery Case id was reported, so the case cannot be read back");

  // ── 13c · NO DUPLICATE CASE for the same finding ───────────────────────────────────────────────
  //
  // Two mechanisms, and both are checked because they fail independently. The QUEUE no longer offers
  // the candidate — a promoted candidate is excluded from `listPending` — so the screen cannot be used
  // to make a second case. And the API itself refuses to make one: `sourceCandidateId` is UNIQUE and
  // the promotion is idempotent, which is the half that still has to hold when something other than
  // this screen calls it.
  await loadCandidates.click();
  await page.waitForTimeout(400);
  const queueAfter = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  check(
    "the promoted candidate leaves the queue, so the screen cannot create a second case",
    /No pending candidates or accepted candidates awaiting promotion/.test(queueAfter),
    queueAfter.slice(0, 160),
  );
  const replay = await page.evaluate(async ([boundaryId, actorId]) => {
    const list = await fetch(`/api/agent-candidates?boundaryId=${encodeURIComponent(boundaryId)}`, {
      headers: { "x-actor-id": actorId, "x-actor-role": "operator" },
    });
    return { status: list.status, pending: list.ok ? (await list.json()).length : -1 };
  }, [BOUNDARY, "pilot-operator@company"]);
  check("and the server agrees the queue is empty for this boundary",
    replay.status === 200 && replay.pending === 0, `status=${replay.status} pending=${replay.pending}`);

  // ── 13d · The case is readable in the product, with the two ledgers apart ──────────────────────
  await page.getByRole("button", { name: "Recovery Case", exact: true }).click();
  const readCase = async () => {
    await page.getByLabel("Recovery Case ID").fill(recoveryCaseId);
    await page.getByRole("button", { name: "Read case" }).click();
    await page.waitForTimeout(500);
    return (await page.locator('[data-testid="recovery-case-body"]').innerText().catch(() => "")).replace(/\s+/g, " ");
  };
  let caseText = await readCase();
  check("the promoted case is readable on a real screen, from the governed record",
    caseText.includes(recoveryCaseId), caseText.slice(0, 160));
  check(
    "it shows the identified exposure and states it is NOT money returned",
    /\$100\.00/.test(caseText) && /not money returned/i.test(caseText),
    caseText.slice(0, 200),
  );
  check(
    "Revenue Returned reads NOT COMPUTED, never $0.00, because no proof exists yet",
    /NOT COMPUTED/.test(caseText) && !/\$0\.00/.test(caseText),
    caseText.slice(0, 200),
  );
  const stageReached = async (stage) =>
    (await page.locator(`[data-testid="stage-${stage}"]`).getAttribute("data-reached")) === "yes";
  check("the case starts at OPENED and nothing further is claimed",
    (await stageReached("OPENED")) && !(await stageReached("OWNED")) && !(await stageReached("PROVEN")));

  // ── 13e · Author → baseline → intervene → evidence → prove, through the governed API ───────────
  //
  // Driven through `page.evaluate` rather than a screen because these writes have no screen of their
  // own yet — `EventDetail` offers them only for a seed event. They are the REAL governed endpoints
  // with the REAL separation of duties: the author/operator half and the approver half are two
  // different identities, and the server refuses them from one.
  const drive = await page.evaluate(async ([caseId]) => {
    const call = async (method, path, actorId, role, body) => {
      // The content-type header is set ONLY when there is a body. Fastify refuses a request that
      // declares `application/json` and sends nothing, and `/author` and `/intervention` take no body —
      // so declaring it unconditionally made the harness fail two writes the product accepts.
      const headers = { "x-actor-id": actorId, "x-actor-role": role };
      if (body !== undefined) headers["content-type"] = "application/json";
      const res = await fetch(`/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.text() };
    };
    const out = {};
    out.author = await call("POST", `/cases/${caseId}/author`, "dana@company", "author");
    out.baseline = await call("POST", `/cases/${caseId}/baseline`, "dana@company", "author", {
      baselineId: `BL-journey-${caseId.slice(3, 11)}`,
      calculatedMinor: 2_000,
      currency: "USD",
      method: "matched_historical_cohort",
      methodVersion: 1,
      sourceRefs: ["journey-src-1"],
      effectiveAt: "2026-07-01T00:00:00.000Z",
    });
    out.intervention = await call("POST", `/cases/${caseId}/intervention`, "dana@company", "author");
    return out;
  }, [recoveryCaseId]);
  check("the case is authored, baselined and intervened through the governed API",
    drive.author.status === 201 && drive.baseline.status === 201 && drive.intervention.status === 201,
    `author=${drive.author.status} baseline=${drive.baseline.status} intervention=${drive.intervention.status}`);

  caseText = await readCase();
  check("the screen now shows INTERVENED, derived from the record and not from a stored status",
    (await stageReached("INTERVENED")) && !(await stageReached("EVIDENCED")));
  check("and the proven ledger is STILL not computed — a fix is not a recovery",
    /NOT COMPUTED/.test(caseText) && !/\$0\.00/.test(caseText));

  // Evidence needs a source attestation the browser cannot forge, so it is ingested by the same
  // fixture verifier the server matrix uses, through the same endpoint, from the harness.
  const evidence = JSON.parse(
    execFileSync("npx", ["vite-node", "scripts/seed-journey-case-evidence.ts", recoveryCaseId], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        JOURNEY_API_PORT: String(API_PORT),
        JOURNEY_EVIDENCE_KEY_ID: EVIDENCE_KEY_ID,
        JOURNEY_EVIDENCE_PRIVATE_KEY: EVIDENCE_PRIVATE_KEY,
      },
    }),
  );
  check("outcome evidence is ingested against the case", evidence.ingested === true,
    JSON.stringify(evidence).slice(0, 200));

  caseText = await readCase();
  check("the screen shows EVIDENCED and lists the evidence record",
    (await stageReached("EVIDENCED")) && caseText.includes(evidence.evidenceId), caseText.slice(0, 200));
  check(
    "evidence is still not money — the proven ledger remains NOT COMPUTED",
    /NOT COMPUTED/.test(caseText) && !/\$0\.00/.test(caseText),
  );

  // THE APPROVAL. A different identity, in a different role, as the server requires.
  const approval = await page.evaluate(async ([caseId, baselineId, evidenceId]) => {
    const res = await fetch("/api/proofs", {
      method: "POST",
      headers: { "content-type": "application/json", "x-actor-id": "cfo@company", "x-actor-role": "approver" },
      body: JSON.stringify({
        proofId: `PF-journey-${caseId.slice(3, 11)}`,
        recoveryCaseId: caseId,
        currency: "USD",
        collectedMinor: 9_000,
        excludedRecoveryMinor: 0,
        exclusionStatement: "journey · no exclusions asserted",
        recoveryReason: "UsageActivation",
        attribution: "ar-system",
        evidenceIds: [evidenceId],
        baselineId,
        confidenceUsed: 95,
      }),
    });
    return { status: res.status, body: await res.text() };
  }, [recoveryCaseId, `BL-journey-${recoveryCaseId.slice(3, 11)}`, evidence.evidenceId]);
  check("an approver — never the author — freezes the proof", approval.status === 201,
    `${approval.status} ${approval.body.slice(0, 160)}`);

  caseText = await readCase();
  check("the case reads PROVEN", await stageReached("PROVEN"), caseText.slice(0, 200));
  check(
    "Revenue Returned is the kernel's figure, collected minus baseline, and names the proof it came from",
    /\$70\.00/.test(caseText) && /PF-journey-/.test(caseText),
    caseText.slice(0, 240),
  );
  // THE WHOLE POINT OF THE SECTION, on one screen at one moment: an identified gap of $100.00 and a
  // proven return of $70.00, two numbers, neither standing in for the other.
  check(
    "the identified gap and the proven return are shown as two DIFFERENT numbers on the same screen",
    /\$100\.00/.test(caseText) && /\$70\.00/.test(caseText) && /not money returned/i.test(caseText),
  );

  // ── 13f · The governed record agrees, and no second case exists ────────────────────────────────
  const finalState = await page.evaluate(async ([caseId, boundaryId]) => {
    const res = await fetch(`/api/recovery-cases/${caseId}`, {
      headers: { "x-actor-id": "cfo@company", "x-actor-role": "approver" },
    });
    const view = res.ok ? await res.json() : null;
    const queue = await fetch(`/api/agent-candidates?boundaryId=${encodeURIComponent(boundaryId)}`, {
      headers: { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" },
    });
    return { status: res.status, view, pending: queue.ok ? (await queue.json()).length : -1 };
  }, [recoveryCaseId, BOUNDARY]);
  check(
    "the server's own record carries the same two figures the screen showed",
    finalState.status === 200 &&
      finalState.view?.lifecycle?.exposure?.minor === 10_000 &&
      finalState.view?.provenRevenueReturnedMinor === 7_000 &&
      finalState.view?.lifecycle?.exposureIsNotRecoveredRevenue === true,
    JSON.stringify(finalState.view?.lifecycle?.exposure ?? {}),
  );
  check(
    "the case's root still names the candidate and the detector it came from",
    finalState.view?.root?.detectorVersion === "activation-deadline-v1" &&
      typeof finalState.view?.root?.sourceCandidateId === "string" &&
      finalState.view.root.sourceCandidateId.startsWith("CC-"),
    `${finalState.view?.root?.detectorVersion} · ${finalState.view?.root?.sourceCandidateId}`,
  );
  check("and the boundary still holds no further candidate awaiting promotion", finalState.pending === 0);

  // ── 13g · FAILS CLOSED · the beneficiary cannot read the proof provenance ──────────────────────
  //
  // The operator who opened this case is the actor who benefits from a larger recovery number. The
  // separation is the server's, not the screen's, so it is checked against the server.
  const refusals = await page.evaluate(async ([caseId]) => {
    const get = async (actorId, role, id) => {
      const res = await fetch(`/api/recovery-cases/${id}`, { headers: { "x-actor-id": actorId, "x-actor-role": role } });
      return { status: res.status, body: await res.text() };
    };
    return {
      operator: await get("pilot-operator@company", "operator", caseId),
      author: await get("dana@company", "author", caseId),
      missing: await get("cfo@company", "approver", "RC-00000000-0000-0000-0000-000000000000"),
    };
  }, [recoveryCaseId]);
  check("the case owner's own operator identity is refused the proof provenance, 403",
    refusals.operator.status === 403 && refusals.author.status === 403,
    `operator=${refusals.operator.status} author=${refusals.author.status}`);
  check("a case id with no authoritative root is 404, not an empty case",
    refusals.missing.status === 404, `${refusals.missing.status} ${refusals.missing.body.slice(0, 120)}`);
  check("and the refusal body carries no case data",
    !refusals.operator.body.includes("amountAtRisk") && !refusals.operator.body.includes("exposure"),
    refusals.operator.body.slice(0, 120));

  // ── 14 · The OPERATOR journey: Identify → Fix → Prove, entirely through the Synthetic Demo screen ─────
  //
  // NO SEED SCRIPT IS AN OPERATOR STEP. Everything an operator does here is a click on a screen that calls
  // a governed route: the launch enqueues the LABELLED synthetic book through the demo module, the REAL
  // reconciler and the REAL worker find the shortfalls, the REAL admission bar admits them, and the case is
  // reviewed, opened, owned, baselined, acted on, settled by a SIGNED synthetic source, and approved by a
  // DIFFERENT identity — each step enforced by the server, not by this page.
  //
  // WHAT THE BOOK CONTAINS, and therefore what must and must not reach the queue: three payers are
  // under-billed (candidates: $600.00, $1,500.00, $1,000.00), one is balanced, one is OVER-billed (a
  // liability, never a candidate and never netted), one is unpriced (an UNKNOWN, never a $0.00 finding).
  //
  // THE ONE REMAINING HARNESS SCRIPT is `seed-journey-case-evidence.ts ... tampered`, and it is a NEGATIVE
  // CONTROL, not an operator step: it plays an attacker who signs one amount and submits another.
  // EVIDENCE CAPTURE · screenshots of the real screen at named moments, written only when
  // JOURNEY_EVIDENCE_DIR is set (CI uploads that directory as an artifact). Pure observation: a failure to
  // capture never changes a verdict. Everything on these screens is SYNTHETIC and already labelled so.
  section14Start = results.length;
  const shot = async (name) => {
    // The visible text of the demo's two ledgers and its stage ribbon at the moment of the screenshot — a
    // textual record of what the picture shows, readable where the image artifact cannot be opened.
    try {
      const text = async (testid) => (await page.locator(`[data-testid="${testid}"]`).first().innerText({ timeout: 1500 }).catch(() => "—")).replace(/\s+/g, " ").trim();
      const stages = await page.locator('[data-testid^="demo-stage-"]').evaluateAll((els) => els.filter((e) => e.getAttribute("data-reached") === "yes").map((e) => e.textContent?.trim()));
      uiStates.push(`${name}: exposure=[${await text("demo-exposure")}] returned=[${await text("demo-returned")}] stages=[${stages.join(",") || "none"}] proof=[${(await text("demo-proof")).slice(0, 160)}]`);
    } catch { /* observation only */ }
    if (!EVIDENCE_DIR) return;
    try { await page.screenshot({ path: join(EVIDENCE_DIR, `${name}.png`), fullPage: true }); } catch { /* observation only */ }
  };
  const fmtMoney = (minor) => `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const asOperator = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
  const asApprover = { "x-actor-id": "cfo@company", "x-actor-role": "approver" };
  const apiCall = (method, path, headers, body) => page.evaluate(async ([m, p, h, b]) => {
    const init = { method: m, headers: { ...h } };
    if (b !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(b); }
    const res = await fetch(`/api${p}`, init);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, body: text.slice(0, 200), json };
  }, [method, path, headers, body]);
  const bodyText = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const stageNow = (stage) => page.waitForFunction(
    (s) => document.querySelector(`[data-testid="demo-stage-${s}"]`)?.getAttribute("data-reached") === "yes",
    stage, { timeout: 20_000 },
  ).then(() => true, () => false);
  const stageIs = async (stage) =>
    (await page.locator(`[data-testid="demo-stage-${stage}"]`).getAttribute("data-reached").catch(() => null)) === "yes";

  await page.getByRole("button", { name: "Synthetic Demo (live API)" }).click();
  await page.locator('[data-testid="synthetic-banner"]').waitFor({ timeout: 15_000 });
  let consoleText = await bodyText();
  check("the demo screen says SYNTHETIC before anything else, and denies real data, payments and money",
    /SYNTHETIC DEMONSTRATION/.test(consoleText) && /No customer data, no payment rail, no real money/.test(consoleText),
    consoleText.slice(0, 200));
  check("before launch there is no candidate, no case, and Revenue Returned reads NOT COMPUTED",
    (await page.locator('[data-testid="demo-candidate"]').count()) === 0 &&
      /NOT COMPUTED/.test(await page.locator('[data-testid="demo-returned"]').innerText()),
    consoleText.slice(0, 200));
  await shot("01-before-launch");

  // NC · only an operator may launch. The screen offers the button to the operator; the SERVER decides.
  const launchRefusals = {};
  for (const [name, headers] of [
    ["author", { "x-actor-id": "dana@company", "x-actor-role": "author" }],
    ["approver", asApprover],
    ["steward", { "x-actor-id": "gov@company", "x-actor-role": "steward" }],
  ]) launchRefusals[name] = (await apiCall("POST", "/synthetic-demo/launch", headers)).status;
  check("NC · author, approver and steward are refused when they try to launch the synthetic reconciliation",
    Object.values(launchRefusals).every((s) => s === 403), JSON.stringify(launchRefusals));

  await page.getByRole("button", { name: "Launch synthetic reconciliation" }).click();
  let reconPending = 0;
  for (let attempt = 0; attempt < 80 && reconPending < 3; attempt += 1) {
    await page.waitForTimeout(500);
    reconPending = await page.locator('[data-testid="demo-candidate"]').count();
  }
  consoleText = await bodyText();
  check("exactly the three under-billed payers reach the screen's review list", reconPending === 3,
    `${reconPending} candidates · alert=${(await page.locator('[role="alert"]').allInnerTexts().catch(() => [])).join(" / ").slice(0, 200)} · notice=${(await page.locator('[role="status"]').allInnerTexts().catch(() => [])).join(" / ").slice(0, 200)}`);
  haltIf(reconPending !== 3, "the reconciler's candidates did not reach the screen, so the rest of section 14 is unreachable");

  const reconApi = await apiCall("GET", `/agent-candidates?boundaryId=${encodeURIComponent(BOUNDARY)}`, asOperator);
  const reconItems = reconApi.json ?? [];
  const reconAmounts = reconItems.map((i) => i.signal.amountAtRiskMinor).sort((a, b) => a - b);
  checkEqual("the queue holds the three shortfalls and nothing else — no balanced, over-billed or unpriced unit",
    JSON.stringify(reconAmounts), JSON.stringify([60_000, 100_000, 150_000]));
  check("each carries the reconciler's own type and detector, and an opaque pseudonymous reference",
    reconItems.every((i) => i.signal.recoveryType === "RevenueUnderBilled" &&
      i.signal.detectorVersion === "reconciliation-observation-v1" &&
      /^hmac-sha256:[a-f0-9]{64}$/.test(i.signal.sourceRef)) &&
      new Set(reconItems.map((i) => i.signal.sourceRef)).size === 3,
    reconItems.map((i) => i.signal.sourceRef.slice(0, 22)).join(" "));
  check("the screen total is $3,100.00 and every candidate is labelled Revenue Opportunity, not proven",
    /\$3,100\.00/.test(await page.locator('[data-testid="demo-exposure"]').innerText()) &&
      (consoleText.match(/revenue opportunity · not proven/gi) ?? []).length === 3,
    consoleText.slice(0, 220));
  check("the Returned panel is still NOT COMPUTED — an identified total is not money returned",
    /NOT COMPUTED/.test(await page.locator('[data-testid="demo-returned"]').innerText()));
  check("no raw contract, payer or invoice reference from the extracts is shown anywhere",
    !/(ENT|PAYER|SL|INV)-DEMO/.test(consoleText));
  await shot("02-after-launch-3-candidates");

  // IDENTIFY → accept → open. Two separate operator actions, as the review screen has always required.
  //
  // THE OPERATOR CHOOSES THE CASE. The journey no longer takes whichever card happens to be first: it selects
  // the $600.00 shortfall by the amount the CARD ITSELF shows, asserts that exactly one card matches, and
  // accepts that card's own button. Everything below is then pinned to the three numbers of the acceptance
  // scenario — $600.00 identified, $100.00 locked baseline, $500.00 proven — so a different candidate being
  // promoted would fail loudly here instead of passing with different figures.
  const TARGET_EXPOSURE_MINOR = 60_000;
  const LOCKED_BASELINE_MINOR = 10_000;
  const EXPECTED_RETURNED_MINOR = 50_000;
  const OTHER_PENDING_MINOR = [100_000, 150_000];
  const targetCard = page.locator('[data-testid="demo-candidate"]').filter({ hasText: new RegExp(`(^|[^\\d,.])\\${fmtMoney(TARGET_EXPOSURE_MINOR)}(?!\\d)`) });
  check("exactly one candidate card shows the $600.00 shortfall, and the operator selects it", (await targetCard.count()) === 1,
    `${await targetCard.count()} cards match`);
  haltIf((await targetCard.count()) !== 1, "the $600.00 candidate could not be selected on the screen");
  await targetCard.getByRole("button", { name: "Accept candidate" }).click();
  await page.getByRole("button", { name: "Open Recovery Case" }).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Open Recovery Case" }).click();
  await page.locator('[data-testid="demo-case-id"]').waitFor({ timeout: 15_000 });
  const reconCaseId = (await page.locator('[data-testid="demo-case-id"]').innerText()).trim();
  check("promoting ONE candidate creates ONE Recovery Case", /^RC-[0-9a-f-]+$/i.test(reconCaseId) && reconCaseId !== recoveryCaseId,
    reconCaseId);
  haltIf(!/^RC-/.test(reconCaseId), "no Recovery Case id was reported for the reconciler candidate");

  const exposureText = await page.locator('[data-testid="demo-exposure"]').innerText();
  const shownAmounts = [60_000, 100_000, 150_000].filter((a) => exposureText.includes(fmtMoney(a)));
  checkEqual("the case shows exactly one identified exposure, and it is the selected $600.00 — not $1,000.00, not $1,500.00",
    JSON.stringify(shownAmounts), JSON.stringify([TARGET_EXPOSURE_MINOR]));
  const exposureMinor = TARGET_EXPOSURE_MINOR;
  const openedView = await apiCall("GET", `/recovery-cases/${reconCaseId}`, asApprover);
  checkEqual("the case's governed record holds the same $600.00 exposure and no proven figure yet",
    JSON.stringify({ e: openedView.json?.lifecycle?.exposure?.minor, p: openedView.json?.provenRevenueReturnedMinor ?? null }),
    JSON.stringify({ e: TARGET_EXPOSURE_MINOR, p: null }));
  const afterOpen = await apiCall("GET", `/agent-candidates?boundaryId=${encodeURIComponent(BOUNDARY)}`, asOperator);
  const pendingAmounts = (afterOpen.json ?? []).map((i) => i.signal.amountAtRiskMinor).sort((a, b) => a - b);
  checkEqual("the other two shortfalls ($1,000.00 and $1,500.00) stay pending — one promotion promotes one candidate",
    JSON.stringify(pendingAmounts), JSON.stringify(OTHER_PENDING_MINOR));
  // NC · a pending candidate is not a case: the synthetic payer cannot settle it, whatever its id.
  const pendingIds = (afterOpen.json ?? []).map((i) => i.candidateId);
  const settlePending = await Promise.all(pendingIds.map((id) => apiCall("POST", `/synthetic-demo/cases/${id}/settle`, asOperator)));
  check("NC · the synthetic payer cannot settle the two pending candidates — they are not cases and nothing is paid for them",
    settlePending.length === 2 && settlePending.every((r) => r.status === 404), JSON.stringify(settlePending.map((r) => r.status)));
  check("the case starts at OPENED and nothing further is claimed",
    (await stageIs("OPENED")) && !(await stageIs("OWNED")) && !(await stageIs("PROVEN")));
  await shot("03-case-opened-exposure-only");

  // NC · the synthetic payer cannot pay before the fix exists — and not for a case that does not exist.
  const earlySettle = await apiCall("POST", `/synthetic-demo/cases/${reconCaseId}/settle`, asOperator);
  check("NC · the simulated payer is refused before the corrective action exists (the payment cannot precede the fix)",
    earlySettle.status === 409, `${earlySettle.status} ${earlySettle.body}`);
  const unknownSettle = await apiCall("POST", "/synthetic-demo/cases/RC-does-not-exist/settle", asOperator);
  check("NC · the simulated payer is refused for a case that does not exist", unknownSettle.status === 404,
    `${unknownSettle.status}`);

  // FIX · each button is the operator's, and each lands on the governed route.
  const buttonDisabled = (name) => page.getByRole("button", { name, exact: true }).isDisabled();
  check("the later steps are not offered yet — Lock baseline, Record corrective action and Simulate synthetic payment are disabled",
    (await buttonDisabled("Lock baseline")) && (await buttonDisabled("Record corrective action")) &&
      (await buttonDisabled("Simulate synthetic payment")) && (await buttonDisabled("Approve proof as Finance")));
  await page.getByRole("button", { name: "Record case owner" }).click();
  check("the case is OWNED", await stageNow("OWNED"));

  await page.getByLabel("Baseline amount").fill(fmtMoney(exposureMinor + 100).replace(/[$,]/g, ""));
  check("NC · a baseline at or above the exposure is not accepted (it would leave no room for any recovery)",
    await buttonDisabled("Lock baseline"), "button enabled");
  await page.getByLabel("Baseline amount").fill((LOCKED_BASELINE_MINOR / 100).toFixed(2));
  await page.getByRole("button", { name: "Lock baseline" }).click();
  check("the baseline is locked BEFORE any outcome exists — the case is BASELINED", await stageNow("BASELINED"));
  await page.getByRole("button", { name: "Record corrective action" }).click();
  check("the corrective action is recorded — the case is INTERVENED", await stageNow("INTERVENED"));
  haltIf(!(await stageIs("INTERVENED")), "the operator could not reach INTERVENED through the screen");
  await shot("04-owner-baseline-corrective-action-done");

  // PROVE (1) · the synthetic payer settles. NC first: other roles may not trigger the source.
  const settleRefusals = {};
  for (const [name, headers] of [["approver", asApprover], ["steward", { "x-actor-id": "gov@company", "x-actor-role": "steward" }]]) {
    settleRefusals[name] = (await apiCall("POST", `/synthetic-demo/cases/${reconCaseId}/settle`, headers)).status;
  }
  check("NC · the approver and the steward cannot trigger the synthetic payer",
    Object.values(settleRefusals).every((s) => s === 403), JSON.stringify(settleRefusals));
  const evidenceBefore = await apiCall("GET", `/cases/${reconCaseId}/evidence`, asApprover);
  check("and no evidence exists yet — every refusal above left the case untouched",
    evidenceBefore.status === 200 && (evidenceBefore.json ?? []).length === 0, `${evidenceBefore.status} ${evidenceBefore.body}`);

  await page.getByRole("button", { name: "Simulate synthetic payment" }).click();
  check("the case reads EVIDENCED", await stageNow("EVIDENCED"));
  consoleText = await bodyText();
  check("EVIDENCED is NOT proven — evidence is not money: Returned still reads NOT COMPUTED, never $0.00",
    !(await stageIs("PROVEN")) &&
      /NOT COMPUTED/.test(await page.locator('[data-testid="demo-returned"]').innerText()) && !/\$0\.00/.test(consoleText),
    consoleText.slice(0, 200));
  await shot("05-evidenced-still-not-computed");

  const evidenceList = await apiCall("GET", `/cases/${reconCaseId}/evidence`, asApprover);
  const settledEvidence = (evidenceList.json ?? [])[0];
  check("the settlement is ONE signed, independent OUTCOME record for exactly the identified exposure, labelled SYNTHETIC",
    (evidenceList.json ?? []).length === 1 &&
      settledEvidence?.evidenceRole === "outcome" && settledEvidence?.trustClassification === "independent" &&
      settledEvidence?.amountMinor === exposureMinor && settledEvidence?.amountMinor === TARGET_EXPOSURE_MINOR &&
      settledEvidence?.currency === "USD" &&
      /^SYNTHETIC-/.test(settledEvidence?.sourceRecordId ?? "") && settledEvidence?.evidenceId === `EV-SYNTHETIC-${reconCaseId}`,
    JSON.stringify(settledEvidence ?? null).slice(0, 220));
  const secondSettle = await apiCall("POST", `/synthetic-demo/cases/${reconCaseId}/settle`, asOperator);
  check("NC · the synthetic payer settles a case at most once", secondSettle.status === 409,
    `${secondSettle.status} ${secondSettle.body}`);

  // ── 14b · NEGATIVE CONTROLS at approval, then the proof ─────────────────────────────────────────
  //
  // Each control is a way a beneficiary — or a mistake — could turn this case into a counted number without
  // the evidence for it. Every one must be REFUSED and the case must stay un-proven afterwards; only then
  // does the screen's genuine approval run. They run first on purpose: a control that wrongly succeeded
  // would freeze a bad proof, and the failure message names which one did.
  //
  // THE REASON IS A LABEL. `BillingCorrection` says HOW the money came back. The figure comes from signed
  // outcome evidence and a locked baseline, exactly as for every other reason — and the controls prove the
  // gate does not read the label.
  const tag = reconCaseId.slice(3, 11);
  const baselineId = `BL-SYNTHETIC-${tag}`;
  const proofBody = (over = {}) => ({
    proofId: `PF-SYNTHETIC-${tag}`,
    recoveryCaseId: reconCaseId,
    currency: "USD",
    collectedMinor: exposureMinor,
    excludedRecoveryMinor: 0,
    exclusionStatement: "journey · no exclusions asserted (synthetic)",
    recoveryReason: "BillingCorrection",
    attribution: "corrective invoice raised and collected (synthetic)",
    evidenceIds: [settledEvidence?.evidenceId ?? "missing"],
    baselineId,
    confidenceUsed: 95,
    ...over,
  });
  const refused = (r) => r.status >= 400 && r.status < 500;
  const readProven = async () => (await apiCall("GET", `/recovery-cases/${reconCaseId}`, asApprover)).json?.provenRevenueReturnedMinor ?? null;

  const ncOverClaim = await apiCall("POST", "/proofs", asApprover, proofBody({ proofId: `PF-nc1-${tag}`, collectedMinor: exposureMinor + 1 }));
  check("NC · claiming more collected than the signed evidence substantiates is refused", refused(ncOverClaim), `${ncOverClaim.status} ${ncOverClaim.body}`);
  const ncNoEvidence = await apiCall("POST", "/proofs", asApprover, proofBody({ proofId: `PF-nc2-${tag}`, evidenceIds: [] }));
  check("NC · a proof that cites no evidence is refused, whatever its reason says", refused(ncNoEvidence), `${ncNoEvidence.status} ${ncNoEvidence.body}`);
  const ncAuthor = await apiCall("POST", "/proofs", { "x-actor-id": "dana@company", "x-actor-role": "author" }, proofBody({ proofId: `PF-nc3-${tag}` }));
  const ncOperator = await apiCall("POST", "/proofs", asOperator, proofBody({ proofId: `PF-nc4-${tag}` }));
  check("NC · the case's author and the operator who opened it cannot approve their own recovery",
    refused(ncAuthor) && refused(ncOperator), `author=${ncAuthor.status} operator=${ncOperator.status}`);
  const ncReason = await apiCall("POST", "/proofs", asApprover, proofBody({ proofId: `PF-nc5-${tag}`, recoveryReason: "billing_correction" }));
  check("NC · a reason outside the closed vocabulary is refused — the new value is exact, not a pattern", refused(ncReason), `${ncReason.status} ${ncReason.body}`);

  const tamperedEvidence = JSON.parse(
    execFileSync("npx", ["vite-node", "scripts/seed-journey-case-evidence.ts", reconCaseId, "tampered"], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        JOURNEY_API_PORT: String(API_PORT),
        JOURNEY_EVIDENCE_KEY_ID: EVIDENCE_KEY_ID,
        JOURNEY_EVIDENCE_PRIVATE_KEY: EVIDENCE_PRIVATE_KEY,
      },
    }),
  );
  check("NC · evidence whose amount was altered after it was signed is refused at ingestion",
    tamperedEvidence.ingested === false && tamperedEvidence.status >= 400 && tamperedEvidence.status < 500,
    `${tamperedEvidence.status} ${String(tamperedEvidence.body).slice(0, 120)}`);

  checkEqual("and after every refusal the case still holds NO proven figure", String(await readProven()), "null");
  check("and the screen still reads NOT COMPUTED, not PROVEN, not $0.00",
    !(await stageIs("PROVEN")) && /NOT COMPUTED/.test(await page.locator('[data-testid="demo-returned"]').innerText()) &&
      !/\$0\.00/.test(await bodyText()));

  // THE GENUINE APPROVAL: the Finance approver, a different identity from the operator, through the screen.
  await page.getByRole("button", { name: "Approve proof as Finance" }).click();
  await page.locator('[data-testid="demo-proof"]').waitFor({ timeout: 20_000 }).catch(() => undefined);
  const provenReached = await stageNow("PROVEN");
  check("an approver — never the operator — freezes the proof, and the case reads PROVEN", provenReached,
    (await bodyText()).slice(0, 200));
  haltIf(!provenReached, "the screen's genuine approval did not reach PROVEN");

  const proofId = `PF-SYNTHETIC-${tag}`;
  const returnedMinor = exposureMinor - LOCKED_BASELINE_MINOR;
  checkEqual("the scenario's arithmetic: $600.00 collected − $100.00 baseline = $500.00 returned",
    String(returnedMinor), String(EXPECTED_RETURNED_MINOR));
  const proofText = await page.locator('[data-testid="demo-proof"]').innerText();
  const returnedText = await page.locator('[data-testid="demo-returned"]').innerText();
  check("Revenue Returned is collected minus baseline, names the proof it came from, and is SYNTHETIC",
    returnedText.includes(fmtMoney(returnedMinor)) && (await bodyText()).includes(proofId) && /SYNTHETIC/.test(proofText),
    `${returnedText} · ${proofText.slice(0, 160)}`);
  check("the identified gap and the proven return are two DIFFERENT numbers on the same screen",
    (await page.locator('[data-testid="demo-exposure"]').innerText()).includes(fmtMoney(exposureMinor)) &&
      returnedText.includes(fmtMoney(returnedMinor)) && returnedMinor !== exposureMinor,
    `exposure ${fmtMoney(exposureMinor)} · returned ${fmtMoney(returnedMinor)}`);
  // On the demo screen itself, at the moment of PROVEN: Returned is exactly $500.00, Exposure exactly $600.00,
  // and neither the pending $2,500.00 nor the $3,100.00 opportunity total has leaked into the proven panel.
  const screenReturned = returnedText.replace(/\s+/g, " ");
  const screenExposure = (await page.locator('[data-testid="demo-exposure"]').innerText()).replace(/\s+/g, " ");
  check("on the demo screen Returned reads $500.00 and Exposure $600.00 — the pending $2,500.00 and the $3,100.00 total are not in Returned",
    screenReturned.includes(fmtMoney(EXPECTED_RETURNED_MINOR)) && screenExposure.includes(fmtMoney(TARGET_EXPOSURE_MINOR)) &&
      !screenReturned.includes(fmtMoney(250_000)) && !screenReturned.includes(fmtMoney(310_000)) &&
      !screenReturned.includes(fmtMoney(TARGET_EXPOSURE_MINOR)),
    `exposure=[${screenExposure.slice(0, 80)}] returned=[${screenReturned.slice(0, 80)}]`);
  await shot("06-after-proven-returned-vs-exposure");

  const frozen = await page.evaluate(async ([pid, caseId]) => {
    const h = { "x-actor-id": "cfo@company", "x-actor-role": "approver" };
    const proof = await fetch(`/api/proofs/${pid}`, { headers: h });
    const view = await fetch(`/api/recovery-cases/${caseId}`, { headers: h });
    return { proofStatus: proof.status, proof: proof.ok ? await proof.json() : null, view: view.ok ? await view.json() : null };
  }, [proofId, reconCaseId]);
  check("the frozen proof records the reason, the signed collection and the locked baseline",
    frozen.proofStatus === 200 &&
      frozen.proof?.recoveryReason === "BillingCorrection" &&
      frozen.proof?.collectedAmount?.minor === exposureMinor &&
      frozen.proof?.baselineAmount?.minor === LOCKED_BASELINE_MINOR &&
      frozen.proof?.revenueReturned?.minor === returnedMinor &&
      (frozen.proof?.evidenceRefs ?? []).includes(settledEvidence?.evidenceId),
    JSON.stringify({ r: frozen.proof?.recoveryReason, c: frozen.proof?.collectedAmount?.minor, b: frozen.proof?.baselineAmount?.minor }));
  check("the case's governed record agrees, and the exposure is a separate figure from the proven one",
    frozen.view?.provenRevenueReturnedMinor === returnedMinor &&
      frozen.view?.lifecycle?.exposure?.minor === exposureMinor &&
      frozen.view?.lifecycle?.exposureIsNotRecoveredRevenue === true,
    JSON.stringify({ p: frozen.view?.provenRevenueReturnedMinor, e: frozen.view?.lifecycle?.exposure?.minor }));

  // The same case on the READ-ONLY governed screen, which shares no code with the demo console.
  await page.getByRole("button", { name: "Recovery Case", exact: true }).click();
  await page.getByLabel("Recovery Case ID").fill(reconCaseId);
  await page.getByRole("button", { name: "Read case" }).click();
  await page.waitForTimeout(600);
  const reconCaseText = (await page.locator('[data-testid="recovery-case-body"]').innerText().catch(() => "")).replace(/\s+/g, " ");
  check("the independent Recovery Case screen reads the same case as PROVEN with the same two numbers",
    (await stageReached("PROVEN")) && reconCaseText.includes(fmtMoney(returnedMinor)) &&
      reconCaseText.includes(fmtMoney(exposureMinor)) && /not money returned/i.test(reconCaseText),
    reconCaseText.slice(0, 240));
  await shot("07-independent-case-screen-proven");

  const stillPending = await apiCall("GET", `/agent-candidates?boundaryId=${encodeURIComponent(BOUNDARY)}`, asOperator);
  const stillPendingAmounts = (stillPending.json ?? []).map((i) => i.signal.amountAtRiskMinor).sort((a, b) => a - b);
  checkEqual("proving one case does not touch the other two shortfalls — $1,000.00 and $1,500.00 remain pending candidates",
    JSON.stringify(stillPendingAmounts), JSON.stringify(OTHER_PENDING_MINOR));
  // UNCOUNTED: the only proven figure in the book is the one frozen proof. The two pending shortfalls
  // ($2,500.00 of Revenue Opportunity) contribute nothing to Returned, and the panel still says $500.00.
  const finalView = await apiCall("GET", `/recovery-cases/${reconCaseId}`, asApprover);
  check("the two pending shortfalls ($2,500.00) are uncounted: the book's only proven figure is the single $500.00 proof",
    finalView.json?.provenRevenueReturnedMinor === EXPECTED_RETURNED_MINOR &&
      stillPendingAmounts.reduce((a, b) => a + b, 0) === 250_000,
    `proven=${finalView.json?.provenRevenueReturnedMinor} pending=${JSON.stringify(stillPendingAmounts)}`);

  // ── 12 · Egress and page health ──────────────────────────────────────────────────────────────────
  const external = requested.filter((u) => !u.startsWith(UI_BASE) && !u.startsWith("data:") && !u.startsWith("blob:"));
  check("the page made no request outside its own origin", external.length === 0, external.slice(0, 3).join(", "));
  check("no uncaught page error occurred", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
} catch (error) {
  if (error instanceof JourneyHalted) {
    // Not a harness error: a stop this harness asked for, after recording why. `failures` is already
    // non-zero (haltIf guarantees it), so the run still reports FAILED — it just reports it truthfully.
    halted = error.message;
    console.error(`HALTED · ${error.message}`);
    annotate(`HALTED · ${error.message}`);
  } else {
    failures += 1;
    console.error(`FAIL · harness error · ${error instanceof Error ? error.stack : String(error)}`);
    annotate(`HARNESS ERROR · ${error instanceof Error ? error.message : String(error)}`);
  }
} finally {
  if (browser) await browser.close().catch(() => undefined);
  stop(ui);
  stop(api);
}

// EVIDENCE FILE · every recorded check from §14 onward, verbatim, so the acceptance record is the run's own
// output rather than a paraphrase of it. Also emitted as ONE notice annotation (readable from the check-run
// record when job logs are not downloadable). Nothing here changes a verdict.
if (section14Start >= 0) {
  const lines = results.slice(section14Start).map((r) => `${r.ok ? "PASS" : "FAIL"} · ${r.name}${r.detail ? ` · ${String(r.detail).replace(/\s+/g, " ").slice(0, 150)}` : ""}`);
  const header = `Synthetic Demo Console · operator journey (journey section 14) · ${lines.filter((l) => l.startsWith("PASS")).length}/${lines.length} checks passed`;
  if (EVIDENCE_DIR) writeFileSync(join(EVIDENCE_DIR, "section14-assertions.txt"), `${header}\n\n${lines.join("\n")}\n\nUI STATE AT EACH SCREENSHOT\n${uiStates.join("\n")}\n`);
  // Annotation messages are capped near 4 KB, so the record goes out in numbered chunks (each its own notice).
  const chunks = [];
  let cur = [];
  let size = 0;
  for (const line of [header, ...lines, "UI STATE AT EACH SCREENSHOT", ...uiStates]) {
    if (size + line.length > 3300 && cur.length) { chunks.push(cur); cur = []; size = 0; }
    cur.push(line);
    size += line.length + 1;
  }
  if (cur.length) chunks.push(cur);
  chunks.slice(0, 9).forEach((chunk, i) => {
    const text = chunk.join("\n").replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
    console.log(`::notice title=journey-evidence ${i + 1}/${Math.min(chunks.length, 9)}::${text}`);
  });
}

// The summary has to be unmistakable in a CI log. A harness error (a timeout, a missing element)
// is not a recorded check, so printing only "n/n checks passed" would read as a pass on a run that
// never reached most of its assertions — which is exactly what happens when the governed wiring
// regresses: the journey dies at the upload screen having passed every check before it.
const passed = results.filter((r) => r.ok).length;
const unrecorded = failures - results.filter((r) => !r.ok).length;
console.log(`\n${passed}/${results.length} recorded checks passed`);
if (unrecorded > 0) {
  console.log(`${unrecorded} harness error(s) — the journey did not finish, so the checks after the`);
  console.log("failure point never ran. This is a FAILURE, not a partial pass.");
}
if (halted) {
  console.log(`HALTED after the recorded failure above: ${halted}.`);
  console.log("The remaining steps were structurally unreachable, so they never ran and are NOT");
  console.log("counted as passes. This is a FAILURE, not a partial pass.");
}
console.log(failures === 0 ? "JOURNEY PASSED" : `JOURNEY FAILED (${failures} problem(s))`);
process.exit(failures === 0 ? 0 : 1);
