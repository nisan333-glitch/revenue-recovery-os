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
import type { DatasetProvenance } from "../contract/pilotDataContract";
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

/**
 * DETECTOR #2 · the non-stalled exposure reading, as the server stores it.
 *
 * `null` on every execution assessed before the detector existed, and that means **not computed** — a
 * different fact from zero exposure. A screen that rendered null as 0.00 would be asserting that a
 * healthy-activation population was checked and found clean, which nobody checked.
 */
export interface NonStalledExposureView {
  readonly methodVersion: string;
  readonly population: number;
  readonly currency: string;
  readonly overdueUnpaidMinor: number;
  readonly overduePartialOutstandingMinor: number;
  readonly excludedValueMinor: number;
  readonly unknownValueMinor: number;
  readonly stateCounts: Readonly<Record<string, number>>;
  readonly claimBoundary: AssessmentFindingView["claimBoundary"];
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
    /** Detector #2's reading, with its own witness. `null` = not computed for this execution. */
    readonly exposure: NonStalledExposureView | null;
    readonly exposureHash: string | null;
    readonly producedBy: string;
    readonly recordedAt: string;
  } | null;
  /**
   * What this execution revises, what differs, and why — or null for a first assessment.
   *
   * The delta is DERIVED server-side from the two bindings, not narrated, because a hand-written
   * summary can be wrong about its own diff. `previousFindingExists` is reported because "the earlier
   * result is still there" is the claim that makes this a revision rather than a replacement, and a
   * reader should not have to take it on trust.
   */
  readonly revises: {
    readonly executionId: string;
    readonly reason: string;
    readonly delta: BindingRevisionDeltaView | null;
    readonly previousFindingExists: boolean;
  } | null;
  readonly claimBoundary: AssessmentFindingView["claimBoundary"];
}

export interface RevisionFieldView {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

export interface BindingRevisionDeltaView {
  readonly changed: readonly RevisionFieldView[];
  /** Always empty for a revision this system produced. Non-empty is evidence something went wrong. */
  readonly unexpectedChanges: readonly RevisionFieldView[];
}

/**
 * The answer to "re-assess the input you already hold, under this definition, for this reason".
 *
 * `reassessed: false` with a `refusal` is a VALID answer, not an error — the server has four
 * deterministic reasons to decline and each names its own remedy. `created: false` with
 * `reassessed: true` means the revision already existed: the call is idempotent on the execution's
 * identity, which is what makes a retry after an uncertain network response safe.
 */
export interface ReassessAssessmentResult {
  readonly reassessed: boolean;
  readonly created: boolean;
  readonly executionId: string | null;
  readonly revisesExecutionId: string;
  readonly boundaryId: string;
  readonly state: ExecutionState | null;
  readonly binding: ExecutionBindingView | null;
  readonly delta: BindingRevisionDeltaView | null;
  readonly refusal: ExecutionCodeSpec | null;
  readonly refusalDetail: string | null;
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
  readonly locale?: DateLocale;
  readonly amountFormat?: AmountFormat;
  /**
   * EP-26 · Which governed analysis-terms version this run is measured under. Absent, unknown, draft,
   * frozen or retired is refused with NH-AX-1010 — there is no value pair to supply instead.
   */
  readonly analysisTermsId?: string;
  readonly analysisTermsVersion?: string;
  /**
   * S4 · The admission decision to bind to, from the intake result that recorded it. Citing it is what
   * makes the server read the date locale, the amount format, the analysis terms and the admitted
   * declaration from that record instead of from this request.
   */
  readonly admissionDecisionId?: string;
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
    // S5 · NO `declaredVersion` IS SENT. The endpoint has no such field, and sending one would be a
    // 400 rather than a silent strip. The intake client still sends it, because there it is the
    // customer's declaration about their own export.
    ...(params.admissionDecisionId ? { admissionDecisionId: params.admissionDecisionId } : {}),
    csvText: params.csvText,
    // EP-26b · NO `policy` OBJECT IS SENT AT ALL. Nothing about what this run measures comes from here.
    ...(params.analysisTermsId ? { analysisTermsId: params.analysisTermsId } : {}),
    ...(params.analysisTermsVersion ? { analysisTermsVersion: params.analysisTermsVersion } : {}),
    provenance: params.provenance,
    ...(params.locale ? { locale: params.locale } : {}),
    ...(params.amountFormat ? { amountFormat: params.amountFormat } : {}),
    ...(params.recoveryCaseId ? { recoveryCaseId: params.recoveryCaseId } : {}),
  });
}

/**
 * Re-assess a retained input under a newly governed definition. NO FILE IS RE-SUPPLIED.
 *
 * There is deliberately no `csvText` parameter and no way to add one: the input the earlier finding
 * was computed from is reused, verified server-side against its own recorded hash, and a missing or
 * unverifiable one is refused `NH-AX-1015` with "re-submit" as the remedy. There is likewise no
 * threshold, cut-off or currency — the cited governed definition states those, and one that changes
 * them is refused `NH-AX-1016` because that is a different reading of the data.
 *
 * SAFE TO RETRY. The new execution's identity is derived from its binding, so sending this twice
 * resolves to the same execution and the second call reports `created: false`. A caller that lost the
 * response to a network error may repeat it verbatim without risking a second execution or a second
 * revision link.
 */
export function reassessPilotAssessment(
  params: {
    readonly boundaryId: string;
    readonly executionId: string;
    readonly analysisTermsId: string;
    readonly analysisTermsVersion: string;
    readonly reason: string;
  },
  actor: DevActor,
): Promise<ReassessAssessmentResult> {
  return apiRequest<ReassessAssessmentResult>("POST", "/pilot/assessments/reassess", actor, {
    boundaryId: params.boundaryId,
    executionId: params.executionId,
    analysisTermsId: params.analysisTermsId,
    analysisTermsVersion: params.analysisTermsVersion,
    reason: params.reason,
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
