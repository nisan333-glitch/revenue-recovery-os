// Locks the reconciliation waterfall against the seed portfolio.
import { describe, it, expect } from "vitest";
import { seedEvents } from "../data/seed";
import { reconcile } from "./reconciliation";

const r = reconcile(seedEvents());

describe("recovery reconciliation waterfall", () => {
  it("gross recovered = auditable + all exclusions", () => {
    // 79,800 auditable + 4,300 unclassified + 3,600 low confidence
    expect(r.grossRecovered).toBe(87700);
    expect(r.auditableRevenue).toBe(79800);
    expect(r.excludedTotal).toBe(7900);
    expect(r.auditableRevenue + r.excludedTotal).toBe(r.grossRecovered);
  });

  it("counted recovered matches the product metric ($83,400)", () => {
    expect(r.countedRecovered).toBe(83400);
    expect(r.recoveredToAuditableGap).toBe(3600);
  });

  it("exclusion buckets are disjoint and exact", () => {
    const get = (reason: string) =>
      r.buckets.find((b) => b.reason === reason)!;
    expect(get("Unclassified").amount).toBe(4300);
    expect(get("Unclassified").count).toBe(1);
    expect(get("LowConfidence").amount).toBe(3600);
    expect(get("LowConfidence").count).toBe(1);
    expect(get("DoubleClaim").amount).toBe(0);
    expect(get("MissingProof").amount).toBe(0);
    const sum = r.buckets.reduce((s, b) => s + b.amount, 0);
    expect(sum).toBe(r.excludedTotal);
  });

  it("detected opportunity stays separate from recovered dollars", () => {
    expect(r.detectedOpportunity).toBe(71800);
  });
});
