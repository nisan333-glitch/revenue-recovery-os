// G1 · WAS THE CORRECTION ACTUALLY EXECUTED, AND IS IT AUDITABLY RELATED TO THE MONEY? A pure predicate.
//
// THE RULE IT ENFORCES, approved as mandatory:
//
//   > PROVEN must require a verified executed-correction record, verified financial collection evidence,
//   > and an auditable relationship between the correction and the financial outcome.
//
// WHAT WAS WRONG BEFORE. A case reached PROVEN with no `Intervene` event ever recorded. The intervention
// was loaded and used for exactly one purpose — the ordering of the baseline lock — and that check passes
// on absence, so the "Fix" leg of *Identify → Fix → Prove* had no mechanism behind it at approval time.
// And `BillingCorrection` is a RECOVERY REASON, not an executed action: it establishes that the claim is
// ABOUT a billing correction and never that one occurred. Measured on the real governed path: 201, with
// Revenue Returned minted, on a case whose authority ledger contained no `Intervene` row at all.
//
// WHAT A VERIFIED EXECUTED CORRECTION IS, and why it is the only mechanism available. NH has no billing
// integration, so the one thing that can attest that a corrective charge was raised is the billing system
// itself, through the SAME source-attestation channel that already carries outcome evidence: a signed
// record whose key the source holds and the submitter does not. An operator's assertion that they fixed
// it is the beneficiary describing their own work.
//
// THE RELATIONSHIP, AND EXACTLY WHAT IT DOES NOT ESTABLISH. Three facts are available from server-stamped
// state and all three are required:
//
//   1. SAME CASE — and leg A has already refused unless that case's identity covers exactly ONE
//      reconciliation unit, so correction and collection concern the same obligation.
//   2. PRECEDENCE — the correction was ingested before the earliest outcome record. A collection observed
//      before the correction cannot have been caused by it.
//   3. AUTHENTICATION — the correction is source-verified, independent and not beneficiary-controlled.
//
// > **Shared obligation plus precedence is NECESSARY evidence of the relationship and never PROOF of
// > causation.** The correction may precede the collection and be unrelated to it; nothing in contract
// > 2.0.0 links a payment to the charge it settles. So `causationEstablished` is typed as the literal
// > `false` and no code path can produce anything else — the same device as `independentlyAttested: false`
// > on the attestation verdict. What would establish causation is a billing-side obligation reference on
// > the settlement, which is already the identified next source fact.
//
// PURE: no clock, no I/O, no randomness. Every time value arrives as an argument.

export type ExecutedCorrectionCode =
  /** No correction-role evidence exists for this case at all. Nothing was recorded as fixed. */
  | "NO_EXECUTED_CORRECTION_RECORD"
  /** A correction record exists but is unverified, beneficiary-controlled, or not independent. */
  | "CORRECTION_NOT_AUTHENTICATED"
  /** Every authenticated correction was recorded AFTER the money. It cannot have caused it. */
  | "CORRECTION_NOT_BEFORE_OUTCOME"
  /**
   * A correction shares the collection's recorded instant, so which came first is not establishable.
   *
   * KEPT DISTINCT FROM `CORRECTION_NOT_BEFORE_OUTCOME` deliberately. "It came after" is a finding; "we
   * cannot tell" is an absence of one, and collapsing them would report a tie as evidence of lateness.
   * This is the event-ordering lesson already on record: an order a clock alone cannot separate is not an
   * order, and `timestamp(3)` can place two writes in the same millisecond.
   */
  | "CORRECTION_ORDER_NOT_ESTABLISHABLE"
  /** The outcome's own time is unknown, so precedence can be neither shown nor excluded. */
  | "CORRECTION_OUTCOME_TIME_NOT_ESTABLISHABLE";

/** One correction-role record, reduced to the facts this decision needs. All server-derived. */
export interface CorrectionRecordFacts {
  readonly evidenceId: string;
  readonly sourceSystem: string;
  readonly sourceRecordId: string;
  /** The server's own ingestion timestamp. A claimed `observedAt` can never establish ordering. */
  readonly ingestedAt: string;
  readonly sourceVerified: boolean;
  readonly beneficiaryControl: boolean;
  readonly trustClassification: string;
}

export type ExecutedCorrectionVerdict =
  | {
      readonly established: true;
      readonly correctionEvidenceId: string;
      readonly correctionSourceRecordId: string;
      /** What the three facts together support. Never more than this. */
      readonly relationship: "SAME_OBLIGATION_AND_CORRECTION_PRECEDES_COLLECTION";
      /**
       * Typed as the literal `false`. The type cannot express an established causal link, so no code path
       * can claim one. See the header.
       */
      readonly causationEstablished: false;
    }
  | { readonly established: false; readonly code: ExecutedCorrectionCode; readonly reason: string };

const deny = (code: ExecutedCorrectionCode, reason: string): ExecutedCorrectionVerdict =>
  Object.freeze({ established: false as const, code, reason });

export interface ExecutedCorrectionInput {
  /** Every correction-role record for THIS case, read from the record and never cited by the request. */
  readonly corrections: readonly CorrectionRecordFacts[];
  /** The server-stamped ingestion time of the earliest outcome-role record, or null if there is none. */
  readonly earliestOutcomeIngestedAt: string | null;
}

export function executedCorrection(input: ExecutedCorrectionInput): ExecutedCorrectionVerdict {
  if (input.corrections.length === 0) {
    return deny(
      "NO_EXECUTED_CORRECTION_RECORD",
      "no verified executed-correction record exists for this case, so nothing establishes that the billing " +
        "was actually corrected — a recovery reason names a mechanism, it does not evidence one",
    );
  }

  const authenticated = input.corrections.filter(
    (c) => c.sourceVerified && !c.beneficiaryControl && c.trustClassification === "independent",
  );
  if (authenticated.length === 0) {
    return deny(
      "CORRECTION_NOT_AUTHENTICATED",
      `${input.corrections.length} correction record(s) exist but none is source-verified, independent and ` +
        "free of beneficiary control — a beneficiary may not attest to having corrected their own billing",
    );
  }

  // NOT ESTABLISHABLE IS NOT SATISFIED. If the outcome has no time, precedence can be neither shown nor
  // excluded; G2 already refuses a claim with no outcome evidence, so this is defence in depth and it
  // refuses rather than passing on the assumption that the other gate ran.
  if (input.earliestOutcomeIngestedAt === null) {
    return deny(
      "CORRECTION_OUTCOME_TIME_NOT_ESTABLISHABLE",
      "the collection's own recorded time is unknown, so the correction cannot be shown to precede it",
    );
  }
  const outcomeAt = Date.parse(input.earliestOutcomeIngestedAt);
  if (Number.isNaN(outcomeAt)) {
    return deny(
      "CORRECTION_OUTCOME_TIME_NOT_ESTABLISHABLE",
      "the collection's recorded time is not a readable instant, so precedence cannot be established",
    );
  }

  // STRICTLY BEFORE. Equal timestamps do not establish that one preceded the other — `timestamp(3)` can
  // place two writes in the same millisecond, which is the event-ordering lesson already on record: an
  // order that a clock alone cannot separate is not an order.
  const parsed = authenticated.map((c) => ({ c, at: Date.parse(c.ingestedAt) }));
  const unreadable = parsed.filter((x) => Number.isNaN(x.at));
  const preceding = parsed
    .filter((x) => !Number.isNaN(x.at) && x.at < outcomeAt)
    .map((x) => x.c)
    .sort((a, b) => (a.ingestedAt < b.ingestedAt ? -1 : a.ingestedAt > b.ingestedAt ? 1 : 0));

  if (preceding.length === 0) {
    const tied = parsed.filter((x) => x.at === outcomeAt);
    if (tied.length > 0 || unreadable.length > 0) {
      return deny(
        "CORRECTION_ORDER_NOT_ESTABLISHABLE",
        `${tied.length + unreadable.length} authenticated correction record(s) share the collection's ` +
          `recorded instant (${input.earliestOutcomeIngestedAt}) or carry no readable one, so which came ` +
          "first is not establishable — a tie is not evidence that the correction came after",
      );
    }
    return deny(
      "CORRECTION_NOT_BEFORE_OUTCOME",
      `every authenticated correction record was ingested AFTER the collection ` +
        `(${input.earliestOutcomeIngestedAt}), so none of them can have caused it`,
    );
  }

  const first = preceding[0]!;
  return Object.freeze({
    established: true as const,
    correctionEvidenceId: first.evidenceId,
    correctionSourceRecordId: first.sourceRecordId,
    relationship: "SAME_OBLIGATION_AND_CORRECTION_PRECEDES_COLLECTION" as const,
    causationEstablished: false as const,
  });
}
