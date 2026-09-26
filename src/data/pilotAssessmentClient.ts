// EP-16 · Client for the governed assessment orchestration.
//
// WHAT THIS CLIENT CANNOT DO, by construction: it cannot name an admission policy, set a threshold,
// assert an outcome, or supply a finding. The schedule body carries the dataset and the assessment
// policy (as-of date, stall threshold, currency) and nothing else — the fitness bar is read
// server-side from the decision that admitted the dataset. A client that could choose its own bar
// would be a beneficiary setting the number that judges it, which is the one thing the trust
// invariant forbids outright.
//
// There is deliberately no local preview of an execution the way the intake has a preflight. A
// preflight re-runs a PURE validator the browser can hold honestly; an execution is a governed,
// leased, audited run, and a browser-side imitation of one would be a picture of work that never
// happened.
import { apiRequest } from "./apiClient";
import type { DevActor } from "./devActor";
import { PILOT_DATA_CONTRACT_VERSION, type DatasetProvenance } from "../contract/pilotDataContract";
import type { ExecutionState } from "../contract/assessmentExecution";
import type { PolicyState } from "../contract/policyLifecycle";
import type { ExecutionCodeSpec } from "../contract/executionCodes";
import type { DateLocale } from "../assessment/dateNormalize";
import type { AmountFormat } from "../assessment/amountNormalize";

export interface ExecutionBindingView {
  readonly boundaryId: string;
  readonly datasetFingerprint: string;
  readonly admissionDecisionId: string;
  readonly admissionPolicyId: string;
  readonly admissionPolicyVersion: string;
  readonly admissionPolicyHash: string;
  readonly contractVersion: string;
  readonly assessmentPolicy: {
    readonly policyId: string;
    readonly policyVersion: string;
    readonly calculationMethodVersion: string;
    readonly asOf: string;
    readonly stallThresholdDays: number;
    readonly currency: string;
  };
  readonly interpretation: {
    readonly mappingId: string;
    readonly amountFormat: string;
    readonly dateLocale: string;
  };
  readonly recoveryCaseId: string | null;
}

export interface ExecutionEventView {
  readonly transition: string;
  readonly code: string | null;
  readonly byId: string;
  readonly at: string;
}

/**
 * The observation an execution produced.
 *
 * Every monetary field is exact minor units of Revenue OPPORTUNITY — a forecast-side observation.
 * There is no field here for Revenue Returned, Auditable Revenue or anything collected, and the
 * claim boundary says so in the payload rather than only in a comment.
 */
export interface AssessmentFindingView {
  readonly executionId: string;
  readonly assessmentId: string;
  readonly calculationMethodVersion: string;
  readonly acceptedCycleCount: number;
  readonly excludedCycleCount: number;
  readonly exclusionCodes: readonly { readonly code: string; readonly count: number }[];
  readonly stalledCount: number;
  readonly undeterminedCount: number;
  readonly referenceCount: number;
  readonly currency: string;
  readonly observedUnpaidMinor: number;
  readonly grossEligibleMinor: number;
  readonly partialOutstandingMinor: number;
  readonly excludedValueMinor: number;
  readonly unknownValueMinor: number;
  readonly stateCounts: Readonly<Record<string, number>>;
  readonly claimBoundary: {
    readonly observationOnly: true;
    readonly constitutesProof: false;
    readonly constitutesRevenue: false;
    readonly createsRecoveryCase: false;
  };
}

export interface ScheduleAssessmentResult {
  readonly scheduled: boolean;
  readonly created: boolean;
  readonly executionId: string | null;
  readonly boundaryId: string;
  readonly state: ExecutionState | null;
  readonly binding: ExecutionBindingView | null;
  readonly refusal: ExecutionCodeSpec | null;
  readonly refusalDetail: string | null;
  readonly admissionPolicyState: PolicyState | null;
  readonly claimBoundary: AssessmentFindingView["claimBoundary"];
}

export interface AssessmentExecutionView {
  readonly executionId: string;
  readonly boundaryId: string;
  readonly state: ExecutionState | null;
  readonly code: string | null;
  readonly binding: ExecutionBindingView;
  readonly bindingHash: string;
  readonly inputHash: string;
  readonly scheduledByActorId: string;
  readonly scheduledByRole: string;
  readonly scheduledAt: string;
  readonly events: readonly ExecutionEventView[];
  readonly finding: {
    readonly finding: AssessmentFindingView;
    readonly findingHash: string;
    readonly producedBy: string;
    readonly recordedAt: string;
  } | null;
  readonly claimBoundary: AssessmentFindingView["claimBoundary"];
}

export interface AssessmentListItem {
  readonly executionId: string;
  readonly state: ExecutionState | null;
  readonly code: string | null;
  readonly datasetFingerprint: string;
  readonly admissionDecisionId: string;
  readonly admissionPolicyRef: string;
  readonly scheduledAt: string;
}

export interface ScheduleAssessmentParams {
  readonly boundaryId: string;
  readonly datasetId: string;
  readonly csvText: string;
  readonly provenance: DatasetProvenance;
  readonly currency: string;
  readonly locale?: DateLocale;
  readonly amountFormat?: AmountFormat;
  /**
   * EP-26 · Which governed analysis-terms version this run is measured under. Absent, unknown, draft,
   * frozen or retired is refused with NH-AX-1010 — there is no value pair to supply instead.
   */
  readonly analysisTermsId?: string;
  readonly analysisTermsVersion?: string;
  /** Optional link to a governed case. Supplying it never creates one. */
  readonly recoveryCaseId?: string;
}

export function schedulePilotAssessment(
  params: ScheduleAssessmentParams,
  actor: DevActor,
): Promise<ScheduleAssessmentResult> {
  return apiRequest<ScheduleAssessmentResult>("POST", "/pilot/assessments", actor, {
    boundaryId: params.boundaryId,
    datasetId: params.datasetId,
    declaredVersion: PILOT_DATA_CONTRACT_VERSION,
    csvText: params.csvText,
    // EP-26 · The cut-off and the threshold are NOT sent. The server resolves them from its own
    // register of governed definitions; this names which one, and nothing more.
    policy: { currency: params.currency },
    ...(params.analysisTermsId ? { analysisTermsId: params.analysisTermsId } : {}),
    ...(params.analysisTermsVersion ? { analysisTermsVersion: params.analysisTermsVersion } : {}),
    provenance: params.provenance,
    ...(params.locale ? { locale: params.locale } : {}),
    ...(params.amountFormat ? { amountFormat: params.amountFormat } : {}),
    ...(params.recoveryCaseId ? { recoveryCaseId: params.recoveryCaseId } : {}),
  });
}

export function readPilotAssessment(
  boundaryId: string,
  executionId: string,
  actor: DevActor,
): Promise<AssessmentExecutionView> {
  return apiRequest<AssessmentExecutionView>(
    "GET",
    `/pilot/assessments/${encodeURIComponent(executionId)}?boundaryId=${encodeURIComponent(boundaryId)}`,
    actor,
  );
}

export function listPilotAssessments(
  boundaryId: string,
  actor: DevActor,
): Promise<readonly AssessmentListItem[]> {
  return apiRequest<readonly AssessmentListItem[]>(
    "GET",
    `/pilot/assessments?boundaryId=${encodeURIComponent(boundaryId)}`,
    actor,
  );
}

/** How each state should read to someone waiting on a run. Five states, five plain sentences. */
export const EXECUTION_STATE_LABELS: Readonly<Record<ExecutionState, string>> = Object.freeze({
  queued: "Queued — waiting for a worker",
  running: "Running — a worker holds the lease",
  blocked: "Blocked — a governance or binding check refused it",
  completed: "Completed — an observation was recorded",
  failed: "Failed — it will be retried",
});

/**
 * Is this state one nobody should sit and wait on?
 *
 * `failed` is deliberately NOT terminal: the runtime retries it, and telling someone their run is
 * over when a worker is about to pick it up again would be wrong in the direction that costs them
 * a re-upload.
 */
export function isSettledState(state: ExecutionState | null): boolean {
  return state === "completed" || state === "blocked";
}

/** Shorten a hash for display without implying the short form is the identity. */
export function truncateRef(value: string, keep = 12): string {
  const body = value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
  return body.length <= keep ? body : `${body.slice(0, keep)}…`;
}
