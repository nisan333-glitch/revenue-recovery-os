// EP-31 · The per-entity attribution must be the SAME arithmetic the assessment reports, resolved per
// account. Every expected figure below is hand-computed from the fixture, never read back from the code.
import { describe, expect, it } from "vitest";
import type { ExpectationCycle } from "./types";
import { attributeByEntity, attributionReconciles, ENTITY_ATTRIBUTION_VERSION } from "./entityAttribution";
import { observedSummary } from "./observed";
import { splitCohorts } from "./cohort";
import { makePolicy } from "./policy";
import { money } from "../domain/money";

const policy = makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" });

/** A cycle with no observation and a deadline already passed at asOf ⇒ stalled. */
function cycle(
  id: string,
  entityId: string,
  amountMinor: number,
  ev: Partial<ExpectationCycle["monetaryEvent"]> = {},
  over: Partial<ExpectationCycle> = {},
): ExpectationCycle {
  return {
    cycleId: id,
    sourceRowId: `row-${id}`,
    entityId,
    expectationAt: "2026-01-01",
    observationAt: null, // no observation ⇒ stalled once the deadline passes
    currency: over.currency ?? "USD",
    statusRaw: null,
    attributes: {},
    ...over,
    monetaryEvent: {
      dueAt: ev.dueAt ?? "2026-02-01",
      amount: money(amountMinor, over.currency ?? "USD"),
      paidAt: ev.paidAt ?? null,
      paidAmount: ev.paidAmount ?? null,
      refundedAt: ev.refundedAt ?? null,
      cancelledAt: ev.cancelledAt ?? null,
    },
  };
}

describe("EP-31 · per-entity attribution", () => {
  it("1 · attributes a fully unpaid stalled obligation to its account, in full", () => {
    const result = attributeByEntity([cycle("c1", "acct-a", 50_000)], policy);
    expect(result.rule).toBe(ENTITY_ATTRIBUTION_VERSION);
    expect(result.attributions).toEqual([
      { entityId: "acct-a", amountAtRisk: money(50_000, "USD"), contributingCycleCount: 1 },
    ]);
    expect(result.totalAtRisk).toEqual(money(50_000, "USD"));
  });

  it("2 · attributes only the REMAINDER of a partially paid obligation", () => {
    // 50,000 obligated, 30,000 settled and observed by asOf ⇒ 20,000 at risk, not 50,000.
    const result = attributeByEntity(
      [cycle("c1", "acct-a", 50_000, { paidAt: "2026-02-10", paidAmount: money(30_000, "USD") })],
      policy,
    );
    expect(result.totalAtRisk).toEqual(money(20_000, "USD"));
  });

  it("3 · SUMS several cycles of one account into ONE attribution", () => {
    // This is the invariant the candidate dedupe key depends on: the account is the unit, not the cycle.
    const result = attributeByEntity(
      [
        cycle("c1", "acct-a", 40_000),
        cycle("c2", "acct-a", 25_000),
        cycle("c3", "acct-b", 10_000),
      ],
      policy,
    );
    expect(result.attributions).toEqual([
      { entityId: "acct-a", amountAtRisk: money(65_000, "USD"), contributingCycleCount: 2 },
      { entityId: "acct-b", amountAtRisk: money(10_000, "USD"), contributingCycleCount: 1 },
    ]);
    expect(result.totalAtRisk).toEqual(money(75_000, "USD"));
  });

  it("4 · excludes cancelled and refunded value — excluded is never re-presented as at risk", () => {
    const result = attributeByEntity(
      [
        cycle("c1", "acct-a", 40_000, { cancelledAt: "2026-02-15" }),
        cycle("c2", "acct-b", 30_000, { refundedAt: "2026-02-20" }),
      ],
      policy,
    );
    expect(result.attributions).toEqual([]);
    expect(result.totalAtRisk).toEqual(money(0, "USD"));
  });

  it("5 · excludes unresolvable payment evidence — an at-risk claim needs evidence it can place", () => {
    // Settled amount present but no observable payment date ⇒ Unknown, not Unpaid. Claiming the full
    // obligation here would assert something the data cannot support.
    const result = attributeByEntity(
      [cycle("c1", "acct-a", 40_000, { paidAmount: money(10_000, "USD"), paidAt: null })],
      policy,
    );
    expect(result.attributions).toEqual([]);
  });

  it("6 · excludes settled and not-yet-due obligations", () => {
    const result = attributeByEntity(
      [
        cycle("c1", "acct-a", 40_000, { paidAt: "2026-01-20", paidAmount: money(40_000, "USD") }), // PaidOnTime
        cycle("c2", "acct-b", 30_000, { paidAt: "2026-02-20", paidAmount: money(30_000, "USD") }), // PaidLate
        cycle("c3", "acct-c", 20_000, { dueAt: "2026-04-01" }), // NotYetDue at asOf
      ],
      policy,
    );
    expect(result.attributions).toEqual([]);
  });

  it("7 · attributes nothing from a cycle that is not stalled", () => {
    // Observed inside the threshold ⇒ reference cohort. Its unpaid obligation is NOT this rule's business;
    // that is the overdue-receivable gap, recorded in the decision memo and deliberately out of scope here.
    const observed = cycle("c1", "acct-a", 40_000, {}, { observationAt: "2026-01-10" });
    expect(splitCohorts([observed], policy).stalled).toEqual([]);
    expect(attributeByEntity([observed], policy).attributions).toEqual([]);
  });

  it("8 · point-in-time: an event recorded AFTER asOf is invisible, so the obligation is still at risk", () => {
    // A cancellation dated after the cut-off does not make the obligation excluded AS OF the cut-off.
    // This is the same property the frozen `spot-cancelled-after-asof` dataset was built to measure.
    const cancelledLater = attributeByEntity(
      [cycle("c1", "acct-a", 40_000, { cancelledAt: "2026-06-01" })],
      policy,
    );
    expect(cancelledLater.totalAtRisk).toEqual(money(40_000, "USD"));

    // Same for a payment DATE after the cut-off with no settled amount declared: nothing is settled by
    // asOf, so the obligation is unpaid at asOf.
    const paidLater = attributeByEntity(
      [cycle("c2", "acct-b", 25_000, { paidAt: "2026-06-01" })],
      policy,
    );
    expect(paidLater.totalAtRisk).toEqual(money(25_000, "USD"));

    // But a settled AMOUNT whose timing cannot be placed as of the cut-off is `Unknown`, NOT at risk —
    // `classifyPayment`'s deliberate zero-guess, which refuses the beneficiary-favourable reading. An
    // earlier draft of this test asserted the opposite; the code is right and the premise was wrong.
    const unplaceable = attributeByEntity(
      [cycle("c3", "acct-c", 25_000, { paidAt: "2026-06-01", paidAmount: money(25_000, "USD") })],
      policy,
    );
    expect(unplaceable.totalAtRisk).toEqual(money(0, "USD"));
  });

  it("9 · omits an account whose contributions sum to zero rather than reporting a zero", () => {
    // Fully settled on a partial-payment shape: amount − paid == 0. A zero-value candidate would be noise
    // with a governed object wrapped around it.
    const result = attributeByEntity(
      [cycle("c1", "acct-a", 40_000, { paidAt: "2026-02-10", paidAmount: money(40_000, "USD") })],
      policy,
    );
    expect(result.attributions).toEqual([]);
  });

  it("10 · is order-independent: the same cycles in any order give a byte-identical result", () => {
    const cycles = [
      cycle("c1", "acct-b", 10_000),
      cycle("c2", "acct-a", 40_000),
      cycle("c3", "acct-c", 7),
    ];
    const forward = attributeByEntity(cycles, policy);
    const reversed = attributeByEntity([...cycles].reverse(), policy);
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });

  it("11 · refuses a cross-currency cycle rather than silently dropping it", () => {
    // Dropping it would make this total disagree with observedSummary, which throws on the same input.
    expect(() =>
      attributeByEntity([cycle("c1", "acct-a", 40_000, {}, { currency: "EUR" })], policy),
    ).toThrow(/cross-currency/);
  });

  // ── THE RECONCILIATION — the reason this module reuses rather than reimplements ──────────────────
  it("12 · RECONCILES to the cent with observedSummary over a mixed population", () => {
    const cycles = [
      cycle("u1", "acct-a", 420_001), // Unpaid, full
      cycle("u2", "acct-a", 310_002), // Unpaid, full, same account
      cycle("u3", "acct-b", 90_004), // Unpaid, full
      cycle("p1", "acct-c", 300_001, { paidAt: "2026-02-05", paidAmount: money(100_000, "USD") }), // remainder
      cycle("x1", "acct-d", 250_001, { cancelledAt: "2026-02-01" }), // excludedValue
      cycle("x2", "acct-e", 170_004, { refundedAt: "2026-02-02" }), // excludedValue
      cycle("k1", "acct-f", 440_001, { paidAmount: money(1, "USD"), paidAt: null }), // unknownValue
      cycle("r1", "acct-g", 88_000, {}, { observationAt: "2026-01-05" }), // reference, not stalled
    ];
    const { stalled } = splitCohorts(cycles, policy);
    const summary = observedSummary(stalled, policy);
    const attribution = attributeByEntity(cycles, policy);

    // Hand-computed: 420001 + 310002 + 90004 = 820007 unpaid; 300001 − 100000 = 200001 remainder.
    expect(summary.observedUnpaid).toEqual(money(820_007, "USD"));
    expect(summary.partialOutstanding).toEqual(money(200_001, "USD"));
    expect(attribution.totalAtRisk).toEqual(money(1_020_008, "USD"));

    expect(attributionReconciles(attribution, summary.observedUnpaid, summary.partialOutstanding)).toBe(true);

    // And the excluded/unknown buckets are non-zero, so the reconciliation above is not vacuous — it is
    // genuinely excluding them rather than there being nothing to exclude.
    expect(summary.excludedValue.minor).toBe(420_005);
    expect(summary.unknownValue.minor).toBe(440_001);

    // Per account, with acct-a's two cycles summed.
    expect(attribution.attributions).toEqual([
      { entityId: "acct-a", amountAtRisk: money(730_003, "USD"), contributingCycleCount: 2 },
      { entityId: "acct-b", amountAtRisk: money(90_004, "USD"), contributingCycleCount: 1 },
      { entityId: "acct-c", amountAtRisk: money(200_001, "USD"), contributingCycleCount: 1 },
    ]);
  });

  it("13 · attributionReconciles FAILS when the totals disagree — it is capable of failing", () => {
    // A guard that cannot fail has not been measured. This asserts the negative directly.
    const attribution = attributeByEntity([cycle("c1", "acct-a", 50_000)], policy);
    expect(attributionReconciles(attribution, money(50_000, "USD"), money(0, "USD"))).toBe(true);
    expect(attributionReconciles(attribution, money(49_999, "USD"), money(0, "USD"))).toBe(false);
    expect(attributionReconciles(attribution, money(50_000, "USD"), money(1, "USD"))).toBe(false);
    // …and on a currency mismatch, rather than comparing minor units across currencies.
    expect(attributionReconciles(attribution, money(50_000, "EUR"), money(0, "EUR"))).toBe(false);
  });

  it("14 · claims nothing: the module cannot reach the proof kernel or the ledger", async () => {
    // Structural, in the style of assessmentExecution.boundaries.test.ts — the two-ledger separation is
    // kept by construction here, not by a reader's discipline.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./entityAttribution.ts", import.meta.url), "utf8");
    for (const forbidden of ["proof", "provenLedger", "outcomes", "invariants", "recoveryCase", "CandidateSignal"]) {
      expect(src.match(new RegExp(`from\\s+"[^"]*${forbidden}[^"]*"`, "i")), `imports ${forbidden}`).toBeNull();
    }
  });
});
