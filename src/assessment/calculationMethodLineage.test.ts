import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  CALCULATION_METHOD_LINEAGE,
  calculationMethodsCompatible,
  labelOnlyAncestry,
} from "./calculationMethodLineage";
import { ASSESSMENT_CALC_VERSION, makePolicy } from "./policy";
import { splitCohorts } from "./cohort";
import { observedSummary } from "./observed";
import { money } from "../domain/money";
import type { ExpectationCycle } from "./types";

// The declaration in `calculationMethodLineage.ts` is a CLAIM about what each calculation method does.
// This file is what makes the claim checkable, in the same way `MAJOR_ROW_SEMANTICS` is checked rather
// than trusted: the fingerprint is recomputed from the implementation actually present and compared to
// what was declared.
//
// WHY A BEHAVIOUR FINGERPRINT AND NOT A FILE HASH. Two implementations that compute the same answers
// must be the same method however differently they are written — otherwise a comment change would force
// every pilot to re-submit. So the fingerprint is taken over OUTPUTS, across a fixture built to exercise
// each branch of the classification and each term of the summary.
//
// WHAT FAILS, AND WHEN:
//   • implementation changed, version not bumped → fingerprint mismatch. Bump, or revert.
//   • version bumped claiming `labelOnlyOf` → the fingerprints must be IDENTICAL, or the claim is false.
//   • version bumped with no `labelOnlyOf` → they must DIFFER, or the bump changed nothing.

/**
 * A frozen fixture chosen to exercise every branch, not to look realistic.
 *
 * Stalled and not; paid, unpaid and partially paid; refunded and cancelled; one entity owning two
 * cycles; a status the policy excludes. A fingerprint taken over a fixture that misses a branch would
 * not move when that branch changed, which is the one way this check can quietly stop working.
 */
const FIXTURE: readonly ExpectationCycle[] = Object.freeze([
  cycle("c1", "e1", "2026-01-01", "2026-01-10", { dueAt: "2026-02-01", amount: 120_00, paidAt: "2026-02-01", paidAmount: 120_00 }),
  cycle("c2", "e1", "2026-01-01", null, { dueAt: "2026-02-01", amount: 250_00, paidAt: null, paidAmount: null }),
  cycle("c3", "e2", "2026-01-05", null, { dueAt: "2026-02-05", amount: 300_00, paidAt: "2026-02-20", paidAmount: 100_00 }),
  cycle("c4", "e3", "2026-01-10", "2026-03-20", { dueAt: "2026-02-10", amount: 400_00, paidAt: null, paidAmount: null }),
  cycle("c5", "e4", "2026-01-15", null, { dueAt: "2026-02-15", amount: 500_00, paidAt: null, paidAmount: null, refundedAt: "2026-03-01" }),
  cycle("c6", "e5", "2026-01-20", null, { dueAt: "2026-02-20", amount: 600_00, paidAt: null, paidAmount: null, cancelledAt: "2026-03-02" }),
  cycle("c7", "e6", "2026-02-01", null, { dueAt: "2026-03-01", amount: 700_00, paidAt: null, paidAmount: null }, "churned"),
  // BOUNDARY CYCLES, and they are the reason this fixture works at all. A first version of it had none,
  // and falsifier F34 — shifting the stall threshold by ONE DAY inside `splitCohorts` — did not move the
  // fingerprint, because every cycle sat far from the boundary and classified the same either way. The
  // guard was therefore blind to exactly the kind of change it exists to catch. These two observe at
  // precisely N and N+1 days after the expectation, so a threshold off by one flips one of them.
  cycle("c8", "e7", "2026-01-01", "2026-01-31", { dueAt: "2026-02-01", amount: 800_00, paidAt: null, paidAmount: null }),
  cycle("c9", "e8", "2026-01-01", "2026-02-01", { dueAt: "2026-02-01", amount: 900_00, paidAt: null, paidAmount: null }),
]);

function cycle(
  cycleId: string,
  entityId: string,
  expectationAt: string,
  observationAt: string | null,
  ev: { dueAt: string; amount: number; paidAt: string | null; paidAmount: number | null; refundedAt?: string; cancelledAt?: string },
  statusRaw: string | null = "active",
): ExpectationCycle {
  return Object.freeze({
    cycleId,
    sourceRowId: `row-${cycleId}`,
    entityId,
    expectationAt,
    observationAt,
    monetaryEvent: Object.freeze({
      dueAt: ev.dueAt,
      amount: money(ev.amount, "USD"),
      paidAt: ev.paidAt,
      paidAmount: ev.paidAmount === null ? null : money(ev.paidAmount, "USD"),
      refundedAt: ev.refundedAt ?? null,
      cancelledAt: ev.cancelledAt ?? null,
    }),
    currency: "USD",
    statusRaw,
    attributes: Object.freeze({}),
  });
}

/**
 * The observable behaviour of the current calculation, as one digest.
 *
 * Three policies, not one: the stall threshold and the cut-off are what the classification turns on, so
 * a fingerprint taken under a single policy would not move if the threshold stopped being honoured.
 */
export function computeBehaviourFingerprint(): string {
  const observations: unknown[] = [];
  for (const [stallThresholdDays, asOf] of [[30, "2026-04-15"], [7, "2026-04-15"], [30, "2026-02-15"]] as const) {
    const policy = makePolicy({ stallThresholdDays, asOf, currency: "USD", excludedStatuses: ["churned"] });
    const cohorts = splitCohorts(FIXTURE, policy);
    const summary = observedSummary(cohorts.stalled, policy);
    observations.push({
      stallThresholdDays,
      asOf,
      stalled: cohorts.stalled.map((c) => c.cycleId),
      undetermined: cohorts.undetermined.map((c) => c.cycleId),
      reference: cohorts.reference.map((c) => c.cycleId),
      summary: JSON.parse(JSON.stringify(summary)),
    });
  }
  return `nhcm_${createHash("sha256").update(JSON.stringify(observations)).digest("hex").slice(0, 16)}`;
}

describe("the calculation-method lineage is a checked declaration, not a convention", () => {
  it("declares the version this build implements", () => {
    // The registry must know the current constant, or `calculationMethodsCompatible` fails closed on
    // everything — which is the right direction, and would also mean no definition could be measured.
    expect(ASSESSMENT_CALC_VERSION in CALCULATION_METHOD_LINEAGE).toBe(true);
  });

  it("the declared behaviour of the current method MATCHES the implementation actually present", () => {
    // THE LOAD-BEARING ASSERTION. Change `splitCohorts`, `observedSummary` or `classifyStall` in a way
    // that moves any answer, and this fails until `ASSESSMENT_CALC_VERSION` is bumped and a new entry
    // added. That is the only mechanism in the codebase that ties the version to the behaviour.
    expect(CALCULATION_METHOD_LINEAGE[ASSESSMENT_CALC_VERSION]!.behaviour).toBe(computeBehaviourFingerprint());
  });

  it("every label-only claim is TRUE — identical fingerprints — and every other bump DIFFERS", () => {
    // A `labelOnlyOf` entry asserts the arithmetic is unchanged. That assertion is what lets a rename
    // avoid forcing every governed definition to be re-proposed, so a false one would silently carry an
    // old blessing onto a method that computes something else.
    for (const [version, entry] of Object.entries(CALCULATION_METHOD_LINEAGE)) {
      if (entry.labelOnlyOf === null) continue;
      const predecessor = CALCULATION_METHOD_LINEAGE[entry.labelOnlyOf];
      expect(predecessor, `${version} claims to rename an unknown version`).toBeDefined();
      expect(entry.behaviour, `${version} claims to be a rename of ${entry.labelOnlyOf}`).toBe(predecessor!.behaviour);
    }
    // ...and two methods that are NOT related by a rename chain must not share a fingerprint, or one of
    // them is an undeclared rename.
    const entries = Object.entries(CALCULATION_METHOD_LINEAGE);
    for (const [a, ea] of entries) {
      for (const [b, eb] of entries) {
        if (a >= b) continue;
        if (ea.behaviour !== eb.behaviour) continue;
        expect(
          calculationMethodsCompatible(a, b),
          `${a} and ${b} compute the same answers but neither declares the other a rename`,
        ).toBe(true);
      }
    }
  });

  it("compatibility is reflexive for a known version and FAILS CLOSED for an unknown one", () => {
    expect(calculationMethodsCompatible(ASSESSMENT_CALC_VERSION, ASSESSMENT_CALC_VERSION)).toBe(true);
    // Not even string equality rescues an unknown version: a build that cannot say what a method DOES
    // cannot claim its answers are unchanged.
    expect(calculationMethodsCompatible("assess-9999.9-unknown", "assess-9999.9-unknown")).toBe(false);
    expect(calculationMethodsCompatible("assess-9999.9-unknown", ASSESSMENT_CALC_VERSION)).toBe(false);
    expect(calculationMethodsCompatible(ASSESSMENT_CALC_VERSION, "assess-9999.9-unknown")).toBe(false);
  });

  it("a rename chain is compatible in BOTH directions, and a declaration cycle terminates", async () => {
    // Exercised against a registry built for the purpose, because the real one has a single entry and
    // will until there is a second method — which would otherwise leave the chain logic, the part that
    // decides whether an old blessing still holds, unreached by any test until the day it first
    // mattered. Production never passes a registry.
    const renamed = Object.freeze({
      "m-1": Object.freeze({ behaviour: "nhcm_same", labelOnlyOf: null }),
      "m-2": Object.freeze({ behaviour: "nhcm_same", labelOnlyOf: "m-1" }),
      "m-3": Object.freeze({ behaviour: "nhcm_same", labelOnlyOf: "m-2" }),
      "m-other": Object.freeze({ behaviour: "nhcm_different", labelOnlyOf: null }),
    });
    expect(labelOnlyAncestry("m-3", renamed)).toEqual(["m-2", "m-1"]);
    // Forward: blessed under the oldest name, measured by a build calling it the newest.
    expect(calculationMethodsCompatible("m-1", "m-3", renamed)).toBe(true);
    // Backward: blessed under the newest, measured by a rolled-back build.
    expect(calculationMethodsCompatible("m-3", "m-1", renamed)).toBe(true);
    // A method that is NOT in the chain is never compatible, however adjacent it looks.
    expect(calculationMethodsCompatible("m-1", "m-other", renamed)).toBe(false);
    expect(calculationMethodsCompatible("m-other", "m-3", renamed)).toBe(false);

    // A cycle in the declarations terminates rather than hanging. Nobody should write this, which is
    // exactly why the loop is bounded instead of trusting that nobody does.
    const cyclic = Object.freeze({
      "x": Object.freeze({ behaviour: "nhcm_same", labelOnlyOf: "y" }),
      "y": Object.freeze({ behaviour: "nhcm_same", labelOnlyOf: "x" }),
    });
    expect(labelOnlyAncestry("x", cyclic).length).toBeLessThanOrEqual(3);
    expect(calculationMethodsCompatible("x", "y", cyclic)).toBe(true);
  });

  it("the fingerprint MOVES for a change of ONE DAY in the classification", () => {
    // GUARDS THE GUARD, and it had to be strengthened. The first version of this test compared against a
    // 999-day threshold, which any fixture would notice; falsifier F34 shifted the real threshold by one
    // day and the fingerprint did not move, because no cycle sat near the boundary. A fingerprint that
    // only notices absurd changes is not a fingerprint.
    //
    // So the sensitivity is asserted at the smallest increment the policy can express. If this ever
    // passes while F34 does not bite, the fixture has lost its boundary cycles.
    const digest = (shift: number) => {
      const observations = [];
      for (const [stallThresholdDays, asOf] of [[30, "2026-04-15"], [7, "2026-04-15"], [30, "2026-02-15"]] as const) {
        const policy = makePolicy({
          stallThresholdDays: stallThresholdDays + shift,
          asOf,
          currency: "USD",
          excludedStatuses: ["churned"],
        });
        const cohorts = splitCohorts(FIXTURE, policy);
        observations.push({
          stalled: cohorts.stalled.map((c) => c.cycleId),
          undetermined: cohorts.undetermined.map((c) => c.cycleId),
          reference: cohorts.reference.map((c) => c.cycleId),
          summary: JSON.parse(JSON.stringify(observedSummary(cohorts.stalled, policy))),
        });
      }
      return createHash("sha256").update(JSON.stringify(observations)).digest("hex");
    };
    expect(digest(1)).not.toBe(digest(0));
    expect(digest(-1)).not.toBe(digest(0));

    // And the fixture reaches every cohort, so no branch of the classification is unobserved.
    const wide = makePolicy({ stallThresholdDays: 30, asOf: "2026-04-15", currency: "USD", excludedStatuses: ["churned"] });
    const split = splitCohorts(FIXTURE, wide);
    expect(split.stalled.length).toBeGreaterThan(0);
    expect(split.reference.length).toBeGreaterThan(0);
    // The money terms move too, not just the cohort membership: a fingerprint over counts alone would
    // miss a change in how an amount is summed.
    const summary = observedSummary(split.stalled, wide);
    expect(JSON.stringify(summary)).toContain("minor");
  });
});
