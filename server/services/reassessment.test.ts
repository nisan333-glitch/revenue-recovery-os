// Explicit re-assessment of a retained input under a new calculation method — and everything it refuses.
//
// WHY IT IS SOUND, and it rests on a derivation rather than on convenience: the admission verdict does
// not depend on the calculation method. `evaluateAdmission` reads the assessment policy only to split
// cohorts and never reads its method, so an admission reached under one method would have been identical
// under another. Reusing it reuses a decision that was never about the thing that changed.
// (docs/CALCULATION_IDENTITY_V1.md)
//
// WHAT IT NEVER DOES. It never replaces. A new execution and a new finding are created and LINKED; the
// earlier ones are untouched and readable at their own identifiers. Trust Invariant rule 9 requires a
// revision to be a new linked record, rule 5 requires the historical result to stay reproducible, and
// both hold by construction because the previous rows are never written to.
//
// WHAT IT REFUSES, each to a different place: a missing or unverifiable input (re-submit), terms that
// change what is measured rather than how (re-submit), terms naming the method already used (nothing to
// do), an undeclared method (block), and a bar that is frozen or no longer hashes to its definition.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { SYNTHETIC_PROVENANCE, syntheticPilotCsv, SCENARIO_POLICY } from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../src/contract/pilotDataContract";
import { ASSESSMENT_CALC_VERSION, makePolicy } from "../../src/assessment/policy";
import {
  deriveExecutionId,
  hashExecutionBinding,
  hashExecutionInput,
  hashFinding,
  runProjectedAssessment,
  type ExecutionBinding,
  type ExecutionInput,
} from "../../src/contract/assessmentExecution";
import {
  appendExecutionEvent,
  createExecutionIfAbsent,
  findExecutionInput,
  recordFindingIfAbsent,
} from "../persistence/pilotExecutionStore";
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
/** A method label an execution from before the bump would carry. Not in the lineage registry. */
const OLDER_METHOD = "assess-2026.0-older";
const POLICY: AgentPolicySnapshot = {
  globalEnabled: true,
  disabledAgents: new Set<string>(),
  maxAttempts: 3,
  leaseMs: 30_000,
  retryDelayMs: () => 5,
};

describe.skipIf(!HAS_DB)("explicit re-assessment of a retained input", () => {
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

  const runtime = () =>
    new AgentRuntime({
      store: taskStore,
      policy: { current: () => POLICY },
      audit: { append: async () => {} },
      now: Date.now,
    });

  async function drive(boundaryId: string, executionId: string, max = 8) {
    for (let i = 0; i < max; i += 1) {
      const view = (await read(boundaryId, executionId)).json();
      if (view.state !== "queued") break;
      if ((await runtime().runNext(agent, `w-${uid()}`, boundaryId)) === null) break;
    }
    return (await read(boundaryId, executionId)).json();
  }

  const read = (boundaryId: string, executionId: string) =>
    app.inject({
      method: "GET",
      url: `/pilot/assessments/${encodeURIComponent(executionId)}?boundaryId=${encodeURIComponent(boundaryId)}`,
      headers: OPERATOR,
    });

  const reassess = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/pilot/assessments/reassess", headers: OPERATOR, payload });

  /**
   * The terms version a revision cites: newly registered, same reading, blessing the current method.
   *
   * This is the real post-bump workflow — a NEW governed version is proposed and activated to bless the
   * new method — and it is also what keeps the revision's identity distinct from any execution already
   * scheduled under the earlier version. Same `asOf`, threshold and currency, because a revision may
   * change only HOW the data is read, never WHAT is read.
   */
  const REVISION_TERMS_VERSION = "1.1.0";
  const revisionTerms = async (boundaryId: string) => {
    await ensureGovernedTerms(boundaryId, { termsVersion: REVISION_TERMS_VERSION });
    return { analysisTermsId: TEST_ANALYSIS_TERMS.termsId, analysisTermsVersion: REVISION_TERMS_VERSION };
  };

  /** The governed lead-up, an admitted dataset and one execution under the CURRENT method. */
  async function assessed() {
    const boundaryId = `pb-${uid()}`;
    const policyId = `pol-${uid()}`;
    await ensureGovernedTerms(boundaryId);
    expect(
      (await app.inject({
        method: "POST", url: "/pilot/admission-policies", headers: OPERATOR,
        payload: {
          boundaryId,
          policy: { policyId, policyVersion: "1.0.0", ...SCENARIO_POLICY, requiredLifecycleStates: [...SCENARIO_POLICY.requiredLifecycleStates] },
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
      boundaryId, datasetId: `ds-${uid()}`, declaredVersion: PILOT_DATA_CONTRACT_VERSION,
      csvText: syntheticPilotCsv(40), ...GOVERNED_TERMS_FIELDS, provenance: SYNTHETIC_PROVENANCE,
    };
    const submitted = (await app.inject({
      method: "POST", url: "/pilot/datasets", headers: OPERATOR,
      payload: { ...base, admissionPolicyId: policyId, admissionPolicyVersion: "1.0.0" },
    })).json();
    expect(submitted.admission.outcome).toBe("ADMISSIBLE");
    const scheduled = (await app.inject({
      method: "POST", url: "/pilot/assessments", headers: OPERATOR, payload: scheduleRequestFrom(base),
    })).json();
    expect(scheduled.scheduled, JSON.stringify(scheduled.refusalDetail)).toBe(true);
    return { boundaryId, policyId, base, current: scheduled };
  }

  /**
   * An execution as it would exist from BEFORE a calculation-method bump — WITH its historical result.
   *
   * Written through the production store with its own real binding hash and its own real id, because
   * that is what a pre-bump execution is: the same bytes, the same admission, the same reading — and an
   * older method. `inputHash` can be corrupted deliberately, which is how the unverifiable-input refusal
   * is reached (the input table permits purging but not editing).
   *
   * WHY THE RESULT IS WRITTEN RATHER THAN DRIVEN, and this is a fact about the system worth stating
   * plainly: a pre-bump execution CANNOT run on this build at all. Its binding froze `OLDER_METHOD`,
   * and the run-time compatibility gate blocks it `NH-AX-2006` before anything is computed — which is
   * precisely why re-assessment is the only route to a current-method answer for these bytes. So the
   * historical finding is recorded the way the pre-bump build recorded it: the same
   * `runProjectedAssessment` over the same input and the same reconstructed policy, under a binding
   * naming the older method, through the same append-only store, followed by the same CLAIMED →
   * COMPLETED lifecycle events. Driving the worker here would assert the opposite of what is true.
   *
   * No task is enqueued, because the run already happened. That also leaves the input purgeable, which
   * test 4 needs and the database would otherwise refuse while a claimable task exists.
   */
  async function preBumpExecution(
    from: Awaited<ReturnType<typeof assessed>>,
    over: { readonly corruptInputHash?: boolean; readonly leaveRunnable?: boolean } = {},
  ) {
    const stored = await findExecutionInput(from.current.executionId, from.boundaryId);
    expect(stored).not.toBeNull();
    const input: ExecutionInput = Object.freeze({ scheme: "nh-pilot-assessment-projection-v1", cycles: stored!.cycles });
    const binding: ExecutionBinding = Object.freeze({
      ...(from.current.binding as ExecutionBinding),
      assessmentPolicy: Object.freeze({
        ...(from.current.binding as ExecutionBinding).assessmentPolicy,
        policyVersion: "0.9.0",
        calculationMethodVersion: OLDER_METHOD,
      }),
    });
    const executionId = await deriveExecutionId(binding);
    const [bindingHash, inputHash] = await Promise.all([hashExecutionBinding(binding), hashExecutionInput(input)]);
    await createExecutionIfAbsent({
      executionId, binding, bindingHash,
      inputHash: over.corruptInputHash ? `sha256:${"0".repeat(64)}` : inputHash,
      input,
      scheduledByActorId: "pre-bump@company", scheduledByRole: "operator",
      attributions: [], sourceResolution: null,
    });
    if (over.leaveRunnable) {
      // For the one test that asks what happens when such an execution is handed to THIS build: a task
      // to claim, no result, no terminal event.
      await taskStore.enqueueIfAbsent({
        taskId: `TASK-${executionId}`,
        boundaryId: from.boundaryId,
        agentId: PILOT_ASSESSMENT_AGENT_ID,
        idempotencyKey: executionId,
        payload: { executionId },
        now: Date.now(),
      });
      return { executionId, binding };
    }

    // `makePolicy` on THIS build stamps THIS build's constant — the one field it does not take from
    // the binding — so the older method is restored onto the POLICY rather than patched onto the
    // finding afterwards. That is not cosmetic: `assessmentId` folds `policy.calculationMethodVersion`
    // in, so only this way does the historical finding carry the id the pre-bump build would have
    // derived, and the revision's own id legitimately differ from it.
    const historical = runProjectedAssessment({
      executionId,
      binding,
      input,
      policy: Object.freeze({
        ...makePolicy({
          policyId: binding.assessmentPolicy.policyId,
          policyVersion: binding.assessmentPolicy.policyVersion,
          stallThresholdDays: binding.assessmentPolicy.stallThresholdDays,
          asOf: binding.assessmentPolicy.asOf,
          currency: binding.assessmentPolicy.currency,
        }),
        calculationMethodVersion: OLDER_METHOD,
      }),
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    const recorded = await recordFindingIfAbsent({
      finding: historical,
      findingHash: await hashFinding(historical),
      producedBy: "pre-bump-build",
    });
    expect(recorded.created).toBe(true);
    for (const transition of ["CLAIMED", "COMPLETED"] as const) {
      await appendExecutionEvent({
        executionId, boundaryId: from.boundaryId, transition, code: null,
        byId: "pre-bump@company", detail: `pre-bump ${transition.toLowerCase()}`,
      });
    }
    return { executionId, binding };
  }

  // ── The complete flow ────────────────────────────────────────────────────────────────────────────

  it("0 · WHY THIS EXISTS · a pre-bump execution cannot run on this build at all", async () => {
    // The fact the whole slice rests on, asserted rather than assumed. Handed to this build, an
    // execution whose binding froze an older method is BLOCKED before anything is computed — so there
    // is no "just re-run it", and a revision under a new binding is the only honest route to a
    // current-method answer for these bytes. It is also why the fixture below records the historical
    // result instead of driving the worker: driving it would assert the opposite of what is true.
    const from = await assessed();
    const old = await preBumpExecution(from, { leaveRunnable: true });
    const view = await drive(from.boundaryId, old.executionId);
    expect(view.state).toBe("blocked");
    expect(view.code).toBe("NH-AX-2006");
    expect(view.finding).toBeNull();
  });

  it("1 · re-assesses a pre-bump execution under the current method, as a LINKED revision", async () => {
    const from = await assessed();
    const old = await preBumpExecution(from);
    // The historical result exists and is terminal — there is something to preserve.
    const oldBefore = (await read(from.boundaryId, old.executionId)).json();
    expect(oldBefore.state).toBe("completed");
    expect(oldBefore.finding).not.toBeNull();

    const res = await reassess({
      boundaryId: from.boundaryId,
      executionId: old.executionId,
      ...(await revisionTerms(from.boundaryId)),
      reason: "the calculation method moved; re-scoring the retained input under the current one",
    });
    expect(res.statusCode).toBe(201);
    const out = res.json();
    expect(out.reassessed).toBe(true);
    expect(out.revisesExecutionId).toBe(old.executionId);
    expect(out.executionId).not.toBe(old.executionId);
    // ON THE ROW, not only in the response. A response that reports a link the database does not hold
    // would read as a linked revision while leaving an orphan behind — and F37 proved this assertion is
    // the one that notices, because the response field is computed from the request either way.
    const revisionRow = await prisma.pilotAssessmentExecutionRecord.findFirstOrThrow({ where: { executionId: out.executionId } });
    expect(revisionRow.revisesExecutionId).toBe(old.executionId);
    expect(revisionRow.revisionReason).toBe("the calculation method moved; re-scoring the retained input under the current one");

    // WHAT CHANGED, derived rather than narrated — and nothing that must not.
    expect(out.delta.unexpectedChanges).toEqual([]);
    const changed = Object.fromEntries(out.delta.changed.map((c: { field: string; after: string }) => [c.field, c.after]));
    expect(changed.calculationMethodVersion).toBe(ASSESSMENT_CALC_VERSION);
    const before = Object.fromEntries(out.delta.changed.map((c: { field: string; before: string }) => [c.field, c.before]));
    expect(before.calculationMethodVersion).toBe(OLDER_METHOD);

    // NO FILE WAS RE-SUPPLIED, and the revision carries the SAME input, byte-identical.
    const oldInput = await findExecutionInput(old.executionId, from.boundaryId);
    const newInput = await findExecutionInput(out.executionId, from.boundaryId);
    expect(newInput!.cycles).toEqual(oldInput!.cycles);

    // The revision runs and produces its OWN finding.
    const revised = await drive(from.boundaryId, out.executionId);
    expect(revised.state).toBe("completed");
    expect(revised.finding).not.toBeNull();
    expect(revised.finding.finding.calculationMethodVersion).toBe(ASSESSMENT_CALC_VERSION);
  });

  it("2 · HISTORICAL PRESERVATION · the earlier execution and finding are untouched and still readable", async () => {
    // The claim that makes this a revision rather than a replacement, asserted on the rows.
    const from = await assessed();
    const old = await preBumpExecution(from);
    const beforeRow = await prisma.pilotAssessmentExecutionRecord.findFirstOrThrow({ where: { executionId: old.executionId } });
    const beforeFinding = await prisma.pilotAssessmentFindingRecord.findFirstOrThrow({ where: { executionId: old.executionId } });

    const out = (await reassess({
      boundaryId: from.boundaryId, executionId: old.executionId,
      ...(await revisionTerms(from.boundaryId)),
      reason: "re-score under the current method",
    })).json();
    await drive(from.boundaryId, out.executionId);

    // BYTE-IDENTICAL, both rows.
    expect(await prisma.pilotAssessmentExecutionRecord.findFirstOrThrow({ where: { executionId: old.executionId } })).toEqual(beforeRow);
    expect(await prisma.pilotAssessmentFindingRecord.findFirstOrThrow({ where: { executionId: old.executionId } })).toEqual(beforeFinding);
    // Still readable at its own identifier, still carrying its own method and its own finding.
    const stillThere = (await read(from.boundaryId, old.executionId)).json();
    expect(stillThere.finding.finding.calculationMethodVersion).toBe(OLDER_METHOD);
    expect(stillThere.revises).toBeNull();
    // TWO FINDINGS now exist for these bytes, not one replaced by another — asserted on the two
    // identifiers rather than on a boundary-wide count, because the worker claims any task in the
    // boundary and a count would be measuring unrelated runs as well.
    const findings = await prisma.pilotAssessmentFindingRecord.findMany({
      where: { boundaryId: from.boundaryId, executionId: { in: [old.executionId, out.executionId] } },
    });
    expect(findings.length).toBe(2);
    expect(new Set(findings.map((f) => f.assessmentId)).size).toBe(2);
  });

  it("3 · the READ of the revision shows what changed, why, and that the earlier result survives", async () => {
    const from = await assessed();
    const old = await preBumpExecution(from);
    const reason = "the method moved from 2026.0 to 2026.1; finance asked for the current basis";
    const out = (await reassess({
      boundaryId: from.boundaryId, executionId: old.executionId,
      ...(await revisionTerms(from.boundaryId)),
      reason,
    })).json();

    const view = (await read(from.boundaryId, out.executionId)).json();
    expect(view.revises.executionId).toBe(old.executionId);
    expect(view.revises.reason).toBe(reason);
    expect(view.revises.delta.unexpectedChanges).toEqual([]);
    expect(view.revises.delta.changed.map((c: { field: string }) => c.field)).toContain("calculationMethodVersion");
    // "The earlier result is still there" is the claim that makes this a revision, so it is reported
    // rather than left to be taken on trust.
    expect(view.revises.previousFindingExists).toBe(true);
  });

  // ── Refusals ─────────────────────────────────────────────────────────────────────────────────────

  it("4 · a PURGED or absent input is refused NH-AX-1015 — re-submit instead", async () => {
    const from = await assessed();
    const old = await preBumpExecution(from);
    // A RECORDED PURGE is the only way an input legitimately disappears: the table's trigger rejects a
    // DELETE unless this execution's purge authorization already exists. Modelling it any other way
    // would be modelling something the database forbids.
    const inputRow = await prisma.pilotAssessmentExecutionInputRecord.findFirstOrThrow({ where: { executionId: old.executionId } });
    await prisma.pilotAssessmentInputPurgeRecord.create({
      data: {
        executionId: old.executionId, boundaryId: from.boundaryId,
        // A CLOSED SET, enforced by a CHECK constraint, and the INSERT is validated by a trigger
        // against the event log: `terminal_completed` is accepted only because a COMPLETED event
        // exists, with a zero grace window so the elapsed bound is satisfied, and only because no
        // claimable task remains. A purge cannot be asserted from a fact that is not the fact.
        reason: "terminal_completed", inputHash: inputRow.inputHash, cycleCount: inputRow.cycleCount,
        terminalGraceHours: 0, abandonedRetentionDays: 0,
        authorizedByActorId: STEWARD["x-actor-id"], authorizedByRole: "steward",
      },
    });
    await prisma.pilotAssessmentExecutionInputRecord.delete({ where: { executionId: old.executionId } });
    const out = (await reassess({
      boundaryId: from.boundaryId, executionId: old.executionId,
      ...(await revisionTerms(from.boundaryId)),
      reason: "re-score",
    })).json();
    expect(out.reassessed).toBe(false);
    expect(out.refusal.code).toBe("NH-AX-1015");
    expect(out.refusal.remediation).toMatch(/Re-submit the dataset/);
    // The detail names the purge rather than saying "absent": collected on schedule is a different fact
    // from "there is no input and no record of one".
    expect(out.refusalDetail).toMatch(/purged under the retention policy/);
    // And no revision was created.
    expect(await prisma.pilotAssessmentExecutionRecord.count({ where: { revisesExecutionId: old.executionId } })).toBe(0);
  });

  it("5 · an UNVERIFIABLE input is refused NH-AX-1015, on the same code and a different detail", async () => {
    // Present but not the input the earlier finding was computed from. Re-assessing it would compute a
    // new result from rows the earlier one never saw, under the earlier one's lineage.
    const from = await assessed();
    const old = await preBumpExecution(from, { corruptInputHash: true });
    const out = (await reassess({
      boundaryId: from.boundaryId, executionId: old.executionId,
      ...(await revisionTerms(from.boundaryId)),
      reason: "re-score",
    })).json();
    expect(out.refusal.code).toBe("NH-AX-1015");
    expect(out.refusalDetail).toMatch(/does not match its recorded hash/);
  });

  it("6 · terms that change WHAT IS MEASURED are refused NH-AX-1016 — re-submit instead", async () => {
    // A different cut-off is a different reading of the same data, and the admission was for the old one.
    const from = await assessed();
    const old = await preBumpExecution(from);
    await ensureGovernedTerms(from.boundaryId, { termsVersion: "2.0.0", asOf: "2026-05-15" });
    const out = (await reassess({
      boundaryId: from.boundaryId, executionId: old.executionId,
      analysisTermsId: TEST_ANALYSIS_TERMS.termsId, analysisTermsVersion: "2.0.0",
      reason: "re-score",
    })).json();
    expect(out.refusal.code).toBe("NH-AX-1016");
    expect(out.refusalDetail).toContain("asOf");
    expect(out.refusal.remediation).toMatch(/Re-submit the extract/);
  });

  it("7 · terms naming the method already used are refused NH-AX-1017 — nothing to do", async () => {
    const from = await assessed();
    const out = (await reassess({
      boundaryId: from.boundaryId, executionId: from.current.executionId,
      analysisTermsId: TEST_ANALYSIS_TERMS.termsId, analysisTermsVersion: TEST_ANALYSIS_TERMS.termsVersion,
      reason: "re-score",
    })).json();
    expect(out.refusal.code).toBe("NH-AX-1017");
    expect(await prisma.pilotAssessmentExecutionRecord.count({ where: { revisesExecutionId: from.current.executionId } })).toBe(0);
  });

  it("8 · terms blessed for an UNDECLARED method are blocked NH-AX-1014", async () => {
    // UNKNOWN COMPATIBILITY IS BLOCKED. The lineage cannot say what that method does, so it cannot
    // claim its answers match this build's — and a fingerprint would not have settled it either.
    const from = await assessed();
    const old = await preBumpExecution(from);
    await ensureGovernedTerms(from.boundaryId, {
      termsVersion: "3.0.0",
      calculationMethodVersion: "assess-9999.9-undeclared",
    });
    const out = (await reassess({
      boundaryId: from.boundaryId, executionId: old.executionId,
      analysisTermsId: TEST_ANALYSIS_TERMS.termsId, analysisTermsVersion: "3.0.0",
      reason: "re-score",
    })).json();
    expect(out.refusal.code).toBe("NH-AX-1014");
    expect(out.refusalDetail).toMatch(/does not declare them equivalent/);
  });

  it("9 · GOVERNANCE is re-checked now: a frozen bar refuses the revision NH-AX-1007", async () => {
    const from = await assessed();
    const old = await preBumpExecution(from);
    expect(
      (await app.inject({
        method: "POST", url: "/pilot/admission-policies/freeze", headers: STEWARD,
        payload: { boundaryId: from.boundaryId, policyId: from.policyId, policyVersion: "1.0.0", rationale: "paused" },
      })).statusCode,
    ).toBe(200);
    const out = (await reassess({
      boundaryId: from.boundaryId, executionId: old.executionId,
      ...(await revisionTerms(from.boundaryId)),
      reason: "re-score",
    })).json();
    expect(out.refusal.code).toBe("NH-AX-1007");
  });

  it("10 · a BLANK reason is refused at the transport, and another tenant's execution is not found", async () => {
    const from = await assessed();
    const old = await preBumpExecution(from);
    const blank = await reassess({
      boundaryId: from.boundaryId, executionId: old.executionId,
      ...(await revisionTerms(from.boundaryId)),
      reason: "   ",
    });
    expect(blank.statusCode).toBe(400);

    const other = await reassess({
      boundaryId: `pb-${uid()}`, executionId: old.executionId,
      ...(await revisionTerms(from.boundaryId)),
      reason: "re-score",
    });
    expect(other.statusCode).toBe(404);
  });

  it("10b · a binding that ALREADY EXISTS independently is refused NH-AX-1018, not relabelled", async () => {
    // An execution's identity IS its binding, so a revision can land on a row someone scheduled
    // directly. Writing a revision link onto it would claim it was produced by re-assessing this
    // execution, which it was not — and there is no second identity available for identical content.
    //
    // FOUND BY A FIXTURE that arrived at exactly this collision: citing the terms the original execution
    // already used re-derives the original's identity. That is correct behaviour and a wrong answer to
    // report as "revision created".
    const from = await assessed();
    const old = await preBumpExecution(from);
    const out = (await reassess({
      boundaryId: from.boundaryId,
      executionId: old.executionId,
      // The terms the ORIGINAL execution was scheduled under — so the revision's binding is the
      // original's binding, exactly.
      analysisTermsId: TEST_ANALYSIS_TERMS.termsId,
      analysisTermsVersion: TEST_ANALYSIS_TERMS.termsVersion,
      reason: "re-score",
    })).json();
    expect(out.reassessed).toBe(false);
    expect(out.refusal.code).toBe("NH-AX-1018");
    expect(out.refusalDetail).toContain(from.current.executionId);
    // The pre-existing execution was NOT relabelled as a revision.
    const row = await prisma.pilotAssessmentExecutionRecord.findFirstOrThrow({ where: { executionId: from.current.executionId } });
    expect(row.revisesExecutionId).toBeNull();
  });

  it("11 · the revision is IDEMPOTENT — asking twice yields one execution, not two findings", async () => {
    const from = await assessed();
    const old = await preBumpExecution(from);
    const body = {
      boundaryId: from.boundaryId, executionId: old.executionId,
      ...(await revisionTerms(from.boundaryId)),
      reason: "re-score under the current method",
    };
    const first = await reassess(body);
    const again = await reassess(body);
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200); // nothing new was created
    expect(again.json().executionId).toBe(first.json().executionId);
    expect(again.json().created).toBe(false);
    expect(
      await prisma.pilotAssessmentExecutionRecord.count({ where: { revisesExecutionId: old.executionId } }),
    ).toBe(1);
  });
});
