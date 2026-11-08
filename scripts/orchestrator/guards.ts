// The four guards that stand between a task and a paid, outward-facing action.
//
// WHAT THIS IS. Budget, rate limit, circuit breaker and the owner-approval gate, as pure decisions. Each one
// answers "may this proceed?" BEFORE anything is invoked, because a guard that reports after the fact is an
// audit trail, not a guard.
//
// WHY THE BUDGET IS A RESERVATION. A tally that adds up spend after each call cannot refuse the call that
// breaks the cap — it can only notice. So `reserveBudget` takes the ESTIMATED cost, refuses when the estimate
// would exceed the remaining cap, and the engine invokes nothing on a refusal. The estimate is deliberately
// allowed to be wrong in only one direction: a settled cost higher than its estimate is recorded in full and
// may drive the remaining budget negative, which is visible, whereas trusting a low estimate silently would
// not be.
//
// WHY AN UNKNOWN ACTION IS PRIVILEGED. `classifyAction` has no permissive default. An action class that
// appears in neither list is refused and recorded as requiring owner approval. The alternative — treating
// the unlisted as benign — means every action someone forgets to classify becomes one nobody approved.
//
// OPERATING COST, NOT A REVENUE FIGURE. Every money value here is USD spend on API calls. It is labelled
// OPERATING_COST and it is never a figure in either revenue ledger. See the project constitution: Revenue
// Opportunity and Revenue Returned are never blended, and API spend is in neither.
//
// PURE. No clock, no filesystem, no network. Every time value arrives as an argument.

export const COST_LABEL = "OPERATING_COST" as const;

/* ------------------------------------------------------------------ budget */

export interface BudgetPolicy {
  /** The hard ceiling on API spend, in USD cents, for the window this ledger covers. */
  capCents: number;
}

export interface BudgetLedger {
  /** Spend that has SETTLED — a provider reported usage and it was priced. */
  readonly settledCents: number;
  /** Spend currently reserved for in-flight calls. */
  readonly reservedCents: number;
  /**
   * Calls whose cost could not be established, because the provider reported no usage.
   *
   * NOT COMPUTED IS NOT ZERO. Coalescing an unreported usage to 0 would assert the call was free. The count
   * is carried instead, so the aggregate can say a component is unestablished rather than sum a fiction.
   */
  readonly unestablishedCalls: number;
}

export const EMPTY_BUDGET: Readonly<BudgetLedger> = Object.freeze({
  settledCents: 0,
  reservedCents: 0,
  unestablishedCalls: 0,
});

export type BudgetDecision =
  | { ok: true; ledger: BudgetLedger; reservedCents: number }
  | { ok: false; reason: string };

export function remainingCents(ledger: BudgetLedger, policy: BudgetPolicy): number {
  return policy.capCents - ledger.settledCents - ledger.reservedCents;
}

/** Take the estimated cost out of the budget BEFORE the call. Refuses rather than allowing an overrun. */
export function reserveBudget(ledger: BudgetLedger, estimateCents: number, policy: BudgetPolicy): BudgetDecision {
  if (!Number.isFinite(estimateCents) || estimateCents < 0) return { ok: false, reason: "BUDGET_ESTIMATE_INVALID" };
  const remaining = remainingCents(ledger, policy);
  if (estimateCents > remaining) {
    return { ok: false, reason: `BUDGET_EXHAUSTED: estimate ${estimateCents}c exceeds remaining ${remaining}c of cap ${policy.capCents}c` };
  }
  return {
    ok: true,
    ledger: Object.freeze({ ...ledger, reservedCents: ledger.reservedCents + estimateCents }),
    reservedCents: estimateCents,
  };
}

/**
 * Release a reservation and record what the call actually cost.
 *
 * `actualCents: null` means the provider reported no usage, so the cost is NOT ESTABLISHED. The reservation
 * is still released — the call is over — and the unestablished count rises, so the aggregate reports an
 * unestablished component instead of a zero that would read as "this call was free".
 */
export function settleBudget(ledger: BudgetLedger, reservedCents: number, actualCents: number | null): BudgetLedger {
  const released = Math.max(0, ledger.reservedCents - reservedCents);
  if (actualCents === null) {
    return Object.freeze({ ...ledger, reservedCents: released, unestablishedCalls: ledger.unestablishedCalls + 1 });
  }
  return Object.freeze({ ...ledger, reservedCents: released, settledCents: ledger.settledCents + actualCents });
}

export interface BudgetReport {
  label: typeof COST_LABEL;
  capCents: number;
  settledCents: number;
  reservedCents: number;
  remainingCents: number;
  /** Null when at least one call's cost could not be established — never a sum that hides it. */
  totalSpendCents: number | null;
  totalSpendUnestablishedReason: string | null;
}

export function budgetReport(ledger: BudgetLedger, policy: BudgetPolicy): BudgetReport {
  const unestablished = ledger.unestablishedCalls > 0;
  return {
    label: COST_LABEL,
    capCents: policy.capCents,
    settledCents: ledger.settledCents,
    reservedCents: ledger.reservedCents,
    remainingCents: remainingCents(ledger, policy),
    totalSpendCents: unestablished ? null : ledger.settledCents,
    totalSpendUnestablishedReason: unestablished
      ? `${ledger.unestablishedCalls} call(s) reported no usage; total spend is NOT COMPUTED, not zero`
      : null,
  };
}

/* -------------------------------------------------------------- rate limit */

export interface RatePolicy {
  /** Calls allowed inside the window. */
  maxCalls: number;
  windowSeconds: number;
}

/** ISO times of recent calls, newest last. */
export type RateLedger = readonly string[];

export type RateDecision = { ok: true; ledger: RateLedger } | { ok: false; reason: string };

/** Refuse, never queue. An unbounded queue turns a rate limit into a delay and the spend still happens. */
export function admitCall(ledger: RateLedger, now: Date, policy: RatePolicy): RateDecision {
  const cutoff = now.getTime() - policy.windowSeconds * 1000;
  const live = ledger.filter((t) => Date.parse(t) > cutoff);
  if (live.length >= policy.maxCalls) {
    return { ok: false, reason: `RATE_LIMITED: ${live.length} call(s) in the last ${policy.windowSeconds}s, limit ${policy.maxCalls}` };
  }
  return { ok: true, ledger: Object.freeze([...live, now.toISOString()]) };
}

/* ---------------------------------------------------------- circuit breaker */

export interface BreakerPolicy {
  /** Consecutive failures that open the breaker. */
  failureThreshold: number;
  cooldownSeconds: number;
}

export interface BreakerState {
  readonly consecutiveFailures: number;
  readonly openedAt: string | null;
  /** True while the single half-open probe is outstanding, so a second probe cannot slip through. */
  readonly probeInFlight: boolean;
}

export const CLOSED_BREAKER: Readonly<BreakerState> = Object.freeze({
  consecutiveFailures: 0,
  openedAt: null,
  probeInFlight: false,
});

export type BreakerPhase = "closed" | "open" | "half_open";

export function breakerPhase(state: BreakerState, now: Date, policy: BreakerPolicy): BreakerPhase {
  if (state.openedAt === null) return "closed";
  const elapsed = (now.getTime() - Date.parse(state.openedAt)) / 1000;
  return elapsed >= policy.cooldownSeconds ? "half_open" : "open";
}

export type BreakerDecision = { ok: true; state: BreakerState } | { ok: false; reason: string };

/** May a call go out? Half-open admits EXACTLY ONE probe; the second is refused while the first is in flight. */
export function admitThroughBreaker(state: BreakerState, now: Date, policy: BreakerPolicy): BreakerDecision {
  const phase = breakerPhase(state, now, policy);
  if (phase === "open") return { ok: false, reason: `BREAKER_OPEN: cooling down for ${policy.cooldownSeconds}s since ${state.openedAt}` };
  if (phase === "half_open") {
    if (state.probeInFlight) return { ok: false, reason: "BREAKER_HALF_OPEN: a probe is already in flight" };
    return { ok: true, state: Object.freeze({ ...state, probeInFlight: true }) };
  }
  return { ok: true, state };
}

export function recordSuccess(_state: BreakerState): BreakerState {
  return CLOSED_BREAKER;
}

export function recordFailure(state: BreakerState, now: Date, policy: BreakerPolicy): BreakerState {
  const failures = state.consecutiveFailures + 1;
  const open = failures >= policy.failureThreshold;
  return Object.freeze({
    consecutiveFailures: failures,
    openedAt: open ? now.toISOString() : state.openedAt,
    probeInFlight: false,
  });
}

/* ------------------------------------------------------- the approval gate */

/**
 * Actions ONLY THE OWNER may authorise, from the project's standing rule. Nothing in this orchestrator
 * executes any of them; they become records that say an owner decision is outstanding.
 */
export const OWNER_APPROVAL_REQUIRED = Object.freeze([
  "git_push",
  "git_merge",
  "deploy",
  "permission_change",
  "credential_change",
  "financial_action",
  "real_customer_data",
] as const);

/** Actions the orchestrator may take on its own: reading, validating, reporting, and calling the model. */
export const SELF_AUTHORISED = Object.freeze([
  "read_repository",
  "run_local_tests",
  "invoke_model",
  "post_status_comment",
] as const);

export type ActionClass = (typeof OWNER_APPROVAL_REQUIRED)[number] | (typeof SELF_AUTHORISED)[number];

export type ActionVerdict =
  | { verdict: "self_authorised"; action: string }
  | { verdict: "owner_approval_required"; action: string; reason: string };

/**
 * Classify an action.
 *
 * NO PERMISSIVE DEFAULT. An action in neither list is `owner_approval_required`, with the reason saying it
 * was unclassified. The flattering alternative — unknown means harmless — makes every forgotten action one
 * nobody approved, which is the opposite of a gate.
 */
export function classifyAction(action: string): ActionVerdict {
  if ((SELF_AUTHORISED as readonly string[]).includes(action)) return { verdict: "self_authorised", action };
  if ((OWNER_APPROVAL_REQUIRED as readonly string[]).includes(action)) {
    return { verdict: "owner_approval_required", action, reason: `${action} is reserved to the owner` };
  }
  return {
    verdict: "owner_approval_required",
    action,
    reason: `UNCLASSIFIED_ACTION '${action}' is treated as privileged; an unlisted action is never assumed benign`,
  };
}

export interface PendingApproval {
  action: string;
  taskId: string;
  reason: string;
  raisedAt: string;
}

/** The only thing the orchestrator does with a privileged action: write down that the owner must decide. */
export function raiseApproval(action: string, taskId: string, now: Date): PendingApproval | null {
  const v = classifyAction(action);
  if (v.verdict === "self_authorised") return null;
  return { action, taskId, reason: v.reason, raisedAt: now.toISOString() };
}
