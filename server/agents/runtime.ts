import type {
  AgentAuditSink,
  AgentHandler,
  AgentPolicyProvider,
  AgentTask,
  AgentTaskStore,
} from "./types";
import { assertCandidateSignal } from "./admission";

export interface AgentRuntimeDependencies {
  readonly store: AgentTaskStore;
  readonly policy: AgentPolicyProvider;
  readonly audit: AgentAuditSink;
  readonly now: () => number;
}

export class AgentRuntime {
  constructor(private readonly deps: AgentRuntimeDependencies) {}

  async runNext(handler: AgentHandler, workerId: string): Promise<AgentTask | null> {
    const beforeClaim = this.deps.policy.current();
    const now = this.deps.now();
    const stopReason = this.stopReason(handler.agentId, beforeClaim);
    if (stopReason) {
      await this.deps.audit.append({ kind: "agent.skipped", agentId: handler.agentId, reason: stopReason, at: now });
      return null;
    }

    const task = await this.deps.store.claimDue({
      agentId: handler.agentId,
      workerId,
      now,
      leaseMs: beforeClaim.leaseMs,
    });
    if (!task) return null;
    if (!task.leaseToken) throw new Error("store returned a claimed task without a lease token");
    await this.deps.audit.append({
      kind: "task.claimed",
      agentId: handler.agentId,
      taskId: task.taskId,
      attempt: task.attempt,
      at: now,
    });

    try {
      const signals = await handler.run(task.payload, {
        taskId: task.taskId,
        boundaryId: task.boundaryId,
        attempt: task.attempt,
      });
      if (!Array.isArray(signals)) throw new Error("agent output must be an array of CandidateSignals");
      for (const signal of signals) {
        assertCandidateSignal(signal);
        if (signal.boundaryId !== task.boundaryId) {
          throw new Error("CandidateSignal boundary does not match the claimed task boundary");
        }
      }
      const afterRun = this.deps.policy.current();
      const stoppedAfterRun = this.stopReason(handler.agentId, afterRun);
      if (stoppedAfterRun) {
        const released = await this.deps.store.release({
          taskId: task.taskId,
          leaseToken: task.leaseToken,
          reason: stoppedAfterRun,
          notBefore: this.deps.now() + afterRun.retryDelayMs(task.attempt),
        });
        await this.deps.audit.append({
          kind: "task.released",
          agentId: handler.agentId,
          taskId: task.taskId,
          reason: stoppedAfterRun,
          at: this.deps.now(),
        });
        return released;
      }
      const completed = await this.deps.store.succeed({
        taskId: task.taskId,
        leaseToken: task.leaseToken,
        result: signals,
      });
      await this.deps.audit.append({
        kind: "task.succeeded",
        agentId: handler.agentId,
        taskId: task.taskId,
        signalCount: signals.length,
        at: this.deps.now(),
      });
      return completed;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown agent failure";
      const current = this.deps.policy.current();
      const failed = await this.deps.store.fail({
        taskId: task.taskId,
        leaseToken: task.leaseToken,
        error: message,
        now: this.deps.now(),
        maxAttempts: current.maxAttempts,
        retryDelayMs: current.retryDelayMs(task.attempt),
      });
      await this.deps.audit.append({
        kind: "task.failed",
        agentId: handler.agentId,
        taskId: task.taskId,
        terminal: failed.status === "dead_lettered",
        at: this.deps.now(),
      });
      return failed;
    }
  }

  private stopReason(agentId: string, policy: ReturnType<AgentPolicyProvider["current"]>): string | null {
    if (!policy.globalEnabled) return "global agent kill switch is engaged";
    if (policy.disabledAgents.has(agentId)) return `agent '${agentId}' is disabled`;
    return null;
  }
}
