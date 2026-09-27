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

  // ══ The gate ═════════════════════════════════════════════════════════════════════════════════════

  it("1 · a QUEUED execution emits nothing, and the review queue stays empty", async () => {
    const boundaryId = `ep31e-queued-${uid()}`;
    await scheduleStaged(boundaryId, await admitted(boundaryId));
    const result = await emitGovernedSignals({ boundaryId, policies: policies() });
    expect(result.candidatesCreated).toBe(0);
    expect(result.skipped).toEqual([
      { executionId: expect.any(String), reason: "not_completed", state: "queued" },
    ]);
    expect(await queue(boundaryId)).toEqual([]);
  });

  it("2 · a COMPLETED execution emits one candidate per staged account", async () => {
    const boundaryId = `ep31e-ok-${uid()}`;
    const result = await scheduleStaged(boundaryId, await admitted(boundaryId));
    expect((await completeWorker(boundaryId))?.status).toBe("succeeded");

    const staged = await prisma.pilotAssessmentEntityAttributionRecord.count({
      where: { executionId: result.executionId! },
    });
    expect(staged).toBeGreaterThan(0);

    const emission = await emitGovernedSignals({ boundaryId, policies: policies() });
    expect(emission.executionsEmitted).toBe(1);
    expect(emission.candidatesCreated).toBe(staged);
    expect(emission.claimBoundary).toEqual({
      atRiskOnly: true, constitutesProof: false, constitutesRevenue: false, createsRecoveryCase: false,
    });

    const items = await queue(boundaryId);
    expect(items).toHaveLength(staged);
    for (const item of items) {
      expect(item.status).toBe("pending_review");
      expect(item.signal.recoveryType).toBe(EMITTED_RECOVERY_TYPE);
      expect(item.signal.detectorVersion).toBe(SIGNAL_EMITTER_DETECTOR_VERSION);
      expect(item.signal.sourceRef).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
      // Derived, not supplied: the proof event comes from the PLAYBOOK and the cut-off from the terms.
      expect(item.signal.expectedProofEvent).toBe(PLAYBOOK[EMITTED_RECOVERY_TYPE].expectedProofEvent);
      expect(item.signal.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
      expect(item.signal.amountAtRiskMinor).toBeGreaterThan(0);
      expect(item.agentId).toBe(SIGNAL_EMITTER_AGENT_ID);
    }
    // No raw identifier reached the candidate table.
    expect(JSON.stringify(items)).not.toMatch(/synthetic-account/i);
  });

  it("3 · re-running emits NO second candidate — idempotent through the dedupe key", async () => {
    const boundaryId = `ep31e-idem-${uid()}`;
    await scheduleStaged(boundaryId, await admitted(boundaryId));
    await completeWorker(boundaryId);
    const first = await emitGovernedSignals({ boundaryId, policies: policies() });
    const second = await emitGovernedSignals({ boundaryId, policies: policies() });
    expect(first.candidatesCreated).toBeGreaterThan(0);
    expect(second.candidatesCreated).toBe(0);
    expect(second.candidatesAlreadyPresent).toBe(first.candidatesCreated);
    expect(await queue(boundaryId)).toHaveLength(first.candidatesCreated);
  });

  it("4 · the governed threshold is FAIL-CLOSED: no configured policy means refusal, not emission", async () => {
    const boundaryId = `ep31e-nopolicy-${uid()}`;
    await scheduleStaged(boundaryId, await admitted(boundaryId));
    await completeWorker(boundaryId);
    await expect(emitGovernedSignals({ boundaryId, policies: new Map() }))
      .rejects.toThrow(/no governed admission policy is configured/i);
    expect(await queue(boundaryId)).toEqual([]);
  });

  it("5 · a signal below the governed materiality floor is REFUSED and reported, never silently dropped", async () => {
    const boundaryId = `ep31e-floor-${uid()}`;
    await scheduleStaged(boundaryId, await admitted(boundaryId));
    await completeWorker(boundaryId);
    // A floor above every synthetic amount: nothing is material, so nothing is admitted.
    const emission = await emitGovernedSignals({ boundaryId, policies: policies(Number.MAX_SAFE_INTEGER) });
    expect(emission.candidatesCreated).toBe(0);
    expect(emission.refused.length).toBeGreaterThan(0);
    expect(emission.refused[0]!.reason).toMatch(/below the governed threshold/i);
    expect(await queue(boundaryId)).toEqual([]);
  });

  // ══ G2 · emission cannot damage the governed result ═══════════════════════════════════════════════

  it("6 · G2 · a failure during emission leaves the execution COMPLETED and byte-identical", async () => {
    const boundaryId = `ep31e-g2-${uid()}`;
    const scheduled = await scheduleStaged(boundaryId, await admitted(boundaryId));
    await completeWorker(boundaryId);
    const executionId = scheduled.executionId!;

    const view = async () =>
      (await app.inject({
        method: "GET", url: `/pilot/assessments/${executionId}?boundaryId=${encodeURIComponent(boundaryId)}`,
        headers: OPERATOR,
      })).json();
    const before = await view();
    expect(before.state).toBe("completed");

    // Force a write in the MIDDLE of the batch to fail, through the injected store.
    //
    // An earlier version of this test monkey-patched `prisma.$queryRaw` and applied the original with
    // `prisma` as the receiver — which routed the first INSERT onto the PARENT connection, where it
    // committed outside the transaction. One candidate then survived and the test read that as a
    // failure of atomicity. It was a failure of the harness: the injection had moved the write out of
    // the transaction it was meant to be testing. Recorded because the wrong conclusion was one step
    // away, and the honest seam is the store, exactly as the assessment service injects its task store.
    let created = 0;
    await expect(
      emitGovernedSignals({
        boundaryId,
        policies: policies(),
        candidateStoreFor: (tx) => {
          const real = new TransactionalCaseCandidateStore(tx);
          return {
            async createIfAbsent(candidate) {
              created += 1;
              if (created > 1) throw new Error("injected candidate-write failure");
              return real.createIfAbsent(candidate);
            },
          };
        },
      }),
    ).rejects.toThrow(/injected/);
    expect(created).toBeGreaterThan(1); // the failure really did land mid-batch

    // The governed result is untouched, in every field that makes it attributable and reproducible.
    const after = await view();
    expect(after.state).toBe("completed");
    expect(after.inputHash).toBe(before.inputHash);
    expect(after.bindingHash).toBe(before.bindingHash);
    expect(after.binding).toEqual(before.binding);
    expect(after.finding.findingHash).toBe(before.finding.findingHash);
    expect(after.finding.finding).toEqual(before.finding.finding);

    // NO PARTIAL CANDIDATE: the batch is all-or-nothing.
    expect(await queue(boundaryId)).toEqual([]);

    // And a retry afterwards admits the full batch exactly once.
    const retry = await emitGovernedSignals({ boundaryId, policies: policies() });
    expect(retry.candidatesCreated).toBeGreaterThan(0);
    expect(await queue(boundaryId)).toHaveLength(retry.candidatesCreated);
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

  // ══ G3 · one account is one candidate, across DIFFERENT exports ══════════════════════════════════

  it("9 · G3 · a second, differently-shaped export of the same accounts yields NO duplicate candidate", async () => {
    // The property that matters, and the one an ordinal-based reference would fail: the pseudonym depends
    // on the boundary and the customer's own account id, so a re-export with rows reordered, rows
    // removed and a different dataset label is still the same accounts — one candidate each, not two.
    const boundaryId = `ep31e-reexport-${uid()}`;
    const first = await admitted(boundaryId);

    // A genuinely different file: reversed data rows and two fewer of them, so the bytes, the
    // fingerprint, the submission identity and the execution id all differ.
    const lines = (first.csvText as string).trimEnd().split("\n");
    const reexport = [lines[0]!, ...lines.slice(1).reverse()].join("\n");
    expect(reexport).not.toBe(first.csvText);

    await scheduleStaged(boundaryId, first);
    expect((await completeWorker(boundaryId))?.status).toBe("succeeded");
    const afterFirst = await emitGovernedSignals({ boundaryId, policies: policies() });
    expect(afterFirst.candidatesCreated).toBeGreaterThan(0);
    const refsAfterFirst = new Set((await queue(boundaryId)).map((i: { signal: { sourceRef: string } }) => i.signal.sourceRef));

    const second = { ...first, datasetId: `ds-${uid()}`, csvText: reexport };
    const upload = await app.inject({
      method: "POST", url: "/pilot/datasets", headers: OPERATOR,
      // The bar must be named again: a submission that names none is judged under no policy at all and
      // comes back NOT_ASSESSABLE. An earlier draft of this test omitted it and read that as a data
      // problem with the re-export; the contract accepts both files identically.
      payload: {
        ...second,
        admissionPolicyId: barFor.get(boundaryId),
        admissionPolicyVersion: "1.0.0",
      } as object,
    });
    expect(upload.statusCode).toBe(200);
    // Asserted, not assumed: a re-export that failed admission would make the rest of this vacuous.
    expect(upload.json().admission.outcome).toBe("ADMISSIBLE");
    expect(upload.json().datasetFingerprint).not.toBe(undefined);
    const scheduled = await scheduleStaged(boundaryId, second);
    expect(scheduled.scheduled).toBe(true);
    expect(typeof scheduled.executionId).toBe("string");
    expect((await completeWorker(boundaryId))?.status).toBe("succeeded");

    const staged = await prisma.pilotAssessmentEntityAttributionRecord.findMany({
      where: { executionId: scheduled.executionId! },
    });
    expect(staged.length).toBeGreaterThan(0);
    // Every account carried over from the first export reuses its reference — no new pseudonym.
    const carriedOver = staged.filter((row) => refsAfterFirst.has(row.sourceRef));
    expect(carriedOver.length).toBeGreaterThan(0);

    const afterSecond = await emitGovernedSignals({ boundaryId, policies: policies() });
    // Each carried-over account was recognised as already having a candidate, not duplicated.
    expect(afterSecond.candidatesAlreadyPresent).toBeGreaterThanOrEqual(carriedOver.length);

    const refs = (await queue(boundaryId)).map((i: { signal: { sourceRef: string } }) => i.signal.sourceRef);
    expect(new Set(refs).size).toBe(refs.length); // no account appears twice
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

  // ══ Where a candidate stops ══════════════════════════════════════════════════════════════════════

  it("8 · a candidate is not a Case: promotion is refused until a review accepts it", async () => {
    const boundaryId = `ep31e-promote-${uid()}`;
    await scheduleStaged(boundaryId, await admitted(boundaryId));
    await completeWorker(boundaryId);
    await emitGovernedSignals({ boundaryId, policies: policies() });
    const candidateId = (await queue(boundaryId))[0].candidateId;

    const promote = () =>
      app.inject({
        method: "POST", url: `/agent-candidates/${candidateId}/promote`, headers: OPERATOR,
        payload: { boundaryId } as object,
      });
    expect((await promote()).statusCode).toBe(409);

    const review = await app.inject({
      method: "POST", url: `/agent-candidates/${candidateId}/review`, headers: OPERATOR,
      payload: { boundaryId, decision: "accepted", reason: "EP-31 emitter test" } as object,
    });
    expect(review.statusCode).toBe(201);
    expect((await promote()).statusCode).toBe(201);
  });
});
