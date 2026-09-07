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
  readonly notBefore: number;
  readonly leaseOwner: string | null;
  readonly leaseToken: string | null;
  readonly leaseExpiresAt: number | null;
  readonly result: readonly CandidateSignal[] | null;
  readonly lastError: string | null;
}

export interface AgentHandler {
  readonly agentId: string;
  run(
    payload: Readonly<Record<string, unknown>>,
    context: { readonly taskId: string; readonly boundaryId: string; readonly attempt: number },
  ): Promise<readonly CandidateSignal[]>;
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
    readonly agentId: string;
    readonly workerId: string;
    readonly now: number;
    readonly leaseMs: number;
  }): Promise<AgentTask | null>;

  succeed(input: {
    readonly taskId: string;
    readonly leaseToken: string;
    readonly result: readonly CandidateSignal[];
  }): Promise<AgentTask>;

  fail(input: {
    readonly taskId: string;
    readonly leaseToken: string;
    readonly error: string;
    readonly now: number;
    readonly maxAttempts: number;
    readonly retryDelayMs: number;
  }): Promise<AgentTask>;

  release(input: {
    readonly taskId: string;
    readonly leaseToken: string;
    readonly reason: string;
    readonly notBefore: number;
  }): Promise<AgentTask>;
}

export type AgentAuditEvent =
  | { readonly kind: "agent.skipped"; readonly agentId: string; readonly reason: string; readonly at: number }
  | { readonly kind: "task.claimed"; readonly agentId: string; readonly taskId: string; readonly attempt: number; readonly at: number }
  | { readonly kind: "task.succeeded"; readonly agentId: string; readonly taskId: string; readonly signalCount: number; readonly at: number }
  | { readonly kind: "task.failed"; readonly agentId: string; readonly taskId: string; readonly terminal: boolean; readonly at: number }
  | { readonly kind: "task.released"; readonly agentId: string; readonly taskId: string; readonly reason: string; readonly at: number };

export interface AgentAuditSink {
  append(event: AgentAuditEvent): Promise<void>;
}
