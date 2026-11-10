import { describe, it, expect } from "vitest";
import { money } from "./money";
import { createApprovedProof, type ProofApprovalInput } from "./proof";
import { CURRENT_POLICY } from "./policy";
import { computeRevenueReturned, isAuditable, isCounted, withDerivedReturn, proofUnavailable } from "./invariants";
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

// THE FIXTURE'S LEAKAGE TYPE WAS `RenewalAtRisk`, WHICH WAS INCOHERENT WITH ITS OWN REASON, and the
// new gate is what found it. `BillingCorrection`'s declared scope has been `RevenueUnderBilled` since
// the reason was added on 2026-10-23, and `reasonScopeViolation` has refused the pair on the governed
// route ever since — but the frontend predicates never asked, so this fixture asserted that a billing
// correction on a renewal-at-risk case was auditable. It is not; it never was. Corrected to the type
// the reason's own definition names, with the refusal asserted directly below so the finding is kept.
const event = (over: Partial<RecoveryEvent>): RecoveryEvent => withDerivedReturn({
  eventId: "e-bc", customer: "Synthetic", funnelStage: "Renewal", leakageType: "RevenueUnderBilled",
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

  it("the label cannot be borrowed by a case that was not under-billed", () => {
    // The scope gate. Found by this slice: the fixture above used to be `RenewalAtRisk`, and nothing
    // in the frontend refused it.
    for (const leakageType of ["RenewalAtRisk", "ActivationMissed", "LowAdoption"] as const) {
      const e = event({ leakageType });
      expect(proofUnavailable(e)!.code, leakageType).toBe("REASON_SCOPE_VIOLATION");
      expect(isAuditable(e), leakageType).toBe(false);
      expect(isCounted(e), leakageType).toBe(false);
    }
  });

  it("an event labelled BillingCorrection is auditable only with uplift, status and proof-grade confidence", () => {
    expect(isAuditable(event({}))).toBe(true);
    expect(isAuditable(event({ collectedAmount: 200, baselineAmount: 200 }))).toBe(false); // no uplift
    expect(isAuditable(event({ confidence: 10 }))).toBe(false);
    expect(isCounted(event({ status: "InProgress" }))).toBe(false);
    expect(computeRevenueReturned(1000, 200)).toBe(800);
  });
});
