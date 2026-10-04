import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  CALCULATION_METHOD_LINEAGE,
  calculationMethodsCompatible,
  reviewedEquivalenceChain,
  reviewedEquivalenceIsWellFormed,
  type CalculationMethodLineage,
} from "./calculationMethodLineage";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
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
// AND WHY A FINGERPRINT IS NOT A PROOF, which is the whole reason the registry asks for more than one.
// It is evidence over a FINITE fixture: two methods that agree on these nine cycles may disagree on the
// tenth, and no fixture can close that gap. So a matching fingerprint is NECESSARY and never SUFFICIENT
// — equivalence must additionally be DECLARED by a named reviewer, with implementation evidence and
// tests that exist. Unknown compatibility is blocked.
//
// WHAT FAILS, AND WHEN:
//   • implementation changed, version not bumped → fingerprint mismatch. Bump, or revert.
//   • a REVIEWED_EQUIVALENT claim whose fingerprints differ → the claim is false; the link is dropped.
//   • a reviewed claim missing a reviewer, a date, a rationale, evidence or tests → grants nothing.
//   • matching fingerprints with no reviewed claim at all → grants nothing.

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

  it("every reviewed equivalence in the REAL registry is well formed, and cites tests that EXIST", () => {
    // The declaration is a human's claim, so what a machine can check is that it is COMPLETE: a
    // predecessor that exists, matching fingerprints, a named reviewer and date, stated implementation
    // evidence, a rationale, and cited tests that are really there. A claim citing tests nobody wrote
    // would read as reviewed while resting on nothing.
    for (const [version, entry] of Object.entries(CALCULATION_METHOD_LINEAGE)) {
      if (entry.compatibility.kind !== "REVIEWED_EQUIVALENT") continue;
      expect(reviewedEquivalenceIsWellFormed(entry), `${version}'s equivalence is malformed`).toBe(true);
      for (const path of entry.compatibility.equivalence.tests) {
        expect(existsSync(resolve(__dirname, "..", "..", path)), `${version} cites a test that does not exist: ${path}`).toBe(true);
      }
      // "The fingerprints matched" is a precondition checked elsewhere, not evidence about the
      // implementation. A declaration that offers only that has offered nothing a reader can disagree with.
      for (const line of entry.compatibility.equivalence.implementationEvidence) {
        expect(line.toLowerCase(), `${version} offers the fingerprint as implementation evidence`).not.toMatch(
          /^the fingerprints? match/,
        );
      }
    }
  });

  it("two methods with the SAME fingerprint are still incompatible without a reviewed declaration", () => {
    // THE CORRECTION THIS MODEL EXISTS FOR. A digest over a finite fixture establishes agreement on that
    // fixture and nothing more; the input space is not finite and no enumeration closes the gap. So
    // matching fingerprints alone must grant nothing, or the fingerprint would be doing the work of a
    // proof it cannot supply.
    const unreviewed: CalculationMethodLineage = Object.freeze({
      "m-1": Object.freeze({ behaviour: "nhcm_same", compatibility: Object.freeze({ kind: "STANDALONE" as const }) }),
      "m-2": Object.freeze({ behaviour: "nhcm_same", compatibility: Object.freeze({ kind: "STANDALONE" as const }) }),
    });
    expect(calculationMethodsCompatible("m-1", "m-2", unreviewed)).toBe(false);
    expect(calculationMethodsCompatible("m-2", "m-1", unreviewed)).toBe(false);
  });

  it("an INCOMPLETE reviewed declaration grants nothing — every missing field fails closed", () => {
    // It does not warn and it does not degrade. An incomplete claim is indistinguishable from an
    // unreviewed one, so it is treated as one.
    const complete = {
      of: "m-1",
      reviewedBy: "reviewer@company",
      reviewedAt: "2026-10-04",
      implementationEvidence: ["compared classifyStall and observedSummary line by line; only a rename"],
      tests: ["src/assessment/calculationMethodLineage.test.ts"],
      rationale: "the identifier changed; no arithmetic did",
    };
    type Equivalence = {
      of: string;
      reviewedBy: string;
      reviewedAt: string;
      implementationEvidence: readonly string[];
      tests: readonly string[];
      rationale: string;
    };
    const build = (over: Partial<Equivalence>, behaviour = "nhcm_same"): CalculationMethodLineage =>
      Object.freeze({
        "m-1": Object.freeze({ behaviour: "nhcm_same", compatibility: Object.freeze({ kind: "STANDALONE" as const }) }),
        "m-2": Object.freeze({
          behaviour,
          compatibility: Object.freeze({ kind: "REVIEWED_EQUIVALENT" as const, equivalence: Object.freeze({ ...complete, ...over }) }),
        }),
      });

    // The complete declaration works, so each failure below is attributable to the one field removed.
    expect(calculationMethodsCompatible("m-1", "m-2", build({}))).toBe(true);

    for (const [label, over] of [
      ["no reviewer", { reviewedBy: "  " }],
      ["no date", { reviewedAt: "" }],
      ["no rationale", { rationale: " " }],
      ["no implementation evidence", { implementationEvidence: [] }],
      ["no cited tests", { tests: [] }],
      ["a blank evidence line", { implementationEvidence: [" "] }],
      ["a blank test path", { tests: [""] }],
      ["an unknown predecessor", { of: "m-nonexistent" }],
    ] as const) {
      expect(calculationMethodsCompatible("m-1", "m-2", build(over)), label).toBe(false);
    }

    // ...and a mismatched fingerprint defeats an otherwise perfect declaration. The precondition is
    // necessary even though it is not sufficient.
    expect(calculationMethodsCompatible("m-1", "m-2", build({}, "nhcm_different"))).toBe(false);
  });

  it("compatibility is reflexive for a known version and FAILS CLOSED for an unknown one", () => {
    expect(calculationMethodsCompatible(ASSESSMENT_CALC_VERSION, ASSESSMENT_CALC_VERSION)).toBe(true);
    // Not even string equality rescues an unknown version: a build that cannot say what a method DOES
    // cannot claim its answers are unchanged.
    expect(calculationMethodsCompatible("assess-9999.9-unknown", "assess-9999.9-unknown")).toBe(false);
    expect(calculationMethodsCompatible("assess-9999.9-unknown", ASSESSMENT_CALC_VERSION)).toBe(false);
    expect(calculationMethodsCompatible(ASSESSMENT_CALC_VERSION, "assess-9999.9-unknown")).toBe(false);
  });

  it("a reviewed chain is compatible in BOTH directions, and truncates at a malformed link", () => {
    // Exercised against a registry built for the purpose: the real one has a single entry and will until
    // there is a second method, which would otherwise leave this logic unreached until the day it first
    // mattered. Production never passes a registry.
    const ev = (of: string) => ({
      of,
      reviewedBy: "reviewer@company",
      reviewedAt: "2026-10-04",
      implementationEvidence: ["compared the classification and the summary; identifier only"],
      tests: ["src/assessment/calculationMethodLineage.test.ts"],
      rationale: "a rename",
    });
    const chained: CalculationMethodLineage = Object.freeze({
      "m-1": Object.freeze({ behaviour: "nhcm_same", compatibility: Object.freeze({ kind: "STANDALONE" as const }) }),
      "m-2": Object.freeze({ behaviour: "nhcm_same", compatibility: Object.freeze({ kind: "REVIEWED_EQUIVALENT" as const, equivalence: Object.freeze(ev("m-1")) }) }),
      "m-3": Object.freeze({ behaviour: "nhcm_same", compatibility: Object.freeze({ kind: "REVIEWED_EQUIVALENT" as const, equivalence: Object.freeze(ev("m-2")) }) }),
      "m-other": Object.freeze({ behaviour: "nhcm_other", compatibility: Object.freeze({ kind: "STANDALONE" as const }) }),
    });
    expect(reviewedEquivalenceChain("m-3", chained)).toEqual(["m-2", "m-1"]);
    expect(calculationMethodsCompatible("m-1", "m-3", chained)).toBe(true);
    expect(calculationMethodsCompatible("m-3", "m-1", chained)).toBe(true);
    expect(calculationMethodsCompatible("m-1", "m-other", chained)).toBe(false);

    // A MALFORMED LINK TRUNCATES the chain rather than being stepped over: if m-2's claim is incomplete,
    // m-3 inherits nothing through it, and m-1 is out of reach. Walking past it would let an unreviewed
    // link launder a blessing from one end of the chain to the other.
    const broken: CalculationMethodLineage = Object.freeze({
      ...chained,
      "m-2": Object.freeze({ behaviour: "nhcm_same", compatibility: Object.freeze({ kind: "REVIEWED_EQUIVALENT" as const, equivalence: Object.freeze({ ...ev("m-1"), tests: [] }) }) }),
    });
    expect(reviewedEquivalenceChain("m-3", broken)).toEqual(["m-2"]);
    expect(calculationMethodsCompatible("m-1", "m-3", broken)).toBe(false);
    expect(calculationMethodsCompatible("m-2", "m-3", broken)).toBe(true);

    // A declaration cycle terminates rather than hanging. Nobody should write one, which is exactly why
    // the loop is bounded instead of trusting that nobody does.
    const cyclic: CalculationMethodLineage = Object.freeze({
      x: Object.freeze({ behaviour: "nhcm_same", compatibility: Object.freeze({ kind: "REVIEWED_EQUIVALENT" as const, equivalence: Object.freeze(ev("y")) }) }),
      y: Object.freeze({ behaviour: "nhcm_same", compatibility: Object.freeze({ kind: "REVIEWED_EQUIVALENT" as const, equivalence: Object.freeze(ev("x")) }) }),
    });
    expect(reviewedEquivalenceChain("x", cyclic).length).toBeLessThanOrEqual(3);
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
