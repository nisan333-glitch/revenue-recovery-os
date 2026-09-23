// EP-4 · Identity & role model (backend authorization roles).
//
// These BACKEND roles are distinct from the frozen domain `Role` enum
// (src/domain/authority.ts). The domain remains the source of truth for the
// counted-number separation gate; this layer adds least-privilege permissions and
// the governance (Steward) role required by the Mission #012 architecture — without
// changing any Foundation file. Steward may flag/halt but can NEVER count.
import type { Actor, Role as DomainRole } from "../../src/domain/authority";
import { ForbiddenError } from "../http/errors";

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
  | "IngestEvidence" // EP-8.1: pre-proof evidence ingestion
  | "PromoteCandidate" // EP-12E: accepted candidate -> authoritative RecoveryCase
  | "SubmitPilotDataset" // EP-13: submit a customer pilot dataset for contract validation
  | "ProposePilotPolicy" // EP-15: propose an admission policy as a DRAFT (customer side)
  | "ActivatePilotPolicy" // EP-15: put a proposed policy in force, or freeze/resume it (governance)
  | "RetirePilotPolicy" // EP-15: permanently end a policy version (governance)
  | "SchedulePilotAssessment" // EP-16: hand an ADMITTED dataset to a governed assessment execution
  | "ReadPilotAssessment"; // EP-16: read an execution's state, lineage and finding

// Least-privilege matrix: which role may perform which governed action. There is no
// "admin"/superuser role — nothing here grants a separation-of-duties bypass.
// `AuditRead` (EP-8) governs access to provenance / authority history / CFO exports:
// oversight roles only — beneficiaries (author/operator) are excluded.
// EP-16 · `SchedulePilotAssessment` sits with the other case-management actions (author/operator):
// scheduling a run creates no counted number, and the bar it runs under was activated by someone
// else entirely. `ReadPilotAssessment` is held by EVERY role — an execution's state, lineage and
// observation carry no proof, no counted dollar and no customer row, and a pilot whose own operator
// cannot see whether their run is queued or blocked is not governed, merely opaque.
// EstablishBaseline/Intervene/IngestEvidence (EP-8.1) belong to the case-management side
// (author/operator) — the same actors who already own the "Author" action — never the
// approver, so the approver can never also be the one asserting the baseline/evidence facts.
const PERMISSIONS: Record<BackendRole, GovernedAction[]> = {
  // EP-15 · the customer side may PROPOSE a fitness bar but never put one in force. A bar you set
  // for yourself is the first input to the number you benefit from.
  author: [
    "Author", "EstablishBaseline", "Intervene", "IngestEvidence", "SubmitPilotDataset",
    "ProposePilotPolicy", "SchedulePilotAssessment", "ReadPilotAssessment",
  ],
  operator: [
    "Author", "EstablishBaseline", "Intervene", "IngestEvidence", "PromoteCandidate",
    "SubmitPilotDataset", "ProposePilotPolicy", "SchedulePilotAssessment", "ReadPilotAssessment",
  ],
  approver: ["Approve", "AuditRead", "ReadPilotAssessment"],
  verifier: ["Verify", "AuditRead", "ReadPilotAssessment"],
  // EP-15 · governance activates and retires admission policies. The steward already cannot count,
  // so giving it the activation authority adds no path to a number — only the authority to decide
  // which bar is in force. No administrator role exists, and none is added here.
  steward: [
    "Flag", "Halt", "Exclude", "AuditRead", "ActivatePilotPolicy", "RetirePilotPolicy",
    "ReadPilotAssessment",
  ],
};

export interface ActorContext {
  readonly actorId: string;
  readonly role: BackendRole;
  /** Verified customer/pilot boundaries. `*` is reserved for isolated dev/synthetic paths. */
  readonly boundaryIds?: readonly string[];
}

const ALL_ROLES: BackendRole[] = ["author", "operator", "approver", "verifier", "steward"];

export function isBackendRole(x: unknown): x is BackendRole {
  return typeof x === "string" && (ALL_ROLES as string[]).includes(x);
}

export function roleCan(role: BackendRole, action: GovernedAction): boolean {
  return PERMISSIONS[role].includes(action);
}

export function requireBoundaryAccess(actor: ActorContext, boundaryId: string): void {
  const requested = boundaryId.trim();
  if (!requested || !actor.boundaryIds || (!actor.boundaryIds.includes("*") && !actor.boundaryIds.includes(requested))) {
    throw new ForbiddenError("actor is not authorized for this boundary");
  }
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
