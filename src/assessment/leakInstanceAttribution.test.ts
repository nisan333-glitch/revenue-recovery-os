// EP-31d commit 3 · The finer grain must change WHO the value is attributed to, and nothing else.
// Every expected figure is hand-computed from the fixture, never read back from the code.
import { describe, expect, it } from "vitest";
import type { ExpectationCycle } from "./types";
import {
  attributeByLeakInstance,
  LEAK_INSTANCE_ATTRIBUTION_VERSION,
  type LeakInstanceResolver,
} from "./leakInstanceAttribution";
import { attributeByEntity, attributionReconciles } from "./entityAttribution";
import { observedSummary } from "./observed";
import { splitCohorts } from "./cohort";
import { makePolicy } from "./policy";
import { money } from "../domain/money";

const policy = makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" });

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

/** Stands in for the authoritative identity a later governed binding will supply. */
const byObligation: LeakInstanceResolver = (c) => c.attributes["obligation"] ?? null;
const withObligation = (c: ExpectationCycle, ref: string): ExpectationCycle => ({
  ...c,
  attributes: { ...c.attributes, obligation: ref },
});

describe("EP-31d · leak-instance attribution", () => {
  it("1 · resolves the same value per OBLIGATION rather than per account", () => {
    const cycles = [
      withObligation(cycle("c1", "acct-a", 50_000), "OBL-1"),
      withObligation(cycle("c2", "acct-a", 30_000), "OBL-2"),
    ];
    const result = attributeByLeakInstance(cycles, policy, byObligation);
    expect(result.rule).toBe(LEAK_INSTANCE_ATTRIBUTION_VERSION);
    expect(result.attributions).toEqual([
      { leakInstanceKey: "OBL-1", amountAtRisk: money(50_000, "USD"), contributingCycleCount: 1 },
      { leakInstanceKey: "OBL-2", amountAtRisk: money(30_000, "USD"), contributingCycleCount: 1 },
    ]);
    expect(result.totalAtRisk).toEqual(money(80_000, "USD"));
    expect(result.ambiguousKeys).toEqual([]);
    expect(result.unresolvedContributingCycles).toBe(0);
  });

  it("2 · TWO obligations of ONE account stay separate — the defect this grain exists to fix", () => {
    // The account grain collapses these into a single 80,000 attribution, which is exactly why a
    // genuinely new obligation for an existing account can never become a second candidate.
    const cycles = [
      withObligation(cycle("c1", "acct-a", 50_000), "OBL-1"),
      withObligation(cycle("c2", "acct-a", 30_000), "OBL-2"),
    ];
    const coarse = attributeByEntity(cycles, policy);
    expect(coarse.attributions).toHaveLength(1);
    expect(coarse.attributions[0]!.contributingCycleCount).toBe(2);

    const fine = attributeByLeakInstance(cycles, policy, byObligation);
    expect(fine.attributions).toHaveLength(2);
    expect(fine.attributions.map((a) => a.leakInstanceKey)).toEqual(["OBL-1", "OBL-2"]);
    // …and the money is identical either way. Only the grouping moved.
    expect(fine.totalAtRisk).toEqual(coarse.totalAtRisk);
  });

  it("3 · BOTH GRAINS reconcile to the SAME aggregate finding, to the minor unit", () => {
    // A mixed population: unpaid, partially paid, cancelled, refunded, not-yet-due, paid, multi-account.
    const cycles = [
      withObligation(cycle("c1", "acct-a", 50_000), "OBL-1"),
      withObligation(cycle("c2", "acct-a", 30_000, { paidAt: "2026-02-10", paidAmount: money(12_000, "USD") }), "OBL-2"),
      withObligation(cycle("c3", "acct-b", 70_000), "OBL-3"),
      withObligation(cycle("c4", "acct-b", 25_000, { cancelledAt: "2026-02-05" }), "OBL-4"),
      withObligation(cycle("c5", "acct-c", 15_000, { refundedAt: "2026-02-07" }), "OBL-5"),
      withObligation(cycle("c6", "acct-c", 40_000, { dueAt: "2026-04-01" }), "OBL-6"),
      withObligation(cycle("c7", "acct-c", 11_000, { paidAt: "2026-01-20", paidAmount: money(11_000, "USD") }), "OBL-7"),
    ];
    // Hand-computed: 50,000 unpaid + 70,000 unpaid = 120,000 observedUnpaid; 30,000 − 12,000 = 18,000
    // partial outstanding. Cancelled, refunded, not-yet-due and paid contribute nothing.
    const observed = observedSummary(splitCohorts(cycles, policy).stalled, policy);
    expect(observed.observedUnpaid).toEqual(money(120_000, "USD"));
    expect(observed.partialOutstanding).toEqual(money(18_000, "USD"));

    const coarse = attributeByEntity(cycles, policy);
    const fine = attributeByLeakInstance(cycles, policy, byObligation);
    expect(coarse.totalAtRisk).toEqual(money(138_000, "USD"));
    expect(fine.totalAtRisk).toEqual(coarse.totalAtRisk);
    // ONE reconciliation rule, applied to BOTH grains — no cast, no second definition.
    expect(attributionReconciles(coarse, observed.observedUnpaid, observed.partialOutstanding)).toBe(true);
    expect(attributionReconciles(fine, observed.observedUnpaid, observed.partialOutstanding)).toBe(true);
  });

  it("4 · grouping grain changes ATTRIBUTION ONLY — assessment outputs are byte-identical", () => {
    const cycles = [
      withObligation(cycle("c1", "acct-a", 50_000), "OBL-1"),
      withObligation(cycle("c2", "acct-a", 30_000), "OBL-2"),
    ];
    const before = JSON.stringify(observedSummary(splitCohorts(cycles, policy).stalled, policy));
    attributeByLeakInstance(cycles, policy, byObligation);
    attributeByEntity(cycles, policy);
    const after = JSON.stringify(observedSummary(splitCohorts(cycles, policy).stalled, policy));
    expect(after).toBe(before);
    // And the inputs are not mutated by either grain.
    expect(cycles[0]!.attributes["obligation"]).toBe("OBL-1");
  });

  it("5 · the contribution RULE is imported, not restated — every state agrees across grains", () => {
    const states: readonly [string, ExpectationCycle][] = [
      ["unpaid", cycle("s1", "a", 10_000)],
      ["partial", cycle("s2", "a", 10_000, { paidAt: "2026-02-10", paidAmount: money(4_000, "USD") })],
      ["cancelled", cycle("s3", "a", 10_000, { cancelledAt: "2026-02-05" })],
      ["refunded", cycle("s4", "a", 10_000, { refundedAt: "2026-02-05" })],
      ["not-yet-due", cycle("s5", "a", 10_000, { dueAt: "2026-04-01" })],
      ["paid", cycle("s6", "a", 10_000, { paidAt: "2026-01-15", paidAmount: money(10_000, "USD") })],
      ["unknown", cycle("s7", "a", 10_000, { paidAt: "2026-06-01" })],
    ];
    for (const [name, c] of states) {
      const one = [withObligation(c, `OBL-${name}`)];
      expect(attributeByLeakInstance(one, policy, byObligation).totalAtRisk).toEqual(
        attributeByEntity(one, policy).totalAtRisk,
      );
    }
  });

  it("6 · a contributing cycle with NO identity is COUNTED, not silently dropped", () => {
    // Refusing the whole population is the caller's job; reporting the fact is this module's.
    const cycles = [
      withObligation(cycle("c1", "acct-a", 50_000), "OBL-1"),
      cycle("c2", "acct-a", 30_000), // no obligation reference
    ];
    const result = attributeByLeakInstance(cycles, policy, byObligation);
    expect(result.unresolvedContributingCycles).toBe(1);
    expect(result.attributions).toHaveLength(1);
    // The reported total is therefore NOT the assessment total — which is precisely why a caller must
    // refuse the population rather than stage a subset.
    expect(result.totalAtRisk).toEqual(money(50_000, "USD"));
  });

  it("7 · a cycle that contributes NOTHING may lack an identity without blocking anything", () => {
    // A cancelled obligation contributes no value, so its missing reference cannot change any figure.
    // Counting it would refuse populations over a gap with no effect on the number.
    const cycles = [
      withObligation(cycle("c1", "acct-a", 50_000), "OBL-1"),
      cycle("c2", "acct-a", 25_000, { cancelledAt: "2026-02-05" }),
    ];
    const result = attributeByLeakInstance(cycles, policy, byObligation);
    expect(result.unresolvedContributingCycles).toBe(0);
    expect(result.totalAtRisk).toEqual(money(50_000, "USD"));
  });

  it("8 · one identity claimed by TWO cycles is reported AMBIGUOUS, never merged silently", () => {
    const cycles = [
      withObligation(cycle("c1", "acct-a", 50_000), "OBL-SAME"),
      withObligation(cycle("c2", "acct-a", 30_000), "OBL-SAME"),
    ];
    const result = attributeByLeakInstance(cycles, policy, byObligation);
    expect(result.ambiguousKeys).toEqual(["OBL-SAME"]);
    expect(result.attributions[0]!.contributingCycleCount).toBe(2);
  });

  it("9 · output order is stable, and zero-value obligations are omitted entirely", () => {
    const forward = [
      withObligation(cycle("c1", "acct-a", 50_000), "OBL-B"),
      withObligation(cycle("c2", "acct-a", 30_000), "OBL-A"),
    ];
    const reversed = [...forward].reverse();
    expect(attributeByLeakInstance(forward, policy, byObligation)).toEqual(
      attributeByLeakInstance(reversed, policy, byObligation),
    );
    // Fully settled ⇒ nothing at risk ⇒ no attribution at all, not a zero one.
    const settled = [
      withObligation(cycle("c3", "acct-a", 20_000, { paidAt: "2026-01-20", paidAmount: money(20_000, "USD") }), "OBL-Z"),
    ];
    expect(attributeByLeakInstance(settled, policy, byObligation).attributions).toEqual([]);
  });

  it("10 · a cross-currency cycle throws rather than being dropped, exactly as the account grain does", () => {
    const cycles = [withObligation(cycle("c1", "acct-a", 50_000, {}, { currency: "EUR" }), "OBL-1")];
    expect(() => attributeByLeakInstance(cycles, policy, byObligation)).toThrow(/cross-currency/);
    expect(() => attributeByEntity(cycles, policy)).toThrow(/cross-currency/);
  });
});
