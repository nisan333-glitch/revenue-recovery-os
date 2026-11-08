// EP-8.1 · Server-only evidence-role derivation.
//
// `evidenceRole` ("outcome" | "supporting") is NOT a Foundation/domain concept — it is a
// small, additive, server-side classification layered beside the domain's existing
// `trustClassification` (independent | beneficiary_controlled, src/domain/evidence.ts).
// It is DERIVED from (sourceSystem, evidenceType) against a versioned allowlist — never
// accepted as a client assertion (mirrors the domain's own `makeEvidence` pattern: the
// caller's opinion of what an item "is" never survives on its own).
//
// ROLE_MAP_VERSION is stamped onto every ingested EvidenceRecord so a future change to
// this mapping can never reinterpret historical evidence — the classification a record
// received is frozen at ingestion time, exactly like a policy version stamped on a Proof.

// BUMPED for the `correction` role added by G1. The version is stamped on every ingested record, so
// historical rows keep the role they were classified with: a record ingested as `supporting` under
// 2026.1 stays `supporting` even where the same (sourceSystem, evidenceType) pair would now derive
// `correction`. That is exactly what this constant is for, and it is why adding a role reinterprets
// nothing — the classification is frozen at ingestion, like a policy version stamped on a Proof.
export const ROLE_MAP_VERSION = "evidence-role-2026.2";

export type EvidenceRole = "outcome" | "correction" | "supporting";

/** Which (sourceSystem, evidenceType) pairs count as evidence OF THE RECOVERED OUTCOME
 * (the collection fact itself) rather than merely supporting/contextual evidence. */
const OUTCOME_EVIDENCE_TYPES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  billing: ["invoice_paid", "payment_received"],
});

/**
 * G1 · Which pairs are evidence that THE CORRECTION WAS EXECUTED — the billing system's own statement
 * that it raised the corrective charge — rather than evidence of the money arriving afterwards.
 *
 * A CREDIT NOTE IS DELIBERATELY ABSENT. It corrects billing in the OPPOSITE direction: money the company
 * may owe back. Letting it substantiate an under-billing recovery would accept a refund as evidence that
 * a shortfall was fixed, which is the reconciliation sign convention inverted — `residual = expected −
 * observed`, where negative is a liability signal and never exposure.
 */
const CORRECTION_EVIDENCE_TYPES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  billing: ["corrective_invoice_issued", "billing_corrected"],
});

export function deriveEvidenceRole(sourceSystem: string, evidenceType: string): EvidenceRole {
  const outcomeTypes = OUTCOME_EVIDENCE_TYPES[sourceSystem];
  if (outcomeTypes?.includes(evidenceType)) return "outcome";
  const correctionTypes = CORRECTION_EVIDENCE_TYPES[sourceSystem];
  if (correctionTypes?.includes(evidenceType)) return "correction";
  return "supporting";
}
