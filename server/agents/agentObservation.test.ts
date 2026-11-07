// THE WIDENED HANDLER CONTRACT · a handler may record facts about its own run, and they reach a record.
//
// WHY THIS EXISTS. `reconciliationObserver` computed a refused-exposure figure and `run` could return
// only signals, so the figure was discarded at the handler boundary and reached no record, no API and no
// screen — a governed number that existed and could not be read. A refused unit deliberately produces
// NO candidate, so the signal array was structurally the wrong channel, and no read-side derivation
// could have recovered it because the fact never reached the database.
//
// THE COMPATIBILITY CLAIM IS THE FIRST THING TESTED: every existing handler returns a bare array and is
// untouched. If that were not true this change would have been a migration rather than a widening.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "./runtime";
import { InMemoryAgentTaskStore } from "./inMemoryTaskStore";
import {
  AGENT_OBSERVATION_SCHEME,
  agentRunOutcome,
  assertAgentObservation,
  type AgentHandler,
  type AgentObservation,
  type AgentPolicySnapshot,
  type CandidateSignal,
} from "./types";

const uid = () => randomUUID().slice(0, 8);

const POLICY: AgentPolicySnapshot = Object.freeze({
  globalEnabled: true,
  disabledAgents: new Set<string>(),
  maxAttempts: 3,
  leaseMs: 30_000,
  retryDelayMs: () => 1_000,
});

const refused = (over: Partial<NonNullable<AgentObservation["refusedExposure"]>> = {}) => ({
  state: "UNDETERMINED" as const,
  refusedUnits: 1,
  refusedExpectedMinor: 120_000,
  refusedWithoutExpected: 0,
  currency: "USD",
  ...over,
});

const observation = (over: Partial<AgentObservation> = {}): AgentObservation =>
  ({ scheme: AGENT_OBSERVATION_SCHEME, refusedExposure: refused(), ...over });

async function runOnce(handler: AgentHandler, boundaryId: string) {
  const store = new InMemoryAgentTaskStore();
  await store.enqueueIfAbsent({
    taskId: `T-${uid()}`, boundaryId, agentId: handler.agentId,
    idempotencyKey: `k-${uid()}`, payload: {}, now: Date.now(),
  });
  const runtime = new AgentRuntime({
    store, policy: { current: () => POLICY }, audit: { append: async () => {} }, now: Date.now,
  });
  return runtime.runNext(handler, `w-${uid()}`, boundaryId);
}

describe("the union return keeps every existing handler untouched", () => {
  it("a handler returning a bare array still succeeds", async () => {
    const boundaryId = `TEST-obs-${uid()}`;
    const task = await runOnce(
      { agentId: "array-v1", publishesCandidates: false, run: async () => [] },
      boundaryId,
    );
    expect(task?.status).toBe("succeeded");
    expect(task?.result).toEqual([]);
  });

  it("agentRunOutcome normalises both forms, and the array form carries no observation", () => {
    expect(agentRunOutcome([])).toEqual({ signals: [] });
    expect(agentRunOutcome({ signals: [] })).toEqual({ signals: [] });
    const withObs = agentRunOutcome({ signals: [], observation: observation() });
    expect(withObs.observation?.scheme).toBe(AGENT_OBSERVATION_SCHEME);
  });

  it("refuses a return that is neither form, rather than treating it as empty", () => {
    for (const bad of [null, undefined, 42, "signals", {}, { signals: "no" }]) {
      expect(() => agentRunOutcome(bad as never)).toThrow(/CandidateSignal array or/);
    }
  });

  it("EVERY handler in this build still returns a bare array — so nothing had to be migrated", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const dir = fileURLToPath(new URL("./", import.meta.url));
    const producers = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) => /\breturn signalsForPlan|run\(|run:/.test(readFileSync(`${dir}${f}`, "utf8")));
    expect(producers.length).toBeGreaterThan(2);
    // Exactly one handler uses the new form, and it is the one this slice exists for.
    const usesResultForm = producers.filter((f) =>
      /observation:\s*\{/.test(readFileSync(`${dir}${f}`, "utf8")),
    );
    expect(usesResultForm).toEqual(["reconciliationObserver.ts"]);
  });
});

describe("the observation is a closed, validated shape", () => {
  it("accepts a well-formed one", () => {
    expect(() => assertAgentObservation(observation())).not.toThrow();
    expect(() =>
      assertAgentObservation({ scheme: AGENT_OBSERVATION_SCHEME, refusedExposure: refused({ state: "NONE_REFUSED", refusedUnits: 0, refusedExpectedMinor: 0 }) }),
    ).not.toThrow();
    // The scheme alone, with nothing recorded, is valid: a handler may say "I recorded nothing".
    expect(() => assertAgentObservation({ scheme: AGENT_OBSERVATION_SCHEME })).not.toThrow();
  });

  it("refuses an unknown key rather than persisting it", () => {
    expect(() => assertAgentObservation({ scheme: AGENT_OBSERVATION_SCHEME, recoveredMinor: 50_000 }))
      .toThrow(/forbidden fields: recoveredMinor/);
    expect(() =>
      assertAgentObservation({ scheme: AGENT_OBSERVATION_SCHEME, refusedExposure: { ...refused(), headline: "x" } }),
    ).toThrow(/refusedExposure contains forbidden fields: headline/);
  });

  it("refuses a missing field, a bad state, a negative count and a bad currency", () => {
    const { currency: _c, ...noCurrency } = refused();
    expect(() => assertAgentObservation({ scheme: AGENT_OBSERVATION_SCHEME, refusedExposure: noCurrency }))
      .toThrow(/missing: currency/);
    expect(() => assertAgentObservation({ scheme: AGENT_OBSERVATION_SCHEME, refusedExposure: refused({ state: "MAYBE" as never }) }))
      .toThrow(/state must be one of/);
    expect(() => assertAgentObservation({ scheme: AGENT_OBSERVATION_SCHEME, refusedExposure: refused({ refusedUnits: -1 }) }))
      .toThrow(/refusedUnits must be a non-negative safe integer/);
    expect(() => assertAgentObservation({ scheme: AGENT_OBSERVATION_SCHEME, refusedExposure: refused({ currency: "usd" }) }))
      .toThrow(/currency must be an ISO code/);
    expect(() => assertAgentObservation({ scheme: "other", refusedExposure: refused() }))
      .toThrow(/scheme must be/);
  });

  it("refuses a state that contradicts its own counts, so the states stay distinguishable", () => {
    expect(() => assertAgentObservation({ scheme: AGENT_OBSERVATION_SCHEME, refusedExposure: refused({ state: "UNDETERMINED", refusedUnits: 0 }) }))
      .toThrow(/UNDETERMINED requires at least one refused unit/);
    expect(() => assertAgentObservation({ scheme: AGENT_OBSERVATION_SCHEME, refusedExposure: refused({ state: "NONE_REFUSED", refusedUnits: 2 }) }))
      .toThrow(/NONE_REFUSED cannot carry refused units/);
    expect(() => assertAgentObservation({ scheme: AGENT_OBSERVATION_SCHEME, refusedExposure: refused({ state: "NOT_EXAMINED", refusedUnits: 1 }) }))
      .toThrow(/NOT_EXAMINED cannot carry refused units/);
  });

  it("CANNOT express money the business got back — there is no such field, and adding one is refused", () => {
    for (const field of ["collectedMinor", "recoveredMinor", "revenueReturnedMinor", "provenMinor"]) {
      expect(() => assertAgentObservation({ scheme: AGENT_OBSERVATION_SCHEME, [field]: 1 }))
        .toThrow(/forbidden fields/);
    }
  });
});

describe("a malformed observation fails the task, and nothing is recorded", () => {
  it("fails before succeed(), so no result and no publication", async () => {
    const boundaryId = `TEST-obs-${uid()}`;
    const bad: AgentHandler = {
      agentId: "bad-observer-v1",
      publishesCandidates: false,
      run: async () => ({ signals: [] as readonly CandidateSignal[], observation: { scheme: "wrong" } as never }),
    };
    const task = await runOnce(bad, boundaryId);
    expect(task?.status).not.toBe("succeeded");
    expect(task?.lastError).toMatch(/observation scheme must be/);
    expect(task?.result).toBeNull();
  });

  it("the observation-only contract is still enforced alongside it", async () => {
    const boundaryId = `TEST-obs-${uid()}`;
    const smuggler: AgentHandler = {
      agentId: "smuggler-v1",
      publishesCandidates: false,
      run: async () => ({
        signals: [{
          signalId: `S-${uid()}`, boundaryId, recoveryType: "RevenueUnderBilled",
          sourceRef: `hmac-sha256:${"a".repeat(64)}`, sourcePayloadHash: "b".repeat(64),
          detectorVersion: "x", observedAt: new Date(Date.now() - 1000).toISOString(),
          amountAtRiskMinor: 1, currency: "USD", actionAvailable: true, expectedProofEvent: "x",
        }] as readonly CandidateSignal[],
        observation: observation(),
      }),
    };
    const task = await runOnce(smuggler, boundaryId);
    expect(task?.status).not.toBe("succeeded");
    expect(task?.lastError).toMatch(/declared observation-only and must not emit CandidateSignals/);
  });

  it("a well-formed observation succeeds, and the in-memory store validates it even with nowhere to put it", async () => {
    const boundaryId = `TEST-obs-${uid()}`;
    const good: AgentHandler = {
      agentId: "good-observer-v1",
      publishesCandidates: false,
      run: async () => ({ signals: [] as readonly CandidateSignal[], observation: observation() }),
    };
    const task = await runOnce(good, boundaryId);
    expect(task?.status).toBe("succeeded");
  });
});
