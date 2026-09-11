import { randomUUID } from "node:crypto";
import { assertCandidateSignal } from "./admission";
import type { AgentTask, AgentTaskStore, CandidateSignal } from "./types";

type MutableTask = {
  -readonly [K in keyof AgentTask]: AgentTask[K];
};

function snapshot(task: MutableTask): AgentTask {
  return Object.freeze({
    ...task,
    payload: Object.freeze({ ...task.payload }),
    result: task.result ? freezeSignals(task.result) : null,
  });
}

export class InMemoryAgentTaskStore implements AgentTaskStore {
  private readonly tasks = new Map<string, MutableTask>();
  private readonly taskByIdempotency = new Map<string, string>();

  async enqueueIfAbsent(input: {
    readonly taskId: string;
    readonly boundaryId: string;
    readonly agentId: string;
    readonly idempotencyKey: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly now: number;
  }): Promise<{ readonly task: AgentTask; readonly created: boolean }> {
    requireNonBlank("taskId", input.taskId);
    requireNonBlank("boundaryId", input.boundaryId);
    requireNonBlank("agentId", input.agentId);
    requireNonBlank("idempotencyKey", input.idempotencyKey);
    requireFiniteTime("now", input.now);
    const dedupeKey = JSON.stringify([input.boundaryId, input.agentId, input.idempotencyKey]);
    const existingId = this.taskByIdempotency.get(dedupeKey);
    if (existingId) return { task: snapshot(this.requireTask(existingId)), created: false };
    if (this.tasks.has(input.taskId)) throw new Error(`agent task '${input.taskId}' already exists`);
    const task: MutableTask = {
      taskId: input.taskId,
      boundaryId: input.boundaryId,
      agentId: input.agentId,
      idempotencyKey: input.idempotencyKey,
      payload: Object.freeze({ ...input.payload }),
      status: "queued",
      attempt: 0,
      fencingEpoch: 0,
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
    readonly boundaryId: string;
    readonly agentId: string;
    readonly workerId: string;
    readonly now: number;
    readonly leaseMs: number;
    readonly maxAttempts: number;
  }): Promise<AgentTask | null> {
    requireNonBlank("boundaryId", input.boundaryId);
    requireNonBlank("agentId", input.agentId);
    requireNonBlank("workerId", input.workerId);
    requireFiniteTime("now", input.now);
    requirePositiveInteger("leaseMs", input.leaseMs);
    requirePositiveInteger("maxAttempts", input.maxAttempts);
    for (const task of this.tasks.values()) {
      if (
        task.boundaryId === input.boundaryId &&
        task.agentId === input.agentId &&
        task.attempt >= input.maxAttempts &&
        (task.status === "retry_wait" ||
          (task.status === "leased" && task.leaseExpiresAt !== null && task.leaseExpiresAt <= input.now))
      ) {
        task.status = "dead_lettered";
        task.lastError ??= "attempt ceiling reached after lease expiry";
        task.leaseOwner = null;
        task.leaseToken = null;
        task.leaseExpiresAt = null;
      }
    }
    const due = [...this.tasks.values()].find((task) =>
      task.boundaryId === input.boundaryId &&
      task.agentId === input.agentId &&
      task.attempt < input.maxAttempts &&
      task.notBefore <= input.now &&
      (task.status === "queued" || task.status === "retry_wait" ||
        (task.status === "leased" && task.leaseExpiresAt !== null && task.leaseExpiresAt <= input.now)),
    );
    if (!due) return null;
    due.status = "leased";
    due.attempt += 1;
    due.fencingEpoch += 1;
    due.leaseOwner = input.workerId;
    due.leaseToken = `${due.fencingEpoch}:${randomUUID()}`;
    due.leaseExpiresAt = input.now + input.leaseMs;
    return snapshot(due);
  }

  async succeed(input: {
    readonly taskId: string;
    readonly boundaryId: string;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly now: number;
    readonly result: readonly CandidateSignal[];
  }): Promise<AgentTask> {
    requireFiniteTime("now", input.now);
    for (const signal of input.result) {
      assertCandidateSignal(signal);
      if (signal.boundaryId !== input.boundaryId) {
        throw new Error("CandidateSignal boundary does not match the task boundary");
      }
    }
    const task = this.requireLease(input.taskId, input.boundaryId, input.workerId, input.leaseToken, input.now);
    task.status = "succeeded";
    task.result = freezeSignals(input.result);
    task.leaseOwner = null;
    task.leaseToken = null;
    task.leaseExpiresAt = null;
    return snapshot(task);
  }

  async fail(input: {
    readonly taskId: string;
    readonly boundaryId: string;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly error: string;
    readonly now: number;
    readonly maxAttempts: number;
    readonly retryDelayMs: number;
  }): Promise<AgentTask> {
    requireFiniteTime("now", input.now);
    requirePositiveInteger("maxAttempts", input.maxAttempts);
    requireNonNegativeInteger("retryDelayMs", input.retryDelayMs);
    const task = this.requireLease(input.taskId, input.boundaryId, input.workerId, input.leaseToken, input.now);
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
    readonly boundaryId: string;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly reason: string;
    readonly now: number;
    readonly retryDelayMs: number;
  }): Promise<AgentTask> {
    requireFiniteTime("now", input.now);
    requireNonNegativeInteger("retryDelayMs", input.retryDelayMs);
    const task = this.requireLease(input.taskId, input.boundaryId, input.workerId, input.leaseToken, input.now);
    task.status = "retry_wait";
    task.notBefore = input.now + input.retryDelayMs;
    task.lastError = input.reason;
    task.leaseOwner = null;
    task.leaseToken = null;
    task.leaseExpiresAt = null;
    return snapshot(task);
  }

  async renewLease(input: {
    readonly taskId: string;
    readonly boundaryId: string;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly now: number;
    readonly leaseMs: number;
  }): Promise<AgentTask> {
    requireFiniteTime("now", input.now);
    requirePositiveInteger("leaseMs", input.leaseMs);
    const task = this.requireLease(input.taskId, input.boundaryId, input.workerId, input.leaseToken, input.now);
    task.leaseExpiresAt = input.now + input.leaseMs;
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

  private requireLease(
    taskId: string,
    boundaryId: string,
    workerId: string,
    leaseToken: string,
    now: number,
  ): MutableTask {
    const task = this.requireTask(taskId);
    if (
      task.boundaryId !== boundaryId ||
      task.status !== "leased" ||
      task.leaseOwner !== workerId ||
      task.leaseToken !== leaseToken ||
      task.leaseExpiresAt === null ||
      task.leaseExpiresAt <= now
    ) {
      throw new Error("stale, expired, cross-boundary, or invalid task lease");
    }
    return task;
  }
}

function freezeSignals(signals: readonly CandidateSignal[]): readonly CandidateSignal[] {
  return Object.freeze(signals.map((signal) => Object.freeze({ ...signal })));
}

function requireNonBlank(name: string, value: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function requireFiniteTime(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

function requireNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}
