// FREEZE — a deliberate, separate act between generating the package and letting NH near it.
//
// THE ORDER THIS ENFORCES:
//   generate -> validate -> FREEZE -> record hashes -> run NH -> score against the frozen truth
//
// WHY THIS IS ITS OWN STEP AND ITS OUTPUT IS TRACKED IN GIT. The first form of this harness wrote its
// freeze record from inside the generator, into a gitignored directory. That freeze was SELF-HEALING:
// every regeneration rewrote it, so any change to the package produced a new record that agreed with
// the new bytes, and nothing in version control said what had been frozen when a result was taken. A
// gate that updates itself cannot detect the only thing it exists to detect.
//
// It also covered the exports and the generator but NOT the runner, the scorer or the verifier — and
// the scorer IS part of the experiment. A ruler that can be reshaped after the measurement is not a
// ruler. (That gap was real: this harness's scorer was corrected after its first run. The correction
// was sound — it was double-counting money across two mechanisms that share a payer — but it moved
// false-positive money downward after the result was visible, which is exactly the move this control
// exists to make impossible rather than merely discouraged.)
//
// So the lock lives at scripts/reconciliation-synthetic/FREEZE.lock.json, is COMMITTED, and covers the
// data AND every script. Re-freezing is therefore a visible diff that a reviewer must approve, which is
// what "a governed benchmark revision with explicit evidence and a new freeze" means in practice.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const DIR = "e2e/fixtures/reconciliation-synthetic";
const HARNESS = "scripts/reconciliation-synthetic";
export const LOCK = `${HARNESS}/FREEZE.lock.json`;

export const DATA_FILES = ["expectation.csv", "observation.csv", "ground-truth.csv", "planted-register.json"];
export const SCRIPT_FILES = ["generate.mjs", "freeze.mjs", "run.ts", "score.mjs", "verify.mjs"];

export const sha = (t) => createHash("sha256").update(t).digest("hex");

export function currentHashes() {
  const data = {};
  for (const f of DATA_FILES) data[f] = sha(readFileSync(`${DIR}/${f}`, "utf8"));
  const scripts = {};
  for (const f of SCRIPT_FILES) scripts[f] = sha(readFileSync(`${HARNESS}/${f}`, "utf8"));
  return { data, scripts };
}

/** Every way the working tree can disagree with what was frozen. Empty means the experiment is intact. */
export function frozenProblems() {
  if (!existsSync(LOCK)) return ["no freeze lock exists — the package was never frozen, so no result may be taken from it"];
  const lock = JSON.parse(readFileSync(LOCK, "utf8"));
  const { compositeSha256, ...record } = lock;
  const problems = [];
  if (sha(JSON.stringify(record)) !== compositeSha256) problems.push("the freeze lock itself was edited");
  const now = currentHashes();
  for (const [f, want] of Object.entries(lock.data)) {
    if (now.data[f] !== want) problems.push(`${f} changed since the freeze — the SOURCE PACKAGE moved`);
  }
  for (const [f, want] of Object.entries(lock.scripts)) {
    if (now.scripts[f] !== want) problems.push(`${f} changed since the freeze — the HARNESS moved`);
  }
  return problems;
}

/** Refuse to proceed on a moved experiment. Used by the runner and the scorer alike. */
export function assertFrozen(headline) {
  const problems = frozenProblems();
  if (problems.length === 0) return;
  process.stdout.write(`${headline}\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
  process.exit(1);
}

/** Structural validation of the SOURCE PACKAGE, before it is frozen and before NH sees it. */
function validatePackage() {
  const problems = [];
  const csv = (p) => {
    const [h, ...rows] = readFileSync(`${DIR}/${p}`, "utf8").trim().split("\n");
    return { cols: h.split(","), rows };
  };
  const e = csv("expectation.csv");
  const o = csv("observation.csv");
  const t = csv("ground-truth.csv");

  for (const need of ["entitlement_id", "period_start", "period_end", "expected_amount", "currency"]) {
    if (!e.cols.includes(need)) problems.push(`expectation.csv is missing ${need}`);
  }
  for (const need of ["invoice_id", "subscription_id", "period_start", "billed_amount", "currency"]) {
    if (!o.cols.includes(need)) problems.push(`observation.csv is missing ${need}`);
  }
  for (const need of ["mechanism", "authoritative_exposure_minor", "expected_nh_classification", "business_expectation"]) {
    if (!t.cols.includes(need)) problems.push(`ground-truth.csv is missing ${need}`);
  }
  if (e.rows.length < 500) problems.push(`expectation.csv has only ${e.rows.length} rows — the package must be realistic in scale`);
  if (o.rows.length < 500) problems.push(`observation.csv has only ${o.rows.length} rows`);
  if (t.rows.length < 15) problems.push(`ground-truth.csv has only ${t.rows.length} cases`);

  // The two truth columns must actually differ somewhere, or the split that defuses circularity is
  // decorative: a register whose business expectation always equals the NH classification is only
  // recording what NH would do.
  const idxB = t.cols.indexOf("business_expectation");
  const idxC = t.cols.indexOf("expected_nh_classification");
  const differing = t.rows.filter((r) => {
    const cells = r.split(",");
    return (cells[idxB] ?? "") !== (cells[idxC] ?? "");
  }).length;
  if (differing === 0) problems.push("business_expectation never differs from expected_nh_classification");

  // UNKNOWN must be representable and present. A register with no unknowns has quietly priced
  // everything, which is the failure mode the whole UNKNOWN discipline exists to prevent.
  const idxA = t.cols.indexOf("authoritative_exposure_minor");
  const unknowns = t.rows.filter((r) => (r.split(",")[idxA] ?? "") === "UNKNOWN").length;
  if (unknowns === 0) problems.push("ground-truth.csv prices every case — no UNKNOWN exposure is recorded");

  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = validatePackage();
  if (problems.length > 0) {
    process.stdout.write(`PACKAGE VALIDATION FAILED — nothing frozen\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
    process.exit(1);
  }
  const { data, scripts } = currentHashes();
  const record = { frozenAt: "2026-10-06", order: "generate -> validate -> FREEZE -> run -> score", data, scripts };
  const next = `${JSON.stringify({ ...record, compositeSha256: sha(JSON.stringify(record)) }, null, 2)}\n`;

  if (existsSync(LOCK) && readFileSync(LOCK, "utf8") !== next) {
    // Re-freezing is permitted — and it is a tracked diff, never a silent one. The operator sees this
    // sentence and has to decide, with evidence, that the benchmark genuinely needed revising.
    process.stdout.write(
      `RE-FREEZING an existing lock. This is a GOVERNED BENCHMARK REVISION:\n` +
      `  - it will appear as a diff on ${LOCK}, which a reviewer must approve\n` +
      `  - it is legitimate ONLY with explicit evidence that the frozen truth was objectively wrong\n` +
      `  - it is NEVER legitimate to improve a result\n`,
    );
  }
  writeFileSync(LOCK, next);
  process.stdout.write(`frozen · ${DATA_FILES.length} data artefacts + ${SCRIPT_FILES.length} scripts -> ${LOCK}\n`);
}
