// Verification of the seed portfolio. These assertions lock the exact numbers
// the UI renders, and prove that unclassified / low-confidence events never
// inflate proven (and especially auditable) recovered revenue.
import { describe, it, expect } from "vitest";
import { seedEvents } from "./seed";
import { portfolioMetrics } from "../domain/metrics";
import { isAuditable, isCounted, validateEvent, proofUnavailable } from "../domain/invariants";
import { globalAuditFeed } from "../domain/audit";
import { bandOf } from "../domain/confidence";

const events = seedEvents();
const m = portfolioMetrics(events);

describe("seed data integrity", () => {
  it("every event is clean except the deliberately-unclassified RE-1006", () => {
    for (const e of events) {
      if (e.eventId === "RE-1006") continue;
      expect(validateEvent(e), `${e.eventId} invalid`).toEqual([]);
    }
  });

  it("validateEvent catches RE-1006 as recovered-without-reason", () => {
    const re1006 = events.find((e) => e.eventId === "RE-1006")!;
    expect(validateEvent(re1006)).toContain(
      "Recovered event has no recoveryReason (cannot be counted)",
    );
  });

  it("revenueReturned == collected - baseline for every event", () => {
    for (const e of events) {
      expect(e.revenueReturned).toBe(e.collectedAmount - e.baselineAmount);
    }
  });
});

describe("detected vs proven are disjoint and exact", () => {
  it("detected opportunity = open risk only (no recovered dollars)", () => {
    // Open: RE-1007 31000, RE-1008 12500, RE-1009 8800, RE-1010 19500
    expect(m.detectedOpportunity).toBe(71800);
    expect(m.detectedCount).toBe(4);
  });

  it("proven recovered = sum of counted returns — RE-1015 alone", () => {
    // RECOMPUTED for the owner's Option 1 decision. The old figure summed seven uplifts whose
    // mechanisms no source attests: 19200 + 7700 + 15000 + 10500 + 3600 + 16800 + 10600 = 83400.
    // Every one is now refused, and the only counted recovery is RE-1015's $5,500 billing correction.
    expect(m.recoveredRevenue).toBe(5500);
    expect(m.recoveredCount).toBe(1);
  });

  it("the refused money is REPORTED apart from both ledgers, never dropped", () => {
    // $106,500 collected across the seven refused cases. Reported as COLLECTED — never as
    // `collected − baseline`, because the delta in the same units reads as Revenue Returned.
    expect(m.proofRefusedCount).toBe(7);
    expect(m.proofRefusedCollected).toBe(106500);
    // And it is blended into nothing.
    expect(Object.values(m)).not.toContain(m.proofRefusedCollected + m.recoveredRevenue);
    expect(Object.values(m)).not.toContain(m.proofRefusedCollected + m.detectedOpportunity);
  });

  it("recovery rate counts RECOVERIES, provable or not = 8/9", () => {
    // Deliberately NOT gated on provability. Eight cases recovered money and one failed; calling the
    // seven unprovable ones non-recoveries would put this rate at 0.5 and say seven recoveries failed
    // when the cash arrived in every one. *Cannot be proven* and *did not recover* are different facts.
    expect(m.recoveryRate).toBeCloseTo(8 / 9, 5);
  });
});

describe("CFO auditable excludes unclassified and low-confidence", () => {
  it("auditable equals counted, because the one attestable mechanism carries an identity", () => {
    // RECOMPUTED. RE-1005 used to be the counted-but-not-auditable demonstration; it is now refused
    // one layer earlier, on the channel. So `unprovenRevenue` is zero — reported as a
    // demonstration-coverage consequence rather than asserted as a desirable property.
    expect(m.auditableRevenue).toBe(5500);
    expect(m.auditableCount).toBe(1);
    expect(m.unprovenRevenue).toBe(0);
    expect(m.unprovenCount).toBe(0);
  });

  it("RE-1006 (Recovered, no reason) contributes $0 to every recovered total", () => {
    const re1006 = events.find((e) => e.eventId === "RE-1006")!;
    expect(re1006.status).toBe("Recovered");
    expect(re1006.recoveryReason).toBeNull();
    expect(re1006.revenueReturned).toBe(4300); // it DID collect
    expect(isCounted(re1006)).toBe(false); // ...but is not counted
    expect(isAuditable(re1006)).toBe(false);
    // its 4300 appears in NO portfolio total, including the refused one — an unclassified recovery
    // is refused by rule 2, which is a different fact with a different remedy (classify it).
    expect(m.recoveredRevenue).not.toBe(5500 + 4300);
    expect(m.auditableRevenue).not.toBe(5500 + 4300);
    expect(m.proofRefusedCollected).not.toBe(106500 + 4300);
  });

  it("RE-1005 is refused on the CHANNEL — low confidence is no longer the binding reason", () => {
    const re1005 = events.find((e) => e.eventId === "RE-1005")!;
    expect(bandOf(re1005.confidence)).not.toBe("High");
    // Both would refuse it. The channel refusal is asserted because it is the one that FIRES, and it
    // is strictly stronger: a higher confidence would not help while no correction attests CSMOutreach.
    expect(proofUnavailable(re1005)!.code).toBe("CORRECTION_CHANNEL_NOT_DECLARED");
    expect(isCounted(re1005)).toBe(false);
    expect(isAuditable(re1005)).toBe(false);
  });

  it("auditable <= recovered, always", () => {
    expect(m.auditableRevenue).toBeLessThanOrEqual(m.recoveredRevenue);
  });
});

describe("audit trail", () => {
  it("flattens every event's entries, newest first", () => {
    const feed = globalAuditFeed(events);
    const total = events.reduce((s, e) => s + e.audit.length, 0);
    expect(feed.length).toBe(total);
    for (let i = 1; i < feed.length; i++) {
      expect(feed[i - 1]!.at >= feed[i]!.at).toBe(true);
    }
  });

  it("every event has a 'created' entry", () => {
    for (const e of events) {
      expect(e.audit.some((a) => a.type === "created"), e.eventId).toBe(true);
    }
  });
});
