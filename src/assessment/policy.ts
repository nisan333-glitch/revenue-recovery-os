// Assessment Policy — the versioned, stamped definition of ONE assessment run. Every result carries
// the exact policy it was computed under, so any figure is reproducible and any parameter change
// (e.g. the stall threshold N) produces a NEW result rather than silently mutating a prior one.
//
// Neutral: the policy holds no SaaS vocabulary. The human-readable `activationDefinition` /
// `paymentDefinition` strings are supplied by the adapter and captured verbatim for the audit trail.

export interface AssessmentPolicy {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly grain: "ExpectationCycle";
  /** N: max days from expectation to observation before a cycle is a Deviation (stalled). */
  readonly stallThresholdDays: number;
  /** Analysis cut-off (ISO date). No row may be classified using information after this date. */
  readonly asOf: string;
  /** Single currency per assessment (v1). Cross-currency rows are excluded, never aggregated. */
  readonly currency: string;
  /** Raw statuses to exclude entirely (test/internal/etc). Case-insensitive match. */
  readonly excludedStatuses: readonly string[];
  /** Human-readable definitions (from the adapter) captured for the audit trail. */
  readonly activationDefinition: string;
  readonly paymentDefinition: string;
  /** v1: cycles are analysed as-is; no aggregation across rows. */
  readonly aggregationMethod: "none";
  /** Thin slice: Estimated Leakage is deliberately not calculated. */
  readonly baselineMethod: "not_calculated";
  readonly calculationMethodVersion: string;
}

export const ASSESSMENT_CALC_VERSION = "assess-2026.1-thin";

export function makePolicy(input: {
  policyId?: string;
  policyVersion?: string;
  stallThresholdDays: number;
  asOf: string;
  currency: string;
  excludedStatuses?: readonly string[];
  activationDefinition?: string;
  paymentDefinition?: string;
}): AssessmentPolicy {
  if (!Number.isInteger(input.stallThresholdDays) || input.stallThresholdDays < 0) {
    throw new Error(`AssessmentPolicy: stallThresholdDays must be a non-negative integer (got ${input.stallThresholdDays})`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) {
    throw new Error(`AssessmentPolicy: asOf must be an ISO date YYYY-MM-DD (got ${JSON.stringify(input.asOf)})`);
  }
  if (!input.currency) throw new Error("AssessmentPolicy: currency is required");
  return Object.freeze({
    policyId: input.policyId ?? "policy-default",
    policyVersion: input.policyVersion ?? "1",
    grain: "ExpectationCycle" as const,
    stallThresholdDays: input.stallThresholdDays,
    asOf: input.asOf,
    currency: input.currency,
    excludedStatuses: Object.freeze([...(input.excludedStatuses ?? [])]),
    activationDefinition:
      input.activationDefinition ??
      "Expectation observed (activated) within N days of the expectation start; otherwise Deviation (stalled).",
    paymentDefinition:
      input.paymentDefinition ??
      "Monetary event settled in full on or before the analysis cut-off (asOf).",
    aggregationMethod: "none" as const,
    baselineMethod: "not_calculated" as const,
    calculationMethodVersion: ASSESSMENT_CALC_VERSION,
  });
}
