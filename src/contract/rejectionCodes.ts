// Machine-readable rejection codes for the Customer Pilot Data Contract.
//
// WHY CODES AND NOT MESSAGES. A customer fixing a 10,000-row export needs to filter, count and route
// failures — "invalid_amount" in a sentence cannot be grouped, and an English message cannot be
// translated or matched by their pipeline without breaking the moment we improve the wording. A code
// is a stable contract; the message is not. Codes are therefore NEVER reused for a different meaning
// and never renumbered: a superseded code is retired, not recycled.
//
// RELATIONSHIP TO THE EXISTING ExclusionReason. The adapter's reasons stay exactly as they are and
// remain the authority on what is excluded. This module attaches a code, a severity and a
// remediation to each one. The mapping is exhaustive BY TYPE — adding an ExclusionReason without a
// code is a compile error, which is the point: a new way to reject data cannot reach a customer as
// an uncoded surprise.
import type { ExclusionReason } from "../assessment/types";

/**
 * What the rejection costs.
 *  • dataset_rejected — nothing is assessed; the file cannot be interpreted at all.
 *  • row_rejected     — this row is excluded with a reason; the rest of the dataset proceeds.
 *  • dataset_warning  — the dataset is usable but a capability is missing from every row.
 *  • row_warning      — the row is usable but measurably weaker, and the weakness is carried forward.
 *
 * Only `dataset_rejected` stops a dataset. There is no "auto_corrected" severity, and there must
 * never be one.
 */
export type RejectionSeverity = "dataset_rejected" | "dataset_warning" | "row_rejected" | "row_warning";

export interface RejectionCodeSpec {
  /** Stable, permanent identifier. Never reused for a different meaning. */
  readonly code: string;
  readonly severity: RejectionSeverity;
  /** One line a human can act on. Wording may change; the code may not. */
  readonly title: string;
  /** What the customer should actually do about it. */
  readonly remediation: string;
  readonly since: string;
}

function code(spec: RejectionCodeSpec): RejectionCodeSpec {
  return Object.freeze(spec);
}

// ── 1xxx · Dataset structure ──────────────────────────────────────────────────────────────────────

export const DATASET_CODES = Object.freeze({
  EMPTY_DATASET: code({
    code: "NH-DC-1001",
    severity: "dataset_rejected",
    title: "The dataset contains no data rows.",
    remediation: "Export at least one row covering the agreed observation window.",
    since: "1.0.0",
  }),
  MISSING_REQUIRED_COLUMN: code({
    code: "NH-DC-1002",
    severity: "dataset_rejected",
    title: "A required column is absent from the header.",
    remediation: "Add the column, or map an existing source header to it before uploading.",
    since: "1.0.0",
  }),
  DUPLICATE_COLUMN: code({
    code: "NH-DC-1003",
    severity: "dataset_rejected",
    title: "The header contains the same column twice.",
    remediation: "Remove or rename the duplicate; which one wins cannot be guessed.",
    since: "1.0.0",
  }),
  BLANK_COLUMN_NAME: code({
    code: "NH-DC-1004",
    severity: "dataset_rejected",
    title: "The header contains a blank column name.",
    remediation: "Name every column, or delete the empty one from the export.",
    since: "1.0.0",
  }),
  UNDECLARED_COLUMN: code({
    code: "NH-DC-1005",
    severity: "dataset_rejected",
    title: "The dataset contains a column the contract does not declare.",
    remediation:
      "Remove the column from the export. Undeclared columns are rejected rather than ignored, so that no unnecessary data travels with the file.",
    since: "1.0.0",
  }),
  MULTIPLE_CURRENCIES: code({
    code: "NH-DC-1006",
    severity: "dataset_rejected",
    title: "The dataset mixes more than one currency.",
    remediation: "Supply one dataset per currency. Amounts are never converted or summed across currencies.",
    since: "1.0.0",
  }),
  MISSING_TENANT_BINDING: code({
    code: "NH-DC-1007",
    severity: "dataset_rejected",
    title: "No tenant boundary was supplied for the dataset.",
    remediation:
      "Supply the boundary out-of-band with the upload. It is deliberately not read from the file, because a column in the file could assert any tenant.",
    since: "1.0.0",
  }),
  MISSING_PROVENANCE: code({
    code: "NH-DC-1008",
    severity: "dataset_rejected",
    title: "Required provenance metadata is missing or incomplete.",
    remediation: "Declare the source systems, owning role, extraction method, extraction time and coverage window.",
    since: "1.0.0",
  }),
  MISSING_RECOMMENDED_COLUMN: code({
    code: "NH-DC-1010",
    severity: "dataset_warning",
    title: "A recommended column is absent from the export entirely.",
    remediation:
      "Supply the column to strengthen the assessment. Reported once for the dataset rather than once per row, because its absence is a property of the export, not of any individual row.",
    since: "1.0.0",
  }),
  COVERAGE_WINDOW_INVALID: code({
    code: "NH-DC-1009",
    severity: "dataset_rejected",
    title: "The declared coverage window is not a valid, ordered date range.",
    remediation: "Declare coverageStart and coverageEnd as calendar days with coverageStart <= coverageEnd.",
    since: "1.0.0",
  }),
});

// ── 2xxx · Row and field validation ───────────────────────────────────────────────────────────────

export const ROW_CODES = Object.freeze({
  UNPARSEABLE_ROW: code({
    code: "NH-DC-2001",
    severity: "row_rejected",
    title: "The row's column count does not match the header.",
    remediation: "Quote fields containing commas or newlines, then re-export.",
    since: "1.0.0",
  }),
  MISSING_REQUIRED_FIELD: code({
    code: "NH-DC-2002",
    severity: "row_rejected",
    title: "A required field is empty on this row.",
    remediation: "Populate the field. No default is substituted, because a substituted value would be indistinguishable from a real one.",
    since: "1.0.0",
  }),
  MALFORMED_DATE: code({
    code: "NH-DC-2003",
    severity: "row_rejected",
    title: "A date value could not be parsed.",
    remediation: "Use YYYY-MM-DD.",
    since: "1.0.0",
  }),
  AMBIGUOUS_DATE: code({
    code: "NH-DC-2004",
    severity: "row_rejected",
    title: "A numeric date is ambiguous between D/M/Y and M/D/Y.",
    remediation: "Use YYYY-MM-DD, or declare the locale explicitly. The interpretation is never guessed.",
    since: "1.0.0",
  }),
  LOCAL_TIMESTAMP_WITHOUT_OFFSET: code({
    code: "NH-DC-2005",
    severity: "row_rejected",
    title: "A timestamp carries a time of day but no UTC offset.",
    remediation:
      "Supply either a plain calendar day (YYYY-MM-DD) or a full UTC instant ending in Z. A local time without an offset is a different instant in every timezone.",
    since: "1.0.0",
  }),
  IMPOSSIBLE_DATE_SEQUENCE: code({
    code: "NH-DC-2006",
    severity: "row_rejected",
    title: "The row's dates are in an impossible order.",
    remediation: "Correct the source: an invoice cannot fall due before the contract is signed, and activation cannot precede signature.",
    since: "1.0.0",
  }),
  INVALID_AMOUNT: code({
    code: "NH-DC-2007",
    severity: "row_rejected",
    title: "A monetary value could not be interpreted exactly.",
    remediation: "Supply a plain decimal with no currency symbol, within the currency's minor-unit precision.",
    since: "1.0.0",
  }),
  AMBIGUOUS_AMOUNT: code({
    code: "NH-DC-2008",
    severity: "row_rejected",
    title: "A monetary value's grouping and decimal separators are ambiguous.",
    remediation: "Use a plain decimal (1234.56), or declare the amount format explicitly.",
    since: "1.0.0",
  }),
  ZERO_AMOUNT: code({
    code: "NH-DC-2009",
    severity: "row_rejected",
    title: "The obligated amount is zero.",
    remediation: "Remove the row, or supply the real obligation. Zero cannot be at risk.",
    since: "1.0.0",
  }),
  NEGATIVE_AMOUNT: code({
    code: "NH-DC-2010",
    severity: "row_rejected",
    title: "A monetary value is negative.",
    remediation: "Supply credits and reversals through refunded_at, not as a negative obligation.",
    since: "1.0.0",
  }),
  INVALID_BOOLEAN: code({
    code: "NH-DC-2011",
    severity: "row_rejected",
    title: "A boolean field holds a value that is neither true nor false.",
    remediation: "Use true/false (1/0, yes/no are also accepted). An unrecognized value is never read as false.",
    since: "1.0.0",
  }),
  INCONSISTENT_PAYMENT_DATA: code({
    code: "NH-DC-2012",
    severity: "row_rejected",
    title: "The row's payment fields contradict each other.",
    remediation: "Reconcile the paid flag, paid date and paid amount at source before re-exporting.",
    since: "1.0.0",
  }),
  PAID_EXCEEDS_OBLIGATION: code({
    code: "NH-DC-2013",
    severity: "row_rejected",
    title: "The settled amount exceeds the obligated amount.",
    remediation: "Confirm whether the obligation is understated or the settlement covers several invoices; split the rows accordingly.",
    since: "1.0.0",
  }),
  UNDATED_TERMINAL_STATE: code({
    code: "NH-DC-2014",
    severity: "row_rejected",
    title: "A refund or cancellation has no effective date.",
    remediation: "Supply refunded_at / cancelled_at, or status_effective_at. Without a date the state cannot be placed in time.",
    since: "1.0.0",
  }),
  CURRENCY_MISMATCH: code({
    code: "NH-DC-2015",
    severity: "row_rejected",
    title: "The row's currency differs from the dataset's currency.",
    remediation: "Move the row into a dataset for its own currency.",
    since: "1.0.0",
  }),
  DUPLICATE_CYCLE_ID: code({
    code: "NH-DC-2016",
    severity: "row_rejected",
    title: "Two rows claim the same cycle identity.",
    remediation: "Supply a stable subscription_id or cycle_id so each billing cycle appears exactly once.",
    since: "1.0.0",
  }),
  EXCLUDED_STATUS: code({
    code: "NH-DC-2017",
    severity: "row_rejected",
    title: "The row's status is excluded by the stamped policy.",
    remediation: "No action needed unless the status should be in scope; if so, change the policy before the pilot starts, never after.",
    since: "1.0.0",
  }),
  INTERNAL_OR_TEST_ACCOUNT: code({
    code: "NH-DC-2018",
    severity: "row_rejected",
    title: "The row is an internal or test account.",
    remediation: "No action needed. Test accounts are excluded so they cannot inflate observed exposure.",
    since: "1.0.0",
  }),
  MISSING_STABLE_CYCLE_KEY: code({
    code: "NH-DC-2019",
    severity: "row_warning",
    title: "The row has no stable cycle key, so its identity had to be derived.",
    remediation:
      "Supply subscription_id or cycle_id. A derived key (entity + dates) can collide between two genuinely different billing cycles, which would silently merge them.",
    since: "1.0.0",
  }),
  UNTIMED_PAYMENT_FLAG: code({
    code: "NH-DC-2020",
    severity: "row_warning",
    title: "Payment is asserted by a boolean with no settlement date.",
    remediation:
      "Supply next_invoice_paid_at. Without it the row cannot distinguish an on-time payment from a late one, and is marked accordingly.",
    since: "1.0.0",
  }),
  ROW_OUTSIDE_COVERAGE_WINDOW: code({
    code: "NH-DC-2021",
    severity: "row_rejected",
    title: "The row falls outside the declared coverage window.",
    remediation: "Correct the declared window or the export. A dataset must not contain rows it claims not to cover.",
    since: "1.0.0",
  }),
});

// ── 3xxx · Minimization and PII ───────────────────────────────────────────────────────────────────

export const PII_CODES = Object.freeze({
  PROHIBITED_COLUMN: code({
    code: "NH-DC-3001",
    severity: "dataset_rejected",
    title: "The dataset contains a column whose name indicates personal data.",
    remediation: "Remove the column at source and re-export. The pilot needs joins, dates and amounts — never people.",
    since: "1.0.0",
  }),
  PII_SHAPED_IDENTIFIER: code({
    code: "NH-DC-3002",
    severity: "row_rejected",
    title: "An identifier value looks like personal data (email, phone or payment card).",
    remediation:
      "Use an internal account key instead. The value is rejected rather than masked, so the file you uploaded and the file assessed stay identical.",
    since: "1.0.0",
  }),
});

// ── 4xxx · Identity, duplication and idempotency ──────────────────────────────────────────────────

export const IDENTITY_CODES = Object.freeze({
  DUPLICATE_SOURCE_ROW: code({
    code: "NH-DC-4001",
    severity: "row_rejected",
    title: "An identical row appears more than once in the dataset.",
    remediation: "De-duplicate at source. A repeated row would otherwise count the same exposure twice.",
    since: "1.0.0",
  }),
  TENANT_BOUNDARY_CONFLICT: code({
    code: "NH-DC-4002",
    severity: "dataset_rejected",
    title: "The dataset's declared boundary does not match the boundary it is being ingested into.",
    remediation: "Re-upload under the correct tenant boundary. Cross-boundary ingestion is refused, never reconciled.",
    since: "1.0.0",
  }),
});

// ── 5xxx · Versioning ─────────────────────────────────────────────────────────────────────────────

export const VERSION_CODES = Object.freeze({
  UNSUPPORTED_CONTRACT_VERSION: code({
    code: "NH-DC-5001",
    severity: "dataset_rejected",
    title: "The dataset declares a contract version this build cannot process.",
    remediation: "Re-export against a supported version. A newer or different major is refused rather than interpreted optimistically.",
    since: "1.0.0",
  }),
  MALFORMED_CONTRACT_VERSION: code({
    code: "NH-DC-5002",
    severity: "dataset_rejected",
    title: "The declared contract version is not a valid semantic version.",
    remediation: "Declare the version as MAJOR.MINOR.PATCH.",
    since: "1.0.0",
  }),
});

/**
 * EXHAUSTIVE map from the adapter's existing exclusion reasons to contract codes. Typed as a total
 * Record, so a new ExclusionReason fails the build until it is given a code — a new way to reject
 * customer data can never reach a customer uncoded.
 */
export const EXCLUSION_REASON_CODES: Readonly<Record<ExclusionReason, RejectionCodeSpec>> = Object.freeze({
  unparseable_row: ROW_CODES.UNPARSEABLE_ROW,
  missing_required_field: ROW_CODES.MISSING_REQUIRED_FIELD,
  malformed_date: ROW_CODES.MALFORMED_DATE,
  ambiguous_date: ROW_CODES.AMBIGUOUS_DATE,
  impossible_date_sequence: ROW_CODES.IMPOSSIBLE_DATE_SEQUENCE,
  invalid_amount: ROW_CODES.INVALID_AMOUNT,
  ambiguous_amount: ROW_CODES.AMBIGUOUS_AMOUNT,
  zero_amount: ROW_CODES.ZERO_AMOUNT,
  negative_amount: ROW_CODES.NEGATIVE_AMOUNT,
  invalid_boolean: ROW_CODES.INVALID_BOOLEAN,
  inconsistent_payment_data: ROW_CODES.INCONSISTENT_PAYMENT_DATA,
  paid_amount_exceeds_obligation: ROW_CODES.PAID_EXCEEDS_OBLIGATION,
  undated_terminal_state: ROW_CODES.UNDATED_TERMINAL_STATE,
  currency_mismatch: ROW_CODES.CURRENCY_MISMATCH,
  duplicate_cycle_id: ROW_CODES.DUPLICATE_CYCLE_ID,
  excluded_status: ROW_CODES.EXCLUDED_STATUS,
  internal_or_test_account: ROW_CODES.INTERNAL_OR_TEST_ACCOUNT,
});

/** Every code the contract can emit, for catalogue rendering and uniqueness checks. */
export const ALL_REJECTION_CODES: readonly RejectionCodeSpec[] = Object.freeze([
  ...Object.values(DATASET_CODES),
  ...Object.values(ROW_CODES),
  ...Object.values(PII_CODES),
  ...Object.values(IDENTITY_CODES),
  ...Object.values(VERSION_CODES),
]);

export function rejectionCode(code: string): RejectionCodeSpec | undefined {
  return ALL_REJECTION_CODES.find((c) => c.code === code);
}
