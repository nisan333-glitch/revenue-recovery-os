import { describe, expect, it, vi } from "vitest";
import { InMemoryAgentTaskStore } from "./inMemoryTaskStore";
import { AgentRuntime } from "./runtime";
import type {
  AgentAuditEvent,
  AgentHandler,
  AgentPolicySnapshot,
  CandidateSignal,
} from "./types";

const AGENT_ID = "activation-detector";

const VALID_SIGNAL: CandidateSignal = {
  signalId: "signal-1",
  boundaryId: "workspace-1",
  recoveryType: "ActivationMissed",
  sourceRef: "crm:account-1",
  sourcePayloadHash: "a".repeat(64),
  detectorVersion: "activation-missed@0.1.0",
  observedAt: "2026-09-07T06:00:00.000Z",
  amountAtRiskMinor: 25_000,
  currency: "USD",
  actionAvailable: true,
  expectedProofEvent: "invoice paid",
};

function createHarness(overrides: Partial<AgentPolicySnapshot> = {}) {
  let now = 10_000;
  let policy: AgentPolicySnapshot = {
    globalEnabled: true,
    disabledAgents: new Set(),
    maxAttempts: 3,
    leaseMs: 100,
    retryDelayMs: (attempt) => attempt * 10,
    ...overrides,
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
    now: () => now,
    advance: (milliseconds: number) => { now += milliseconds; },
    policy: () => policy,
    setPolicy: (next: AgentPolicySnapshot) => { policy = next; },
  };
}

async function enqueue(store: InMemoryAgentTaskStore, taskId = "task-1", idempotencyKey = "source-1") {
  return store.enqueueIfAbsent({
    taskId,
    boundaryId: "workspace-1",
    agentId: AGENT_ID,
    idempotencyKey,
    payload: { batch: 1 },
    now: 10_000,
  });
}

function handler(run: AgentHandler["run"]): AgentHandler {
  return { agentId: AGENT_ID, run };
}

describe("Agent runtime contract", () => {
  it("allows exactly one worker to claim a due task under concurrent claims", async () => {
    const h = createHarness();
    await enqueue(h.store);

    const claims = await Promise.all([
      h.store.claimDue({ agentId: AGENT_ID, workerId: "worker-a", now: h.now(), leaseMs: 100 }),
      h.store.claimDue({ agentId: AGENT_ID, workerId: "worker-b", now: h.now(), leaseMs: 100 }),
    ]);

    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
    expect(claims.filter((claim) => claim === null)).toHaveLength(1);
    expect(h.store.get("task-1")).toMatchObject({ status: "leased", attempt: 1 });
  });

  it("deduplicates concurrent enqueues for one agent and idempotency key", async () => {
    const store = new InMemoryAgentTaskStore();
    const [first, second] = await Promise.all([
      enqueue(store, "task-a", "same-source"),
      enqueue(store, "task-b", "same-source"),
    ]);

    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
    expect(first.task.taskId).toBe(second.task.taskId);
  });

  it("fences a stale worker from every terminal mutation after lease reclamation", async () => {
    const h = createHarness();
    await enqueue(h.store);
    const stale = await h.store.claimDue({ agentId: AGENT_ID, workerId: "worker-a", now: h.now(), leaseMs: 100 });
    h.advance(101);
    const current = await h.store.claimDue({ agentId: AGENT_ID, workerId: "worker-b", now: h.now(), leaseMs: 100 });

    expect(current?.attempt).toBe(2);
    await expect(h.store.succeed({ taskId: "task-1", leaseToken: stale!.leaseToken!, result: [] }))
      .rejects.toThrow(/stale or invalid task lease/i);
    await expect(h.store.fail({
      taskId: "task-1",
      leaseToken: stale!.leaseToken!,
      error: "late failure",
      now: h.now(),
      maxAttempts: 3,
      retryDelayMs: 10,
    })).rejects.toThrow(/stale or invalid task lease/i);
    await expect(h.store.release({
      taskId: "task-1",
      leaseToken: stale!.leaseToken!,
      reason: "late release",
      notBefore: h.now(),
    })).rejects.toThrow(/stale or invalid task lease/i);
    await expect(h.store.succeed({ taskId: "task-1", leaseToken: current!.leaseToken!, result: [VALID_SIGNAL] }))
      .resolves.toMatchObject({ status: "succeeded", attempt: 2 });
  });

  it("does not invoke a handler or claim work when either pre-run kill switch is engaged", async () => {
    for (const policyOverride of [
      { globalEnabled: false },
      { disabledAgents: new Set([AGENT_ID]) },
    ]) {
      const h = createHarness(policyOverride);
      await enqueue(h.store);
      const run = vi.fn<AgentHandler["run"]>(async () => [VALID_SIGNAL]);

      expect(await h.runtime.runNext(handler(run), "worker-a")).toBeNull();
      expect(run).not.toHaveBeenCalled();
      expect(h.store.get("task-1")).toMatchObject({ status: "queued", attempt: 0, result: null });
      expect(h.events).toHaveLength(1);
      expect(h.events[0]).toMatchObject({ kind: "agent.skipped", agentId: AGENT_ID });
    }
  });

  it("suppresses the complete result atomically when an agent is disabled after its handler runs", async () => {
    const h = createHarness();
    await enqueue(h.store);

    const result = await h.runtime.runNext(handler(async () => {
      h.setPolicy({ ...h.policy(), disabledAgents: new Set([AGENT_ID]) });
      return [VALID_SIGNAL, { ...VALID_SIGNAL, signalId: "signal-2" }];
    }), "worker-a");

    expect(result).toMatchObject({ status: "retry_wait", result: null, attempt: 1 });
    expect(result?.lastError).toContain("disabled");
    expect(h.events.map((event) => event.kind)).toEqual(["task.claimed", "task.released"]);
  });

  it("rejects non-array output and records no partial result", async () => {
    const h = createHarness();
    await enqueue(h.store);
    const invalidRun = (async () => VALID_SIGNAL) as unknown as AgentHandler["run"];

    const result = await h.runtime.runNext(handler(invalidRun), "worker-a");

    expect(result).toMatchObject({ status: "retry_wait", result: null });
    expect(result?.lastError).toMatch(/must be an array/i);
    expect(h.events.at(-1)).toMatchObject({ kind: "task.failed", terminal: false });
  });

  it("rejects an entire candidate array when any entry contains an unknown proof field", async () => {
    const h = createHarness();
    await enqueue(h.store);
    const proofClaim = {
      ...VALID_SIGNAL,
      signalId: "signal-2",
      proofType: "Auditable",
      collectedRevenueMinor: 25_000,
    } as unknown as CandidateSignal;

    const result = await h.runtime.runNext(handler(async () => [VALID_SIGNAL, proofClaim]), "worker-a");

    expect(result).toMatchObject({ status: "retry_wait", result: null });
    expect(result?.lastError).toMatch(/forbidden fields/i);
    expect(result?.lastError).toContain("collectedRevenueMinor");
    expect(result?.lastError).toContain("proofType");
  });

  it("dead-letters on the first failure when maxAttempts is one", async () => {
    const h = createHarness({ maxAttempts: 1 });
    await enqueue(h.store);

    const result = await h.runtime.runNext(handler(async () => { throw new Error("permanent failure"); }), "worker-a");

    expect(result).toMatchObject({ status: "dead_lettered", attempt: 1, lastError: "permanent failure" });
    expect(await h.runtime.runNext(handler(async () => [VALID_SIGNAL]), "worker-b")).toBeNull();
    expect(h.events.at(-1)).toMatchObject({ kind: "task.failed", terminal: true });
  });

  it("uses the post-run max-attempt policy when deciding retry versus dead letter", async () => {
    const h = createHarness({ maxAttempts: 5 });
    await enqueue(h.store);

    const result = await h.runtime.runNext(handler(async () => {
      h.setPolicy({ ...h.policy(), maxAttempts: 1 });
      throw new Error("failed after policy tightened");
    }), "worker-a");

    expect(result).toMatchObject({ status: "dead_lettered", attempt: 1 });
    expect(h.events.at(-1)).toMatchObject({ kind: "task.failed", terminal: true });
  });
});
