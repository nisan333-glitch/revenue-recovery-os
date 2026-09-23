// EP-16 · The agent that runs one governed assessment execution.
//
// IT EMITS ZERO CandidateSignals, ALWAYS. That single fact is how requirement 9 — "do not create a
// Recovery Case automatically" — is enforced structurally instead of by policy. The only automatic
// path from an agent into case creation runs through `PostgresCandidateSignalWriter`, which is
// driven by the signals a handler returns; a handler that returns none has no such path, and there
// is no branch below that could ever return one. An assessment finding is an OBSERVATION, and
// observations do not open cases — a human does, through the existing governed review.
//
// EVERYTHING IS RE-CHECKED HERE, not trusted from schedule time. Between scheduling and running, a
// steward can freeze the bar, a steward can halt the linked case, and a lease can expire and hand
// the work to a different worker. So the preconditions are evaluated again, against the database,
// inside the run — and any of them failing BLOCKS the execution with a deterministic NH-AX-####
// code rather than producing a finding nobody would know to distrust.
//
// THE AGENT'S CONTEXT CONTAINS NO CUSTOMER DATA. Its task payload is one field: an execution id.
// Everything else is looked up boundary-scoped from records the agent cannot influence, and the
// cycles it finally reads were de-identified before they were ever stored.
import { isCaseHalted } from "../services/caseGuard";
import {
  deriveAdmissionDecisionId,
  deriveExecutionId,
  hashExecutionInput,
  hashFinding,
  runProjectedAssessment,
  type ExecutionInput,
} from "../../src/contract/assessmentExecution";
import { executionCode, type ExecutionRefusal } from "../../src/contract/executionCodes";
import { mayEvaluate, whyCannotEvaluate } from "../../src/contract/policyLifecycle";
import { makePolicy } from "../../src/assessment/policy";
import { findSubmissionByDecisionId } from "../persistence/pilotDatasetStore";
import { policyGovernanceState } from "../persistence/pilotPolicyGovernanceStore";
import {
  appendExecutionEvent,
  inputPurgeRecord,
  findExecutionInput,
  findExecutionUnscoped,
  recordFindingIfAbsent,
} from "../persistence/pilotExecutionStore";
import type { AgentHandler, CandidateSignal } from "./types";

export const PILOT_ASSESSMENT_AGENT_ID = "pilot-assessment-v1";

/** The complete, exhaustive payload shape. Any other key is a rejected payload, not a warning. */
const PAYLOAD_FIELDS = ["executionId"] as const;

/** An observation-only agent returns nothing. Named so the intent is unmistakable at the call site. */
const NO_CANDIDATE_SIGNALS: readonly CandidateSignal[] = Object.freeze([]);

export interface PilotAssessmentAgentDeps {
  /** Injected so a test can drive a deterministic clock; it never affects the finding's content. */
  readonly now?: () => Date;
}

/**
 * A block is TERMINAL and the task SUCCEEDS.
 *
 * That combination is deliberate. A frozen policy, a halted case or a tampered input is an answer,
 * not a transient error: retrying cannot change it, and letting the runtime retry-and-dead-letter
 * such a task would bury a governance decision under an operational failure. So the refusal is
 * recorded against the execution, and the task completes having correctly produced nothing.
 */
class ExecutionBlocked extends Error {
  constructor(
    readonly refusal: ExecutionRefusal,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "ExecutionBlocked";
  }
}

export function createPilotAssessmentAgent(deps: PilotAssessmentAgentDeps = {}): AgentHandler {
  const now = deps.now ?? (() => new Date());

  return {
    agentId: PILOT_ASSESSMENT_AGENT_ID,
    // Declared, and enforced by the runtime: if any branch below ever returned a signal, the task
    // would fail before publication instead of quietly creating a case candidate.
    publishesCandidates: false,

    async run(payload, context): Promise<readonly CandidateSignal[]> {
      const keys = Object.keys(payload);
      if (keys.length !== PAYLOAD_FIELDS.length || !PAYLOAD_FIELDS.every((f) => keys.includes(f))) {
        throw new Error("invalid pilot assessment payload fields");
      }
      const executionId = payload.executionId;
      if (typeof executionId !== "string" || !/^PAX-[a-f0-9]{32}$/.test(executionId)) {
        throw new Error("pilot assessment payload requires a derived execution id");
      }

      // Loaded UNSCOPED and then compared: the worker is told a boundary by its own configuration,
      // and asking the execution to agree is stronger than filtering by the boundary we assumed.
      const execution = await findExecutionUnscoped(executionId);
      if (!execution) throw new Error("pilot assessment execution does not exist");
      const boundaryId = execution.binding.boundaryId;

      if (boundaryId !== context.boundaryId) {
        // Not blocked-and-recorded: a cross-boundary claim must not write anything into the other
        // tenant's audit log, and the runtime's failure path is the right place for it.
        throw new Error("pilot assessment execution is outside the worker boundary");
      }

      await appendExecutionEvent({
        executionId,
        boundaryId,
        transition: "CLAIMED",
        code: null,
        byId: `${context.taskId}#${context.attempt}`,
        detail: "claimed by a leased worker",
      });

      try {
        const finding = await executeAssessment(executionId, execution, now);
        await appendExecutionEvent({
          executionId,
          boundaryId,
          transition: "COMPLETED",
          code: null,
          byId: `${context.taskId}#${context.attempt}`,
          detail: `observation recorded as ${finding.assessmentId}`,
        });
        return NO_CANDIDATE_SIGNALS;
      } catch (error) {
        if (error instanceof ExecutionBlocked) {
          await appendExecutionEvent({
            executionId,
            boundaryId,
            transition: "BLOCKED",
            code: executionCode(error.refusal).code,
            byId: `${context.taskId}#${context.attempt}`,
            detail: error.detail,
          });
          return NO_CANDIDATE_SIGNALS;
        }
        // A genuine failure. Recorded, then rethrown so the runtime's normal retry, backoff and
        // dead-letter behaviour applies — the orchestration does not invent a second retry policy.
        await appendExecutionEvent({
          executionId,
          boundaryId,
          transition: "FAILED",
          code: executionCode("assessment_error").code,
          byId: `${context.taskId}#${context.attempt}`,
          // The message is the agent's own, never a database or customer string.
          detail: "the assessment computation did not complete",
        });
        throw error;
      }
    },
  };
}

async function executeAssessment(
  executionId: string,
  execution: NonNullable<Awaited<ReturnType<typeof findExecutionUnscoped>>>,
  now: () => Date,
) {
  const binding = execution.binding;
  const boundaryId = binding.boundaryId;

  // 1 · The binding still hashes to the id it is stored under. If not, the record changed under a
  // frozen identity, and re-deriving the id to make it fit is exactly what must not happen.
  if ((await deriveExecutionId(binding)) !== executionId) {
    throw new ExecutionBlocked("decision_binding_mismatch", "the execution does not hash to its own identifier");
  }

  // 2 · The admission decision still exists, still belongs to this boundary, is still ADMISSIBLE,
  // and still hashes to the identifier this execution is bound to.
  const decision = await findSubmissionByDecisionId(binding.admissionDecisionId, boundaryId);
  if (!decision) {
    throw new ExecutionBlocked("dataset_not_submitted", "the bound admission decision no longer resolves in this boundary");
  }
  if (decision.admissionOutcome !== "ADMISSIBLE") {
    throw new ExecutionBlocked("admission_not_admissible", "the bound decision is not ADMISSIBLE");
  }
  if (decision.datasetFingerprint !== binding.datasetFingerprint) {
    throw new ExecutionBlocked("fingerprint_mismatch", "the bound decision names different bytes");
  }
  if (!decision.admissionPolicyId || !decision.admissionPolicyVersion || !decision.admissionPolicyHash) {
    throw new ExecutionBlocked("admission_not_admissible", "the bound decision names no policy");
  }
  const rederived = await deriveAdmissionDecisionId({
    boundaryId,
    idempotencyKey: decision.idempotencyKey,
    datasetFingerprint: decision.datasetFingerprint,
    contractVersion: decision.contractVersion,
    outcome: decision.admissionOutcome,
    admissionPolicyId: decision.admissionPolicyId,
    admissionPolicyVersion: decision.admissionPolicyVersion,
    admissionPolicyHash: decision.admissionPolicyHash,
  });
  if (rederived !== binding.admissionDecisionId) {
    throw new ExecutionBlocked("decision_binding_mismatch", "the stored decision does not hash to its own identifier");
  }

  // 3 · GOVERNANCE, RE-CHECKED AT EXECUTION TIME. This is the check the whole slice turns on: a bar
  // frozen or retired after scheduling must stop the run that was already queued under it, or
  // freezing would only ever affect work nobody had started yet.
  const governance = await policyGovernanceState(
    boundaryId,
    binding.admissionPolicyId,
    binding.admissionPolicyVersion,
  );
  if (!mayEvaluate(governance.state)) {
    throw new ExecutionBlocked("policy_not_active", whyCannotEvaluate(governance.state));
  }
  if (binding.admissionPolicyHash !== decision.admissionPolicyHash) {
    throw new ExecutionBlocked("decision_binding_mismatch", "the bound policy hash differs from the decision's");
  }

  // 4 · CASE HALT. An assessment is not a governed mutation — it creates no counted number, so it is
  // deliberately NOT added to `HALTED_MUTATIONS`, which would change what Halt means for the proof
  // chain. But when an execution is linked to a case, a halt on that case must stop it: a steward
  // who has stopped a case has stopped work on it, and quietly producing fresh observations under a
  // halted case would be governance in name only.
  if (binding.recoveryCaseId !== null && (await isCaseHalted(binding.recoveryCaseId))) {
    throw new ExecutionBlocked("case_halted", "the linked recovery case is halted");
  }

  // 5 · The input is present and unchanged since it was written.
  const stored = await findExecutionInput(executionId, boundaryId);
  if (!stored) {
    // A purged input and an absent one are different facts and must not share one code. "Collected on
    // schedule, after this run had already finished" is an expected, benign outcome; "there is no
    // input and no record of one" is a bug worth finding.
    const purge = await inputPurgeRecord(executionId, boundaryId);
    if (purge) {
      throw new ExecutionBlocked(
        "execution_input_purged",
        `the input was purged under the retention policy (${purge.reason})`,
      );
    }
    throw new ExecutionBlocked("execution_input_missing", "the execution has no stored input");
  }
  const input: ExecutionInput = Object.freeze({
    scheme: "nh-pilot-assessment-projection-v1",
    cycles: stored.cycles,
  });
  const recomputed = await hashExecutionInput(input);
  if (recomputed !== stored.inputHash || stored.inputHash !== execution.inputHash) {
    throw new ExecutionBlocked("execution_input_tampered", "the stored input does not match its recorded hash");
  }

  // 6 · Run it. `makePolicy` rebuilds the SAME policy the binding froze, so the run cannot drift onto
  // a different as-of date or threshold than the one its identity was derived from.
  const policy = makePolicy({
    policyId: binding.assessmentPolicy.policyId,
    policyVersion: binding.assessmentPolicy.policyVersion,
    stallThresholdDays: binding.assessmentPolicy.stallThresholdDays,
    asOf: binding.assessmentPolicy.asOf,
    currency: binding.assessmentPolicy.currency,
  });
  const finding = runProjectedAssessment({
    executionId,
    binding,
    input,
    policy,
    // Not folded into the finding's hash-relevant content; the assessment id is derived from the
    // fingerprint, the policy and the interpretation, never from when the run happened.
    createdAt: now().toISOString(),
  });

  // 7 · Record it, idempotently. The finding is deterministic given the binding and the input, so a
  // retry after a lost lease re-derives byte-identical content and the second write is a provable
  // no-op. A DIFFERENT hash under the same execution id is not reconciled — it is a tamper signal.
  const findingHash = await hashFinding(finding);
  const result = await recordFindingIfAbsent({
    finding,
    findingHash,
    producedBy: PILOT_ASSESSMENT_AGENT_ID,
  });
  if (result.conflict) {
    throw new ExecutionBlocked("finding_conflict", "a different finding is already recorded for this execution");
  }
  return finding;
}
