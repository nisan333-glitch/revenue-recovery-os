// THE MANDATORY CONTROL, AND THE SCOREBOARD'S OWN FALSIFIERS.
//
// Before any reconciler exists, score one that finds NOTHING. A scoreboard that cannot honestly score a
// do-nothing detector is not a scoreboard — the same discipline as verifying a measuring instrument
// against a known null before trusting it on a real sample.
//
// The second half proves the four hard rules BITE. Each falsifier applies a plausible, convenient
// distortion to the READINGS (never to the ground truth) and asserts the scoreboard refuses to flatter
// it. Every distortion is local to its test, so nothing is mutated and nothing needs reverting.
import { describe, it, expect } from "vitest";
import { RECONCILIATION_SCENARIOS } from "./reconciliationScenarios";
import { doNothingReconciler, score, type ReconcilerReading } from "./reconciliationScoreboard";

const S = RECONCILIATION_SCENARIOS;
const TRUTH_POSITIVE = 302_001;

/** A reading that reports the truth exactly — the hypothetical perfect reconciler. */
const perfect = (): ReconcilerReading[] =>
  S.map((s) => ({
    scenarioId: s.id,
    reportedPositiveMinor: s.truth.blindToMonetary ? 0 : s.truth.positiveExposureMinor,
    reportedNegativeMinor: s.truth.negativeDiscrepancyMinor,
    reportedPairedMinor: 0,
    refusedUnitCount: 0,
    reportedUnknownCount: s.truth.unknownExpectationCount,
    eventFindings: { missing: s.truth.eventTruthCounts.missing, duplicate: s.truth.eventTruthCounts.duplicate, matched: s.truth.eventTruthCounts.matched },
    correlationFindings: s.truth.correlationTruth === "CORRECT" ? 0 : 1,
  }));

describe("MANDATORY CONTROL · a reconciler that finds nothing", () => {
  const board = score(S, doNothingReconciler(S));

  it("reports the expected total failure, with no fabricated success", () => {
    expect(board.detectedPositiveMinor).toBe(0);
    expect(board.truePositiveMinor).toBe(0);
    expect(board.falsePositiveMinor).toBe(0);
    expect(board.knownGroundTruthPositiveMinor).toBe(TRUTH_POSITIVE);
    expect(board.falseNegativeMinor).toBe(TRUTH_POSITIVE); // ALL of it
    expect(board.monetaryRecall).toBe(0);
  });

  it("reports NO PRECISION rather than perfect precision — 0/0 is not 1", () => {
    // The trap: `truePositive / detectedPositive` is 0/0. Returning 1 would say a detector that found
    // nothing was never wrong, which is the single most flattering lie a scoreboard can tell.
    expect(board.monetaryPrecision).toBeNull();
  });

  it("still reports the figures that do not depend on the detector", () => {
    expect(board.unknownExpectationCount).toBe(2);
    expect(board.grossNegativeDiscrepancyMinor).toBe(82_000);
    expect(board.aBlindByConstructionMinor).toBe(10_000);
    expect(board.correlationFailuresInTruth).toBeGreaterThan(0);
  });

  it("marks the gated capabilities rather than scoring them as zero", () => {
    expect(board.eventRecall).toBeNull();
    expect(board.eventPrecision).toBeNull();
    expect(board.correlationFailuresDetected).toBeNull();
    expect(board.capabilityGatedScenarios).toBe(S.length);
  });

  it("and a PERFECT reconciler scores below 100% recall — because the blind class stays in", () => {
    const good = score(S, perfect());
    expect(good.falsePositiveMinor).toBe(0);
    expect(good.monetaryPrecision).toBe(1);
    // RULE 4. The duplicate-masking scenario is a real false negative at any grain, so the best possible
    // monetary recall is strictly less than 1 and the shortfall equals the blind class exactly.
    expect(good.monetaryRecall).not.toBe(1);
    expect(good.falseNegativeMinor).toBe(board.aBlindByConstructionMinor);
    expect(good.monetaryRecall).toBeCloseTo((TRUTH_POSITIVE - 10_000) / TRUTH_POSITIVE, 12);
  });
});

describe("SCOREBOARD FALSIFIERS · each convenient distortion must be refused", () => {
  it("F1 · counting UNKNOWN as zero cannot inflate recall", () => {
    // An unpriced expectation treated as a $0 expectation would make R20 look balanced and R12 look
    // clean. The scoreboard reads the unknown COUNT from the truth, so no reading can erase it.
    const readings = perfect().map((r) => ({ ...r, reportedUnknownCount: 0 }));
    expect(score(S, readings).unknownExpectationCount).toBe(2);
  });

  it("F2 · netting negative against positive cannot shrink the false-negative figure", () => {
    // The distortion: report nothing positive but claim the negatives cancel it. Positive and negative
    // live in separate columns, so the false negative is the FULL positive truth regardless.
    const readings = doNothingReconciler(S).map((r) => ({ ...r, reportedNegativeMinor: 1_000_000 }));
    const board = score(S, readings);
    expect(board.falseNegativeMinor).toBe(TRUTH_POSITIVE);
    expect(board.monetaryRecall).toBe(0);
    expect(board.grossNegativeDiscrepancyMinor).toBe(82_000); // from truth, not from the reading
  });

  it("F3 · removing the blind case from the denominator is impossible from a reading", () => {
    // A detector cannot shrink its own denominator. Even claiming the blind scenario was refused leaves
    // the known positive truth untouched.
    const readings = perfect().map((r) => (r.scenarioId === "R06-duplicate-masks-missing" ? { ...r, refusedUnitCount: 1 } : r));
    const board = score(S, readings);
    expect(board.knownGroundTruthPositiveMinor).toBe(TRUTH_POSITIVE);
    expect(board.aBlindByConstructionMinor).toBe(10_000);
    expect(board.monetaryRecall).not.toBe(1);
  });

  it("F4 · explained money is POSITIVE EXPOSURE but NOT incremental union money", () => {
    // This falsifier's first form was WRONG and the scoreboard was right. I asserted that reporting
    // $100 on the wrong-entitlement scenario should score a false positive; it does not, because the
    // truth genuinely holds $100 of positive exposure there — ent-7a really was unbilled. The property
    // that matters is the OTHER one: that same scenario contributes ZERO union money, because the
    // company was paid in full and the dollar sits against the wrong entitlement.
    //
    // So the two figures must be able to disagree, and a reading must not be able to close the gap.
    const wrong = S.find((s) => s.id === "R07-wrong-entitlement")!;
    expect(wrong.truth.positiveExposureMinor).toBe(10_000);
    expect(wrong.truth.incrementalUnionMinor).toBe(0);

    // Inflate the reading as far as it will go: union is summed from the TRUTH and cannot be moved.
    const readings = perfect().map((r) =>
      r.scenarioId === "R07-wrong-entitlement" ? { ...r, reportedPositiveMinor: 5_000_000 } : r);
    const board = score(S, readings);
    expect(board.incrementalUnionMinor).toBe(272_001);
    // ...and the inflation beyond the truth IS scored as a false positive.
    expect(board.falsePositiveMinor).toBe(5_000_000 - 10_000);
  });

  it("F5 · over-reporting on one scenario is never excused by under-reporting on another", () => {
    // The reason true-positive money is computed PER SCENARIO. A reconciler that moves $100 of exposure
    // from the scenario that has it to one that does not must score one false positive AND one false
    // negative, never a wash.
    const readings = perfect().map((r) => {
      if (r.scenarioId === "R01-missing-billing") return { ...r, reportedPositiveMinor: 0 };
      if (r.scenarioId === "R03-exact-balance") return { ...r, reportedPositiveMinor: 10_000 };
      return r;
    });
    const board = score(S, readings);
    expect(board.falsePositiveMinor).toBe(10_000);
    expect(board.falseNegativeMinor).toBe(10_000 + 10_000); // the moved money plus the blind class
    expect(board.detectedPositiveMinor).toBe(score(S, perfect()).detectedPositiveMinor);
  });

  it("F6 · a reading for a scenario that does not exist cannot add detected money", () => {
    const readings = [...perfect(), {
      scenarioId: "NOT-A-SCENARIO", reportedPositiveMinor: 5_000_000, reportedNegativeMinor: 0,
      reportedPairedMinor: 0, refusedUnitCount: 0, reportedUnknownCount: 0,
      eventFindings: null, correlationFindings: null,
    }];
    // Scoring iterates the SCENARIOS, never the readings, so an unmatched reading is inert.
    expect(score(S, readings).detectedPositiveMinor).toBe(score(S, perfect()).detectedPositiveMinor);
  });

  it("F7 · a missing reading is a false negative, never an absent scenario", () => {
    const readings = perfect().filter((r) => r.scenarioId !== "R01-missing-billing");
    const board = score(S, readings);
    expect(board.falseNegativeMinor).toBe(10_000 + 10_000);
    expect(board.capabilityGatedScenarios).toBeGreaterThan(0);
  });
});
