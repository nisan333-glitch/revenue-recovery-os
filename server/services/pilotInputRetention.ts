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
import { Prisma } from "@prisma/client";
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
  /** Records the scan reached a decision about. */
  readonly examined: number;
  readonly purged: number;
  readonly retained: number;
  /**
   * Did the scan reach the end of the eligible set?
   *
   * False only when the run stopped because it had purged `limit` records. That is safe — the next
   * run starts from the oldest remaining record, and the ones just purged are gone, so it advances.
   * It is reported because "purged 50" means something different depending on whether 50 was all of
   * them or all this run was allowed.
   */
  readonly scanComplete: boolean;
  readonly reachedPurgeLimit: boolean;
  /**
   * Exact count per decision code, never truncated.
   *
   * `verdicts` is capped so one run over a large table cannot return an unbounded array, and these
   * counts are what keeps the report auditable anyway: a truncated list plus exact totals still says
   * precisely what happened, where a truncated list alone would not.
   */
  readonly countsByDecision: Readonly<Record<string, number>>;
  /** Every purge, plus a bounded sample of the retained. */
  readonly verdicts: readonly RetentionVerdict[];
  readonly verdictsTruncated: boolean;
}

/** How many records one query reads. Bounds memory without bounding the scan. */
const SCAN_PAGE_SIZE = 200;

/** Retained verdicts reported individually. Every purge is always reported; counts are always exact. */
const MAX_REPORTED_RETAINED = 100;

/**
 * A retention run that stopped on a database error.
 *
 * Carries what had already been purged, because an operator's first question after a failure is what
 * state the data is in. Names the execution it failed on — an opaque hash, never customer content.
 */
export class InputRetentionFailure extends Error {
  /** Declared rather than assigned: the server target is ES2021, whose Error has no `cause`. */
  readonly databaseError: unknown;

  constructor(
    readonly executionId: string,
    readonly purgedBeforeFailure: number,
    databaseError: unknown,
  ) {
    super(
      `input retention stopped on execution ${executionId} after purging ${purgedBeforeFailure}; ` +
        "no further input was deleted",
    );
    this.name = "InputRetentionFailure";
    this.databaseError = databaseError;
  }
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
 * Purge every input the policy makes eligible, scanning the WHOLE eligible set.
 *
 * WHY THE SCAN IS COMPLETE AND ONLY THE PURGES ARE CAPPED. The first version of this function took
 * the oldest 200 records and decided about those. That is a head-of-line block, and a permanent one:
 * if the oldest 200 are all ineligible — one long-lived queued execution is enough — then every run
 * examines the same 200, purges nothing, and never sees the eligible records behind them. A retention
 * policy that silently stops applying past a fixed offset is not a retention policy. So `limit` now
 * bounds the WORK (how many records one run may purge), the scan pages forward through the entire
 * set by keyset, and the report says whether it reached the end.
 *
 * Stopping at the purge limit is safe and does not reintroduce the block: the next run starts again
 * from the oldest remaining record, and the ones this run purged no longer exist, so each run strictly
 * advances.
 *
 * ELIGIBILITY IS DECIDED TWICE. This function decides, and the database re-checks against the durable
 * event log, the task state and the elapsed bound when the authorization row is inserted. The two
 * cannot legitimately disagree: every rule requires the task to be `succeeded` or `dead_lettered`, and
 * both are absorbing — every transition out of them requires `status = 'leased'`, and
 * `enqueueIfAbsent` uses ON CONFLICT DO NOTHING, so a finished task is never reset. A refusal after
 * our checks pass therefore means something is genuinely inconsistent, and it FAILS THE RUN.
 *
 * The earlier version caught every database error and reported `retained_in_flight`. That was wrong
 * twice over: it invented a benign explanation for a class of failure it had not identified — a
 * dropped connection, a constraint bug, a serialization error all read as a routine retention
 * decision — and it made a broken run indistinguishable from a quiet one. Prisma does not expose
 * SQLSTATE through a model `create`, so this cannot be classified after the fact; the honest response
 * to an error nobody can classify is to stop and say so.
 */
export async function purgeEligibleInputs(
  actor: ActorContext,
  options: {
    readonly boundaryId?: string;
    /** Maximum records this run may PURGE. Does not bound how many it examines. */
    readonly limit?: number;
    /**
     * Rows read per query. Bounds memory, never the scan. Exposed so a test can prove the scan pages
     * past an ineligible prefix without creating a page's worth of fixtures, and so an operator can
     * tune it; changing it cannot change which records are eligible.
     */
    readonly scanPageSize?: number;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly now?: () => Date;
  } = {},
): Promise<RetentionRunReport> {
  requireCan(actor, "PurgeAssessmentInput");
  if (options.boundaryId !== undefined) requireBoundaryAccess(actor, options.boundaryId);
  const scoped = options.boundaryId?.trim();
  const now = (options.now ?? (() => new Date()))();
  const purgeLimit = Math.min(Math.max(options.limit ?? 200, 1), 10_000);
  const pageSize = Math.min(Math.max(options.scanPageSize ?? SCAN_PAGE_SIZE, 1), 1_000);
  const where = scoped ? { boundaryId: scoped } : {};

  const { policy, defects } = parseInputRetentionPolicy(options.env ?? process.env);

  const counts = new Map<RetentionDecision, number>();
  const verdicts: RetentionVerdict[] = [];
  let reportedRetained = 0;
  let truncated = false;
  let purgedCount = 0;

  const record = (executionId: string, boundaryId: string, decision: RetentionDecision): void => {
    counts.set(decision, (counts.get(decision) ?? 0) + 1);
    const v = verdict(executionId, boundaryId, decision);
    if (v.purged) purgedCount += 1;
    // Every purge is reported; retained verdicts are sampled. A purge is an irreversible act and must
    // always be individually attributable.
    if (v.purged || reportedRetained < MAX_REPORTED_RETAINED) {
      verdicts.push(v);
      if (!v.purged) reportedRetained += 1;
    } else {
      truncated = true;
    }
  };

  const finish = (examined: number, scanComplete: boolean): RetentionRunReport =>
    Object.freeze({
      policy,
      defects,
      examined,
      purged: purgedCount,
      retained: examined - purgedCount,
      scanComplete,
      reachedPurgeLimit: purgedCount >= purgeLimit && !scanComplete,
      countsByDecision: Object.freeze(
        Object.fromEntries([...counts.entries()].map(([d, n]) => [retentionCodeFor(d).code, n])),
      ),
      verdicts: Object.freeze([...verdicts]),
      verdictsTruncated: truncated,
    });

  // No policy: nothing is eligible, so there is nothing to page through. Report the true total rather
  // than the size of one page, so "retained" is not quietly the scan window.
  if (policy === null) {
    const total = await prisma.pilotAssessmentExecutionInputRecord.count({ where });
    const sample = await prisma.pilotAssessmentExecutionInputRecord.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { executionId: "asc" }],
      take: MAX_REPORTED_RETAINED,
      select: { executionId: true, boundaryId: true },
    });
    for (const input of sample) record(input.executionId, input.boundaryId, "retained_no_policy");
    counts.set("retained_no_policy", total); // the true total, not the sampled page

    truncated = total > sample.length;
    return finish(total, true);
  }

  let cursor: { readonly createdAt: Date; readonly executionId: string } | null = null;
  let examined = 0;

  for (;;) {
    // Keyset, not offset: rows vanish as they are purged, so an offset would skip records.
    // `createdAt` alone is not unique, so `executionId` breaks ties and makes the order total.
    // Annotated explicitly because `cursor` is derived from this query's own result, and without a
    // declared type TypeScript follows that cycle instead of resolving it.
    const pageWhere: Prisma.PilotAssessmentExecutionInputRecordWhereInput = cursor
      ? {
          ...where,
          OR: [
            { createdAt: { gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, executionId: { gt: cursor.executionId } },
          ],
        }
      : where;
    const page = await prisma.pilotAssessmentExecutionInputRecord.findMany({
      where: pageWhere,
      orderBy: [{ createdAt: "asc" }, { executionId: "asc" }],
      take: pageSize,
      select: {
        executionId: true,
        boundaryId: true,
        inputHash: true,
        cycleCount: true,
        createdAt: true,
      },
    });
    if (page.length === 0) return finish(examined, true);

    for (const input of page) {
      cursor = { createdAt: input.createdAt, executionId: input.executionId };
      examined += 1;
      const decision = await decide(input.executionId, input.boundaryId, policy, now);

      if (retentionCodeFor(decision).outcome !== "purged") {
        record(input.executionId, input.boundaryId, decision);
        continue;
      }

      try {
        await prisma.$transaction(async (tx) => {
          // The authorization is written FIRST, inside this transaction, because the delete trigger
          // requires it to exist. Both statements commit together or neither does, so there is no
          // state in which an input is gone without a record of why.
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
      } catch (error) {
        // Not swallowed and not reinterpreted. See the note above: the two task states every rule
        // requires are absorbing, so a refusal here is not a race this function lost — it is an
        // inconsistency, and the run stops rather than logging a reassuring word for it.
        throw new InputRetentionFailure(input.executionId, purgedCount, error);
      }

      record(input.executionId, input.boundaryId, decision);
      if (purgedCount >= purgeLimit) return finish(examined, false);
    }

    if (page.length < pageSize) return finish(examined, true);
  }
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
