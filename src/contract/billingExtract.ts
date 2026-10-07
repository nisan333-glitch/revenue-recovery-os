// THE BILLING EXTRACT — the billing side of the two-sided reconciliation, declared as an ADDITIVE,
// SEPARATELY GOVERNED SIBLING of the observation contract and of the expectation extract.
//
// IT SUCCEEDS `nh.settlement-extract@1.0.0`, WHICH IS RETIRED AND PRESERVED at
// `historical/settlementExtract_1_0_0.ts`. The predecessor's semantics were correct and are carried over
// unchanged; its NAMES were not. `settled_at` and `settled_amount` leaned towards payment timing, and in
// contract 2.0.0's adapter `settled_amount` is a declared synonym for `paid_amount` — so one token
// carried two opposite meanings in one repository. They are now `invoice_raised_at` and
// `invoice_line_amount`, and the artefact is named for the event it records rather than for the one it
// does not. Full treatment in `docs/BILLING_EXTRACT_RENAME_V1.md`.
//
// WHY THE VERSION IS 1.0.0 AND NOT 2.0.0. Semver is scoped to an ID. A `2.0.0` here would assert a
// `1.0.0` under THIS id which never existed and which no customer could have built against — a version
// signalling a change that did not happen. Succession is recorded as a link
// (`SETTLEMENT_EXTRACT_STATUS.supersededBy`), never as a number. This is NOT compatibility: a file
// declaring the old id is refused outright as an unknown artefact, which is a stronger protection than a
// major bump because there is no silent upgrade path at all. Had the id stayed, the rename would have
// been a MAJOR by `COMPATIBILITY_POLICY`, which lists "Remove or rename a field" verbatim.
//
// WHY A THIRD ARTEFACT RATHER THAN A WIDENING. Pilot data contract 2.0.0 describes a SUBSCRIPTION
// OBSERVATION — one row per subscription cycle, with `next_invoice_due_at` and `next_invoice_amount`
// REQUIRED. That shape cannot carry an invoice line, and an obligation never invoiced is either absent
// or rejected there. The expectation extract is the other system's statement of what was OWED, and
// carrying billing facts on it was already STOPPED for the reason that matters: it would let the
// expectation side assert what billing did, and the whole point of two extracts is that the expectation
// originates in a system OTHER than the one that was supposed to act. So this is the third artefact,
// with its own id, version, scheme, method version and code catalogue, and contract 2.0.0 is untouched.
//
// WHAT ONE ROW IS. **ONE INVOICE LINE** — one line of one invoice. Not an invoice, not a payment, not
// a period, not a subscription. NH never splits a line, never merges two, never prorates one and never
// invents one; the source enumerates them, exactly as the source enumerates expected obligations.
//
// THE FIELD THIS ARTEFACT EXISTS FOR. `obligation_ref` — the contract system's own obligation identifier,
// carried by billing onto the line that settles it. The grain study established that it must live HERE
// and not on the expectation side, because a join key has to exist on both sides and billing emits no
// contract identity: `invoice_line_id` is a POSITION WITHIN AN INVOICE, not a reference to the obligation
// it settles. The controlled counterfactual then measured what it is worth and what it is not — see
// `docs/OBLIGATION_REF_COUNTERFACTUAL_V1.md` and the erratum in `expectationExtractCorrections.ts`.
//
// NOTHING HERE IS WIRED TO PRODUCTION RECONCILIATION. This artefact and its validator serve the
// READINESS path only: they answer whether a customer can supply the facts, and compute no money.
import {
  BILLING_CAPABILITY_CODES, type BillingCodeSpec,
} from "./billingExtractCodes";

// ── 1 · IDENTITY ──────────────────────────────────────────────────────────────────────────────────

export const BILLING_EXTRACT_ID = "nh.billing-extract";

/**
 * Its OWN version line, independent of contract 2.0.0 and of expectation-extract 1.1.0. A change here
 * never re-identifies a pilot submission and never forces a re-assessment, which is the property the
 * sibling-artefact pattern exists to preserve.
 */
export const BILLING_EXTRACT_VERSION = "1.0.0";

export const BILLING_EXTRACT_REF = `${BILLING_EXTRACT_ID}@${BILLING_EXTRACT_VERSION}`;

export const BILLING_EXTRACT_VERSION_HISTORY: readonly { readonly version: string; readonly change: string }[] =
  Object.freeze([
    Object.freeze({
      version: "1.0.0",
      change:
        "First declaration under this id, succeeding nh.settlement-extract@1.0.0 (retired, preserved at historical/settlementExtract_1_0_0.ts). Six required facts; obligation_ref, credit distinction and billed period as named fail-closed capabilities; settlement_count declared UNAVAILABLE and owned by the contract system. Identical to the predecessor in every governed respect EXCEPT two column names: settled_at became invoice_raised_at and settled_amount became invoice_line_amount. No field was added or removed, no tier moved, no validator rule changed, and the recorded event is the same one.",
    }),
  ]);

export const BILLING_EXTRACT_SCHEME = "nh-billing-extract-v1";

/**
 * The validation method version, renamed with the artefact from `sxv-2026.1` so it stays namespaced to
 * the id it describes. Separate from `exv-2026.1` and from `ASSESSMENT_CALC_VERSION`: this validator's
 * behaviour can change without re-identifying anything either of those govern.
 *
 * The ALGORITHM did not change in the rename — the same checks are applied to renamed columns. The
 * constant moves because it names this artefact's method, not because the method moved.
 */
export const BILLING_VALIDATION_METHOD_VERSION = "bxv-2026.1";

/**
 * THE CANONICAL EVENT THIS EXTRACT RECORDS, stated once so nothing has to restate it. Every
 * customer-facing description of this artefact is RENDERED from this object rather than authored beside
 * it, because a generator that re-derives the event per field can contradict itself on the page.
 *
 * THE ARCHAEOLOGY THAT ESTABLISHED IT, kept because it is the evidence and because a future reader will
 * otherwise re-ask the question. A semantic audit found the predecessor's `settled_at` described as "the
 * date the billing system RAISED this line" and, on the next line, as establishing "when the settlement
 * event occurred" — two different business events. Which one it had always been was proved rather than
 * chosen:
 *
 *  • `ObservationRow` — the reconciliation core's input — carries NO date but the service period. No
 *    monetary, pairing or refusal logic has ever read a raise date or a payment date, so none could have
 *    depended on which event it meant.
 *  • The only consumer of the field anywhere was this extract's validator, and it only checked the
 *    FORMAT. The accepted row's date was carried and read by nothing — not the readiness evaluator, not
 *    the core, not the probe.
 *  • In the one governed experiment this extract has met, the readiness control maps the frozen billing
 *    export's `issued_at` onto it — the invoice ISSUE date. That export has no payment column at all.
 *  • The core's own amount field is `billedAmountMinor`, and the amount field already established "how
 *    much was BILLED".
 *  • Payment is a separate, differently-named concept elsewhere: `next_invoice_paid_at` in contract
 *    2.0.0's observation extract. It has never lived here.
 *
 * So usage was CONSISTENT and had always been the invoice/charge event: there was no drift to repair and
 * no definition to decide. The defect was in the NAMES, and the owner's decision of 2026-10-07 renamed
 * them. The fields now say what they mean, so this object no longer carries a caveat asking a reader to
 * discount them — `nameHistory` records that the predecessor names existed and were retired instead.
 */
export const BILLING_EVENT_DEFINITION = Object.freeze({
  theEvent: "A CHARGE WAS RAISED — an invoice line issued by the billing system.",
  isNot: Object.freeze([
    "a payment",
    "a cash receipt or collection",
    "a bank or processor clearing event",
    "a settlement in the payments sense of the word",
  ]),
  dateMeans: "the date the billing system RAISED the line, as that system holds it",
  amountMeans: "the amount CHARGED on that line, not an amount received",
  /**
   * WHY THE WARNING IS GONE AND THIS IS HERE INSTEAD. The predecessor's remedy was to state, wherever the
   * names appeared, that they should be read as something else. That worked and relied on the reader
   * noticing. The names were three commits old, this project's own, and had never been sent to anyone, so
   * the owner renamed them — which is the fix the caveat was standing in for.
   */
  nameHistory: Object.freeze({
    previousNames: Object.freeze({
      invoice_raised_at: "settled_at",
      invoice_line_amount: "settled_amount",
    }),
    retiredOn: "2026-10-07",
    reachedACustomer: false as const,
    why:
      "Both predecessor names leaned towards payment timing while the field records a charge being raised, and `settled_amount` is a declared synonym for `paid_amount` in contract 2.0.0's adapter — one token, two opposite events, two live artefacts.",
    semanticsChanged: false as const,
  }),
});

export const BILLING_ROW_GRAIN = Object.freeze({
  oneRowIs: "ONE INVOICE LINE — one line of one invoice, as the billing system raised it.",
  nhNever: Object.freeze([
    "split one invoice line into several",
    "merge several invoice lines into one",
    "prorate or re-date an invoice line",
    "invent an invoice line that the source did not enumerate",
    "derive an obligation reference the source did not state",
  ]),
  aggregateRowsAreInvisible:
    "A line that aggregates several obligations is structurally invisible at obligation grain, stated as a limitation rather than solved by a flag the customer controls — a row-grain flag would hand grain authority to the beneficiary.",
});

// ── 2 · CAPABILITIES ──────────────────────────────────────────────────────────────────────────────

/**
 * Named, separately-gated, FAIL-CLOSED. Each is independent: collapsing any two would let closing one
 * look like closing both. A closed capability is an UNKNOWN and never a rejection — refusing a file
 * over a fact some other detector did not need would discard money NH can still measure.
 */
export type BillingCapability =
  | "BILLING_OBLIGATION_LINK_AVAILABLE"
  | "CREDIT_DISTINCTION_AVAILABLE"
  | "BILLING_PERIOD_AVAILABLE"
  | "MIGRATION_LINEAGE_AVAILABLE"
  | "EXPECTED_SETTLEMENT_COUNT_AVAILABLE";

/**
 * How a capability is established — the same load-bearing distinction the expectation extract draws:
 *
 *  • `column_declared` — a BLANK is itself informative. Declaring `is_credit` is the source saying
 *    "I mark credits"; an empty cell then means "not a credit", which is a fact.
 *  • `populated_on_every_row` — a blank carries no information, so the capability cannot be relied
 *    upon unless every row has the value. An identity or a cross-system reference is of this kind.
 */
export type BillingCapabilityBasis = "column_declared" | "populated_on_every_row";

export interface BillingCapabilitySpec {
  readonly capability: BillingCapability;
  readonly basis: BillingCapabilityBasis;
  readonly fields: readonly string[];
  readonly unavailableCode: BillingCodeSpec;
  /** What is lost, in money terms, and IN WHICH DIRECTION. */
  readonly lossWhenClosed: string;
  /** Which money-discovery capability the readiness report must report as blocked. */
  readonly blocks: string;
}

export const BILLING_CAPABILITIES: readonly BillingCapabilitySpec[] = Object.freeze([
  Object.freeze({
    capability: "BILLING_OBLIGATION_LINK_AVAILABLE" as const,
    basis: "populated_on_every_row" as const,
    fields: Object.freeze(["obligation_ref"]),
    unavailableCode: BILLING_CAPABILITY_CODES.OBLIGATION_LINK_UNAVAILABLE,
    lossWhenClosed:
      "The cross-system join itself. Without it the two sides can only be matched on a key billing happens to share with the contract system, which a re-key or a migration destroys — and a timing-displacement hypothesis cannot be refuted, so real missing money stays held out pending attribution rather than claimed.",
    blocks: "MONETARY_RECONCILIATION",
  }),
  Object.freeze({
    capability: "CREDIT_DISTINCTION_AVAILABLE" as const,
    basis: "column_declared" as const,
    fields: Object.freeze(["is_credit"]),
    unavailableCode: BILLING_CAPABILITY_CODES.CREDIT_DISTINCTION_UNAVAILABLE,
    lossWhenClosed:
      "Billed money is overstated, because a credit reads as a charge — which UNDERSTATES exposure. The conservative direction, and still wrong.",
    blocks: "EXACT_MONEY",
  }),
  Object.freeze({
    capability: "BILLING_PERIOD_AVAILABLE" as const,
    basis: "column_declared" as const,
    fields: Object.freeze(["period_start", "period_end"]),
    unavailableCode: BILLING_CAPABILITY_CODES.BILLING_PERIOD_UNAVAILABLE,
    lossWhenClosed:
      "The reconciliation unit. An issue date says when the invoice was raised, not what it covers, so a late invoice and a missing one become indistinguishable and no period-level residual exists to compute.",
    blocks: "MONETARY_RECONCILIATION",
  }),
  Object.freeze({
    capability: "MIGRATION_LINEAGE_AVAILABLE" as const,
    basis: "column_declared" as const,
    fields: Object.freeze(["legacy_subscription_ref", "source_system"]),
    unavailableCode: BILLING_CAPABILITY_CODES.MIGRATION_LINEAGE_UNAVAILABLE,
    lossWhenClosed:
      "A re-keyed or migrated identity cannot be matched by the weaker fallback route. NOT a substitute for the obligation link: an authoritative obligation reference survives a re-key because it was never billing's internal key.",
    blocks: "ATTRIBUTION",
  }),
  Object.freeze({
    capability: "EXPECTED_SETTLEMENT_COUNT_AVAILABLE" as const,
    basis: "populated_on_every_row" as const,
    // Deliberately NO field on this extract. The fact is not billing's to state, and declaring a
    // column for it here would invite billing to answer a question about what was expected OF it.
    fields: Object.freeze([]),
    unavailableCode: BILLING_CAPABILITY_CODES.SETTLEMENT_COUNT_UNAVAILABLE,
    lossWhenClosed:
      "EVENT-level proof only. Two lines settling one obligation stay indistinguishable from two instalments of it, so NH reports MULTIPLE SETTLEMENTS OBSERVED and never a duplicate. On the synthetic evidence it unlocks NO additional money.",
    blocks: "EVENT_PROOF",
  }),
]);

// ── 3 · THE FIELD TABLE ───────────────────────────────────────────────────────────────────────────

/**
 * Three tiers, and there is NO `recommended` — the same trap, declared absent rather than merely
 * unused so it cannot be re-entered. In 2.0.0 `RECOMMENDED_FIELDS` feeds `missingRecommendedColumns`,
 * checked against a governed maximum whose pilot value is ZERO, so declaring a field "recommended"
 * would refuse extracts that previously passed with no remedy under anti-tuning.
 */
export type BillingFieldTier = "required" | "conditional" | "optional";

export type BillingFieldKind =
  | "identifier"
  | "date"
  | "money_decimal"
  | "currency_code"
  | "boolean_flag";

export type BillingPiiClass = "identifier_pseudonymous" | "operational";

/**
 * Each field carries its own justification, because the questions were asked before the field existed:
 *   `establishes`       — what business fact it states
 *   `neededBy`          — which capability needs it
 *   `withoutIt`         — the false positive or false negative that follows
 *   `sourceObservable`  — whether a billing system can genuinely state it
 *   `whenAbsent`        — what actually happens
 *   `owningSourceSystem`— who is normally asked for it
 */
export interface BillingFieldSpec {
  readonly name: string;
  readonly tier: BillingFieldTier;
  readonly kind: BillingFieldKind;
  readonly piiClass: BillingPiiClass;
  readonly description: string;
  readonly establishes: string;
  readonly neededBy: BillingCapability | "every_billing_line";
  readonly withoutIt: string;
  readonly sourceObservable: true;
  readonly whenAbsent: string;
  readonly createsIdentityObligation: false;
  readonly owningSourceSystem: "billing_or_erp" | "contract_or_clm";
  readonly since: string;
}

function field(spec: BillingFieldSpec): BillingFieldSpec {
  return Object.freeze(spec);
}

export const BILLING_EXTRACT_FIELDS: readonly BillingFieldSpec[] = Object.freeze([
  field({
    name: "invoice_ref",
    tier: "required",
    kind: "identifier",
    piiClass: "identifier_pseudonymous",
    description: "The billing system's own identifier for the invoice this line belongs to.",
    establishes: "Which document raised the charge.",
    neededBy: "every_billing_line",
    withoutIt: "Two lines of one invoice cannot be told from two separate invoices, so a consolidated invoice reads as duplicate billing.",
    sourceObservable: true,
    whenAbsent: "Row quarantined, NH-BX-2001.",
    createsIdentityObligation: false,
    owningSourceSystem: "billing_or_erp",
    since: "1.0.0",
  }),
  field({
    name: "invoice_line_ref",
    tier: "required",
    kind: "identifier",
    piiClass: "identifier_pseudonymous",
    description:
      "The line's identifier WITHIN its invoice. A position is acceptable here precisely because it is scoped to the invoice and is never used as a cross-system key.",
    establishes: "Which charge on that document this row is.",
    neededBy: "every_billing_line",
    withoutIt: "Two charges on one invoice collapse into one, and a partial charge reads as a full one.",
    sourceObservable: true,
    whenAbsent: "Row quarantined, NH-BX-2001.",
    createsIdentityObligation: false,
    owningSourceSystem: "billing_or_erp",
    since: "1.0.0",
  }),
  field({
    name: "invoice_raised_at",
    tier: "required",
    kind: "date",
    piiClass: "operational",
    description: "The date the billing system RAISED this line, as it holds it. Not a payment-clearing date and not the period the charge covers — the period is its own pair of fields.",
    establishes: "WHEN THE CHARGE WAS RAISED — the invoice-line issue date. Not when money arrived.",
    neededBy: "every_billing_line",
    withoutIt: "Nothing can be placed inside or outside the period under analysis, so the population is undefined.",
    sourceObservable: true,
    whenAbsent: "Row quarantined, NH-BX-2001.",
    createsIdentityObligation: false,
    owningSourceSystem: "billing_or_erp",
    since: "1.0.0",
  }),
  field({
    name: "invoice_line_amount",
    tier: "required",
    kind: "money_decimal",
    piiClass: "operational",
    description:
      "The amount CHARGED on this line in its own currency, as a plain decimal — not an amount received, collected or cleared. REQUIRED as a value, not merely as a column — unlike `expected_amount` on the other side.",
    establishes: "HOW MUCH WAS CHARGED on this line. Not how much was paid.",
    neededBy: "every_billing_line",
    withoutIt: "No residual can be computed at all.",
    sourceObservable: true,
    whenAbsent:
      "Row quarantined, NH-BX-2001. There is NO declared UNKNOWN on this side: what was OWED may be unknown, what was BILLED cannot be — billing that cannot value its own line cannot evidence it.",
    createsIdentityObligation: false,
    owningSourceSystem: "billing_or_erp",
    since: "1.0.0",
  }),
  field({
    name: "currency",
    tier: "required",
    kind: "currency_code",
    piiClass: "operational",
    description: "ISO 4217 alphabetic code, as the billing system holds it.",
    establishes: "The unit the amount is denominated in.",
    neededBy: "every_billing_line",
    withoutIt: "Amounts in different currencies would be compared as if commensurable.",
    sourceObservable: true,
    whenAbsent: "Row quarantined, NH-BX-2001. NH never converts and never infers a currency.",
    createsIdentityObligation: false,
    owningSourceSystem: "billing_or_erp",
    since: "1.0.0",
  }),
  field({
    name: "payer_ref",
    tier: "required",
    kind: "identifier",
    piiClass: "identifier_pseudonymous",
    description: "The account the line was billed to, pseudonymised.",
    establishes: "Who was charged.",
    neededBy: "every_billing_line",
    withoutIt: "A misallocation between siblings of one payer cannot be distinguished from missing money.",
    sourceObservable: true,
    whenAbsent: "Row quarantined, NH-BX-2001.",
    createsIdentityObligation: false,
    owningSourceSystem: "billing_or_erp",
    since: "1.0.0",
  }),

  // ── conditional · each absence closes exactly one named capability and rejects no row ──────────
  field({
    name: "obligation_ref",
    tier: "conditional",
    kind: "identifier",
    piiClass: "identifier_pseudonymous",
    description:
      "The CONTRACT system's obligation identifier, as billing received it at provisioning and carries it onto the settling line. It is the counterpart of the expectation extract's `schedule_line_ref`. It is NOT billing's internal subscription key and NOT the invoice number.",
    establishes: "WHICH OBLIGATION this line settles — the cross-system join.",
    neededBy: "BILLING_OBLIGATION_LINK_AVAILABLE",
    withoutIt:
      "The join falls back to whatever key billing happens to share with the contract system, which a re-key or a whole-book migration destroys. A timing-displacement hypothesis then cannot be refuted, so real missing money is held out pending attribution rather than claimed — the measured effect, not a predicted one.",
    sourceObservable: true,
    whenAbsent:
      "BILLING_OBLIGATION_LINK_AVAILABLE closes, FAIL-CLOSED, NH-BX-3001. No row is rejected: capability gating per detector, never global dataset rejection. NH NEVER derives this value.",
    createsIdentityObligation: false,
    owningSourceSystem: "billing_or_erp",
    since: "1.0.0",
  }),
  field({
    name: "is_credit",
    tier: "conditional",
    kind: "boolean_flag",
    piiClass: "operational",
    description:
      "Whether the line is a credit rather than a charge. Declaring the column is itself the capability: a blank then means 'not a credit', which is a fact.",
    establishes: "That this line reverses money rather than billing it.",
    neededBy: "CREDIT_DISTINCTION_AVAILABLE",
    withoutIt: "Credits read as charges, overstating billed money and understating exposure.",
    sourceObservable: true,
    whenAbsent: "CREDIT_DISTINCTION_AVAILABLE closes, NH-BX-3002. A credit is never netted into billed money.",
    createsIdentityObligation: false,
    owningSourceSystem: "billing_or_erp",
    since: "1.0.0",
  }),
  field({
    name: "period_start",
    tier: "conditional",
    kind: "date",
    piiClass: "operational",
    description: "First day of the service period this line covers — not the date it was issued.",
    establishes: "What the charge is for, in time.",
    neededBy: "BILLING_PERIOD_AVAILABLE",
    withoutIt: "No period-level reconciliation unit exists, and a late invoice is indistinguishable from a missing one.",
    sourceObservable: true,
    whenAbsent: "BILLING_PERIOD_AVAILABLE closes, NH-BX-3003.",
    createsIdentityObligation: false,
    owningSourceSystem: "billing_or_erp",
    since: "1.0.0",
  }),
  field({
    name: "period_end",
    tier: "conditional",
    kind: "date",
    piiClass: "operational",
    description: "Last day of the service period this line covers, inclusive.",
    establishes: "The closing bound of what the charge is for.",
    neededBy: "BILLING_PERIOD_AVAILABLE",
    withoutIt: "The unit's bounds are open, so two adjacent periods cannot be told apart.",
    sourceObservable: true,
    whenAbsent: "BILLING_PERIOD_AVAILABLE closes, NH-BX-3003.",
    createsIdentityObligation: false,
    owningSourceSystem: "billing_or_erp",
    since: "1.0.0",
  }),

  // ── optional · refinements whose absence closes a capability and nothing else ──────────────────
  field({
    name: "legacy_subscription_ref",
    tier: "optional",
    kind: "identifier",
    piiClass: "identifier_pseudonymous",
    description: "The identity this line's subscription carried BEFORE a billing migration, where billing retained one.",
    establishes: "That two billing identities are the same thing across a migration — stated by billing, not inferred.",
    neededBy: "MIGRATION_LINEAGE_AVAILABLE",
    withoutIt: "A migrated book reads as unmatched identity unless the obligation link carries it instead.",
    sourceObservable: true,
    whenAbsent: "MIGRATION_LINEAGE_AVAILABLE closes, NH-BX-3004. A WEAKER fallback than obligation_ref, never a substitute.",
    createsIdentityObligation: false,
    owningSourceSystem: "billing_or_erp",
    since: "1.0.0",
  }),
  field({
    name: "source_system",
    tier: "optional",
    kind: "identifier",
    piiClass: "operational",
    description: "Which billing instance or platform emitted the row, where more than one did.",
    establishes: "Provenance within the billing estate.",
    neededBy: "MIGRATION_LINEAGE_AVAILABLE",
    withoutIt: "A migration boundary is invisible, so a re-key cannot be told from a data error.",
    sourceObservable: true,
    whenAbsent: "MIGRATION_LINEAGE_AVAILABLE closes, NH-BX-3004.",
    createsIdentityObligation: false,
    owningSourceSystem: "billing_or_erp",
    since: "1.0.0",
  }),
]);

export const BILLING_EXTRACT_COLUMNS: readonly string[] = Object.freeze(
  BILLING_EXTRACT_FIELDS.map((f) => f.name),
);

export const BILLING_REQUIRED_COLUMNS: readonly string[] = Object.freeze(
  BILLING_EXTRACT_FIELDS.filter((f) => f.tier === "required").map((f) => f.name),
);

// ── 4 · STOPPED, WITH REASONS ─────────────────────────────────────────────────────────────────────

/**
 * Candidates considered and NOT declared. Recorded because the reason is the useful part: a future
 * reader who re-proposes one should have to answer the objection rather than rediscover it.
 */
export const BILLING_STOPPED_FIELDS: readonly { readonly candidate: string; readonly why: string }[] =
  Object.freeze([
    Object.freeze({
      candidate: "expected_amount / amount_due",
      why:
        "The exact mirror of the expectation extract's stopped `invoice_ref`. It would let the BILLING system assert what was OWED, and the whole architecture rests on the expectation originating in a system other than the one that was supposed to act. Billing stating the expectation is billing auditing itself.",
    }),
    Object.freeze({
      candidate: "is_duplicate / is_erroneous / write_off",
      why:
        "A beneficiary-controlled flag over which lines count. Whoever wants a larger recovery number marks the inconvenient lines erroneous. Duplication is a CONCLUSION NH must reach from evidence, never a field the customer supplies.",
    }),
    Object.freeze({
      candidate: "settlement_count / expected_attempts",
      why:
        "Billing cannot state how many settlements an obligation EXPECTED — that is a fact about the contract, not about what billing did. It belongs to the expectation side if anywhere, and is declared here only as the unavailable capability EXPECTED_SETTLEMENT_COUNT_AVAILABLE so the gap has a name and an owner. It upgrades event-level proof and unlocks no additional money on the synthetic evidence.",
    }),
    Object.freeze({
      candidate: "any NH-derived or composite obligation_ref",
      why:
        "Explicitly not authorised. Never from payer, amount, date, invoice number, subscription id, row position or any composite of them. Every derived key breaks on re-keying and migration — the two events most likely to produce a six-figure false finding — and a reference NH authored is not a fact the source stated.",
    }),
    Object.freeze({
      candidate: "a row-grain flag (line / invoice / aggregate)",
      why:
        "It would hand grain authority to the beneficiary. An aggregate line stays structurally invisible at obligation grain, stated as a limitation rather than solved by a field the customer controls.",
    }),
    Object.freeze({
      candidate: "payment_status / dunning_state",
      why:
        "Not stopped on principle — it is the Detector #3 family, approved and deprioritised because it EXPLAINS dollars an existing detector already counts rather than finding new ones. Declaring it here would collect it before any consumer reads it, which is the defect the obligation_ref revert established.",
    }),
  ]);

// ── 5 · THE CLAIM BOUNDARY ────────────────────────────────────────────────────────────────────────

export const BILLING_EXTRACT_CLAIM_BOUNDARY = Object.freeze({
  observationOnly: true as const,
  constitutesProof: false as const,
  constitutesRevenue: false as const,
  note:
    "A valid billing extract states what billing did. It is not evidence that what billing did was correct, and no figure derived from it is Revenue Returned or Auditable Revenue.",
});
