// EP-17 · Who may publish a candidate, and who merely says they will not.
//
// THE GAP THIS CLOSES. The candidate admission policy registry was required process-wide, because
// `AgentHandler` declared no publication capability and `createAgentProcessFromEnvironment` therefore
// could not tell a detector from an observation-only agent. An assessment-only pilot had to invent a
// recovery type and an economic threshold it would never use — a fabricated number sitting in
// configuration, which is the habit this codebase exists to break.
//
// The fix narrows the guard rather than relaxing it, and adds one that did not exist: a handler that
// declares itself observation-only and then returns a signal is FAILED BY THE RUNTIME before anything
// can be published. Before this, nothing stopped it.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createAgentProcessFromEnvironment } from "./bootstrap";
import { AgentRuntime } from "./runtime";
import { InMemoryAgentTaskStore } from "./inMemoryTaskStore";
import { activationDetector, ACTIVATION_AGENT_ID, configuredAgentHandlers } from "./activationDetector";
import { createPilotAssessmentAgent, PILOT_ASSESSMENT_AGENT_ID } from "./pilotAssessmentAgent";
import { createPostgresAgentTaskStore } from "./prismaTaskDatabase";
import { publishesCandidates, type AgentHandler } from "./types";
import type { AgentPolicySnapshot, CandidateSignal } from "./types";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { SYNTHETIC_PROVENANCE, syntheticPilotCsv } from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../src/contract/pilotDataContract";
import { ADMISSION_CALC_VERSION } from "../../src/contract/pilotAdmissionPolicy";
import { ensureGovernedTerms, GOVERNED_TERMS_FIELDS } from "../test/governedTerms";

const HAS_DB = !!process.env.DATABASE_URL;
const uid = () => Math.random().toString(36).slice(2, 10);

const POLICY: AgentPolicySnapshot = {
  globalEnabled: true,
  disabledAgents: new Set<string>(),
  maxAttempts: 3,
  leaseMs: 30_000,
  retryDelayMs: () => 5,
};

/** Agents enabled, one boundary, and DELIBERATELY no NH_AGENT_ADMISSION_POLICIES. */
const NO_REGISTRY = Object.freeze({
  NH_AGENTS_ENABLED: "true",
  NH_AGENT_BOUNDARIES: "tenant-1",
});

const signal = (boundaryId: string): CandidateSignal =>
  Object.freeze({
    signalId: "SIG-1",
    boundaryId,
    recoveryType: "ActivationMissed",
    sourceRef: `hmac-sha256:${"a".repeat(64)}`,
    sourcePayloadHash: "b".repeat(64),
    detectorVersion: "smuggler-v1",
    observedAt: "2026-04-01T00:00:00.000Z",
    amountAtRiskMinor: 50_000,
    currency: "USD",
    actionAvailable: true,
    expectedProofEvent: "next invoice paid",
  });

describe("EP-17 · the declared publication capability", () => {
  it("treats an undeclared handler as candidate-capable — the requirement is escaped only deliberately", () => {
    expect(publishesCandidates({ agentId: "silent", run: async () => [] })).toBe(true);
    expect(publishesCandidates({ agentId: "yes", publishesCandidates: true, run: async () => [] })).toBe(true);
    expect(publishesCandidates({ agentId: "no", publishesCandidates: false, run: async () => [] })).toBe(false);
  });

  it("has the two production agents declare themselves, and declare opposite things", () => {
    expect(publishesCandidates(activationDetector())).toBe(true);
    expect(publishesCandidates(createPilotAssessmentAgent())).toBe(false);
  });

  it("registers the assessment agent from its own opt-in flag, with no other flag set", () => {
    const handlers = configuredAgentHandlers({ NH_PILOT_ASSESSMENT_AGENT_ENABLED: "true" });
    expect(handlers.map((h) => h.agentId)).toEqual([PILOT_ASSESSMENT_AGENT_ID]);
    expect(handlers.every((h) => !publishesCandidates(h))).toBe(true);
  });

  it.each(["yes", "TRUE", "1"])("refuses the ambiguous flag value %j rather than guessing", (raw) => {
    expect(() => configuredAgentHandlers({ NH_PILOT_ASSESSMENT_AGENT_ENABLED: raw })).toThrow(
      /NH_PILOT_ASSESSMENT_AGENT_ENABLED must be true or false/,
    );
  });
});

describe("EP-17 · the admission policy registry is required of exactly the agents it is about", () => {
  it("boots an assessment-only deployment with NO admission policy registry", () => {
    const process_ = createAgentProcessFromEnvironment(NO_REGISTRY, [createPilotAssessmentAgent()]);
    process_.start();
    expect(process_.readiness()).toEqual({ status: "up", configured: 1, running: 1 });
    return process_.stop();
  });

  it("still refuses a candidate-publishing agent without the registry, and names it", () => {
    expect(() => createAgentProcessFromEnvironment(NO_REGISTRY, [activationDetector()])).toThrow(
      new RegExp(`no candidate admission policies.*${ACTIVATION_AGENT_ID}`, "s"),
    );
  });

  it("still refuses a MIXED deployment without the registry — one publisher is enough", () => {
    expect(() =>
      createAgentProcessFromEnvironment(NO_REGISTRY, [createPilotAssessmentAgent(), activationDetector()]),
    ).toThrow(/no candidate admission policies/);
  });

  it("still refuses an UNDECLARED handler without the registry", () => {
    // The fail-closed default in action: a handler that says nothing is assumed to publish, so a new
    // detector cannot escape the registry requirement by forgetting to declare itself.
    expect(() =>
      createAgentProcessFromEnvironment(NO_REGISTRY, [{ agentId: "forgot-to-say", run: async () => [] }]),
    ).toThrow(/no candidate admission policies/);
  });

  it("accepts a publishing agent once the registry is configured", () => {
    const process_ = createAgentProcessFromEnvironment(
      { ...NO_REGISTRY, NH_AGENT_ADMISSION_POLICIES: "ActivationMissed:10000" },
      [activationDetector()],
    );
    process_.start();
    expect(process_.readiness().status).toBe("up");
    return process_.stop();
  });

  it("keeps every other startup guard intact", () => {
    expect(() => createAgentProcessFromEnvironment(NO_REGISTRY, [])).toThrow(/no production agent handlers/i);
    expect(() =>
      createAgentProcessFromEnvironment({ NH_AGENTS_ENABLED: "true" }, [createPilotAssessmentAgent()]),
    ).toThrow(/NH_AGENT_BOUNDARIES is required/);
  });
});

describe("EP-17 · an observation-only handler cannot publish, even if it tries", () => {
  const boundaryId = "tenant-1";

  /**
   * One runtime turn against an in-memory store.
   *
   * There is deliberately no publication-sink spy here: the sink is only ever reached from
   * `succeed()`, so "the task did not succeed and recorded no result" is the direct evidence that
   * nothing was published. A spy on a sink this store does not even have would assert nothing.
   */
  async function runOnce(handler: AgentHandler) {
    const store = new InMemoryAgentTaskStore();
    await store.enqueueIfAbsent({
      taskId: `T-${uid()}`,
      boundaryId,
      agentId: handler.agentId,
      idempotencyKey: `k-${uid()}`,
      payload: {},
      now: Date.now(),
    });
    const runtime = new AgentRuntime({
      store,
      policy: { current: () => POLICY },
      audit: { append: async () => {} },
      now: Date.now,
    });
    return { task: await runtime.runNext(handler, `w-${uid()}`, boundaryId) };
  }

  it("fails the task and publishes nothing when a declared observation-only agent emits a signal", async () => {
    const smuggler: AgentHandler = {
      agentId: "smuggler-v1",
      publishesCandidates: false,
      run: async () => [signal(boundaryId)],
    };
    const { task } = await runOnce(smuggler);

    expect(task?.status).not.toBe("succeeded");
    expect(task?.lastError).toMatch(/declared observation-only and must not emit CandidateSignals/);
    // The result is never recorded, so nothing downstream could read the smuggled signal.
    expect(task?.result).toBeNull();
  });

  it("lets the same signal through for a candidate-capable agent — the check is the declaration, not the payload", async () => {
    const publisher: AgentHandler = {
      agentId: "publisher-v1",
      publishesCandidates: true,
      run: async () => [signal(boundaryId)],
    };
    const { task } = await runOnce(publisher);
    expect(task?.status).toBe("succeeded");
    expect(task?.result).toHaveLength(1);
  });

  it("still lets an observation-only agent return nothing, which is its whole job", async () => {
    const observer: AgentHandler = {
      agentId: "observer-v1",
      publishesCandidates: false,
      run: async () => [],
    };
    const { task } = await runOnce(observer);
    expect(task?.status).toBe("succeeded");
    expect(task?.result).toEqual([]);
  });

  it("reports a malformed signal as malformed, not as a capability violation", async () => {
    // Ordering matters: the batch assertion runs first, so a broken signal from an observation-only
    // agent still names the real defect rather than being masked by the capability message.
    const broken: AgentHandler = {
      agentId: "broken-v1",
      publishesCandidates: false,
      run: async () => [{ ...signal(boundaryId), amountAtRiskMinor: -1 } as CandidateSignal],
    };
    const { task } = await runOnce(broken);
    expect(task?.lastError).toMatch(/amountAtRiskMinor must be a non-negative safe integer/);
  });
});

describe.skipIf(!HAS_DB)("EP-17 · a full assessment-only run with no fabricated thresholds", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("schedules, runs and records an observation with no admission policy registry anywhere", async () => {
    const boundaryId = `pb-${uid()}`;
    const OPERATOR = { "x-actor-id": "op@company", "x-actor-role": "operator" };
    const STEWARD = { "x-actor-id": "gov@company", "x-actor-role": "steward" };
    const policy = {
      policyId: `pol-${uid()}`,
      policyVersion: "1.0.0",
      calculationMethodVersion: ADMISSION_CALC_VERSION,
      minAcceptedRows: 10,
      minDistinctEntities: 5,
      maxRejectionRate: 0.2,
      maxSingleReasonShare: 0.9,
      maxDuplicateRate: 0.05,
      minCoverageDays: 10,
      requiredLifecycleStates: ["stalled", "reference"],
      maxOrderingDefectRate: 0.05,
      maxMissingRecommendedColumns: 2,
      requireProvenanceDeclaration: true,
    };
    await app.inject({
      method: "POST", url: "/pilot/admission-policies", headers: OPERATOR,
      payload: { boundaryId, policy, rationale: "pilot design agreed with finance" },
    });
    await app.inject({
      method: "POST", url: "/pilot/admission-policies/activate", headers: STEWARD,
      payload: { boundaryId, policyId: policy.policyId, policyVersion: "1.0.0", rationale: "reviewed" },
    });
    // EP-26 · Governed analysis terms first: nothing is measured under a definition nobody approved.
    await ensureGovernedTerms(boundaryId);
    const base = {
      boundaryId,
      datasetId: `ds-${uid()}`,
      declaredVersion: PILOT_DATA_CONTRACT_VERSION,
      csvText: syntheticPilotCsv(40),
      policy: { currency: "USD" },
      // EP-26 · The cut-off and the stall threshold are governed, not request fields. The suite
      // activates them for this boundary through the two-identity lifecycle before submitting.
      ...GOVERNED_TERMS_FIELDS,
      provenance: SYNTHETIC_PROVENANCE,
    };
    await app.inject({
      method: "POST", url: "/pilot/datasets", headers: OPERATOR,
      payload: { ...base, admissionPolicyId: policy.policyId },
    });
    const out = (await app.inject({
      method: "POST", url: "/pilot/assessments", headers: OPERATOR, payload: base,
    })).json();
    expect(out.scheduled).toBe(true);

    // NO success sink at all — exactly what bootstrap now constructs for an assessment-only
    // deployment. There is no publication code path to reach, not merely an unused one.
    const runtime = new AgentRuntime({
      store: createPostgresAgentTaskStore(undefined, undefined),
      policy: { current: () => POLICY },
      audit: { append: async () => {} },
      now: Date.now,
    });
    const task = await runtime.runNext(createPilotAssessmentAgent(), `w-${uid()}`, boundaryId);
    expect(task?.status).toBe("succeeded");
    expect(task?.result).toEqual([]);

    const view = (await app.inject({
      method: "GET", url: `/pilot/assessments/${out.executionId}?boundaryId=${boundaryId}`, headers: OPERATOR,
    })).json();
    expect(view.state).toBe("completed");
    expect(view.finding.finding.acceptedCycleCount).toBe(40);

    // And nothing candidate-shaped exists for this tenant.
    expect(await prisma.agentCaseCandidateRecord.count({ where: { boundaryId } })).toBe(0);
    expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId } })).toBe(0);
  });
});
