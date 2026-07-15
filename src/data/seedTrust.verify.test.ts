// The seed trust world must reproduce the headline story EXACTLY, aggregated over immutable
// approved Proofs (never recomputed from Cases): proven Revenue Returned = $83,400, of which
// $79,800 is CFO-auditable. It also proves the seed cannot violate the Trust Invariant (it is
// built through the real approval gate).
import { describe, it, expect } from "vitest";
import { seedTrust } from "./seedTrust";
import { provenLedger } from "../domain/provenLedger";

describe("seedTrust — proven/auditable reproduced over approved Proofs", () => {
  const { proofs, baselines, evidenceByCase } = seedTrust();
  const ledger = provenLedger(proofs, "USD");

  it("proven Revenue Returned = $83,400 across 7 proofs", () => {
    expect(ledger.revenueReturned.minor).toBe(8_340_000);
    expect(ledger.provenCount).toBe(7);
    expect(ledger.reversedCount).toBe(0);
  });

  it("CFO-auditable = $79,800 across 6 proofs (the low-confidence case is excluded)", () => {
    expect(ledger.auditableRevenue.minor).toBe(7_980_000);
    expect(ledger.auditableCount).toBe(6);
  });

  it("every seed Proof is frozen and immutable", () => {
    for (const p of proofs) expect(Object.isFrozen(p)).toBe(true);
  });

  it("every seed Baseline is locked before use", () => {
    for (const b of baselines) expect(b.lockedAt).not.toBeNull();
  });

  it("the unclassified recovered case (RE-1006) has NO proof", () => {
    expect(proofs.some((p) => p.recoveryCaseId === "RE-1006")).toBe(false);
  });

  it("the low-confidence case (RE-1005) is proven but not auditable", () => {
    const p = proofs.find((x) => x.recoveryCaseId === "RE-1005");
    expect(p).toBeDefined();
    expect(p!.confidenceUsed).toBeLessThan(p!.proofThresholdUsed);
    expect(evidenceByCase["RE-1005"]?.some((e) => e.trustClassification === "independent")).toBe(false);
  });
});
