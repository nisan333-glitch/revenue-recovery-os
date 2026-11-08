// The engine: the sequence that turns a recorded task into a recorded model call.
//
// WHAT THIS IS. One step function over one immutable state. It takes a `ModelPort` and a `now`, consults the
// four guards IN ORDER, and either invokes the port exactly once or returns a refusal naming which guard
// refused. Every refusal happens BEFORE invocation, so a refusal costs nothing — which is the whole point of
// a guard, and is asserted on an invocation counter rather than on the resulting record.
//
// WHAT IT DELIBERATELY CANNOT DO.
//
//   · It cannot create a task from a model answer. Continuations are submitted by an ACTOR — a person, or
//     Claude Code acting on an owner instruction — and never derived from what a model said. That is the
//     root of the loop-amplification protection: a model that asks for more work is a model whose answer is
//     a string on a record, and the chain-depth and fan-out limits in `task.ts` are the second line, not the
//     first.
//   · It cannot take a privileged action. `classifyAction` is consulted for the action it is about to take,
//     and the only action it ever takes is `invoke_model`. Anything privileged becomes a `PendingApproval`.
//   · It branches on NO model text. Read the success path below: the finding is stored and the task is marked
//     succeeded. There is no comparison against the answer's content anywhere, so an instruction injected
//     into it has no mechanism to act. A structural test asserts this of the source.
//
// PURE IN THE SENSE THAT MATTERS. No clock, no filesystem, no network of its own, no process exit. It awaits
// the injected port, which is the one thing that touches the outside world, and `now` arrives as an argument.

import {
  admitCall,
  admitThroughBreaker,
  budgetReport,
  classifyAction,
  CLOSED_BREAKER,
  EMPTY_BUDGET,
  raiseApproval,
  recordFailure,
  recordSuccess,
  reserveBudget,
  settleBudget,
  type BreakerPolicy,
  type BreakerState,
  type BudgetLedger,
  type BudgetPolicy,
  type BudgetReport,
  type PendingApproval,
  type RateLedger,
  type RatePolicy,
} from "./guards.ts";
import {
  estimateCents,
  priceUsage,
  readModelOutput,
  MODEL_RECORD_SCHEMA,
  type ModelCallRecord,
  type ModelPort,
  type ModelPricing,
  type ModelRequest,
} from "./modelPort.ts";
import {
  DEFAULT_LIMITS,
  recordAttempt,
  submitTask,
  transition,
  type OrchestratorLimits,
  type SubmitInput,
  type SubmitResult,
  type TaskLedger,
} from "./task.ts";

export interface OrchestratorConfig {
  model: string;
  maxOutputTokens: number;
  pricing: ModelPricing;
  budget: BudgetPolicy;
  rate: RatePolicy;
  breaker: BreakerPolicy;
  limits: OrchestratorLimits;
}

export const DEFAULT_CONFIG: Readonly<OrchestratorConfig> = Object.freeze({
  model: "gpt-4o-mini",
  maxOutputTokens: 800,
  pricing: Object.freeze({ promptCentsPer1k: 2, completionCentsPer1k: 8 }),
  budget: Object.freeze({ capCents: 500 }),
  rate: Object.freeze({ maxCalls: 10, windowSeconds: 60 }),
  breaker: Object.freeze({ failureThreshold: 3, cooldownSeconds: 300 }),
  limits: DEFAULT_LIMITS,
});

export interface OrchestratorState {
  readonly tasks: TaskLedger;
  readonly budget: BudgetLedger;
  readonly rate: RateLedger;
  readonly breaker: BreakerState;
  /** Model calls, keyed `${taskId}#${attempt}` — the replay guard. */
  readonly calls: Readonly<Record<string, ModelCallRecord>>;
  readonly approvals: readonly PendingApproval[];
}

export const EMPTY_STATE: Readonly<OrchestratorState> = Object.freeze({
  tasks: Object.freeze({}),
  budget: EMPTY_BUDGET,
  rate: Object.freeze([]),
  breaker: CLOSED_BREAKER,
  calls: Object.freeze({}),
  approvals: Object.freeze([]),
});

/** Submit a task. A thin pass-through to `task.ts` so callers need one entry point, not two. */
export function submit(
  state: OrchestratorState,
  input: SubmitInput,
  now: Date,
  config: OrchestratorConfig = DEFAULT_CONFIG,
): { state: OrchestratorState; result: SubmitResult } {
  const result = submitTask(state.tasks, input, now, config.limits);
  return { state: Object.freeze({ ...state, tasks: result.ledger }), result };
}

/**
 * Record that the owner must decide something.
 *
 * This is the ONLY thing the orchestrator does with a privileged action. It never executes one, and it has no
 * code path that could: there is no shell, no git, no deploy and no payment anywhere in this directory.
 */
export function requestApproval(
  state: OrchestratorState,
  action: string,
  taskId: string,
  now: Date,
): { state: OrchestratorState; pending: PendingApproval | null } {
  const pending = raiseApproval(action, taskId, now);
  if (pending === null) return { state, pending: null };
  const already = state.approvals.some((a) => a.action === pending.action && a.taskId === pending.taskId);
  if (already) return { state, pending };
  return { state: Object.freeze({ ...state, approvals: Object.freeze([...state.approvals, pending]) }), pending };
}

/**
 * The reason a task carries after a failed attempt.
 *
 * BOTH FACTS MATTER. `recordAttempt` writes `ATTEMPTS_EXHAUSTED` when the attempts run out; the call site
 * then knows why THIS attempt failed. An earlier form of this function did not exist and the call site
 * overwrote the reason with the provider's error — so a terminal task stopped saying it was terminal, and a
 * reader of the attention list saw a transport error where they should have seen "this will not be retried".
 * The remedy is not to choose between them: it is to state both.
 */
function failureReasonFor(exhausted: boolean, attempts: number, failure: string): string {
  return exhausted ? `ATTEMPTS_EXHAUSTED after ${attempts}; last failure: ${failure}` : failure;
}

export type RunOutcome =
  | { kind: "succeeded"; call: ModelCallRecord }
  | { kind: "failed"; call: ModelCallRecord }
  | { kind: "refused"; guard: "task" | "approval" | "breaker" | "rate" | "budget" | "replay"; reason: string };

export interface RunResult {
  state: OrchestratorState;
  outcome: RunOutcome;
}

/**
 * Run one attempt of one task.
 *
 * The guards are consulted in order of what they protect: the breaker first (a provider we already know is
 * failing), then the rate limit (how fast we may ask), then the budget (whether we can afford to). Each one
 * returns before the port is touched.
 */
export async function runTask(
  state: OrchestratorState,
  taskId: string,
  port: ModelPort,
  now: Date,
  config: OrchestratorConfig = DEFAULT_CONFIG,
): Promise<RunResult> {
  const task = Object.prototype.hasOwnProperty.call(state.tasks, taskId) ? state.tasks[taskId] : undefined;
  if (task === undefined) return { state, outcome: { kind: "refused", guard: "task", reason: "UNKNOWN_TASK" } };
  if (task.state !== "queued") {
    return { state, outcome: { kind: "refused", guard: "task", reason: `TASK_NOT_RUNNABLE: state is ${task.state}` } };
  }

  const attempt = task.attempts + 1;
  const callKey = `${taskId}#${attempt}`;
  if (Object.prototype.hasOwnProperty.call(state.calls, callKey)) {
    // REPLAY. A call already exists for this (task, attempt). Re-running it would pay twice for one attempt
    // and overwrite a record of what actually happened.
    return { state, outcome: { kind: "refused", guard: "replay", reason: `REPLAY_REFUSED: ${callKey} is already recorded` } };
  }

  // The gate is consulted for the action about to be taken, rather than assumed because we know what it is.
  const verdict = classifyAction("invoke_model");
  if (verdict.verdict !== "self_authorised") {
    const raised = requestApproval(state, "invoke_model", taskId, now);
    return { state: raised.state, outcome: { kind: "refused", guard: "approval", reason: verdict.reason } };
  }

  const breaker = admitThroughBreaker(state.breaker, now, config.breaker);
  if (!breaker.ok) {
    return {
      state: Object.freeze({ ...state, tasks: transition(state.tasks, taskId, "queued", breaker.reason) }),
      outcome: { kind: "refused", guard: "breaker", reason: breaker.reason },
    };
  }

  const rate = admitCall(state.rate, now, config.rate);
  if (!rate.ok) {
    return {
      state: Object.freeze({ ...state, breaker: breaker.state, tasks: transition(state.tasks, taskId, "queued", rate.reason) }),
      outcome: { kind: "refused", guard: "rate", reason: rate.reason },
    };
  }

  const request: ModelRequest = {
    model: config.model,
    prompt: task.spec.prompt,
    maxOutputTokens: config.maxOutputTokens,
  };
  const estimate = estimateCents(request, config.pricing);
  const reservation = reserveBudget(state.budget, estimate, config.budget);
  if (!reservation.ok) {
    return {
      state: Object.freeze({
        ...state,
        breaker: breaker.state,
        rate: rate.ledger,
        tasks: transition(state.tasks, taskId, "queued", reservation.reason),
      }),
      outcome: { kind: "refused", guard: "budget", reason: reservation.reason },
    };
  }

  const startedAt = now.toISOString();
  let response: Awaited<ReturnType<ModelPort["invoke"]>>;
  try {
    response = await port.invoke(request);
  } catch (err) {
    // A port that throws is a port failure, not a crash of the orchestrator.
    response = { ok: false, error: `PORT_THREW: ${err instanceof Error ? err.message : String(err)}`, retryable: true };
  }

  const base = {
    schema: MODEL_RECORD_SCHEMA,
    taskId,
    attempt,
    implementation: port.implementation,
    provider: port.provider,
    model: config.model,
    channel: "openai-api",
    startedAt,
  } as const;

  if (!response.ok) {
    const call: ModelCallRecord = Object.freeze({
      ...base,
      outcome: "failed",
      finding: null,
      // The call did not produce usage, so its cost is unestablished rather than zero.
      costCents: null,
      costUnestablishedReason: "the call failed and the provider reported no usage",
      failureReason: response.error,
      providerRequestId: null,
    });
    const budget = settleBudget(reservation.ledger, reservation.reservedCents, null);
    const attempted = recordAttempt(state.tasks, taskId, config.limits);
    const exhausted = attempted[taskId]?.state === "failed";
    return {
      state: Object.freeze({
        ...state,
        budget,
        rate: rate.ledger,
        breaker: recordFailure(breaker.state, now, config.breaker),
        tasks: transition(
          attempted,
          taskId,
          exhausted ? "failed" : "queued",
          failureReasonFor(exhausted, attempt, response.error),
        ),
        calls: Object.freeze({ ...state.calls, [callKey]: call }),
      }),
      outcome: { kind: "failed", call },
    };
  }

  const cost = priceUsage(response.usage, config.pricing);
  const budget = settleBudget(reservation.ledger, reservation.reservedCents, cost);
  const reading = readModelOutput(response.text);

  if (!reading.ok) {
    // A provider that answers in the wrong shape has failed. No partial result is stored as if complete.
    const call: ModelCallRecord = Object.freeze({
      ...base,
      outcome: "failed",
      finding: null,
      costCents: cost,
      costUnestablishedReason: cost === null ? "the provider reported no usage; cost is NOT COMPUTED, not zero" : null,
      failureReason: reading.reason,
      providerRequestId: response.providerRequestId,
    });
    const attempted = recordAttempt(state.tasks, taskId, config.limits);
    const exhausted = attempted[taskId]?.state === "failed";
    return {
      state: Object.freeze({
        ...state,
        budget,
        rate: rate.ledger,
        breaker: recordFailure(breaker.state, now, config.breaker),
        tasks: transition(
          attempted,
          taskId,
          exhausted ? "failed" : "queued",
          failureReasonFor(exhausted, attempt, reading.reason),
        ),
        calls: Object.freeze({ ...state.calls, [callKey]: call }),
      }),
      outcome: { kind: "failed", call },
    };
  }

  // SUCCESS. The finding is stored and the task is marked succeeded. Nothing below reads the finding's
  // CONTENT — see the header: there is no branch on model text anywhere in this module.
  const call: ModelCallRecord = Object.freeze({
    ...base,
    outcome: "succeeded",
    finding: reading.finding,
    costCents: cost,
    costUnestablishedReason: cost === null ? "the provider reported no usage; cost is NOT COMPUTED, not zero" : null,
    failureReason: null,
    providerRequestId: response.providerRequestId,
  });
  return {
    state: Object.freeze({
      ...state,
      budget,
      rate: rate.ledger,
      breaker: recordSuccess(breaker.state),
      tasks: transition(recordAttempt(state.tasks, taskId, config.limits), taskId, "succeeded", null),
      calls: Object.freeze({ ...state.calls, [callKey]: call }),
    }),
    outcome: { kind: "succeeded", call },
  };
}

/** The spend picture, labelled as operating cost and never as a revenue figure. */
export function spend(state: OrchestratorState, config: OrchestratorConfig = DEFAULT_CONFIG): BudgetReport {
  return budgetReport(state.budget, config.budget);
}
