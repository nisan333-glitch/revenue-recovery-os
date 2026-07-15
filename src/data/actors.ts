// Simulated actor roster (prototype identities; a real system sources these from auth). Kept in a
// standalone module so both the state layer and the seed can reference the SAME identities without
// a circular import (seed → repo → state → seed). Separation of authority (Trust Invariant #8):
// the Finance approver is a distinct identity from every case owner.
import type { Actor, Role } from "../domain/authority";

const APPROVER_ROLES: Role[] = ["proofApprover", "verifier"];
export const APPROVER_ACTOR: Actor = Object.freeze({
  id: "cfo@company",
  displayName: "Finance Approver",
  roles: APPROVER_ROLES,
});

// Operators who can own Cases (display names are used across the existing UI).
export const OWNERS = ["Dana Levy", "Priya Nair", "Marcus Cole"];

const OWNER_ACTOR_ID: Readonly<Record<string, string>> = Object.freeze({
  "Dana Levy": "dana@company",
  "Priya Nair": "priya@company",
  "Marcus Cole": "marcus@company",
});

export function ownerActorIdOf(displayName: string): string {
  return OWNER_ACTOR_ID[displayName] ?? `owner:${displayName}`;
}

const OWNER_ROLES: Role[] = ["caseOwner"];
/** The Actor for a case owner (distinct from the approver — never the sole approver of own claim). */
export function ownerActor(displayName: string): Actor {
  return { id: ownerActorIdOf(displayName), displayName, roles: OWNER_ROLES };
}
