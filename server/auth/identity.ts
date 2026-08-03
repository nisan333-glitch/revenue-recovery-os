// EP-4 · Identity & role model (backend authorization roles).
//
// These BACKEND roles are distinct from the frozen domain `Role` enum
// (src/domain/authority.ts). The domain remains the source of truth for the
// counted-number separation gate; this layer adds least-privilege permissions and
// the governance (Steward) role required by the Mission #012 architecture — without
// changing any Foundation file. Steward may flag/halt but can NEVER count.
import type { Actor, Role as DomainRole } from "../../src/domain/authority";

export type BackendRole = "author" | "operator" | "approver" | "verifier" | "steward";
export type GovernedAction =
  | "Author"
  | "Approve"
  | "Verify"
  | "Flag"
  | "Halt"
  | "Exclude"
  | "AuditRead"
  | "EstablishBaseline" // EP-8.1: establish + lock a baseline snapshot
  | "Intervene" // EP-8.1: record the governed Fix/intervention timing event
  | "IngestEvidence"; // EP-8.1: pre-proof evidence ingestion

// Least-privilege matrix: which role may perform which governed action. There is no
// "admin"/superuser role — nothing here grants a separation-of-duties bypass.
// `AuditRead` (EP-8) governs access to provenance / authority history / CFO exports:
// oversight roles only — beneficiaries (author/operator) are excluded.
// EstablishBaseline/Intervene/IngestEvidence (EP-8.1) belong to the case-management side
// (author/operator) — the same actors who already own the "Author" action — never the
// approver, so the approver can never also be the one asserting the baseline/evidence facts.
const PERMISSIONS: Record<BackendRole, GovernedAction[]> = {
  author: ["Author", "EstablishBaseline", "Intervene", "IngestEvidence"],
  operator: ["Author", "EstablishBaseline", "Intervene", "IngestEvidence"],
  approver: ["Approve", "AuditRead"],
  verifier: ["Verify", "AuditRead"],
  steward: ["Flag", "Halt", "Exclude", "AuditRead"], // governance: may flag/halt/exclude & audit — never count
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
