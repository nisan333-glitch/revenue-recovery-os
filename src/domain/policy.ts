// Policy — Trust Invariant #4: the definitions and thresholds that determine a Proof are
// VERSIONED data, not invisible timeless constants. Every approved Proof stamps the exact
// versions it used, so history stays reproducible even after policy changes. Static in-code for
// the prototype; the contract reserves future per-tenant, effective-dated policy without changing
// business rules.
import type { ApprovalPolicy } from "./authority";

export interface PolicyVersion {
  readonly policyVersion: string;
  /** Confidence gate for auditable (the old global PROOF_THRESHOLD, now versioned). */
  readonly proofThreshold: number;
  readonly confidenceMethodologyVersion: string;
  readonly baselineMethodId: string;
  readonly baselineMethodVersion: number;
  /** Human-readable statement of the baseline lock rule captured into each Proof. */
  readonly baselineLockPolicy: string;
  readonly approval: ApprovalPolicy;
}

/**
 * The current policy version. Changing threshold/methodology here affects FUTURE Proofs only —
 * approved Proofs carry their own stamped versions and are never re-judged under a new policy.
 */
export const CURRENT_POLICY: PolicyVersion = Object.freeze({
  policyVersion: "policy-2026.1",
  proofThreshold: 80,
  confidenceMethodologyVersion: "confidence-2026.1",
  baselineMethodId: "matched_historical_cohort",
  baselineMethodVersion: 1,
  baselineLockPolicy:
    "Baseline must be established and locked before the intervention and before the outcome is observed.",
  approval: {
    policyVersion: "approval-2026.1",
    materialityMinor: 0, // prototype: every claim requires a distinct approver
    requireDistinctApprover: true,
  },
});
