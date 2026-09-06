import { randomUUID } from "node:crypto";
import type { AgentTask, AgentTaskStore, CandidateSignal } from "./types";

type MutableTask = {
  -readonly [K in keyof AgentTask]: AgentTask[K];
};

function snapshot(task: MutableTask): AgentTask {
  return Object.freeze({ ...task, payload: Object.freeze({ ...task.payload }), result: task.result ? Object.freeze([...task.result]) : null });
}

export class InMemoryAgentTaskStore implements AgentTaskStore {
  private readonly tasks = new Map<string, MutableTask>();
  private readonly taskByIdempotency = new Map<string, string>();

  async enqueueIfAbsent(input: {
    readonly taskId: string;
    readonly agentId: string;
    readonly idempotencyKey: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly now: number;
  }): Promise<{ readonly task: AgentTask; readonly created: boolean }> {
    const dedupeKey = `${input.agentId}:${input.idempotencyKey}`;
    const existingId = this.taskByIdempotency.get(dedupeKey);
    if (existingId) return { task: snapshot(this.requireTask(existingId)), created: false };
    if (!input.taskId.trim() || !input.agentId.trim() || !input.idempotencyKey.trim()) {
      throw new Error("taskId, agentId and idempotencyKey are required");
    }
    const task: MutableTask = {
      taskId: input.taskId,
      agentId: input.agentId,
      idempotencyKey: input.idempotencyKey,
      payload: Object.freeze({ ...input.payload }),
      status: "queued",
      attempt: 0,
      notBefore: input.now,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      result: null,
      lastError: null,
    };
    this.tasks.set(task.taskId, task);
    this.taskByIdempotency.set(dedupeKey, task.taskId);
    return { task: snapshot(task), created: true };
  }

  async claimDue(input: {
    readonly agentId: string;
    readonly workerId: string;
    readonly now: number;
    readonly leaseMs: number;
  }): Promise<AgentTask | null> {
    const due = [...this.tasks.values()].find((task) =>
      task.agentId === input.agentId &&
      task.notBefore <= input.now &&
      (task.status === "queued" || task.status === "retry_wait" ||
        (task.status === "leased" && task.leaseExpiresAt !== null && task.leaseExpiresAt <= input.now)),
    );
    if (!due) return null;
    due.status = "leased";
    due.attempt += 1;
    due.leaseOwner = input.workerId;
    due.leaseToken = randomUUID();
    due.leaseExpiresAt = input.now + input.leaseMs;
    return snapshot(due);
  }

  async succeed(input: {
    readonly taskId: string;
    readonly leaseToken: string;
    readonly result: readonly CandidateSignal[];
  }): Promise<AgentTask> {
    const task = this.requireLease(input.taskId, input.leaseToken);
    task.status = "succeeded";
    task.result = Object.freeze([...input.result]);
    task.leaseOwner = null;
    task.leaseToken = null;
    task.leaseExpiresAt = null;
    return snapshot(task);
  }

  async fail(input: {
    readonly taskId: string;
    readonly leaseToken: string;
    readonly error: string;
    readonly now: number;
    readonly maxAttempts: number;
    readonly retryDelayMs: number;
  }): Promise<AgentTask> {
    const task = this.requireLease(input.taskId, input.leaseToken);
    const terminal = task.attempt >= input.maxAttempts;
    task.status = terminal ? "dead_lettered" : "retry_wait";
    task.notBefore = terminal ? task.notBefore : input.now + input.retryDelayMs;
    task.lastError = input.error;
    task.leaseOwner = null;
    task.leaseToken = null;
    task.leaseExpiresAt = null;
    return snapshot(task);
  }

  async release(input: {
    readonly taskId: string;
    readonly leaseToken: string;
    readonly reason: string;
    readonly notBefore: number;
  }): Promise<AgentTask> {
    const task = this.requireLease(input.taskId, input.leaseToken);
    task.status = "retry_wait";
    task.notBefore = input.notBefore;
    task.lastError = input.reason;
    task.leaseOwner = null;
    task.leaseToken = null;
    task.leaseExpiresAt = null;
    return snapshot(task);
  }

  get(taskId: string): AgentTask | null {
    const task = this.tasks.get(taskId);
    return task ? snapshot(task) : null;
  }

  private requireTask(taskId: string): MutableTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`unknown agent task '${taskId}'`);
    return task;
  }

  private requireLease(taskId: string, leaseToken: string): MutableTask {
    const task = this.requireTask(taskId);
    if (task.status !== "leased" || task.leaseToken !== leaseToken) {
      throw new Error("stale or invalid task lease");
    }
    return task;
  }
}
