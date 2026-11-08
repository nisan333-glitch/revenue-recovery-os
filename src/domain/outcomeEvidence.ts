// IS THE COLLECTED AMOUNT SUPPORTED BY VERIFIED FINANCIAL OUTCOME EVIDENCE? A pure predicate.
//
// THE RULE IT ENFORCES, approved as mandatory and not a recommendation:
//
//   > Every PROVEN revenue outcome requires sufficient verified financial outcome evidence, REGARDLESS
//   > of confidence tier. `confidenceUsed` may influence the Auditable classification only. Missing,
//   > contradictory or insufficient financial evidence must fail closed.
//
// WHAT CHANGED AND WHY. These checks already existed and ran only when `confidenceUsed` cleared the
// proof threshold — and `confidenceUsed` is a field on the approval request. So the submitter chose
// which evidence bar applied to their own claim, and one point lower bought a Revenue Returned figure
// minted from evidence that carried no amount at all. That was measured, not argued, on the real
// governed path: 403 at 80, 201 at 79, same unsubstantiated evidence
// (`server/services/provenGateGaps.postgres.test.ts`). A number that selects its own evidence bar is
// the beneficiary-determines-the-number shape, and the Trust Invariant's rule 10 is
// "claimed revenue is not proven revenue".
//
// CONFIDENCE STILL DOES ITS ONE LEGITIMATE JOB. `isAuditable` in `invariants.ts` reads
// `confidence >= PROOF_THRESHOLD`, so the Auditable *subset of Revenue Returned* is still decided by
// confidence. What confidence no longer decides is whether the money had to be evidenced at all.
//
// MISSING IS NOT ZERO, AND THIS IS THE SHARPEST OF THE SIX REFUSALS. The previous arithmetic summed
// `e.amountMinor ?? 0`, so an outcome record with NO amount contributed a silent zero and a claim could
// clear a sum it never met. An unstated amount is now `OUTCOME_EVIDENCE_AMOUNT_NOT_STATED` and refuses.
//
// PURE: no clock, no I/O, no randomness, nothing that can act.

export type OutcomeEvidenceCode =
  /** Nothing in the cited set is independent of the beneficiary. */
  | "NO_INDEPENDENT_EVIDENCE"
  /** Nothing cited is evidence OF THE COLLECTION — only supporting or contextual material. */
  | "NO_OUTCOME_EVIDENCE"
  /** An outcome item is unverified, beneficiary-controlled, or not classified independent. */
  | "OUTCOME_EVIDENCE_NOT_AUTHENTICATED"
  /** An outcome item is denominated in a different currency from the proof. */
  | "OUTCOME_EVIDENCE_CURRENCY_MISMATCH"
  /** An outcome item states no amount, so it can substantiate nothing. NOT a zero. */
  | "OUTCOME_EVIDENCE_AMOUNT_NOT_STATED"
  /** The outcome amounts do not reach the collected amount claimed. */
  | "OUTCOME_EVIDENCE_INSUFFICIENT"
  /** The claimed collected amount is not a whole, non-negative minor amount. */
  | "COLLECTED_AMOUNT_NOT_WELL_FORMED";

export type OutcomeEvidenceVerdict =
  | { readonly sufficient: true; readonly outcomeSumMinor: number }
  | { readonly sufficient: false; readonly code: OutcomeEvidenceCode; readonly reason: string };

const deny = (code: OutcomeEvidenceCode, reason: string): OutcomeEvidenceVerdict =>
  Object.freeze({ sufficient: false as const, code, reason });

/**
 * One cited evidence record, reduced to the facts this decision needs.
 *
 * `sourceVerified` is whether a source attestation was recorded by the server — never a caller's claim
 * about its own evidence. `trustClassification` is derived at ingestion, never asserted.
 */
export interface OutcomeEvidenceItem {
  readonly evidenceId: string;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly sourceVerified: boolean;
  readonly beneficiaryControl: boolean;
  readonly trustClassification: string;
}

export interface OutcomeEvidenceInput {
  readonly claimedCollectedMinor: number;
  readonly currency: string;
  /** The cited records whose derived role is `outcome`. */
  readonly outcomeItems: readonly OutcomeEvidenceItem[];
  /** Whether ANY cited record — outcome or supporting — is independent of the beneficiary. */
  readonly anyIndependent: boolean;
}

/**
 * Decide sufficiency.
 *
 * The denials are ordered from the most structural to the most arithmetic, so the reason a caller gets
 * is the one that tells them what to do: "you cited nothing independent" sends them somewhere different
 * from "your outcome records total less than you claimed".
 */
export function financialOutcomeSufficiency(input: OutcomeEvidenceInput): OutcomeEvidenceVerdict {
  if (!Number.isSafeInteger(input.claimedCollectedMinor) || input.claimedCollectedMinor < 0) {
    return deny(
      "COLLECTED_AMOUNT_NOT_WELL_FORMED",
      `the claimed collected amount ${String(input.claimedCollectedMinor)} is not a whole, non-negative minor amount`,
    );
  }

  if (!input.anyIndependent) {
    return deny(
      "NO_INDEPENDENT_EVIDENCE",
      "a proven claim requires at least one independent evidence reference; operator notes alone are insufficient",
    );
  }

  if (input.outcomeItems.length === 0) {
    return deny(
      "NO_OUTCOME_EVIDENCE",
      "a proven claim requires at least one outcome-role evidence reference — evidence OF THE COLLECTION, " +
        "not merely evidence about the case",
    );
  }

  const unauthenticated = input.outcomeItems.filter(
    (e) => !e.sourceVerified || e.beneficiaryControl || e.trustClassification !== "independent",
  );
  if (unauthenticated.length > 0) {
    return deny(
      "OUTCOME_EVIDENCE_NOT_AUTHENTICATED",
      `${unauthenticated.length} outcome evidence reference(s) are unverified, beneficiary-controlled, or not ` +
        "classified independent; a beneficiary may not substantiate their own collection",
    );
  }

  // MISSING IS NOT ZERO. See the header: coalescing an unstated amount to 0 let a claim clear a sum it
  // never met, because the absent contribution was invisible in the arithmetic.
  //
  // AND IT IS CHECKED BEFORE THE CURRENCY, which is not cosmetic. The evidence endpoint PAIRS amount and
  // currency — one without the other is refused at ingestion — so a record stating no amount necessarily
  // states no currency. Checking the currency first therefore made this refusal nearly unreachable and
  // answered with "not denominated in USD" when the real problem is that the record states no money at
  // all. The more specific, more informative refusal wins, which is the ordering rule `provenEligibility`
  // already follows. Found by a test whose fixture supplied exactly that record.
  const unstated = input.outcomeItems.filter((e) => e.amountMinor === null || !Number.isSafeInteger(e.amountMinor));
  if (unstated.length > 0) {
    return deny(
      "OUTCOME_EVIDENCE_AMOUNT_NOT_STATED",
      `${unstated.length} outcome evidence reference(s) state no whole amount, so they substantiate nothing — ` +
        "an unstated amount is NOT COMPUTED, never zero",
    );
  }

  // Reached only once every item states an amount, so a mismatch here is a genuine currency disagreement
  // rather than the absence of any monetary statement at all.
  const wrongCurrency = input.outcomeItems.filter((e) => e.currency !== input.currency);
  if (wrongCurrency.length > 0) {
    return deny(
      "OUTCOME_EVIDENCE_CURRENCY_MISMATCH",
      `${wrongCurrency.length} outcome evidence reference(s) are not denominated in ${input.currency}; ` +
        "amounts in different currencies are never summed",
    );
  }

  const outcomeSumMinor = input.outcomeItems.reduce((sum, e) => sum + (e.amountMinor as number), 0);
  if (!Number.isSafeInteger(outcomeSumMinor)) {
    return deny(
      "OUTCOME_EVIDENCE_AMOUNT_NOT_STATED",
      "the outcome evidence amounts do not sum to a whole minor amount",
    );
  }
  if (outcomeSumMinor < input.claimedCollectedMinor) {
    return deny(
      "OUTCOME_EVIDENCE_INSUFFICIENT",
      `outcome evidence totals ${outcomeSumMinor} but the claim states ${input.claimedCollectedMinor} collected; ` +
        "the evidence does not substantiate the amount claimed",
    );
  }

  return Object.freeze({ sufficient: true as const, outcomeSumMinor });
}
