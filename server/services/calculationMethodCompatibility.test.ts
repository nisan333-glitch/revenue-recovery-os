// Findings 1 & 2 · The calculation implementation that runs must be compatible with the one the
// governed definition was blessed for and the one the execution binding froze.
//
// WHAT WAS MISSING, in two places.
//
// SCHEDULE TIME. A governed AnalysisTerms version records `calculationMethodVersion` — a build constant
// at registration, recorded so a historical registration says which implementation it was approved
// against. Nothing checked that the build about to measure under it still implements that method. The
// transport already refuses to let a request state the field, with the reason written down
// (`analysisTermsSchema`: letting a request state it "would invite a definition blessed for an
// implementation that never ran it") — but the build was never held to the same standard.
//
// RUN TIME. `makePolicy` rebuilds the policy from the binding and takes no `calculationMethodVersion`
// input, so it always stamps the CURRENT constant. A redeploy between scheduling and claiming would
// compute the finding by one implementation while the binding named another. `deriveExecutionId` cannot
// catch it: it hashes the binding as STORED, not as this build would build it. The agent carried a
// comment asserting the rebuild "cannot drift", which was true of the as-of date, the threshold and the
// currency and false of exactly this field. That comment is corrected; this suite is why.
//
// NEITHER IS LATENT BY ACCIDENT. `ASSESSMENT_CALC_VERSION` has never moved in this repository's history,
// so both gates refuse nothing today. They exist for the bump — the moment at which a silent divergence
// would be least visible and most consequential, because Trust Invariant rule 4 requires the proof to
// capture the calculation ACTUALLY USED.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { SYNTHETIC_PROVENANCE, syntheticPilotCsv, SCENARIO_POLICY } from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../src/contract/pilotDataContract";
import { ASSESSMENT_CALC_VERSION } from "../../src/assessment/policy";
import {
  deriveExecutionId,
  hashExecutionBinding,
  hashExecutionInput,
  type ExecutionBinding,
  type ExecutionInput,
} from "../../src/contract/assessmentExecution";
import { createExecutionIfAbsent, findExecutionInput, executionStatus, findFinding } from "../persistence/pilotExecutionStore";
import { createPostgresAgentTaskStore } from "../agents/prismaTaskDatabase";
import { AgentRuntime } from "../agents/runtime";
import { createPilotAssessmentAgent, PILOT_ASSESSMENT_AGENT_ID } from "../agents/pilotAssessmentAgent";
import type { AgentPolicySnapshot } from "../agents/types";
import { ensureGovernedTerms, GOVERNED_TERMS_FIELDS, TEST_ANALYSIS_TERMS } from "../test/governedTerms";
import { scheduleRequestFrom } from "../test/scheduleRequest";

const HAS_DB = !!process.env.DATABASE_URL;
const OPERATOR = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
const STEWARD = { "x-actor-id": "gov@company", "x-actor-role": "steward" };
const uid = () => Math.random().toString(36).slice(2, 10);

/** A method label this build demonstrably does not implement. */
const FOREIGN_METHOD = "assess-9999.9-not-implemented-here";

const POLICY: AgentPolicySnapshot = {
  globalEnabled: true,
  disabledAgents: new Set<string>(),
  maxAttempts: 3,
  leaseMs: 30_000,
  retryDelayMs: () => 5,
};

describe.skipIf(!HAS_DB)("Findings 1 & 2 · calculation-method compatibility", () => {
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

  /**
   * Drive the worker until ONE named execution leaves `queued`.
   *
   * Needed because `runNext` claims the oldest due task in the boundary, and the drifted execution is
   * deliberately created beside an honest one that was enqueued first. A fixed number of calls would
   * make these tests depend on claim order; this depends on the thing under test instead. Bounded, so a
   * gate that never fires fails the assertion rather than looping forever.
   */
  async function driveUntilSettled(boundaryId: string, executionId: string, max = 8) {
    for (let i = 0; i < max; i += 1) {
      if ((await executionStatus(executionId, boundaryId)).state !== "queued") break;
      if ((await runtime().runNext(agent, `w-${uid()}`, boundaryId)) === null) break;
    }
    return executionStatus(executionId, boundaryId);
  }

  const runtime = () =>
    new AgentRuntime({
      store: taskStore,
      policy: { current: () => POLICY },
      audit: { append: async () => {} },
      now: Date.now,
    });

  /**
   * The full governed lead-up and an admitted dataset.
   *
   * `termsCalculationMethod` is the ONE field that varies between the positive control and the negative:
   * everything else — the bar, the thresholds, the bytes, the cut-off, the stall threshold, the currency
   * — is identical, so a refusal is attributable to the method and to nothing else.
   */
  async function admitted(termsCalculationMethod?: string) {
    const boundaryId = `pb-${uid()}`;
    await ensureGovernedTerms(
      boundaryId,
      termsCalculationMethod === undefined ? {} : { calculationMethodVersion: termsCalculationMethod },
    );
    const policyId = `pol-${uid()}`;
    expect(
      (await app.inject({
        method: "POST", url: "/pilot/admission-policies", headers: OPERATOR,
        payload: {
          boundaryId,
          policy: {
            policyId, policyVersion: "1.0.0",
            ...SCENARIO_POLICY, requiredLifecycleStates: [...SCENARIO_POLICY.requiredLifecycleStates],
          },
          rationale: "fixture",
        },
      })).statusCode,
    ).toBe(201);
    expect(
      (await app.inject({
        method: "POST", url: "/pilot/admission-policies/activate", headers: STEWARD,
        payload: { boundaryId, policyId, policyVersion: "1.0.0", rationale: "reviewed" },
      })).statusCode,
    ).toBe(200);

    const base = {
      boundaryId,
      datasetId: `ds-${uid()}`,
      declaredVersion: PILOT_DATA_CONTRACT_VERSION,
      csvText: syntheticPilotCsv(40),
      ...GOVERNED_TERMS_FIELDS,
      provenance: SYNTHETIC_PROVENANCE,
    };
    const submitted = (await app.inject({
      method: "POST", url: "/pilot/datasets", headers: OPERATOR,
      payload: { ...base, admissionPolicyId: policyId, admissionPolicyVersion: "1.0.0" },
    })).json();
    expect(submitted.usableForAssessment, JSON.stringify(submitted.datasetFindings)).toBe(true);
    expect(submitted.admission.outcome).toBe("ADMISSIBLE");
    return { boundaryId, base, submitted, decisionId: submitted.admissionDecisionId as string };
  }

  const schedule = (base: Record<string, unknown>, over: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST", url: "/pilot/assessments", headers: OPERATOR,
      payload: { ...scheduleRequestFrom(base), ...over },
    });

  // ── Schedule time ────────────────────────────────────────────────────────────────────────────────

  it("1 · POSITIVE CONTROL · terms blessed for THIS build's method schedule and run to a finding", async () => {
    // Without this, test 2 would prove only that something about the fixture stops a schedule.
    const a = await admitted();
    const out = (await schedule(a.base, { admissionDecisionId: a.decisionId })).json();
    expect(out.refusal, JSON.stringify(out.refusalDetail)).toBeNull();
    expect(out.scheduled).toBe(true);
    expect(out.binding.assessmentPolicy.calculationMethodVersion).toBe(ASSESSMENT_CALC_VERSION);

    expect((await runtime().runNext(agent, `w-${uid()}`, a.boundaryId))?.status).toBe("succeeded");
    expect((await executionStatus(out.executionId, a.boundaryId)).state).toBe("completed");
    expect(await findFinding(out.executionId, a.boundaryId)).not.toBeNull();
  });

  it("2 · terms blessed for a method this build does not implement are REFUSED NH-AX-1014", async () => {
    const a = await admitted(FOREIGN_METHOD);
    // The registration itself is legitimate and the row is sound — this is not a tampering case. The
    // register holds exactly what was blessed, and its hash still matches.
    const row = await prisma.pilotAnalysisTermsRecord.findFirstOrThrow({
      where: { boundaryId: a.boundaryId, termsId: TEST_ANALYSIS_TERMS.termsId },
    });
    expect(row.calculationMethodVersion).toBe(FOREIGN_METHOD);

    for (const cite of [false, true]) {
      const out = (
        await schedule(a.base, cite ? { admissionDecisionId: a.decisionId } : {})
      ).json();
      expect(out.scheduled, String(cite)).toBe(false);
      expect(out.refusal.code, String(cite)).toBe("NH-AX-1014");
      expect(out.refusalDetail).toContain(FOREIGN_METHOD);
      expect(out.refusalDetail).toContain(ASSESSMENT_CALC_VERSION);
    }

    // NOTHING WAS QUEUED. A refused schedule leaves no execution, no input, no task and no finding —
    // so there is no row anyone could later claim and run under an unblessed method.
    expect(await prisma.pilotAssessmentExecutionRecord.count({ where: { boundaryId: a.boundaryId } })).toBe(0);
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { boundaryId: a.boundaryId } })).toBe(0);
    expect(await prisma.agentTaskRecord.count({ where: { boundaryId: a.boundaryId, agentId: PILOT_ASSESSMENT_AGENT_ID } })).toBe(0);
    expect(await prisma.pilotAssessmentFindingRecord.count({ where: { boundaryId: a.boundaryId } })).toBe(0);
  });

  it("3 · the refusal is DIAGNOSTICALLY SEPARATE from support, governance and identity failures", async () => {
    // An incompatible calculation method is not an uninterpretable contract (NH-AX-1006), not an
    // ungoverned definition (NH-AX-1010), and not a changed record (NH-AX-1005). Sending someone to
    // re-export a file, or to investigate a tampered row, when what moved was the assessment
    // implementation, is the specific confusion these codes exist to prevent.
    const a = await admitted(FOREIGN_METHOD);
    const out = (await schedule(a.base, { admissionDecisionId: a.decisionId })).json();
    expect(out.refusal.code).toBe("NH-AX-1014");
    expect(out.refusal.severity).toBe("refused");
    for (const other of ["NH-AX-1005", "NH-AX-1006", "NH-AX-1010", "NH-AX-1012"]) {
      expect(out.refusal.code).not.toBe(other);
    }
    // The remediation is the governance act, not a file fix.
    expect(out.refusal.remediation).toMatch(/activate an analysis-terms version/i);
  });

  // ── Run time ─────────────────────────────────────────────────────────────────────────────────────

  /**
   * Model a build that changed AFTER scheduling.
   *
   * The constant cannot be reassigned at runtime, so the drift is constructed from the other side: an
   * execution whose binding froze a different method, written through the production store with its own
   * real hashes and its own real id. That is the same shape the redeploy would produce, and it is the
   * only way to produce it without a second process.
   */
  async function driftedExecution(a: Awaited<ReturnType<typeof admitted>>) {
    const honest = (await schedule(a.base, { admissionDecisionId: a.decisionId })).json();
    expect(honest.scheduled).toBe(true);
    const stored = await findExecutionInput(honest.executionId, a.boundaryId);
    expect(stored).not.toBeNull();
    const input: ExecutionInput = Object.freeze({
      scheme: "nh-pilot-assessment-projection-v1",
      cycles: stored!.cycles,
    });
    const drifted: ExecutionBinding = Object.freeze({
      ...honest.binding,
      assessmentPolicy: Object.freeze({
        ...honest.binding.assessmentPolicy,
        calculationMethodVersion: FOREIGN_METHOD,
      }),
    });
    const executionId = await deriveExecutionId(drifted);
    expect(executionId).not.toBe(honest.executionId); // a different method IS a different identity
    const [bindingHash, inputHash] = await Promise.all([
      hashExecutionBinding(drifted),
      hashExecutionInput(input),
    ]);
    await createExecutionIfAbsent({
      executionId, binding: drifted, bindingHash, input, inputHash,
      scheduledByActorId: "constructed@company", scheduledByRole: "operator",
      attributions: [], sourceResolution: null,
    });
    await taskStore.enqueueIfAbsent({
      taskId: `TASK-${executionId}`,
      boundaryId: a.boundaryId,
      agentId: PILOT_ASSESSMENT_AGENT_ID,
      idempotencyKey: executionId,
      payload: { executionId },
      now: Date.now(),
    });
    return { executionId, drifted, honestExecutionId: honest.executionId as string };
  }

  it("4 · a build change after scheduling BLOCKS the execution NH-AX-2006 before any finding exists", async () => {
    const a = await admitted();
    const d = await driftedExecution(a);

    // The binding still hashes to its own id, so this is NOT an identity failure — which is exactly why
    // it needed its own check: every pre-existing guard passes and the run would have proceeded.
    expect(await deriveExecutionId(d.drifted)).toBe(d.executionId);

    const status = await driveUntilSettled(a.boundaryId, d.executionId);
    expect(status.state).toBe("blocked");
    expect(status.code).toBe("NH-AX-2006");

    // NO FINDING, NO PROOF. Checked before the policy is rebuilt and before anything is computed, so
    // there is nothing to withdraw afterwards.
    expect(await findFinding(d.executionId, a.boundaryId)).toBeNull();
    expect(await prisma.pilotAssessmentFindingRecord.count({ where: { executionId: d.executionId } })).toBe(0);
  });

  it("5 · the block cannot be bypassed by re-claiming the stored binding", async () => {
    // The stored binding is the thing a retry re-reads, so "blocked" has to survive re-claiming or the
    // gate would only delay the drifted run rather than stop it. `blocked` is terminal: the runtime does
    // not re-offer the task, and if it did, the same comparison would answer the same way.
    const a = await admitted();
    const d = await driftedExecution(a);

    expect((await driveUntilSettled(a.boundaryId, d.executionId)).code).toBe("NH-AX-2006");

    // Keep driving. Whatever else the runtime does with other work in this boundary, the drifted
    // execution must stay blocked and must never acquire a finding: `blocked` is terminal, and if the
    // task were re-offered the same comparison would answer the same way.
    for (let i = 0; i < 4; i += 1) await runtime().runNext(agent, `w-${uid()}`, a.boundaryId);
    const after = await executionStatus(d.executionId, a.boundaryId);
    expect(after.state).toBe("blocked");
    expect(after.code).toBe("NH-AX-2006");
    expect(await findFinding(d.executionId, a.boundaryId)).toBeNull();
    expect(await prisma.pilotAssessmentFindingRecord.count({ where: { executionId: d.executionId } })).toBe(0);
  });

  it("7 · the drift gate sits BEFORE the computation, not merely before the write", async () => {
    // FOUND BY A FALSIFIER THAT DID NOT BITE. Moving the check to just before `hashFinding` left all of
    // tests 4-6 green: `recordFindingIfAbsent` comes later, so no finding is persisted either way. The
    // invariant "no finding is written" was therefore proven, and the stronger claim the agent's comment
    // makes — "before the policy is rebuilt and before anything is computed" — was not.
    //
    // It is worth pinning rather than softening. `runProjectedAssessment` is pure, so a late check
    // leaves no trace to assert on behaviourally; but running the real calculation under a method the
    // binding does not name and then discarding the result is still the wrong shape, and the next person
    // to move this line should have to notice. Source-level for the same reason as the S5 surface test:
    // ordering inside a function is not observable at runtime when the work in between is pure.
    const source = readFileSync(resolve(__dirname, "..", "agents", "pilotAssessmentAgent.ts"), "utf8");
    const open = source.indexOf("async function executeAssessment(");
    expect(open).toBeGreaterThan(-1);
    const gate = source.indexOf("calculation_method_drift", open);
    const rebuild = source.indexOf("const policy = makePolicy({", open);
    const compute = source.indexOf("runProjectedAssessment({", open);
    expect(gate).toBeGreaterThan(-1);
    expect(rebuild).toBeGreaterThan(-1);
    expect(compute).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(rebuild);
    expect(gate).toBeLessThan(compute);
  });

  it("6 · the HONEST execution beside the drifted one still completes — the gate is not a blanket stop", async () => {
    // Both executions exist in the same boundary, over the same bytes and the same decision, differing
    // only in the frozen method. One must complete and one must block, or the gate is either useless or
    // indiscriminate.
    const a = await admitted();
    const d = await driftedExecution(a);

    for (let i = 0; i < 4; i += 1) await runtime().runNext(agent, `w-${uid()}`, a.boundaryId);

    expect((await executionStatus(d.honestExecutionId, a.boundaryId)).state).toBe("completed");
    expect(await findFinding(d.honestExecutionId, a.boundaryId)).not.toBeNull();
    expect((await executionStatus(d.executionId, a.boundaryId)).state).toBe("blocked");
    expect(await findFinding(d.executionId, a.boundaryId)).toBeNull();
    expect(await prisma.pilotAssessmentFindingRecord.count({ where: { boundaryId: a.boundaryId } })).toBe(1);
  });
});
