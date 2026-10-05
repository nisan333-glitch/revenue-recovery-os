// THE EXPECTATION EXTRACT — what a source system must state for NH to reconcile expected money
// against billed money, and an ADDITIVE, SEPARATELY GOVERNED SIBLING of the 2.0.0 observation
// contract rather than a widening of it.
//
// WHY A SECOND ARTEFACT AND NOT A 2.0.0 FIELD SET. Contract 2.0.0 cannot express a missing invoice:
// `next_invoice_due_at` and `next_invoice_amount` are REQUIRED, so a subscription that was never
// invoiced either has no row (invisible) or a row with blanks (rejected — and rejected rows are
// quarantined, never counted). That is a property of the contract's SHAPE, not of any detector, which
// is why no amount of field-adding there could close it. This artefact has its own id, version,
// scheme and method version, so the single-dataset path stays byte-identical and no 2.0.0 consumer
// changes — the same discipline `exposureFinding.ts` applied to Detector #2's reading.
//
// WHY THE EXPECTATION MUST COME FROM ELSEWHERE. Asking the billing system what billing should have
// done cannot detect billing's own omission: the failure that erased the invoice may have erased the
// schedule with it. The expectation therefore originates in a system OTHER than the one that was
// supposed to act, and it must pre-date the period it governs.
//
// WHAT NOTHING HERE DOES. No intake, no detector, no persistence, no UI, no migration. This module
// and its validator are pure declarations; they create no Recovery Case, stage no candidate, and
// produce no money. `OBLIGATION_IDENTITY_FIELDS` stays empty and the candidate firewall is untouched.
import {
  CAPABILITY_CODES, type ExpectationCodeSpec,
} from "./expectationExtractCodes";

/** Stable identity of this contract, stamped into every validation result. */
export const EXPECTATION_EXTRACT_ID = "nh.expectation-extract";

/**
 * Its OWN version line. Deliberately not `PILOT_DATA_CONTRACT_VERSION`: the two artefacts describe
 * different files from different systems, and tying them would mean an expectation-side clarification
 * forced a bump on every observation extract already in the field.
 */
export const EXPECTATION_EXTRACT_VERSION = "1.1.0";

export const EXPECTATION_EXTRACT_REF = `${EXPECTATION_EXTRACT_ID}@${EXPECTATION_EXTRACT_VERSION}`;

/**
 * Why 1.1.0 is a MINOR by the test the compatibility policy applies: no extract that 1.0.0 accepted is
 * now refused, and no extract it refused is now accepted. The field table, the tiers and the required
 * set are identical. What changed is the PRECISION of two reports and the addition of a per-unit
 * declaration:
 *
 *   • `NH-EX-2006` ("zero or negative") is RETIRED and replaced by `NH-EX-2018` (explicit zero) and
 *     `NH-EX-2019` (negative). The same rows are refused; they are now told which error they made.
 *   • `monetaryQuantification` is declared PER UNIT, with `NH-EX-3006`. A unit with no authoritative
 *     amount already survived as an UNKNOWN; what is new is that it now SAYS the quantification is
 *     unavailable rather than leaving a caller to infer it from a null.
 */
export const EXPECTATION_EXTRACT_VERSION_HISTORY: readonly { readonly version: string; readonly change: string }[] =
  Object.freeze([
    Object.freeze({ version: "1.0.0", change: "First declaration: row grain, 12 fields, five capabilities." }),
    Object.freeze({
      version: "1.1.0",
      change:
        "SCHEMA PRESENCE vs ROW-LEVEL AVAILABILITY pinned: a required `expected_amount` COLUMN never means a required VALUE. Four amount states are now distinguishable — blank (UNKNOWN, row preserved), malformed (NH-EX-2005), explicit zero (NH-EX-2018), negative (NH-EX-2019) — and monetary quantification is declared per unit (NH-EX-3006).",
    }),
  ]);

/** A change to the extract's SHAPE is a new scheme id, never a silent re-reading of the old one. */
export const EXPECTATION_EXTRACT_SCHEME = "nh-expectation-extract-v1";

/**
 * The VALIDATION method version, independent of `EXPECTATION_EXTRACT_VERSION` and of every assessment
 * constant. A change to how a row is checked must be visible without re-declaring the contract, and
 * must never drag `ASSESSMENT_CALC_VERSION` — which would re-grade history.
 */
export const EXPECTATION_VALIDATION_METHOD_VERSION = "exv-2026.1";

// ── 1 · THE ROW GRAIN ─────────────────────────────────────────────────────────────────────────────

/**
 * Stated first, because every field answer depends on it, and stated as a VALUE so a test can hold
 * the prose to the behaviour rather than trusting a comment.
 */
export const EXPECTATION_ROW_GRAIN = Object.freeze({
  rule: "ONE ROW IS ONE EXPECTED BILLING OBLIGATION: one entitlement, one governed period, one expected amount.",
  /**
   * The source enumerates the rows. This is what makes absence a POSITIVE RESULT rather than a lookup
   * that found nothing: a detector iterates the expectation side, so a row with no matching
   * observation is a finding about an obligation someone asserted.
   */
  whoEnumerates: "the source system, never NH",
  /**
   * Grain is a source assertion and NO FIELD CAN PROMOTE IT. A row-grain flag would hand grain
   * authority to the party who benefits from a larger or smaller number, which the standing
   * architecture test rejects. An aggregate row therefore stays structurally invisible here exactly as
   * it does on the observation side — a known, stated limitation rather than a solved problem.
   */
  grainIsNotDeclarable: true,
  /** NH never creates, expands, prorates or infers a row. See `STOPPED_FIELDS` for the consequence. */
  nhNeverGeneratesRows: true,
} as const);

// ── 2 · CAPABILITIES ──────────────────────────────────────────────────────────────────────────────

/**
 * Named, separately-gated capabilities. Each is INDEPENDENT on purpose: collapsing any two would let
 * closing one look like closing both — the reason `leakInstanceIdentityStatus` and
 * `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` are already separate names.
 *
 * A closed capability is an UNKNOWN. It never rejects the extract, because rejecting a dataset over a
 * fact some other detector did not need would discard money NH can still measure.
 */
export type ExpectationCapability =
  | "PAYER_RELATION_AVAILABLE"
  | "LIFECYCLE_TERMINATION_AVAILABLE"
  | "LIFECYCLE_PAUSE_AVAILABLE"
  | "AMENDMENT_LINEAGE_AVAILABLE"
  | "EXPECTATION_EVENT_IDENTITY_AVAILABLE";

/**
 * How a capability is established. The distinction is load-bearing:
 *
 *  • `column_declared` — a BLANK is itself informative. Declaring `terminated_at` is the source
 *    saying "I report terminations"; an empty cell then means "not terminated", which is a fact.
 *  • `populated_on_every_row` — a blank carries no information, so the capability cannot be relied
 *    upon unless every row has the value. An identity or a relation is of this kind.
 */
export type CapabilityBasis = "column_declared" | "populated_on_every_row";

export interface CapabilitySpec {
  readonly capability: ExpectationCapability;
  readonly basis: CapabilityBasis;
  /** The field(s) that establish it. */
  readonly fields: readonly string[];
  /** The code reported when it is closed. ALWAYS fail-closed — never assumed available. */
  readonly unavailableCode: ExpectationCodeSpec;
  /** What is lost, in money terms, and in which direction. */
  readonly lossWhenClosed: string;
}

export const EXPECTATION_CAPABILITIES: readonly CapabilitySpec[] = Object.freeze([
  Object.freeze({
    capability: "PAYER_RELATION_AVAILABLE" as const,
    basis: "populated_on_every_row" as const,
    fields: Object.freeze(["payer_ref"]),
    unavailableCode: CAPABILITY_CODES.PAYER_RELATION_UNAVAILABLE,
    lossWhenClosed:
      "Sibling-entitlement attribution. A positive residual stays in the headline as unexplained exposure — the money is still reported, only unattributed, which is the conservative direction.",
  }),
  Object.freeze({
    capability: "LIFECYCLE_TERMINATION_AVAILABLE" as const,
    basis: "column_declared" as const,
    fields: Object.freeze(["terminated_at"]),
    unavailableCode: CAPABILITY_CODES.LIFECYCLE_TERMINATION_UNAVAILABLE,
    lossWhenClosed: "FALSE-POSITIVE control. A terminated entitlement reads as live and its periods read as unbilled.",
  }),
  Object.freeze({
    capability: "LIFECYCLE_PAUSE_AVAILABLE" as const,
    basis: "column_declared" as const,
    fields: Object.freeze(["pause_start", "pause_end"]),
    unavailableCode: CAPABILITY_CODES.LIFECYCLE_PAUSE_UNAVAILABLE,
    lossWhenClosed: "FALSE-POSITIVE control. A suspended period reads as unbilled.",
  }),
  Object.freeze({
    capability: "AMENDMENT_LINEAGE_AVAILABLE" as const,
    basis: "column_declared" as const,
    fields: Object.freeze(["supersedes_ref", "amended_at"]),
    unavailableCode: CAPABILITY_CODES.AMENDMENT_LINEAGE_UNAVAILABLE,
    lossWhenClosed: "FALSE-POSITIVE control. A replaced obligation reads as still owed beside its replacement.",
  }),
  Object.freeze({
    capability: "EXPECTATION_EVENT_IDENTITY_AVAILABLE" as const,
    basis: "populated_on_every_row" as const,
    fields: Object.freeze(["schedule_line_ref"]),
    unavailableCode: CAPABILITY_CODES.EVENT_IDENTITY_UNAVAILABLE,
    lossWhenClosed:
      "Event reconciliation and correlation. MONETARY reconciliation is untouched; what is lost is the leak class no monetary method can reach, because a duplicate masking an omission nets to zero at every grain.",
  }),
]);

// ── 3 · THE FIELD TABLE ───────────────────────────────────────────────────────────────────────────

/**
 * Three tiers, and there is NO `recommended`.
 *
 * In 2.0.0 `RECOMMENDED_FIELDS` feeds `missingRecommendedColumns`, which is checked against a
 * governed `maxMissingRecommendedColumns` whose pilot value is zero — so declaring a field
 * "recommended" would refuse extracts that previously passed, with no remedy under anti-tuning. The
 * tier is therefore absent here rather than merely unused, so the trap cannot be re-entered.
 */
export type ExpectationFieldTier =
  /** Absent ⇒ the extract or the row is unusable. No default is ever substituted. */
  | "required"
  /** Absent ⇒ a NAMED capability closes. The extract stays valid and still measures money. */
  | "conditional"
  /** A refinement whose absence closes a capability and nothing else. */
  | "optional";

export type ExpectationFieldKind =
  | "identifier"
  | "date"
  | "money_decimal"
  | "currency_code";

export type ExpectationPiiClass = "identifier_pseudonymous" | "operational";

/**
 * Each field carries its own justification, because the questions were asked before the field existed
 * and the answers should not decay into a commit message no one reads:
 *   `establishes`  — what business fact it states (A)
 *   `neededBy`     — which capability needs it (B)
 *   `withoutIt`    — the false positive or false negative that follows (C)
 *   `sourceObservable` — whether a source system can genuinely state it (D)
 *   `whenAbsent`   — what actually happens (E)
 *   `createsIdentityObligation` — whether it imposes a new identity or grain duty (F)
 */
export interface ExpectationFieldSpec {
  readonly name: string;
  readonly tier: ExpectationFieldTier;
  readonly kind: ExpectationFieldKind;
  readonly piiClass: ExpectationPiiClass;
  readonly description: string;
  readonly establishes: string;
  readonly neededBy: ExpectationCapability | "every_unit";
  readonly withoutIt: string;
  readonly sourceObservable: true;
  readonly whenAbsent: string;
  readonly createsIdentityObligation: false;
  readonly since: string;
}

function field(spec: ExpectationFieldSpec): ExpectationFieldSpec {
  return Object.freeze(spec);
}

export const EXPECTATION_EXTRACT_FIELDS: readonly ExpectationFieldSpec[] = Object.freeze([
  field({
    name: "entitlement_ref",
    tier: "required",
    kind: "identifier",
    piiClass: "identifier_pseudonymous",
    description:
      "Stable identifier of the thing that owes money — the subscription, entitlement or schedule it belongs to. An internal key, never a person.",
    establishes: "WHAT owes money, stably named by the source.",
    neededBy: "every_unit",
    withoutIt: "No reconciliation unit can be formed at all, so there is no answer of any kind.",
    sourceObservable: true,
    whenAbsent: "The row is quarantined; a blank on every row makes the extract unusable.",
    createsIdentityObligation: false,
    since: "1.0.0",
  }),
  field({
    name: "period_start",
    tier: "required",
    kind: "date",
    piiClass: "operational",
    description: "First day the obligation covers.",
    establishes: "WHEN the obligation begins — half of the governed period.",
    neededBy: "every_unit",
    withoutIt: "NH would have to infer a period boundary, which it never does.",
    sourceObservable: true,
    whenAbsent: "The row is quarantined.",
    createsIdentityObligation: false,
    since: "1.0.0",
  }),
  field({
    name: "period_end",
    tier: "required",
    kind: "date",
    piiClass: "operational",
    description: "Last day the obligation covers.",
    establishes: "WHEN the obligation ends — the other half of the governed period.",
    neededBy: "every_unit",
    withoutIt: "Same: a manufactured boundary, and the two sides could not be shown to disagree.",
    sourceObservable: true,
    whenAbsent: "The row is quarantined.",
    createsIdentityObligation: false,
    since: "1.0.0",
  }),
  field({
    name: "expected_amount",
    tier: "required",
    kind: "money_decimal",
    piiClass: "operational",
    description:
      "Gross obligated amount for this period, in major units, positive. LEAVE BLANK where the source cannot state it authoritatively — a blank is a declared UNKNOWN, not an error and never a zero.",
    establishes: "HOW MUCH is owed, where the source can state it authoritatively.",
    neededBy: "every_unit",
    withoutIt:
      "The entire monetary surface. And a blank silently read as 0 is the UNKNOWN-becomes-zero defect: it would make an unpriced obligation look satisfied.",
    sourceObservable: true,
    whenAbsent:
      "THE COLUMN is required; a blank CELL is an UNKNOWN that is counted and never valued, never averaged from prior invoices, never taken from a plan price and never prorated by NH.",
    createsIdentityObligation: false,
    since: "1.0.0",
  }),
  field({
    name: "currency",
    tier: "required",
    kind: "currency_code",
    piiClass: "operational",
    description: "ISO 4217 code of the expected amount. Never converted.",
    establishes: "The UNIT of the amount.",
    neededBy: "every_unit",
    withoutIt:
      "Amounts in different currencies would be compared or summed as though equal, and NH holds no governed rate with which to do so honestly.",
    sourceObservable: true,
    whenAbsent: "The row is quarantined.",
    createsIdentityObligation: false,
    since: "1.0.0",
  }),
  field({
    name: "payer_ref",
    tier: "conditional",
    kind: "identifier",
    piiClass: "identifier_pseudonymous",
    description: "Stable identifier of the party billed for this entitlement. An internal key, never a person.",
    establishes: "WHO is billed, so a counterpart on a sibling entitlement can be recognised.",
    neededBy: "PAYER_RELATION_AVAILABLE",
    withoutIt:
      "A residual whose counterpart sits on a sibling entitlement of the same payer cannot be attributed, so it stays in the headline as unexplained exposure. An attribution loss, not a money error.",
    sourceObservable: true,
    whenAbsent: "PAYER_RELATION_AVAILABLE closes. Positives stay UNPAIRED, which is the conservative direction.",
    createsIdentityObligation: false,
    since: "1.0.0",
  }),
  field({
    name: "terminated_at",
    tier: "conditional",
    kind: "date",
    piiClass: "operational",
    description: "Date the entitlement ended. Blank means it has not ended — which is why declaring the column is itself the capability.",
    establishes: "The DATED fact that the obligation ceased.",
    neededBy: "LIFECYCLE_TERMINATION_AVAILABLE",
    withoutIt: "A terminated entitlement reads as live and its periods read as unbilled — a false positive.",
    sourceObservable: true,
    whenAbsent: "LIFECYCLE_TERMINATION_AVAILABLE closes. No row is rejected and nothing is assumed live or dead.",
    createsIdentityObligation: false,
    since: "1.0.0",
  }),
  field({
    name: "pause_start",
    tier: "conditional",
    kind: "date",
    piiClass: "operational",
    description: "First day of a suspension during which nothing is owed.",
    establishes: "The DATED start of a suspension.",
    neededBy: "LIFECYCLE_PAUSE_AVAILABLE",
    withoutIt: "A paused period reads as unbilled — a false positive.",
    sourceObservable: true,
    whenAbsent: "LIFECYCLE_PAUSE_AVAILABLE closes.",
    createsIdentityObligation: false,
    since: "1.0.0",
  }),
  field({
    name: "pause_end",
    tier: "conditional",
    kind: "date",
    piiClass: "operational",
    description: "Last day of the suspension. Required WITH pause_start — an unbounded pause is refused.",
    establishes: "The DATED end of the suspension, which bounds it.",
    neededBy: "LIFECYCLE_PAUSE_AVAILABLE",
    withoutIt: "An open-ended pause would void every later period — the largest single false NEGATIVE a lifecycle fact can cause.",
    sourceObservable: true,
    whenAbsent: "LIFECYCLE_PAUSE_AVAILABLE closes; supplied alone beside pause_start, the row is quarantined.",
    createsIdentityObligation: false,
    since: "1.0.0",
  }),
  field({
    name: "supersedes_ref",
    tier: "conditional",
    kind: "identifier",
    piiClass: "identifier_pseudonymous",
    description: "The schedule_line_ref this row replaces. Present only on an amendment.",
    establishes: "THAT this line replaces that line — lineage, stated rather than guessed.",
    neededBy: "AMENDMENT_LINEAGE_AVAILABLE",
    withoutIt:
      "A superseded obligation reads as still owed alongside its replacement, so one period claims two amounts and the larger is manufactured.",
    sourceObservable: true,
    whenAbsent: "AMENDMENT_LINEAGE_AVAILABLE closes; two unsuperseded lines for one unit are then quarantined rather than summed.",
    createsIdentityObligation: false,
    since: "1.0.0",
  }),
  field({
    name: "amended_at",
    tier: "conditional",
    kind: "date",
    piiClass: "operational",
    description: "Date the amendment took effect. Required WITH supersedes_ref.",
    establishes: "WHEN the replacement took effect, which orders the lineage.",
    neededBy: "AMENDMENT_LINEAGE_AVAILABLE",
    withoutIt: "Two lines claim one period with nothing to order them, so NH cannot say which is in force.",
    sourceObservable: true,
    whenAbsent: "AMENDMENT_LINEAGE_AVAILABLE closes; present-without-date is quarantined.",
    createsIdentityObligation: false,
    since: "1.0.0",
  }),
  field({
    name: "schedule_line_ref",
    tier: "optional",
    kind: "identifier",
    piiClass: "identifier_pseudonymous",
    description:
      "Per-obligation identity WITHIN this extract. Not a cross-system join key: the two sides identify at different grains and that question is open.",
    establishes: "WHICH obligation this row is, distinctly from its siblings.",
    neededBy: "EXPECTATION_EVENT_IDENTITY_AVAILABLE",
    withoutIt:
      "Event reconciliation and correlation cannot run, so the leak class that nets to zero money — a duplicate invoice masking an omission — stays invisible at every monetary grain.",
    sourceObservable: true,
    whenAbsent:
      "EXPECTATION_EVENT_IDENTITY_AVAILABLE closes, FAIL-CLOSED. Monetary reconciliation is unaffected: capability gating, never dataset rejection.",
    createsIdentityObligation: false,
    since: "1.0.0",
  }),
]);

/** Declared column names, in table order. The validator refuses anything else. */
export const EXPECTATION_EXTRACT_COLUMNS: readonly string[] = Object.freeze(
  EXPECTATION_EXTRACT_FIELDS.map((f) => f.name),
);

export const EXPECTATION_REQUIRED_COLUMNS: readonly string[] = Object.freeze(
  EXPECTATION_EXTRACT_FIELDS.filter((f) => f.tier === "required").map((f) => f.name),
);

// ── 4 · WHAT WAS STOPPED RATHER THAN INVENTED ─────────────────────────────────────────────────────

/**
 * Recorded as a VALUE, not as a comment, because the next person to want one of these will look for a
 * reason and should find a binding one. Each was considered and refused on evidence; none is a
 * placeholder waiting to be filled in.
 */
export const STOPPED_FIELDS: readonly { readonly candidate: string; readonly why: string }[] =
  Object.freeze([
    Object.freeze({
      candidate: "cadence / billing_frequency",
      why:
        "A finite history of past invoices is not an obligation — cancellation, expiry, pause, amendment, a free period and a term simply ending are all normal. Worse, a cadence NH could EXPAND INTO ROWS would make NH the author of the expectation, which is the beneficiary problem one level up. The source enumerates obligations; pattern may corroborate a declared cadence and may never be its source.",
    }),
    Object.freeze({
      candidate: "status (active / churned / ...)",
      why:
        "A state label is a free-text lever held by the party who benefits from the number, where a DATED fact is checkable against a period. The observation side already stopped on exactly this: `status` is optional there with an empty enum and no declared meaning. Lifecycle is admitted here only as dated facts.",
    }),
    Object.freeze({
      candidate: "expected_amount_estimated / proration_basis",
      why:
        "An estimate is a number NH authored. Where an authoritative amount cannot be established the finding is real and its exposure is UNKNOWN — counted, never zero, never averaged from prior invoices, never taken from a plan price. Estimation would be a separately governed product in the Revenue Opportunity ledger, never on the OBSERVED surface.",
    }),
    Object.freeze({
      candidate: "invoice_ref / allocation",
      why:
        "Observation-side facts. Carrying them here would let the expectation side assert what billing did, and the whole point of a second extract is that the expectation originates in a system other than the one that was supposed to act.",
    }),
    Object.freeze({
      candidate: "obligation_ref as a cross-system join key",
      why:
        "A generic invoice-level reference is not sufficient for a cross-system join: the two sides identify at different grains, consolidation and splitting are many-to-many, and a billing migration re-keys the entire book at once, so the whole expected book would read as missing. `schedule_line_ref` is scoped WITHIN this extract and is deliberately not that key. The grain question is open and belongs to the D2 decision.",
    }),
    Object.freeze({
      candidate: "any composite or NH-derived identity",
      why:
        "Explicitly not authorised, and the reason is not merely procedural: every derived key breaks on re-keying and migration, which are the two events most likely to produce a six-figure false finding.",
    }),
    Object.freeze({
      candidate: "a row-grain flag",
      why:
        "It would hand grain authority to the beneficiary. An aggregate row stays structurally invisible, stated as a limitation rather than solved by a field the customer controls.",
    }),
  ]);

/**
 * CLAIM BOUNDARY, in the artefact rather than only in a comment. A validated expectation extract is
 * INPUT. It is not Revenue Opportunity, not Revenue Returned, not Auditable Revenue, and a monetary
 * residual computed from it is OBSERVED exposure — never proof and never recovered money.
 */
export const EXPECTATION_EXTRACT_CLAIM_BOUNDARY = Object.freeze({
  observationOnly: true as const,
  constitutesProof: false as const,
  constitutesRevenue: false as const,
  createsRecoveryCase: false as const,
  enablesCandidate: false as const,
});
