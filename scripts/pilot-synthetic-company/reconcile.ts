// FULL FINANCIAL RECONCILIATION of the production-lane run against the frozen ground truth.
//
// WHY THIS IS A SEPARATE INSTRUMENT FROM `score.ts`. The scorer answers "did NH find each planted
// mechanism". This answers the accounting question: does every dollar on both sides of the ledger
// have somewhere to go? A recall figure can be right while the reconciliation has a hole, and the
// hole is where fabricated money would hide.
//
// EVERY DENOMINATOR IS NAMED. A precision or recall figure without its denominator is a number
// nobody can check, and this repository has already recorded a measurement whose denominator was
// one dataset against a three-dataset total.
//
// AND "ZERO FABRICATED" IS DEMONSTRATED, NOT ASSERTED. The weak form — "no detected unit sits on an
// entitlement the truth planted nothing in" — leaves open that NH reported the RIGHT entitlement
// with the WRONG amount. So this compares the detected amount against the authoritative amount
// mechanism by mechanism AND unit by unit, and prints the residual of each comparison.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseStrictCsv } from "../../src/contract/csvPairTransport";
import { planReconciliation, coverageForCandidate } from "../../server/agents/reconciliationObserver";
import { projectFrozenPackage } from "./project";

const DIR = process.env.COMPANY_PACKAGE ?? "e2e/fixtures/reconciliation-obligation-ref";
const KEY = "SYNTHETIC-RECONCILER-KEY-not-a-deployment-secret";
// The baseline fraction `run.ts` uses. Named here so the $306.44 below is traceable to a decision
// rather than appearing as an unexplained gap between eligible exposure and returned revenue.
const BASELINE_FRACTION = 0.1;

const money = (m: number) => "$" + (m / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number, d: number) => (d === 0 ? "n/a" : ((n / d) * 100).toFixed(2) + "%");

interface Truth {
  mechanism: string;
  cohort: Set<string>;
  authoritative: number | null;
  shouldDetect: string;
  mustRefuse: boolean;
  moneyUnknown: boolean;
  attribution: string;
}

const gt = parseStrictCsv(readFileSync(resolve(DIR, "ground-truth.csv"), "utf8"));
const truth: Truth[] = gt.rows.map((r) => {
  const c = r.cells;
  const a = c.authoritative_exposure_minor ?? "";
  return {
    mechanism: c.mechanism ?? "",
    cohort: new Set((c.cohort_entitlements || c.first_entitlement_id || "").split(/\s+/).filter((s) => s.length > 0)),
    authoritative: /^\d+$/.test(a) ? Number(a) : null,
    shouldDetect: c.nh_should_detect ?? "",
    mustRefuse: (c.nh_must_refuse ?? "").toUpperCase() === "YES",
    moneyUnknown: (c.money_unknown ?? "") === "yes",
    attribution: c.attribution_possible ?? "",
  };
});

const pair = projectFrozenPackage(DIR);
const e = parseStrictCsv(pair.expectationCsv);
const b = parseStrictCsv(pair.billingCsv);
const plan = planReconciliation({
  expectation: { columns: e.header, rows: e.rows },
  billing: { columns: b.header, rows: b.rows },
  currency: "USD",
});

interface Unit { entitlementRef: string; residual: number; provable: boolean }
const units: Unit[] = [];
for (const c of plan.candidates) {
  const provable = coverageForCandidate(c, plan.currency, KEY).kind === "SINGLE_OBLIGATION";
  for (const u of c.units) units.push({ entitlementRef: u.entitlementRef, residual: u.expectedMinor - u.observedMinor, provable });
}
const detectedTotal = units.reduce((s, u) => s + u.residual, 0);
const eligibleTotal = units.filter((u) => u.provable).reduce((s, u) => s + u.residual, 0);

// ── A · EVERY PLANTED DOLLAR, WITH SOMEWHERE TO GO ────────────────────────────────────────────────
console.log("A · THE GROUND TRUTH, RECONCILED IN FULL  (package " + DIR + ")\n");
console.log("   mechanism                      authoritative     detected     residual  bucket");
const buckets = new Map<string, { count: number; truthMinor: number; detectedMinor: number }>();
const add = (k: string, t: number, d: number) => {
  const cur = buckets.get(k) ?? { count: 0, truthMinor: 0, detectedMinor: 0 };
  buckets.set(k, { count: cur.count + 1, truthMinor: cur.truthMinor + t, detectedMinor: cur.detectedMinor + d });
};
let fabricated = 0;
for (const t of truth) {
  const mine = units.filter((u) => t.cohort.has(u.entitlementRef));
  const got = mine.reduce((s, u) => s + u.residual, 0);
  const auth = t.authoritative ?? 0;
  // THE RESIDUAL IS THE WHOLE POINT. A positive residual is money NH reported that the truth does
  // not authorise — fabricated money. A negative one is money NH missed.
  const residual = got - auth;
  if (residual > 0) fabricated += residual;
  let bucket: string;
  if (t.mustRefuse) bucket = mine.length === 0 ? "REFUSAL_HONOURED" : "REFUSAL_BREACHED";
  else if (t.moneyUnknown) bucket = mine.length === 0 ? "UNKNOWN_NOT_PRICED" : "UNKNOWN_BUT_DETECTED";
  else if (t.shouldDetect === "yes" && got > 0) bucket = "TRUE_POSITIVE";
  else if (t.shouldDetect === "yes") bucket = "FALSE_NEGATIVE";
  else if (t.shouldDetect === "no" && mine.length > 0) bucket = "DETECTED_BEYOND_BASELINE";
  else bucket = "CORRECT_SILENCE";
  add(bucket, t.authoritative === null ? 0 : auth, got);
  console.log("   " + t.mechanism.padEnd(30)
    + (t.authoritative === null ? "UNKNOWN" : money(auth)).padStart(14)
    + money(got).padStart(13)
    + (residual === 0 ? "            —" : money(residual).padStart(13))
    + "  " + bucket);
}

console.log("\n   ── BUCKETS ──");
let truthAccounted = 0, detectedAccounted = 0;
for (const [k, v] of [...buckets].sort()) {
  console.log("   " + k.padEnd(26) + String(v.count).padStart(3) + " mech"
    + money(v.truthMinor).padStart(14) + " truth" + money(v.detectedMinor).padStart(14) + " detected");
  truthAccounted += v.truthMinor;
  detectedAccounted += v.detectedMinor;
}
const plantedAll = truth.reduce((s, t) => s + (t.authoritative ?? 0), 0);
console.log("   " + "".padEnd(26) + "    " + money(truthAccounted).padStart(14) + "      " + money(detectedAccounted).padStart(14));
console.log("   planted total (priced rows)          : " + money(plantedAll));
console.log("   accounted for in buckets             : " + money(truthAccounted));
console.log("   UNACCOUNTED (must be $0.00)          : " + money(plantedAll - truthAccounted));
console.log("   NH detected total (from the plan)    : " + money(detectedTotal));
console.log("   attributed to a mechanism            : " + money(detectedAccounted));
console.log("   UNATTRIBUTED (must be $0.00)         : " + money(detectedTotal - detectedAccounted));

// ── B · FABRICATION, AT TWO GRAINS ───────────────────────────────────────────────────────────────
console.log("\nB · FABRICATED MONEY · demonstrated, not asserted\n");
console.log("   mechanism grain · Σ(detected − authoritative) where positive : " + money(fabricated));
// UNIT GRAIN. The mechanism comparison would hide two offsetting errors inside one cohort, so the
// same question is asked of every unit against the expectation row the truth's own package holds.
const expectedByUnit = new Map<string, number>();
for (const row of e.rows) {
  const k = `${row.cells.entitlement_ref}|${row.cells.period_start}`;
  const amt = Math.round(Number(row.cells.expected_amount ?? "0") * 100);
  if (Number.isFinite(amt)) expectedByUnit.set(k, (expectedByUnit.get(k) ?? 0) + amt);
}
let overUnit = 0;
for (const c of plan.candidates) {
  for (const u of c.units) {
    const declared = expectedByUnit.get(`${u.entitlementRef}|${u.periodStart}`);
    // A residual larger than the EXPECTATION ROW ITSELF would be money with no source at all.
    if (declared !== undefined && u.expectedMinor > declared) overUnit += u.expectedMinor - declared;
  }
}
console.log("   unit grain · Σ(expected claimed − expected declared in the file) : " + money(overUnit));
console.log("   units on an entitlement the truth planted nothing in            : "
  + units.filter((u) => !truth.some((t) => t.cohort.has(u.entitlementRef))).length);
console.log("\n   THE BOUND, STATED: these three together exclude money with no planted mechanism, money");
console.log("   exceeding a mechanism's authorised amount, and money exceeding its own expectation row.");
console.log("   They do NOT exclude two offsetting errors inside ONE unit, which no comparison against");
console.log("   a per-unit total can see.");

// ── C · PRECISION AND RECALL, DENOMINATORS NAMED ─────────────────────────────────────────────────
const tp = buckets.get("TRUE_POSITIVE")?.detectedMinor ?? 0;
const beyond = buckets.get("DETECTED_BEYOND_BASELINE")?.detectedMinor ?? 0;
const fn = buckets.get("FALSE_NEGATIVE")?.truthMinor ?? 0;
const plantedDetectable = truth.filter((t) => !t.mustRefuse && t.shouldDetect === "yes")
  .reduce((s, t) => s + (t.authoritative ?? 0), 0);
console.log("\nC · PRECISION AND RECALL · every denominator named\n");
console.log("   numerator   TP (money on mechanisms the truth says to detect)   : " + money(tp));
console.log("   numerator   detected beyond the baseline expectation (M07)      : " + money(beyond));
console.log("   denominator planted on mechanisms the truth says to detect      : " + money(plantedDetectable));
console.log("   denominator planted total, every priced row                     : " + money(plantedAll));
console.log("   denominator NH's own detected total                             : " + money(detectedTotal));
console.log("");
console.log("   monetary recall  = TP / planted-detectable   : " + pct(tp, plantedDetectable));
console.log("   monetary recall  = TP / planted-total        : " + pct(tp, plantedAll));
console.log("   monetary recall  = (TP+beyond) / planted-tot : " + pct(tp + beyond, plantedAll));
console.log("   monetary precision = (detected − fabricated) / detected : " + pct(detectedTotal - fabricated, detectedTotal));
console.log("   false negative money                         : " + money(fn));

// ── D · ELIGIBLE EXPOSURE vs RETURNED REVENUE ────────────────────────────────────────────────────
const baselineSum = plan.candidates
  .filter((c) => coverageForCandidate(c, plan.currency, KEY).kind === "SINGLE_OBLIGATION")
  .reduce((s, c) => s + Math.max(1, Math.floor(c.units.reduce((t, u) => t + (u.expectedMinor - u.observedMinor), 0) * BASELINE_FRACTION)), 0);
console.log("\nD · WHY RETURNED REVENUE IS BELOW ELIGIBLE EXPOSURE\n");
console.log("   eligible exposure (SINGLE_OBLIGATION cases)  : " + money(eligibleTotal));
console.log("   locked baselines, at the harness's " + (BASELINE_FRACTION * 100) + "%        : " + money(baselineSum));
console.log("   Revenue Returned = collected − baseline      : " + money(eligibleTotal - baselineSum));
console.log("   the difference IS the baseline               : " + money(baselineSum));
console.log("\n   This is not leakage in the measurement. `Collected − Baseline` is the definition of");
console.log("   Revenue Returned, so a locked baseline MUST reduce it. The " + (BASELINE_FRACTION * 100) + "% is the HARNESS'S");
console.log("   choice, named in `run.ts`; a real pilot's baseline comes from a governed method, and the");
console.log("   returned figure would move with it.");
console.log("\n   ineligible exposure, refused OBLIGATION_COVERAGE_IS_AGGREGATE : " + money(detectedTotal - eligibleTotal));
console.log("   proof-eligibility coverage of detected exposure               : " + pct(eligibleTotal, detectedTotal));

console.log("\nSYNTHETIC. Read-only over both frozen packages. No figure here is Revenue Returned from a");
console.log("customer, and no synthetic amount is classified as real money.");
