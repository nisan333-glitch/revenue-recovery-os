import type { AgentHandler, AgentTask } from "./types";

export interface AgentTaskRunner {
  runNext(handler: AgentHandler, workerId: string, boundaryId: string): Promise<AgentTask | null>;
}

export type AgentWorkerState = "idle" | "running" | "stopping" | "stopped";

export interface AgentWorkerSnapshot {
  readonly workerId: string;
  readonly agentId: string;
  readonly boundaryId: string;
  readonly state: AgentWorkerState;
  readonly active: boolean;
  readonly lastPollAt: number | null;
  readonly lastHealthyPollAt: number | null;
  readonly consecutiveErrors: number;
  readonly lastError: string | null;
}

export interface AgentWorkerReadiness {
  readonly status: "disabled" | "up" | "down";
  readonly configured: number;
  readonly running: number;
}

export interface AgentWorkerOptions {
  readonly runtime: AgentTaskRunner;
  readonly handler: AgentHandler;
  readonly workerId: string;
  readonly boundaryId: string;
  readonly idleDelayMs: number;
  readonly errorDelayMs: (consecutiveErrors: number) => number;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * One serial worker for one trusted boundary. It never overlaps claims, stops claiming before
 * shutdown, and waits for the active fenced runtime call to settle before reporting `stopped`.
 * Worker construction belongs in trusted process bootstrap code, never in an HTTP request path.
 */
export class AgentWorker {
  private readonly controller = new AbortController();
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private state: AgentWorkerState = "idle";
  private active = false;
  private lastPollAt: number | null = null;
  private lastHealthyPollAt: number | null = null;
  private consecutiveErrors = 0;
  private lastError: string | null = null;
  private loop: Promise<void> | null = null;

  constructor(private readonly options: AgentWorkerOptions) {
    requireNonBlank("workerId", options.workerId);
    requireNonBlank("boundaryId", options.boundaryId);
    requireNonNegativeInteger("idleDelayMs", options.idleDelayMs);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? abortableSleep;
  }

  start(): void {
    if (this.state !== "idle") throw new Error(`agent worker cannot start from '${this.state}'`);
    this.state = "running";
    this.loop = this.runLoop();
  }

  async stop(): Promise<void> {
    if (this.state === "stopped") return;
    if (this.state === "idle") {
      this.state = "stopped";
      return;
    }
    this.state = "stopping";
    this.controller.abort();
    await this.loop;
  }

  snapshot(): AgentWorkerSnapshot {
    return Object.freeze({
      workerId: this.options.workerId,
      agentId: this.options.handler.agentId,
      boundaryId: this.options.boundaryId,
      state: this.state,
      active: this.active,
      lastPollAt: this.lastPollAt,
      lastHealthyPollAt: this.lastHealthyPollAt,
      consecutiveErrors: this.consecutiveErrors,
      lastError: this.lastError,
    });
  }

  private async runLoop(): Promise<void> {
    try {
      while (!this.controller.signal.aborted) {
        let delayMs = this.options.idleDelayMs;
        this.active = true;
        this.lastPollAt = this.now();
        try {
          await this.options.runtime.runNext(
            this.options.handler,
            this.options.workerId,
            this.options.boundaryId,
          );
          this.lastHealthyPollAt = this.now();
          this.consecutiveErrors = 0;
          this.lastError = null;
        } catch (error) {
          this.consecutiveErrors += 1;
          this.lastError = error instanceof Error ? error.message : "unknown worker failure";
          delayMs = this.options.errorDelayMs(this.consecutiveErrors);
          requireNonNegativeInteger("errorDelayMs result", delayMs);
        } finally {
          this.active = false;
        }
        if (!this.controller.signal.aborted) {
          await this.sleep(delayMs, this.controller.signal);
        }
      }
    } catch (error) {
      if (!this.controller.signal.aborted) {
        this.consecutiveErrors += 1;
        this.lastError = error instanceof Error ? error.message : "unknown worker loop failure";
      }
    } finally {
      this.active = false;
      this.state = "stopped";
    }
  }
}

export function workersReady(workers: readonly AgentWorkerSnapshot[]): boolean {
  return workers.length > 0 && workers.every((worker) => worker.state === "running");
}

export function summarizeWorkerReadiness(
  enabled: boolean,
  workers: readonly AgentWorkerSnapshot[],
): AgentWorkerReadiness {
  if (!enabled) return Object.freeze({ status: "disabled", configured: workers.length, running: 0 });
  const running = workers.filter((worker) => worker.state === "running").length;
  return Object.freeze({
    status: workersReady(workers) ? "up" : "down",
    configured: workers.length,
    running,
  });
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    timer.unref();
    signal.addEventListener("abort", done, { once: true });

    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

function requireNonBlank(name: string, value: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function requireNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}
