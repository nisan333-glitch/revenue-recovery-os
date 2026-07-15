// Domain-level proofs of the Trust Invariant. Case/UI/seed-level proofs come after wiring.
import { describe, it, expect } from "vitest";
import { money, addMoney, subMoney, formatMoney } from "./money";
import { createApprovedProof, reviseProof, effectiveProofs, type ProofApprovalInput } from "./proof";
import { establishBaseline, lockBaseline, reviseBaseline, baselineTemporallyValid } from "./baseline";
import { makeEvidence, hasIndependentEvidence } from "./evidence";
import { canApproveProof, type Actor } from "./authority";
import { CURRENT_POLICY } from "./policy";

const USD = "USD";

function approvalInput(over: Partial<ProofApprovalInput> = {}): ProofApprovalInput {
  return {
    proofId: "PF-1",
    recoveryCaseId: "RE-1007",
    approvedAt: "2026-06-20T10:00:00.000Z",
    collectedAmount: money(3_100_000, USD),
    baselineAmount: money(620_000, USD),
    excludedRecoveryAmount: money(0, USD),
    exclusionStatement: "Zero excluded — asserted: full delta is independently evidenced.",
    recoveryReason: "MilestoneNudge",
    attribution: "MilestoneNudge play; second invoice paid",
    evidenceRefs: ["EV-1"],
    baselineId: "BL-1",
    baselineMethodId: CURRENT_POLICY.baselineMethodId,
    baselineVersion: 1,
    baselineLockPolicy: CURRENT_POLICY.baselineLockPolicy,
    policyVersion: CURRENT_POLICY.policyVersion,
    confidenceMethodologyVersion: CURRENT_POLICY.confidenceMethodologyVersion,
    proofThresholdUsed: CURRENT_POLICY.proofThreshold,
    confidenceUsed: 95,
    approvedBy: "approver@company",
    ...over,
  };
}

describe("Money — exact integer minor units (req #12, clarification #3)", () => {
  it("rejects fractional minor units and unsafe integers", () => {
    expect(() => money(1.5, USD)).toThrow(/fractional/);
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, USD)).toThrow(/unsafe/);
  });
  it("arithmetic is exact and currency-checked", () => {
    expect(subMoney(money(3_100_000, USD), money(620_000, USD)).minor).toBe(2_480_000);
    expect(() => addMoney(money(1, USD), money(1, "EUR"))).toThrow(/currency mismatch/);
  });
  it("formats display only, without touching domain precision", () => {
    expect(formatMoney(money(2_480_000, USD))).toBe("$24,800");
  });
});

describe("Proof immutability + reproducibility (C1, reqs #1–#3, #5)", () => {
  it("freezes revenueReturned and the versions used; the snapshot is frozen", () => {
    const p = createApprovedProof(approvalInput());
    expect(p.revenueReturned.minor).toBe(2_480_000);
    expect(p.proofThresholdUsed).toBe(80);
    expect(p.confidenceUsed).toBe(95);
    expect(Object.isFrozen(p)).toBe(true);
    // The stored value is read directly — never recomputed from any current policy/threshold.
    expect(p.revenueReturned.minor).toBe(p.collectedAmount.minor - p.baselineAmount.minor);
  });
  it("requires an explicit exclusion statement (reqs #7/#8)", () => {
    expect(() => createApprovedProof(approvalInput({ exclusionStatement: "" }))).toThrow(/exclusion/);
    // zero exclusion is allowed only as an explicit asserted statement
    const p = createApprovedProof(approvalInput({ excludedRecoveryAmount: money(0, USD) }));
    expect(p.exclusionStatement).toMatch(/asserted/i);
  });
});

describe("Reversal is a new linked record, never a mutation (clarification #1, req #9)", () => {
  it("preserves the original and folds the chain without double-counting", () => {
    const original = createApprovedProof(approvalInput());
    const reversal = reviseProof(original, {
      newProofId: "PF-2",
      status: "Reversed",
      at: "2026-07-01T09:00:00.000Z",
      approvedBy: "approver@company",
    });
    expect(original.status).toBe("Approved"); // untouched
    expect(original.revenueReturned.minor).toBe(2_480_000);
    expect(reversal.previousProofId).toBe("PF-1");
    expect(reversal.status).toBe("Reversed");
    expect(reversal.revenueReturned.minor).toBe(0);
    const effective = effectiveProofs([original, reversal]);
    expect(effective).toHaveLength(1); // one record per chain — no double count
    expect(effective[0]!.status).toBe("Reversed");
  });
});

describe("Baseline governance + temporal validity (C2, clarification #2, reqs #4/#5)", () => {
  const base = establishBaseline({
    baselineId: "BL-1",
    method: "matched_historical_cohort",
    methodVersion: 1,
    sourceRefs: ["cohort:2026Q1"],
    calculatedAmount: money(620_000, USD),
    applicableLeakType: "ActivationMissed",
    effectiveAt: "2026-06-01T00:00:00.000Z",
    establishedAt: "2026-06-01T00:00:00.000Z",
    establishedBy: "system",
  });
  it("rejects a baseline locked after the outcome was observed", () => {
    const lockedLate = lockBaseline(base, "2026-06-20T00:00:00.000Z", "late");
    const v = baselineTemporallyValid(lockedLate, {
      interventionAt: "2026-06-10T00:00:00.000Z",
      outcomeObservedAt: "2026-06-18T00:00:00.000Z",
    });
    expect(v.ok).toBe(false);
  });
  it("accepts a baseline locked before intervention and outcome", () => {
    const lockedEarly = lockBaseline(base, "2026-06-02T00:00:00.000Z", "pre-registered");
    const v = baselineTemporallyValid(lockedEarly, {
      interventionAt: "2026-06-10T00:00:00.000Z",
      outcomeObservedAt: "2026-06-18T00:00:00.000Z",
    });
    expect(v.ok).toBe(true);
  });
  it("a correction preserves the previous baseline via a linked revision", () => {
    const locked = lockBaseline(base, "2026-06-02T00:00:00.000Z", "pre-registered");
    const revised = reviseBaseline(locked, {
      baselineId: "BL-2",
      calculatedAmount: money(700_000, USD),
      sourceRefs: ["cohort:2026Q1-corrected"],
      establishedAt: "2026-07-05T00:00:00.000Z",
      establishedBy: "analyst",
      reason: "cohort correction",
    });
    expect(locked.calculatedAmount.minor).toBe(620_000); // original preserved
    expect(revised.supersedes).toBe("BL-1");
    expect(revised.calculatedAmount.minor).toBe(700_000);
  });
});

describe("Independent evidence + separation of authority (H3, H1, reqs #6/#10)", () => {
  it("operator notes alone are not independent evidence", () => {
    const note = makeEvidence({
      evidenceId: "EV-note",
      evidenceType: "operator_note",
      sourceSystem: "manual",
      sourceRecordId: "n1",
      observedAt: "2026-06-19T00:00:00.000Z",
      ingestedAt: "2026-06-19T00:00:00.000Z",
      trustClassification: "beneficiary_controlled",
      suppliedBy: "operator@company",
    });
    const invoice = makeEvidence({
      evidenceId: "EV-inv",
      evidenceType: "invoice_paid",
      sourceSystem: "billing",
      sourceRecordId: "inv_9",
      observedAt: "2026-06-19T00:00:00.000Z",
      ingestedAt: "2026-06-19T00:00:00.000Z",
      trustClassification: "independent",
      suppliedBy: "billing",
    });
    expect(hasIndependentEvidence([note])).toBe(false);
    expect(hasIndependentEvidence([note, invoice])).toBe(true);
  });
  it("the case owner cannot be the sole approver of their own claim", () => {
    const owner: Actor = { id: "op@company", displayName: "Op", roles: ["caseOwner", "proofApprover"] };
    const other: Actor = { id: "cfo@company", displayName: "CFO", roles: ["proofApprover"] };
    expect(
      canApproveProof(CURRENT_POLICY.approval, { ownerId: "op@company", approverActor: owner, amountMinor: 2_480_000 }).ok,
    ).toBe(false);
    expect(
      canApproveProof(CURRENT_POLICY.approval, { ownerId: "op@company", approverActor: other, amountMinor: 2_480_000 }).ok,
    ).toBe(true);
  });
});
