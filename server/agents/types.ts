import type { ObligationCoverage } from "../../src/domain/provenEligibility";
// Agent Runtime Foundation v0.1.
// Agents may observe and emit CandidateSignals only. They cannot create proofs,
// move money, assign owners, or call governed services through this contract.

export type AgentTaskStatus =
  | "queued"
  | "leased"
  | "retry_wait"
  | "succeeded"
  | "dead_lettered";

export interface CandidateSignal {
  readonly signalId: string;
  readonly boundaryId: string;
  readonly recoveryType: string;
  readonly sourceRef: string;
  readonly sourcePayloadHash: string;
  readonly detectorVersion: string;
  readonly observedAt: string;
  readonly amountAtRiskMinor: number;
  readonly currency: string;
  readonly actionAvailable: boolean;
  readonly expectedProofEvent: string;
  /**
   * WHAT THIS CLAIM COVERS — one reconciliation unit, or an account-level aggregate of several.
   *
   * OPTIONAL, AND ITS ABSENCE IS A REFUSAL RATHER THAN A DEFAULT. A detector that does not know what its
   * signal covers must not be forced to claim; `provenEligibility` reads an absent coverage as
   * OBLIGATION_COVERAGE_NOT_STATED and refuses PROVEN. Making it required would also rewrite the shape
   * every historical candidate row was written under, for a fact those rows cannot supply.
   *
   * STATED BY THE SERVER, NEVER BY A REQUEST. It is derived from the reconciliation the server itself
   * performed; no HTTP body reaches this field, and `assertCandidateSignal` rejects any key it does not
   * declare, so an injected one is a hard error rather than a silent strip.
   *
   * IT IS NOT A CROSS-SYSTEM OBLIGATION IDENTITY. `OBLIGATION_IDENTITY_FIELDS` is still empty and this
   * does not change it: the reference below identifies one unit WITHIN ONE READING of the customer's two
   * extracts, which is what a claim needs to name its own subject, and is not a stable identifier that
   * survives a re-key or a migration.
   */
  readonly obligationCoverage?: ObligationCoverage;
}

export interface AgentTask {
  readonly taskId: string;
  readonly boundaryId: string;
  readonly agentId: string;
  readonly idempotencyKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: AgentTaskStatus;
  readonly attempt: number;
  readonly fencingEpoch: number;
  readonly notBefore: number;
  readonly leaseOwner: string | null;
  readonly leaseToken: string | null;
  readonly leaseExpiresAt: number | null;
  readonly result: readonly CandidateSignal[] | null;
  readonly lastError: string | null;
}

export interface AgentHandler {
  readonly agentId: string;
  /**
   * Whether this handler may publish CandidateSignals — the only automatic route from detection into
   * Case creation.
   *
   * ABSENT MEANS TRUE, deliberately. A handler that forgets to declare itself is treated as
   * candidate-capable, so the candidate admission policy registry is still required for it and
   * nothing is published without a configured economic threshold. The fail-closed direction is the
   * one where a new detector cannot accidentally escape the registry requirement by omission.
   *
   * Declaring `false` is a CHECKED CONTRACT, not a promise: `AgentRuntime` fails any handler that
   * declares it and then returns a signal anyway, before publication can occur. That makes this
   * field strictly stronger than the situation without it, where nothing stopped a nominally
   * observation-only agent from publishing.
   */
  readonly publishesCandidates?: boolean;
  /**
   * THE RETURN IS A UNION, AND THAT IS THE WHOLE COMPATIBILITY STORY. A handler that returns a bare
   * array is unchanged and untouched — every existing one does — and a handler with something to record
   * about the run itself returns `{ signals, observation }` instead. The runtime normalises, so neither
   * form is privileged and no handler had to be edited for this to exist.
   */
  run(
    payload: Readonly<Record<string, unknown>>,
    context: { readonly taskId: string; readonly boundaryId: string; readonly attempt: number },
  ): Promise<readonly CandidateSignal[] | AgentRunResult>;
}

/**
 * WHAT A HANDLER MAY RECORD ABOUT ITS OWN RUN, beyond the signals it published.
 *
 * WHY THIS EXISTS. `reconciliationObserver` computed a refused-exposure figure and `run` could return
 * only signals, so the figure was discarded at the handler boundary and reached no record, no API and no
 * screen: a governed number that existed and could not be read. A refused unit deliberately produces NO
 * candidate — crediting a malformed reference is exactly what the refusal prevents — so the signal array
 * is structurally the wrong channel for it, and the gap could not be closed by a read-side derivation
 * because the fact never reached the database at all.
 *
 * IT IS NOT A FREE-FORM BAG. The shape is closed and validated: unknown keys are a contract violation
 * rather than data, for the same reason `obligationCoverage` rejects forbidden fields. A detector's
 * output is less dangerous than a request's — the beneficiary does not author it — but an unvalidated
 * channel into persisted metadata is still a channel, and this one is read by a financial report.
 *
 * IT CANNOT EXPRESS MONEY THE BUSINESS GOT BACK. There is no collected, recovered or returned field and
 * there will not be one: what it carries is what a detector REFUSED to claim.
 */
export interface AgentRunResult {
  readonly signals: readonly CandidateSignal[];
  readonly observation?: AgentObservation;
}

export const AGENT_OBSERVATION_SCHEME = "nh-agent-observation-v1";

export interface AgentObservation {
  readonly scheme: typeof AGENT_OBSERVATION_SCHEME;
  /**
   * Exposure the handler refused to report, and the facts behind the refusal.
   *
   * The three states stay distinguishable and none of them is a zero: `NOT_EXAMINED` means nobody
   * looked, `NONE_REFUSED` means the units were examined and none was refused — that zero IS correct —
   * and `UNDETERMINED` means units were refused and what they withhold cannot be stated.
   *
   * `refusedExpectedMinor` is what the CONTRACT side stated on refused units, which is not in doubt. The
   * residual is absent BY DESIGN: the residual is exactly what the refusal is about, and publishing one
   * would be the authored figure the refusal exists to prevent.
   *
   * NO PROSE. A headline sentence is deliberately not carried: a stored sentence drifts from the code
   * that renders it, so the reader renders its own from these facts.
   */
  readonly refusedExposure?: {
    readonly state: "NOT_EXAMINED" | "NONE_REFUSED" | "UNDETERMINED";
    readonly refusedUnits: number;
    readonly refusedExpectedMinor: number;
    readonly refusedWithoutExpected: number;
    readonly currency: string;
  };
}

const OBSERVATION_KEYS: readonly string[] = Object.freeze(["scheme", "refusedExposure"]);
const REFUSED_KEYS: readonly string[] = Object.freeze([
  "state", "refusedUnits", "refusedExpectedMinor", "refusedWithoutExpected", "currency",
]);
const REFUSED_STATES: readonly string[] = Object.freeze(["NOT_EXAMINED", "NONE_REFUSED", "UNDETERMINED"]);

/**
 * Validate an observation, or throw. CLOSED SHAPE: an unknown key fails rather than being persisted.
 *
 * The runtime calls this BEFORE `succeed()`, so a malformed observation fails the task and nothing is
 * written — the same placement as the observation-only contract check, and for the same reason: a
 * violation must not reach the only call that invokes the publication sink.
 */
export function assertAgentObservation(value: unknown): asserts value is AgentObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("agent observation must be an object");
  }
  const o = value as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !OBSERVATION_KEYS.includes(k));
  if (extra.length > 0) {
    throw new Error(`agent observation contains forbidden fields: ${extra.sort().join(", ")}`);
  }
  if (o.scheme !== AGENT_OBSERVATION_SCHEME) {
    throw new Error(`agent observation scheme must be ${AGENT_OBSERVATION_SCHEME}`);
  }
  if (o.refusedExposure === undefined) return;
  const r = o.refusedExposure;
  if (!r || typeof r !== "object" || Array.isArray(r)) {
    throw new Error("agent observation refusedExposure must be an object when present");
  }
  const rec = r as Record<string, unknown>;
  const extraRefused = Object.keys(rec).filter((k) => !REFUSED_KEYS.includes(k));
  if (extraRefused.length > 0) {
    throw new Error(`agent observation refusedExposure contains forbidden fields: ${extraRefused.sort().join(", ")}`);
  }
  const missing = REFUSED_KEYS.filter((k) => !(k in rec));
  if (missing.length > 0) {
    throw new Error(`agent observation refusedExposure is missing: ${missing.sort().join(", ")}`);
  }
  if (typeof rec.state !== "string" || !REFUSED_STATES.includes(rec.state)) {
    throw new Error(`agent observation refusedExposure.state must be one of ${REFUSED_STATES.join(", ")}`);
  }
  for (const field of ["refusedUnits", "refusedExpectedMinor", "refusedWithoutExpected"] as const) {
    if (!Number.isSafeInteger(rec[field]) || (rec[field] as number) < 0) {
      throw new Error(`agent observation refusedExposure.${field} must be a non-negative safe integer`);
    }
  }
  if (typeof rec.currency !== "string" || !/^[A-Z]{3}$/.test(rec.currency)) {
    throw new Error("agent observation refusedExposure.currency must be an ISO code");
  }
  // THE ONE CROSS-FIELD RULE, because the states must not contradict their own counts: a refusal state
  // with no refused units, or no refusal with units, would make the three states indistinguishable in
  // practice however carefully they are named.
  const units = rec.refusedUnits as number;
  if (rec.state === "UNDETERMINED" && units === 0) {
    throw new Error("agent observation refusedExposure.state UNDETERMINED requires at least one refused unit");
  }
  if (rec.state !== "UNDETERMINED" && units > 0) {
    throw new Error(`agent observation refusedExposure.state ${rec.state} cannot carry refused units`);
  }
}

/**
 * Normalise either return form into one shape. The single place the union is collapsed, so no caller
 * has to know which form a handler used.
 */
export function agentRunOutcome(
  raw: readonly CandidateSignal[] | AgentRunResult,
): { readonly signals: readonly CandidateSignal[]; readonly observation?: AgentObservation } {
  if (Array.isArray(raw)) return { signals: raw };
  const result = raw as AgentRunResult;
  if (!result || typeof result !== "object" || !Array.isArray(result.signals)) {
    throw new Error("agent run result must be a CandidateSignal array or { signals, observation? }");
  }
  if (result.observation === undefined) return { signals: result.signals };
  assertAgentObservation(result.observation);
  return { signals: result.signals, observation: result.observation };
}

/** Absent declaration ⇒ candidate-capable. The single place that default is decided. */
export function publishesCandidates(handler: AgentHandler): boolean {
  return handler.publishesCandidates !== false;
}

export interface AgentPolicySnapshot {
  readonly globalEnabled: boolean;
  readonly disabledAgents: ReadonlySet<string>;
  readonly maxAttempts: number;
  readonly leaseMs: number;
  retryDelayMs(attempt: number): number;
}

export interface AgentPolicyProvider {
  current(): AgentPolicySnapshot;
}

export interface AgentTaskStore {
  enqueueIfAbsent(input: {
    readonly taskId: string;
    readonly boundaryId: string;
    readonly agentId: string;
    readonly idempotencyKey: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly now: number;
  }): Promise<{ readonly task: AgentTask; readonly created: boolean }>;

  claimDue(input: {
    readonly boundaryId: string;
    readonly agentId: string;
    readonly workerId: string;
    readonly now: number;
    readonly leaseMs: number;
    readonly maxAttempts: number;
  }): Promise<AgentTask | null>;

  succeed(input: {
    readonly taskId: string;
    readonly boundaryId: string;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly now: number;
    readonly result: readonly CandidateSignal[];
    /**
     * OPTIONAL, and absence is not emptiness. A store records it where it has somewhere to put it;
     * `undefined` means the handler recorded nothing, which a reader must not read as "nothing was
     * refused".
     */
    readonly observation?: AgentObservation;
  }): Promise<AgentTask>;

  fail(input: {
    readonly taskId: string;
    readonly boundaryId: string;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly error: string;
    readonly now: number;
    readonly maxAttempts: number;
    readonly retryDelayMs: number;
  }): Promise<AgentTask>;

  release(input: {
    readonly taskId: string;
    readonly boundaryId: string;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly reason: string;
    readonly now: number;
    readonly retryDelayMs: number;
  }): Promise<AgentTask>;

  renewLease(input: {
    readonly taskId: string;
    readonly boundaryId: string;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly now: number;
    readonly leaseMs: number;
  }): Promise<AgentTask>;
}

export type AgentAuditEvent =
  | { readonly kind: "agent.skipped"; readonly boundaryId: string; readonly agentId: string; readonly reason: string; readonly at: number }
  | { readonly kind: "task.claimed"; readonly boundaryId: string; readonly agentId: string; readonly taskId: string; readonly workerId: string; readonly attempt: number; readonly fencingEpoch: number; readonly at: number }
  | { readonly kind: "task.succeeded"; readonly boundaryId: string; readonly agentId: string; readonly taskId: string; readonly workerId: string; readonly signalCount: number; readonly fencingEpoch: number; readonly at: number }
  | { readonly kind: "task.failed"; readonly boundaryId: string; readonly agentId: string; readonly taskId: string; readonly workerId: string; readonly terminal: boolean; readonly fencingEpoch: number; readonly at: number }
  | { readonly kind: "task.released"; readonly boundaryId: string; readonly agentId: string; readonly taskId: string; readonly workerId: string; readonly reason: string; readonly fencingEpoch: number; readonly at: number };

export interface AgentAuditSink {
  append(event: AgentAuditEvent): Promise<void>;
}
