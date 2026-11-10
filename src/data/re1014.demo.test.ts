// Mission #010 · Increment 1 — "One Case, One REFUSAL" (contract-level demonstration test).
//
// WHAT THIS FILE USED TO ASSERT, AND WHY IT NO LONGER CAN. It walked RE-1014 (ActivationMissed →
// UsageActivation → second invoice collected → approved recovery → Auditable Revenue Returned) and
// asserted a $10,600.00 contribution to proven and auditable revenue. Every one of those assertions
// passed. They were also wrong, and the gate that now refuses them is the one the owner approved on
// 2026-11-10: **no source attests that an in-product usage-activation flow was triggered.** The only
// correction evidence that exists anywhere in this system is the billing system's statement about
// billing, and a corrective invoice says nothing whatsoever about an activation. A proof is immutable,
// so a claim frozen on that basis could never have been corrected — only superseded.
//
// SO RE-1014 IS PRESERVED AS A DETECTION-AND-REFUSAL DEMONSTRATION, which is what the owner's
// instruction 1 asks for, and it is a better demonstration than the one it replaces: the leak is real,
// the money was really collected, the governance really refuses to call it proven, and the refusal
// names the mechanism rather than blaming the data. The complete PROVEN loop lives in
// `re1015.proof.test.ts`, on a case whose mechanism is attestable.
//
// NOT ONE FIELD ON RE-1014 WAS CHANGED to produce this. Same leakage type, same reason, same amounts,
// same evidence, same dates. Relabelling it `BillingCorrection` would have made the demonstration
// assert a mechanism the case never had, which is the exact failure the gate exists to prevent.
//
// Every assertion still states a BUSINESS CONTRACT observable from the product's public outputs.
import { describe, it, expect } from "vitest";

import { seedEvents } from "./seed";
import { seedTrust, seedTrustProvability } from "./seedTrust";
import { provenLedger } from "../domain/provenLedger";
import { recoveryLoop } from "../domain/loop";
import {
  isAuditable,
  isClassifiedRecovery,
  isCounted,
  isProofRefusedRecovery,
  proofUnavailable,
  provenRevenueReturned,
} from "../domain/invariants";
import { portfolioMetrics } from "../domain/metrics";

const CASE_ID = "RE-1014";
const CURRENCY = "USD";

describe("Mission #010 · Increment 1 — RE-1014: detection is real, the proof is refused", () => {
  const events = seedEvents();
  const { proofs } = seedTrust();
  const theCase = events.find((e) => e.eventId === CASE_ID)!;

  it("identifies a real leakage and the recovery play that was actioned — all unchanged", () => {
    expect(theCase.leakageType).toBe("ActivationMissed");
    expect(theCase.recoveryReason).toBe("UsageActivation");
    expect(theCase.actionsTaken.length).toBeGreaterThanOrEqual(1);
  });

  it("reaches a recovered outcome, and the collection is a recorded fact", () => {
    // The money arrived. That is not in doubt and is not what the refusal is about.
    expect(theCase.status).toBe("Recovered");
    expect(theCase.collectedAmount).toBe(13_200);
    expect(theCase.baselineAmount).toBe(2_600);
    // The arithmetic over those two recorded numbers is still true and still computed, never typed in.
    expect(theCase.revenueReturned).toBe(10_600);
    expect(isClassifiedRecovery(theCase)).toBe(true);
  });

  it("NO PROOF EXISTS for it, and the refusal names the mechanism", () => {
    const refusal = proofUnavailable(theCase);
    expect(refusal).not.toBeNull();
    expect(refusal!.code).toBe("CORRECTION_CHANNEL_NOT_DECLARED");
    expect(refusal!.detail).toContain("UsageActivation");
    expect(refusal!.detail).toMatch(/no source-attested correction channel/i);
    // It does NOT blame the data or the evidence: the remedy named is a governance decision.
    expect(refusal!.detail).toMatch(/governance decision/i);
  });

  it("the governed seed builder produced no proof for it — refused by the GATE, not by a list", () => {
    expect(proofs.some((p) => p.recoveryCaseId === CASE_ID)).toBe(false);
    const verdict = seedTrustProvability().find((v) => v.caseId === CASE_ID)!;
    expect(verdict.proven).toBe(false);
    expect(verdict.refusals.join(" ")).toContain("CORRECTION_CHANNEL_NOT_DECLARED");
  });

  it("its Revenue Returned is NOT COMPUTED — and `null` is not $0.00", () => {
    // A rendered zero would assert that a proof was looked for, found, and summed to nothing. The
    // true statement is that no proof can exist, which is what `null` says.
    expect(provenRevenueReturned(theCase)).toBeNull();
    expect(provenRevenueReturned(theCase)).not.toBe(0);
    expect(isCounted(theCase)).toBe(false);
    expect(isAuditable(theCase)).toBe(false);
  });

  it("it contributes NOTHING to proven or auditable revenue, from either direction", () => {
    const withCase = provenLedger(proofs, CURRENCY);
    const withoutCase = provenLedger(proofs.filter((p) => p.recoveryCaseId !== CASE_ID), CURRENCY);
    // Removing it changes nothing, because it was never in there.
    expect(withCase.revenueReturned.minor).toBe(withoutCase.revenueReturned.minor);
    expect(withCase.auditableRevenue.minor).toBe(withoutCase.auditableRevenue.minor);
    expect(withCase.auditableCount).toBe(withoutCase.auditableCount);
  });

  it("the $13,200.00 collected is REPORTED, not silently dropped", () => {
    // The dishonest version of this correction would be one where the money disappears from every
    // screen. It is reported as collected-with-proof-refused, apart from both ledgers — and the figure
    // offered is COLLECTED, never `collected − baseline`, because the delta in the same units reads as
    // Revenue Returned whatever it is labelled.
    expect(isProofRefusedRecovery(theCase)).toBe(true);
    const m = portfolioMetrics(events);
    expect(m.proofRefusedCount).toBe(7);
    expect(m.proofRefusedCollected).toBe(106_500);
    // This case's own collection is inside that figure.
    const without = portfolioMetrics(events.filter((e) => e.eventId !== CASE_ID));
    expect(m.proofRefusedCollected - without.proofRefusedCollected).toBe(13_200);
    // And the refused total is not the proven total, nor summed into it anywhere.
    expect(m.proofRefusedCollected).not.toBe(m.recoveredRevenue);
    expect(Object.values(m)).not.toContain(m.proofRefusedCollected + m.recoveredRevenue);
  });

  it("reports reproducibly — a refusal does not drift between reads", () => {
    expect(provenLedger(proofs, CURRENCY)).toEqual(provenLedger(proofs, CURRENCY));
    expect(proofUnavailable(theCase)).toEqual(proofUnavailable(theCase));
  });

  it("never mixes the forecast ledger with proven Revenue Returned", () => {
    const loop = recoveryLoop(events, proofs);
    const withCase = provenLedger(proofs, CURRENCY);
    expect(loop.returned.minor).toBe(withCase.revenueReturned.minor);
    expect(loop.auditable.minor).toBe(withCase.auditableRevenue.minor);
    expect(loop.opportunity).not.toBe(loop.returned.minor);
    const combinedDollars = loop.opportunity + loop.returned.minor / 100;
    const combinedMinor = loop.opportunity * 100 + loop.returned.minor;
    const headlineNumbers = Object.values(loop).flatMap((v) =>
      typeof v === "number" ? [v] : v && typeof v === "object" && "minor" in v ? [(v as { minor: number }).minor] : [],
    );
    expect(headlineNumbers).not.toContain(combinedDollars);
    expect(headlineNumbers).not.toContain(combinedMinor);
  });
});
