// EP-4 · Identity & role model (backend authorization roles).
//
// These BACKEND roles are distinct from the frozen domain `Role` enum
// (src/domain/authority.ts). The domain remains the source of truth for the
// counted-number separation gate; this layer adds least-privilege permissions and
// the governance (Steward) role required by the Mission #012 architecture — without
// changing any Foundation file. Steward may flag/halt but can NEVER count.
import type { Actor, Role as DomainRole } from "../../src/domain/authority";

export type BackendRole = "author" | "operator" | "approver" | "verifier" | "steward";
export type GovernedAction = "Author" | "Approve" | "Verify" | "Flag" | "Halt";

// Least-privilege matrix: which role may perform which governed action. There is no
// "admin"/superuser role — nothing here grants a separation-of-duties bypass.
const PERMISSIONS: Record<BackendRole, GovernedAction[]> = {
  author: ["Author"],
  operator: ["Author"], // an operator may author/own a case in the product flow
  approver: ["Approve"],
  verifier: ["Verify"],
  steward: ["Flag", "Halt"], // governance: may flag or halt, never author/approve/verify/count
};

export interface ActorContext {
  readonly actorId: string;
  readonly role: BackendRole;
}

const ALL_ROLES: BackendRole[] = ["author", "operator", "approver", "verifier", "steward"];

export function isBackendRole(x: unknown): x is BackendRole {
  return typeof x === "string" && (ALL_ROLES as string[]).includes(x);
}

export function roleCan(role: BackendRole, action: GovernedAction): boolean {
  return PERMISSIONS[role].includes(action);
}

/** Project a backend actor onto a domain Actor for the kernel's separation gate. */
export function toDomainActor(ctx: ActorContext): Actor {
  const roles: DomainRole[] =
    ctx.role === "approver"
      ? ["proofApprover"]
      : ctx.role === "verifier"
        ? ["verifier"]
        : ctx.role === "operator"
          ? ["caseOwner"]
          : [];
  return { id: ctx.actorId, displayName: ctx.actorId, roles };
}
