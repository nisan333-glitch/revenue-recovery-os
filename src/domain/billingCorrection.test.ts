import { describe, it, expect } from "vitest";
import { money } from "./money";
import { createApprovedProof, type ProofApprovalInput } from "./proof";
import { CURRENT_POLICY } from "./policy";
import { computeRevenueReturned, isAuditable, isCounted, withDerivedReturn } from "./invariants";
import { ALL_REASON_KEYS, RECOVERY_REASONS, reasonLabel } from "./reasons";
import type { RecoveryEvent } from "./types";

// BillingCorrection is a CLASSIFICATION of how money came back. It is not a money source, and nothing
// below lets it become one: the equation is Collected − Baseline and the reason does not enter it.

const approval = (over: Partial<ProofApprovalInput> = {}): ProofApprovalInput => ({
  proofId: "PF-BC-1",
  recoveryCaseId: "RC-bc-1",
  approvedAt: "2026-06-20T10:00:00.000Z",
  collectedAmount: money(9_000, "USD"),
  baselineAmount: money(2_000, "USD"),
  excludedRecoveryAmount: money(0, "USD"),
  exclusionStatement: "Zero excluded — asserted (synthetic).",
  recoveryReason: "BillingCorrection",
  attribution: "corrective invoice raised and collected (synthetic)",
  evidenceRefs: ["EV-bc-1"],
  baselineId: "BL-bc-1",
  baselineMethodId: CURRENT_POLICY.baselineMethodId,
  baselineVersion: 1,
  baselineLockPolicy: CURRENT_POLICY.baselineLockPolicy,
  policyVersion: CURRENT_POLICY.policyVersion,
  confidenceMethodologyVersion: CURRENT_POLICY.confidenceMethodologyVersion,
  proofThresholdUsed: CURRENT_POLICY.proofThreshold,
  confidenceUsed: 95,
  approvedBy: "approver@company",
  ...over,
});

const event = (over: Partial<RecoveryEvent>): RecoveryEvent => withDerivedReturn({
  eventId: "e-bc", customer: "Synthetic", funnelStage: "Renewal", leakageType: "RenewalAtRisk",
  recoveryReason: "BillingCorrection", owner: "Dana", status: "Recovered", riskAmount: 1000,
  baselineAmount: 200, collectedAmount: 1000, revenueReturned: 800, confidence: 90,
  actionsTaken: ["corrective invoice"], evidenceNotes: "synthetic", createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z", audit: [], ...over,
});

describe("BillingCorrection · the vocabulary", () => {
  it("is a listed reason with a label, and keys stay unique", () => {
    expect(ALL_REASON_KEYS).toContain("BillingCorrection");
    expect(new Set(ALL_REASON_KEYS).size).toBe(ALL_REASON_KEYS.length);
    expect(reasonLabel("BillingCorrection")).toBe("Billing Correction");
    expect(RECOVERY_REASONS.find((r) => r.key === "BillingCorrection")?.appliesTo).toBe("RevenueUnderBilled");
  });

  it("leaves the seven earlier reasons exactly as they were — additive only", () => {
    expect(ALL_REASON_KEYS.slice(0, 7)).toEqual([
      "OnboardingReboot", "MilestoneNudge", "EnablementSession", "CSMOutreach",
      "ExecBusinessReview", "RenewalOutreach", "UsageActivation",
    ]);
  });
});

describe("BillingCorrection · it is a label, never a money source", () => {
  it("the proof still computes Collected − Baseline, with the reason absent from the equation", () => {
    const withReason = createApprovedProof(approval());
    const otherReason = createApprovedProof(approval({ recoveryReason: "UsageActivation" }));
    expect(withReason.revenueReturned.minor).toBe(7_000);
    expect(withReason.revenueReturned).toEqual(otherReason.revenueReturned);
  });

  it("a billing correction with nothing collected above baseline returns $0 — raising an invoice is not recovery", () => {
    const p = createApprovedProof(approval({ collectedAmount: money(2_000, "USD") }));
    expect(p.revenueReturned.minor).toBe(0);
    const worse = createApprovedProof(approval({ collectedAmount: money(500, "USD") }));
    expect(worse.revenueReturned.minor).toBe(0); // clamped: never negative, never a credit
  });

  it("the explicit-exclusion rule still applies to this reason", () => {
    expect(() => createApprovedProof(approval({ exclusionStatement: "" }))).toThrow(/exclusion/);
  });

  it("an event labelled BillingCorrection is auditable only with uplift, status and proof-grade confidence", () => {
    expect(isAuditable(event({}))).toBe(true);
    expect(isAuditable(event({ collectedAmount: 200, baselineAmount: 200 }))).toBe(false); // no uplift
    expect(isAuditable(event({ confidence: 10 }))).toBe(false);
    expect(isCounted(event({ status: "InProgress" }))).toBe(false);
    expect(computeRevenueReturned(1000, 200)).toBe(800);
  });
});
