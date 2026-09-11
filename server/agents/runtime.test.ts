import { describe, expect, it } from "vitest";
import { assertCandidateSignal, canBeCase } from "./admission";
import { InMemoryAgentTaskStore } from "./inMemoryTaskStore";
import { AgentRuntime } from "./runtime";
import type { AgentAuditEvent, AgentHandler, AgentPolicySnapshot, CandidateSignal } from "./types";

const SIGNAL: CandidateSignal = {
  signalId: "sig-1",
  boundaryId: "tenant-1",
  recoveryType: "ActivationMissed",
  sourceRef: "crm:account-1",
  sourcePayloadHash: "a".repeat(64),
  detectorVersion: "activation-detector@1.0.0",
  observedAt: "2026-09-07T00:00:00.000Z",
  amountAtRiskMinor: 50_000,
  currency: "USD",
  actionAvailable: true,
  expectedProofEvent: "second invoice paid",
};

function harness() {
  let now = 1_000;
  let policy: AgentPolicySnapshot = {
    globalEnabled: true,
    disabledAgents: new Set(),
    maxAttempts: 3,
    leaseMs: 100,
    retryDelayMs: (attempt) => attempt * 10,
  };
  const store = new InMemoryAgentTaskStore();
  const events: AgentAuditEvent[] = [];
  const runtime = new AgentRuntime({
    store,
    policy: { current: () => policy },
    audit: { append: async (event) => { events.push(event); } },
    now: () => now,
  });
  return {
    store,
    events,
    runtime,
    advance: (ms: number) => { now += ms; },
    setPolicy: (next: AgentPolicySnapshot) => { policy = next; },
    getPolicy: () => policy,
  };
}

async function enqueue(store: InMemoryAgentTaskStore, taskId = "task-1", idempotencyKey = "source-1") {
  return store.enqueueIfAbsent({ taskId, boundaryId: "tenant-1", agentId: "activation-detector", idempotencyKey, payload: { batch: 1 }, now: 1_000 });
}

function handler(run: AgentHandler["run"]): AgentHandler {
  return { agentId: "activation-detector", run };
}

describe("Agent Runtime Foundation v0.1", () => {
  it("admits a signal only when Identify, Fix and Prove gates all pass", () => {
    const policy = { recoveryType: "ActivationMissed", economicThresholdMinor: 10_000 };
    expect(canBeCase(SIGNAL, policy)).toEqual({ admitted: true });
    expect(canBeCase({ ...SIGNAL, amountAtRiskMinor: 9_999 }, policy).admitted).toBe(false);
    expect(canBeCase({ ...SIGNAL, actionAvailable: false }, policy).admitted).toBe(false);
    expect(canBeCase({ ...SIGNAL, expectedProofEvent: "" }, policy).admitted).toBe(false);
  });

  it("deduplicates the same agent/idempotency key", async () => {
    const h = harness();
    const first = await enqueue(h.store, "task-1", "same-source");
    const second = await enqueue(h.store, "task-2", "same-source");
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.task.taskId).toBe("task-1");
  });

  it("does not deduplicate the same source across tenant boundaries", async () => {
    const h = harness();
    const first = await enqueue(h.store, "task-1", "same-source");
    const second = await h.store.enqueueIfAbsent({
      taskId: "task-2",
      boundaryId: "tenant-2",
      agentId: "activation-detector",
      idempotencyKey: "same-source",
      payload: { batch: 1 },
      now: 1_000,
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
  });

  it("rejects a signal emitted for a different tenant boundary", async () => {
    const h = harness();
    await enqueue(h.store);
    const result = await h.runtime.runNext(
      handler(async () => [{ ...SIGNAL, boundaryId: "tenant-2" }]),
      "worker-a",
      "tenant-1",
    );
    expect(result).toMatchObject({ status: "retry_wait", result: null });
    expect(result?.lastError).toMatch(/boundary/i);
  });

  it("stores detector output as CandidateSignals without performing governed actions", async () => {
    const h = harness();
    await enqueue(h.store);
    const result = await h.runtime.runNext(handler(async () => [SIGNAL]), "worker-a", "tenant-1");
    expect(result?.status).toBe("succeeded");
    expect(result?.result).toEqual([SIGNAL]);
    expect(h.events.map((event) => event.kind)).toEqual(["task.claimed", "task.succeeded"]);
  });

  it("rejects output that tries to smuggle proof or collection claims", async () => {
    const h = harness();
    await enqueue(h.store);
    const poisoned = { ...SIGNAL, revenueReturnedMinor: 50_000 } as CandidateSignal;
    expect(() => assertCandidateSignal(poisoned)).toThrow(/forbidden fields/i);
    const result = await h.runtime.runNext(handler(async () => [poisoned]), "worker-a", "tenant-1");
    expect(result?.status).toBe("retry_wait");
    expect(result?.result).toBeNull();
    expect(result?.lastError).toMatch(/revenueReturnedMinor/);
  });

  it("retries with backoff and dead-letters at the attempt ceiling", async () => {
    const h = harness();
    await enqueue(h.store);
    const failing = handler(async () => { throw new Error("source unavailable"); });
    expect((await h.runtime.runNext(failing, "worker-a", "tenant-1"))?.status).toBe("retry_wait");
    expect(await h.runtime.runNext(failing, "worker-a", "tenant-1")).toBeNull();
    h.advance(10);
    expect((await h.runtime.runNext(failing, "worker-a", "tenant-1"))?.status).toBe("retry_wait");
    h.advance(20);
    expect((await h.runtime.runNext(failing, "worker-a", "tenant-1"))?.status).toBe("dead_lettered");
    expect(h.store.get("task-1")?.attempt).toBe(3);
  });

  it("reclaims an expired lease and rejects stale-worker completion", async () => {
    const h = harness();
    await enqueue(h.store);
    const first = await h.store.claimDue({ boundaryId: "tenant-1", agentId: "activation-detector", workerId: "worker-a", now: 1_000, leaseMs: 100, maxAttempts: 3 });
    expect(first?.status).toBe("leased");
    const second = await h.store.claimDue({ boundaryId: "tenant-1", agentId: "activation-detector", workerId: "worker-b", now: 1_101, leaseMs: 100, maxAttempts: 3 });
    expect(second?.attempt).toBe(2);
    await expect(h.store.succeed({ taskId: "task-1", boundaryId: "tenant-1", workerId: "worker-a", leaseToken: first!.leaseToken!, now: 1_101, result: [] })).rejects.toThrow(/stale/i);
    await expect(h.store.succeed({ taskId: "task-1", boundaryId: "tenant-1", workerId: "worker-b", leaseToken: second!.leaseToken!, now: 1_101, result: [] })).resolves.toMatchObject({ status: "succeeded" });
  });

  it("global and per-agent kill switches prevent claims", async () => {
    const h = harness();
    await enqueue(h.store);
    h.setPolicy({ ...h.getPolicy(), globalEnabled: false });
    expect(await h.runtime.runNext(handler(async () => [SIGNAL]), "worker-a", "tenant-1")).toBeNull();
    expect(h.store.get("task-1")?.attempt).toBe(0);
    h.setPolicy({ ...h.getPolicy(), globalEnabled: true, disabledAgents: new Set(["activation-detector"]) });
    expect(await h.runtime.runNext(handler(async () => [SIGNAL]), "worker-a", "tenant-1")).toBeNull();
    expect(h.store.get("task-1")?.attempt).toBe(0);
  });

  it("engaging the kill switch during a run suppresses publication and releases the task", async () => {
    const h = harness();
    await enqueue(h.store);
    const result = await h.runtime.runNext(handler(async () => {
      h.setPolicy({ ...h.getPolicy(), globalEnabled: false });
      return [SIGNAL];
    }), "worker-a", "tenant-1");
    expect(result?.status).toBe("retry_wait");
    expect(result?.result).toBeNull();
    expect(h.events.at(-1)?.kind).toBe("task.released");
  });
});
