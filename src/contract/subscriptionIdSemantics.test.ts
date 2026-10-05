// D2 · The declared meaning of `subscription_id` must match the behaviour that already exists.
//
// WHY THIS FILE EXISTS. The field is NAMED `subscription_id` but its meaning is PER CYCLE: a populated
// value becomes the cycle key verbatim, so two rows sharing it are one colliding identity and BOTH are
// excluded. A customer who populates it as its name implies — a stable subscription id spanning several
// invoices — therefore loses every one of those invoices and their money reads zero. The direction is
// beneficiary-ADVERSE, so no trust rule catches it; it is simply wrong, and it was undescribed.
//
// This slice changed DOCUMENTATION ONLY. `description` has zero non-test readers and never enters a
// hash preimage, so these tests exist to prove the prose and the behaviour cannot drift apart again —
// not to assert new behaviour. Each one pins a sentence against the thing it claims.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contractField } from "./pilotDataContract";
import { assessCsv } from "../assessment/assess";
import { makePolicy } from "../assessment/policy";

const CUSTOMER_DOC = resolve(__dirname, "..", "..", "docs", "CUSTOMER_PILOT_DATA_CONTRACT_V1.md");
const POLICY = makePolicy({ stallThresholdDays: 30, asOf: "2026-06-30", currency: "USD" });
const HEADER = "entity_id,signed_at,next_invoice_due_at,next_invoice_amount,currency,subscription_id";

describe("D2 · `subscription_id` means ONE CYCLE, and the contract now says so", () => {
  it("the field metadata states cycle/invoice grain and denies the group reading", () => {
    const d = contractField("subscription_id")?.description ?? "";
    expect(d).toMatch(/ONE BILLING CYCLE \/ INVOICE/);
    expect(d).toMatch(/not a subscription group/i);
    expect(d).toMatch(/DISTINCT for genuinely different obligations/i);
    // The consequence must be stated, not merely the definition — the consequence is the dangerous part.
    expect(d).toMatch(/BOTH are excluded/);
  });

  it("the customer-facing document states the ROW GRAIN explicitly", () => {
    const doc = readFileSync(CUSTOMER_DOC, "utf8");
    expect(doc).toMatch(/ONE ROW IS ONE BILLING OBLIGATION/);
    expect(doc).toMatch(/One row = one billing cycle = one invoice = one obligation/);
    // The six-invoice example is the one that stops a reader summarising a customer into one row.
    expect(doc).toMatch(/six invoices[^.]*six rows/);
  });

  it("the customer-facing document warns that a GROUP id loses every invoice, and says what to do", () => {
    const doc = readFileSync(CUSTOMER_DOC, "utf8");
    expect(doc).toMatch(/If two rows share one `subscription_id`, both are excluded/);
    expect(doc).toMatch(/NH-DC-2016/);
    expect(doc).toMatch(/loses \*\*every one of those invoices\*\*/);
    // A warning with no remedy is a complaint. The remedy must be named.
    expect(doc).toMatch(/use your invoice or billing-cycle id, or use `cycle_id`/);
  });

  it("and the documented consequence is the REAL one — two obligations under one id, money zero", async () => {
    // The behaviour the prose now describes, measured rather than trusted. Two genuinely different
    // obligations (different due dates, different amounts) sharing one id.
    const result = await assessCsv(
      [HEADER, "acct-1,2026-01-05,2026-02-05,500.00,USD,SUB-1", "acct-1,2026-01-05,2026-03-05,300.00,USD,SUB-1"].join("\n"),
      POLICY,
      { createdAt: "2026-06-30T00:00:00.000Z" },
    );
    expect(result.acceptedCycleCount).toBe(0);
    expect(result.excludedRowCount).toBe(2);
    expect(result.exclusions.every((e) => e.reason === "duplicate_cycle_id")).toBe(true);
    // $800 of real obligation, assessed as nothing, on BOTH detection surfaces.
    expect(result.observed.observedUnpaid.minor).toBe(0);
    expect(result.nonStalledExposure.overdueUnpaid.minor).toBe(0);
  });

  it("while DISTINCT ids for the same account are accepted — the documented correct shape", async () => {
    // The same two obligations, keyed per cycle as §1.0 instructs. Both are assessed, and the money
    // appears. This is the test that makes the warning actionable rather than ominous.
    const result = await assessCsv(
      [HEADER, "acct-1,2026-01-05,2026-02-05,500.00,USD,SUB-1-FEB", "acct-1,2026-01-05,2026-03-05,300.00,USD,SUB-1-MAR"].join("\n"),
      POLICY,
      { createdAt: "2026-06-30T00:00:00.000Z" },
    );
    expect(result.acceptedCycleCount).toBe(2);
    expect(result.excludedRowCount).toBe(0);
    // Never activated ⇒ stalled ⇒ both land on the activation-stall surface at full value.
    expect(result.observed.observedUnpaid.minor).toBe(80_000);
  });

  it("PRESERVED: nothing about parsing, acceptance or the cycle rule changed in this slice", () => {
    // The metadata is prose. If a future change tried to make `description` load-bearing, this would
    // still pass — so the real guard is the pair of behavioural tests above, and this one records that
    // the field's STRUCTURAL declaration is untouched.
    const f = contractField("subscription_id");
    expect(f?.requirement).toBe("recommended");
    expect(f?.kind).toBe("identifier");
    expect(f?.typicalSourceSystem).toBe("billing");
    expect(f?.since).toBe("1.0.0");
  });
});
