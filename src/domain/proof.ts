// Proof — the immutable, versioned snapshot. Trust Invariant #4/#5 + clarification #1:
// once created, a Proof is NEVER mutated (including its status). Historical values are READ
// from the snapshot, never recomputed from current policy/threshold/priors/model or from
// mutable Case fields. Reversals/corrections create NEW linked records; the original and the
// whole chain are preserved, and the "current effective" view folds the chain without ever
// double-counting an original and its successor.
import type { RecoveryReason } from "./types";
import { type Money, subMoney, clampNonNegative, zeroMoney } from "./money";

export type ProofStatus = "Approved" | "Reversed" | "Superseded" | "Corrected";

export interface Proof {
  readonly proofId: string;
  readonly recoveryCaseId: string;
  /** Chain identity: all revisions of one recovery share a chainId (the first proofId). */
  readonly chainId: string;
  readonly proofVersion: number;
  readonly createdAt: string; // system-recorded (TimestampAuthority)
  readonly approvedAt: string; // system-recorded
  /** Set at creation, NEVER changed. A reversal is a NEW record, not a status edit. */
  readonly status: ProofStatus;
  readonly currency: string;
  readonly collectedAmount: Money;
  readonly baselineAmount: Money;
  readonly revenueReturned: Money; // frozen = collected − baseline at approval
  readonly excludedRecoveryAmount: Money;
  readonly exclusionStatement: string; // mandatory (zero must be an explicit assertion)
  readonly recoveryReason: NonNullable<RecoveryReason>;
  readonly attribution: string;
  readonly evidenceRefs: string[];
  readonly baselineId: string;
  readonly baselineMethodId: string;
  readonly baselineVersion: number;
  readonly baselineLockPolicy: string; // clarification #2 — the lock rule, captured
  readonly policyVersion: string;
  readonly confidenceMethodologyVersion: string;
  readonly proofThresholdUsed: number;
  readonly confidenceUsed: number;
  readonly approvedBy: string; // proofApprover actor id (must differ from owner)
  readonly previousProofId: string | null; // supersedes link
}

/** Inputs an approval must supply. Money/versions are captured verbatim into the snapshot. */
export interface ProofApprovalInput {
  proofId: string;
  recoveryCaseId: string;
  approvedAt: string;
  collectedAmount: Money;
  baselineAmount: Money;
  excludedRecoveryAmount: Money;
  exclusionStatement: string;
  recoveryReason: NonNullable<RecoveryReason>;
  attribution: string;
  evidenceRefs: string[];
  baselineId: string;
  baselineMethodId: string;
  baselineVersion: number;
  baselineLockPolicy: string;
  policyVersion: string;
  confidenceMethodologyVersion: string;
  proofThresholdUsed: number;
  confidenceUsed: number;
  approvedBy: string;
}

/**
 * Freeze an approved Proof from validated inputs. revenueReturned is computed ONCE here
 * (collected − baseline) and then frozen; it is never recomputed elsewhere.
 */
export function createApprovedProof(input: ProofApprovalInput): Proof {
  if (!input.exclusionStatement || !input.exclusionStatement.trim()) {
    throw new Error("Proof: an explicit exclusion statement is mandatory (zero must be asserted).");
  }
  const revenueReturned = clampNonNegative(
    subMoney(input.collectedAmount, input.baselineAmount),
  );
  return Object.freeze({
    proofId: input.proofId,
    recoveryCaseId: input.recoveryCaseId,
    chainId: input.proofId, // first version: chain is itself
    proofVersion: 1,
    createdAt: input.approvedAt,
    approvedAt: input.approvedAt,
    status: "Approved" as const,
    currency: input.collectedAmount.currency,
    collectedAmount: input.collectedAmount,
    baselineAmount: input.baselineAmount,
    revenueReturned,
    excludedRecoveryAmount: input.excludedRecoveryAmount,
    exclusionStatement: input.exclusionStatement,
    recoveryReason: input.recoveryReason,
    attribution: input.attribution,
    evidenceRefs: [...input.evidenceRefs],
    baselineId: input.baselineId,
    baselineMethodId: input.baselineMethodId,
    baselineVersion: input.baselineVersion,
    baselineLockPolicy: input.baselineLockPolicy,
    policyVersion: input.policyVersion,
    confidenceMethodologyVersion: input.confidenceMethodologyVersion,
    proofThresholdUsed: input.proofThresholdUsed,
    confidenceUsed: input.confidenceUsed,
    approvedBy: input.approvedBy,
    previousProofId: null,
  });
}

/**
 * A later event (refund, chargeback, dispute, correction) produces a NEW linked record.
 * The original is returned untouched; the successor carries the new status + amounts.
 * Never mutates `original` (clarification #1).
 */
export function reviseProof(
  original: Proof,
  change: {
    newProofId: string;
    status: Extract<ProofStatus, "Reversed" | "Superseded" | "Corrected">;
    at: string;
    collectedAmount?: Money;
    baselineAmount?: Money;
    excludedRecoveryAmount?: Money;
    exclusionStatement?: string;
    attribution?: string;
    approvedBy: string;
  },
): Proof {
  const collectedAmount =
    change.status === "Reversed"
      ? zeroMoney(original.currency)
      : change.collectedAmount ?? original.collectedAmount;
  const baselineAmount = change.baselineAmount ?? original.baselineAmount;
  const revenueReturned =
    change.status === "Reversed"
      ? zeroMoney(original.currency)
      : clampNonNegative(subMoney(collectedAmount, baselineAmount));
  return Object.freeze({
    ...original,
    proofId: change.newProofId,
    proofVersion: original.proofVersion + 1,
    createdAt: change.at,
    approvedAt: change.at,
    status: change.status,
    collectedAmount,
    baselineAmount,
    revenueReturned,
    excludedRecoveryAmount: change.excludedRecoveryAmount ?? original.excludedRecoveryAmount,
    exclusionStatement: change.exclusionStatement ?? original.exclusionStatement,
    attribution: change.attribution ?? original.attribution,
    approvedBy: change.approvedBy,
    previousProofId: original.proofId,
  });
}

/**
 * Current effective view: the latest record in each chain (highest proofVersion), optionally
 * as-of a timestamp for point-in-time historical reporting. Never returns both an original and
 * its successor — exactly one record per chain — so nothing is double-counted.
 */
export function effectiveProofs(all: Proof[], asOf?: string): Proof[] {
  const byChain = new Map<string, Proof>();
  for (const p of all) {
    if (asOf && p.approvedAt > asOf) continue;
    const cur = byChain.get(p.chainId);
    if (!cur || p.proofVersion > cur.proofVersion) byChain.set(p.chainId, p);
  }
  return [...byChain.values()];
}

/** A proof counts toward proven/returned only if its latest effective status is not Reversed. */
export function isEffectiveRecovery(p: Proof): boolean {
  return p.status !== "Reversed";
}

/**
 * Double-approval guard. True when the case already has an effective (non-reversed) approved proof.
 * A second independent approval would open a NEW chain and double-count the same recovery, so the
 * state layer must block it (a legitimate later change is a linked reversal/correction, not a new
 * chain). After a reversal, the case has no effective recovery and may be re-approved.
 */
export function hasEffectiveRecoveryForCase(all: Proof[], caseId: string): boolean {
  return effectiveProofs(all).some(
    (p) => p.recoveryCaseId === caseId && isEffectiveRecovery(p),
  );
}
