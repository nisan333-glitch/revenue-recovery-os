import { describe, it, expect } from "vitest";
import { assessCsv, planColumnMapping } from "./assess";
import { makePolicy } from "./policy";

const HEADER =
  "entity_id,subscription_id,signed_at,activation_at,next_invoice_due_at,next_invoice_paid_at,next_invoice_amount,currency,status,is_test";
const CREATED = "2026-03-02T00:00:00.000Z";
const policy = (over: Partial<Parameters<typeof makePolicy>[0]> = {}) =>
  makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD", excludedStatuses: ["internal"], ...over });

function csv(rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("assess — reproducibility & correctness", () => {
  const baseCsv = csv([
    "E1,SUB-A,2026-01-01,,2026-02-01,,10000.00,USD,,",       // stalled (never activated), unpaid
    "E1,SUB-B,2026-01-01,2026-01-10,2026-02-01,2026-01-25,5000.00,USD,,", // activated on time, paid
  ]);

  it("same CSV + same Policy ⇒ identical AssessmentResult (incl. assessmentId)", async () => {
    const r1 = await assessCsv(baseCsv, policy(), { createdAt: CREATED });
    const r2 = await assessCsv(baseCsv, policy(), { createdAt: CREATED });
    expect(r2).toEqual(r1);
    expect(r2.assessmentId).toBe(r1.assessmentId);
    expect(r1.observed.observedUnpaid.minor).toBe(10000_00);
  });

  it("changing N creates a new result and leaves the prior result unchanged", async () => {
    const midActivation = csv(["E1,SUB-A,2026-01-01,2026-02-20,2026-02-25,,10000.00,USD,,"]); // ~50 days late
    const r30 = await assessCsv(midActivation, policy({ stallThresholdDays: 30 }), { createdAt: CREATED });
    const r90 = await assessCsv(midActivation, policy({ stallThresholdDays: 90 }), { createdAt: CREATED });
    expect(r30.stalledCount).toBe(1); // 50 > 30 ⇒ stalled
    expect(r90.stalledCount).toBe(0); // 50 < 90 ⇒ not stalled
    expect(r30.observed.observedUnpaid.minor).toBe(10000_00);
    expect(r90.observed.observedUnpaid.minor).toBe(0);
    expect(r30.assessmentId).not.toBe(r90.assessmentId);
    expect(r30.policy.stallThresholdDays).toBe(30); // prior result untouched
  });

  it("duplicate cycleId ⇒ ALL colliding rows rejected and reported", async () => {
    const dup = csv([
      "E1,SUB-DUP,2026-01-01,,2026-02-01,,10000.00,USD,,",
      "E2,SUB-DUP,2026-01-01,,2026-02-01,,20000.00,USD,,",
    ]);
    const r = await assessCsv(dup, policy(), { createdAt: CREATED });
    expect(r.acceptedCycleCount).toBe(0);
    expect(r.exclusions.filter((e) => e.reason === "duplicate_cycle_id")).toHaveLength(2);
    expect(r.observed.observedUnpaid.minor).toBe(0);
  });

  it("multiple subscriptions per account remain separate cycles", async () => {
    const multi = csv([
      "E1,SUB-A,2026-01-01,,2026-02-01,,10000.00,USD,,",
      "E1,SUB-B,2026-01-01,,2026-02-01,,10000.00,USD,,",
    ]);
    const r = await assessCsv(multi, policy(), { createdAt: CREATED });
    expect(r.acceptedCycleCount).toBe(2);
    expect(r.stalledCount).toBe(2);
    expect(r.observed.observedUnpaid.minor).toBe(20000_00);
  });

  it("other currencies are excluded (currency_mismatch), never aggregated", async () => {
    const mixed = csv([
      "E1,SUB-A,2026-01-01,,2026-02-01,,10000.00,USD,,",
      "E2,SUB-B,2026-01-01,,2026-02-01,,9000.00,EUR,,",
    ]);
    const r = await assessCsv(mixed, policy(), { createdAt: CREATED });
    expect(r.acceptedCycleCount).toBe(1);
    expect(r.exclusions.some((e) => e.reason === "currency_mismatch")).toBe(true);
    expect(r.observed.observedUnpaid.minor).toBe(10000_00); // USD only
  });

  it("zero and negative amounts are excluded with explicit reasons", async () => {
    const bad = csv([
      "E1,SUB-Z,2026-01-01,,2026-02-01,,0.00,USD,,",
      "E2,SUB-N,2026-01-01,,2026-02-01,,-5.00,USD,,",
    ]);
    const r = await assessCsv(bad, policy(), { createdAt: CREATED });
    expect(r.exclusions.some((e) => e.reason === "zero_amount")).toBe(true);
    expect(r.exclusions.some((e) => e.reason === "negative_amount")).toBe(true);
    expect(r.acceptedCycleCount).toBe(0);
  });

  it("Estimated/Forecast are structurally unavailable; Proven is zero", async () => {
    const r = await assessCsv(baseCsv, policy(), { createdAt: CREATED });
    expect(r.estimated).toBe("unavailable_in_validation_slice");
    expect(r.forecast).toBe("unavailable_in_validation_slice");
    expect(r.proven.minor).toBe(0);
  });

  it("throws a clear error when required columns are missing (never a silent zero)", async () => {
    await expect(assessCsv("foo,bar\n1,2", policy(), { createdAt: CREATED })).rejects.toThrow(/missing required column/i);
  });

  it("rejects a duplicate column header (never silently reads one of two same-named columns)", async () => {
    const dupHeader =
      "entity_id,signed_at,next_invoice_due_at,next_invoice_amount,next_invoice_amount,currency\n" +
      "E1,2026-01-01,2026-02-01,10000.00,5000.00,USD";
    await expect(assessCsv(dupHeader, policy(), { createdAt: CREATED })).rejects.toThrow(/duplicate column header/i);
  });

  it("rejects a blank column header", async () => {
    const blank =
      "entity_id,signed_at,next_invoice_due_at,next_invoice_amount,,currency\n" +
      "E1,2026-01-01,2026-02-01,10000.00,x,USD";
    await expect(assessCsv(blank, policy(), { createdAt: CREATED })).rejects.toThrow(/empty column header/i);
  });

  it("planColumnMapping fails loudly on a duplicate header too (pre-flight, before the mapping UI)", () => {
    expect(() => planColumnMapping("id,id\n1,2")).toThrow(/duplicate column header/i);
  });

  it("a settled amount without a payment date is NOT counted as Observed Unpaid (surfaced as Unknown)", async () => {
    // Stalled cycle whose invoice shows paid_amount but no payment date: its full value must not land
    // in the beneficiary-favorable Observed Unpaid headline (Trust Invariant); it is surfaced as Unknown.
    const csv =
      "entity_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency,paid_amount\n" +
      "E1,2026-01-01,,2026-02-01,100.00,USD,40.00";
    const r = await assessCsv(csv, policy(), { createdAt: CREATED });
    expect(r.acceptedCycleCount).toBe(1);
    expect(r.stalledCount).toBe(1);
    expect(r.observed.observedUnpaid.minor).toBe(0);
    expect(r.observed.unknownValue.minor).toBe(100_00);
    expect(r.observed.stateCounts.Unknown).toBe(1);
    expect(r.observed.stateCounts.Unpaid).toBe(0);
  });

  it("a BOM-prefixed CSV still yields accepted cycles (not silently zero)", async () => {
    const r = await assessCsv(String.fromCharCode(0xfeff) + baseCsv, policy(), { createdAt: CREATED });
    expect(r.acceptedCycleCount).toBe(2);
    expect(r.observed.observedUnpaid.minor).toBe(10000_00);
  });

  it("an empty file yields a truthful zero assessment", async () => {
    const r = await assessCsv(HEADER, policy(), { createdAt: CREATED });
    expect(r.acceptedCycleCount).toBe(0);
    expect(r.stalledCount).toBe(0);
    expect(r.observed.observedUnpaid.minor).toBe(0);
    expect(r.excludedRowCount).toBe(0);
  });

  it("every excluded row appears in the exclusions report", async () => {
    const mixed = csv([
      "E1,SUB-A,2026-01-01,,2026-02-01,,10000.00,USD,,",     // accepted
      ",SUB-B,2026-01-01,,2026-02-01,,10000.00,USD,,",        // missing entity_id
      "E3,SUB-C,not-a-date,,2026-02-01,,10000.00,USD,,",      // malformed date
      "E4,SUB-D,2026-01-01,,2026-02-01,,10000.00,USD,internal,", // excluded status
    ]);
    const r = await assessCsv(mixed, policy(), { createdAt: CREATED });
    expect(r.acceptedCycleCount).toBe(1);
    expect(r.excludedRowCount).toBe(3);
    const reasons = r.exclusions.map((e) => e.reason).sort();
    expect(reasons).toEqual(["excluded_status", "malformed_date", "missing_required_field"].sort());
  });
});
