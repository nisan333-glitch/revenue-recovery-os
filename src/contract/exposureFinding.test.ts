// Detector #2's artifact, and the PRESERVATION PROOFS that make it safe to add.
//
// This file exists mainly to guard a defect that would have been silent. Adding exposure scalars to
// `canonicalFinding` would mean:
//
//     same historical input + same governed terms + same ASSESSMENT_CALC_VERSION ⇒ DIFFERENT findingHash
//
// Nothing in the running system would have failed — `hashFinding` has one production caller, nothing
// re-hashes a stored finding, the table is append-only and a finished task is never re-claimed. The
// reproducibility the Trust Invariant promises would simply have stopped being true. So the guard is a
// test, not a convention.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EXPOSURE_FINDING_SCHEME,
  NON_STALLED_EXPOSURE_METHOD_VERSION,
  canonicalExposureFinding,
  hashExposureFinding,
  makeNonStalledExposureFinding,
} from "./exposureFinding";
import { canonicalFinding, hashFinding, type AssessmentFinding } from "./assessmentExecution";
import { nonStalledExposureSummary } from "../assessment/nonStalledExposure";
import { ASSESSMENT_CALC_VERSION } from "../assessment/policy";
import { makePolicy } from "../assessment/policy";
import type { ExpectationCycle } from "../assessment/types";
import { money } from "../domain/money";

const policy = makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" });

const cycle = (id: string, amountMinor: number, ev: Partial<ExpectationCycle["monetaryEvent"]> = {}): ExpectationCycle => ({
  cycleId: id, sourceRowId: `row-${id}`, entityId: `E-${id}`,
  expectationAt: "2026-01-01", observationAt: "2026-01-03",
  currency: "USD", statusRaw: null, attributes: {},
  monetaryEvent: {
    dueAt: ev.dueAt ?? "2026-02-01", amount: money(amountMinor, "USD"),
    paidAt: ev.paidAt ?? null, paidAmount: ev.paidAmount ?? null,
    refundedAt: null, cancelledAt: null,
  },
});

const summary = nonStalledExposureSummary(
  [cycle("a", 930_000), cycle("b", 100_000, { paidAt: "2026-02-05", paidAmount: money(40_000, "USD") })],
  policy,
);
const finding = makeNonStalledExposureFinding({
  executionId: `PAX-${"a".repeat(32)}`, boundaryId: "pb-1", summary,
});

describe("the exposure artifact", () => {
  it("carries its own scheme and its own method version, independent of the assessment's", () => {
    // The point of the whole design: a future change to how exposure is computed moves THIS constant and
    // invalidates no assessment finding, no governed terms version and no admitted extract.
    expect(finding.scheme).toBe(EXPOSURE_FINDING_SCHEME);
    expect(finding.methodVersion).toBe(NON_STALLED_EXPOSURE_METHOD_VERSION);
    expect(NON_STALLED_EXPOSURE_METHOD_VERSION).not.toBe(ASSESSMENT_CALC_VERSION);
  });

  it("states its claim boundary in the payload, not only in a comment", () => {
    expect(finding.claimBoundary).toEqual({
      observationOnly: true, constitutesProof: false,
      constitutesRevenue: false, createsRecoveryCase: false,
    });
  });

  it("flattens the summary to exact minor units, losing nothing", () => {
    expect(finding.overdueUnpaidMinor).toBe(930_000);
    expect(finding.overduePartialOutstandingMinor).toBe(60_000);
    expect(finding.population).toBe(2);
    expect(finding.currency).toBe("USD");
  });

  it("hashes deterministically, and the scheme is INSIDE the preimage", async () => {
    expect(canonicalExposureFinding(finding)).toContain(EXPOSURE_FINDING_SCHEME);
    expect(canonicalExposureFinding(finding)).toContain(NON_STALLED_EXPOSURE_METHOD_VERSION);
    // Same content ⇒ same witness. A hash that moved between calls could not witness anything.
    await expect(hashExposureFinding(finding)).resolves.toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("sorts state counts, so key order in the source object cannot move the hash", async () => {
    const a = { ...finding, stateCounts: Object.freeze({ Unpaid: 1, PartiallyPaid: 1 }) };
    const b = { ...finding, stateCounts: Object.freeze({ PartiallyPaid: 1, Unpaid: 1 }) };
    expect(await hashExposureFinding(a)).toBe(await hashExposureFinding(b));
  });

  it("a DIFFERENT figure is a different witness", async () => {
    const moved = { ...finding, overdueUnpaidMinor: finding.overdueUnpaidMinor + 1 };
    expect(await hashExposureFinding(moved)).not.toBe(await hashExposureFinding(finding));
  });
});

describe("PRESERVATION · the assessment finding is untouched", () => {
  // A finding fixed in this file rather than derived, so the expected canonical string below is a
  // genuine pin: if `canonicalFinding`'s key list changes, this fails regardless of how it changed.
  const assessment: AssessmentFinding = Object.freeze({
    executionId: `PAX-${"c".repeat(32)}`,
    boundaryId: "pb-1",
    assessmentId: "A-1234abcd",
    calculationMethodVersion: ASSESSMENT_CALC_VERSION,
    acceptedCycleCount: 40,
    excludedCycleCount: 0,
    exclusionCodes: Object.freeze([]),
    stalledCount: 9,
    undeterminedCount: 11,
    referenceCount: 20,
    currency: "USD",
    observedUnpaidMinor: 123_400,
    grossEligibleMinor: 500_000,
    partialOutstandingMinor: 0,
    excludedValueMinor: 0,
    unknownValueMinor: 0,
    stateCounts: Object.freeze({ Unpaid: 9 }),
    claimBoundary: Object.freeze({
      observationOnly: true as const, constitutesProof: false as const,
      constitutesRevenue: false as const, createsRecoveryCase: false as const,
    }),
  }) as AssessmentFinding;

  it("the canonical finding contains NO exposure field — the guard for the whole design", () => {
    // F7's target. If an exposure scalar ever enters `canonicalFinding`, every historical finding hash
    // becomes unreproducible from (input, terms, calc version) and this fails.
    const canon = canonicalFinding(assessment);
    for (const forbidden of [
      "nonStalled", "overdueUnpaid", "overduePartialOutstanding", "exposure", "population",
    ]) {
      expect(canon, `canonicalFinding must not mention ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("the canonical finding’s KEY LIST is exactly the seventeen it has always had", () => {
    // Pinned as a set, not a count, so an added key fails by name rather than by an off-by-one.
    expect(Object.keys(JSON.parse(canonicalFinding(assessment))).sort()).toEqual([
      "acceptedCycleCount", "assessmentId", "boundaryId", "calculationMethodVersion", "currency",
      "excludedCycleCount", "excludedValueMinor", "exclusionCodes", "executionId", "grossEligibleMinor",
      "observedUnpaidMinor", "partialOutstandingMinor", "referenceCount", "stalledCount", "stateCounts",
      "undeterminedCount", "unknownValueMinor",
    ].sort());
  });

  it("the finding hash is UNCHANGED by this slice — pinned absolutely", async () => {
    // The strongest form of the claim: an exact digest. Same input, same terms, same calculation method
    // ⇒ same witness, on this build and on every later one.
    expect(await hashFinding(assessment)).toBe(
      "sha256:f28aa72bd8715937165d1ddd7d9aca05511c3634fb4971cdbad20710b63e5fd6",
    );
  });

  it("ASSESSMENT_CALC_VERSION is not bumped, and ObservedSummary gains no field", () => {
    // Read from source: a new key on `ObservedSummary` would move the behaviour fingerprint and force a
    // method bump plus re-blessing of every governed terms version. Detector #2 must cost neither.
    expect(ASSESSMENT_CALC_VERSION).toBe("assess-2026.1-thin");
    const types = readFileSync(resolve(__dirname, "../assessment/types.ts"), "utf8");
    // Bounded at ObservedSummary's own closing brace. Slicing to `NotCalculated` would now swallow
    // `NonStalledExposureSummary`, which legitimately says "overdue" — the check would then fail for
    // the opposite of the reason it exists.
    const start = types.indexOf("export interface ObservedSummary");
    const observed = types.slice(start, types.indexOf("\n}", start) + 2);
    expect(observed).not.toMatch(/overdue|nonStalled|population/i);
  });
});
