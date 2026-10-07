// Reason codes for the BILLING EXTRACT — a FOURTH catalogue, and deliberately not a branch of any
// existing one.
//
// `NH-DC-####` asks "is this observation file valid?", `NH-AG-####` asks "is this dataset fit for a
// pilot?", `NH-EX-####` asks "did the source state an obligation NH can trust?". This one asks the
// other half of the reconciliation question: **did the billing system state a charge NH can trust,
// and did it say which obligation that charge settles?**
//
// Folding it into NH-EX would be the sharper mistake rather than merely untidy. The two extracts exist
// precisely BECAUSE they come from different systems, and a customer reading a single catalogue would
// lose the one fact the architecture turns on — which system owns the defect, and therefore who has to
// fix it. A missing `obligation_ref` is a billing-system question; a missing `expected_amount` is a
// contract-system question; one code space would blur them.
//
//   1xxx — the EXTRACT is unusable as a whole.
//   2xxx — one ROW cannot be trusted. The row is QUARANTINED, never counted — not in a detector, not
//          in a union, not in a recall denominator.
//   3xxx — a CAPABILITY is unavailable. An UNKNOWN, NOT a rejection: the extract is still valid and
//          still supports every capability that remains. Capability gating per detector, never global
//          dataset rejection.
//
// Codes are permanent. A superseded code is RETIRED, never recycled — a historical record cites a code,
// and a recycled code silently rewrites what that record said.

export type BillingCodeSeverity =
  /** The whole extract cannot be read. */
  | "extract_unusable"
  /** One row is quarantined. The rest of the extract is unaffected. */
  | "row_quarantined"
  /** A named capability is closed. Nothing is rejected and no money is lost. */
  | "capability_unavailable";

export interface BillingCodeSpec {
  readonly code: string;
  readonly severity: BillingCodeSeverity;
  readonly title: string;
  /** What someone must actually do. For 3xxx this is usually "supply a column", not "fix a value". */
  readonly remediation: string;
  /** WHICH SYSTEM owns the remedy. The field that makes a readiness report actionable. */
  readonly ownedBy: "billing_or_erp" | "contract_or_clm" | "either";
  readonly since: string;
}

function code(spec: BillingCodeSpec): BillingCodeSpec {
  return Object.freeze(spec);
}

// ── 1xxx · the extract is unusable ────────────────────────────────────────────────────────────────

export const BILLING_EXTRACT_CODES = Object.freeze({
  EMPTY_EXTRACT: code({
    code: "NH-BX-1001",
    severity: "extract_unusable",
    title: "The billing extract contains no rows.",
    remediation:
      "Supply the invoice lines the billing system raised over the period under analysis. An empty extract is not 'nothing was billed' and is never read as such: NH cannot tell the two apart, so it refuses rather than reporting every obligation unsettled — which would manufacture the largest possible finding out of a missing file.",
    ownedBy: "billing_or_erp",
    since: "1.0.0",
  }),
  MISSING_REQUIRED_COLUMN: code({
    code: "NH-BX-1002",
    severity: "extract_unusable",
    title: "A required column is absent from the extract header.",
    remediation:
      "Add the named column. Only six facts are required — the invoice, the line within it, the date, the amount, the currency and the payer — because without them a billing line cannot be identified or valued at all. Every other fact is a named capability and never a reason to refuse a file.",
    ownedBy: "billing_or_erp",
    since: "1.0.0",
  }),
  UNDECLARED_COLUMN: code({
    code: "NH-BX-1003",
    severity: "extract_unusable",
    title: "The extract carries a column this contract does not declare.",
    remediation:
      "Remove the column or raise it for declaration. An undeclared column is refused rather than ignored: silently dropping it would let a customer believe NH read a fact it never looked at.",
    ownedBy: "billing_or_erp",
    since: "1.0.0",
  }),
  DUPLICATE_COLUMN: code({
    code: "NH-BX-1004",
    severity: "extract_unusable",
    title: "The same column appears more than once in the header.",
    remediation:
      "Emit each column once. Which duplicate wins would otherwise be decided by file position, and file position is the author's lever — the pilot-dataset collision rule applies here too.",
    ownedBy: "billing_or_erp",
    since: "1.0.0",
  }),
});

// ── 2xxx · one row is quarantined ─────────────────────────────────────────────────────────────────

export const BILLING_ROW_CODES = Object.freeze({
  MISSING_REQUIRED_VALUE: code({
    code: "NH-BX-2001",
    severity: "row_quarantined",
    title: "A required cell is blank.",
    remediation:
      "Populate it. There is no UNKNOWN amount on this side: a charge the billing system cannot value is not a charge it can evidence, which is the asymmetry with the expectation extract — what was OWED may be unknown, what was BILLED cannot be.",
    ownedBy: "billing_or_erp",
    since: "1.0.0",
  }),
  MALFORMED_DATE: code({
    code: "NH-BX-2002",
    severity: "row_quarantined",
    title: "A date cannot be parsed.",
    remediation: "Use YYYY-MM-DD. NH does not guess at a date it cannot read.",
    ownedBy: "billing_or_erp",
    since: "1.0.0",
  }),
  MALFORMED_AMOUNT: code({
    code: "NH-BX-2003",
    severity: "row_quarantined",
    title: "An invoice-line amount cannot be parsed as a decimal.",
    remediation:
      "Emit a plain decimal with at most two fractional digits, in the original currency, with no grouping separators and no currency symbol. NH never normalises a number it cannot read.",
    ownedBy: "billing_or_erp",
    since: "1.0.0",
  }),
  NEGATIVE_AMOUNT_NOT_MARKED_CREDIT: code({
    code: "NH-BX-2004",
    severity: "row_quarantined",
    title: "A negative invoice-line amount is not marked as a credit.",
    remediation:
      "A negative line is a credit and must say so. Reading it as a charge would NET it into billed money, which the sign convention forbids: a credit is not a billing event, and silently subtracting it would shrink measured exposure.",
    ownedBy: "billing_or_erp",
    since: "1.0.0",
  }),
  PERIOD_END_BEFORE_START: code({
    code: "NH-BX-2005",
    severity: "row_quarantined",
    title: "The billed period ends before it starts.",
    remediation:
      "Correct the bounds. NH does not reorder them: a reversed pair may equally be a typo or two different periods conflated, and guessing which would decide what the row settles.",
    ownedBy: "billing_or_erp",
    since: "1.0.0",
  }),
  DUPLICATE_BILLING_LINE_IDENTITY: code({
    code: "NH-BX-2006",
    severity: "row_quarantined",
    title: "Two rows share the same (invoice, invoice line) identity.",
    remediation:
      "Emit each invoice line once. BOTH rows are quarantined, regardless of order or identical content — the pilot-dataset collision rule. Accepting the first would let the file author choose which survives by reordering, and that choice can change the measured amount.",
    ownedBy: "billing_or_erp",
    since: "1.0.0",
  }),
  CURRENCY_NOT_ISO: code({
    code: "NH-BX-2007",
    severity: "row_quarantined",
    title: "The currency is not a three-letter ISO code.",
    remediation:
      "Use the ISO 4217 alphabetic code as the billing system holds it. NH never converts and never infers a currency, so an unreadable one leaves the row unvaluable.",
    ownedBy: "billing_or_erp",
    since: "1.0.0",
  }),
});

// ── 3xxx · a capability is unavailable ────────────────────────────────────────────────────────────

export const BILLING_CAPABILITY_CODES = Object.freeze({
  OBLIGATION_LINK_UNAVAILABLE: code({
    code: "NH-BX-3001",
    severity: "capability_unavailable",
    title: "The billing side does not state which obligation each line settles.",
    remediation:
      "Emit `obligation_ref` carrying the contract system's own obligation identifier, as billing received it at provisioning. It must be the identifier the CONTRACT system issued — not billing's internal subscription key, not the invoice number, and NEVER a value derived from payer, amount, date or row position. If billing genuinely does not carry it, report this capability unavailable: that is a true answer, and a fabricated reference would be a false one.",
    ownedBy: "billing_or_erp",
    since: "1.0.0",
  }),
  CREDIT_DISTINCTION_UNAVAILABLE: code({
    code: "NH-BX-3002",
    severity: "capability_unavailable",
    title: "The extract does not distinguish credits from charges.",
    remediation:
      "Declare `is_credit`. Without it every line is read as a charge, which OVERSTATES what was billed and therefore UNDERSTATES exposure — the conservative direction, and still wrong.",
    ownedBy: "billing_or_erp",
    since: "1.0.0",
  }),
  BILLING_PERIOD_UNAVAILABLE: code({
    code: "NH-BX-3003",
    severity: "capability_unavailable",
    title: "The extract does not state which service period each line settles.",
    remediation:
      "Declare `period_start` and `period_end`. The issue date is when the invoice was raised, not what it covers, and without the covered period a timing hypothesis cannot even be FORMED — so a late invoice and a missing one become indistinguishable.",
    ownedBy: "billing_or_erp",
    since: "1.0.0",
  }),
  MIGRATION_LINEAGE_UNAVAILABLE: code({
    code: "NH-BX-3004",
    severity: "capability_unavailable",
    title: "The extract retains no prior identity across a billing migration or re-key.",
    remediation:
      "Declare `legacy_subscription_ref` and `source_system` where a migration occurred. This is a WEAKER fallback than `obligation_ref` and is not a substitute for it: an authoritative obligation reference survives a re-key because it was never billing's internal key, whereas a retained legacy key only helps where billing happened to retain one.",
    ownedBy: "billing_or_erp",
    since: "1.0.0",
  }),
  SETTLEMENT_COUNT_UNAVAILABLE: code({
    code: "NH-BX-3005",
    severity: "capability_unavailable",
    title: "Nothing states how many settlements an obligation expected.",
    remediation:
      "This fact belongs to the CONTRACT system, not to billing — billing cannot state what was expected of it. Until it exists, two lines settling one obligation are indistinguishable from two instalments of it, so NH reports MULTIPLE SETTLEMENTS OBSERVED and never a duplicate. It upgrades EVENT-level proof and, on the synthetic evidence, unlocks no additional money.",
    ownedBy: "contract_or_clm",
    since: "1.0.0",
  }),
});

/** Every code, for the uniqueness and retirement guards. */
export const ALL_BILLING_CODES: readonly BillingCodeSpec[] = Object.freeze([
  ...Object.values(BILLING_EXTRACT_CODES),
  ...Object.values(BILLING_ROW_CODES),
  ...Object.values(BILLING_CAPABILITY_CODES),
]);

/**
 * RETIRED codes. Empty today, and declared rather than omitted so the rule has somewhere to be
 * enforced the first time a code is superseded.
 */
export const RETIRED_BILLING_CODES: readonly string[] = Object.freeze([]);
