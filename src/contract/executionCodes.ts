// EP-16 · Reason codes for pilot assessment execution.
//
// A THIRD catalogue, and deliberately not a merge of the first two. NH-DC-#### answers "is this file
// valid?"; NH-AG-#### answers "is this dataset fit for a pilot?"; these answer "may this admitted
// dataset be executed, and what happened when it was?". Folding them together would let an
// orchestration refusal — "the bar you were judged under has since been frozen" — arrive looking
// like a parsing error the customer could fix by re-exporting. It is not; it is a governance state.
//
// 1xxx — the execution is REFUSED before it starts (a binding or governance precondition fails).
// 2xxx — the execution is BLOCKED once claimed (a precondition changed between schedule and run).
// 3xxx — the execution FAILED (something went wrong that a retry may legitimately fix).
//
// Codes are permanent. A superseded code is retired, never recycled, so a stored execution record
// means the same thing forever.

export type ExecutionCodeSeverity =
  /** Refused at schedule time. Nothing was queued. */
  | "refused"
  /** Claimed, then stopped by a precondition. Terminal — a retry cannot change the answer. */
  | "blocked"
  /** Claimed and errored. Not terminal: the runtime's normal retry/backoff applies. */
  | "failed";

export interface ExecutionCodeSpec {
  readonly code: string;
  readonly severity: ExecutionCodeSeverity;
  readonly title: string;
  /** What someone must actually do. Often a governance decision, not a file to fix. */
  readonly remediation: string;
  readonly since: string;
}

function code(spec: ExecutionCodeSpec): ExecutionCodeSpec {
  return Object.freeze(spec);
}

/**
 * Every distinct reason an execution can be refused, blocked or failed.
 *
 * This union is the single source of truth, and `EXECUTION_REFUSAL_CODES` below is a TOTAL
 * `Record` over it: adding a reason without also giving it a code is a compile error. A new way to
 * refuse a customer's execution cannot reach them uncoded.
 */
export type ExecutionRefusal =
  | "dataset_not_submitted"
  | "admission_decision_missing"
  | "admission_not_admissible"
  | "fingerprint_mismatch"
  | "decision_binding_mismatch"
  | "contract_version_mismatch"
  | "policy_not_active"
  | "boundary_mismatch"
  | "no_assessable_cycles"
  | "case_halted"
  | "execution_input_missing"
  | "execution_input_purged"
  | "execution_input_tampered"
  | "finding_conflict"
  | "assessment_error";

export const EXECUTION_REFUSAL_CODES: Readonly<Record<ExecutionRefusal, ExecutionCodeSpec>> =
  Object.freeze({
    // ── 1xxx · Refused before anything is queued ──────────────────────────────────────────────────
    dataset_not_submitted: code({
      code: "NH-AX-1001",
      severity: "refused",
      title: "No admission decision exists for this dataset in this boundary.",
      remediation:
        "Submit the dataset through the pilot intake first. An assessment may only run on a dataset that has already been judged — running one on an unjudged file is how an unfit dataset becomes a number nobody vetted.",
      since: "1.0.0",
    }),
    admission_decision_missing: code({
      code: "NH-AX-1002",
      severity: "refused",
      title: "The stored submission carries no admission decision identifier.",
      remediation:
        "Re-submit the dataset. Submissions recorded before assessment orchestration existed carry no decision identifier, and an execution cannot be bound to a decision that was never identified. They are deliberately not backfilled: inventing an identifier after the fact would assert a binding that never happened.",
      since: "1.0.0",
    }),
    admission_not_admissible: code({
      code: "NH-AX-1003",
      severity: "refused",
      title: "The dataset's admission decision is not ADMISSIBLE.",
      remediation:
        "Resolve the admission findings and submit a corrected dataset. NOT_ADMISSIBLE and NOT_ASSESSABLE both stop here — an unanswered fitness question is never treated as a passing answer.",
      since: "1.0.0",
    }),
    fingerprint_mismatch: code({
      code: "NH-AX-1004",
      severity: "refused",
      title: "The supplied dataset does not match the bytes that were admitted.",
      remediation:
        "Supply the exact file that was admitted. A single changed byte is a different dataset, and executing it under another dataset's admission decision would attribute a verdict to data that never earned it.",
      since: "1.0.0",
    }),
    decision_binding_mismatch: code({
      code: "NH-AX-1005",
      severity: "refused",
      title: "The admission decision does not hash to its stored identifier.",
      remediation:
        "Do not re-run. The stored decision's identifier and its own fields disagree, which means the record changed after it was written. Investigate the record rather than recomputing the identifier and carrying on.",
      since: "1.0.0",
    }),
    contract_version_mismatch: code({
      code: "NH-AX-1006",
      severity: "refused",
      title: "The dataset was admitted under a different data-contract version.",
      remediation:
        "Re-submit under the contract version this build serves. A decision made under one contract cannot authorise execution under another — the fields may not mean the same thing.",
      since: "1.0.0",
    }),
    policy_not_active: code({
      code: "NH-AX-1007",
      severity: "refused",
      title: "The admission policy is not ACTIVE.",
      remediation:
        "A DRAFT, FROZEN or RETIRED bar may not authorise a new execution. Ask pilot governance to activate or resume the policy; a frozen bar is a deliberate pause, not an obstacle to route around.",
      since: "1.0.0",
    }),
    boundary_mismatch: code({
      code: "NH-AX-1008",
      severity: "refused",
      title: "The execution's tenant boundary does not match the authenticated context.",
      remediation:
        "None. Tenancy comes from the authenticated session and never from a request body; a mismatch is refused rather than reconciled.",
      since: "1.0.0",
    }),
    no_assessable_cycles: code({
      code: "NH-AX-1009",
      severity: "refused",
      title: "No accepted cycle survived projection into an execution input.",
      remediation:
        "Supply a dataset with at least one accepted cycle. An execution over an empty input would report zeroes that look like findings.",
      since: "1.0.0",
    }),

    // ── 2xxx · Blocked after the task was claimed ─────────────────────────────────────────────────
    case_halted: code({
      code: "NH-AX-2001",
      severity: "blocked",
      title: "The linked recovery case is halted.",
      remediation:
        "None while the halt stands. A halted case accepts no new work; the execution stops and records why. Audit reads remain available.",
      since: "1.0.0",
    }),
    execution_input_missing: code({
      code: "NH-AX-2002",
      severity: "blocked",
      title: "The execution's stored input is absent.",
      remediation:
        "Schedule the execution again. The input is written in the same transaction as the execution record, so its absence means the record was reached by a path that never wrote one.",
      since: "1.0.0",
    }),
    execution_input_purged: code({
      code: "NH-AX-2005",
      severity: "blocked",
      title: "The execution's input has been purged under the retention policy.",
      remediation:
        "None, and none is needed: the run had already reached a terminal state before its input became eligible to purge. The finding, the binding and both hashes survive, so the result is still reproducible from the customer's original file. Schedule a new execution if the dataset must be assessed again.",
      since: "1.1.0",
    }),
    execution_input_tampered: code({
      code: "NH-AX-2003",
      severity: "blocked",
      title: "The execution's stored input does not match its recorded hash.",
      remediation:
        "Do not re-run. The input changed after it was written. Investigate; re-executing would produce a finding for data the admission decision never saw.",
      since: "1.0.0",
    }),
    finding_conflict: code({
      code: "NH-AX-2004",
      severity: "blocked",
      title: "A finding already exists for this execution with different content.",
      remediation:
        "Do not re-run. The same binding and the same input must produce the same finding; two different answers means one of the three changed.",
      since: "1.0.0",
    }),

    // ── 3xxx · Failed, and a retry may legitimately help ──────────────────────────────────────────
    assessment_error: code({
      code: "NH-AX-3001",
      severity: "failed",
      title: "The assessment computation did not complete.",
      remediation:
        "The runtime retries with backoff and dead-letters at the attempt ceiling. If it dead-letters, the stored input and binding reproduce the failure exactly.",
      since: "1.0.0",
    }),
  });

// ── 4xxx · Retention decisions ────────────────────────────────────────────────────────────────────
//
// A SEPARATE catalogue, not more entries in the refusal union above. A purge is not a refusal of an
// execution — the run already finished — and folding the two together would make "your input was
// collected on schedule" read like something went wrong with the assessment.

export type RetentionOutcome = "purged" | "retained";

export interface RetentionCodeSpec {
  readonly code: string;
  readonly outcome: RetentionOutcome;
  readonly title: string;
  readonly remediation: string;
  readonly since: string;
}

function retentionCode(spec: RetentionCodeSpec): RetentionCodeSpec {
  return Object.freeze(spec);
}

/** Every reason an input was, or was not, purged. Total over `RetentionDecision` below. */
export type RetentionDecision =
  | "purged_terminal_completed"
  | "purged_terminal_blocked"
  | "purged_abandoned"
  | "retained_no_policy"
  | "retained_in_flight"
  | "retained_grace_not_elapsed"
  | "retained_retention_not_elapsed";

export const RETENTION_CODES: Readonly<Record<RetentionDecision, RetentionCodeSpec>> = Object.freeze({
  purged_terminal_completed: retentionCode({
    code: "NH-AX-4001",
    outcome: "purged",
    title: "Input purged after the execution completed and its grace period elapsed.",
    remediation:
      "Nothing to do. The finding, the binding, the event log and both hashes are unaffected; only the pseudonymised input rows were collected.",
    since: "1.1.0",
  }),
  purged_terminal_blocked: retentionCode({
    code: "NH-AX-4002",
    outcome: "purged",
    title: "Input purged after the execution was blocked and its grace period elapsed.",
    remediation:
      "Nothing to do. A blocked execution is terminal, so its input can serve no further run. The refusal and its code remain in the event log.",
    since: "1.1.0",
  }),
  purged_abandoned: retentionCode({
    code: "NH-AX-4003",
    outcome: "purged",
    title: "Input purged: the execution never reached a terminal state and its retention period elapsed.",
    remediation:
      "If this dataset still needs assessing, schedule a new execution. An abandoned run whose input is gone will report NH-AX-2005 rather than producing a finding from data nobody re-checked.",
    since: "1.1.0",
  }),
  retained_no_policy: retentionCode({
    code: "NH-AX-4004",
    outcome: "retained",
    title: "No retention policy is configured, so nothing was purged.",
    remediation:
      "Set both NH_PILOT_INPUT_TERMINAL_GRACE_HOURS and NH_PILOT_INPUT_ABANDONED_RETENTION_DAYS. There is deliberately no default: a retention period is a policy decision, and a number this code invented would be quoted later as though someone had chosen it. Until both are set, inputs are kept — which is the fail-closed direction for data the system was trusted with, and the direction that must not be left in place indefinitely.",
    since: "1.1.0",
  }),
  retained_in_flight: retentionCode({
    code: "NH-AX-4005",
    outcome: "retained",
    title: "Input retained: the execution still has a claimable task.",
    remediation:
      "Nothing to do. A queued, leased or retry-waiting task will need this input again, and elapsed time is not a reason to take it from a run still in flight.",
    since: "1.1.0",
  }),
  retained_grace_not_elapsed: retentionCode({
    code: "NH-AX-4006",
    outcome: "retained",
    title: "Input retained: the execution is terminal but its grace period has not elapsed.",
    remediation: "Nothing to do. It becomes eligible once the configured grace period has passed.",
    since: "1.1.0",
  }),
  retained_retention_not_elapsed: retentionCode({
    code: "NH-AX-4007",
    outcome: "retained",
    title: "Input retained: the execution has not reached a terminal state and its retention period has not elapsed.",
    remediation:
      "Nothing to do. An execution can legitimately sit un-run for a while; it becomes eligible for the abandoned rule once the configured period has passed.",
    since: "1.1.0",
  }),
});

export function retentionCodeFor(decision: RetentionDecision): RetentionCodeSpec {
  return RETENTION_CODES[decision];
}

export function allRetentionCodes(): readonly RetentionCodeSpec[] {
  return Object.freeze(Object.values(RETENTION_CODES).sort((a, b) => a.code.localeCompare(b.code)));
}

/** Look up one code. Total over the union, so this never returns undefined. */
export function executionCode(refusal: ExecutionRefusal): ExecutionCodeSpec {
  return EXECUTION_REFUSAL_CODES[refusal];
}

/** Every code in the catalogue, ascending. Used by docs and by the catalogue's own tests. */
export function allExecutionCodes(): readonly ExecutionCodeSpec[] {
  return Object.freeze(
    Object.values(EXECUTION_REFUSAL_CODES).sort((a, b) => a.code.localeCompare(b.code)),
  );
}
