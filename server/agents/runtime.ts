import type {
  AgentAuditEvent,
  AgentAuditSink,
  AgentHandler,
  AgentPolicyProvider,
  AgentTask,
  AgentTaskStore,
  CandidateSignal,
} from "./types";
import { publishesCandidates } from "./types";
import { assertCandidateSignalBatch } from "./admission";

export interface AgentRuntimeDependencies {
  readonly store: AgentTaskStore;
  readonly policy: AgentPolicyProvider;
  readonly audit: AgentAuditSink;
  readonly now: () => number;
}

export class AgentRuntime {
  constructor(private readonly deps: AgentRuntimeDependencies) {}

  async runNext(handler: AgentHandler, workerId: string, boundaryId: string): Promise<AgentTask | null> {
    const beforeClaim = this.deps.policy.current();
    const now = this.deps.now();
    const stopReason = this.stopReason(handler.agentId, beforeClaim);
    if (stopReason) {
      this.emit({ kind: "agent.skipped", boundaryId, agentId: handler.agentId, reason: stopReason, at: now });
      return null;
    }

    const task = await this.deps.store.claimDue({
      boundaryId,
      agentId: handler.agentId,
      workerId,
      now,
      leaseMs: beforeClaim.leaseMs,
      maxAttempts: beforeClaim.maxAttempts,
    });
    if (!task) return null;
    if (!task.leaseToken) throw new Error("store returned a claimed task without a lease token");
    if (task.boundaryId !== boundaryId) {
      throw new Error("store returned a task outside the worker boundary");
    }
    const heartbeat = this.startLeaseHeartbeat(task, workerId, beforeClaim.leaseMs);
    this.emit({
      kind: "task.claimed",
      boundaryId,
      agentId: handler.agentId,
      taskId: task.taskId,
      workerId,
      attempt: task.attempt,
      fencingEpoch: task.fencingEpoch,
      at: now,
    });

    let rawSignals: readonly CandidateSignal[];
    try {
      rawSignals = await handler.run(task.payload, {
        taskId: task.taskId,
        boundaryId: task.boundaryId,
        attempt: task.attempt,
      });
    } catch (error) {
      await this.stopAndRefreshLease(heartbeat, task, workerId, beforeClaim.leaseMs);
      return this.failClaim(task, handler.agentId, workerId, error);
    }

    let signals: readonly CandidateSignal[];
    try {
      assertCandidateSignalBatch(rawSignals, task.boundaryId);
      // An observation-only handler that returns a signal is a contract violation, and it is caught
      // HERE — before `succeed()`, which is the only thing that invokes the publication sink. So the
      // task fails and nothing is published; the declaration is enforced, not trusted. Checked after
      // the batch assertion so a malformed signal still reports as malformed.
      if (rawSignals.length > 0 && !publishesCandidates(handler)) {
        throw new Error(
          `agent '${handler.agentId}' is declared observation-only and must not emit CandidateSignals`,
        );
      }
      signals = rawSignals;
    } catch (error) {
      await this.stopAndRefreshLease(heartbeat, task, workerId, beforeClaim.leaseMs);
      return this.failClaim(task, handler.agentId, workerId, error);
    }

    await this.stopAndRefreshLease(heartbeat, task, workerId, beforeClaim.leaseMs);

    const afterRun = this.deps.policy.current();
    const stoppedAfterRun = this.stopReason(handler.agentId, afterRun);
    if (stoppedAfterRun) {
      const released = await this.deps.store.release({
        taskId: task.taskId,
        boundaryId,
        workerId,
        leaseToken: task.leaseToken,
        reason: stoppedAfterRun,
        now: this.deps.now(),
        retryDelayMs: afterRun.retryDelayMs(task.attempt),
      });
      this.emit({
        kind: "task.released",
        boundaryId,
        agentId: handler.agentId,
        taskId: task.taskId,
        workerId,
        reason: stoppedAfterRun,
        fencingEpoch: task.fencingEpoch,
        at: this.deps.now(),
      });
      return released;
    }

    // A completion-store error is intentionally NOT converted into `fail`: the write may have
    // committed before the client observed an error. Retrying `fail` with the same token can
    // corrupt or obscure a successful terminal transition. Durable stores fence the token and
    // record the transition atomically; an ambiguous completion must be reconciled by task id.
    const completed = await this.deps.store.succeed({
      taskId: task.taskId,
      boundaryId,
      workerId,
      leaseToken: task.leaseToken,
      now: this.deps.now(),
      result: signals,
    });
    this.emit({
      kind: "task.succeeded",
      boundaryId,
      agentId: handler.agentId,
      taskId: task.taskId,
      workerId,
      signalCount: signals.length,
      fencingEpoch: task.fencingEpoch,
      at: this.deps.now(),
    });
    return completed;
  }

  private async stopAndRefreshLease(
    heartbeat: { stop(): Promise<Error | null> },
    task: AgentTask,
    workerId: string,
    leaseMs: number,
  ): Promise<void> {
    const heartbeatFailure = await heartbeat.stop();
    if (heartbeatFailure) throw heartbeatFailure;
    try {
      await this.deps.store.renewLease({
        taskId: task.taskId,
        boundaryId: task.boundaryId,
        workerId,
        leaseToken: task.leaseToken!,
        now: this.deps.now(),
        leaseMs,
      });
    } catch (error) {
      throw this.leaseFailure(task, error);
    }
  }

  /**
   * Keep long-running observation work exclusively leased. Fencing remains the final safety net:
   * if renewal fails, publication is suppressed and no terminal transition is attempted with an
   * ambiguous lease. A later worker may safely reclaim the task after database expiry.
   */
  private startLeaseHeartbeat(
    task: AgentTask,
    workerId: string,
    leaseMs: number,
  ): { stop(): Promise<Error | null> } {
    const intervalMs = Math.max(1, Math.floor(leaseMs / 3));
    let stopped = false;
    let timer: NodeJS.Timeout | null = null;
    let failure: Error | null = null;
    let inFlight: Promise<void> = Promise.resolve();

    const tick = async (): Promise<void> => {
      try {
        await this.deps.store.renewLease({
          taskId: task.taskId,
          boundaryId: task.boundaryId,
          workerId,
          leaseToken: task.leaseToken!,
          now: this.deps.now(),
          leaseMs,
        });
      } catch (error) {
        failure = this.leaseFailure(task, error);
        stopped = true;
      }
      if (!stopped) schedule();
    };

    const schedule = (): void => {
      timer = setTimeout(() => {
        timer = null;
        inFlight = tick();
      }, intervalMs);
      timer.unref();
    };

    schedule();
    return {
      stop: async () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        await inFlight;
        return failure;
      },
    };
  }

  private leaseFailure(task: AgentTask, cause: unknown): Error {
    const error = new Error(
      `agent task lease heartbeat failed for '${task.taskId}'; completion suppressed`,
    ) as Error & { cause?: unknown };
    error.cause = cause;
    return error;
  }

  private async failClaim(
    task: AgentTask,
    agentId: string,
    workerId: string,
    error: unknown,
  ): Promise<AgentTask> {
    const message = error instanceof Error ? error.message : "unknown agent failure";
    const current = this.deps.policy.current();
    const failed = await this.deps.store.fail({
      taskId: task.taskId,
      boundaryId: task.boundaryId,
      workerId,
      leaseToken: task.leaseToken!,
      error: message,
      now: this.deps.now(),
      maxAttempts: current.maxAttempts,
      retryDelayMs: current.retryDelayMs(task.attempt),
    });
    this.emit({
      kind: "task.failed",
      boundaryId: task.boundaryId,
      agentId,
      taskId: task.taskId,
      workerId,
      terminal: failed.status === "dead_lettered",
      fencingEpoch: task.fencingEpoch,
      at: this.deps.now(),
    });
    return failed;
  }

  /** External telemetry is best-effort; task state and its durable DB event remain authoritative. */
  private emit(event: AgentAuditEvent): void {
    try {
      void this.deps.audit.append(event).catch(() => {
        // Durable task events remain authoritative when external telemetry is unavailable.
      });
    } catch {
      // Never convert a committed task transition into a retry because telemetry failed.
    }
  }

  private stopReason(agentId: string, policy: ReturnType<AgentPolicyProvider["current"]>): string | null {
    if (!policy.globalEnabled) return "global agent kill switch is engaged";
    if (policy.disabledAgents.has(agentId)) return `agent '${agentId}' is disabled`;
    return null;
  }
}
