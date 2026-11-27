// FOUR KINDS OF MONEY, AND THE RECALL EACH ONE SUPPORTS · derived, read-only.
//
// WHY THIS EXISTS. A single "monetary recall" figure over the frozen truth's whole planted total
// treats four different things as one: money the company never received, money it DID receive against
// the wrong obligation or payer, money it owes BACK, and amounts the truth prices at zero or UNKNOWN.
// A 90% target over that mixture is unreachable without counting money already collected as
// incremental recovery, which the constitution forbids outright.
//
// THE CLASSIFICATION IS THE TRUTH'S, NOT MINE. Every row below cites the frozen
// `business_expectation` verbatim, so a reader checks the classification against the artefact rather
// than against my reading of it. Where the truth's own words do not settle a class, the row says
// UNCLASSIFIED rather than guessing — an authored denominator is the thing this file exists to avoid.
//
// IT CHANGES NO EXISTING METRIC. The original recall figures and their three denominators are
// preserved exactly as `reconcile.ts` reports them; this is an ADDITIONAL accounting, reported beside
// them and never instead of them.
//
// AND IT IS NOT IN THE FROZEN HARNESS DIRECTORY, deliberately: `scripts/pilot-synthetic-company/` is
// covered by a tracked freeze lock, and adding a file there — even one the lock does not name — would
// blur what "the ruler is frozen" means. One honest consequence worth stating: that lock checks the
// six files it NAMES, so a new file in that directory would not be caught. This one is elsewhere.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseStrictCsv } from "../../src/contract/csvPairTransport";

const DIR = process.env.COMPANY_PACKAGE ?? "e2e/fixtures/reconciliation-obligation-ref";
const money = (m: number) => "$" + (m / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number, d: number) => (d === 0 ? "n/a" : ((n / d) * 100).toFixed(2) + "%");

/**
 * The four classes, and what each means for a RECOVERY claim.
 *
 * MISSING_CASH is the only one that can become Revenue Returned. The other three are reported and
 * must never enter a recovery numerator — that is the whole point of separating them.
 */
type MoneyClass =
  /** Never invoiced, under-invoiced, or invoiced short. The company is owed this. */
  | "MISSING_CASH"
  /** Received in full, against the wrong obligation or the wrong payer. An attribution error. */
  | "MISALLOCATED_RECEIVED"
  /** The company billed what it should not have. A liability, never recovery. */
  | "LIABILITY_OVER_BILLED"
  /** Priced at zero, UNKNOWN, or a required refusal. No recoverable amount is asserted. */
  | "NO_RECOVERABLE_AMOUNT"
  /**
   * SEVERAL KINDS OF MONEY IN ONE MECHANISM, and the truth does not split the amount between them.
   * It cannot enter a single-class denominator without me assigning money the artefact leaves joint,
   * so it is reported APART and excluded from every per-class rate, with the exclusion stated.
   */
  | "COMPOSITE"
  /**
   * THE TRUTH'S OWN WORDS DO NOT SETTLE IT. A class of its own because the first form of this file
   * folded it into NO_RECOVERABLE_AMOUNT — burying $11,584.80 of real missing cash in the pool that
   * says there is none. *A default that absorbs the unclassified is worse than a gap*, and this one
   * produced a recall of 139.01%, which is how it was caught.
   */
  | "UNCLASSIFIED";

/**
 * Classified from the truth's OWN `business_expectation`, by phrases the frozen file states. The
 * phrase that matched is printed beside every row, so the classification is checkable rather than
 * trusted.
 */
function classify(
  businessExpectation: string, expectedClassification: string, amount: string, mustRefuse: boolean,
): { readonly cls: MoneyClass; readonly on: string } {
  const t = businessExpectation.toLowerCase();
  // ── COMPOSITE IS DERIVED FROM THE STRUCTURED FIELD, NOT FROM PROSE ─────────────────────────────
  //
  // The first form matched the phrase "two problems" in `business_expectation` and was WRONG TWICE.
  // M18 reads "a real shortfall here and a separate over-bill there; two problems" — two problems in
  // DIFFERENT PLACES, whose $799.00 is the shortfall alone; the truth's point there is that they must
  // not be NETTED, which is a reporting instruction and not a statement that the amount is joint. M07
  // reads "two problems" as well and its `expected_nh_classification` is a single
  // MONETARILY_BALANCED. Filing both as COMPOSITE removed $20,399.00 from the pools for a phrase.
  //
  // The derivable fact is whether ONE amount covers MORE THAN ONE KIND of money, and the truth states
  // that structurally: a mechanism whose `expected_nh_classification` names BOTH an under-billed and
  // an over-billed/not-expected outcome carries two kinds under one figure. That is read here, and
  // the prose is not consulted for this question at all.
  const k = expectedClassification.toUpperCase();
  if (/UNDER_BILLED/.test(k) && /(OVER_BILLED|NOT_EXPECTED)/.test(k)) {
    return {
      cls: "COMPOSITE",
      on: "expected_nh_classification names BOTH under-billed and over-billed/not-expected",
    };
  }
  if (/paid in full|was paid/.test(t)) return { cls: "MISALLOCATED_RECEIVED", on: "\"paid in full\" / \"was paid\"" };
  if (/owes money back|never recovered revenue/.test(t)) {
    return { cls: "LIABILITY_OVER_BILLED", on: "\"owes money back\" / \"never recovered revenue\"" };
  }
  if (mustRefuse) return { cls: "NO_RECOVERABLE_AMOUNT", on: "nh_must_refuse = YES" };
  if (!/^\d+$/.test(amount) || Number(amount) === 0) {
    return { cls: "NO_RECOVERABLE_AMOUNT", on: "authoritative amount is UNKNOWN or zero" };
  }
  // `never billed` was ABSENT from the first form and M11's $8,996.40 — "the uplift from the amendment
  // was never billed, four months running" — fell through to the default. Added because the truth
  // plainly says it, not to make a figure fit: the matched phrase is printed on every row so a reader
  // checks the widening rather than taking it.
  if (/never invoiced|never billed|unbilled|shortfall|under.?invoiced|under.?bill|missing/.test(t)) {
    return { cls: "MISSING_CASH", on: "\"never invoiced/billed\" / \"under-invoiced\" / \"shortfall\" / \"missing\"" };
  }
  return { cls: "UNCLASSIFIED", on: "the truth's own words do not settle it — NOT defaulted into a pool" };
}

const gt = parseStrictCsv(readFileSync(resolve(DIR, "ground-truth.csv"), "utf8"));
interface Row {
  mechanism: string; amount: number | null; shouldDetect: string; mustRefuse: boolean;
  business: string; cls: MoneyClass; on: string;
}
const rows: Row[] = gt.rows.map((r) => {
  const a = r.cells.authoritative_exposure_minor ?? "";
  const mustRefuse = (r.cells.nh_must_refuse ?? "").toUpperCase() === "YES";
  const business = r.cells.business_expectation ?? "";
  const { cls, on } = classify(business, r.cells.expected_nh_classification ?? "", a, mustRefuse);
  return {
    mechanism: r.cells.mechanism ?? "",
    amount: /^\d+$/.test(a) ? Number(a) : null,
    shouldDetect: r.cells.nh_should_detect ?? "",
    mustRefuse, business, cls, on,
  };
});

console.log("A · EVERY PLANTED MECHANISM, CLASSED BY THE TRUTH'S OWN WORDS  (" + DIR + ")\n");
console.log("   mechanism                        amount  class                  classified on");
for (const r of rows) {
  console.log("   " + r.mechanism.padEnd(31)
    + (r.amount === null ? "UNKNOWN" : money(r.amount)).padStart(12) + "  "
    + r.cls.padEnd(22) + " " + r.on);
}

const sum = (f: (r: Row) => boolean) => rows.filter(f).reduce((t, r) => t + (r.amount ?? 0), 0);
const plantedAll = sum(() => true);
const missingCash = sum((r) => r.cls === "MISSING_CASH");
const misallocated = sum((r) => r.cls === "MISALLOCATED_RECEIVED");
const liability = sum((r) => r.cls === "LIABILITY_OVER_BILLED");
const noAmount = sum((r) => r.cls === "NO_RECOVERABLE_AMOUNT");
const composite = sum((r) => r.cls === "COMPOSITE");
const unclassified = sum((r) => r.cls === "UNCLASSIFIED");

console.log("\nB · THE FOUR POOLS · they sum to the planted total, or this accounting is wrong\n");
console.log("   MISSING_CASH          (recoverable)      : " + money(missingCash));
console.log("   MISALLOCATED_RECEIVED (already received)  : " + money(misallocated));
console.log("   LIABILITY_OVER_BILLED (owed back)         : " + money(liability));
console.log("   NO_RECOVERABLE_AMOUNT (zero/UNKNOWN/refuse): " + money(noAmount));
console.log("   COMPOSITE             (several kinds, unsplit): " + money(composite));
console.log("   UNCLASSIFIED          (the truth is silent)  : " + money(unclassified));
console.log("   ─────────────────────────────────────────────────────");
console.log("   planted total                            : " + money(plantedAll));
const residual = plantedAll - (missingCash + misallocated + liability + noAmount + composite + unclassified);
console.log("   RESIDUAL (must be $0.00)                 : " + money(residual));
if (residual !== 0) { console.error("\nABORT: the pools do not sum to the planted total."); process.exit(1); }
if (unclassified !== 0) {
  console.log("\n   " + money(unclassified) + " IS UNCLASSIFIED. Per-class rates below EXCLUDE it, and that");
  console.log("   exclusion is stated rather than absorbed — the defect that produced 139.01%.");
}

console.log("\nC · THE $6,096.00 ALREADY RECEIVED · reconciled independently\n");
for (const r of rows.filter((x) => x.cls === "MISALLOCATED_RECEIVED")) {
  console.log("   " + r.mechanism.padEnd(31) + money(r.amount ?? 0).padStart(12));
  console.log("      the truth says: \"" + r.business + "\"");
}
console.log("   ─────────────────────────────────────────────────────");
console.log("   total already received by the company    : " + money(misallocated));
console.log("\n   THIS MAY NEVER ENTER A RECOVERY NUMERATOR. The company holds this cash; recovering it");
console.log("   again is not possible and claiming it would be counting one dollar twice. What is open");
console.log("   on these is ATTRIBUTION — which obligation or which payer the money belongs against —");
console.log("   and attribution is not recovery.");

// ── D · THEORETICAL MAXIMUM RECALL, AND NH'S ACTUAL RATE, BOTH PER DEFINITION ────────────────────
//
// THE NUMERATOR IS COMPUTED HERE, FROM THE SAME CLASSIFICATION AS THE DENOMINATOR. The first form
// QUOTED a true-positive figure measured elsewhere against a denominator computed here, and the two
// used different populations — which is how it printed a recall of 139.01%. A numerator and a
// denominator that do not come from one classification are not a rate.
import { planReconciliation } from "../../server/agents/reconciliationObserver";
import { projectFrozenPackage } from "../pilot-synthetic-company/project";

const pairFiles = projectFrozenPackage(DIR);
const ex = parseStrictCsv(pairFiles.expectationCsv);
const bi = parseStrictCsv(pairFiles.billingCsv);
const plan = planReconciliation({
  expectation: { columns: ex.header, rows: ex.rows },
  billing: { columns: bi.header, rows: bi.rows },
  currency: "USD",
});
const detectedByEntitlement = new Map<string, number>();
for (const c of plan.candidates) {
  for (const u of c.units) {
    detectedByEntitlement.set(u.entitlementRef,
      (detectedByEntitlement.get(u.entitlementRef) ?? 0) + (u.expectedMinor - u.observedMinor));
  }
}
const cohortOf = new Map<string, string[]>();
for (const r of gt.rows) {
  cohortOf.set(r.cells.mechanism ?? "",
    (r.cells.cohort_entitlements || r.cells.first_entitlement_id || "").split(/\s+/).filter((x) => x));
}
const detectedOn = (r: Row) =>
  (cohortOf.get(r.mechanism) ?? []).reduce((t, e) => t + (detectedByEntitlement.get(e) ?? 0), 0);

interface Definition {
  readonly label: string;
  readonly include: (r: Row) => boolean;
  readonly note: string;
}
const DEFINITIONS: Definition[] = [
  {
    label: "1 · TP / planted-total (every priced row)",
    include: () => true,
    note: "A 90% target here REQUIRES counting money the company already received, and money the "
      + "truth marks must-refuse. Unreachable by construction, not by a product gap.",
  },
  {
    label: "2 · TP / planted-detectable (the existing metric, preserved)",
    include: (r) => r.shouldDetect === "yes" && !r.mustRefuse,
    note: "Reachable in principle, and it still contains ALREADY-RECEIVED money, so reaching it would "
      + "mean claiming collected cash as recovery.",
  },
  {
    label: "3 · MISSING-CASH RECOVERY RECALL (new — the only one a 90% target can honestly take)",
    include: (r) => r.cls === "MISSING_CASH" && r.shouldDetect === "yes" && !r.mustRefuse,
    note: "Excludes already-received money, liabilities, zero/UNKNOWN amounts, required refusals, the "
      + "COMPOSITE mechanism and anything UNCLASSIFIED. Every exclusion is a pool printed above.",
  },
];

console.log("\nD · EACH DEFINITION · denominator, theoretical maximum, and NH's actual rate\n");
let aborted = false;
for (const d of DEFINITIONS) {
  const pool = rows.filter(d.include);
  const den = pool.reduce((t, r) => t + (r.amount ?? 0), 0);
  // The maximum is what the truth permits a detector to reach: mechanisms it says to detect.
  const max = pool.filter((r) => r.shouldDetect === "yes" && !r.mustRefuse)
    .reduce((t, r) => t + (r.amount ?? 0), 0);
  // The actual is NH's detected money ON THAT POOL, capped per mechanism at the authorised amount so
  // an over-detection cannot inflate a recall figure — that belongs in precision, not here.
  const actual = pool.reduce((t, r) => t + Math.min(detectedOn(r), r.amount ?? 0), 0);
  console.log("   " + d.label);
  console.log("       denominator          " + money(den));
  console.log("       theoretical maximum  " + money(max) + "  =  " + pct(max, den));
  console.log("       NH actual            " + money(actual) + "  =  " + pct(actual, den));
  console.log("       " + d.note);
  if (actual > den) {
    console.error("       ABORT: a rate above 100% is a broken measurement, not a result.");
    aborted = true;
  }
  console.log("");
}
if (aborted) process.exit(1);

console.log("E · WHAT THE SHORTFALL ON DEFINITION 3 ACTUALLY IS");
console.log("   The per-unit diagnostic (`unitDiagnostics`) shows the two unbilled units NH does not");
console.log("   turn into candidates are REFUSED_UNMATCHED_IDENTITY — refused by the TAINT rule and");
console.log("   DECLARED in `refusedExposure` (" + money(plan.refusedExposure.refusedExpectedMinor)
  + " over " + plan.refusedExposure.refusedUnits + " units,");
console.log("   state " + plan.refusedExposure.state + "). A refusal that reports itself is a different fact");
console.log("   from a silent miss, and a false-negative bucket that counts both the same way conflates");
console.log("   \"we could not see it\" with \"we saw it and refused to price it\".");

console.log("\nSYNTHETIC · read-only. No frozen artefact was written, no ground truth modified, and no");
console.log("threshold was changed. Every classification cites the truth's own words.");
