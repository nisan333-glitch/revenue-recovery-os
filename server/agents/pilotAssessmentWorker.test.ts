// EP-16 · The execution queue — real PostgreSQL, the production task store, the production runtime.
//
// These tests are about what happens when the world is not tidy: the same work scheduled twice, two
// workers reaching for one task, a worker that dies holding a lease, a retry that arrives after the
// answer was already written. The task store already proves those properties for tasks in general
// (postgresTaskStore.test.ts); what is proved here is that an ASSESSMENT EXECUTION inherits them —
// that no sequence of duplicates, races or retries produces two findings, a second run of the same
// work, or a finding built from a row the contract rejected.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { SYNTHETIC_PROVENANCE, syntheticPilotCsv } from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../src/contract/pilotDataContract";
import { ADMISSION_CALC_VERSION } from "../../src/contract/pilotAdmissionPolicy";
import { AgentRuntime } from "./runtime";
import { createPilotAssessmentAgent, PILOT_ASSESSMENT_AGENT_ID } from "./pilotAssessmentAgent";
import { createPostgresAgentTaskStore } from "./prismaTaskDatabase";
import type { AgentPolicySnapshot } from "./types";

const HAS_DB = !!process.env.DATABASE_URL;
const OPERATOR = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
const STEWARD = { "x-actor-id": "gov@company", "x-actor-role": "steward" };
const uid = () => Math.random().toString(36).slice(2, 10);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const POLICY: AgentPolicySnapshot = {
  globalEnabled: true,
  disabledAgents: new Set<string>(),
  maxAttempts: 3,
  leaseMs: 30_000,
  retryDelayMs: () => 5,
};

describe.skipIf(!HAS_DB)("EP-16 · assessment execution under duplication, concurrency and retry", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  const taskStore = createPostgresAgentTaskStore();
  const agent = createPilotAssessmentAgent();

  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function runtime(policy: AgentPolicySnapshot = POLICY) {
    return new AgentRuntime({
      store: taskStore,
      policy: { current: () => policy },
      audit: { append: async () => {} },
      now: Date.now,
    });
  }

  /**
   * The full governed lead-up, then a schedule. `csvText` and the admission thresholds are
   * parameterised so one helper serves both the clean dataset and the one with a rejected row.
   */
  async function scheduled(over: { csvText?: string; policyOver?: Record<string, unknown> } = {}) {
    const boundaryId = `pb-${uid()}`;
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
      ...(over.policyOver ?? {}),
    };
    expect(
      (await app.inject({
        method: "POST", url: "/pilot/admission-policies", headers: OPERATOR,
        payload: { boundaryId, policy, rationale: "pilot design agreed with finance" },
      })).statusCode,
    ).toBe(201);
    expect(
      (await app.inject({
        method: "POST", url: "/pilot/admission-policies/activate", headers: STEWARD,
        payload: { boundaryId, policyId: policy.policyId, policyVersion: "1.0.0", rationale: "reviewed" },
      })).statusCode,
    ).toBe(200);

    const base = {
      boundaryId,
      datasetId: `ds-${uid()}`,
      declaredVersion: PILOT_DATA_CONTRACT_VERSION,
      csvText: over.csvText ?? syntheticPilotCsv(40),
      policy: { stallThresholdDays: 30, asOf: "2026-04-15", currency: "USD" },
      provenance: SYNTHETIC_PROVENANCE,
    };
    const submitted = (await app.inject({
      method: "POST", url: "/pilot/datasets", headers: OPERATOR,
      payload: { ...base, admissionPolicyId: policy.policyId },
    })).json();
    expect(submitted.admission.outcome).toBe("ADMISSIBLE");

    const scheduleOne = () =>
      app.inject({ method: "POST", url: "/pilot/assessments", headers: OPERATOR, payload: base });
    const first = await scheduleOne();
    expect(first.statusCode).toBe(201);
    return { boundaryId, base, submitted, scheduleOne, out: first.json() };
  }

  // ── 5 · Duplicate scheduling and retry idempotency ──────────────────────────────────────────────

  it("5a · scheduling the same binding twice yields one execution, one task and one queued run", async () => {
    const { boundaryId, scheduleOne, out } = await scheduled();

    const again = await scheduleOne();
    expect(again.statusCode).toBe(200); // 200, not 201: nothing new was created
    expect(again.json().executionId).toBe(out.executionId);
    expect(again.json().created).toBe(false);
    expect(again.json().scheduled).toBe(true);

    expect(await prisma.pilotAssessmentExecutionRecord.count({ where: { boundaryId } })).toBe(1);
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { boundaryId } })).toBe(1);
    expect(await prisma.agentTaskRecord.count({ where: { boundaryId, agentId: PILOT_ASSESSMENT_AGENT_ID } })).toBe(1);
    // One SCHEDULED event, not two: a repeat is recognised, not re-recorded as a new scheduling.
    expect(
      await prisma.pilotAssessmentExecutionEventRecord.count({
        where: { boundaryId, transition: "SCHEDULED" },
      }),
    ).toBe(1);

    // And it still runs exactly once.
    expect((await runtime().runNext(agent, `w-${uid()}`, boundaryId))?.status).toBe("succeeded");
    expect(await runtime().runNext(agent, `w-${uid()}`, boundaryId)).toBeNull();
    expect(await prisma.pilotAssessmentFindingRecord.count({ where: { boundaryId } })).toBe(1);
  });

  it("5b · ten concurrent schedules of one binding still produce exactly one execution", async () => {
    const { boundaryId, scheduleOne, out } = await scheduled();
    const results = await Promise.all(Array.from({ length: 10 }, scheduleOne));
    for (const res of results) {
      expect(res.statusCode).toBe(200);
      expect(res.json().executionId).toBe(out.executionId);
    }
    expect(await prisma.pilotAssessmentExecutionRecord.count({ where: { boundaryId } })).toBe(1);
    expect(await prisma.agentTaskRecord.count({ where: { boundaryId, agentId: PILOT_ASSESSMENT_AGENT_ID } })).toBe(1);
  });

  it("5c · re-running a completed execution re-derives the identical finding and writes nothing new", async () => {
    const { boundaryId, out } = await scheduled();
    expect((await runtime().runNext(agent, `w-${uid()}`, boundaryId))?.status).toBe("succeeded");

    const first = await prisma.pilotAssessmentFindingRecord.findFirstOrThrow({
      where: { executionId: out.executionId },
    });

    // Simulate the ambiguous case a fenced lease is designed for: the finding committed, but the
    // worker never learned that it had. A retry must recognise its own answer rather than write a
    // second one — which it can, because the finding is a function of the binding and the input.
    const replayed = await agent.run(
      { executionId: out.executionId },
      { taskId: `TASK-${out.executionId}`, boundaryId, attempt: 2 },
    );
    expect(replayed).toEqual([]);

    const after = await prisma.pilotAssessmentFindingRecord.findMany({
      where: { executionId: out.executionId },
    });
    expect(after).toHaveLength(1);
    expect(after[0]!.findingHash).toBe(first.findingHash);
    expect(after[0]!.recordedAt.toISOString()).toBe(first.recordedAt.toISOString());

    const view = (await app.inject({
      method: "GET", url: `/pilot/assessments/${out.executionId}?boundaryId=${boundaryId}`, headers: OPERATOR,
    })).json();
    expect(view.state).toBe("completed");
  });

  // ── 6 · Concurrent worker claim ─────────────────────────────────────────────────────────────────

  it("6 · four workers racing for one execution: exactly one claims it, one finding results", async () => {
    const { boundaryId, out } = await scheduled();

    const settled = await Promise.all(
      Array.from({ length: 4 }, (_, i) => runtime().runNext(agent, `race-${i}-${uid()}`, boundaryId)),
    );
    const claimed = settled.filter((task) => task !== null);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.status).toBe("succeeded");

    expect(await prisma.pilotAssessmentFindingRecord.count({ where: { executionId: out.executionId } })).toBe(1);
    // One claim in the execution's own log too — the losers never touched it.
    expect(
      await prisma.pilotAssessmentExecutionEventRecord.count({
        where: { executionId: out.executionId, transition: "CLAIMED" },
      }),
    ).toBe(1);
  });

  // ── 7 · Expired lease recovery ──────────────────────────────────────────────────────────────────

  // The two halves are separate executions on purpose. Asserting "nobody may take a LIVE lease" and
  // "an EXPIRED lease is reclaimable" against one short-lived lease makes the first assertion a race
  // against the clock it is trying to observe — it would pass alone and fail under load, which is
  // the worst kind of test. Each half below holds the lease it needs and nothing depends on timing
  // in the direction that could fail.

  it("7a · a live lease excludes every other worker", async () => {
    const { boundaryId, out } = await scheduled();

    const holder = await taskStore.claimDue({
      boundaryId, agentId: PILOT_ASSESSMENT_AGENT_ID, workerId: `holder-${uid()}`,
      now: Date.now(), leaseMs: 300_000, maxAttempts: 3,
    });
    expect(holder?.attempt).toBe(1);

    for (let i = 0; i < 3; i += 1) {
      expect(
        await taskStore.claimDue({
          boundaryId, agentId: PILOT_ASSESSMENT_AGENT_ID, workerId: `blocked-${i}-${uid()}`,
          now: Date.now(), leaseMs: 30_000, maxAttempts: 3,
        }),
      ).toBeNull();
    }
    expect(await runtime().runNext(agent, `blocked-runtime-${uid()}`, boundaryId)).toBeNull();

    const view = (await app.inject({
      method: "GET", url: `/pilot/assessments/${out.executionId}?boundaryId=${boundaryId}`, headers: OPERATOR,
    })).json();
    expect(view.state).toBe("queued"); // claimed at the task level, not yet started by the agent
    expect(await prisma.pilotAssessmentFindingRecord.count({ where: { executionId: out.executionId } })).toBe(0);
  });

  it("7b · a worker that dies holding a lease does not strand the execution", async () => {
    const { boundaryId, out } = await scheduled();

    // Worker A claims with a lease measured in milliseconds and then "dies": it never succeeds,
    // never fails, never releases. The task is left leased with nobody running it.
    const abandoned = await taskStore.claimDue({
      boundaryId,
      agentId: PILOT_ASSESSMENT_AGENT_ID,
      workerId: `dead-${uid()}`,
      now: Date.now(),
      leaseMs: 5,
      maxAttempts: 3,
    });
    expect(abandoned?.attempt).toBe(1);

    await wait(50); // the database clock, not the worker's, decides the lease is over

    const recovered = await runtime().runNext(agent, `recovered-${uid()}`, boundaryId);
    expect(recovered?.status).toBe("succeeded");
    expect(recovered?.attempt).toBe(2);
    expect(recovered?.fencingEpoch).toBeGreaterThan(abandoned!.fencingEpoch);

    const view = (await app.inject({
      method: "GET", url: `/pilot/assessments/${out.executionId}?boundaryId=${boundaryId}`, headers: OPERATOR,
    })).json();
    expect(view.state).toBe("completed");
    // Recovery produced ONE finding, not a second copy from the abandoned attempt.
    expect(await prisma.pilotAssessmentFindingRecord.count({ where: { executionId: out.executionId } })).toBe(1);
  });

  // ── 4 · Rejected rows never reach an agent ──────────────────────────────────────────────────────

  it("4 · a rejected row reaches neither the execution input, the agent payload, nor the finding", async () => {
    const marker = `REJECTEDMARKER${uid()}`;
    // One row the contract rejects (an unparseable signature date), carrying a value that exists
    // nowhere else in the file. If it appears downstream, a rejected row influenced the run.
    const rejectedRow = [
      marker, `SUB-${marker}`, "not-a-date", "", "2026-02-01", "100.00", "USD",
      "", "", "false", "", "", "synthetic-starter", "synthetic-smb",
    ].join(",");

    const { boundaryId, out, submitted } = await scheduled({
      csvText: `${syntheticPilotCsv(40)}\n${rejectedRow}`,
      // A single rejected row is 100% of one reason, so the share bar must admit that — the dataset
      // is still well within the rejection RATE, which is the threshold that matters here.
      policyOver: { maxSingleReasonShare: 1 },
    });

    expect(submitted.counts.rejectedRows).toBe(1);
    expect(submitted.counts.acceptedRows).toBe(40);

    // The stored input holds only the accepted cycles.
    const input = await prisma.pilotAssessmentExecutionInputRecord.findFirstOrThrow({
      where: { executionId: out.executionId },
    });
    expect(input.cycleCount).toBe(40);
    expect(JSON.stringify(input.cycles)).not.toContain(marker);

    // The agent's entire context is one execution id — no customer-derived value at all.
    const task = await prisma.agentTaskRecord.findFirstOrThrow({
      where: { boundaryId, agentId: PILOT_ASSESSMENT_AGENT_ID },
    });
    expect(task.payload).toEqual({ executionId: out.executionId });

    expect((await runtime().runNext(agent, `w-${uid()}`, boundaryId))?.status).toBe("succeeded");

    const finding = await prisma.pilotAssessmentFindingRecord.findFirstOrThrow({
      where: { executionId: out.executionId },
    });
    expect(JSON.stringify(finding.finding)).not.toContain(marker);
    expect((finding.finding as { acceptedCycleCount: number }).acceptedCycleCount).toBe(40);

    // Nor does the rejected row's content survive anywhere else in this boundary's records.
    const submission = await prisma.pilotDatasetSubmissionRecord.findFirstOrThrow({ where: { boundaryId } });
    expect(JSON.stringify(submission)).not.toContain(marker);
    const events = await prisma.pilotAssessmentExecutionEventRecord.findMany({ where: { boundaryId } });
    expect(JSON.stringify(events)).not.toContain(marker);
  });

  it("4b · no customer identifier from an ACCEPTED row survives into the execution input either", async () => {
    const { boundaryId, out } = await scheduled();
    const input = await prisma.pilotAssessmentExecutionInputRecord.findFirstOrThrow({
      where: { executionId: out.executionId },
    });
    const serialized = JSON.stringify(input.cycles);

    // The synthetic generator's identifiers are the only ones that could be here. They are not:
    // the projection replaces them with first-appearance ordinals before anything is stored.
    expect(serialized).not.toMatch(/synthetic-entity/);
    expect(serialized).not.toMatch(/synthetic-sub/);
    expect(serialized).toContain('"e-0001"');
    expect(serialized).toContain('"c-0001"');
    expect(boundaryId).toMatch(/^pb-/);
  });

  // ── The kill switch still governs this agent, like every other ──────────────────────────────────

  it("respects the global agent kill switch — a disabled runtime claims nothing", async () => {
    const { boundaryId, out } = await scheduled();
    const off = await runtime({ ...POLICY, globalEnabled: false }).runNext(agent, `w-${uid()}`, boundaryId);
    expect(off).toBeNull();

    const view = (await app.inject({
      method: "GET", url: `/pilot/assessments/${out.executionId}?boundaryId=${boundaryId}`, headers: OPERATOR,
    })).json();
    expect(view.state).toBe("queued");
    expect(await prisma.pilotAssessmentFindingRecord.count({ where: { boundaryId } })).toBe(0);
  });
});
