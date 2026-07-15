// Authority — Trust Invariant #8: no beneficiary may be the sole author, approver and verifier
// of their own recovery claim. Prototype uses explicit role identifiers / simulated actors; this
// is NOT a production auth platform — it is the domain contract that makes separation of authority
// expressible and enforceable, with a seam (ApprovalPolicy) for stronger rules later.

export type Role =
  | "caseOwner"
  | "evidenceProvider"
  | "proofProposer"
  | "proofApprover"
  | "verifier";

export interface Actor {
  readonly id: string;
  readonly displayName: string;
  readonly roles: Role[];
}

export interface ApprovalPolicy {
  readonly policyVersion: string;
  /** At or above this amount (minor units), a distinct approver is mandatory. */
  readonly materialityMinor: number;
  /** If true, the approver must always differ from the case owner, regardless of amount. */
  readonly requireDistinctApprover: boolean;
}

export function hasRole(actor: Actor, role: Role): boolean {
  return actor.roles.includes(role);
}

/**
 * Separation-of-authority gate. The case owner (the beneficiary of a larger number) may not be
 * the sole approver of their own claim above the materiality threshold. Fails closed on a
 * missing/self approver.
 */
export function canApproveProof(
  policy: ApprovalPolicy,
  ctx: { ownerId: string | null; approverActor: Actor; amountMinor: number },
): { ok: boolean; reason?: string } {
  if (!hasRole(ctx.approverActor, "proofApprover")) {
    return { ok: false, reason: "approver lacks the proofApprover role" };
  }
  const distinctRequired =
    policy.requireDistinctApprover || ctx.amountMinor >= policy.materialityMinor;
  if (distinctRequired && ctx.ownerId !== null && ctx.approverActor.id === ctx.ownerId) {
    return {
      ok: false,
      reason: "separation of authority: the case owner cannot be the sole approver of their own claim",
    };
  }
  return { ok: true };
}
