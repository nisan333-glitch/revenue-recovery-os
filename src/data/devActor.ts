// EP-9 · Dev-only actor selection for calls to the real governed backend.
//
// PRODUCTION BOUNDARY: this mirrors the backend's own `x-actor-id`/`x-actor-role` header
// scheme (server/auth/actorContext.ts), which that file itself documents as NOT production
// authentication. It supplies identity only; every authorization/separation-of-duties rule is
// enforced server-side and cannot be bypassed by choosing a different actor here. Reuses the
// SAME identities already established in data/actors.ts so separation of authority (owner ≠
// approver) holds exactly as it did in the local prototype.
import { APPROVER_ACTOR, ownerActorIdOf } from "./actors";

export type BackendRole = "author" | "operator" | "approver" | "verifier" | "steward";

export interface DevActor {
  actorId: string;
  role: BackendRole;
}

/** The actor for governed case-management writes (author/baseline/intervention/evidence). */
export function operatorActorFor(ownerDisplayName: string | null): DevActor {
  return {
    actorId: ownerDisplayName ? ownerActorIdOf(ownerDisplayName) : "unassigned-operator@company",
    role: "operator",
  };
}

/**
 * The distinct Finance identity — used both to approve (write) and to read governed
 * provenance (AuditRead). Never the case owner: separation of authority is preserved because
 * `operatorActorFor` always derives a different actorId from the assigned case owner.
 */
export const APPROVER: DevActor = { actorId: APPROVER_ACTOR.id, role: "approver" };
