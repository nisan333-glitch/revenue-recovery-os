// EP-31 · Phase B · Turn a COMPLETED execution's staged attribution into governed CandidateSignals.
//
// WHERE THIS SITS, AND WHY IT IS NOT AN AGENT HANDLER. The runtime's handler contract has exactly two
// outcomes — a task succeeds or it fails into a retry budget — and no way to say "not ready yet". An
// emitter driven by a task enqueued at schedule time would therefore have to out-wait the worker inside
// `maxAttempts`, making the bridge depend on the retry budget racing the assessment. That is the kind of
// accidental coupling this codebase exists to avoid. So this follows the pattern the repository already
// uses for the same operation: `secureCsvIngestion` — the only thing that creates candidates today — is
// a service invoked by a CLI, not an agent. Same shape, same fail-closed configuration, same store.
//
// STRICTLY DOWNSTREAM OF A COMPLETED EXECUTION. `completed` is checked explicitly and nothing else will
// do. `blocked` is terminal but is NOT success, so it emits nothing; `failed` is not terminal at all —
// the runtime retries it — so it emits nothing either and a later `completed` still works. A candidate
// for an execution that never completed would point at no governed result, which is the whole reason the
// attribution is staged rather than emitted at schedule time.
//
// IT CANNOT CHANGE THE GOVERNED RESULT. Nothing here writes to `pilot_assessment_executions`, its events,
// or its finding — it only reads them. So a failure in emission, in candidate persistence, or in the
// transaction leaves the execution exactly as the worker left it: still `completed`, same finding, same
// hashes. A structural test asserts the absence of any such write path.
//
// NO PARTIAL CANDIDATE. One execution's signals are admitted in ONE transaction through
// `TransactionalCaseCandidateStore`, so the batch is all-or-nothing, and a retry is idempotent because
// the candidate dedupe key is `(boundary, recoveryType, sourceRef)` — an account that already has a
// candidate yields `created: false` rather than a second one.
//
// NOTHING HERE IS A CLAIM OF MONEY. `amountAtRiskMinor` is an obligation observed unsettled as of the
// governed cut-off. A candidate is `pending_review`; it is not a Case, and a Case is not a Proof.
import { prisma } from "../db";
import { CaseAdmissionService, type CaseCandidateStore } from "../agents/caseAdmission";
import { canBeCase, type RecoveryTypeAdmissionPolicy } from "../agents/admission";
import { TransactionalCaseCandidateStore } from "../agents/postgresCaseCandidateStore";
import type { CandidateSignal } from "../agents/types";
import { executionStatus, findExecution } from "../persistence/pilotExecutionStore";
import { PLAYBOOK } from "../../src/domain/recommendation";
import { sha256Hex } from "../../src/assessment/fingerprint";
import { leakInstanceIdentityStatus } from "../../src/contract/leakInstanceIdentity";

/** The agent identity this emitter publishes under, and the version stamped into every signal. */
export const SIGNAL_EMITTER_AGENT_ID = "pilot-signal-emitter";
export const SIGNAL_EMITTER_DETECTOR_VERSION = "pilot-signal-emitter@1.0.0";

/**
 * The ONLY recovery type this slice emits, and it is a constant rather than a parameter.
 *
 * `ActivationMissed` is the class the pilot assessment already detects, and it already has everything a
 * governed case needs in `src/domain`: a `LeakageType`, a `creationRule`, an `economicThreshold`, an
 * `expectedProofEvent` and a play (`MilestoneNudge`). So this bridge adds no new domain object and no new
 * detection — it connects what exists. A second recovery type is a separate slice with its own
 * definition, never a widening of this constant.
 */
export const EMITTED_RECOVERY_TYPE = "ActivationMissed" as const;

/** Version of the signal derivation itself. A change here is a new derivation, never a re-grade. */
const SIGNAL_DERIVATION_SCHEME = "nh-pilot-signal-v1";

/** Restated on every result, including a blocked one, so no exit can read as a money figure. */
const CLAIM_BOUNDARY = Object.freeze({
  atRiskOnly: true as const,
  constitutesProof: false as const,
  constitutesRevenue: false as const,
  createsRecoveryCase: false as const,
});

export interface GovernedSignalEmissionOptions {
  readonly boundaryId: string;
  /** Governed per-recovery-type thresholds, in MINOR units. Never defaulted — see `emitGovernedSignals`. */
  readonly policies: ReadonlyMap<string, RecoveryTypeAdmissionPolicy>;
  readonly now?: () => Date;
  /** Bound on executions examined in one run, so a large backlog cannot become one unbounded write. */
  readonly limit?: number;
  /**
   * The candidate store to use inside the batch transaction. Injectable for the same reason the
   * assessment service's `taskStore` is: the all-or-nothing guarantee is only worth having if it can be
   * shown to hold, and the only honest way to show it is to make a write in the middle of the batch fail.
   * Production always uses `TransactionalCaseCandidateStore`, which joins the transaction below.
   */
  readonly candidateStoreFor?: (tx: TransactionClient) => CaseCandidateStore;
}

/** The interactive-transaction client, as much of it as the candidate store needs. */
export type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export interface EmissionSkip {
  readonly executionId: string;
  readonly reason: "not_completed" | "no_staged_attribution";
  readonly state: string | null;
}

export interface EmissionRefusal {
  readonly executionId: string;
  readonly sourceRef: string;
  readonly reason: string;
}

export interface GovernedSignalEmissionResult {
  readonly boundaryId: string;
  /**
   * EP-31c · When false, NOTHING was emitted because a stable leak-instance identity cannot be
   * established under the current data contract, and `identityBlockedDetail` says so. Checked HERE and
   * not only at staging: a row inserted by any other route — a hand-written INSERT, a build that predates
   * the staging guard, a restore — must not become a candidate either. Defense in depth means two
   * independent refusals, not one guard read twice.
   */
  readonly leakInstanceIdentityEstablishable: boolean;
  readonly identityBlockedDetail: string | null;
  readonly executionsExamined: number;
  readonly executionsEmitted: number;
  readonly candidatesCreated: number;
  readonly candidatesAlreadyPresent: number;
  /** Signals the governed admission gate declined — below threshold, typically. Reported, never hidden. */
  readonly refused: readonly EmissionRefusal[];
  readonly skipped: readonly EmissionSkip[];
  /** Restated on every result so a caller cannot read this as a money figure. */
  readonly claimBoundary: {
    readonly atRiskOnly: true;
    readonly constitutesProof: false;
    readonly constitutesRevenue: false;
    readonly createsRecoveryCase: false;
  };
}

/** The lineage a signal is derived from. Hashed into `sourcePayloadHash` so it is falsifiable. */
interface SignalLineage {
  readonly boundaryId: string;
  readonly executionId: string;
  readonly admissionDecisionId: string;
  readonly datasetFingerprint: string;
  readonly contractVersion: string;
  readonly assessmentPolicyRef: string;
  readonly asOf: string;
  readonly stallThresholdDays: number;
  readonly currency: string;
  readonly sourceRef: string;
  readonly amountAtRiskMinor: number;
  readonly attributionRule: string;
}

function canonicalLineage(lineage: SignalLineage): string {
  // NUL-separated and ordered, so no value can impersonate a separator and shift the others.
  return [
    SIGNAL_DERIVATION_SCHEME,
    SIGNAL_EMITTER_DETECTOR_VERSION,
    EMITTED_RECOVERY_TYPE,
    lineage.boundaryId,
    lineage.executionId,
    // Carries the submission identity transitively: the admission decision id is derived from the
    // submission's idempotency key, which under contract 2.0.0 contains the governed analysis terms.
    lineage.admissionDecisionId,
    lineage.datasetFingerprint,
    lineage.contractVersion,
    lineage.assessmentPolicyRef,
    lineage.asOf,
    String(lineage.stallThresholdDays),
    lineage.currency,
    lineage.sourceRef,
    String(lineage.amountAtRiskMinor),
    lineage.attributionRule,
  ].join("\u0000");
}

/**
 * Build one signal. Every field is DERIVED — from the staged row, the execution's own binding, or the
 * PLAYBOOK. There is no parameter through which a caller could supply the amount at risk, the recovery
 * type, whether an action exists, or what would later prove recovery.
 */
async function buildSignal(lineage: SignalLineage): Promise<CandidateSignal> {
  const digest = await sha256Hex(canonicalLineage(lineage));
  const play = PLAYBOOK[EMITTED_RECOVERY_TYPE];
  return Object.freeze({
    signalId: `PSG-${digest.slice(0, 32)}`,
    boundaryId: lineage.boundaryId,
    recoveryType: EMITTED_RECOVERY_TYPE,
    sourceRef: lineage.sourceRef,
    sourcePayloadHash: digest,
    detectorVersion: SIGNAL_EMITTER_DETECTOR_VERSION,
    // From the GOVERNED cut-off, never from a clock: the observation is as-of the analysis terms.
    observedAt: `${lineage.asOf}T00:00:00.000Z`,
    amountAtRiskMinor: lineage.amountAtRiskMinor,
    currency: lineage.currency,
    // A play existing IS what makes a recovery action plausible — criterion 2 of the case admission rule.
    actionAvailable: true,
    expectedProofEvent: play.expectedProofEvent,
  });
}

/**
 * Emit for every `completed` execution in this boundary that has staged attribution and no candidate yet.
 *
 * FAIL-CLOSED ON THE THRESHOLD. `policies` must contain `ActivationMissed`; there is no default and none
 * is invented, because the materiality floor is a commercial judgement and a system that picks its own is
 * grading its own homework. An absent policy throws rather than emitting everything.
 */
export async function emitGovernedSignals(
  options: GovernedSignalEmissionOptions,
): Promise<GovernedSignalEmissionResult> {
  const boundaryId = options.boundaryId.trim();
  if (!boundaryId) throw new Error("boundaryId is required");
  const policy = options.policies.get(EMITTED_RECOVERY_TYPE);
  if (!policy) {
    throw new Error(
      `no governed admission policy is configured for ${EMITTED_RECOVERY_TYPE}; ` +
        "the materiality floor is not defaulted and emission is refused",
    );
  }
  const now = options.now ?? (() => new Date());
  const limit = options.limit ?? 100;

  // THE INDEPENDENT GUARD. Asked before any staged row is read, so the answer cannot depend on what the
  // staging path happened to write — which is what makes it a second refusal rather than an echo of the
  // first. A NAMED result, never a throw: emission declining must not look like a failure of anything
  // upstream, and the governed assessment it reads from is untouched either way.
  const identity = leakInstanceIdentityStatus();
  if (!identity.establishable) {
    return Object.freeze({
      boundaryId,
      leakInstanceIdentityEstablishable: false,
      identityBlockedDetail: identity.detail,
      executionsExamined: 0,
      executionsEmitted: 0,
      candidatesCreated: 0,
      candidatesAlreadyPresent: 0,
      refused: Object.freeze([]),
      skipped: Object.freeze([]),
      claimBoundary: CLAIM_BOUNDARY,
    });
  }

  const staged = await prisma.pilotAssessmentEntityAttributionRecord.findMany({
    where: { boundaryId },
    orderBy: [{ executionId: "asc" }, { sourceRef: "asc" }],
  });

  const byExecution = new Map<string, typeof staged>();
  for (const row of staged) {
    const bucket = byExecution.get(row.executionId);
    if (bucket) bucket.push(row);
    else byExecution.set(row.executionId, [row]);
  }

  let executionsExamined = 0;
  let executionsEmitted = 0;
  let candidatesCreated = 0;
  let candidatesAlreadyPresent = 0;
  const refused: EmissionRefusal[] = [];
  const skipped: EmissionSkip[] = [];

  for (const [executionId, rows] of byExecution) {
    if (executionsExamined >= limit) break;
    executionsExamined += 1;

    // THE GATE. `completed` and nothing else: `blocked` is terminal without being success, and `failed`
    // is retryable, so neither may produce a candidate.
    const status = await executionStatus(executionId, boundaryId);
    if (status.state !== "completed") {
      skipped.push({ executionId, reason: "not_completed", state: status.state });
      continue;
    }
    const execution = await findExecution(executionId, boundaryId);
    if (!execution) {
      // Unreachable while the foreign key holds; checked rather than assumed.
      skipped.push({ executionId, reason: "no_staged_attribution", state: status.state });
      continue;
    }
    const binding = execution.binding;

    const signals: CandidateSignal[] = [];
    for (const row of rows) {
      const signal = await buildSignal({
        boundaryId,
        executionId,
        admissionDecisionId: binding.admissionDecisionId,
        datasetFingerprint: binding.datasetFingerprint,
        contractVersion: binding.contractVersion,
        assessmentPolicyRef: `${binding.assessmentPolicy.policyId}@${binding.assessmentPolicy.policyVersion}`,
        asOf: binding.assessmentPolicy.asOf,
        stallThresholdDays: binding.assessmentPolicy.stallThresholdDays,
        currency: row.currency,
        sourceRef: row.sourceRef,
        amountAtRiskMinor: Number(row.amountAtRiskMinor),
        attributionRule: row.attributionRule,
      });
      // The governed gate decides admission; a refusal is REPORTED rather than dropped, because "below
      // the materiality floor" is a fact the operator should be able to see.
      const decision = canBeCase(signal, policy);
      if (!decision.admitted) {
        refused.push({ executionId, sourceRef: row.sourceRef, reason: decision.reason });
        continue;
      }
      signals.push(signal);
    }
    if (signals.length === 0) continue;

    // ONE TRANSACTION for the whole execution: all-or-nothing, so a failure part way through leaves no
    // candidate at all rather than some. The execution itself is untouched either way.
    const outcome = await prisma.$transaction(async (tx) => {
      const store = options.candidateStoreFor
        ? options.candidateStoreFor(tx)
        : new TransactionalCaseCandidateStore(tx);
      const service = new CaseAdmissionService(store, now);
      let created = 0;
      let present = 0;
      for (const signal of signals) {
        const result = await service.submit(SIGNAL_EMITTER_AGENT_ID, signal, policy);
        if (!result.admitted) throw new Error(`admission refused after the gate passed: ${result.reason}`);
        if (result.created) created += 1;
        else present += 1;
      }
      return { created, present };
    });

    candidatesCreated += outcome.created;
    candidatesAlreadyPresent += outcome.present;
    if (outcome.created > 0) executionsEmitted += 1;
  }

  return Object.freeze({
    boundaryId,
    leakInstanceIdentityEstablishable: true,
    identityBlockedDetail: null,
    executionsExamined,
    executionsEmitted,
    candidatesCreated,
    candidatesAlreadyPresent,
    refused: Object.freeze(refused),
    skipped: Object.freeze(skipped),
    claimBoundary: CLAIM_BOUNDARY,
  });
}
