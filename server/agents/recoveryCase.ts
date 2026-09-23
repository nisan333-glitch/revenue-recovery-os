import { randomUUID } from "node:crypto";
import { requireBoundaryAccess, type ActorContext } from "../auth/identity";
import { ForbiddenError } from "../http/errors";

export const RECOVERY_CASE_POLICY_VERSION = "recovery-case-promotion-v1";

export interface RecoveryCase {
  readonly recoveryCaseId: string;
  readonly boundaryId: string;
  readonly sourceCandidateId: string;
  readonly recoveryType: string;
  readonly sourceRef: string;
  readonly amountAtRiskMinor: number;
  readonly currency: string;
  readonly detectorVersion: string;
  readonly openedByActorId: string;
  readonly openedByRole: "operator";
  readonly policyVersion: string;
  readonly openedAt: string;
}

export interface CandidatePromotionStore {
  promote(input: {
    readonly recoveryCaseId: string;
    readonly candidateId: string;
    readonly boundaryId: string;
    readonly actorId: string;
    readonly actorRole: "operator";
    readonly policyVersion: string;
  }): Promise<{ readonly recoveryCase: RecoveryCase; readonly created: boolean }>;
}

export class CandidatePromotionService {
  constructor(private readonly store: CandidatePromotionStore) {}

  promote(actor: ActorContext, candidateId: string, boundaryId: string) {
    if (actor.role !== "operator") throw new ForbiddenError("candidate promotion requires the operator role");
    if (!candidateId.trim() || !boundaryId.trim()) throw new Error("candidateId and boundaryId are required");
    requireBoundaryAccess(actor, boundaryId);
    return this.store.promote({
      recoveryCaseId: `RC-${randomUUID()}`,
      candidateId,
      boundaryId,
      actorId: actor.actorId,
      actorRole: "operator",
      policyVersion: RECOVERY_CASE_POLICY_VERSION,
    });
  }
}
