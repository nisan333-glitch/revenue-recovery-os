// PER-UNIT DECISION STATE · the diagnostic, and the question it settled.
//
// WHY IT WAS ADDED. `counts.underBilledPairedHeld: 1` says one unit was held and cannot say WHICH, so
// "what suppressed this $799.00" could only be answered by inference from an aggregate counter —
// inference dressed as measurement. The diagnostic records the outcome of the SAME switch that
// produces the counts, in the same pass.
//
// WHAT IT SETTLED, and it was not what I expected. Both of the frozen package's two genuinely
// unbilled units read `REFUSED_UNMATCHED_IDENTITY` — the TAINT rule — not the pairing rule. The
// money is REFUSED AND DECLARED in `refusedExposure`, not silently lost, which is a different fact
// from the one a false-negative bucket reports.
import { describe, expect, it } from "vitest";
import { parseStrictCsv } from "../../src/contract/csvPairTransport";
import { planReconciliation } from "./reconciliationObserver";
import { projectFrozenPackage } from "../../scripts/pilot-synthetic-company/project";

const DIR = "e2e/fixtures/reconciliation-obligation-ref";

function plan() {
  const pair = projectFrozenPackage(DIR);
  const e = parseStrictCsv(pair.expectationCsv);
  const b = parseStrictCsv(pair.billingCsv);
  return planReconciliation({
    expectation: { columns: e.header, rows: e.rows },
    billing: { columns: b.header, rows: b.rows },
    currency: "USD",
  });
}

describe("per-unit decision state", () => {
  const p = plan();

  it("records EVERY unit exactly once — a diagnostic with a hole explains nothing", () => {
    expect(p.unitDiagnostics).toHaveLength(p.counts.units);
    const keys = p.unitDiagnostics.map((d) => `${d.entitlementRef}|${d.periodStart}|${d.periodEnd}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("AGREES WITH THE COUNTS, bucket by bucket — two statements of one classification may not drift", () => {
    // THE LOAD-BEARING ASSERTION. The diagnostic is only worth reading if it cannot disagree with the
    // counters a reader already trusts, and it is derived in the same pass precisely so it cannot.
    const tally = (outcome: string) => p.unitDiagnostics.filter((d) => d.outcome === outcome).length;
    expect(tally("CANDIDATE")).toBe(p.counts.candidateUnits);
    expect(tally("MONETARILY_BALANCED")).toBe(p.counts.monetarilyBalanced);
    expect(tally("OVER_BILLED")).toBe(p.counts.overBilledLiability);
    expect(tally("PAIRED_AND_HELD")).toBe(p.counts.underBilledPairedHeld);
    expect(tally("WITHHELD_SIBLING_REFUSAL")).toBe(p.counts.underBilledWithheldBySiblingRefusal);
    expect(tally("WITHHELD_NO_SINGLE_PAYER")).toBe(p.counts.underBilledWithheldNoSingleAccount);
    expect(tally("UNPRICED_UNKNOWN")).toBe(p.counts.unpricedUnknown);
    expect(tally("NOT_EXPECTED")).toBe(p.counts.notExpected);
    expect(tally("REFUSED")).toBe(p.counts.refused);
  });

  it("the frozen package's two unbilled units are REFUSED BY THE TAINT RULE, not by pairing", () => {
    // THE ANSWER TO "WHERE DID THE $3,387.70 GO". Both units have an expected amount and ZERO billing
    // lines — verified in the raw frozen rows — so they are real unbilled obligations. They are
    // refused `REFUSED_UNMATCHED_IDENTITY`, which is the taint scope, and `PAIRED_AND_HELD` is 1 and
    // is NEITHER of them. Before the diagnostic the only honest statement available was "a book-wide
    // rule hid it".
    for (const ref of ["syn-ent-0074", "syn-ent-0077"]) {
      const march = p.unitDiagnostics.find((d) => d.entitlementRef === ref && d.periodStart === "2026-03-01");
      expect(march, `${ref} must have a March unit in the frozen package`).toBeDefined();
      expect(march!.outcome).toBe("REFUSED");
      expect(march!.state).toBe("REFUSED_UNMATCHED_IDENTITY");
    }
    const paired = p.unitDiagnostics.filter((d) => d.outcome === "PAIRED_AND_HELD");
    expect(paired).toHaveLength(1);
    expect(["syn-ent-0074", "syn-ent-0077"]).not.toContain(paired[0]!.entitlementRef);
  });

  it("and that money is DECLARED as refused rather than lost", () => {
    // A REFUSAL THAT REPORTS ITSELF IS NOT A SILENT MISS, and the distinction is the whole reason this
    // test exists: a false-negative bucket that counts both the same way conflates "we could not see
    // it" with "we saw it and refused to price it".
    expect(p.refusedExposure.state).toBe("UNDETERMINED");
    expect(p.refusedExposure.refusedUnits).toBe(p.counts.refused);
    expect(p.refusedExposure.refusedExpectedMinor).toBeGreaterThan(0);
  });

  it("carries NO money and NO payer reference — it is a diagnostic, not a monetary surface", () => {
    // Asserted structurally so a later field cannot quietly make it one.
    for (const d of p.unitDiagnostics) {
      expect(Object.keys(d).sort()).toEqual(["entitlementRef", "outcome", "periodEnd", "periodStart", "state"]);
    }
  });

  it("an UNUSABLE extract records NO units, and that is not 'examined and clean'", () => {
    const bad = planReconciliation({
      expectation: { columns: ["nope"], rows: [] },
      billing: { columns: ["nope"], rows: [] },
      currency: "USD",
    });
    expect(bad.usable).toBe(false);
    expect(bad.unitDiagnostics).toHaveLength(0);
    // The empty array is only unambiguous BESIDE this, which is why both are asserted together.
    expect(bad.refusedExposure.state).toBe("NOT_EXAMINED");
  });
});
