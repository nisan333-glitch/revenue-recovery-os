// EP-26 · Client for analysis-terms governance.
//
// The cut-off (`asOf`) and the stall threshold define what an assessment MEASURES. This client is
// separate from the intake for the same reason the admission-policy client is: proposing and putting in
// force are two acts by two identities, and a screen where one identity did both would demonstrate a
// beneficiary defining the measurement that judges them. The server refuses it regardless — it compares
// actorId, not only role.
//
// Nothing here decides anything. Values are sent as typed; every verdict comes back from the server.
import { apiRequest } from "./apiClient";
import type { DevActor } from "./devActor";
import type { PolicyState, PolicyTransition } from "../contract/policyLifecycle";
import type { PolicyLifecycleEventView } from "./pilotPolicyClient";

export interface ProposeAnalysisTermsResult {
  readonly boundaryId: string;
  readonly termsRef: string;
  readonly termsHash: string;
  /** Always DRAFT: proposing measures nothing. */
  readonly state: PolicyState;
  readonly registeredAt: string;
}

export interface AnalysisTermsTransitionResult {
  readonly boundaryId: string;
  readonly termsRef: string;
  readonly state: PolicyState | null;
  readonly transition: PolicyTransition;
}

export interface AnalysisTermsGovernanceView {
  readonly boundaryId: string;
  readonly termsRef: string;
  readonly termsHash: string;
  readonly asOf: string;
  readonly stallThresholdDays: number;
  readonly calculationMethodVersion: string;
  readonly state: PolicyState | null;
  readonly proposedBy: string | null;
  readonly proposedAt: string | null;
  readonly activatedBy: string | null;
  readonly activatedAt: string | null;
  readonly events: readonly PolicyLifecycleEventView[];
}

/** One row of the menu of definitions someone else approved. */
export interface GovernedAnalysisTermsRow {
  readonly termsRef: string;
  readonly termsId: string;
  readonly termsVersion: string;
  readonly asOf: string;
  readonly stallThresholdDays: number;
  readonly termsHash: string;
  readonly state: PolicyState | null;
  /** True only for ACTIVE. Mirrors the server; never widens it. */
  readonly mayMeasure: boolean;
}

export interface GovernedAnalysisTermsList {
  readonly boundaryId: string;
  readonly terms: readonly GovernedAnalysisTermsRow[];
}

const TRANSITION_PATH: Readonly<Record<Exclude<PolicyTransition, "PROPOSED">, string>> = Object.freeze({
  ACTIVATED: "activate",
  FROZEN: "freeze",
  UNFROZEN: "unfreeze",
  RETIRED: "retire",
});

/**
 * Propose an analysis-terms version. Always returns `DRAFT`, and a draft measures nothing.
 *
 * `rationale` is required by the server: a definition nobody explained cannot be reviewed, and
 * governance is asked to bless it on the strength of that explanation.
 */
export function proposeAnalysisTerms(
  input: {
    readonly boundaryId: string;
    readonly terms: {
      readonly termsId: string;
      readonly termsVersion: string;
      readonly asOf: string;
      readonly stallThresholdDays: number;
    };
    readonly rationale: string;
  },
  actor: DevActor,
): Promise<ProposeAnalysisTermsResult> {
  return apiRequest<ProposeAnalysisTermsResult>("POST", "/pilot/analysis-terms", actor, input);
}

/** Move a definition through its lifecycle. Governance only; the server enforces role AND identity. */
export function transitionAnalysisTerms(
  transition: Exclude<PolicyTransition, "PROPOSED">,
  input: {
    readonly boundaryId: string;
    readonly termsId: string;
    readonly termsVersion: string;
    readonly rationale: string;
  },
  actor: DevActor,
): Promise<AnalysisTermsTransitionResult> {
  return apiRequest<AnalysisTermsTransitionResult>(
    "POST",
    `/pilot/analysis-terms/${TRANSITION_PATH[transition]}`,
    actor,
    input,
  );
}

/** Who proposed a definition, who put it in force, when and why. A governed read (`AuditRead`). */
export function readAnalysisTermsGovernance(
  input: { readonly boundaryId: string; readonly termsId: string; readonly termsVersion: string },
  actor: DevActor,
): Promise<AnalysisTermsGovernanceView> {
  const query = new URLSearchParams(input as unknown as Record<string, string>);
  return apiRequest<AnalysisTermsGovernanceView>(
    "GET",
    `/pilot/analysis-terms/governance?${query.toString()}`,
    actor,
  );
}

/**
 * The definitions this boundary may cite, with their values.
 *
 * Readable by every role on purpose: an operator who cannot see the cut-off their data will be read at
 * cannot tell what the figure they are shown means. Reading the menu is not choosing — every row on it
 * was approved by someone else, and a row that is not ACTIVE reports `mayMeasure: false`.
 */
export function listGovernedAnalysisTerms(
  boundaryId: string,
  actor: DevActor,
): Promise<GovernedAnalysisTermsList> {
  const query = new URLSearchParams({ boundaryId });
  return apiRequest<GovernedAnalysisTermsList>("GET", `/pilot/analysis-terms/list?${query.toString()}`, actor);
}
