import { describe, it, expect } from "vitest";
import type { ExpectationCycle } from "./types";
import { classifyStall, isStalled, splitCohorts } from "./cohort";
import { makePolicy } from "./policy";
import { money } from "../domain/money";

// A neutral cycle builder — note the semantics are NOT SaaS-specific: `expectationAt` and
// `observationAt` could be any expectation/observation, and the cohort core only reasons about them
// plus the threshold N. No activation/invoice/ARPA vocabulary is required to classify.
function cycle(expectationAt: string, observationAt: string | null): ExpectationCycle {
  return {
    cycleId: "c",
    sourceRowId: "row-1",
    entityId: "E",
    expectationAt,
    observationAt,
    currency: "USD",
    statusRaw: null,
    attributes: {},
    monetaryEvent: { dueAt: "2026-02-15", amount: money(100_00, "USD"), paidAt: null, paidAmount: null, refunded: false, cancelled: false },
  };
}
const policy = (asOf: string, n = 30) => makePolicy({ stallThresholdDays: n, asOf, currency: "USD" });

describe("cohort — deviation classification as-of asOf, with an explicit reason", () => {
  it("a cycle still WITHIN its window at asOf (deadline not reached, no observation) is not stalled", () => {
    // signed 2026-01-01, N=30 ⇒ deadline 2026-01-31; asOf 2026-01-15 is before it.
    const r = classifyStall(cycle("2026-01-01", null), policy("2026-01-15"));
    expect(r).toEqual({ stalled: false, reason: "within_window_not_yet_due" });
  });

  it("past expectation + N with no qualifying observation is stalled", () => {
    const r = classifyStall(cycle("2026-01-01", null), policy("2026-03-01"));
    expect(r).toEqual({ stalled: true, reason: "no_observation_past_deadline" });
  });

  it("an observation AFTER asOf does not change the earlier (stalled) assessment", () => {
    // Activated 2026-03-20, but asOf is 2026-03-01 ⇒ invisible ⇒ still stalled at asOf.
    const r = classifyStall(cycle("2026-01-01", "2026-03-20"), policy("2026-03-01"));
    expect(r).toEqual({ stalled: true, reason: "no_observation_past_deadline" });
  });

  it("an observation on/before the threshold is not stalled", () => {
    expect(classifyStall(cycle("2026-01-01", "2026-01-20"), policy("2026-03-01"))).toEqual({
      stalled: false,
      reason: "observed_within_threshold",
    });
    // Exactly on the threshold (expectation + 30 = 2026-01-31): diff 30, not > 30 ⇒ not stalled.
    expect(classifyStall(cycle("2026-01-01", "2026-01-31"), policy("2026-03-01")).stalled).toBe(false);
  });

  it("changing N changes the classification (through a new policy/result)", () => {
    const late = cycle("2026-01-01", "2026-02-20"); // ~50 days
    expect(classifyStall(late, policy("2026-03-01", 30))).toMatchObject({ stalled: true, reason: "observed_after_threshold" });
    expect(classifyStall(late, policy("2026-03-01", 90))).toMatchObject({ stalled: false, reason: "observed_within_threshold" });
  });

  it("identical inputs and policy produce identical classification", () => {
    const c = cycle("2026-01-01", null);
    const p = policy("2026-03-01");
    expect(classifyStall(c, p)).toEqual(classifyStall(c, p));
  });

  it("returns an explicit reason, not only a boolean", () => {
    const r = classifyStall(cycle("2026-01-01", null), policy("2026-03-01"));
    expect(typeof r.reason).toBe("string");
    expect(r).toHaveProperty("reason");
    expect(isStalled(cycle("2026-01-01", null), policy("2026-03-01"))).toBe(true); // boolean wrapper still available
  });

  it("splitCohorts separates stalled / undetermined / reference (no conflation)", () => {
    const p = policy("2026-03-01", 30);
    const r = splitCohorts(
      [
        cycle("2026-01-01", null), // deadline 2026-01-31 ≤ asOf, no obs → stalled
        cycle("2026-01-01", "2026-01-10"), // observed within 30 → reference (confirmed non-deviant)
        cycle("2026-02-20", null), // deadline 2026-03-22 > asOf, no obs → undetermined (within window)
      ],
      p,
    );
    expect(r.stalled).toHaveLength(1);
    expect(r.reference).toHaveLength(1);
    expect(r.undetermined).toHaveLength(1);
    // A within-window cycle must NOT be counted as confirmed non-deviant.
    expect(r.reference).not.toContainEqual(r.undetermined[0]);
  });

  it("is domain-neutral: classification depends only on expectation/observation/N", () => {
    // Two cycles with identical timing but wildly different (non-SaaS) attributes classify the same.
    const a: ExpectationCycle = { ...cycle("2026-01-01", null), attributes: { kind: "contract_renewal" } };
    const b: ExpectationCycle = { ...cycle("2026-01-01", null), attributes: { kind: "insurance_claim" } };
    const p = policy("2026-03-01");
    expect(classifyStall(a, p)).toEqual(classifyStall(b, p));
  });
});
