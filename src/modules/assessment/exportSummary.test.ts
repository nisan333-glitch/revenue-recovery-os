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
