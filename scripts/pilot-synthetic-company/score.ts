// BLIND SCORING · the production observer against ground truth frozen three days earlier.
//
// THE TRUTH IS NOT MINE AND I DO NOT TOUCH IT. `ground-truth.csv` was frozen on 2026-11-24 under a
// tracked lock, before this exercise was asked for, and it carries `nh_should_detect`,
// `nh_must_refuse`, `money_unknown` and `attribution_possible` per mechanism — written against the
// BENCHMARK core's expected capability. This scorer reads it and never writes it; the freeze
// verifier runs afterwards to prove that.
//
// AND THE DENOMINATOR IS THE TRUTH'S, NOT THE PRODUCT'S. A scorer that decided for itself which
// mechanisms "counted" would be re-authoring the truth to match the result — the defect the V1/V2
// benchmark revision exists to record. So every one of the 19 mechanisms appears in the output,
// including the ones the truth says NH should not detect.
//
// WHAT IT CANNOT DO, said rather than implied: the truth's `nh_should_detect` was authored for the
// benchmark core. The production observer is a different implementation with a different grain, so a
// disagreement is a finding about the production lane and NOT evidence the truth is wrong.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseStrictCsv } from "../../src/contract/csvPairTransport";
import { planReconciliation, coverageForCandidate } from "../../server/agents/reconciliationObserver";
import { projectFrozenPackage } from "./project";

const DIR = process.env.SCORE_PACKAGE ?? "e2e/fixtures/reconciliation-obligation-ref";
const PSEUDONYM_KEY = "SYNTHETIC-SCORER-KEY-not-a-deployment-secret-0000";

function money(minor: number): string {
  return "$" + (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface TruthRow {
  mechanism: string;
  cohort: Set<string>;
  authoritativeMinor: number | null;
  shouldDetect: string;
  mustRefuse: string;
  attributionPossible: string;
}

function truth(): TruthRow[] {
  const raw = readFileSync(resolve(DIR, "ground-truth.csv"), "utf8");
  const { rows } = parseStrictCsv(raw);
  // BY NAME, NOT BY INDEX. `parseStrictCsv` returns `{rowNumber, cells}` keyed by column name; the
  // first form of this scorer indexed into the row as if it were an array, so EVERY cell read as
  // `undefined` — and the output was a tidy table of 19 blank mechanisms with UNKNOWN amounts that
  // looked like a finding about the data. A parse that fails silently is worse than one that throws.
  const at = (r: { cells: Readonly<Record<string, string>> }, c: string) => r.cells[c] ?? "";
  return rows.map((r) => {
    const cohort = new Set(
      (at(r, "cohort_entitlements") || at(r, "first_entitlement_id")).split(/\s+/).filter((s) => s.length > 0),
    );
    const a = at(r, "authoritative_exposure_minor");
    return {
      mechanism: at(r, "mechanism"),
      cohort,
      authoritativeMinor: /^\d+$/.test(a) ? Number(a) : null,
      shouldDetect: at(r, "nh_should_detect"),
      mustRefuse: at(r, "nh_must_refuse"),
      attributionPossible: at(r, "attribution_possible"),
    };
  });
}

const pair = projectFrozenPackage(DIR);
const e = parseStrictCsv(pair.expectationCsv);
const b = parseStrictCsv(pair.billingCsv);
const plan = planReconciliation({
  expectation: { columns: e.header, rows: e.rows },
  billing: { columns: b.header, rows: b.rows },
  currency: "USD",
});

// Every unit NH put on a candidate, keyed by entitlement, with the coverage its candidate carries.
interface DetectedUnit { entitlementRef: string; residualMinor: number; provable: boolean; accountRef: string }
const detected: DetectedUnit[] = [];
for (const c of plan.candidates) {
  const provable = coverageForCandidate(c, plan.currency, PSEUDONYM_KEY).kind === "SINGLE_OBLIGATION";
  for (const u of c.units) {
    detected.push({ entitlementRef: u.entitlementRef, residualMinor: u.expectedMinor - u.observedMinor, provable, accountRef: c.accountRef });
  }
}

const rows = truth();
const claimedByMechanism = new Map<string, DetectedUnit[]>();
const matchedUnits = new Set<DetectedUnit>();
for (const t of rows) {
  const mine = detected.filter((d) => t.cohort.has(d.entitlementRef));
  for (const m of mine) matchedUnits.add(m);
  claimedByMechanism.set(t.mechanism, mine);
}
// A unit no mechanism claims is exposure NH reported on an entitlement the truth planted nothing in.
const unclaimed = detected.filter((d) => !matchedUnits.has(d));

console.log("PRODUCTION-LANE SCORE · package " + DIR);
console.log("  (reconciliationObserver.ts — the module the worker runs, not src/benchmark/)\n");
console.log("  mechanism                        truth        NH detected   provable?  verdict");
// OVER EVERY DETECTED UNIT, NOT ONLY THE MATCHED ONES. The first form accumulated this inside the
// per-mechanism loop, so when the truth parse broke and nothing matched it reported `0.00% provable`
// against a real 4% — a figure that cannot be reached from the product's own output. The provable
// fraction is a property of the PLAN, so it is computed from the plan.
const provableMinor = detected.filter((d) => d.provable).reduce((s, d) => s + d.residualMinor, 0);
let tpMinor = 0, fnMinor = 0;
let tpCount = 0, fnCount = 0, correctSilence = 0, unexpectedDetection = 0, refusalHonoured = 0, refusalBreached = 0;

for (const t of rows) {
  const mine = claimedByMechanism.get(t.mechanism) ?? [];
  const got = mine.reduce((s, d) => s + d.residualMinor, 0);
  const prov = mine.filter((d) => d.provable).reduce((s, d) => s + d.residualMinor, 0);
  // `prov` is this mechanism's provable share, reported per row; the total is derived above.
  const mustRefuse = t.mustRefuse.toUpperCase() === "YES";
  let verdict: string;
  if (mustRefuse) {
    // THE REFUSAL CASES ARE SCORED FIRST AND SEPARATELY. Detecting money the truth says must be
    // refused is the worst available outcome, and folding it into "detected" would flatter it.
    if (mine.length === 0) { verdict = "REFUSAL HONOURED"; refusalHonoured += 1; }
    else { verdict = "REFUSAL BREACHED · " + money(got); refusalBreached += 1; }
  } else if (t.shouldDetect === "yes") {
    if (got > 0) { verdict = "TRUE POSITIVE"; tpCount += 1; tpMinor += got; }
    else { verdict = "FALSE NEGATIVE"; fnCount += 1; fnMinor += t.authoritativeMinor ?? 0; }
  } else if (t.shouldDetect === "no") {
    if (mine.length === 0) { verdict = "correct silence"; correctSilence += 1; }
    else { verdict = "DETECTED (truth says no) · " + money(got); unexpectedDetection += 1; }
  } else {
    verdict = mine.length > 0 ? "detected · " + money(got) : "not detected";
  }
  const truthAmt = t.authoritativeMinor === null ? "UNKNOWN" : money(t.authoritativeMinor);
  console.log("  " + t.mechanism.padEnd(32) + truthAmt.padStart(12) + money(got).padStart(14)
    + ("  " + money(prov)).padStart(11) + "  " + verdict);
}

console.log("\n  UNCLAIMED EXPOSURE (no mechanism in the truth covers it): " + unclaimed.length + " unit(s), "
  + money(unclaimed.reduce((s, d) => s + d.residualMinor, 0)));
if (unclaimed.length > 0) {
  console.log("    These are entitlements the truth planted nothing in. They are reported APART from");
  console.log("    both true and false positives: this scorer cannot establish from the truth alone");
  console.log("    whether each is a genuine finding or a false one.");
}

const plantedPriced = rows.filter((t) => t.authoritativeMinor !== null && t.mustRefuse.toUpperCase() !== "YES")
  .reduce((s, t) => s + (t.authoritativeMinor ?? 0), 0);
const detectedMinor = detected.reduce((s, d) => s + d.residualMinor, 0);

console.log("\n  ── TOTALS ──");
console.log("  planted (priced, non-refusal)          : " + money(plantedPriced));
console.log("  NH detected exposure (OBSERVED)        : " + money(detectedMinor));
console.log("  of which on a SINGLE_OBLIGATION case   : " + money(provableMinor) + "   <- the only money that can reach PROVEN");
console.log("  of which locked in ACCOUNT_AGGREGATE   : " + money(detectedMinor - provableMinor));
console.log("  true positive (matched money)          : " + money(tpMinor) + "  over " + tpCount + " mechanism(s)");
console.log("  false negative (missed money)          : " + money(fnMinor) + "  over " + fnCount + " mechanism(s)");
console.log("  monetary recall  (TP / planted)        : " + (plantedPriced === 0 ? "n/a" : ((tpMinor / plantedPriced) * 100).toFixed(2) + "%"));
console.log("  refusals honoured / breached           : " + refusalHonoured + " / " + refusalBreached);
console.log("  correct silences / unexpected          : " + correctSilence + " / " + unexpectedDetection);
console.log("\n  PROVABLE FRACTION of detected exposure : "
  + (detectedMinor === 0 ? "n/a" : ((provableMinor / detectedMinor) * 100).toFixed(2) + "%"));
console.log("\nSYNTHETIC. Every figure is OBSERVED exposure on generated data. Nothing here is");
console.log("Revenue Returned, and no amount became real money.");
