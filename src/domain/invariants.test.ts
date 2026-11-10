import { describe, it, expect } from "vitest";
import type { RecoveryEvent } from "./types";
import {
  computeRevenueReturned,
  withDerivedReturn,
  isClassifiedRecovery,
  isCounted,
  isAuditable,
  isProofRefusedRecovery,
  proofUnavailable,
  provenRevenueReturned,
  validateEvent,
} from "./invariants";
import { portfolioMetrics } from "./metrics";
import { PROOF_THRESHOLD } from "./confidence";

// THE BASE FIXTURE IS A PROVABLE PAIR, and it has to be. `RenewalAtRisk`/`RenewalOutreach` — what it
// used to be — is refused since the owner's Option 1 decision, because no source attests that a
// renewal outreach happened. Leaving it would have put every other rule in this file behind that one
// refusal, so rules 2, 4 and 5 would have stopped being tested at all. The refused pair is asserted
// directly in its own block at the end instead, so nothing is lost by moving the default.
function ev(partial: Partial<RecoveryEvent>): RecoveryEvent {
  const base: RecoveryEvent = {
    eventId: "e1",
    customer: "Acme",
    funnelStage: "Renewal",
    leakageType: "RevenueUnderBilled",
    recoveryReason: "BillingCorrection",
    owner: "Dana",
    status: "Recovered",
    riskAmount: 1000,
    baselineAmount: 200,
    collectedAmount: 1000,
    revenueReturned: 800,
    confidence: 90,
    actionsTaken: ["retry"],
    evidenceNotes: "Stripe charge succeeded on retry #2 with full evidence.",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    audit: [],
  };
  return withDerivedReturn({ ...base, ...partial });
}

describe("core equation", () => {
  it("revenueReturned = collected - baseline", () => {
    expect(computeRevenueReturned(1000, 200)).toBe(800);
    expect(computeRevenueReturned(0, 0)).toBe(0);
    expect(computeRevenueReturned(150, 400)).toBe(-250);
  });

  it("withDerivedReturn always corrects a drifted value", () => {
    const e = ev({ collectedAmount: 500, baselineAmount: 100, revenueReturned: 9999 });
    expect(e.revenueReturned).toBe(400);
    expect(validateEvent(e)).toHaveLength(0);
  });
});

describe("rule 2: no reason => not counted", () => {
  it("excludes unclassified recovered events", () => {
    const noReason = ev({ recoveryReason: null, status: "Recovered" });
    expect(isCounted(noReason)).toBe(false);
    const withReason = ev({ recoveryReason: "BillingCorrection" });
    expect(isCounted(withReason)).toBe(true);
  });
});

describe("the mechanism must be one a source can attest", () => {
  // The frontend half of the fail-closed correction. Until the owner's Option 1 decision these
  // predicates asked only whether a reason was PRESENT, so a mechanism nothing could evidence counted
  // as proven Revenue Returned on every screen while the governed route refused it.
  const REFUSED = [
    ["RenewalAtRisk", "RenewalOutreach"],
    ["ActivationMissed", "MilestoneNudge"],
    ["StalledOnboarding", "OnboardingReboot"],
    ["ExpansionStalled", "ExecBusinessReview"],
    ["LowAdoption", "CSMOutreach"],
    ["NoFirstValue", "EnablementSession"],
    ["ActivationMissed", "UsageActivation"],
  ] as const;

  it("every one of the seven channel-less mechanisms is refused, and names why", () => {
    for (const [leakageType, recoveryReason] of REFUSED) {
      const e = ev({ leakageType, recoveryReason });
      const refusal = proofUnavailable(e);
      expect(refusal, recoveryReason).not.toBeNull();
      expect(refusal!.code, recoveryReason).toBe("CORRECTION_CHANNEL_NOT_DECLARED");
      expect(refusal!.detail, recoveryReason).toContain(recoveryReason);
      expect(isCounted(e), recoveryReason).toBe(false);
      expect(isAuditable(e), recoveryReason).toBe(false);
    }
  });

  it("a refused case is NOT COMPUTED, never zero — and `null` is the value that says so", () => {
    const e = ev({ leakageType: "ActivationMissed", recoveryReason: "UsageActivation" });
    expect(provenRevenueReturned(e)).toBeNull();
    expect(provenRevenueReturned(e)).not.toBe(0);
    // The arithmetic fact is untouched: `collected − baseline` is still true about the two numbers.
    expect(e.revenueReturned).toBe(800);
  });

  it("confidence cannot buy a channel — 100 is still refused", () => {
    // A confidence score is the beneficiary's own estimate of their attribution.
    const e = ev({ leakageType: "ActivationMissed", recoveryReason: "UsageActivation", confidence: 100 });
    expect(isAuditable(e)).toBe(false);
  });

  it("a BillingCorrection on a case that was NOT under-billed is refused on SCOPE, not channel", () => {
    // Two different refusals, and the more specific one wins: naming a mechanism the case never had
    // is a false statement about what happened, which outranks a statement about what can be
    // evidenced. Nothing is relabelled to dodge it — the pair is simply wrong together.
    const e = ev({ leakageType: "ActivationMissed", recoveryReason: "BillingCorrection" });
    expect(proofUnavailable(e)!.code).toBe("REASON_SCOPE_VIOLATION");
    expect(isCounted(e)).toBe(false);
  });

  it("REFUSED and UNCLASSIFIED stay distinguishable, and so do REFUSED and RECOVERED", () => {
    const refused = ev({ leakageType: "ActivationMissed", recoveryReason: "UsageActivation" });
    const unclassified = ev({ recoveryReason: null });
    expect(isProofRefusedRecovery(refused)).toBe(true);
    // An unclassified recovery is refused by rule 2, which is a different fact with a different
    // remedy — classify it — so it is not in the proof-refused set.
    expect(isProofRefusedRecovery(unclassified)).toBe(false);
    // And the money WAS collected on the refused case: it is not a failed recovery.
    expect(isClassifiedRecovery(refused)).toBe(true);
    expect(isClassifiedRecovery(ev({ status: "Failed" }))).toBe(false);
  });
});

describe("rule 4: CFO auditable", () => {
  it("requires recovered + reason + proof-grade confidence + uplift", () => {
    expect(isAuditable(ev({ confidence: PROOF_THRESHOLD }))).toBe(true);
    expect(isAuditable(ev({ confidence: PROOF_THRESHOLD - 1 }))).toBe(false);
    expect(isAuditable(ev({ recoveryReason: null }))).toBe(false);
    expect(isAuditable(ev({ status: "InProgress" }))).toBe(false);
    expect(isAuditable(ev({ collectedAmount: 200, baselineAmount: 200 }))).toBe(
      false,
    );
  });
});

describe("rule 5: detected and proven never blend", () => {
  it("detected counts open risk; recovered counts returned — disjoint", () => {
    const events = [
      ev({ eventId: "open", status: "Detected", riskAmount: 5000 }),
      ev({ eventId: "won", status: "Recovered", collectedAmount: 1000, baselineAmount: 100 }),
      ev({
        eventId: "lowconf",
        status: "Recovered",
        confidence: 40,
        collectedAmount: 800,
        baselineAmount: 100,
      }),
    ];
    const m = portfolioMetrics(events);
    expect(m.detectedOpportunity).toBe(5000);
    expect(m.recoveredRevenue).toBe(900 + 700);
    // auditable excludes the low-confidence one
    expect(m.auditableRevenue).toBe(900);
    expect(m.unprovenRevenue).toBe(700);
    // detected (open risk) and recovered (returned) are computed from
    // disjoint event sets — the open event contributes nothing to recovered.
    expect(m.auditableRevenue + m.unprovenRevenue).toBe(m.recoveredRevenue);
    expect(m.detectedCount).toBe(1);
  });
});
