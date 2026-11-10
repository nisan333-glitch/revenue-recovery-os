// Locks the Recovery Loop summary AND the Constitution: the funnel narrows
// (identified → applied → proven) and the forecast ledger (opportunity) is never
// the same number as, nor summed into, the proven ledger (returned). Critically, the proven
// values come ONLY from approved Proofs (provenLedger) — never recomputed from mutable Cases.
import { describe, it, expect } from "vitest";
import { seedEvents } from "../data/seed";
import { seedTrust } from "../data/seedTrust";
import { recoveryLoop } from "./loop";
import { portfolioMetrics } from "./metrics";
import { establishBaseline, lockBaseline } from "./baseline";
import { makeEvidence } from "./evidence";
import { money } from "./money";
import { CURRENT_POLICY } from "./policy";
import { approveProofForCase } from "./approval";
import type { Proof } from "./proof";

const events = seedEvents();
const proofs = seedTrust().proofs;
const loop = recoveryLoop(events, proofs);

// Build one extra approved Proof (through the real gate) for a case that has none in the seed.
//
// It is a BILLING CORRECTION, which it has to be: the gate now refuses a mechanism no source attests,
// so a `MilestoneNudge` fixture would be refused and this helper could not build anything. The point
// of the helper is unchanged — prove that `recoveryLoop`'s proven figures come from Proofs and not
// from Cases — and a provable mechanism is what lets it keep making that point.
function extraProofFor(caseId: string, collectedMinor: number, baselineMinor: number): Proof {
  const baseline = lockBaseline(
    establishBaseline({
      baselineId: `BL-${caseId}-x`,
      method: CURRENT_POLICY.baselineMethodId,
      methodVersion: CURRENT_POLICY.baselineMethodVersion,
      sourceRefs: ["cohort:test"],
      calculatedAmount: money(baselineMinor, "USD"),
      applicableLeakType: "RevenueUnderBilled",
      effectiveAt: "2026-06-18T00:00:00.000Z",
      establishedAt: "2026-06-18T00:00:00.000Z",
      establishedBy: "system",
    }),
    "2026-06-18T01:00:00.000Z",
    "pre-registered",
  );
  const evidence = [
    makeEvidence({
      evidenceId: `EV-${caseId}-fix`,
      evidenceType: "corrective_invoice_issued",
      sourceSystem: "billing",
      sourceRecordId: "CN-X",
      observedAt: "2026-06-19T12:00:00.000Z",
      ingestedAt: "2026-06-19T12:00:00.000Z",
      trustClassification: "independent",
      suppliedBy: "billing",
    }),
    makeEvidence({
      evidenceId: `EV-${caseId}-x`,
      evidenceType: "invoice_paid",
      sourceSystem: "billing",
      sourceRecordId: "INV-X",
      observedAt: "2026-06-20T00:00:00.000Z",
      ingestedAt: "2026-06-20T00:00:00.000Z",
      trustClassification: "independent",
      suppliedBy: "billing",
    }),
  ];
  return approveProofForCase({
    proofId: `PF-${caseId}-x`,
    recoveryCaseId: caseId,
    approvedAt: "2026-06-21T00:00:00.000Z",
    ownerActorId: "dana@company",
    approverActor: { id: "cfo@company", displayName: "CFO", roles: ["proofApprover"] },
    baseline,
    evidence,
    interventionAt: "2026-06-19T00:00:00.000Z",
    outcomeObservedAt: "2026-06-20T00:00:00.000Z",
    collectedMinor,
    currency: "USD",
    excludedMinor: 0,
    exclusionStatement: "No excluded recovery — asserted: full delta independently evidenced.",
    recoveryReason: "BillingCorrection",
    attribution: "test",
    confidenceUsed: 95,
    policy: CURRENT_POLICY,
    recoveryType: "RevenueUnderBilled",
  });
}

describe("recovery loop summary", () => {
  it("Identify: money at risk is the live open exposure; opportunity is total surfaced", () => {
    expect(loop.moneyAtRisk).toBe(71800); // open risk only — the live exposure
    expect(loop.opportunity).toBe(218200); // Σ riskAmount over all 15 seed events (+ RE-1015's 18,000)
    expect(loop.identifiedCount).toBe(15);
    expect(loop.openCount).toBe(4);
    expect(loop.recoverableForecast).toBe(32660); // forecast, not proven
  });

  it("Act: dominant play is advice; action-taken counts only logged, observable actions", () => {
    expect(loop.recommendedPlay).toBe("MilestoneNudge");
    expect(loop.actionTakenCount).toBe(12); // + RE-1015
  });

  it("Prove: the money that CANNOT be proven is reported, not dropped", () => {
    // RECOMPUTED for the owner's Option 1 decision. Seven cases collected $106,500 under mechanisms
    // no source attests, so no proof exists for any of them — and the figure is reported apart from
    // both ledgers rather than vanishing from the loop summary.
    const m = portfolioMetrics(events);
    expect(m.proofRefusedCount).toBe(7);
    expect(m.proofRefusedCollected).toBe(106_500);
  });

  it("Prove: returned and auditable come from approved Proofs (Money), not from Cases", () => {
    // RECOMPUTED: the only attestable mechanism in the seed set is RE-1015's billing correction.
    expect(loop.returned.minor).toBe(550_000); // $5,500
    expect(loop.auditable.minor).toBe(550_000); // $5,500
    expect(loop.provenCount).toBe(1);
    expect(loop.auditableCount).toBe(1);
    // The RATE still counts recoveries rather than proofs — 8 recovered, 1 failed.
    expect(loop.recoveryRate).toBeCloseTo(8 / 9, 5);
  });

  it("R1: seed events with NO approved Proofs ⇒ returned = 0 and auditable = 0", () => {
    const empty = recoveryLoop(events, []);
    expect(empty.returned.minor).toBe(0);
    expect(empty.auditable.minor).toBe(0);
    expect(empty.provenCount).toBe(0);
    expect(empty.auditableCount).toBe(0);
  });

  it("R1: marking a Case Recovered WITHOUT approving a Proof does not change returned/auditable", () => {
    // Force the open Stark case (RE-1007) to look fully recovered at the Case level.
    const tampered = events.map((e) =>
      e.eventId === "RE-1007"
        ? { ...e, status: "Recovered" as const, recoveryReason: "BillingCorrection" as const, leakageType: "RevenueUnderBilled" as const, collectedAmount: 999999, confidence: 99 }
        : e,
    );
    // Tampered into the MOST favourable shape available — a provable mechanism on a provable case type
    // with a huge collection — and it still moves nothing, because the figures come from Proofs.
    const after = recoveryLoop(tampered, proofs); // same proofs — none approved for RE-1007
    expect(after.returned.minor).toBe(550_000); // unchanged
    expect(after.auditable.minor).toBe(550_000); // unchanged
    expect(after.provenCount).toBe(1);
  });

  it("R1: approving a Proof changes the headline values exactly once, by exactly its amount", () => {
    const extra = extraProofFor("RE-1007", 3_100_000, 620_000); // returned = 2_480_000
    const after = recoveryLoop(events, [...proofs, extra]);
    expect(after.returned.minor).toBe(550_000 + 2_480_000);
    expect(after.auditable.minor).toBe(550_000 + 2_480_000);
    expect(after.provenCount).toBe(2);
    // Adding the SAME proof again must not double-count (chain fold by chainId).
    const twice = recoveryLoop(events, [...proofs, extra, extra]);
    expect(twice.returned.minor).toBe(after.returned.minor);
    expect(twice.provenCount).toBe(2);
  });

  it("the funnel only narrows: identified ≥ action taken ≥ proven ≥ auditable", () => {
    expect(loop.identifiedCount).toBeGreaterThanOrEqual(loop.actionTakenCount);
    expect(loop.actionTakenCount).toBeGreaterThanOrEqual(loop.provenCount);
    expect(loop.provenCount).toBeGreaterThanOrEqual(loop.auditableCount);
  });

  it("CONSTITUTION: forecast (opportunity) and proven (returned) are never equal nor summed", () => {
    expect(loop.opportunity).not.toBe(loop.returned.minor);
    expect(loop.recoverableForecast).not.toBe(loop.returned.minor);
    // Proven cash (dollars) never exceeds the opportunity we found; auditable ≤ returned.
    expect(loop.returned.minor / 100).toBeLessThanOrEqual(loop.opportunity);
    expect(loop.auditable.minor).toBeLessThanOrEqual(loop.returned.minor);
  });
});
