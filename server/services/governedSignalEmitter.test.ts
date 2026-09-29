// EP-31 · Phase B · The emitter, against a real database.
//
// The questions these answer: can a candidate exist for an execution that did not complete; can a failure
// here damage the governed result; can a raw identifier or a caller-supplied amount reach a candidate; and
// does a candidate stop where it should — short of a Case, and far short of a Proof.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { SYNTHETIC_PROVENANCE, syntheticPilotCsv } from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../src/contract/pilotDataContract";
import { ADMISSION_CALC_VERSION } from "../../src/contract/pilotAdmissionPolicy";
import { ensureGovernedTerms, GOVERNED_TERMS_FIELDS } from "../test/governedTerms";
import { schedulePilotAssessment } from "./pilotAssessmentService";
import {
  emitGovernedSignals,
  EMITTED_RECOVERY_TYPE,
  SIGNAL_EMITTER_AGENT_ID,
  SIGNAL_EMITTER_DETECTOR_VERSION,
} from "./governedSignalEmitter";
import { AgentRuntime } from "../agents/runtime";
import { createPilotAssessmentAgent } from "../agents/pilotAssessmentAgent";
import { createPostgresAgentTaskStore } from "../agents/prismaTaskDatabase";
import { TransactionalCaseCandidateStore } from "../agents/postgresCaseCandidateStore";
import { PLAYBOOK } from "../../src/domain/recommendation";
import type { RecoveryTypeAdmissionPolicy } from "../agents/admission";
import {
  LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL,
  leakInstanceIdentityStatus,
} from "../../src/contract/leakInstanceIdentity";

const HAS_DB = !!process.env.DATABASE_URL;
const uid = () => Math.random().toString(36).slice(2, 10);
const KEY = "EP31-TEST-ONLY-KEY-NOT-FOR-CUSTOMERS-32+";
const OPERATOR = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
const STEWARD = { "x-actor-id": "gov@company", "x-actor-role": "steward" };

/** A floor low enough that the synthetic population clears it, so the gate is exercised not bypassed. */
const policies = (thresholdMinor = 1): ReadonlyMap<string, RecoveryTypeAdmissionPolicy> =>
  new Map([[EMITTED_RECOVERY_TYPE, { recoveryType: EMITTED_RECOVERY_TYPE, economicThresholdMinor: thresholdMinor }]]);

describe.skipIf(!HAS_DB)("EP-31 · the governed signal emitter", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  const actor = (boundaryId: string) =>
    ({ actorId: "pilot-operator@company", role: "operator" as const, boundaryIds: [boundaryId] });

  /** The bar activated for each boundary, so a second upload in the same boundary can name it. */
  const barFor = new Map<string, string>();

  async function admitted(boundaryId: string) {
    await ensureGovernedTerms(boundaryId);
    const policyId = `pol-${uid()}`;
    barFor.set(boundaryId, policyId);
    await app.inject({
      method: "POST", url: "/pilot/admission-policies", headers: OPERATOR,
      payload: {
        boundaryId, rationale: "EP-31 emitter test",
        policy: {
          policyId, policyVersion: "1.0.0", calculationMethodVersion: ADMISSION_CALC_VERSION,
          minAcceptedRows: 10, minDistinctEntities: 5, maxRejectionRate: 0.2, maxSingleReasonShare: 0.9,
          maxDuplicateRate: 0.05, minCoverageDays: 10, requiredLifecycleStates: ["stalled", "reference"],
          maxOrderingDefectRate: 0.05, maxMissingRecommendedColumns: 2, requireProvenanceDeclaration: true,
        },
      } as object,
    });
    await app.inject({
      method: "POST", url: "/pilot/admission-policies/activate", headers: STEWARD,
      payload: { boundaryId, policyId, policyVersion: "1.0.0", rationale: "reviewed" } as object,
    });
    const body = {
      boundaryId, datasetId: `ds-${uid()}`, declaredVersion: PILOT_DATA_CONTRACT_VERSION,
      csvText: syntheticPilotCsv(40), ...GOVERNED_TERMS_FIELDS, provenance: SYNTHETIC_PROVENANCE,
    };
    await app.inject({
      method: "POST", url: "/pilot/datasets", headers: OPERATOR,
      payload: { ...body, admissionPolicyId: policyId, admissionPolicyVersion: "1.0.0" } as object,
    });
    return body;
  }

  /** Schedule with staging enrolled for this boundary. */
  const scheduleStaged = (boundaryId: string, body: unknown) =>
    schedulePilotAssessment(actor(boundaryId), body as never, {
      signalStaging: { boundaries: new Set([boundaryId]), sourceRefKey: KEY },
    });

  async function completeWorker(boundaryId: string) {
    const runtime = new AgentRuntime({
      store: createPostgresAgentTaskStore(),
      policy: {
        current: () => ({
          globalEnabled: true, disabledAgents: new Set<string>(), maxAttempts: 3,
          leaseMs: 30_000, retryDelayMs: () => 5,
        }),
      },
      audit: { append: async () => {} },
      now: Date.now,
    });
    return runtime.runNext(createPilotAssessmentAgent(), `w-${uid()}`, boundaryId);
  }

  const queue = async (boundaryId: string) =>
    (await app.inject({
      method: "GET", url: `/agent-candidates?boundaryId=${encodeURIComponent(boundaryId)}`, headers: OPERATOR,
    })).json();

  // ══ CONTROL 2 · the identity gate, and the bypass it must survive ════════════════════════════════

  it("1 · a COMPLETED execution emits NOTHING: identity is blocked, and the reason is named", async () => {
    const boundaryId = `ep31c-e-blocked-${uid()}`;
    await scheduleStaged(boundaryId, await admitted(boundaryId));
    expect((await completeWorker(boundaryId))?.status).toBe("succeeded");

    const emission = await emitGovernedSignals({ boundaryId, policies: policies() });
    expect(emission.leakInstanceIdentityEstablishable).toBe(false);
    expect(emission.identityBlockedDetail).toBe(LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL);
    expect(emission.candidatesCreated).toBe(0);
    expect(emission.executionsExamined).toBe(0);
    expect(emission.claimBoundary).toEqual({
      atRiskOnly: true, constitutesProof: false, constitutesRevenue: false, createsRecoveryCase: false,
    });
    expect(await queue(boundaryId)).toEqual([]);
  });

  it("2 · CONTROL 2 · BYPASSING staging by inserting a row by hand still yields ZERO candidates", async () => {
    // Defense in depth, and the reason the emitter asks the identity question itself rather than trusting
    // that staging wrote nothing. A row reaching the table by ANY other route — a hand-written INSERT, a
    // build predating the staging guard, a restore — must not become a candidate.
    const boundaryId = `ep31c-e-bypass-${uid()}`;
    const scheduled = await scheduleStaged(boundaryId, await admitted(boundaryId));
    expect((await completeWorker(boundaryId))?.status).toBe("succeeded");

    await prisma.pilotAssessmentEntityAttributionRecord.create({
      data: {
        executionId: scheduled.executionId!, boundaryId,
        sourceRef: `hmac-sha256:${"b".repeat(64)}`, amountAtRiskMinor: 500_000n, currency: "USD",
        contributingCycleCount: 1, attributionRule: "nh-entity-attribution-v1",
      },
    });
    // The row is really there — otherwise this proves nothing.
    expect(await prisma.pilotAssessmentEntityAttributionRecord.count({
      where: { executionId: scheduled.executionId! },
    })).toBe(1);

    const emission = await emitGovernedSignals({ boundaryId, policies: policies() });
    expect(emission.leakInstanceIdentityEstablishable).toBe(false);
    expect(emission.identityBlockedDetail).toBe(LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL);
    expect(emission.candidatesCreated).toBe(0);
    expect(await queue(boundaryId)).toEqual([]);
    // No Case either, since no candidate exists to promote.
    expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId } })).toBe(0);
  });

  it("3 · the emitter NEVER throws for a blocked identity — it returns a named result", async () => {
    const boundaryId = `ep31c-e-nothrow-${uid()}`;
    await scheduleStaged(boundaryId, await admitted(boundaryId));
    await completeWorker(boundaryId);
    await expect(emitGovernedSignals({ boundaryId, policies: policies() })).resolves.toMatchObject({
      leakInstanceIdentityEstablishable: false,
      candidatesCreated: 0,
    });
  });

  it("4 · the governed threshold is still FAIL-CLOSED, and is checked before the identity gate", async () => {
    // Order matters: a missing materiality floor is a configuration fault the operator must fix, and it
    // must not be masked by the standing identity block.
    const boundaryId = `ep31c-e-nopolicy-${uid()}`;
    await scheduleStaged(boundaryId, await admitted(boundaryId));
    await completeWorker(boundaryId);
    await expect(emitGovernedSignals({ boundaryId, policies: new Map() }))
      .rejects.toThrow(/no governed admission policy is configured/i);
    expect(await queue(boundaryId)).toEqual([]);
  });

  /**
   * SUSPENDED COVERAGE, recorded rather than quietly dropped.
   *
   * These end-to-end properties were proved at `95dc2bb` and are unreachable while the identity gate holds,
   * because every one of them needs a candidate to exist: one candidate per staged account; idempotent
   * re-emission through the dedupe key; a below-floor signal reported in `refused`; mid-batch atomicity
   * leaving the execution byte-identical; cross-export pseudonym stability producing no duplicate; and
   * promotion refused 409 until a review accepts it.
   *
   * They are preserved in the EP-31 commits, not deleted from history, and they become reachable again
   * when an authoritative leak-instance identity exists. Deliberately NOT preserved by adding an override
   * that satisfies the gate: a seam capable of turning the gate off is precisely what this slice removes,
   * and test coverage is not a reason to build one.
   */
  it("SUSPENDED · end-to-end candidate coverage awaits an authoritative leak-instance identity", () => {
    expect(leakInstanceIdentityStatus().establishable).toBe(false);
  });

  it("7 · G2 · the emitter has NO write path to the execution, its events or its finding", () => {
    // Structural, in the style of assessmentExecution.boundaries.test.ts: read from the source rather
    // than inferred from behaviour, so a future edit that added a write is caught.
    const src = readFileSync(new URL("./governedSignalEmitter.ts", import.meta.url), "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    for (const forbidden of [
      "pilotAssessmentExecutionRecord",
      "pilotAssessmentExecutionEventRecord",
      "pilotAssessmentFindingRecord",
      "appendExecutionEvent",
      "recordFindingIfAbsent",
      "createExecutionIfAbsent",
    ]) {
      expect(src, `emitter references ${forbidden}`).not.toContain(forbidden);
    }
    // It also cannot author a case, a baseline, evidence or a proof.
    for (const specifier of [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!)) {
      expect(specifier, `emitter imports ${specifier}`).not.toMatch(
        /proofService|proofStore|recoveryCase|baselineStore|evidenceStore|authorityStore|candidateReview/i,
      );
    }
  });

  it("10 · NC · the request body cannot supply the at-risk amount or anything else about the signal", async () => {
    // `additionalProperties: false` on the schedule body is what makes this a 400 rather than a field
    // someone later decides to honour. Every input to the case-admission gate is derived.
    const boundaryId = `ep31e-smuggle-${uid()}`;
    const body = await admitted(boundaryId);
    for (const field of ["amountAtRiskMinor", "recoveryType", "actionAvailable", "expectedProofEvent", "sourceRef"]) {
      const response = await app.inject({
        method: "POST", url: "/pilot/assessments", headers: OPERATOR,
        payload: { ...body, [field]: field === "actionAvailable" ? true : "x" } as object,
      });
      expect(response.statusCode, field).toBe(400);
    }
  });

});
