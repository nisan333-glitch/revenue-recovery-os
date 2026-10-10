// Detector #2 · what it counts, what it refuses, and the two properties it must never break.
//
// The money rules are simple enough that the interesting tests are the NEGATIVE ones: every control
// below exists because counting that case would inflate an exposure figure an operator might act on.
import { describe, it, expect } from "vitest";
import type { ExpectationCycle } from "./types";
import { nonStalledExposureSummary, nonStalledPopulation, hasNonStalledExposure } from "./nonStalledExposure";
import { observedSummary } from "./observed";
import { splitCohorts, classifyStall } from "./cohort";
import { classifyPayment } from "./paymentState";
import { makePolicy } from "./policy";
import { money, addMoney, zeroMoney, clampNonNegative, subMoney } from "../domain/money";

const policy = makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" });

/**
 * A cycle that ACTIVATED ON TIME — the population Detector #2 exists for.
 *
 * `observationAt` sits inside the threshold, so `classifyStall` routes it to `reference` and the existing
 * headline never looks at its invoice. That is the whole gap, expressed as a fixture.
 */
function healthy(
  id: string,
  amountMinor: number,
  ev: Partial<ExpectationCycle["monetaryEvent"]> = {},
  over: Partial<ExpectationCycle> = {},
): ExpectationCycle {
  return {
    cycleId: id,
    sourceRowId: `row-${id}`,
    entityId: `E-${id}`,
    expectationAt: "2026-01-01",
    observationAt: "2026-01-03", // activated 2 days later ⇒ well inside N=30 ⇒ NOT stalled
    currency: over.currency ?? "USD",
    statusRaw: over.statusRaw ?? null,
    attributes: {},
    monetaryEvent: {
      dueAt: ev.dueAt ?? "2026-02-01", // due BEFORE asOf ⇒ overdue
      amount: money(amountMinor, over.currency ?? "USD"),
      paidAt: ev.paidAt ?? null,
      paidAmount: ev.paidAmount ?? null,
      refundedAt: ev.refundedAt ?? null,
      cancelledAt: ev.cancelledAt ?? null,
    },
    ...over,
  };
}

/** A cycle that never activated ⇒ stalled ⇒ belongs to the EXISTING surface, not this one. */
const stalled = (
  id: string,
  amountMinor: number,
  ev: Partial<ExpectationCycle["monetaryEvent"]> = {},
): ExpectationCycle => ({
  ...healthy(id, amountMinor, ev),
  observationAt: null,
});

describe("Detector #2 · overdue exposure outside the stalled cohort", () => {
  it("counts the FULL amount for an overdue Unpaid obligation on a healthy account", () => {
    // The gap the audit priced. These cycles are `reference` — invisible to every stalled money total.
    const cycles = [healthy("a", 930_000), healthy("b", 550_000)];
    expect(cycles.every((c) => !classifyStall(c, policy).stalled)).toBe(true);
    expect(observedSummary(splitCohorts(cycles, policy).stalled, policy).observedUnpaid.minor).toBe(0);

    const s = nonStalledExposureSummary(cycles, policy);
    expect(s.overdueUnpaid.minor).toBe(1_480_000);
    expect(s.population).toBe(2);
    expect(s.stateCounts.Unpaid).toBe(2);
    expect(hasNonStalledExposure(s)).toBe(true);
  });

  it("counts ONLY THE REMAINDER for a partially paid obligation — never the full invoice", () => {
    // F4's target. Using the full amount would overstate exposure by everything already collected.
    const s = nonStalledExposureSummary(
      [healthy("p", 100_000, { paidAt: "2026-02-10", paidAmount: money(40_000, "USD") })],
      policy,
    );
    expect(s.overduePartialOutstanding.minor).toBe(60_000);
    expect(s.overdueUnpaid.minor).toBe(0); // a partial is NOT an unpaid
    expect(s.stateCounts.PartiallyPaid).toBe(1);
  });

  it("counts ZERO for an obligation that is NOT YET DUE", () => {
    // F3's target, and the most dangerous false positive available: a future invoice is not a leak.
    const s = nonStalledExposureSummary([healthy("f", 500_000, { dueAt: "2026-06-01" })], policy);
    expect(s.overdueUnpaid.minor).toBe(0);
    expect(s.overduePartialOutstanding.minor).toBe(0);
    expect(s.stateCounts.NotYetDue).toBe(1);
  });

  it("counts ZERO for paid on time, and ZERO OUTSTANDING for paid late in full", () => {
    const s = nonStalledExposureSummary(
      [
        healthy("on", 200_000, { paidAt: "2026-01-20", paidAmount: money(200_000, "USD") }),
        healthy("late", 300_000, { paidAt: "2026-02-20", paidAmount: money(300_000, "USD") }),
      ],
      policy,
    );
    expect(s.overdueUnpaid.minor).toBe(0);
    expect(s.overduePartialOutstanding.minor).toBe(0);
    expect(s.stateCounts.PaidOnTime).toBe(1);
    expect(s.stateCounts.PaidLate).toBe(1);
    // Paid late is still a real operational signal — it is simply not OUTSTANDING money.
    expect(hasNonStalledExposure(s)).toBe(false);
  });

  it("counts ZERO company exposure for a DATED refund or cancellation, and shows it", () => {
    // F5's target. Both are surfaced in their own bucket rather than dropped, so the exclusion is
    // visible — but neither is exposure. An UNDATED terminal state never reaches a cycle: the adapter
    // rejects it `undated_terminal_state`.
    const s = nonStalledExposureSummary(
      [
        healthy("r", 400_000, { refundedAt: "2026-02-15" }),
        healthy("c", 700_000, { cancelledAt: "2026-02-20" }),
      ],
      policy,
    );
    expect(s.overdueUnpaid.minor).toBe(0);
    expect(s.excludedValue.minor).toBe(1_100_000);
    expect(s.stateCounts.Refunded).toBe(1);
    expect(s.stateCounts.Cancelled).toBe(1);
  });

  it("does NOT count an obligation settled by an amount whose timing cannot be placed", () => {
    // The zero-guess rule: a paid amount with no observable payment date is Unknown, not Unpaid.
    // Counting it would claim exposure on money that may well have arrived.
    const s = nonStalledExposureSummary(
      [healthy("k", 250_000, { paidAmount: money(100_000, "USD"), paidAt: null })],
      policy,
    );
    expect(s.overdueUnpaid.minor).toBe(0);
    expect(s.unknownValue.minor).toBe(250_000);
    expect(s.stateCounts.Unknown).toBe(1);
  });

  it("treats a payment recorded AFTER the cut-off as not yet observed, and splits the two cases", () => {
    // Point-in-time: no future information, the same rule the headline applies. But the two sub-cases
    // differ, and the distinction is MORE conservative than it first looks — worth pinning because it is
    // a safety property rather than an accident.
    //
    // (a) a post-cut-off payment whose AMOUNT is known ⇒ `Unknown`, NOT exposure. Something was settled;
    //     only its timing is unplaceable, so claiming the full amount as overdue would assert exposure on
    //     money that demonstrably arrived.
    const known = nonStalledExposureSummary(
      [healthy("x", 123_400, { paidAt: "2026-04-01", paidAmount: money(123_400, "USD") })],
      policy,
    );
    expect(known.overdueUnpaid.minor).toBe(0);
    expect(known.unknownValue.minor).toBe(123_400);

    // (b) a post-cut-off payment date with NO amount ⇒ nothing is evidenced as settled by the cut-off,
    //     so the obligation is genuinely unpaid AT asOf and the full amount is exposure.
    const dateOnly = nonStalledExposureSummary(
      [healthy("y", 123_400, { paidAt: "2026-04-01", paidAmount: null })],
      policy,
    );
    expect(dateOnly.overdueUnpaid.minor).toBe(123_400);
  });

  it("FAILS CLOSED on a cross-currency cycle rather than dropping or coercing it", () => {
    expect(() =>
      nonStalledExposureSummary([healthy("eur", 100_000, {}, { currency: "EUR" })], policy),
    ).toThrow(/cross-currency/);
  });

  it("an empty population is zero everywhere, not an error", () => {
    const s = nonStalledExposureSummary([], policy);
    expect(s.population).toBe(0);
    expect(s.overdueUnpaid.minor).toBe(0);
    expect(s.currency).toBe("USD");
    expect(hasNonStalledExposure(s)).toBe(false);
  });
});

describe("the two surfaces are DISJOINT and ADDITIVE", () => {
  // A population deliberately mixing both cohorts and several payment states.
  const mixed: readonly ExpectationCycle[] = [
    stalled("s-unpaid", 800_000),
    healthy("h-unpaid", 930_000),
    stalled("s-partial", 500_000, { paidAt: "2026-02-05", paidAmount: money(200_000, "USD") }),
    healthy("h-partial", 100_000, { paidAt: "2026-02-10", paidAmount: money(25_000, "USD") }),
    healthy("h-paid", 200_000, { paidAt: "2026-01-15", paidAmount: money(200_000, "USD") }),
    healthy("h-future", 400_000, { dueAt: "2026-09-01" }),
    healthy("h-unpaid-2", 550_000),
  ];
  const cohorts = splitCohorts(mixed, policy);
  const nonStalled = nonStalledPopulation(mixed, cohorts.stalled);

  it("partitions the accepted population exactly once — no cycle in both, none lost", () => {
    // F2's target. The complement is defined by what is NOT stalled, so it cannot drift.
    const stalledIds = new Set(cohorts.stalled.map((c) => c.cycleId));
    const nonIds = new Set(nonStalled.map((c) => c.cycleId));
    expect([...stalledIds].filter((id) => nonIds.has(id))).toEqual([]);
    expect(stalledIds.size + nonIds.size).toBe(mixed.length);
    expect(new Set([...stalledIds, ...nonIds]).size).toBe(mixed.length);
  });

  it("preserves SOURCE ORDER in the complement, so the population is deterministic", () => {
    expect(nonStalled.map((c) => c.cycleId)).toEqual(
      mixed.filter((c) => !classifyStall(c, policy).stalled).map((c) => c.cycleId),
    );
  });

  it("ADDITIVITY, computed rather than asserted: stalled + non-stalled = the whole population", () => {
    // The claim the brief demands. The reference total is computed INDEPENDENTLY, by classifying every
    // accepted cycle without reference to either surface — so this is a real reconciliation and not the
    // two implementations agreeing with themselves.
    let refUnpaid = zeroMoney("USD");
    let refPartial = zeroMoney("USD");
    for (const c of mixed) {
      const state = classifyPayment(c, policy.asOf);
      if (state === "Unpaid") refUnpaid = addMoney(refUnpaid, c.monetaryEvent.amount);
      if (state === "PartiallyPaid") {
        refPartial = addMoney(
          refPartial,
          clampNonNegative(subMoney(c.monetaryEvent.amount, c.monetaryEvent.paidAmount ?? zeroMoney("USD"))),
        );
      }
    }

    const stalledSide = observedSummary(cohorts.stalled, policy);
    const newSide = nonStalledExposureSummary(nonStalled, policy);

    expect(stalledSide.observedUnpaid.minor + newSide.overdueUnpaid.minor).toBe(refUnpaid.minor);
    expect(stalledSide.partialOutstanding.minor + newSide.overduePartialOutstanding.minor).toBe(
      refPartial.minor,
    );
    // And the figures are the ones expected, so a mutual-cancellation bug cannot hide here.
    expect(stalledSide.observedUnpaid.minor).toBe(800_000);
    expect(newSide.overdueUnpaid.minor).toBe(1_480_000);
    expect(newSide.overduePartialOutstanding.minor).toBe(75_000);
  });

  it("a stalled unpaid cycle appears ONLY in the existing bucket, never in Detector #2", () => {
    expect(nonStalled.some((c) => c.cycleId === "s-unpaid")).toBe(false);
    expect(nonStalledExposureSummary(nonStalled, policy).stateCounts.Unpaid).toBe(2); // h-unpaid, h-unpaid-2
  });

  it("a non-stalled unpaid cycle appears ONLY in Detector #2, never in the headline", () => {
    expect(cohorts.stalled.some((c) => c.cycleId === "h-unpaid")).toBe(false);
    expect(observedSummary(cohorts.stalled, policy).observedUnpaid.minor).toBe(800_000);
  });
});

describe("the semantics Detector #2 relies on, pinned rather than re-derived", () => {
  it("`Unpaid` and `PartiallyPaid` already imply OVERDUE, so no extra date check is needed", () => {
    // `NotYetDue` is returned BEFORE either state can be, so a second comparison in the detector would
    // be dead code dressed as a safeguard. If this ordering ever changes, the detector needs the check.
    const future = healthy("fut", 100_000, { dueAt: "2026-06-01" });
    expect(classifyPayment(future, policy.asOf)).toBe("NotYetDue");
    const futurePartial = healthy("futp", 100_000, {
      dueAt: "2026-06-01", paidAt: "2026-02-01", paidAmount: money(10_000, "USD"),
    });
    expect(classifyPayment(futurePartial, policy.asOf)).toBe("NotYetDue");
    for (const c of [healthy("due", 100_000)]) {
      expect(classifyPayment(c, policy.asOf)).toBe("Unpaid");
    }
  });

  it("KNOWN LIMITATION, pinned so it cannot change silently: an undated `churned` status IS counted", () => {
    // REPORTED, NOT FIXED. The contract declares no status enumeration, no meaning for any value, and no
    // guarantee of presence; a terminal state is a flag/status PLUS an effective date, and an undated one
    // is rejected at the adapter. `status = churned` with no `cancelled_at` is therefore an ordinary live
    // cycle, and Detector #2 counts its overdue invoice.
    //
    // It cannot be fixed inside this detector: the governed projection sets `statusRaw: null` as a privacy
    // decision, so a status-based control here would work in the local preview and be INERT in the worker,
    // where the money is actually measured. Closing it is a contract decision — a declared status
    // vocabulary, or a required dated terminal state — and it is recorded as such.
    const s = nonStalledExposureSummary(
      [healthy("ch", 777_000, {}, { statusRaw: "churned" })],
      policy,
    );
    expect(s.overdueUnpaid.minor).toBe(777_000);
    expect(s.stateCounts.Unpaid).toBe(1);
  });
});
