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

export function makeEvidence(input: Omit<Evidence, "beneficiaryControl"> & {
  beneficiaryControl?: boolean;
}): Evidence {
  return Object.freeze({
    ...input,
    // independent evidence is, by definition, not beneficiary-controlled
    beneficiaryControl:
      input.beneficiaryControl ?? input.trustClassification === "beneficiary_controlled",
  });
}

/** At least one independent, non-beneficiary-controlled evidence reference exists. */
export function hasIndependentEvidence(refs: Evidence[]): boolean {
  return refs.some((e) => e.trustClassification === "independent" && !e.beneficiaryControl);
}
