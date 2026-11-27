// FEASIBILITY PROBE 2 · what does the PRODUCTION observer do with the frozen company?
//
// `planReconciliation` is the production module `reconciliationObserver.ts` — not
// `src/benchmark/reconciliationCore.ts`, which the V2 audit measured and recorded as having ZERO
// production callers. The whole point of this exercise is the production lane, so the probe calls the
// production function.
//
// THE DECISIVE NUMBER IS THE COVERAGE SPLIT, not the candidate count. `coverageForCandidate` returns
// SINGLE_OBLIGATION only for a one-unit candidate; a candidate merging two units is ACCOUNT_AGGREGATE
// and `provenEligibility` refuses it `OBLIGATION_COVERAGE_IS_AGGREGATE`. So the fraction that can ever
// reach PROVEN is the single-obligation fraction, and measuring it decides whether this exercise is
// about detection or about proof.
import { parseStrictCsv } from "../../src/contract/csvPairTransport";
import { planReconciliation } from "../../server/agents/reconciliationObserver";
import { projectFrozenPackage } from "./project";

const PACKAGES = [
  ["V3 (no obligation reference)", "e2e/fixtures/reconciliation-synthetic"],
  ["obligation-ref variant", "e2e/fixtures/reconciliation-obligation-ref"],
] as const;

function money(minor: number): string {
  return "$" + (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

for (const [label, dir] of PACKAGES) {
  const pair = projectFrozenPackage(dir);
  const e = parseStrictCsv(pair.expectationCsv);
  const b = parseStrictCsv(pair.billingCsv);
  const plan = planReconciliation({
    expectation: { columns: e.header, rows: e.rows },
    billing: { columns: b.header, rows: b.rows },
    currency: "USD",
  });
  console.log("\n=== " + label + " ===");
  console.log("  usable           : " + plan.usable);
  console.log("  observed exposure: " + money(plan.observedExposureMinor));
  console.log("  counts:");
  for (const [k, v] of Object.entries(plan.counts)) {
    console.log("     " + k.padEnd(36) + " " + v);
  }
  const single = plan.candidates.filter((c) => c.units.length === 1);
  const agg = plan.candidates.filter((c) => c.units.length > 1);
  const residual = (c: { units: readonly { expectedMinor: number; observedMinor: number }[] }) =>
    c.units.reduce((t, u) => t + (u.expectedMinor - u.observedMinor), 0);
  console.log("  candidates       : " + plan.candidates.length);
  console.log("     SINGLE_OBLIGATION (can reach PROVEN) : " + single.length);
  console.log("     ACCOUNT_AGGREGATE (PROVEN refuses)   : " + agg.length);
  console.log("     exposure on single-obligation        : " + money(single.reduce((t, c) => t + residual(c), 0)));
  console.log("     exposure locked behind the aggregate : " + money(agg.reduce((t, c) => t + residual(c), 0)));
  const r = plan.refusedExposure;
  console.log("  refused exposure : state=" + r.state + " units=" + r.refusedUnits
    + " expected=" + money(r.refusedExpectedMinor) + " withoutExpected=" + r.refusedWithoutExpected);
}
console.log("\nSYNTHETIC · read-only · the production observer, not the benchmark core.");
