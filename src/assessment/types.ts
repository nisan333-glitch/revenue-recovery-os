// Revenue Opportunity Assessment — DOMAIN-NEUTRAL core types.
//
// This layer knows nothing about SaaS, activation, invoices, or ARPA. It speaks only in neutral
// concepts: an Entity has an Expectation, an Observation may confirm it, a Monetary Event may be
// paid, and a Deviation is the gap. The SaaS Activation vocabulary lives entirely in the adapter.
//
// The unit of analysis (grain) is the ExpectationCycle: one entity, one expectation window, and the
// single monetary event associated with it. `cycleId`, `entityId` and `sourceRowId` are three
// DISTINCT identities — an account may hold many cycles, so entity uniqueness is never assumed.
import type { Money } from "../domain/money";
import type { AssessmentPolicy } from "./policy";

/** Explicit, mutually exclusive payment state of a monetary event, evaluated as-of the analysis cut-off. */
export type PaymentState =
  | "NotYetDue" // due date is after asOf — cannot be "unpaid" yet
  | "Unpaid" // due on/before asOf, no settling payment observed by asOf
  | "PartiallyPaid" // a payment observed by asOf, but below the invoice amount
  | "PaidOnTime" // paid in full on/before the due date
  | "PaidLate" // paid in full after the due date but on/before asOf
  | "Refunded" // settled then reversed/credited
  | "Cancelled" // the obligation was cancelled
  | "Unknown"; // insufficient data to classify

export interface MonetaryEvent {
  readonly dueAt: string; // ISO date (YYYY-MM-DD), timezone-agnostic
  readonly amount: Money; // gross obligation, exact minor units
  /** Observed settling time. null = no settling payment recorded. */
  readonly paidAt: string | null; // ISO date | null
  /** Observed settled amount when known (for partial detection). null = unknown. */
  readonly paidAmount: Money | null;
  readonly refunded: boolean;
  readonly cancelled: boolean;
}

export interface ExpectationCycle {
  /** Stable identity of THIS cycle — distinct from the entity and the source row. */
  readonly cycleId: string;
  /** Provenance: the originating CSV row identity. */
  readonly sourceRowId: string;
  /** The owning entity (account). NOT assumed unique — one entity may own many cycles. */
  readonly entityId: string;
  /** When the expectation began (e.g. signed/committed). ISO date. */
  readonly expectationAt: string;
  /** When the expected observation occurred (e.g. activation). null = not observed. ISO date. */
  readonly observationAt: string | null;
  readonly monetaryEvent: MonetaryEvent;
  readonly currency: string;
  /** Raw lifecycle status from the source, used for inclusion/exclusion rules. */
  readonly statusRaw: string | null;
  /** Optional stratification dimensions (plan, segment, period…) for future matched estimation. */
  readonly attributes: Readonly<Record<string, string>>;
}

/** Why a source row never became an accepted cycle, or why an accepted cycle is excluded downstream. */
export type ExclusionReason =
  | "unparseable_row"
  | "missing_required_field"
  | "malformed_date"
  | "ambiguous_date"
  | "invalid_amount"
  | "zero_amount"
  | "negative_amount"
  | "currency_mismatch"
  | "duplicate_cycle_id"
  | "excluded_status"
  | "internal_or_test_account";

export interface ExclusionRecord {
  readonly sourceRowId: string;
  readonly reason: ExclusionReason;
  readonly detail: string;
}

/** The result of the adapter mapping one source row: either a cycle or an exclusion. */
export type RowOutcome =
  | { readonly kind: "cycle"; readonly cycle: ExpectationCycle }
  | { readonly kind: "excluded"; readonly exclusion: ExclusionRecord };

/**
 * OBSERVED breakdown over the stalled (deviation) cohort. Every figure is exact minor units in a
 * single currency. Nothing here is estimated or forecast — it is read directly from the records.
 */
export interface ObservedSummary {
  readonly currency: string;
  /** Cycles in the stalled cohort. */
  readonly stalledCount: number;
  /** Σ amount over stalled cycles whose invoice is due on/before asOf and not cancelled/refunded. */
  readonly grossEligible: Money;
  /** Σ amount over stalled cycles classified Unpaid — the ONLY figure eligible for the headline. */
  readonly observedUnpaid: Money;
  /** Σ outstanding (amount − paidAmount) over PartiallyPaid stalled cycles. Never in the headline. */
  readonly partialOutstanding: Money;
  /** Σ amount over stalled cycles excluded from the eligible universe (cancelled/refunded/zero/etc.). */
  readonly excludedValue: Money;
  /** Σ amount over stalled cycles classified Unknown. */
  readonly unknownValue: Money;
  /** Count of stalled cycles per payment state. */
  readonly stateCounts: Readonly<Record<PaymentState, number>>;
}

/** The four money states are permanently separated. Estimated and Forecast are absent in the slice. */
export type NotCalculated = "unavailable_in_validation_slice";

export interface AssessmentResult {
  readonly assessmentId: string; // deterministic: derived from fingerprint + policy identity
  readonly createdAt: string; // caller-supplied (deterministic input; never Date.now inside)
  /** Local one-way hash of the source file. Held in memory only — never logged or transmitted. */
  readonly sourceFingerprint: string;
  readonly fingerprintAlgo: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly parserVersion: string;
  readonly policy: AssessmentPolicy;
  readonly acceptedCycleCount: number;
  readonly excludedRowCount: number;
  readonly exclusions: readonly ExclusionRecord[];
  readonly stalledCount: number;
  /** Cycles still within their window (deadline after asOf) — not stalled, not confirmed non-deviant. */
  readonly undeterminedCount: number;
  readonly referenceCount: number;
  readonly observed: ObservedSummary;
  readonly estimated: NotCalculated; // structurally not calculated in the thin slice
  readonly forecast: NotCalculated; // structurally not calculated in the thin slice
  readonly proven: Money; // structurally zero in M1
}
