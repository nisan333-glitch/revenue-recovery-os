// WHY THE FIVE MISSED MECHANISMS ARE MISSED · an isolation experiment, read-only.
//
// THE FALSE-NEGATIVE TOTAL IS $9,483.70 OVER FIVE MECHANISMS, and the frozen truth already tells us
// three of them are not missing money at all:
//
//   M08 $2,798.00 — "the company was paid in full; the dollar sits against the wrong obligation"
//   M09 $3,298.00 — "paid in full, by the wrong entity in the same group"; needs an AUTHORITATIVE
//                   payer hierarchy supplied as governed terms, which nobody has supplied
//   M10     $0.00 — OVER_BILLED: "the company owes money back; a liability, never recovered revenue"
//
// So the question that remains is M18 ($799.00) and M20 ($2,588.70), which the truth says NH SHOULD
// detect as UNDER_BILLED. This script answers it by ISOLATION: run the production plan on the whole
// book, then on a subset containing only one mechanism's cohort. If a unit becomes a candidate when
// isolated, something ELSEWHERE in the book suppressed it, and the plan's own counters say which.
//
// WHY ISOLATION AND NOT A GUESS FROM THE COUNTERS. `underBilledPairedHeld: 1` tells us one unit was
// paired and held; it does not say WHICH. Reading a single aggregate counter and naming a mechanism
// from it would be inference dressed as measurement.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseStrictCsv } from "../../src/contract/csvPairTransport";
import { planReconciliation } from "../../server/agents/reconciliationObserver";
import { projectFrozenPackage } from "./project";

const DIR = process.env.COMPANY_PACKAGE ?? "e2e/fixtures/reconciliation-obligation-ref";
const money = (m: number) => "$" + (m / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const gt = parseStrictCsv(readFileSync(resolve(DIR, "ground-truth.csv"), "utf8"));
const truth = gt.rows.map((r) => ({
  mechanism: r.cells.mechanism ?? "",
  cohort: (r.cells.cohort_entitlements || r.cells.first_entitlement_id || "").split(/\s+/).filter((s) => s.length > 0),
  amount: r.cells.authoritative_exposure_minor ?? "",
  shouldDetect: r.cells.nh_should_detect ?? "",
  expected: r.cells.expected_nh_classification ?? "",
  needs: r.cells.source_facts_required ?? "",
}));

const pair = projectFrozenPackage(DIR);
const whole = { e: parseStrictCsv(pair.expectationCsv), b: parseStrictCsv(pair.billingCsv) };

function run(eRows: typeof whole.e.rows, bRows: typeof whole.b.rows) {
  return planReconciliation({
    expectation: { columns: whole.e.header, rows: eRows },
    billing: { columns: whole.b.header, rows: bRows },
    currency: "USD",
  });
}

const full = run(whole.e.rows, whole.b.rows);
console.log("FULL BOOK · candidates " + full.candidates.length + " · exposure " + money(full.observedExposureMinor));
console.log("  paired-and-held units      : " + full.counts.underBilledPairedHeld);
console.log("  withheld by sibling refusal: " + full.counts.underBilledWithheldBySiblingRefusal);
console.log("  withheld, no single payer  : " + full.counts.underBilledWithheldNoSingleAccount);
console.log("  over-billed (liability)    : " + full.counts.overBilledLiability);
console.log("  not expected               : " + full.counts.notExpected);
console.log("  refused                    : " + full.counts.refused + "\n");

const detectedEntitlements = new Set(full.candidates.flatMap((c) => c.units.map((u) => u.entitlementRef)));

const TARGETS = ["M08-wrong-entitlement", "M09-wrong-payer", "M10-billed-after-cancellation",
  "M18-unsupported-relationship", "M20-multiple-mechanisms"];

for (const name of TARGETS) {
  const t = truth.find((x) => x.mechanism === name)!;
  const inCohort = (ref: string) => t.cohort.includes(ref);
  // ISOLATED: only this cohort's expectation rows, and only the billing rows that name one of them.
  const eRows = whole.e.rows.filter((r) => inCohort(r.cells.entitlement_ref ?? ""));
  const bRows = whole.b.rows.filter((r) => inCohort(r.cells.obligation_ref ?? "")
    || whole.e.rows.some((x) => inCohort(x.cells.entitlement_ref ?? "")
      && x.cells.schedule_line_ref === r.cells.obligation_ref));
  const iso = run(eRows, bRows);
  const isoDetected = iso.candidates.reduce((s, c) => s + c.residualMinor, 0);
  const inFull = t.cohort.filter((r) => detectedEntitlements.has(r)).length;

  console.log("═══ " + name + " · truth " + (/^\d+$/.test(t.amount) ? money(Number(t.amount)) : t.amount));
  console.log("   truth expects       : " + t.expected);
  console.log("   needs source facts  : " + t.needs.slice(0, 110));
  console.log("   in the FULL book    : " + inFull + " of " + t.cohort.length + " cohort entitlements reached a candidate");
  console.log("   ISOLATED            : " + iso.candidates.length + " candidate(s), " + money(isoDetected));
  console.log("   isolated counters   : paired=" + iso.counts.underBilledPairedHeld
    + " siblingRefusal=" + iso.counts.underBilledWithheldBySiblingRefusal
    + " noPayer=" + iso.counts.underBilledWithheldNoSingleAccount
    + " over=" + iso.counts.overBilledLiability
    + " notExpected=" + iso.counts.notExpected
    + " refused=" + iso.counts.refused
    + " balanced=" + iso.counts.monetarilyBalanced);
  // THE VERDICT IS DERIVED FROM THE TWO RUNS, not narrated.
  const verdict = inFull > 0
    ? "DETECTED IN THE FULL BOOK (the scorer's FN is about the mechanism's amount, not its units)"
    : isoDetected > 0
      ? "SUPPRESSED BY THE REST OF THE BOOK — isolated, it IS a candidate. A book-wide rule hid it."
      : "NOT DETECTABLE FROM THIS COHORT ALONE — the gap is in the facts or the classification, not a book-wide rule";
  console.log("   VERDICT             : " + verdict + "\n");
}

console.log("SYNTHETIC · read-only. The frozen package was not written to, and no ground truth was");
console.log("modified. Isolation changes the INPUT to answer a question about the product; it is a");
console.log("diagnostic, never a measurement that may be quoted as recall.");
