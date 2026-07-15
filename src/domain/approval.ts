// Approval — the trust gates that must all pass before an immutable Proof is created. Pure and
// testable; the state layer calls these. Enforces, in one place: separation of authority
// (approver ≠ owner), baseline temporal validity (locked before intervention/outcome), mandatory
// exclusion statement, and independent evidence for auditable claims. Fails closed.
import { type Proof, createApprovedProof, reviseProof } from "./proof";
import { type Baseline, baselineTemporallyValid } from "./baseline";
import { type Evidence, hasIndependentEvidence } from "./evidence";
import { type Actor, canApproveProof } from "./authority";
import type { PolicyVersion } from "./policy";
import { money } from "./money";
import type { RecoveryReason } from "./types";

export interface CaseApprovalContext {
  proofId: string;
  recoveryCaseId: string;
  approvedAt: string; // system-recorded (TimestampAuthority)
  ownerActorId: string | null;
  approverActor: Actor;
  baseline: Baseline;
  evidence: Evidence[];
  interventionAt: string | null;
  outcomeObservedAt: string | null;
  collectedMinor: number;
  currency: string;
  excludedMinor: number;
  exclusionStatement: string; // mandatory; zero must be an explicit assertion
  recoveryReason: NonNullable<RecoveryReason>;
  attribution: string;
  confidenceUsed: number;
  /** Auditable-tier claims (confidence ≥ threshold) additionally require independent evidence. */
  policy: PolicyVersion;
}

/** All violations that block approval. Empty ⇒ approvable. */
export function validateApproval(ctx: CaseApprovalContext): string[] {
  const v: string[] = [];
  const amountMinor = ctx.collectedMinor - ctx.baseline.calculatedAmount.minor;

  const auth = canApproveProof(ctx.policy.approval, {
    ownerId: ctx.ownerActorId,
    approverActor: ctx.approverActor,
    amountMinor,
  });
  if (!auth.ok) v.push(auth.reason ?? "approval authority failed");

  const bt = baselineTemporallyValid(ctx.baseline, {
    interventionAt: ctx.interventionAt,
    outcomeObservedAt: ctx.outcomeObservedAt,
  });
  if (!bt.ok) v.push(`baseline: ${bt.reason}`);

  if (ctx.baseline.currency !== ctx.currency) {
    v.push(`currency mismatch (case ${ctx.currency} vs baseline ${ctx.baseline.currency})`);
  }

  if (!ctx.exclusionStatement || !ctx.exclusionStatement.trim()) {
    v.push("an explicit exclusion statement is mandatory");
  }

  // Auditable tier (confidence clears the stamped threshold) demands independent evidence.
  const auditableTier = ctx.confidenceUsed >= ctx.policy.proofThreshold;
  if (auditableTier && !hasIndependentEvidence(ctx.evidence)) {
    v.push("auditable claim requires at least one independent evidence reference (operator notes alone are insufficient)");
  }

  return v;
}

/** Freeze an approved Proof, stamping the exact policy versions. Throws if any gate fails. */
export function approveProofForCase(ctx: CaseApprovalContext): Proof {
  const violations = validateApproval(ctx);
  if (violations.length > 0) {
    throw new Error(`Cannot approve Proof: ${violations.join("; ")}`);
  }
  return createApprovedProof({
    proofId: ctx.proofId,
    recoveryCaseId: ctx.recoveryCaseId,
    approvedAt: ctx.approvedAt,
    collectedAmount: money(ctx.collectedMinor, ctx.currency),
    baselineAmount: ctx.baseline.calculatedAmount,
    excludedRecoveryAmount: money(ctx.excludedMinor, ctx.currency),
    exclusionStatement: ctx.exclusionStatement,
    recoveryReason: ctx.recoveryReason,
    attribution: ctx.attribution,
    evidenceRefs: ctx.evidence.map((e) => e.evidenceId),
    baselineId: ctx.baseline.baselineId,
    baselineMethodId: ctx.baseline.method,
    baselineVersion: ctx.baseline.methodVersion,
    baselineLockPolicy: ctx.policy.baselineLockPolicy,
    policyVersion: ctx.policy.policyVersion,
    confidenceMethodologyVersion: ctx.policy.confidenceMethodologyVersion,
    proofThresholdUsed: ctx.policy.proofThreshold,
    confidenceUsed: ctx.confidenceUsed,
    approvedBy: ctx.approverActor.id,
  });
}

/** A refund/chargeback/dispute/correction → a NEW linked record. Never mutates the original. */
export function reverseProofForCase(
  original: Proof,
  input: { newProofId: string; at: string; approvedBy: string; reason: string },
): Proof {
  return reviseProof(original, {
    newProofId: input.newProofId,
    status: "Reversed",
    at: input.at,
    approvedBy: input.approvedBy,
    exclusionStatement: `Reversed: ${input.reason}`,
  });
}
