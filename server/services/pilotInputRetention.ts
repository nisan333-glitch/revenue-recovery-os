// EP-17 · Retention policy for assessment-execution inputs.
//
// WHAT IS BEING RETAINED. `pilot_assessment_execution_inputs` holds PSEUDONYMISED CUSTOMER-DERIVED
// rows: direct identifiers are replaced by ordinals, but exact dates and exact minor-unit amounts
// remain, and those can permit linkage back to the source data. So its lifetime is a decision that has
// to be made, not a detail that can be left unstated.
//
// BOTH SETTINGS ARE REQUIRED AND THERE IS NO DEFAULT. This is the same discipline the admission gate
// uses, for the same reason: a retention period this module invented would be quoted later as though
// someone had chosen it. With either setting absent, `purgeEligibleInputs` purges nothing and reports
// NH-AX-4004. That is fail-closed for the data (nothing is deleted on a guess) and it is deliberately
// NOT a state to leave in place — an unconfigured deployment retains indefinitely, which the report
// says out loud so it cannot pass for a policy.
//
// WHO MAY PURGE. `PurgeAssessmentInput` is held by the steward alone. The actors who benefit from a
// larger recovery number (author, operator) must not be the ones who can delete the stored inputs a
// finding was computed from — even though a purge cannot change a number, because the hashes and the
// finding survive it.
import { prisma, type DbClient } from "../db";
import {
  retentionCodeFor,
  type RetentionCodeSpec,
  type RetentionDecision,
} from "../../src/contract/executionCodes";
import { requireCan } from "../auth/authorityGate";
import { requireBoundaryAccess, type ActorContext } from "../auth/identity";
import { deriveExecutionState } from "../../src/contract/assessmentExecution";
import { executionEvents, inputPurgeRecord } from "../persistence/pilotExecutionStore";

/** The two required settings. Neither has, or may acquire, a default. */
export interface InputRetentionPolicy {
  /** Hours to keep an input after the execution completed or was blocked. */
  readonly terminalGraceHours: number;
  /** Days to keep the input of an execution that never reached a terminal state. */
  readonly abandonedRetentionDays: number;
}

export const TERMINAL_GRACE_VARIABLE = "NH_PILOT_INPUT_TERMINAL_GRACE_HOURS";
export const ABANDONED_RETENTION_VARIABLE = "NH_PILOT_INPUT_ABANDONED_RETENTION_DAYS";

export interface RetentionPolicyResult {
  readonly policy: InputRetentionPolicy | null;
  /** Every defect at once, so an operator fixes the configuration in one pass. */
  readonly defects: readonly string[];
}

function parseWholeNumber(name: string, raw: string | undefined, max: number): {
  readonly value: number | null;
  readonly defect: string | null;
} {
  if (raw === undefined || raw.trim() === "") {
    return { value: null, defect: `${name} is not set` };
  }
  const text = raw.trim();
  // Strict: no leading plus, no decimals, no exponent. A retention period read out of a sloppy string
  // is worse than one that is refused, because it looks configured.
  if (!/^(0|[1-9][0-9]*)$/.test(text)) {
    return { value: null, defect: `${name} must be a whole number of units, with no sign or decimal` };
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value > max) {
    return { value: null, defect: `${name} must be between 0 and ${max}` };
  }
  return { value, defect: null };
}

/**
 * Read the policy from the environment. Absence is reported, never substituted.
 *
 * The caps are sanity bounds on a typo, not a recommended range: 8760 hours is a year, and 3650 days
 * is a decade. Neither is advice about how long anything should be kept.
 */
export function parseInputRetentionPolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RetentionPolicyResult {
  const grace = parseWholeNumber(TERMINAL_GRACE_VARIABLE, env[TERMINAL_GRACE_VARIABLE], 8_760);
  const abandoned = parseWholeNumber(ABANDONED_RETENTION_VARIABLE, env[ABANDONED_RETENTION_VARIABLE], 3_650);
  const defects = [grace.defect, abandoned.defect].filter((d): d is string => d !== null);
  if (defects.length > 0 || grace.value === null || abandoned.value === null) {
    return Object.freeze({ policy: null, defects: Object.freeze(defects) });
  }
  return Object.freeze({
    policy: Object.freeze({ terminalGraceHours: grace.value, abandonedRetentionDays: abandoned.value }),
    defects: Object.freeze([]),
  });
}

/** One execution's retention verdict. Always coded, whether or not anything was deleted. */
export interface RetentionVerdict {
  readonly executionId: string;
  readonly boundaryId: string;
  readonly decision: RetentionDecision;
  readonly code: RetentionCodeSpec;
  readonly purged: boolean;
}

export interface RetentionRunReport {
  readonly policy: InputRetentionPolicy | null;
  readonly defects: readonly string[];
  readonly examined: number;
  readonly purged: number;
  readonly retained: number;
  readonly verdicts: readonly RetentionVerdict[];
}

function verdict(
  executionId: string,
  boundaryId: string,
  decision: RetentionDecision,
): RetentionVerdict {
  const code = retentionCodeFor(decision);
  return Object.freeze({
    executionId,
    boundaryId,
    decision,
    code,
    purged: code.outcome === "purged",
  });
}

const PURGE_REASON: Readonly<Record<string, string>> = Object.freeze({
  purged_terminal_completed: "terminal_completed",
  purged_terminal_blocked: "terminal_blocked",
  purged_abandoned: "abandoned_retention_elapsed",
});

/**
 * Purge every input that the policy makes eligible, and report a coded verdict for every one it
 * examined — including the ones it left alone. A retention job that only reports what it deleted
 * cannot be audited, because "nothing was eligible" and "the job did not run" look identical.
 *
 * ELIGIBILITY IS DECIDED TWICE. This function decides, and the database re-checks the decision
 * against the durable event log, the task state and the elapsed bound when the authorization row is
 * inserted (see the EP-17 migration). A disagreement raises rather than deletes: the verdict below is
 * downgraded to the matching retained code, never forced through.
 */
export async function purgeEligibleInputs(
  actor: ActorContext,
  options: {
    readonly boundaryId?: string;
    readonly limit?: number;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly now?: () => Date;
  } = {},
): Promise<RetentionRunReport> {
  requireCan(actor, "PurgeAssessmentInput");
  if (options.boundaryId !== undefined) requireBoundaryAccess(actor, options.boundaryId);
  const scoped = options.boundaryId?.trim();
  const now = (options.now ?? (() => new Date()))();

  const { policy, defects } = parseInputRetentionPolicy(options.env ?? process.env);

  const inputs = await prisma.pilotAssessmentExecutionInputRecord.findMany({
    where: scoped ? { boundaryId: scoped } : {},
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(options.limit ?? 200, 1), 1_000),
    select: { executionId: true, boundaryId: true, inputHash: true, cycleCount: true },
  });

  // No policy: report every input as retained under NH-AX-4004 rather than silently doing nothing.
  if (policy === null) {
    const verdicts = inputs.map((i) => verdict(i.executionId, i.boundaryId, "retained_no_policy"));
    return Object.freeze({
      policy: null,
      defects,
      examined: inputs.length,
      purged: 0,
      retained: verdicts.length,
      verdicts: Object.freeze(verdicts),
    });
  }

  const verdicts: RetentionVerdict[] = [];
  for (const input of inputs) {
    const decision = await decide(input.executionId, input.boundaryId, policy, now);
    if (!retentionCodeFor(decision).outcome.startsWith("purg")) {
      verdicts.push(verdict(input.executionId, input.boundaryId, decision));
      continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        // The authorization is written FIRST, inside this transaction, because the delete trigger
        // requires it to exist. Both statements commit together or neither does, so there is no state
        // in which an input is gone without a record of why.
        await tx.pilotAssessmentInputPurgeRecord.create({
          data: {
            executionId: input.executionId,
            boundaryId: input.boundaryId,
            reason: PURGE_REASON[decision]!,
            inputHash: input.inputHash,
            cycleCount: input.cycleCount,
            terminalGraceHours: policy.terminalGraceHours,
            abandonedRetentionDays: policy.abandonedRetentionDays,
            authorizedByActorId: actor.actorId,
            authorizedByRole: actor.role,
          },
        });
        await tx.pilotAssessmentExecutionInputRecord.delete({
          where: { executionId: input.executionId },
        });
      });
      verdicts.push(verdict(input.executionId, input.boundaryId, decision));
    } catch {
      // The database refused the authorization, so its view of the event log, the task state or the
      // elapsed time disagrees with ours. The input stays. Reported as in-flight because that is the
      // only disagreement the trigger can raise that this function could have got wrong, and the
      // conservative reading of a disagreement about a deletion is "do not delete".
      verdicts.push(verdict(input.executionId, input.boundaryId, "retained_in_flight"));
    }
  }

  const purged = verdicts.filter((v) => v.purged).length;
  return Object.freeze({
    policy,
    defects,
    examined: inputs.length,
    purged,
    retained: verdicts.length - purged,
    verdicts: Object.freeze(verdicts),
  });
}

/**
 * Which rule applies to one execution.
 *
 * Order matters. A claimable task wins over everything: it will need this input again, and elapsed
 * time is not a reason to take it from a run still in flight. Only then does terminal-versus-abandoned
 * get asked.
 */
async function decide(
  executionId: string,
  boundaryId: string,
  policy: InputRetentionPolicy,
  now: Date,
  client: DbClient = prisma,
): Promise<RetentionDecision> {
  const claimable = await client.agentTaskRecord.findFirst({
    where: {
      boundaryId,
      idempotencyKey: executionId,
      status: { notIn: ["succeeded", "dead_lettered"] },
    },
    select: { taskId: true },
  });
  if (claimable) return "retained_in_flight";

  const events = await executionEvents(executionId, boundaryId, client);
  const state = deriveExecutionState(events);

  if (state === "completed" || state === "blocked") {
    const transition = state === "completed" ? "COMPLETED" : "BLOCKED";
    // The LATEST such event: a grace period runs from the most recent time it reached that state.
    const at = events
      .filter((e) => e.transition === transition)
      .map((e) => Date.parse(e.at))
      .reduce((latest, cur) => (cur > latest ? cur : latest), Number.NEGATIVE_INFINITY);
    if (!Number.isFinite(at)) return "retained_grace_not_elapsed";
    const eligibleAt = at + policy.terminalGraceHours * 3_600_000;
    if (now.getTime() < eligibleAt) return "retained_grace_not_elapsed";
    return state === "completed" ? "purged_terminal_completed" : "purged_terminal_blocked";
  }

  // Abandoned: queued, running or failed with no claimable task left, or no state at all. The clock
  // runs from when the execution was scheduled, which is the only time that exists for a run that
  // never got anywhere.
  const execution = await client.pilotAssessmentExecutionRecord.findFirst({
    where: { executionId, boundaryId },
    select: { scheduledAt: true },
  });
  if (!execution) return "retained_retention_not_elapsed";
  const eligibleAt = execution.scheduledAt.getTime() + policy.abandonedRetentionDays * 86_400_000;
  if (now.getTime() < eligibleAt) return "retained_retention_not_elapsed";
  return "purged_abandoned";
}

// Re-exported for callers that think in terms of retention rather than persistence. The record itself
// lives beside the other execution tables, so the agent can read it without importing a service.
export { inputPurgeRecord };
