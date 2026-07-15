// Evidence — Trust Invariant #1/#3: Auditable Proof requires at least one evidence reference
// that is INDEPENDENT of the beneficiary's unilateral control. Operator-entered notes are
// beneficiary-controlled and can never, alone, produce Auditable status. Prototype uses explicit
// evidence records / fixtures (no external integrations yet).

export type TrustClassification = "independent" | "beneficiary_controlled";

export interface Evidence {
  readonly evidenceId: string;
  readonly evidenceType: string; // e.g. "invoice_paid", "activation_event", "operator_note"
  readonly sourceSystem: string; // e.g. "billing", "product", "manual"
  readonly sourceRecordId: string;
  readonly observedAt: string; // when the fact occurred (business time)
  readonly ingestedAt: string; // system-recorded arrival time
  readonly trustClassification: TrustClassification;
  readonly suppliedBy: string;
  /** true = the beneficiary can unilaterally create/alter this evidence (e.g. a manual note). */
  readonly beneficiaryControl: boolean;
}

/**
 * Source systems whose records the beneficiary cannot unilaterally fabricate or alter — the only
 * ones that can back an INDEPENDENT evidence classification. A manual/operator source can never be
 * independent, so a beneficiary cannot self-attest their way to Auditable.
 *
 * PROTOTYPE NOTE: in the client-only prototype these are SIMULATED stand-ins for real integrations;
 * true, verifiable independence requires server-side ingestion from these systems (the deferred M1
 * boundary). The allow-list makes independence a function of a claimed source rather than a free
 * operator toggle — a real reduction of the gap, not full enforcement.
 */
export const INDEPENDENT_SOURCE_SYSTEMS: readonly string[] = ["billing", "product", "crm", "external"];

export function isIndependentSource(sourceSystem: string): boolean {
  return INDEPENDENT_SOURCE_SYSTEMS.includes(sourceSystem);
}

export function makeEvidence(input: Omit<Evidence, "beneficiaryControl">): Evidence {
  // Independence is DERIVED from the (claimed) source system — never taken on faith from the
  // caller. A classification of "independent" only survives if the source is on the trusted
  // allow-list; otherwise it is forced to beneficiary-controlled.
  const independent =
    input.trustClassification === "independent" && isIndependentSource(input.sourceSystem);
  return Object.freeze({
    ...input,
    trustClassification: independent ? "independent" : "beneficiary_controlled",
    beneficiaryControl: !independent,
  });
}

/** At least one independent, non-beneficiary-controlled evidence reference exists. */
export function hasIndependentEvidence(refs: Evidence[]): boolean {
  return refs.some((e) => e.trustClassification === "independent" && !e.beneficiaryControl);
}
