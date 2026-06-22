import { describe, it, expect } from "vitest";
import type { RecoveryEvent } from "./types";
import {
  computeRevenueReturned,
  withDerivedReturn,
  isCounted,
  isAuditable,
  validateEvent,
} from "./invariants";
import { portfolioMetrics } from "./metrics";
import { PROOF_THRESHOLD } from "./confidence";

function ev(partial: Partial<RecoveryEvent>): RecoveryEvent {
  const base: RecoveryEvent = {
    eventId: "e1",
    customer: "Acme",
    funnelStage: "Renewal",
    leakageType: "FailedPayment",
    recoveryReason: "DunningRetry",
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
    const withReason = ev({ recoveryReason: "DunningRetry" });
    expect(isCounted(withReason)).toBe(true);
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
