import { describe, it, expect } from "vitest";
import type { ExpectationCycle } from "./types";
import { observedSummary } from "./observed";
import { makePolicy } from "./policy";
import { money } from "../domain/money";

const policy = makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" });

function stalledCycle(
  id: string,
  amountMinor: number,
  ev: Partial<ExpectationCycle["monetaryEvent"]> = {},
  currency = "USD",
): ExpectationCycle {
  return {
    cycleId: id,
    sourceRowId: `row-${id}`,
    entityId: "E",
    expectationAt: "2026-01-01",
    observationAt: null, // stalled
    currency,
    statusRaw: null,
    attributes: {},
    monetaryEvent: {
      dueAt: ev.dueAt ?? "2026-02-01",
      amount: money(amountMinor, currency),
      paidAt: ev.paidAt ?? null,
      paidAmount: ev.paidAmount ?? null,
      refunded: ev.refunded ?? false,
      cancelled: ev.cancelled ?? false,
    },
  };
}

describe("observedSummary — only eligible Unpaid enters the headline; buckets are explicit", () => {
  it("sums ONLY Unpaid into observedUnpaid, exact in minor units", () => {
    const s = observedSummary(
      [
        stalledCycle("u1", 100_00), // Unpaid
        stalledCycle("u2", 250_50), // Unpaid
        stalledCycle("p1", 300_00, { paidAt: "2026-01-20" }), // PaidOnTime
      ],
      policy,
    );
    expect(s.observedUnpaid.minor).toBe(100_00 + 250_50);
    expect(s.stateCounts.Unpaid).toBe(2);
    expect(s.stateCounts.PaidOnTime).toBe(1);
    // Gross eligible = the due-by-asOf, non-cancelled/refunded universe (both unpaid + paid).
    expect(s.grossEligible.minor).toBe(100_00 + 250_50 + 300_00);
  });

  it("routes partial / refunded / cancelled / unknown into their own buckets, never the headline", () => {
    const s = observedSummary(
      [
        stalledCycle("u1", 100_00), // Unpaid → headline
        stalledCycle("pp", 100_00, { paidAt: "2026-02-05", paidAmount: money(40_00, "USD") }), // Partial
        stalledCycle("rf", 80_00, { paidAt: "2026-02-05", refunded: true }), // Refunded
        stalledCycle("cx", 70_00, { cancelled: true }), // Cancelled
        stalledCycle("uk", 0), // Unknown (non-positive)
      ],
      policy,
    );
    expect(s.observedUnpaid.minor).toBe(100_00); // only the Unpaid
    expect(s.partialOutstanding.minor).toBe(60_00); // 100 - 40
    expect(s.excludedValue.minor).toBe(80_00 + 70_00); // refund + cancel
    expect(s.stateCounts.PartiallyPaid).toBe(1);
    expect(s.stateCounts.Refunded).toBe(1);
    expect(s.stateCounts.Cancelled).toBe(1);
    expect(s.stateCounts.Unknown).toBe(1);
  });

  it("throws on a cross-currency cycle (never aggregates across currencies)", () => {
    expect(() => observedSummary([stalledCycle("eur", 100_00, {}, "EUR")], policy)).toThrow(/cross-currency/);
  });

  it("an empty cohort yields zeroed, truthful output", () => {
    const s = observedSummary([], policy);
    expect(s.stalledCount).toBe(0);
    expect(s.observedUnpaid.minor).toBe(0);
    expect(s.grossEligible.minor).toBe(0);
  });
});
