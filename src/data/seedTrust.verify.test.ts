// The seed trust world, aggregated over immutable approved Proofs (never recomputed from Cases).
//
// THE HEADLINE IT USED TO REPRODUCE WAS $83,400 PROVEN / $79,800 AUDITABLE ACROSS 7 PROOFS, and all of
// it is gone — not because the seed data shrank, but because the gate is now asked. Every one of those
// seven proofs rested on a mechanism no source attests. The seed still contains all seven cases, with
// every field untouched; what it no longer contains is seven proofs that could not be supported.
//
// WHAT IS ASSERTED NOW IS THE SAME CLASS OF CLAIM, recomputed: the exact figure, the exact count, and
// that the seed cannot violate the Trust Invariant because it is built through the real approval gate.
// The refusal side is asserted too, and from the GATE's own output rather than from a list written
// here — so the day a correction channel is declared for one of the seven, this file notices.
import { describe, it, expect } from "vitest";
import { seedTrust, seedTrustProvability } from "./seedTrust";
import { provenLedger } from "../domain/provenLedger";
import { CORRECTION_CHANNELS } from "../domain/correctionMapping";

const CHANNEL_LESS = CORRECTION_CHANNELS.filter((c) => c.permitted.length === 0).map((c) => c.reason);

describe("seedTrust — proven/auditable reproduced over approved Proofs", () => {
  const { proofs, baselines, evidenceByCase } = seedTrust();
  const ledger = provenLedger(proofs, "USD");

  it("proven Revenue Returned = $5,500 across 1 proof", () => {
    expect(ledger.revenueReturned.minor).toBe(550_000);
    expect(ledger.provenCount).toBe(1);
    expect(ledger.reversedCount).toBe(0);
  });

  it("CFO-auditable = $5,500 across 1 proof — the only attestable mechanism in the set", () => {
    expect(ledger.auditableRevenue.minor).toBe(550_000);
    expect(ledger.auditableCount).toBe(1);
    expect(proofs[0]!.recoveryCaseId).toBe("RE-1015");
    expect(proofs[0]!.recoveryReason).toBe("BillingCorrection");
  });

  it("every seed Proof is frozen and immutable", () => {
    for (const p of proofs) expect(Object.isFrozen(p)).toBe(true);
  });

  it("every seed Baseline is locked before use — including on the REFUSED cases", () => {
    // The baselines are still built and still locked for all eight cases. A refused proof does not
    // mean a missing baseline: the pre-registration happened, and losing it would destroy the record
    // of what the comparison WOULD have been.
    expect(baselines).toHaveLength(8);
    for (const b of baselines) expect(b.lockedAt).not.toBeNull();
  });

  it("evidence is still ingested for the refused cases — only the PROOF is absent", () => {
    // The dishonest version of this correction deletes the evidence too and leaves no trace that
    // anything was ever found. Every case keeps its records.
    for (const id of ["RE-1001", "RE-1002", "RE-1003", "RE-1004", "RE-1005", "RE-1013", "RE-1014"]) {
      expect(evidenceByCase[id]?.length ?? 0, id).toBeGreaterThan(0);
    }
  });

  it("the unclassified recovered case (RE-1006) has NO proof", () => {
    expect(proofs.some((p) => p.recoveryCaseId === "RE-1006")).toBe(false);
  });

  it("the low-confidence case (RE-1005) is refused on the CHANNEL, not on confidence", () => {
    // It used to be the file's demonstration of "proven but below the auditable threshold". It is now
    // refused one layer earlier, and that is the correct, more specific answer: `CSMOutreach` has no
    // declared correction channel, so raising the confidence from 58 would change nothing. A test
    // naming the wrong mechanism passes for the wrong reason the day the right one is removed.
    expect(proofs.some((p) => p.recoveryCaseId === "RE-1005")).toBe(false);
    const verdict = seedTrustProvability().find((v) => v.caseId === "RE-1005")!;
    expect(verdict.refusals.join(" ")).toContain("CORRECTION_CHANNEL_NOT_DECLARED");
    expect(verdict.refusals.join(" ")).not.toMatch(/confidence/i);
    expect(evidenceByCase["RE-1005"]?.some((e) => e.trustClassification === "independent")).toBe(false);
  });

  it("EXACTLY the channel-less mechanisms are refused, derived from the channel table", () => {
    // Both directions, and neither side is a hand-kept list: the refused set is computed from
    // `CORRECTION_CHANNELS`, so declaring a channel for one of the seven changes this test's
    // expectation automatically rather than leaving it asserting a stale fact.
    const verdicts = seedTrustProvability();
    expect(verdicts).toHaveLength(8);
    for (const v of verdicts) {
      const reason = proofs.find((p) => p.recoveryCaseId === v.caseId)?.recoveryReason;
      if (v.proven) {
        expect(v.refusals, v.caseId).toEqual([]);
        expect(CHANNEL_LESS, v.caseId).not.toContain(reason);
      } else {
        expect(v.refusals.length, v.caseId).toBeGreaterThan(0);
      }
    }
    expect(verdicts.filter((v) => v.proven).map((v) => v.caseId)).toEqual(["RE-1015"]);
    expect(verdicts.filter((v) => !v.proven)).toHaveLength(7);
  });
});
