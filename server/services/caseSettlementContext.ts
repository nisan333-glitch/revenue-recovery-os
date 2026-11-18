// G9 · THE SERVER-HELD FACTS STAGE 8 NEEDS, AND THE ONE THAT DOES NOT EXIST YET.
//
// WHY THIS FILE EXISTS. Stage 8's decision compares a bank's attestation against the case: the
// corrective invoice it settles, the payer it names, and whether the money cleared after the correction
// was raised. Every one of those must come from a RECORD, never from the request — a caller who could
// state the payer the attestation must match would simply state whatever the attestation says, and the
// check would compare the caller against himself.
//
// THREE OF THE FOUR ARE DERIVABLE TODAY. The boundary is on the case root; the corrective invoice
// reference and the instant it was raised come from the correction evidence the server itself chose
// (`executedCorrection` picks the earliest qualifying one — the request cannot nominate it).
//
// THE FOURTH IS DEPENDENCY 1 FROM STAGE 8's OWN HEADER, STILL OPEN, AND MEASURED RATHER THAN ASSUMED:
//
//   A case carries a pseudonymous `sourceRef` derived under NH's own HMAC key. A bank names the payer
//   in the bank's own terms. `prisma/schema.prisma` holds NO external payer reference on any model —
//   not on the case root, not on the candidate, not on an evidence record — so nothing maps one to the
//   other, and NH must not invent the mapping: that would be authoring the identity it is meant to
//   read.
//
// SO THE ABSENCE IS IN THE TYPE, not a blank string. `{ available: false }` cannot be mistaken for a
// payer reference that happens to be empty, and a caller cannot accidentally pass `""` into a
// comparison that would then succeed against an attestation whose payer field is also blank. The same
// shape `ArrivalEnumeration` uses, for the same reason: success reported having checked nothing is the
// one outcome worse than refusing.
import { getEvidenceForCase } from "../persistence/evidenceStore";
import { getRecoveryCase } from "../persistence/recoveryCaseStore";
import { executedCorrection } from "../../src/domain/executedCorrection";

/** Why the case cannot supply what stage 8 must compare against. NAMED, never collapsed into a 403. */
export type CaseSettlementContextRefusal =
  /** The case has no governed root, so there is no boundary and no recorded identity at all. */
  | "SETTLEMENT_CASE_ROOT_MISSING"
  /** No server-chosen executed correction, so there is no corrective invoice to match. */
  | "SETTLEMENT_CASE_CORRECTION_MISSING"
  /**
   * DEPENDENCY 1. The case holds no external payer reference, only NH's own pseudonym.
   *
   * This is the refusal that fires today on every case. It is not a defect in this module: it is the
   * persisted model not carrying the fact, and refusing is the only answer that neither invents the
   * mapping nor lets the request supply it.
   */
  | "SETTLEMENT_CASE_PAYER_NOT_RECORDED";

export type CaseSettlementContext =
  | {
      readonly available: true;
      readonly boundaryId: string;
      /** The billing system's own id for the corrective invoice, from the chosen correction record. */
      readonly caseCorrectiveInvoiceRef: string;
      /** The payer as an EXTERNAL system holds it. Never a pseudonym and never a request field. */
      readonly casePayerExternalRef: string;
      /** When the correction was recorded by the server's clock. */
      readonly correctionRaisedAt: string;
    }
  | {
      readonly available: false;
      readonly code: CaseSettlementContextRefusal;
      readonly detail: string;
    };

const unavailable = (
  code: CaseSettlementContextRefusal,
  detail: string,
): CaseSettlementContext => Object.freeze({ available: false as const, code, detail });

/**
 * How a case's external payer reference would be obtained, once one is recorded.
 *
 * A PORT WITH EXACTLY ONE PRODUCTION IMPLEMENTATION, AND IT RETURNS `null`. Declared as a seam rather
 * than inlined so the rest of this path can be exercised end to end against a real database without
 * anybody pretending the fact exists — and so the day a governed column lands, one function changes.
 *
 * It takes the CASE ROOT, not a request: whatever supplies this must be reading a record.
 */
export interface CasePayerReferenceSource {
  payerExternalRefFor(root: { readonly recoveryCaseId: string; readonly boundaryId: string }):
  Promise<string | null>;
}

/** Why an attested payer reference could not be established from a case's evidence. */
export type AttestedPayerProblem = "PAYER_REFERENCES_DISAGREE";

/**
 * G10 · THE PRODUCTION SOURCE: the payer a SOURCE SYSTEM signed for, read from this case's evidence.
 *
 * WHY THIS ORIGIN AND NOT ANY OTHER. Three candidates were considered and two are refused outright.
 * The request cannot supply it — the caller is the beneficiary of a larger number and would state
 * whatever the attestation says. The detector cannot supply it — its raw `payerRef` comes from the
 * CUSTOMER'S OWN EXTRACT, which is the same party one step removed, and it is pseudonymised under NH's
 * HMAC key before anything is stored. What remains is a claim SIGNED by the billing or ERP system
 * under a key NH holds only the public half of and the customer's team does not hold at all.
 *
 * SO STAGE 8's CHECK BECOMES A COMPARISON OF TWO INDEPENDENT INSTITUTIONAL STATEMENTS — billing's and
 * the bank's — rather than an attestation against a string NH was handed. That is the shape the Trust
 * Invariant asks for, and it is the reason this is a closure of dependency 1 rather than a workaround.
 *
 * IT READS ONLY VERIFIED RECORDS, structurally. `attestedPayerExternalRef` lives INSIDE
 * `sourceVerification`, which exists only after a signature verified, so there is no stored shape in
 * which an unattested payer could be read back. An unsigned evidence record contributes nothing.
 *
 * DISAGREEMENT IS A REFUSAL, NEVER A CHOICE. Two signed records naming different payers is a
 * contradiction about who this case concerns; picking one — the earliest, the latest, the correction's
 * — would be NH deciding an identity question on an arbitrary rule. It returns `null`, and the
 * approval refuses.
 */
export function attestedPayerReference(
  onProblem?: (problem: AttestedPayerProblem, detail: string) => void,
): CasePayerReferenceSource {
  return {
    async payerExternalRefFor(root) {
      const evidence = await getEvidenceForCase(root.recoveryCaseId);
      const refs = new Set<string>();
      for (const item of evidence) {
        const v = item.sourceVerification;
        if (v === null || typeof v !== "object") continue;
        const ref = (v as { attestedPayerExternalRef?: unknown }).attestedPayerExternalRef;
        if (typeof ref === "string" && ref.trim().length > 0) refs.add(ref);
      }
      if (refs.size === 0) return null;
      if (refs.size > 1) {
        // The COUNT is reported, never the values: a refusal reaches an operator, and payer
        // references are customer identifiers — the codes-only rule the extract faults already follow.
        onProblem?.(
          "PAYER_REFERENCES_DISAGREE",
          `${refs.size} source-attested payer references disagree for this case; which payer the case ` +
            "concerns is an identity question, and choosing one of them on an arbitrary rule would be " +
            "NH deciding it",
        );
        return null;
      }
      return [...refs][0]!;
    },
  };
}

/**
 * Resolve what stage 8 must compare an attestation against, from records only.
 *
 * ORDER IS DELIBERATE: root, then correction, then payer. Each refusal is about a different missing
 * fact, and an operator told "no payer recorded" when the real problem is that the case has no root
 * would go looking in the wrong place.
 */
export async function caseSettlementContext(
  recoveryCaseId: string,
  payerSource: CasePayerReferenceSource = attestedPayerReference(),
): Promise<CaseSettlementContext> {
  const root = await getRecoveryCase(recoveryCaseId);
  if (root === null) {
    return unavailable(
      "SETTLEMENT_CASE_ROOT_MISSING",
      "this case has no governed root, so it has no recorded boundary or identity to compare against",
    );
  }

  const caseEvidence = await getEvidenceForCase(recoveryCaseId);
  const outcomeIngestedAt = caseEvidence
    .filter((e) => e.evidenceRole === "outcome")
    .map((e) => e.ingestedAt)
    .sort()[0] ?? null;

  // THE SAME CHOICE `approve` ALREADY MADE, through the same pure function rather than a second
  // implementation of "which correction counts" — two answers to that question could disagree, and the
  // one this module reported would be the one the attestation was matched against.
  const correction = executedCorrection({
    earliestOutcomeIngestedAt: outcomeIngestedAt,
    corrections: caseEvidence
      .filter((e) => e.evidenceRole === "correction")
      .map((e) => ({
        evidenceId: e.evidenceId,
        sourceSystem: e.sourceSystem,
        sourceRecordId: e.sourceRecordId,
        ingestedAt: e.ingestedAt,
        sourceVerified: !!e.sourceVerification,
        beneficiaryControl: !e.sourceVerification || e.beneficiaryControl,
        trustClassification: e.sourceVerification ? e.trustClassification : "beneficiary_controlled",
      })),
  });
  if (!correction.established) {
    return unavailable(
      "SETTLEMENT_CASE_CORRECTION_MISSING",
      `no executed correction is established for this case (${correction.code}), so there is no ` +
        "corrective invoice reference an attestation could be matched against",
    );
  }

  const payer = await payerSource.payerExternalRefFor(root);
  if (payer === null || payer.trim().length === 0) {
    return unavailable(
      "SETTLEMENT_CASE_PAYER_NOT_RECORDED",
      "no SOURCE-ATTESTED external payer reference is recorded for this case. Stage 8 compares the " +
        "bank's attestation against the payer this case concerns, and the only acceptable origin for " +
        "that value is a claim a source system SIGNED — not the request, which is the beneficiary, and " +
        "not the detector, whose payer comes from the customer's own extract. Ingest signed evidence " +
        "carrying `payerExternalRef`, or the settlement cannot support a proof; that is the correct " +
        "answer rather than a missing feature",
    );
  }

  // WHEN IT WAS RAISED, taken from the record the SERVER chose rather than re-picking one. The verdict
  // names `correctionEvidenceId`; the instant comes from that row's server-stamped `ingestedAt`, so
  // there is one answer to "which correction" and this module reads it rather than deciding again.
  const chosen = caseEvidence.find((e) => e.evidenceId === correction.correctionEvidenceId);
  if (chosen === undefined) {
    // Unreachable through `executedCorrection`, which only ever returns an id it was given — asserted
    // rather than assumed, because a silent `undefined` here would become an invalid timestamp in a
    // temporal comparison that decides whether money could be the correction's result.
    throw new Error(
      `settlement context: the established correction ${correction.correctionEvidenceId} is not among ` +
        "this case's evidence records; refusing to compare an attestation against an instant we cannot read",
    );
  }

  return Object.freeze({
    available: true as const,
    boundaryId: root.boundaryId,
    caseCorrectiveInvoiceRef: correction.correctionSourceRecordId,
    casePayerExternalRef: payer,
    correctionRaisedAt: chosen.ingestedAt,
  });
}
