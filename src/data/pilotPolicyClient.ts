// EP-19 · Client for pilot admission policy governance.
//
// The customer side may PROPOSE a fitness bar; only pilot governance may put one in force. That split
// is the whole reason this client exists as something separate from the intake: a screen where one
// identity did both halves would demonstrate a beneficiary setting the bar that judges them, and the
// server would refuse it anyway — it compares actorId, not only role.
//
// Nothing here evaluates anything. Every threshold is sent as typed, and every verdict about it comes
// back from the server.
import { apiRequest } from "./apiClient";
import type { DevActor } from "./devActor";
import type { PilotAdmissionPolicy } from "../contract/pilotAdmissionPolicy";
import type { PolicyState, PolicyTransition } from "../contract/policyLifecycle";

export interface ProposePolicyResult {
  readonly boundaryId: string;
  readonly policyRef: string;
  readonly policyHash: string;
  /** Always DRAFT: proposing puts nothing in force. */
  readonly state: PolicyState;
  readonly registeredAt: string;
}

export interface PolicyTransitionResult {
  readonly boundaryId: string;
  readonly policyRef: string;
  readonly state: PolicyState;
  readonly transition: PolicyTransition;
}

export interface PolicyLifecycleEventView {
  readonly transition: string;
  readonly actorId: string;
  readonly actorRole: string;
  readonly rationale: string;
  readonly at: string;
}

export interface PolicyGovernanceView {
  readonly boundaryId: string;
  readonly policyRef: string;
  readonly policyHash: string;
  readonly state: PolicyState | null;
  readonly proposedBy: string | null;
  readonly proposedAt: string | null;
  readonly activatedBy: string | null;
  readonly activatedAt: string | null;
  readonly events: readonly PolicyLifecycleEventView[];
}

/** The URL segment for each governed transition. `PROPOSED` is not here — proposing is its own route. */
const TRANSITION_PATH: Readonly<Record<Exclude<PolicyTransition, "PROPOSED">, string>> = Object.freeze({
  ACTIVATED: "activate",
  FROZEN: "freeze",
  UNFROZEN: "unfreeze",
  RETIRED: "retire",
});

/**
 * Propose a policy. The result is always `DRAFT`, and a draft judges nothing.
 *
 * `rationale` is required by the server on every lifecycle act: a governance decision with no stated
 * reason cannot be reviewed later, so there is no way to record one without saying why.
 */
export function proposeAdmissionPolicy(
  input: { readonly boundaryId: string; readonly policy: PilotAdmissionPolicy; readonly rationale: string },
  actor: DevActor,
): Promise<ProposePolicyResult> {
  return apiRequest<ProposePolicyResult>("POST", "/pilot/admission-policies", actor, {
    boundaryId: input.boundaryId,
    policy: input.policy,
    rationale: input.rationale,
  });
}

/** Move a policy through its lifecycle. Governance only; the server enforces role AND identity. */
export function transitionAdmissionPolicy(
  transition: Exclude<PolicyTransition, "PROPOSED">,
  input: {
    readonly boundaryId: string;
    readonly policyId: string;
    readonly policyVersion: string;
    readonly rationale: string;
  },
  actor: DevActor,
): Promise<PolicyTransitionResult> {
  return apiRequest<PolicyTransitionResult>(
    "POST",
    `/pilot/admission-policies/${TRANSITION_PATH[transition]}`,
    actor,
    input,
  );
}

/** Who proposed a bar, who put it in force, when and why. A governed read (`AuditRead`). */
export function readPolicyGovernance(
  input: { readonly boundaryId: string; readonly policyId: string; readonly policyVersion: string },
  actor: DevActor,
): Promise<PolicyGovernanceView> {
  const query = new URLSearchParams({
    boundaryId: input.boundaryId,
    policyId: input.policyId,
    policyVersion: input.policyVersion,
  });
  return apiRequest<PolicyGovernanceView>(
    "GET",
    `/pilot/admission-policies/governance?${query.toString()}`,
    actor,
  );
}

/** May a policy in this state judge a dataset? ACTIVE only — mirrors the server, never widens it. */
export function mayJudge(state: PolicyState | null): boolean {
  return state === "ACTIVE";
}

/** What a reader needs to do next, per state. Never implies a state can judge when it cannot. */
export function nextGovernanceAction(state: PolicyState | null): string {
  switch (state) {
    case null:
      return "Nothing proposed yet for this boundary and version.";
    case "DRAFT":
      return "Proposed. Pilot governance must activate it before it can judge a dataset.";
    case "ACTIVE":
      return "In force. Datasets submitted for this boundary are judged against it.";
    case "FROZEN":
      return "Paused by pilot governance. It judges nothing until it is resumed.";
    case "RETIRED":
      return "Permanently ended. A replacement is a new version, with its own proposal and activation.";
  }
}
