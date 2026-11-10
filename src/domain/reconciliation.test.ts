// Locks the reconciliation waterfall against the seed portfolio.
//
// RECOMPUTED for the owner's Option 1 decision, not loosened. Seven cases moved out of counted
// recovery and into a NAMED bucket, so the waterfall still accounts for every gross dollar — which is
// the property this file exists to protect. Had `ProofRefused` not been added, those $83,400 would
// have fallen through to the `MissingProof` safety net and the waterfall would have told an operator
// to go and gather evidence that cannot settle the question.
import { describe, it, expect } from "vitest";
import { seedEvents } from "../data/seed";
import { reconcile } from "./reconciliation";

const r = reconcile(seedEvents());

describe("recovery reconciliation waterfall", () => {
  it("gross recovered = auditable + all exclusions — not one dollar is dropped", () => {
    // 5,500 auditable + 4,300 unclassified + 83,400 proof-refused = 93,200 gross.
    expect(r.grossRecovered).toBe(93200);
    expect(r.auditableRevenue).toBe(5500);
    expect(r.excludedTotal).toBe(87700);
    expect(r.auditableRevenue + r.excludedTotal).toBe(r.grossRecovered);
  });

  it("counted recovered matches the product metric ($5,500)", () => {
    expect(r.countedRecovered).toBe(5500);
    // Nothing is counted-but-unproven any more: every counted dollar is auditable, because the one
    // mechanism with a declared channel carries an accounting identity rather than a score. Reported
    // as a demonstration-coverage consequence, not asserted as a desirable property.
    expect(r.recoveredToAuditableGap).toBe(0);
  });

  it("exclusion buckets are disjoint and exact", () => {
    const get = (reason: string) =>
      r.buckets.find((b) => b.reason === reason)!;
    expect(get("Unclassified").amount).toBe(4300);
    expect(get("Unclassified").count).toBe(1);
    expect(get("ProofRefused").amount).toBe(83400);
    expect(get("ProofRefused").count).toBe(7);
    // RE-1005's confidence of 58 is BELOW the threshold and it is still filed as ProofRefused, which
    // is the priority working: a higher score would not help while no channel exists, so naming low
    // confidence would point the remedy at the wrong thing.
    expect(get("LowConfidence").amount).toBe(0);
    expect(get("DoubleClaim").amount).toBe(0);
    expect(get("MissingProof").amount).toBe(0);
    const sum = r.buckets.reduce((s, b) => s + b.amount, 0);
    expect(sum).toBe(r.excludedTotal);
  });

  it("a refused dollar is EXPLAINED, never silently absent", () => {
    // The property that makes the correction honest: the money the gate refuses to prove still appears
    // in the waterfall, under a reason that names the mechanism problem.
    const refused = r.buckets.find((b) => b.reason === "ProofRefused")!;
    expect(refused.label).toMatch(/no correction channel/i);
    expect(r.grossRecovered - r.countedRecovered).toBe(4300 + 83400);
  });

  it("detected opportunity stays separate from recovered dollars", () => {
    expect(r.detectedOpportunity).toBe(71800);
  });
});
