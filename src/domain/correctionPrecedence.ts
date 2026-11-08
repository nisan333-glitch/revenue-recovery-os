// S-DUP-4 · WHICH OBSERVED AT-RISK AMOUNT IS AUTHORITATIVE? Decided by authoritative billing evidence.
//
// THE RULE, as approved:
//
//   > An observed at-risk amount becomes AUTHORITATIVE only when authoritative billing evidence
//   > corroborates it, and that evidence must itself RECONCILE: what was billed as a correction and what
//   > was collected against it must be consistent. Verified partial payments are supported and are never
//   > double counted. Ambiguous obligation identity and contradictory financial evidence FAIL CLOSED.
//
// WHAT IT REPLACES. When one identity carried several observations with different amounts, the state was
// `CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED`: every amount reported, none authoritative, and `storedMinor`
// taken from the FIRST observation. The only ordering the data carries is `event_sequence`, which is
// arrival order — so "first" was arrival order wearing a different name. Explicitly excluded as a basis,
// each for its own reason: arrival order (the thing forbidden), RECENCY (recency is arrival order wearing a
// date), magnitude (largest-wins points the incentive at the failure), row count, and a stable tie-break —
// *determinism is necessary and is not evidence*, the correction already on record against breaking an
// append-only log's ties with a random id and calling the order total.
//
// WHY BILLED AND COLLECTED ARE TREATED ASYMMETRICALLY, which is the design's load-bearing choice.
//
//   · SEVERAL CORRECTION RECORDS ARE AMBIGUOUS. Two corrective charges against one obligation may be two
//     additive charges or one charge re-issued, and nothing in the contract distinguishes them. Summing
//     them would produce a billed figure neither record asserts — the ambiguous-live-lines rule, one lane
//     over: *addition is permitted only where the source establishes the lines are DISTINCT ADDITIVE
//     obligations, and nothing about their co-location establishes it.* So more than one is refused.
//   · SEVERAL OUTCOME RECORDS ARE NORMAL. A payment series is additive by nature: each settlement is a
//     distinct transfer of money, and two payments of $300 against a $600 charge are two events, not one
//     re-stated. So they are summed — which is exactly what supporting verified partial payments means.
//
// DOUBLE COUNTING IS STRUCTURALLY REFUSED, not merely avoided. Evidence ids are checked for duplicates
// within each side and for appearing on BOTH sides: one record cannot be both the charge and the payment,
// and a role vocabulary that returns exactly one role per record is not by itself a guarantee once two
// sums are being compared.
//
// ORDER CERTAINTY IS NO LONGER A PRECONDITION, and that is a consequence worth naming. Because precedence
// is decided by evidence rather than by sequence, an identity whose append order cannot be established can
// still have an authoritative amount. "Which was recorded first" stays unknowable and keeps its own state;
// "which amount is authoritative" becomes answerable. Two different questions, kept distinguishable.
//
// PURE: no clock, no I/O, no randomness, nothing that can act.

export type PrecedenceCode =
  /** No source-attested billing record exists for this identity, so there is nothing to corroborate against. */
  | "NO_AUTHORITATIVE_BILLING_EVIDENCE"
  /** Several correction records, and nothing establishes they are distinct additive charges. */
  | "BILLED_AMOUNT_AMBIGUOUS"
  /** The billing evidence does not reconcile: more collected than billed, a currency disagreement, a
   *  record counted on both sides, a duplicate id, or an amount that is not a whole minor figure. */
  | "BILLING_EVIDENCE_CONTRADICTORY"
  /** The claim is not obligation-grained, so which obligation the billing refers to is not established. */
  | "OBLIGATION_IDENTITY_AMBIGUOUS"
  /** No observed amount equals the billed figure, so none of them is the amount that was corrected. */
  | "NO_OBSERVATION_MATCHES_BILLED";

/** How far the authoritative charge has been settled. Reported beside the amount, never folded into it. */
export type SettlementState = "UNSETTLED" | "PARTIALLY_SETTLED" | "FULLY_SETTLED";

export interface AuthoritativeBilling {
  /** Every source-attested CORRECTION record's amount, in minor units. One entry per record. */
  readonly billedAmountsMinor: readonly number[];
  /** Every source-attested OUTCOME record's amount, in minor units. One entry per record. */
  readonly collectedAmountsMinor: readonly number[];
  readonly currency: string;
  /** The evidence ids behind each side, in the same order. Carried so double counting is CHECKABLE. */
  readonly billedRecordIds: readonly string[];
  readonly collectedRecordIds: readonly string[];
}

export interface PrecedenceInput {
  /** The distinct amounts observed for this identity. Order is deliberately not consulted. */
  readonly observedAmountsMinor: readonly number[];
  readonly currency: string;
  /** Whether the identity names a single obligation. False means an account-level grouping. */
  readonly obligationGrained: boolean;
  readonly billing: AuthoritativeBilling | null;
}

export type PrecedenceVerdict =
  | {
      readonly resolved: true;
      /** The observed amount the billing evidence corroborates. */
      readonly authoritativeMinor: number;
      readonly billedMinor: number;
      readonly collectedMinor: number;
      readonly settlement: SettlementState;
      /**
       * The outstanding remainder, `billed − collected`. Reported, never subtracted from the
       * authoritative amount: a partial payment does not reduce what was owed.
       */
      readonly outstandingMinor: number;
    }
  | { readonly resolved: false; readonly code: PrecedenceCode; readonly reason: string };

const deny = (code: PrecedenceCode, reason: string): PrecedenceVerdict =>
  Object.freeze({ resolved: false as const, code, reason });

const wholeNonNegative = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

export function resolvePrecedence(input: PrecedenceInput): PrecedenceVerdict {
  // IDENTITY FIRST. Corroborating an account-level grouping against one obligation's billing would attach
  // a figure to a subject nobody established.
  if (!input.obligationGrained) {
    return deny(
      "OBLIGATION_IDENTITY_AMBIGUOUS",
      "this identity groups by account rather than by obligation, so which obligation the billing evidence " +
        "refers to is not established and no amount can be made authoritative for it",
    );
  }

  const b = input.billing;
  if (b === null) {
    return deny(
      "NO_AUTHORITATIVE_BILLING_EVIDENCE",
      "no source-attested billing record exists for this identity, so there is nothing to corroborate an " +
        "observed amount against — an arrival order is not evidence",
    );
  }

  if (b.billedAmountsMinor.length !== b.billedRecordIds.length
    || b.collectedAmountsMinor.length !== b.collectedRecordIds.length) {
    return deny(
      "BILLING_EVIDENCE_CONTRADICTORY",
      "the billing evidence carries a different number of amounts than record ids, so no side can be " +
        "attributed to the records it came from",
    );
  }

  // DOUBLE COUNTING, refused structurally rather than assumed away.
  const billedIds = new Set(b.billedRecordIds);
  const collectedIds = new Set(b.collectedRecordIds);
  if (billedIds.size !== b.billedRecordIds.length || collectedIds.size !== b.collectedRecordIds.length) {
    return deny(
      "BILLING_EVIDENCE_CONTRADICTORY",
      "the same evidence id appears more than once on one side of the reconciliation, which would count one " +
        "record twice",
    );
  }
  const onBothSides = [...billedIds].filter((id) => collectedIds.has(id));
  if (onBothSides.length > 0) {
    return deny(
      "BILLING_EVIDENCE_CONTRADICTORY",
      `${onBothSides.length} evidence record(s) are counted as both the corrective charge and its payment; ` +
        "one record cannot be both",
    );
  }

  if (b.currency !== input.currency) {
    return deny(
      "BILLING_EVIDENCE_CONTRADICTORY",
      `the billing evidence is denominated in ${b.currency} while the observations are in ${input.currency}; ` +
        "amounts in different currencies are never reconciled",
    );
  }
  if (![...b.billedAmountsMinor, ...b.collectedAmountsMinor].every(wholeNonNegative)) {
    return deny(
      "BILLING_EVIDENCE_CONTRADICTORY",
      "a billing amount is not a whole, non-negative minor figure, so the reconciliation cannot be computed",
    );
  }

  // SEVERAL CHARGES ARE AMBIGUOUS, SEVERAL PAYMENTS ARE NOT. See the header.
  if (b.billedAmountsMinor.length === 0) {
    return deny(
      "NO_AUTHORITATIVE_BILLING_EVIDENCE",
      "no corrective charge is recorded for this identity, so there is no billed figure to corroborate against",
    );
  }
  if (b.billedAmountsMinor.length > 1) {
    return deny(
      "BILLED_AMOUNT_AMBIGUOUS",
      `${b.billedAmountsMinor.length} corrective charges are recorded against this one obligation and nothing ` +
        "establishes that they are distinct additive charges rather than one charge re-issued; summing them " +
        "would produce a billed figure neither record asserts",
    );
  }

  const billedMinor = b.billedAmountsMinor[0]!;
  const collectedMinor = b.collectedAmountsMinor.reduce((sum, n) => sum + n, 0);
  if (!Number.isSafeInteger(collectedMinor)) {
    return deny("BILLING_EVIDENCE_CONTRADICTORY", "the collected amounts do not sum to a whole minor figure");
  }
  if (collectedMinor > billedMinor) {
    return deny(
      "BILLING_EVIDENCE_CONTRADICTORY",
      `${collectedMinor} was collected against a corrective charge of ${billedMinor}; more cannot be settled ` +
        "than was ever charged, so one of the two records is wrong and neither is trusted",
    );
  }

  // THE CORROBORATION. The authoritative amount is the one the corrective charge was raised for.
  const matches = [...new Set(input.observedAmountsMinor)].filter((n) => n === billedMinor);
  if (matches.length === 0) {
    return deny(
      "NO_OBSERVATION_MATCHES_BILLED",
      `no observed amount equals the corrective charge of ${billedMinor}, so none of them is the figure that ` +
        "was actually corrected",
    );
  }

  const settlement: SettlementState =
    collectedMinor === 0 ? "UNSETTLED" : collectedMinor === billedMinor ? "FULLY_SETTLED" : "PARTIALLY_SETTLED";
  return Object.freeze({
    resolved: true as const,
    authoritativeMinor: billedMinor,
    billedMinor,
    collectedMinor,
    settlement,
    // A partial payment does NOT reduce what was owed. The remainder is reported beside the authoritative
    // amount rather than subtracted from it, which is what "without double counting" requires in the other
    // direction: the shortfall is counted once, and its settlement is a separate fact.
    outstandingMinor: billedMinor - collectedMinor,
  });
}
