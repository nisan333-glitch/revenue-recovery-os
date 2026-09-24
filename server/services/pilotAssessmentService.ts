// EP-16 · Pilot Assessment Orchestration — the governed handoff.
//
// WHAT WAS MISSING. EP-13/14/15 produced a dataset that is validated, judged fit, and judged under a
// bar governance put in force. Then the trail stopped. Assessment still ran in the browser, over
// whatever bytes were in memory, under whatever policy the page happened to hold. So the admission
// decision governed a verdict about a FILE and governed nothing about the RUN — and a number that
// comes out of an ungoverned run is indistinguishable from a number someone typed.
//
// THE ORDER BELOW IS THE SECURITY DESIGN, and it is the same shape the intake already uses:
//   1. least privilege      — may this role schedule at all;
//   2. tenant authorization — is this actor entitled to THIS boundary;
//   3. contract validation  — the same validator, over the bytes actually supplied;
//   4. binding              — does an ADMISSIBLE decision exist for exactly these bytes, and does
//                             that decision still hash to its own stored identifier;
//   5. governance           — is the bar that admitted it still ACTIVE;
//   6. projection           — accepted cycles only, de-identified;
//   7. persistence + enqueue — atomically, keyed by a deterministic id.
//
// Nothing is written before step 6 passes, so a refused schedule leaves no execution behind.
//
// WHAT IT NEVER DOES. No Proof, no Recovery Case, no authority-ledger entry, no counted dollar. The
// agent it enqueues emits zero CandidateSignals, which is how the automatic path into case creation
// is kept structurally absent rather than merely unused.
import {
  validatePilotDataset,
  type ContractValidationReport,
  type DatasetSubmission,
} from "../../src/contract/validateDataset";
import { PILOT_DATA_CONTRACT_VERSION, type DatasetProvenance } from "../../src/contract/pilotDataContract";
import {
  assessmentPolicyRef,
  deriveAdmissionDecisionId,
  deriveExecutionId,
  hashExecutionBinding,
  hashExecutionInput,
  projectExecutionInput,
  type ExecutionBinding,
  type ExecutionState,
} from "../../src/contract/assessmentExecution";
import {
  executionCode,
  type ExecutionCodeSpec,
  type ExecutionRefusal,
} from "../../src/contract/executionCodes";
import { mayEvaluate, whyCannotEvaluate, type PolicyState } from "../../src/contract/policyLifecycle";
import { makePolicy } from "../../src/assessment/policy";
import type { DateLocale } from "../../src/assessment/dateNormalize";
import type { AmountFormat } from "../../src/assessment/amountNormalize";
import { ForbiddenError, NotFoundError } from "../http/errors";
import { requireCan } from "../auth/authorityGate";
import { requireBoundaryAccess, type ActorContext } from "../auth/identity";
import { findSubmission } from "../persistence/pilotDatasetStore";
import { policyGovernanceState } from "../persistence/pilotPolicyGovernanceStore";
import {
  createExecutionIfAbsent,
  executionStatus,
  findExecution,
  findFinding,
  listExecutions,
  type ExecutionRecord,
} from "../persistence/pilotExecutionStore";
import { PILOT_ASSESSMENT_AGENT_ID } from "../agents/pilotAssessmentAgent";
import { createPostgresAgentTaskStore } from "../agents/prismaTaskDatabase";
import type { AgentTaskStore } from "../agents/types";

export interface SchedulePilotAssessmentRequest {
  /** Authorization REQUEST, never an assertion — `requireBoundaryAccess` decides. */
  readonly boundaryId: string;
  readonly datasetId: string;
  readonly declaredVersion: string;
  readonly csvText: string;
  readonly policy: {
    readonly stallThresholdDays: number;
    readonly asOf: string;
    readonly currency: string;
  };
  readonly provenance: DatasetProvenance;
  readonly locale?: DateLocale;
  readonly amountFormat?: AmountFormat;
  /**
   * Optional link to a governed recovery case. When set, that case's Halt blocks the execution.
   * Supplying it never CREATES a case, and an execution never authors one.
   */
  readonly recoveryCaseId?: string;
}

export interface SchedulePilotAssessmentResponse {
  readonly scheduled: boolean;
  /** False when an identical binding was already scheduled — the idempotent path. */
  readonly created: boolean;
  readonly executionId: string | null;
  readonly boundaryId: string;
  readonly state: ExecutionState | null;
  readonly binding: ExecutionBinding | null;
  /** The deterministic NH-AX-#### refusal, when the schedule was refused. */
  readonly refusal: ExecutionCodeSpec | null;
  /** Non-identifying context for the refusal. Never echoes a customer value. */
  readonly refusalDetail: string | null;
  readonly admissionPolicyState: PolicyState | null;
  readonly claimBoundary: {
    readonly observationOnly: true;
    readonly constitutesProof: false;
    readonly constitutesRevenue: false;
    readonly createsRecoveryCase: false;
  };
}

const CLAIM_BOUNDARY = Object.freeze({
  observationOnly: true as const,
  constitutesProof: false as const,
  constitutesRevenue: false as const,
  createsRecoveryCase: false as const,
});

function refused(
  boundaryId: string,
  refusal: ExecutionRefusal,
  detail: string,
  admissionPolicyState: PolicyState | null = null,
): SchedulePilotAssessmentResponse {
  return Object.freeze({
    scheduled: false,
    created: false,
    executionId: null,
    boundaryId,
    state: null,
    binding: null,
    refusal: executionCode(refusal),
    refusalDetail: detail,
    admissionPolicyState,
    claimBoundary: CLAIM_BOUNDARY,
  });
}

export interface PilotAssessmentDeps {
  /** Injectable so the queue can be driven directly in tests; production uses the Postgres store. */
  readonly taskStore?: AgentTaskStore;
  readonly now?: () => number;
}

/**
 * Schedule one governed assessment execution over an already-admitted dataset.
 *
 * The caller re-supplies the CSV rather than the server holding it: the intake deliberately persists
 * no uploaded bytes, and re-supplying them is what lets the fingerprint check prove that the file
 * being executed is the file that was admitted. A dataset that cannot produce the admitted
 * fingerprint is refused — it is a different dataset, whatever it is named.
 */
export async function schedulePilotAssessment(
  actor: ActorContext,
  request: SchedulePilotAssessmentRequest,
  deps: PilotAssessmentDeps = {},
): Promise<SchedulePilotAssessmentResponse> {
  requireCan(actor, "SchedulePilotAssessment");
  requireBoundaryAccess(actor, request.boundaryId);
  const boundaryId = request.boundaryId.trim();

  let policy;
  try {
    policy = makePolicy({
      stallThresholdDays: request.policy.stallThresholdDays,
      asOf: request.policy.asOf,
      currency: request.policy.currency,
    });
  } catch {
    throw new ForbiddenError("assessment policy is invalid (stall threshold, as-of date or currency)");
  }

  const submissionInput: DatasetSubmission = {
    declaredVersion: request.declaredVersion,
    boundary: { boundaryId, datasetId: request.datasetId },
    ingestionBoundaryId: boundaryId,
    provenance: request.provenance,
    csvText: request.csvText,
    policy,
    adapterOptions: { locale: request.locale, amountFormat: request.amountFormat },
  };

  const report: ContractValidationReport = await validatePilotDataset(submissionInput);

  // ── 4 · The binding ────────────────────────────────────────────────────────────────────────────
  // The decision is looked up by the key derived from THESE bytes in THIS boundary. A file that was
  // never submitted, or was submitted for another tenant, simply has no decision to bind to.
  const decision = await findSubmission(report.idempotencyKey, boundaryId);
  if (!decision) {
    return refused(boundaryId, "dataset_not_submitted", "no admission decision exists for these bytes in this boundary");
  }
  if (!decision.admissionDecisionId) {
    return refused(boundaryId, "admission_decision_missing", "the stored submission predates assessment orchestration");
  }
  // Belt and braces. The idempotency key already contains the fingerprint, so these two can only
  // diverge if key derivation were ever changed — at which point this check fails loudly instead of
  // letting one dataset execute under another's admission.
  if (decision.datasetFingerprint !== report.datasetFingerprint) {
    return refused(boundaryId, "fingerprint_mismatch", "the supplied bytes do not match the admitted dataset");
  }
  if (decision.contractVersion !== report.contractVersion) {
    return refused(
      boundaryId,
      "contract_version_mismatch",
      `admitted under ${decision.contractVersion}; this build serves ${PILOT_DATA_CONTRACT_VERSION}`,
    );
  }
  if (decision.admissionOutcome !== "ADMISSIBLE") {
    return refused(
      boundaryId,
      "admission_not_admissible",
      `the admission outcome was ${decision.admissionOutcome ?? "not recorded"}`,
    );
  }
  if (!decision.admissionPolicyId || !decision.admissionPolicyVersion || !decision.admissionPolicyHash) {
    // An ADMISSIBLE outcome is only reachable with a policy, so this is unreachable by construction —
    // which is exactly why it is checked rather than asserted away.
    return refused(boundaryId, "admission_not_admissible", "the admission decision names no policy");
  }

  // Re-derive the decision's identifier from its own stored fields. If they disagree, the record
  // changed after it was written; recomputing and carrying on would launder the change.
  const rederivedDecisionId = await deriveAdmissionDecisionId({
    boundaryId,
    idempotencyKey: decision.idempotencyKey,
    datasetFingerprint: decision.datasetFingerprint,
    contractVersion: decision.contractVersion,
    outcome: decision.admissionOutcome,
    admissionPolicyId: decision.admissionPolicyId,
    admissionPolicyVersion: decision.admissionPolicyVersion,
    admissionPolicyHash: decision.admissionPolicyHash,
  });
  if (rederivedDecisionId !== decision.admissionDecisionId) {
    return refused(boundaryId, "decision_binding_mismatch", "the stored decision does not hash to its own identifier");
  }

  // ── 5 · Governance, re-checked NOW ─────────────────────────────────────────────────────────────
  // The dataset was admitted under a bar that was ACTIVE then. This asks whether it is ACTIVE now.
  // A frozen bar is a deliberate governance pause and a retired one is over; neither authorises new
  // work, and letting an old admission carry a new run past them would make freezing decorative.
  const governance = await policyGovernanceState(
    boundaryId,
    decision.admissionPolicyId,
    decision.admissionPolicyVersion,
  );
  if (!mayEvaluate(governance.state)) {
    return refused(boundaryId, "policy_not_active", whyCannotEvaluate(governance.state), governance.state);
  }

  // ── 6 · Projection ─────────────────────────────────────────────────────────────────────────────
  // ONLY the accepted cycles. A rejected row has no representation in what follows, so no rejected
  // value can reach a cohort, a sum, a finding, or any agent's context.
  const input = projectExecutionInput(report.acceptedCycles);
  if (input.cycles.length === 0) {
    return refused(boundaryId, "no_assessable_cycles", "no accepted cycle survived projection", governance.state);
  }

  const binding: ExecutionBinding = Object.freeze({
    boundaryId,
    datasetFingerprint: report.datasetFingerprint,
    admissionDecisionId: decision.admissionDecisionId,
    admissionPolicyId: decision.admissionPolicyId,
    admissionPolicyVersion: decision.admissionPolicyVersion,
    admissionPolicyHash: decision.admissionPolicyHash,
    contractVersion: report.contractVersion,
    assessmentPolicy: assessmentPolicyRef(policy),
    interpretation: Object.freeze({
      mappingId: report.mappingId,
      amountFormat: request.amountFormat ?? "auto",
      dateLocale: request.locale ?? "auto",
    }),
    recoveryCaseId: request.recoveryCaseId?.trim() || null,
  });

  const executionId = await deriveExecutionId(binding);
  const [bindingHash, inputHash] = await Promise.all([
    hashExecutionBinding(binding),
    hashExecutionInput(input),
  ]);

  const { execution, created } = await createExecutionIfAbsent({
    executionId,
    binding,
    bindingHash,
    input,
    inputHash,
    scheduledByActorId: actor.actorId,
    scheduledByRole: actor.role,
  });

  // ── 7 · Enqueue ────────────────────────────────────────────────────────────────────────────────
  // The task's idempotency key IS the execution id, so a repeated schedule reuses the same task row
  // rather than queuing a second run of identical work. The payload carries ONE field — the
  // execution id — so the agent's context contains no customer-derived value whatsoever; everything
  // it needs is looked up, boundary-scoped, from records it cannot influence.
  const store = deps.taskStore ?? createPostgresAgentTaskStore();
  const enqueued = await store.enqueueIfAbsent({
    taskId: `TASK-${executionId}`,
    boundaryId,
    agentId: PILOT_ASSESSMENT_AGENT_ID,
    idempotencyKey: executionId,
    payload: { executionId },
    now: (deps.now ?? Date.now)(),
  });
  void enqueued;

  const status = await executionStatus(executionId, boundaryId);
  return Object.freeze({
    scheduled: true,
    created,
    executionId,
    boundaryId,
    state: status.state,
    binding: execution.binding,
    refusal: null,
    refusalDetail: null,
    admissionPolicyState: governance.state,
    claimBoundary: CLAIM_BOUNDARY,
  });
}

export interface PilotAssessmentView {
  readonly executionId: string;
  readonly boundaryId: string;
  readonly state: ExecutionState | null;
  readonly code: string | null;
  readonly binding: ExecutionRecord["binding"];
  readonly bindingHash: string;
  readonly inputHash: string;
  readonly scheduledByActorId: string;
  readonly scheduledByRole: string;
  readonly scheduledAt: string;
  readonly events: Awaited<ReturnType<typeof executionStatus>>["events"];
  readonly finding: Awaited<ReturnType<typeof findFinding>>;
  readonly claimBoundary: typeof CLAIM_BOUNDARY;
}

/**
 * Read one execution: its state, its full lineage, and its finding if it produced one.
 *
 * Boundary-scoped twice — the actor must hold the boundary, and the lookup filters by it — so a
 * cross-tenant execution id reads as not-found rather than as someone else's run.
 */
export async function readPilotAssessment(
  actor: ActorContext,
  boundaryId: string,
  executionId: string,
): Promise<PilotAssessmentView> {
  requireCan(actor, "ReadPilotAssessment");
  requireBoundaryAccess(actor, boundaryId);
  const scoped = boundaryId.trim();
  const execution = await findExecution(executionId, scoped);
  if (!execution) throw new NotFoundError("no such assessment execution exists for this boundary");
  const status = await executionStatus(executionId, scoped);
  return Object.freeze({
    executionId: execution.executionId,
    boundaryId: scoped,
    state: status.state,
    code: status.code,
    binding: execution.binding,
    bindingHash: execution.bindingHash,
    inputHash: execution.inputHash,
    scheduledByActorId: execution.scheduledByActorId,
    scheduledByRole: execution.scheduledByRole,
    scheduledAt: execution.scheduledAt,
    events: status.events,
    finding: await findFinding(executionId, scoped),
    claimBoundary: CLAIM_BOUNDARY,
  });
}

/** Every execution for one boundary, newest first. The list the UI's status board reads. */
export async function listPilotAssessments(
  actor: ActorContext,
  boundaryId: string,
  limit = 50,
): Promise<readonly {
  readonly executionId: string;
  readonly state: ExecutionState | null;
  readonly code: string | null;
  readonly datasetFingerprint: string;
  readonly admissionDecisionId: string;
  readonly admissionPolicyRef: string;
  readonly scheduledAt: string;
}[]> {
  requireCan(actor, "ReadPilotAssessment");
  requireBoundaryAccess(actor, boundaryId);
  const scoped = boundaryId.trim();
  const executions = await listExecutions(scoped, limit);
  return Object.freeze(
    await Promise.all(
      executions.map(async (execution) => {
        const status = await executionStatus(execution.executionId, scoped);
        return Object.freeze({
          executionId: execution.executionId,
          state: status.state,
          code: status.code,
          datasetFingerprint: execution.binding.datasetFingerprint,
          admissionDecisionId: execution.binding.admissionDecisionId,
          admissionPolicyRef: `${execution.binding.admissionPolicyId}@${execution.binding.admissionPolicyVersion}`,
          scheduledAt: execution.scheduledAt,
        });
      }),
    ),
  );
}
