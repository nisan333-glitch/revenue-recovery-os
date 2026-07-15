import { describe, it, expect } from "vitest";
import type { ExpectationCycle } from "./types";
import { classifyPayment } from "./paymentState";
import { money } from "../domain/money";

function cycle(over: Partial<ExpectationCycle["monetaryEvent"]> & { dueAt?: string }): ExpectationCycle {
  return {
    cycleId: "c1",
    sourceRowId: "row-1",
    entityId: "E1",
    expectationAt: "2026-01-01",
    observationAt: null,
    currency: "USD",
    statusRaw: null,
    attributes: {},
    monetaryEvent: {
      dueAt: over.dueAt ?? "2026-02-01",
      amount: over.amount ?? money(100_00, "USD"),
      paidAt: over.paidAt ?? null,
      paidAmount: over.paidAmount ?? null,
      refunded: over.refunded ?? false,
      cancelled: over.cancelled ?? false,
    },
  };
}
const ASOF = "2026-03-01";

describe("classifyPayment — explicit states, strictly as-of asOf", () => {
  it("not yet due is never unpaid", () => {
    expect(classifyPayment(cycle({ dueAt: "2026-04-01" }), ASOF)).toBe("NotYetDue");
  });
  it("due and unsettled is Unpaid", () => {
    expect(classifyPayment(cycle({ dueAt: "2026-02-01", paidAt: null }), ASOF)).toBe("Unpaid");
  });
  it("paid in full on/before due is PaidOnTime; after due is PaidLate", () => {
    expect(classifyPayment(cycle({ dueAt: "2026-02-01", paidAt: "2026-01-20" }), ASOF)).toBe("PaidOnTime");
    expect(classifyPayment(cycle({ dueAt: "2026-02-01", paidAt: "2026-02-10" }), ASOF)).toBe("PaidLate");
  });
  it("partial settlement is PartiallyPaid, never fully Unpaid", () => {
    expect(
      classifyPayment(cycle({ dueAt: "2026-02-01", paidAt: "2026-02-05", amount: money(100_00, "USD"), paidAmount: money(40_00, "USD") }), ASOF),
    ).toBe("PartiallyPaid");
  });
  it("a payment recorded AFTER asOf is Unpaid at asOf (no future information)", () => {
    expect(classifyPayment(cycle({ dueAt: "2026-02-01", paidAt: "2026-03-15" }), ASOF)).toBe("Unpaid");
  });
  it("refunded and cancelled are terminal and separate", () => {
    expect(classifyPayment(cycle({ dueAt: "2026-02-01", paidAt: "2026-02-01", refunded: true }), ASOF)).toBe("Refunded");
    expect(classifyPayment(cycle({ dueAt: "2026-02-01", cancelled: true }), ASOF)).toBe("Cancelled");
  });
});
