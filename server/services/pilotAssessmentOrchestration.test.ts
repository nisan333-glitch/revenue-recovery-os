// EP-16 · Pilot assessment orchestration — server integration, real HTTP + real PostgreSQL.
//
// The question these tests answer is not "does scheduling work" but "can a run happen that nobody
// authorised". Each case below is an attempt to reach an assessment finding by a route that should
// not lead there: an unadmitted dataset, a bar that governance has since frozen, another tenant's
// execution, a halted case, a record altered after it was written.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { SYNTHETIC_PROVENANCE, syntheticPilotCsv } from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../src/contract/pilotDataContract";
import { ADMISSION_CALC_VERSION } from "../../src/contract/pilotAdmissionPolicy";
import { deriveAdmissionDecisionId } from "../../src/contract/assessmentExecution";
import { AgentRuntime } from "../agents/runtime";
import { createPilotAssessmentAgent, PILOT_ASSESSMENT_AGENT_ID } from "../agents/pilotAssessmentAgent";
import { createPostgresAgentTaskStore } from "../agents/prismaTaskDatabase";
import type { AgentPolicySnapshot } from "../agents/types";
import { ensureGovernedTerms, GOVERNED_TERMS_FIELDS } from "../test/governedTerms";

const HAS_DB = !!process.env.DATABASE_URL;
const OPERATOR = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
const AUTHOR = { "x-actor-id": "pilot-author@company", "x-actor-role": "author" };
const STEWARD = { "x-actor-id": "gov@company", "x-actor-role": "steward" };
const uid = () => Math.random().toString(36).slice(2, 10);

const snapshot = (over: Partial<AgentPolicySnapshot> = {}): AgentPolicySnapshot => ({
  globalEnabled: true,
  disabledAgents: new Set<string>(),
  maxAttempts: 3,
  leaseMs: 30_000,
  retryDelayMs: () => 5,
  ...over,
});

function policyBody(over: Record<string, unknown> = {}) {
  return {
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
    ...over,
  };
}

function datasetBody(over: Record<string, unknown> = {}) {
  return {
    boundaryId: `pb-${uid()}`,
    datasetId: `ds-${uid()}`,
    declaredVersion: PILOT_DATA_CONTRACT_VERSION,
    csvText: syntheticPilotCsv(40),
    policy: { currency: "USD" },
      // EP-26 · The cut-off and the stall threshold are governed, not request fields. The suite
      // activates them for this boundary through the two-identity lifecycle before submitting.
      ...GOVERNED_TERMS_FIELDS,
    provenance: SYNTHETIC_PROVENANCE,
    ...over,
  };
}

describe.skipIf(!HAS_DB)("EP-16 · pilot assessment orchestration", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  const taskStore = createPostgresAgentTaskStore();

  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const propose = (boundaryId: string, policy: Record<string, unknown>, headers = OPERATOR) =>
    app.inject({
      method: "POST", url: "/pilot/admission-policies", headers,
      payload: { boundaryId, policy, rationale: "pilot design agreed with finance" } as object,
    });

  const move = (path: string, boundaryId: string, policyId: string, headers = STEWARD, policyVersion = "1.0.0") =>
    app.inject({
      method: "POST", url: `/pilot/admission-policies/${path}`, headers,
      payload: { boundaryId, policyId, policyVersion, rationale: "reviewed" } as object,
    });

  // EP-26 · Both entry points resolve the analysis terms from the register, so both need them active.
  const submit = async (payload: unknown, headers = OPERATOR) => {
      const boundaryId = (payload as { boundaryId?: string }).boundaryId;
      if (boundaryId) await ensureGovernedTerms(boundaryId);
    return app.inject({ method: "POST", url: "/pilot/datasets", headers, payload: payload as object });
  };

  /**
   * The schedule body deliberately carries NO admission policy id or version: the bar is read from
   * the decision that admitted the dataset, so a caller cannot ask to be executed under a different
   * bar than the one that judged them. Stripping them here is what the real client must also do —
   * `additionalProperties: false` turns an attempt to send them into a 400.
   */
  const scheduleBody = (body: Record<string, unknown>, over: Record<string, unknown> = {}) => {
    const { admissionPolicyId: _p, admissionPolicyVersion: _v, ...rest } = body;
    return { ...rest, ...over };
  };

  const schedule = async (payload: unknown, headers = OPERATOR) => {
      const boundaryId = (payload as { boundaryId?: string }).boundaryId;
      if (boundaryId) await ensureGovernedTerms(boundaryId);
    return app.inject({ method: "POST", url: "/pilot/assessments", headers, payload: payload as object });
  };

  const read = (boundaryId: string, executionId: string, headers = OPERATOR) =>
    app.inject({
      method: "GET",
      url: `/pilot/assessments/${executionId}?boundaryId=${encodeURIComponent(boundaryId)}`,
      headers,
    });

  /** One full worker turn for a boundary: claim, run, complete. Returns the task it settled. */
  async function runWorker(boundaryId: string, workerId = `w-${uid()}`, policy = snapshot()) {
    const runtime = new AgentRuntime({
      store: taskStore,
      policy: { current: () => policy },
      audit: { append: async () => {} },
      now: Date.now,
    });
    return runtime.runNext(createPilotAssessmentAgent(), workerId, boundaryId);
  }

  /** Propose + activate by two different actors, then submit — the whole governed lead-up. */
  async function admitted(over: Record<string, unknown> = {}, policyOver: Record<string, unknown> = {}) {
    const boundaryId = `pb-${uid()}`;
    const policy = policyBody(policyOver);
    expect((await propose(boundaryId, policy)).statusCode).toBe(201);
    expect((await move("activate", boundaryId, policy.policyId as string)).statusCode).toBe(200);
    const body = datasetBody({ boundaryId, admissionPolicyId: policy.policyId, ...over });
    const submitted = (await submit(body)).json();
    expect(submitted.admission.outcome).toBe("ADMISSIBLE");
    return { boundaryId, policy, body, submitted };
  }

  // ── 3 · The happy path ──────────────────────────────────────────────────────────────────────────

  it("3 · executes a valid admitted synthetic dataset and records one observation", async () => {
    const { boundaryId, body } = await admitted();

    const scheduled = await schedule(scheduleBody(body));
    expect(scheduled.statusCode).toBe(201);
    const out = scheduled.json();
    expect(out.scheduled).toBe(true);
    expect(out.created).toBe(true);
    expect(out.state).toBe("queued");
    expect(out.executionId).toMatch(/^PAX-[a-f0-9]{32}$/);
    expect(out.refusal).toBeNull();

    const task = await runWorker(boundaryId);
    expect(task?.status).toBe("succeeded");

    const view = (await read(boundaryId, out.executionId)).json();
    expect(view.state).toBe("completed");
    expect(view.code).toBeNull();
    expect(view.finding).not.toBeNull();
    expect(view.finding.finding.acceptedCycleCount).toBeGreaterThan(0);
    expect(view.finding.finding.claimBoundary).toEqual({
      observationOnly: true,
      constitutesProof: false,
      constitutesRevenue: false,
      createsRecoveryCase: false,
    });
    expect(view.finding.findingHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  // ── 1 · Admission is a precondition, not a formality ────────────────────────────────────────────

  it("1a · refuses a dataset that was never submitted — NH-AX-1001", async () => {
    const boundaryId = `pb-${uid()}`;
    const out = (await schedule(scheduleBody(datasetBody({ boundaryId })))).json();
    expect(out.scheduled).toBe(false);
    expect(out.executionId).toBeNull();
    expect(out.refusal.code).toBe("NH-AX-1001");
    expect(await prisma.pilotAssessmentExecutionRecord.count({ where: { boundaryId } })).toBe(0);
  });

  it("1b · refuses a dataset whose admission was NOT_ADMISSIBLE — NH-AX-1003", async () => {
    const boundaryId = `pb-${uid()}`;
    // A bar no 40-row synthetic dataset can clear. The dataset is perfectly valid; it is not FIT.
    const policy = policyBody({ minAcceptedRows: 10_000 });
    expect((await propose(boundaryId, policy)).statusCode).toBe(201);
    expect((await move("activate", boundaryId, policy.policyId)).statusCode).toBe(200);
    const body = datasetBody({ boundaryId, admissionPolicyId: policy.policyId });
    expect((await submit(body)).json().admission.outcome).toBe("NOT_ADMISSIBLE");

    const out = (await schedule(scheduleBody(body))).json();
    expect(out.scheduled).toBe(false);
    expect(out.refusal.code).toBe("NH-AX-1003");
    expect(await prisma.pilotAssessmentExecutionRecord.count({ where: { boundaryId } })).toBe(0);
  });

  it("1c · refuses bytes that differ from the admitted dataset — NH-AX-1001", async () => {
    const { boundaryId, body } = await admitted();
    // One extra row is a different dataset. It therefore has no admission decision of its own, which
    // is the first thing that fails — the fingerprint is baked into the lookup key.
    const out = (await schedule(scheduleBody(body, { csvText: `${body.csvText as string}\n` }))).json();
    expect(out.scheduled).toBe(false);
    expect(out.refusal.code).toBe("NH-AX-1001");
    expect(await prisma.pilotAssessmentExecutionRecord.count({ where: { boundaryId } })).toBe(0);
  });

  // ── 2 · DRAFT, FROZEN and RETIRED all block ─────────────────────────────────────────────────────

  it("2a · a DRAFT policy blocks, because a draft bar can never admit a dataset in the first place", async () => {
    const boundaryId = `pb-${uid()}`;
    const policy = policyBody();
    expect((await propose(boundaryId, policy)).statusCode).toBe(201); // proposed, never activated
    const body = datasetBody({ boundaryId, admissionPolicyId: policy.policyId });
    const submitted = (await submit(body)).json();
    expect(submitted.admissionPolicyState).toBe("DRAFT");
    expect(submitted.admission.outcome).toBe("NOT_ASSESSABLE");

    const out = (await schedule(scheduleBody(body))).json();
    expect(out.scheduled).toBe(false);
    expect(out.refusal.code).toBe("NH-AX-1003");
  });

  it.each(["freeze", "retire"] as const)(
    "2b · a %sd policy blocks a NEW schedule even though the dataset was admitted — NH-AX-1007",
    async (transition) => {
      const { boundaryId, policy, body } = await admitted();
      expect((await move(transition, boundaryId, policy.policyId as string)).statusCode).toBe(200);

      const out = (await schedule(scheduleBody(body))).json();
      expect(out.scheduled).toBe(false);
      expect(out.refusal.code).toBe("NH-AX-1007");
      expect(out.admissionPolicyState).toBe(transition === "freeze" ? "FROZEN" : "RETIRED");
      expect(await prisma.pilotAssessmentExecutionRecord.count({ where: { boundaryId } })).toBe(0);
    },
  );

  it("2c · freezing AFTER scheduling blocks the queued execution when the worker reaches it", async () => {
    const { boundaryId, policy, body } = await admitted();
    const out = (await schedule(scheduleBody(body))).json();
    expect(out.state).toBe("queued");

    // The governance decision lands between schedule and run. If a queued execution sailed past it,
    // freezing would only ever affect work nobody had started — which is not a pause at all.
    expect((await move("freeze", boundaryId, policy.policyId as string)).statusCode).toBe(200);

    const task = await runWorker(boundaryId);
    expect(task?.status).toBe("succeeded"); // the task did its job: it produced a refusal

    const view = (await read(boundaryId, out.executionId)).json();
    expect(view.state).toBe("blocked");
    expect(view.code).toBe("NH-AX-1007");
    expect(view.finding).toBeNull();
    expect(await prisma.pilotAssessmentFindingRecord.count({ where: { boundaryId } })).toBe(0);
  });

  it("2d · a blocked execution is terminal — a later unfreeze does not resurrect it", async () => {
    const { boundaryId, policy, body } = await admitted();
    const out = (await schedule(scheduleBody(body))).json();
    expect((await move("freeze", boundaryId, policy.policyId as string)).statusCode).toBe(200);
    await runWorker(boundaryId);
    expect((await read(boundaryId, out.executionId)).json().state).toBe("blocked");

    expect((await move("unfreeze", boundaryId, policy.policyId as string)).statusCode).toBe(200);
    // The task already succeeded, so there is nothing to claim; and even if an event arrived, the
    // lifecycle refuses to move out of a terminal state.
    expect(await runWorker(boundaryId)).toBeNull();
    const view = (await read(boundaryId, out.executionId)).json();
    expect(view.state).toBe("blocked");
    expect(view.finding).toBeNull();
  });

  // ── 9 · Case Halt ───────────────────────────────────────────────────────────────────────────────

  it("9 · a halt on the linked case during execution blocks it and writes no finding — NH-AX-2001", async () => {
    const { boundaryId, body } = await admitted();
    const recoveryCaseId = `RC-${uid()}`;
    const out = (await schedule(scheduleBody(body, { recoveryCaseId }))).json();
    expect(out.scheduled).toBe(true);
    expect(out.binding.recoveryCaseId).toBe(recoveryCaseId);

    const halted = await app.inject({ method: "POST", url: `/cases/${recoveryCaseId}/halt`, headers: STEWARD });
    expect(halted.statusCode).toBe(201);

    await runWorker(boundaryId);
    const view = (await read(boundaryId, out.executionId)).json();
    expect(view.state).toBe("blocked");
    expect(view.code).toBe("NH-AX-2001");
    expect(view.finding).toBeNull();
  });

  it("9b · an execution with no linked case is unaffected by an unrelated case being halted", async () => {
    const { boundaryId, body } = await admitted();
    const unrelated = `RC-${uid()}`;
    expect((await app.inject({ method: "POST", url: `/cases/${unrelated}/halt`, headers: STEWARD })).statusCode).toBe(201);

    const out = (await schedule(scheduleBody(body))).json();
    await runWorker(boundaryId);
    expect((await read(boundaryId, out.executionId)).json().state).toBe("completed");
  });

  // ── 8 · Tenancy ─────────────────────────────────────────────────────────────────────────────────

  it("8a · refuses to schedule for a boundary the authenticated actor does not hold", async () => {
    const scopedApp = buildApp({
      sourceVerifier: fixtureVerifier,
      identityResolver: async () => ({ actorId: "op-2", role: "operator", boundaryIds: ["tenant-2"] }),
    });
    await scopedApp.ready();
    try {
      const res = await scopedApp.inject({
        method: "POST", url: "/pilot/assessments", headers: OPERATOR,
        payload: scheduleBody(datasetBody({ boundaryId: "tenant-1" })) as object,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: "forbidden" });
      // Refused before any validation ran, so nothing about tenant-1 was even read.
      expect(await prisma.pilotAssessmentExecutionRecord.count({ where: { boundaryId: "tenant-1" } })).toBe(0);
    } finally {
      await scopedApp.close();
    }
  });

  it("8b · an execution read with another tenant's boundary is not found, never disclosed", async () => {
    const { boundaryId, body } = await admitted();
    const out = (await schedule(scheduleBody(body))).json();
    const other = `pb-${uid()}`;
    const res = await read(other, out.executionId);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(boundaryId);
  });

  it("8c · a worker running for another boundary never claims this boundary's execution", async () => {
    const { boundaryId, body } = await admitted();
    const out = (await schedule(scheduleBody(body))).json();

    // The task store scopes every claim by boundary, so a worker for a different tenant sees nothing.
    expect(await runWorker(`pb-${uid()}`)).toBeNull();
    expect((await read(boundaryId, out.executionId)).json().state).toBe("queued");

    // And the rightful worker still gets it.
    await runWorker(boundaryId);
    expect((await read(boundaryId, out.executionId)).json().state).toBe("completed");
  });

  it("8d · an execution id from one tenant cannot be replayed into another tenant's queue", async () => {
    const a = await admitted();
    const b = await admitted();
    const scheduledA = (await schedule(scheduleBody(a.body))).json();

    // Hand tenant B's worker a task that names tenant A's execution. The agent loads the execution
    // unscoped precisely so it can NOTICE the disagreement rather than assume the boundary it was
    // told; it refuses rather than producing a finding in the wrong tenant's ledger.
    await taskStore.enqueueIfAbsent({
      taskId: `TASK-replay-${uid()}`,
      boundaryId: b.boundaryId,
      agentId: PILOT_ASSESSMENT_AGENT_ID,
      idempotencyKey: `replay-${uid()}`,
      payload: { executionId: scheduledA.executionId },
      now: Date.now(),
    });
    const task = await runWorker(b.boundaryId);
    expect(task?.status).not.toBe("succeeded");
    expect(task?.lastError).toMatch(/outside the worker boundary/i);

    // Nothing was written into either tenant's execution log by the replay.
    expect(await prisma.pilotAssessmentFindingRecord.count({ where: { boundaryId: b.boundaryId } })).toBe(0);
    expect(
      await prisma.pilotAssessmentExecutionEventRecord.count({
        where: { executionId: scheduledA.executionId, boundaryId: b.boundaryId },
      }),
    ).toBe(0);
  });

  // ── 10 · Immutability of the binding ────────────────────────────────────────────────────────────

  it("10a · the execution, its input, its events and its finding all reject UPDATE and DELETE", async () => {
    const { boundaryId, body } = await admitted();
    const out = (await schedule(scheduleBody(body))).json();
    await runWorker(boundaryId);

    const id = out.executionId as string;
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE pilot_assessment_executions SET dataset_fingerprint = 'x' WHERE execution_id = $1`, id),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE pilot_assessment_execution_inputs SET cycle_count = 1 WHERE execution_id = $1`, id),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE pilot_assessment_findings SET finding_hash = 'sha256:0' WHERE execution_id = $1`, id),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM pilot_assessment_execution_events WHERE execution_id = $1`, id),
    ).rejects.toThrow();
  });

  it("10b · a different policy version is a different execution, never a re-grade of the first", async () => {
    const { boundaryId, policy, body } = await admitted();
    const first = (await schedule(scheduleBody(body))).json();
    await runWorker(boundaryId);

    // Supersede the bar: a new version, proposed and activated by the governed two-actor path.
    const v2 = policyBody({ policyId: policy.policyId, policyVersion: "2.0.0" });
    expect((await propose(boundaryId, v2)).statusCode).toBe(201);
    expect((await move("activate", boundaryId, v2.policyId as string, STEWARD, "2.0.0")).statusCode).toBe(200);
    // A FRESH dataset. Re-using the same bytes would (correctly) hit the anti-tuning rule: v2 was
    // activated after those bytes were first seen, so it may not judge them.
    const bodyV2 = {
      ...body, datasetId: `ds-${uid()}`, csvText: syntheticPilotCsv(41), admissionPolicyVersion: "2.0.0",
    };
    expect((await submit(bodyV2)).json().admission.outcome).toBe("ADMISSIBLE");

    const second = (await schedule(scheduleBody(bodyV2))).json();
    expect(second.executionId).not.toBe(first.executionId);
    // The first execution's stamped bar is untouched by the existence of the second.
    const view = (await read(boundaryId, first.executionId)).json();
    expect(view.binding.admissionPolicyVersion).toBe("1.0.0");
    expect(view.state).toBe("completed");
  });

  it("10c · retiring the policy afterwards never alters a completed execution or its finding", async () => {
    const { boundaryId, policy, body } = await admitted();
    const out = (await schedule(scheduleBody(body))).json();
    await runWorker(boundaryId);
    const before = (await read(boundaryId, out.executionId)).json();

    expect((await move("retire", boundaryId, policy.policyId as string)).statusCode).toBe(200);

    const after = (await read(boundaryId, out.executionId)).json();
    expect(after.finding.findingHash).toBe(before.finding.findingHash);
    expect(after.bindingHash).toBe(before.bindingHash);
    expect(after.binding).toEqual(before.binding);
    expect(after.state).toBe("completed");
  });

  // ── 11 · No proof, no revenue, no case ──────────────────────────────────────────────────────────

  it("11 · a completed execution creates no proof, authority record, case or candidate", async () => {
    const { boundaryId, body } = await admitted();
    const recoveryCaseId = `RC-${uid()}`;
    const out = (await schedule(scheduleBody(body, { recoveryCaseId }))).json();
    const task = await runWorker(boundaryId);

    expect(task?.status).toBe("succeeded");
    // The agent is observation-only: it returns no CandidateSignal, so the publication path that
    // creates case candidates is never reached — structurally, not by configuration.
    expect(task?.result).toEqual([]);

    expect(await prisma.proof.count({ where: { recoveryCaseId } })).toBe(0);
    expect(await prisma.authorityEvent.count({ where: { recoveryCaseId } })).toBe(0);
    expect(await prisma.recoveryCaseRecord.count({ where: { recoveryCaseId } })).toBe(0);
    expect(await prisma.agentCaseCandidateRecord.count({ where: { boundaryId } })).toBe(0);
    expect(await prisma.baselineSnapshot.count({ where: { recoveryCaseId } })).toBe(0);

    const view = (await read(boundaryId, out.executionId)).json();
    const serialized = JSON.stringify(view.finding.finding);
    for (const counted of ["revenueReturned", "auditableRevenue", "proven", "collectedMinor"]) {
      expect(serialized).not.toContain(counted);
    }
  });

  // ── 12 · Deterministic audit lineage ────────────────────────────────────────────────────────────

  it("12 · the lineage dataset → admission → execution → finding is complete and re-derivable", async () => {
    const { boundaryId, policy, body, submitted } = await admitted();
    const out = (await schedule(scheduleBody(body))).json();
    await runWorker(boundaryId);
    const view = (await read(boundaryId, out.executionId)).json();

    // dataset → admission: the stored decision id is a function of the decision's own fields.
    const stored = await prisma.pilotDatasetSubmissionRecord.findFirstOrThrow({
      where: { boundaryId, datasetFingerprint: submitted.datasetFingerprint },
    });
    expect(stored.admissionDecisionId).toBe(
      await deriveAdmissionDecisionId({
        boundaryId,
        idempotencyKey: stored.idempotencyKey,
        datasetFingerprint: stored.datasetFingerprint,
        contractVersion: stored.contractVersion,
        outcome: stored.admissionOutcome!,
        admissionPolicyId: stored.admissionPolicyId,
        admissionPolicyVersion: stored.admissionPolicyVersion,
        admissionPolicyHash: stored.admissionPolicyHash,
      }),
    );

    // admission → execution: every governing input is on the binding, and it names the same bar.
    expect(view.binding.admissionDecisionId).toBe(stored.admissionDecisionId);
    expect(view.binding.datasetFingerprint).toBe(submitted.datasetFingerprint);
    expect(view.binding.admissionPolicyId).toBe(policy.policyId);
    expect(view.binding.admissionPolicyHash).toBe(submitted.admissionPolicyHash);
    expect(view.binding.contractVersion).toBe(PILOT_DATA_CONTRACT_VERSION);

    // execution → finding: the finding names its execution, and the log reads in order.
    expect(view.finding.finding.executionId).toBe(out.executionId);
    expect(view.events.map((e: { transition: string }) => e.transition)).toEqual([
      "SCHEDULED", "CLAIMED", "COMPLETED",
    ]);
    expect(view.events.every((e: { byId: string }) => e.byId.length > 0)).toBe(true);
    // Every step carries a timestamp, in order.
    const times = view.events.map((e: { at: string }) => Date.parse(e.at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("12b · the status board lists a boundary's executions with their derived states", async () => {
    const { boundaryId, body } = await admitted();
    const out = (await schedule(scheduleBody(body))).json();
    const queued = await app.inject({
      method: "GET", url: `/pilot/assessments?boundaryId=${boundaryId}`, headers: AUTHOR,
    });
    expect(queued.statusCode).toBe(200);
    expect(queued.json()).toHaveLength(1);
    expect(queued.json()[0]).toMatchObject({ executionId: out.executionId, state: "queued", code: null });

    await runWorker(boundaryId);
    const done = await app.inject({
      method: "GET", url: `/pilot/assessments?boundaryId=${boundaryId}`, headers: AUTHOR,
    });
    expect(done.json()[0].state).toBe("completed");
  });

  it("12c · an injected field in the schedule body is rejected, never silently stripped", async () => {
    const { body } = await admitted();
    const res = await schedule(scheduleBody(body, { admissionOutcome: "ADMISSIBLE", revenueReturned: 500_000 }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request" });
  });

  it("12d · a steward may read an execution but may not schedule one", async () => {
    const { boundaryId, body } = await admitted();
    const out = (await schedule(scheduleBody(body))).json();
    expect((await read(boundaryId, out.executionId, STEWARD)).statusCode).toBe(200);
    const refused = await schedule(scheduleBody(body), STEWARD);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().message).toMatch(/may not perform 'SchedulePilotAssessment'/);
  });
});
