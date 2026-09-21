import { describe, expect, it, vi } from "vitest";
import {
  AgentWorker,
  AgentWorkerSupervisor,
  summarizeWorkerReadiness,
  workersReady,
} from "./worker";
import type { AgentHandler, AgentTask } from "./types";

const handler: AgentHandler = { agentId: "detector", run: async () => [] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AgentWorker lifecycle", () => {
  it("never overlaps polls and waits for the active fenced run during shutdown", async () => {
    const run = deferred<AgentTask | null>();
    const runNext = vi.fn(() => run.promise);
    const worker = new AgentWorker({
      runtime: { runNext }, handler, workerId: "worker-1", boundaryId: "tenant-1",
      idleDelayMs: 1, errorDelayMs: () => 1,
    });

    worker.start();
    await settle();
    expect(runNext).toHaveBeenCalledTimes(1);
    expect(worker.snapshot()).toMatchObject({ state: "running", active: true });

    let stopped = false;
    const stopping = worker.stop().then(() => { stopped = true; });
    await settle();
    expect(stopped).toBe(false);
    expect(worker.snapshot().state).toBe("stopping");

    run.resolve(null);
    await stopping;
    expect(runNext).toHaveBeenCalledTimes(1);
    expect(worker.snapshot()).toMatchObject({ state: "stopped", active: false });
  });

  it("backs off after infrastructure errors and clears the error after recovery", async () => {
    const delays: number[] = [];
    let polls = 0;
    const worker = new AgentWorker({
      runtime: {
        runNext: async () => {
          polls += 1;
          if (polls === 1) throw new Error("database unavailable");
          return null;
        },
      },
      handler, workerId: "worker-1", boundaryId: "tenant-1", idleDelayMs: 5,
      errorDelayMs: (errors) => errors * 100,
      sleep: async (ms) => {
        delays.push(ms);
        await settle();
      },
    });

    worker.start();
    while (delays.length < 2) await settle();
    await worker.stop();

    expect(delays).toEqual([100, 5]);
    expect(worker.snapshot()).toMatchObject({
      state: "stopped", consecutiveErrors: 0, lastError: null,
    });
  });

  it("is disabled until explicitly started and reports readiness only while running", async () => {
    const run = deferred<AgentTask | null>();
    const worker = new AgentWorker({
      runtime: { runNext: () => run.promise }, handler, workerId: "worker-1",
      boundaryId: "tenant-1", idleDelayMs: 1, errorDelayMs: () => 1,
    });

    expect(workersReady([worker.snapshot()])).toBe(false);
    worker.start();
    await settle();
    expect(workersReady([worker.snapshot()])).toBe(true);
    const stopping = worker.stop();
    run.resolve(null);
    await stopping;
    expect(workersReady([worker.snapshot()])).toBe(false);
  });

  it("rejects unscoped worker identities and duplicate starts", async () => {
    expect(() => new AgentWorker({
      runtime: { runNext: async () => null }, handler, workerId: " ", boundaryId: "tenant-1",
      idleDelayMs: 1, errorDelayMs: () => 1,
    })).toThrow(/workerId/);

    const run = deferred<AgentTask | null>();
    const worker = new AgentWorker({
      runtime: { runNext: () => run.promise }, handler, workerId: "worker-1",
      boundaryId: "tenant-1", idleDelayMs: 1, errorDelayMs: () => 1,
    });
    worker.start();
    expect(() => worker.start()).toThrow(/cannot start/);
    const stopping = worker.stop();
    run.resolve(null);
    await stopping;
  });

  it("fails readiness closed when agents are enabled but no worker is running", () => {
    expect(summarizeWorkerReadiness(false, [])).toEqual({
      status: "disabled", configured: 0, running: 0,
    });
    expect(summarizeWorkerReadiness(true, [])).toEqual({
      status: "down", configured: 0, running: 0,
    });
    expect(summarizeWorkerReadiness(true, [{
      workerId: "worker-1", agentId: "detector", boundaryId: "tenant-1",
      state: "stopped", active: false, lastPollAt: null, lastHealthyPollAt: null,
      consecutiveErrors: 0, lastError: null,
    }])).toEqual({ status: "down", configured: 1, running: 0 });
  });

  it("keeps disabled supervisors inert and rejects enabled empty supervisors", () => {
    const disabled = new AgentWorkerSupervisor(false, []);
    disabled.start();
    expect(disabled.readiness()).toEqual({ status: "disabled", configured: 0, running: 0 });

    const invalid = new AgentWorkerSupervisor(true, []);
    expect(() => invalid.start()).toThrow(/no workers/i);
    expect(invalid.readiness().status).toBe("down");
  });
});
