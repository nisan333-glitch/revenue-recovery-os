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
  run(
    payload: Readonly<Record<string, unknown>>,
    context: { readonly taskId: string; readonly boundaryId: string; readonly attempt: number },
  ): Promise<readonly CandidateSignal[]>;
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
