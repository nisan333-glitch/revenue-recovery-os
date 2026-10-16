import { describe, it, expect } from "vitest";
import { buildSummary, CSV_TEMPLATE } from "./exportSummary";
import { assessCsv } from "../../assessment/assess";
import { makePolicy } from "../../assessment/policy";

const CSV =
  "entity_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency\n" +
  "E1,2026-01-01,,2026-02-01,10000.00,USD\n" + // stalled, unpaid → observed 10000
  "E2,2026-01-01,2026-01-10,2026-02-01,5000.00,USD"; // activated, reference

async function result() {
  return assessCsv(CSV, makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" }), {
    createdAt: "2026-03-02T00:00:00.000Z",
  });
}

describe("buildSummary — pure, deterministic methodology export", () => {
  it("states all four money categories with the observed value and the not-calculated labels", async () => {
    const s = buildSummary(await result());
    expect(s).toContain("OBSERVED: Unpaid value in the stalled cohort = $10,000.00");
    expect(s).toContain("ESTIMATED (Revenue Leakage): Not calculated in this validation slice.");
    expect(s).toContain("FORECAST (Opportunity): Not calculated in this validation slice.");
    expect(s).toContain("PROVEN (Revenue Returned / Auditable): $0 — not applicable in M1.");
  });

  it("stamps the reproducible policy and cohort figures", async () => {
    const r = await result();
    const s = buildSummary(r);
    expect(s).toContain(`assessmentId: ${r.assessmentId}`);
    expect(s).toContain("stall threshold N: 30 days");
    expect(s).toContain("analysis asOf: 2026-03-01");
    expect(s).toContain("SHA-256:");
    expect(s).toContain("stalled (deviation): 1");
    expect(s).toContain("undetermined (within window, not yet due): 0");
    expect(s).toContain("reference (confirmed non-deviant): 1");
  });

  it("is deterministic for identical input", async () => {
    expect(buildSummary(await result())).toBe(buildSummary(await result()));
  });

  it("the CSV template carries the required grain columns", () => {
    for (const col of ["entity_id", "signed_at", "next_invoice_due_at", "next_invoice_amount", "currency"]) {
      expect(CSV_TEMPLATE).toContain(col);
    }
  });
});

describe("DETECTOR #2 · the export carries the second surface, separately and labelled OBSERVED", () => {
  it("reports the non-stalled overdue exposure in its own section, to the exact minor unit", async () => {
    const s = buildSummary(await result());
    expect(s).toContain("## Observed exposure OUTSIDE the activation-stall cohort (exact minor units)");
    expect(s).toContain("- obligations examined (non-stalled accepted cycles): 1");
    expect(s).toContain("- OBSERVED overdue unpaid (no activation stall): $5,000.00");
    expect(s).toContain("- OBSERVED overdue partial outstanding: $0.00");
  });

  it("leaves the activation-stall headline byte-identical — the new section is additive, not a re-grade", async () => {
    const s = buildSummary(await result());
    // The four-money-states block and the Observed breakdown must still read exactly as before.
    expect(s).toContain("OBSERVED: Unpaid value in the stalled cohort = $10,000.00");
    expect(s).toContain("- observed unpaid: $10,000.00");
    expect(s).toContain("- partial outstanding: $0.00");
    // And the headline sentence must not have acquired the second surface's money.
    expect(s).not.toContain("OBSERVED: Unpaid value in the stalled cohort = $15,000.00");
  });

  it("states the combined figure as derived for display from two disjoint surfaces", async () => {
    const r = await result();
    const s = buildSummary(r);
    const combined =
      r.observed.observedUnpaid.minor +
      r.observed.partialOutstanding.minor +
      r.nonStalledExposure.overdueUnpaid.minor +
      r.nonStalledExposure.overduePartialOutstanding.minor;
    expect(combined).toBe(1_500_000);
    expect(s).toContain("- COMBINED OBSERVED exposure (stalled + non-stalled, derived for display): $15,000.00");
  });

  it("makes no recovery, recoverability, return, proof or causal claim about the new figures", async () => {
    const s = buildSummary(await result());
    const open = s.indexOf("## Observed exposure OUTSIDE");
    const close = s.indexOf("## Data quality", open);
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    const section = s.slice(open, close).toLowerCase();
    for (const word of ["recovered", "recoverable", "returned", "proven", "caused"]) {
      let at = section.indexOf(word);
      while (at !== -1) {
        const before = section.slice(Math.max(0, at - 24), at);
        expect(before, `"${word}" must be negated, found: ...${before}[${word}]`).toMatch(
          /\b(not|no|never)\b[ a-z]*$/,
        );
        at = section.indexOf(word, at + 1);
      }
    }
    expect(section).toContain("no causal claim is made about why they are overdue");
  });
});
