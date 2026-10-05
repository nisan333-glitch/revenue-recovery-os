// DETECTOR #2 through the GOVERNED path — persisted with its own witness, and the finding untouched.
//
// The pure detector is proven in `src/assessment/nonStalledExposure.test.ts` and measured against ground
// truth in its benchmark. What only a database can prove is the part that mattered architecturally:
// that the exposure rides along on the finding's write as a SEPARATE artifact, carrying its own hash and
// its own method version, while `finding` and `finding_hash` stay exactly what they were.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { SYNTHETIC_PROVENANCE, syntheticPilotCsv, SCENARIO_POLICY } from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../src/contract/pilotDataContract";
import { AgentRuntime } from "../agents/runtime";
import { createPilotAssessmentAgent } from "../agents/pilotAssessmentAgent";
import { createPostgresAgentTaskStore } from "../agents/prismaTaskDatabase";
import type { AgentPolicySnapshot } from "../agents/types";
import { ensureGovernedTerms, GOVERNED_TERMS_FIELDS } from "../test/governedTerms";
import { scheduleRequestFrom } from "../test/scheduleRequest";
import { findFinding } from "../persistence/pilotExecutionStore";
import {
  EXPOSURE_FINDING_SCHEME,
  NON_STALLED_EXPOSURE_METHOD_VERSION,
  hashExposureFinding,
} from "../../src/contract/exposureFinding";
import { hashFinding } from "../../src/contract/assessmentExecution";

const HAS_DB = !!process.env.DATABASE_URL;
const OPERATOR = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
const STEWARD = { "x-actor-id": "gov@company", "x-actor-role": "steward" };
const uid = () => Math.random().toString(36).slice(2, 10);
const POLICY: AgentPolicySnapshot = {
  globalEnabled: true, disabledAgents: new Set<string>(), maxAttempts: 3,
  leaseMs: 30_000, retryDelayMs: () => 5,
};

describe.skipIf(!HAS_DB)("Detector #2 · persisted beside the finding, never inside it", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  const taskStore = createPostgresAgentTaskStore();
  const agent = createPilotAssessmentAgent();

  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  /** The governed lead-up, a schedule, and a worker run to completion. */
  async function completed() {
    const boundaryId = `pb-${uid()}`;
    const policyId = `pol-${uid()}`;
    await ensureGovernedTerms(boundaryId);
    expect((await app.inject({
      method: "POST", url: "/pilot/admission-policies", headers: OPERATOR,
      payload: {
        boundaryId,
        policy: { policyId, policyVersion: "1.0.0", ...SCENARIO_POLICY,
          requiredLifecycleStates: [...SCENARIO_POLICY.requiredLifecycleStates] },
        rationale: "fixture",
      },
    })).statusCode).toBe(201);
    expect((await app.inject({
      method: "POST", url: "/pilot/admission-policies/activate", headers: STEWARD,
      payload: { boundaryId, policyId, policyVersion: "1.0.0", rationale: "reviewed" },
    })).statusCode).toBe(200);

    const base = {
      boundaryId, datasetId: `ds-${uid()}`, declaredVersion: PILOT_DATA_CONTRACT_VERSION,
      csvText: syntheticPilotCsv(40), ...GOVERNED_TERMS_FIELDS, provenance: SYNTHETIC_PROVENANCE,
    };
    expect((await app.inject({
      method: "POST", url: "/pilot/datasets", headers: OPERATOR,
      payload: { ...base, admissionPolicyId: policyId, admissionPolicyVersion: "1.0.0" },
    })).json().admission.outcome).toBe("ADMISSIBLE");

    const scheduled = (await app.inject({
      method: "POST", url: "/pilot/assessments", headers: OPERATOR, payload: scheduleRequestFrom(base),
    })).json();
    expect(scheduled.scheduled, JSON.stringify(scheduled.refusalDetail)).toBe(true);

    const runtime = new AgentRuntime({
      store: taskStore, policy: { current: () => POLICY },
      audit: { append: async () => {} }, now: Date.now,
    });
    for (let i = 0; i < 8; i += 1) {
      if ((await runtime.runNext(agent, `w-${uid()}`, boundaryId)) === null) break;
    }
    return { boundaryId, executionId: scheduled.executionId as string };
  }

  it("1 · the worker persists the exposure with its own witness and method version", async () => {
    const { boundaryId, executionId } = await completed();
    const stored = await findFinding(executionId, boundaryId);
    expect(stored, "the execution must have produced a finding").not.toBeNull();

    expect(stored!.exposure).not.toBeNull();
    expect(stored!.exposure!.scheme).toBe(EXPOSURE_FINDING_SCHEME);
    expect(stored!.exposure!.methodVersion).toBe(NON_STALLED_EXPOSURE_METHOD_VERSION);
    expect(stored!.exposureMethodVersion).toBe(NON_STALLED_EXPOSURE_METHOD_VERSION);
    // Its own witness, and one that actually verifies — a stored hash nobody can recompute is decoration.
    expect(stored!.exposureHash).toBe(await hashExposureFinding(stored!.exposure!));
    expect(stored!.exposureHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    // It knows what it is NOT, in the payload.
    expect(stored!.exposure!.claimBoundary.constitutesProof).toBe(false);
    expect(stored!.exposure!.claimBoundary.constitutesRevenue).toBe(false);
  });

  it("2 · the FINDING is untouched — its hash still verifies, and carries no exposure field", async () => {
    // The architectural claim of the whole slice, checked on a real stored row: same input, same terms,
    // same calculation method ⇒ the same witness it would have had before Detector #2 existed.
    const { boundaryId, executionId } = await completed();
    const stored = await findFinding(executionId, boundaryId);
    expect(await hashFinding(stored!.finding)).toBe(stored!.findingHash);
    for (const forbidden of ["overdueUnpaid", "nonStalled", "exposure", "population"]) {
      expect(JSON.stringify(stored!.finding), `finding must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("3 · the two surfaces are disjoint on the stored artifacts", async () => {
    const { boundaryId, executionId } = await completed();
    const stored = await findFinding(executionId, boundaryId);
    const f = stored!.finding;
    const e = stored!.exposure!;
    // Populations partition the accepted set: stalled + examined-outside-stall = accepted.
    expect(f.stalledCount + e.population).toBe(f.acceptedCycleCount);
    expect(e.currency).toBe(f.currency);
  });

  it("4 · the read surface exposes the reading", async () => {
    const { boundaryId, executionId } = await completed();
    const view = (await app.inject({
      method: "GET",
      url: `/pilot/assessments/${encodeURIComponent(executionId)}?boundaryId=${encodeURIComponent(boundaryId)}`,
      headers: OPERATOR,
    })).json();
    expect(view.finding.exposure).not.toBeNull();
    expect(view.finding.exposure.methodVersion).toBe(NON_STALLED_EXPOSURE_METHOD_VERSION);
    expect(view.finding.exposureHash).toMatch(/^sha256:/);
    expect(view.finding.exposure.claimBoundary.constitutesProof).toBe(false);
  });

  it("5 · a HISTORICAL finding — written with no exposure — reads as null, not as zero", async () => {
    // The shape every pre-slice execution has. Simulated by INSERTING a row without the exposure
    // columns, which the table permits; an UPDATE would be refused by the append-only trigger, and
    // trying to edit history to simulate history is the wrong experiment anyway.
    //
    // THE DISTINCTION THIS PINS: null means NOT COMPUTED. Reporting it as 0.00 would assert that a
    // healthy-activation population was examined and found clean, which nobody examined.
    const historicalId = `PAX-${"f".repeat(32)}-${uid()}`;
    const boundaryId = `pb-${uid()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO pilot_assessment_findings
         (execution_id, boundary_id, assessment_id, finding, finding_hash, produced_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      historicalId, boundaryId, "A-historical",
      JSON.stringify({ executionId: historicalId, boundaryId, observedUnpaidMinor: 123 }),
      `sha256:${"0".repeat(64)}`, "pre-detector-2-build",
    );

    const stored = await findFinding(historicalId, boundaryId);
    expect(stored).not.toBeNull();
    expect(stored!.exposure).toBeNull();
    expect(stored!.exposureHash).toBeNull();
    expect(stored!.exposureMethodVersion).toBeNull();
  });

  it("6 · the DB refuses a half-written reading — a payload with no witness cannot exist", async () => {
    // The CHECK constraint, exercised rather than trusted. A reading whose hash is missing would be a
    // figure nobody could verify, which is worse than no figure at all.
    const boundaryId = `pb-${uid()}`;
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO pilot_assessment_findings
           (execution_id, boundary_id, assessment_id, finding, finding_hash, produced_by, exposure)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb)`,
        `PAX-${"e".repeat(32)}-${uid()}`, boundaryId, "A-half",
        JSON.stringify({ a: 1 }), `sha256:${"0".repeat(64)}`, "test", JSON.stringify({ b: 2 }),
      ),
    ).rejects.toThrow();
  });
});
