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

export const ROLE_MAP_VERSION = "evidence-role-2026.1";

export type EvidenceRole = "outcome" | "supporting";

/** Which (sourceSystem, evidenceType) pairs count as evidence OF THE RECOVERED OUTCOME
 * (the collection fact itself) rather than merely supporting/contextual evidence. */
const OUTCOME_EVIDENCE_TYPES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  billing: ["invoice_paid", "payment_received"],
});

export function deriveEvidenceRole(sourceSystem: string, evidenceType: string): EvidenceRole {
  const outcomeTypes = OUTCOME_EVIDENCE_TYPES[sourceSystem];
  return outcomeTypes?.includes(evidenceType) ? "outcome" : "supporting";
}
