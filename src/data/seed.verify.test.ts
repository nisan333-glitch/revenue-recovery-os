// Verification of the seed portfolio. These assertions lock the exact numbers
// the UI renders, and prove that unclassified / low-confidence events never
// inflate proven (and especially auditable) recovered revenue.
import { describe, it, expect } from "vitest";
import { seedEvents } from "./seed";
import { portfolioMetrics } from "../domain/metrics";
import { isAuditable, isCounted, validateEvent } from "../domain/invariants";
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

  it("proven recovered = sum of counted returns", () => {
    // 19200 + 7700 + 15000 + 10500 + 3600 + 16800 + 10600
    expect(m.recoveredRevenue).toBe(83400);
    expect(m.recoveredCount).toBe(7);
  });

  it("recovery rate = recovered / (recovered + failed) = 7/8", () => {
    expect(m.recoveryRate).toBeCloseTo(0.875, 5);
  });
});

describe("CFO auditable excludes unclassified and low-confidence", () => {
  it("auditable total drops the medium-confidence recovery", () => {
    // 83400 counted - 3600 (RE-1005, conf 58, Medium) = 79800
    expect(m.auditableRevenue).toBe(79800);
    expect(m.auditableCount).toBe(6);
    expect(m.unprovenRevenue).toBe(3600);
    expect(m.unprovenCount).toBe(1);
  });

  it("RE-1006 (Recovered, no reason) contributes $0 to every recovered total", () => {
    const re1006 = events.find((e) => e.eventId === "RE-1006")!;
    expect(re1006.status).toBe("Recovered");
    expect(re1006.recoveryReason).toBeNull();
    expect(re1006.revenueReturned).toBe(4300); // it DID collect
    expect(isCounted(re1006)).toBe(false); // ...but is not counted
    expect(isAuditable(re1006)).toBe(false);
    // its 4300 appears in NO portfolio total
    expect(m.recoveredRevenue).not.toBe(83400 + 4300);
    expect(m.auditableRevenue).not.toBe(79800 + 4300);
  });

  it("RE-1005 (low confidence) is counted but never auditable", () => {
    const re1005 = events.find((e) => e.eventId === "RE-1005")!;
    expect(bandOf(re1005.confidence)).not.toBe("High");
    expect(isCounted(re1005)).toBe(true);
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
