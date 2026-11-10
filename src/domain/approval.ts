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
import { deriveEvidenceRole } from "./evidenceRole";
import { correctionMapping, mappingBlocksApproval } from "./correctionMapping";
import { reasonScopeViolation } from "./reasons";

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
  /**
   * The case's recovery type — its `LeakageType`, as recorded when the case was opened.
   *
   * REQUIRED, and `null` FAILS CLOSED. It is not optional because an optional field would let an
   * existing caller keep its current behaviour by saying nothing, which is how the bypass arose: the
   * governed route has checked reason scope since 2026-10-23 and this path had no field in which the
   * type could even be expressed. A caller that genuinely does not know the type must say `null` and
   * be refused, rather than omit it and be permitted.
   */
  recoveryType: string | null;
}

/**
 * The executed correction on this case, or `null`.
 *
 * DERIVED, NEVER SUPPLIED. The role comes from `deriveEvidenceRole(sourceSystem, evidenceType)` —
 * the same function the governed ingestion path stamps records with, now literally the same binding —
 * so a caller cannot label a note into the correction channel. Where several corrections exist the
 * EARLIEST by `observedAt` is chosen, mirroring the server's "earliest qualifying correction", with
 * `evidenceId` as a total tie-break: a selection that depends on array position is the event-ordering
 * defect in another costume, and a correction chosen by iteration order would make the verdict a
 * function of the order the caller happened to build the list in.
 */
export function executedCorrectionOf(evidence: readonly Evidence[]): Evidence | null {
  const corrections = evidence.filter(
    (e) => deriveEvidenceRole(e.sourceSystem, e.evidenceType) === "correction",
  );
  if (corrections.length === 0) return null;
  return [...corrections].sort((a, b) =>
    a.observedAt === b.observedAt
      ? a.evidenceId.localeCompare(b.evidenceId)
      : a.observedAt.localeCompare(b.observedAt),
  )[0]!;
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

  // ── THE TWO GATES THAT ONLY THE GOVERNED ROUTE USED TO APPLY ──────────────────────────────────
  //
  // Until this slice, `correctionMapping`/`mappingBlocksApproval` and `reasonScopeViolation` had
  // exactly ONE production consumer between them: `server/services/proofService.ts`. This function —
  // reached by `src/state/RecoveryContext.tsx`'s own approve action and by the seed builder — applied
  // neither, so a `UsageActivation` recovery could be frozen as PROVEN here while the HTTP route a
  // few files away refused it. Same product, same claim, two answers.
  //
  // THESE ARE THE SAME FUNCTIONS, not a second implementation of the same idea. Both modules already
  // lived in `src/domain/`, and `server/services/proofService.ts` imports them FROM here, so wiring
  // this path to them means there is one policy with two callers. `evidenceRoleSharing.test.ts`
  // carries the same claim for the role derivation, which did have to move, and asserts it by
  // identity rather than by a fixture both sides happen to agree on.
  //
  // ORDER: scope first, then channel. A reason that names a mechanism the case never had is a false
  // statement about WHAT HAPPENED; a missing correction channel is a statement about what COULD be
  // evidenced. When both are wrong the first is the more specific finding, and a refusal should name
  // the most specific thing it knows.

  // SCOPE · a proof is immutable, so a reason naming a mechanism the case never had cannot be
  // corrected afterwards, only superseded. `null` or a blank type fails closed for an enforced
  // reason: absent is never "any". Reasons outside `ENFORCED_REASON_SCOPE` keep their historical
  // behaviour here exactly as on the server — widening that is a governance decision with an owner.
  const recoveryType = ctx.recoveryType === null || ctx.recoveryType.trim() === "" ? null : ctx.recoveryType;
  const scope = reasonScopeViolation(ctx.recoveryReason, recoveryType);
  if (scope !== null) v.push(scope);

  // CHANNEL · the correction supplied must evidence the mechanism the reason NAMES. The only declared
  // correction types are the billing system's statements about billing, so without this a corrective
  // invoice could stand in as proof that an activation happened or an onboarding was restarted.
  const mapping = correctionMapping(ctx.recoveryReason, executedCorrectionOf(ctx.evidence)?.evidenceType ?? null);
  if (mappingBlocksApproval(mapping)) {
    v.push(
      `PROVEN requires a correction that evidences the reason claimed — ${!mapping.ok ? mapping.code : ""}: `
        + `${!mapping.ok ? mapping.detail : ""}`,
    );
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
