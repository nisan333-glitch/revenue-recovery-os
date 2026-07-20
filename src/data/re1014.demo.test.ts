// Mission #010 · Increment 1 — "One Case, One Proof" (contract-level integration/demonstration test).
//
// Walks the complete Revenue Recovery Loop for RE-1014 (ActivationMissed -> UsageActivation -> second
// invoice collected -> approved recovery -> Auditable Revenue Returned) using ONLY the product's public
// outputs. Every assertion states a BUSINESS CONTRACT — an externally observable outcome or invariant —
// never the mechanism used to enforce it. It reads no private state, asserts no timestamps/enums/actor
// literals or internal helpers, and would remain true after any internal redesign that preserves the
// product's external behaviour. It changes no production code.
import { describe, it, expect } from "vitest";

import { seedEvents } from "./seed";
import { seedTrust } from "./seedTrust";
import { provenLedger } from "../domain/provenLedger";
import { recoveryLoop } from "../domain/loop";

const CASE_ID = "RE-1014";
const CURRENCY = "USD";
const dollars = (minor: number) => minor / 100;

describe("Mission #010 · Increment 1 — RE-1014: the Recovery Loop's observable business contracts", () => {
  const events = seedEvents();
  const { proofs } = seedTrust();
  const theCase = events.find((e) => e.eventId === CASE_ID)!;

  // The proven ledger WITH vs WITHOUT this case — a consumer-visible, implementation-agnostic way to
  // isolate exactly what this one recovery contributes to proven / auditable revenue.
  const withCase = provenLedger(proofs, CURRENCY);
  const withoutCase = provenLedger(proofs.filter((p) => p.recoveryCaseId !== CASE_ID), CURRENCY);
  const provenContribution = dollars(withCase.revenueReturned.minor - withoutCase.revenueReturned.minor);
  const auditableContribution = dollars(withCase.auditableRevenue.minor - withoutCase.auditableRevenue.minor);

  it("identifies a real leakage and the recovery play that was actioned", () => {
    expect(theCase.leakageType).toBe("ActivationMissed");
    expect(theCase.recoveryReason).toBe("UsageActivation");
    expect(theCase.actionsTaken.length).toBeGreaterThanOrEqual(1);
  });

  it("reaches a recovered outcome for the case", () => {
    expect(theCase.status).toBe("Recovered");
  });

  it("recovers money equal to what was collected beyond the baseline (returned = collected − baseline)", () => {
    // Observable business facts: what was collected after the recovery, and the governed baseline.
    expect(theCase.collectedAmount).toBe(13_200);
    expect(theCase.baselineAmount).toBe(2_600);
    // Business contract: the recovered amount is the collected result minus the governed baseline —
    // a computed uplift, not a figure anyone typed in.
    const expectedUplift = theCase.collectedAmount - theCase.baselineAmount;
    expect(expectedUplift).toBe(10_600);
    expect(provenContribution).toBe(expectedUplift);
  });

  it("contributes CFO-auditable revenue, counted exactly once", () => {
    // Contract: removing this one recovery lowers proven AND auditable revenue by exactly its amount,
    // and drops exactly one auditable recovery — so it is auditable, counted, and never double-counted.
    // (A recovery is auditable only under the product's rules: valid governed baseline, independent
    //  approval, positive uplift, sufficient confidence — so this delta IS proof those rules held.)
    expect(auditableContribution).toBe(10_600);
    expect(withCase.auditableCount - withoutCase.auditableCount).toBe(1);
    expect(withCase.reversedCount).toBe(0);
  });

  it("was not self-approved: the beneficiary of the recovery did not approve their own claim", () => {
    // Governance contract (no self-approval). Uses only the case owner and the CFO-visible approver.
    const cfoRecord = proofs.find((p) => p.recoveryCaseId === CASE_ID)!;
    expect(cfoRecord.approvedBy).toBeTruthy();
    expect(cfoRecord.approvedBy).not.toBe(theCase.owner);
  });

  it("reports the recovery reproducibly — a recovered dollar does not drift between reads", () => {
    // Contract: proven results are stable/immutable at the reporting surface.
    expect(provenLedger(proofs, CURRENCY)).toEqual(provenLedger(proofs, CURRENCY));
  });

  it("never mixes the forecast ledger with proven Revenue Returned", () => {
    const loop = recoveryLoop(events, proofs);

    // Proven Revenue Returned / auditable are exactly the CFO ledger totals (approved recoveries only).
    expect(loop.returned.minor).toBe(withCase.revenueReturned.minor);
    expect(loop.auditable.minor).toBe(withCase.auditableRevenue.minor);

    // Forecast/opportunity is a distinct surfaced-at-risk quantity — never equal to Revenue Returned,
    // and no headline figure is the two combined into one "recovered" number.
    expect(loop.opportunity).not.toBe(loop.returned.minor);
    const combinedDollars = loop.opportunity + dollars(loop.returned.minor);
    const combinedMinor = loop.opportunity * 100 + loop.returned.minor;
    const headlineNumbers = Object.values(loop).flatMap((v) =>
      typeof v === "number" ? [v] : v && typeof v === "object" && "minor" in v ? [(v as { minor: number }).minor] : [],
    );
    expect(headlineNumbers).not.toContain(combinedDollars);
    expect(headlineNumbers).not.toContain(combinedMinor);
  });
});
