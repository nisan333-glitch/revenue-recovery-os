// What a Recovery Case's identity actually COVERS — one account, or one obligation.
//
// WHY THIS EXISTS. Candidate identity is `digest([boundaryId, recoveryType, sourceRef])` and `sourceRef`
// is a pseudonym of the ACCOUNT. The obligation is not in the key. So two genuinely different leaks for
// one customer are one candidate and one case, and until now nothing on any read surface said so: a merged
// exposure figure and a single-obligation figure render identically, to the cent.
//
// This module does not fix that. It makes a case **unreadable as a per-obligation claim**, which is a
// different and smaller thing, and the only one available without a schema migration.
//
// THREE STATES, AND THEY STAY DISTINGUISHABLE — the same reason `leakInstanceIdentityStatus` and
// `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` are named apart. Collapsing them would hide which half of the
// answer a reader is holding:
//
//   • `ACCOUNT_GRAINED_POTENTIAL`         — the key cannot tell one obligation from the next, so a merge
//                                            is POSSIBLE. A property of the identity rule, always true
//                                            while obligation identity is unavailable.
//   • `ABSORBED_OBSERVATIONS_RECORDED`    — stored evidence shows a second observation cleared the
//                                            admission gate and was folded into this candidate.
//   • `OBLIGATION_UNIQUENESS_GUARANTEED`  — UNREACHABLE. See below.
//
// THE THIRD STATE IS THE REFUSAL, AND IT IS STRUCTURAL. A consumer asking "is this case one obligation?"
// must not get an optimistic default. `deriveCaseIdentityGrain` can only return it when obligation
// identity is establishable, which `OBLIGATION_IDENTITY_FIELDS = []` makes false everywhere today — so no
// code path reaches it, and a mutation that tries is a failing test rather than a review comment. This is
// the `UNAVAILABLE_BILLING_SIDE_UNKEYED` pattern: a value that cannot be reached is a stronger statement
// than a value that is merely not set.
//
// AND "NOT CHECKED" IS NOT "NONE". `absorbedObservations` is a discriminated union, not a number, because
// a surface that did not run the absorption query must not report zero. Rendering "no absorptions" when
// nobody looked would assert work that never happened — the `$0.00`-for-an-absent-proof mistake, one lane
// over. A reader is told *we did not look* in as many words.
//
// THE REFUSAL SENTENCE IS SUPPLIED, NEVER AUTHORED HERE. `LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL` is
// exported from the contract layer precisely "so callers do not invent wording of their own", and the
// domain layer must not import the contract layer (that direction is the contract's, and reversing it
// would make a cycle). So the caller passes it in, exactly as `caseLifecycle` takes its four inputs
// explicitly rather than reaching for them.

/** How far an identity claim about a case can go. Ordered from weakest to strongest. */
export type CaseIdentityGrain =
  | "ACCOUNT_GRAINED_POTENTIAL"
  | "CLAIM_STATES_SINGLE_OBLIGATION"
  | "ABSORBED_OBSERVATIONS_RECORDED"
  | "OBLIGATION_UNIQUENESS_GUARANTEED";

/**
 * Whether anyone looked for absorbed observations, and what they found.
 *
 * `checked: false` is the default for every surface that does not run the forensic query, and it is a
 * DIFFERENT FACT from `{ checked: true, count: 0 }`.
 */
export type AbsorbedObservations =
  | { readonly checked: false }
  | { readonly checked: true; readonly count: number };

export interface CaseIdentityGrainInput {
  /**
   * From `leakInstanceIdentityStatus().establishable`. False everywhere today.
   *
   * It is an INPUT rather than a lookup so this module stays pure and so a test can prove the guaranteed
   * state is unreachable *for the real value* rather than for a value this file chose.
   */
  readonly obligationIdentityEstablishable: boolean;
  /** `LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL`, passed through verbatim. */
  readonly identityRefusalDetail: string;
  readonly absorbedObservations: AbsorbedObservations;
  /**
   * Whether the detector RECORDED that this claim covers exactly one obligation.
   *
   * A FOURTH STATE WAS NECESSARY AND THE EXISTING THREE COULD NOT CARRY IT. Since PROVEN became
   * available only to single-obligation claims, every proven case rendered the ACCOUNT-GRAINED headline
   * — *"the figure above may cover more than one"* — which is TRUE OF THE IDENTITY and FALSE OF THE
   * CLAIM. Two different subjects, and a screen that states only the first makes a false statement about
   * the second.
   *
   * It is NOT `OBLIGATION_UNIQUENESS_GUARANTEED`, and the distinction is the same one this repository
   * keeps having to make. That state means the DATA CONTRACT declares a stable obligation identifier, so
   * the identity itself cannot merge; it stays unreachable. This one means the claim NAMES its obligation
   * within one reading of the customer's extracts, while the case's dedupe key remains account-grained —
   * so a later observation can still be absorbed, and `mayCoverMultipleObligations` stays TRUE.
   */
  readonly claimStatesSingleObligation?: boolean;
}

export interface CaseIdentityGrainDisclosure {
  readonly grain: CaseIdentityGrain;
  /** True while a case may cover more than one obligation. The single field a renderer should branch on. */
  readonly mayCoverMultipleObligations: boolean;
  /**
   * `false` always, today. Named as a question rather than asserted as a fact, so a consumer that wants a
   * per-obligation guarantee reads a refusal instead of inferring one from silence.
   */
  readonly obligationUniquenessGuaranteed: boolean;
  /** Why, in the contract layer's own words. Never echoes a customer value. */
  readonly reason: string;
  readonly absorbedObservations: AbsorbedObservations;
  /** The sentence a screen renders. One wording, one place. */
  readonly headline: string;
}

/** What the exposure figure on an account-grained case does and does not mean. */
export const ACCOUNT_GRAINED_HEADLINE =
  "ACCOUNT-LEVEL IDENTITY. This case is identified by the customer account, not by the obligation, so it " +
  "may represent more than one contractual obligation and the figure above may cover more than one. It is " +
  "not a per-obligation claim. The amount shown is what the first observation carried for the account: an " +
  "observation absorbed into this case later is not added to it.";

/** Where the claim names ONE obligation but the case identity is still account-grained. */
export const CLAIM_SINGLE_OBLIGATION_HEADLINE =
  "THIS CLAIM NAMES ONE OBLIGATION. The detector recorded which single obligation this claim covers, " +
  "together with what was expected and what was billed on it, so the figure above is a per-obligation " +
  "figure and not a sum across obligations. The case's own identity is still the customer ACCOUNT, " +
  "which means a later observation for the same account could be absorbed into this case; if that " +
  "happens it is stated separately and the absorbed amount appears in no figure.";

/** The same, where absorption is on the record rather than merely possible. */
export const ABSORBED_HEADLINE =
  "ACCOUNT-LEVEL IDENTITY, AND A SECOND OBSERVATION WAS ABSORBED. More than one detector observation was " +
  "admitted against this account and folded into this single case. Whether those observations are " +
  "different obligations or one obligation re-observed cannot be established from the recorded data. The " +
  "amount shown is the first observation's only: the amount of each absorbed observation is not added to " +
  "it and appears in no figure, so the exposure shown may be understated as well as combined.";

/**
 * Derive the disclosure. PURE: no clock, no I/O, no randomness.
 *
 * The order of the branches is the order of strength, and the strongest is first so it cannot be reached
 * by accident from a later one.
 */
export function deriveCaseIdentityGrain(input: CaseIdentityGrainInput): CaseIdentityGrainDisclosure {
  if (input.obligationIdentityEstablishable) {
    // UNREACHABLE TODAY. Kept as a real branch rather than a `throw`, because the day the contract
    // declares an obligation identifier this is the answer — and a `throw` here would make that day a
    // production incident instead of a version bump.
    return Object.freeze({
      grain: "OBLIGATION_UNIQUENESS_GUARANTEED",
      mayCoverMultipleObligations: false,
      obligationUniquenessGuaranteed: true,
      reason: "obligation-level identity is established for this case",
      absorbedObservations: input.absorbedObservations,
      headline: "OBLIGATION-LEVEL IDENTITY. This case is identified by the obligation.",
    });
  }

  const absorbed = input.absorbedObservations.checked && input.absorbedObservations.count > 0;
  // ABSORPTION OUTRANKS A STATED CLAIM, deliberately. A recorded absorption is evidence that something
  // was folded in; a stated claim is what the detector believed when it wrote the signal. Where the two
  // disagree the evidence wins, because the alternative is a screen reassuring a reader about a merge
  // that is on the record.
  const grain: CaseIdentityGrain = absorbed
    ? "ABSORBED_OBSERVATIONS_RECORDED"
    : input.claimStatesSingleObligation === true
      ? "CLAIM_STATES_SINGLE_OBLIGATION"
      : "ACCOUNT_GRAINED_POTENTIAL";
  return Object.freeze({
    grain,
    // STILL TRUE, even for a stated single-obligation claim: the dedupe key is the account, so the
    // IDENTITY can still cover more than one obligation however precise the claim is.
    mayCoverMultipleObligations: true,
    obligationUniquenessGuaranteed: false,
    reason: input.identityRefusalDetail,
    absorbedObservations: input.absorbedObservations,
    headline:
      grain === "ABSORBED_OBSERVATIONS_RECORDED" ? ABSORBED_HEADLINE
        : grain === "CLAIM_STATES_SINGLE_OBLIGATION" ? CLAIM_SINGLE_OBLIGATION_HEADLINE
          : ACCOUNT_GRAINED_HEADLINE,
  });
}

/**
 * Does this action require a guarantee the current contract cannot provide?
 *
 * FAIL CLOSED, and deliberately NOT a list of today's actions. The predicate asks about the GUARANTEE, so
 * a future action that needs one is refused by default rather than by being remembered. Nothing in the
 * product calls for an obligation-level guarantee today, which is why this refuses everything that asks.
 */
export function refusesObligationLevelGuarantee(
  disclosure: CaseIdentityGrainDisclosure,
): { readonly permitted: boolean; readonly refusal: string | null } {
  if (disclosure.obligationUniquenessGuaranteed) {
    return Object.freeze({ permitted: true, refusal: null });
  }
  return Object.freeze({
    permitted: false,
    refusal:
      "this action requires a guarantee that one case is one obligation, which the current data contract " +
      `cannot provide: ${disclosure.reason}`,
  });
}
