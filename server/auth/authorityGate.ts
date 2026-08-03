// EP-4 · Authority gate — service-layer enforcement of least privilege and separation
// of duties. This is enforced INSIDE the application service (not only at the route),
// so it holds even if a route-level check were bypassed. The domain
// `canApproveProof` remains the source of truth for the beneficiary/owner ≠ approver
// rule. The gate fails closed.
import { canApproveProof } from "../../src/domain/authority";
import { CURRENT_POLICY } from "../../src/domain/policy";
import { ForbiddenError } from "../http/errors";
import { type ActorContext, type GovernedAction, roleCan, toDomainActor } from "./identity";
import { authorityFor, recordAuthority } from "./authorityStore";

export const AUTHORITY_POLICY_VERSION = CURRENT_POLICY.approval.policyVersion;

/** Least privilege: the actor's role must permit the action, else 403. */
export function requireCan(actor: ActorContext, action: GovernedAction): void {
  if (!roleCan(actor.role, action)) {
    throw new ForbiddenError(`role '${actor.role}' may not perform '${action}'`);
  }
}

/**
 * Separation of duties across a case's recorded authority history:
 *  - the author (beneficiary) may not approve or verify their own case (no self-approval);
 *  - the approver may not verify the same case;
 *  - the counted-number owner ≠ approver rule is delegated to the domain kernel.
 */
export async function enforceSeparation(
  recoveryCaseId: string,
  actor: ActorContext,
  action: GovernedAction,
  amountMinor = 0,
): Promise<void> {
  const history = await authorityFor(recoveryCaseId);
  const idsFor = (a: string) => new Set(history.filter((h) => h.action === a).map((h) => h.actorId));
  const authors = idsFor("Author");
  const approvers = idsFor("Approve");
  const verifiers = idsFor("Verify");
  const id = actor.actorId;

  if (action === "Approve") {
    if (authors.has(id)) {
      throw new ForbiddenError(
        "separation of duties: the case author (beneficiary) cannot approve their own case",
      );
    }
    if (verifiers.has(id)) {
      throw new ForbiddenError("separation of duties: a verifier of the case cannot also approve it");
    }
    // Domain kernel is the source of truth for owner ≠ approver.
    const ownerId = authors.size > 0 ? [...authors][0]! : null;
    const decision = canApproveProof(CURRENT_POLICY.approval, {
      ownerId,
      approverActor: toDomainActor(actor),
      amountMinor,
    });
    if (!decision.ok) throw new ForbiddenError(decision.reason ?? "separation of authority denied");
  }

  if (action === "Verify") {
    if (authors.has(id)) {
      throw new ForbiddenError("separation of duties: the case author cannot verify the case");
    }
    if (approvers.has(id)) {
      throw new ForbiddenError("separation of duties: the approver cannot verify the same case");
    }
  }

  if (action === "Author") {
    if (approvers.has(id)) {
      throw new ForbiddenError("separation of duties: an approver of the case cannot also author it");
    }
    if (verifiers.has(id)) {
      throw new ForbiddenError("separation of duties: a verifier of the case cannot also author it");
    }
  }
}

/**
 * EP-8.1 · The case's first recorded `Intervene` event (the governed Fix-step timing
 * fact), if any. Used by the approval-time baseline-ordering gate and by audit-time gap
 * detection — both re-derive this from the SAME persisted authority ledger, never a
 * separately-invented value.
 */
export async function firstInterveneEvent(
  recoveryCaseId: string,
): Promise<{ at: Date } | null> {
  const history = await authorityFor(recoveryCaseId);
  const interventions = history.filter((h) => h.action === "Intervene");
  if (interventions.length === 0) return null;
  return interventions.reduce((earliest, cur) => (cur.at < earliest.at ? cur : earliest));
}

export { recordAuthority };
