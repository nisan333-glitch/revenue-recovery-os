// ProvenLedger — proven/auditable money is aggregated over IMMUTABLE approved Proof snapshots,
// never recomputed from mutable Cases or current policy. Uses only the latest effective record in
// each revision chain (no double-counting an original and its reversal/successor). Supports
// point-in-time (`asOf`) reporting for historical reproducibility.
import { type Proof, effectiveProofs, isEffectiveRecovery } from "./proof";
import { type Money, zeroMoney, addMoney } from "./money";

export interface ProvenLedger {
  currency: string;
  /** Σ revenueReturned over effective, non-reversed proofs. */
  revenueReturned: Money;
  /** CFO-grade subset: confidence ≥ the threshold that proof was approved under, positive uplift. */
  auditableRevenue: Money;
  provenCount: number;
  auditableCount: number;
  reversedCount: number;
}

/** Auditable is judged against the threshold STAMPED ON THE PROOF, not any current threshold. */
export function proofIsAuditable(p: Proof): boolean {
  return (
    isEffectiveRecovery(p) &&
    p.confidenceUsed >= p.proofThresholdUsed &&
    p.revenueReturned.minor > 0
  );
}

export function provenLedger(all: Proof[], currency: string, asOf?: string): ProvenLedger {
  // A ledger is scoped to ONE currency (money is never summed across currencies). Proofs in other
  // currencies belong to their own ledger — they are not silently folded in here.
  const effective = effectiveProofs(all, asOf).filter((p) => p.currency === currency);
  let revenueReturned = zeroMoney(currency);
  let auditableRevenue = zeroMoney(currency);
  let provenCount = 0;
  let auditableCount = 0;
  let reversedCount = 0;

  for (const p of effective) {
    if (!isEffectiveRecovery(p)) {
      reversedCount += 1;
      continue;
    }
    revenueReturned = addMoney(revenueReturned, p.revenueReturned);
    provenCount += 1;
    if (proofIsAuditable(p)) {
      auditableRevenue = addMoney(auditableRevenue, p.revenueReturned);
      auditableCount += 1;
    }
  }
  return { currency, revenueReturned, auditableRevenue, provenCount, auditableCount, reversedCount };
}
