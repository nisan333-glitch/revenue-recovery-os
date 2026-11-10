// RE-1015 — "One Case, One PROOF": the complete Identify → Fix → Prove loop, on a mechanism a source
// can actually attest.
//
// WHY THIS CASE AND NOT ANOTHER. Of the eight declared recovery mechanisms, exactly one has a declared
// correction channel: `BillingCorrection`. The reason is not arbitrary and is not about effort. A
// corrective invoice is the billing system's own statement that it raised a charge, so it attests the
// fix directly. Nothing attests that an onboarding was restarted, a milestone reached, an executive
// review held or a usage flag switched on — and the system that would be asked (billing) is the system
// whose records say nothing about any of them. So `RevenueUnderBilled` / `BillingCorrection` is where
// a PROVEN demonstration can honestly live, and `re1014.demo.test.ts` holds the refusal.
//
// THE ACCOUNTING IS INTERNALLY CONSISTENT AND RE-DERIVABLE, which is the whole claim:
//
//   contracted obligation         $18,000.00
//   originally invoiced           $12,500.00   ← the governed baseline
//   corrective charge CN-9120      $5,500.00   ← raised and attested BY BILLING
//   collected after correction     $18,000.00
//   Revenue Returned               $5,500.00   = collected − baseline, AND = the corrective charge
//
// The last identity is what makes this provable rather than plausible. The uplift is not an estimate of
// how much a human action moved a number; it EQUALS a specific charge the billing system states it
// raised. A CFO re-derives it from two documents without believing anything we say.
import { describe, it, expect } from "vitest";

import { seedEvents } from "./seed";
import { seedTrust, seedTrustProvability } from "./seedTrust";
import { provenLedger } from "../domain/provenLedger";
import { recoveryLoop } from "../domain/loop";
import { isAuditable, isCounted, proofUnavailable, provenRevenueReturned } from "../domain/invariants";
import { PLAYBOOK } from "../domain/recommendation";
import { deriveEvidenceRole } from "../domain/evidenceRole";

const CASE_ID = "RE-1015";
const CURRENCY = "USD";
const dollars = (minor: number) => minor / 100;

describe("RE-1015 — the complete PROVEN loop on an attestable mechanism", () => {
  const events = seedEvents();
  const { proofs, evidenceByCase } = seedTrust();
  const theCase = events.find((e) => e.eventId === CASE_ID)!;
  const evidence = evidenceByCase[CASE_ID]!;

  it("IDENTIFY · a billing-side shortfall, found by reconciliation rather than asserted", () => {
    expect(theCase.leakageType).toBe("RevenueUnderBilled");
    expect(theCase.status).toBe("Recovered");
    // The playbook entry for this family names an ACCOUNTING proof event, not a behavioural one.
    const play = PLAYBOOK.RevenueUnderBilled;
    expect(play.recommendedReason).toBe("BillingCorrection");
    expect(play.expectedProofEvent).toMatch(/corrective charge/i);
    expect(play.expectedProofEvent).toMatch(/settled/i);
  });

  it("FIX · the correction is the billing system's own attested statement, and NH did not author it", () => {
    const correction = evidence.find((e) => deriveEvidenceRole(e.sourceSystem, e.evidenceType) === "correction");
    expect(correction, "a correction-role evidence record must exist").toBeDefined();
    expect(correction!.sourceSystem).toBe("billing");
    expect(correction!.evidenceType).toBe("corrective_invoice_issued");
    expect(correction!.sourceRecordId).toBe("CN-9120");
    // The role is DERIVED from (sourceSystem, evidenceType) — a record cannot assert its own role.
    expect(correction!.trustClassification).toBe("independent");
    expect(correction!.beneficiaryControl).toBe(false);
  });

  it("FIX precedes COLLECTION, because a correction that followed the money would not explain it", () => {
    const correction = evidence.find((e) => deriveEvidenceRole(e.sourceSystem, e.evidenceType) === "correction")!;
    const outcome = evidence.find((e) => deriveEvidenceRole(e.sourceSystem, e.evidenceType) === "outcome")!;
    expect(correction.observedAt < outcome.observedAt).toBe(true);
  });

  it("PROVE · a proof exists, and the gate refused it nothing", () => {
    const verdict = seedTrustProvability().find((v) => v.caseId === CASE_ID)!;
    expect(verdict.proven).toBe(true);
    expect(verdict.refusals).toEqual([]);
    expect(proofUnavailable(theCase)).toBeNull();
    expect(isCounted(theCase)).toBe(true);
    expect(isAuditable(theCase)).toBe(true);
  });

  it("the proven uplift EQUALS the corrective charge — an identity, not a hypothesis", () => {
    expect(theCase.collectedAmount).toBe(18_000);
    expect(theCase.baselineAmount).toBe(12_500);
    const uplift = theCase.collectedAmount - theCase.baselineAmount;
    expect(uplift).toBe(5_500);
    expect(provenRevenueReturned(theCase)).toBe(5_500);
    // And the case's own narrative states the same figure, so the screen and the arithmetic agree.
    expect(theCase.evidenceNotes).toContain("$5,500.00");
    expect(theCase.evidenceNotes).toContain("CN-9120");
  });

  it("it is the ONLY proven recovery in the portfolio, counted exactly once", () => {
    expect(proofs).toHaveLength(1);
    expect(proofs[0]!.recoveryCaseId).toBe(CASE_ID);
    const withCase = provenLedger(proofs, CURRENCY);
    const withoutCase = provenLedger(proofs.filter((p) => p.recoveryCaseId !== CASE_ID), CURRENCY);
    expect(dollars(withCase.revenueReturned.minor - withoutCase.revenueReturned.minor)).toBe(5_500);
    expect(dollars(withCase.auditableRevenue.minor - withoutCase.auditableRevenue.minor)).toBe(5_500);
    expect(withCase.auditableCount - withoutCase.auditableCount).toBe(1);
    expect(withCase.reversedCount).toBe(0);
  });

  it("was not self-approved: the beneficiary did not approve their own claim", () => {
    const proof = proofs.find((p) => p.recoveryCaseId === CASE_ID)!;
    expect(proof.approvedBy).toBeTruthy();
    expect(proof.approvedBy).not.toBe(theCase.owner);
  });

  it("the whole loop's proven figures come from the Proof, never recomputed from the Case", () => {
    const loop = recoveryLoop(events, proofs);
    expect(loop.returned.minor).toBe(550_000);
    expect(loop.auditable.minor).toBe(550_000);
    expect(loop.provenCount).toBe(1);
    expect(loop.auditableCount).toBe(1);
    // Marking another case Recovered at the Case level cannot move either figure.
    const tampered = events.map((e) =>
      e.eventId === "RE-1007"
        ? { ...e, status: "Recovered" as const, collectedAmount: 999_999, confidence: 99 }
        : e,
    );
    const after = recoveryLoop(tampered, proofs);
    expect(after.returned.minor).toBe(550_000);
    expect(after.auditable.minor).toBe(550_000);
  });

  it("forecast and proven are never the same number, nor summed", () => {
    const loop = recoveryLoop(events, proofs);
    expect(loop.opportunity).not.toBe(loop.returned.minor);
    const combined = loop.opportunity * 100 + loop.returned.minor;
    const headline = Object.values(loop).flatMap((v) =>
      typeof v === "number" ? [v] : v && typeof v === "object" && "minor" in v ? [(v as { minor: number }).minor] : [],
    );
    expect(headline).not.toContain(combined);
  });

  it("a BillingCorrection cannot be attached to a case that was not under-billed", () => {
    // The scope gate, from the other side: this proof is only available because the case's recovery
    // type really is `RevenueUnderBilled`. The reason cannot be borrowed by a different family.
    const elsewhere = { ...theCase, leakageType: "ActivationMissed" as const };
    expect(proofUnavailable(elsewhere)!.code).toBe("REASON_SCOPE_VIOLATION");
    expect(isAuditable(elsewhere)).toBe(false);
  });
});
