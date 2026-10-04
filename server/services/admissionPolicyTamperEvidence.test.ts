// The admission-policy register is now tamper-evident at READ time, like the analysis-terms register.
//
// THE ASYMMETRY THIS CLOSES. `resolveGovernedAnalysisTerms` verifies `analysisTermsHashMatches` on every
// resolve and refuses rather than recomputing, with the reason stated in its own comment: "the row is
// append-only and the hash was computed from the definition when it was proposed, so a stored hash that
// no longer matches the stored values means the row changed after it was blessed — by a migration, a
// restore or a bug. Recomputing and carrying on would launder that change into the next finding."
//
// The admission-policy register had the identical exposure and did the opposite: `hashAdmissionPolicy`
// ran in exactly ONE production place — registration — while the judging path read `stored.policyHash`
// and trusted it. `policyHashMatches` existed with no production caller at all. So one register was
// tamper-evident and the other was trusted as stored, for no stated reason, and an altered bar could
// reach an admission verdict whose `PAD-` then froze the altered hash forever.
//
// BOTH TABLES CARRY APPEND-ONLY TRIGGERS. That is precisely why a tampered row is MODELLED by inserting
// the row the tamper would have produced: the application cannot UPDATE one, which is the guarantee, and
// the residual exposure is the migration/restore/bug set the terms register already refuses to treat as
// acceptable for itself.
//
// WHAT THIS DOES NOT DO. It refuses nothing today — every row the application has ever written hashes to
// its own values, which the whole existing suite re-proves. It is a latent guard, like the
// calculation-method gates, and it is checked FIRST so no other question is asked about a row that
// failed its own witness.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { SYNTHETIC_PROVENANCE, syntheticPilotCsv, SCENARIO_POLICY } from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../src/contract/pilotDataContract";
import { ADMISSION_EVALUATOR_VERSION } from "../../src/contract/admissionGate";
import { ADMISSION_CALC_VERSION, makeAdmissionPolicy } from "../../src/contract/pilotAdmissionPolicy";
import { hashAdmissionPolicy } from "../../src/contract/policyHash";
import { ensureGovernedTerms, GOVERNED_TERMS_FIELDS } from "../test/governedTerms";

const HAS_DB = !!process.env.DATABASE_URL;
const OPERATOR = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
const STEWARD = { "x-actor-id": "gov@company", "x-actor-role": "steward" };
const uid = () => Math.random().toString(36).slice(2, 10);
const THRESHOLDS = Object.freeze({
  ...SCENARIO_POLICY,
  requiredLifecycleStates: [...SCENARIO_POLICY.requiredLifecycleStates],
});

describe.skipIf(!HAS_DB)("the admission-policy register is tamper-evident at read time", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /**
   * Write a policy row directly, with a stored hash that may or may not match its own values.
   *
   * `storedHashOf` decides which definition the stored witness was computed from. Passing a DIFFERENT
   * threshold set is exactly what a migration that edited the row would leave behind: values that moved,
   * a witness that did not.
   */
  async function policyRow(opts: {
    readonly boundaryId: string;
    readonly policyId: string;
    readonly storedHashOf?: Record<string, unknown>;
    /** The calculation-method label the row carries. Defaults to what the server stamps today. */
    readonly calculationMethodVersion?: string;
    /** Write a PROPOSED event, so the row is DRAFT and the lifecycle permits activation. */
    readonly propose?: boolean;
    /** Write PROPOSED + ACTIVATED, so the row is already ACTIVE. */
    readonly activate?: boolean;
  }) {
    const actual = makeAdmissionPolicy({
      policyId: opts.policyId,
      policyVersion: "1.0.0",
      calculationMethodVersion: opts.calculationMethodVersion ?? ADMISSION_EVALUATOR_VERSION,
      ...THRESHOLDS,
    });
    const witnessed = makeAdmissionPolicy({
      policyId: opts.policyId,
      policyVersion: "1.0.0",
      calculationMethodVersion: opts.calculationMethodVersion ?? ADMISSION_EVALUATOR_VERSION,
      ...THRESHOLDS,
      ...(opts.storedHashOf ?? {}),
    } as never);
    await prisma.pilotAdmissionPolicyRecord.create({
      data: {
        boundaryId: opts.boundaryId,
        policyId: actual.policyId,
        policyVersion: actual.policyVersion,
        calculationMethodVersion: actual.calculationMethodVersion,
        minAcceptedRows: actual.minAcceptedRows,
        minDistinctEntities: actual.minDistinctEntities,
        maxRejectionRate: actual.maxRejectionRate,
        maxSingleReasonShare: actual.maxSingleReasonShare,
        maxDuplicateRate: actual.maxDuplicateRate,
        minCoverageDays: actual.minCoverageDays,
        requiredLifecycleStates: [...actual.requiredLifecycleStates],
        maxOrderingDefectRate: actual.maxOrderingDefectRate,
        maxMissingRecommendedColumns: actual.maxMissingRecommendedColumns,
        requireProvenanceDeclaration: actual.requireProvenanceDeclaration,
        policyHash: await hashAdmissionPolicy(witnessed),
        registeredByActorId: "constructed@company",
        registeredByRole: "operator",
      },
    });
    if (opts.propose) {
      await prisma.pilotAdmissionPolicyEventRecord.create({
        data: {
          id: `PPE-${Date.now()}-${uid()}`,
          boundaryId: opts.boundaryId,
          policyId: actual.policyId,
          policyVersion: "1.0.0",
          transition: "PROPOSED",
          actorId: "constructed@company",
          actorRole: "operator",
          rationale: "constructed fixture",
        },
      });
    }
    if (opts.activate) {
      // PROPOSED then ACTIVATED, by two identities, written directly: the row was blessed and put in
      // force while it was sound, and only then did its values move. That is the realistic shape, and it
      // is the one in which being able to FREEZE matters most.
      for (const [transition, actorId] of [["PROPOSED", "constructed@company"], ["ACTIVATED", STEWARD["x-actor-id"]]] as const) {
        await prisma.pilotAdmissionPolicyEventRecord.create({
          data: {
            id: `PPE-${Date.now()}-${uid()}`,
            boundaryId: opts.boundaryId,
            policyId: actual.policyId,
            policyVersion: "1.0.0",
            transition,
            actorId,
            actorRole: transition === "PROPOSED" ? "operator" : "steward",
            rationale: "constructed fixture",
          },
        });
      }
    }
    return { policyId: actual.policyId };
  }

  const submit = async (boundaryId: string, policyId: string) => {
    await ensureGovernedTerms(boundaryId);
    return (
      await app.inject({
        method: "POST", url: "/pilot/datasets", headers: OPERATOR,
        payload: {
          boundaryId, datasetId: `ds-${uid()}`, declaredVersion: PILOT_DATA_CONTRACT_VERSION,
          csvText: syntheticPilotCsv(40), provenance: SYNTHETIC_PROVENANCE, ...GOVERNED_TERMS_FIELDS,
          admissionPolicyId: policyId, admissionPolicyVersion: "1.0.0",
        },
      })
    ).json();
  };

  const move = (boundaryId: string, policyId: string, transition: string) =>
    app.inject({
      method: "POST",
      url: `/pilot/admission-policies/${transition}`,
      headers: STEWARD,
      payload: { boundaryId, policyId, policyVersion: "1.0.0", rationale: "governance act" },
    });


  const readGovernance = (boundaryId: string, policyId: string) =>
    app.inject({
      method: "GET",
      url: `/pilot/admission-policies/governance?boundaryId=${encodeURIComponent(boundaryId)}&policyId=${encodeURIComponent(policyId)}&policyVersion=1.0.0`,
      headers: STEWARD,
    });

  it("1 · POSITIVE CONTROL · a SOUND constructed row is activated and judges normally", async () => {
    // Same construction, same thresholds, one difference in test 2: which definition the stored witness
    // was computed from. Without this, test 2 would prove only that a hand-built row cannot judge.
    const boundaryId = `pb-${uid()}`;
    const { policyId } = await policyRow({ boundaryId, policyId: `pol-${uid()}`, propose: true });
    expect((await move(boundaryId, policyId, "activate")).statusCode).toBe(200);
    const out = await submit(boundaryId, policyId);
    expect(out.admissionGovernanceRefusal).toBeNull();
    expect(out.admissionPolicyState).toBe("ACTIVE");
    expect(out.admission.outcome).toBe("ADMISSIBLE");
  });

  it("2 · a row that no longer hashes to its own definition judges NOTHING", async () => {
    const boundaryId = `pb-${uid()}`;
    const { policyId } = await policyRow({
      boundaryId,
      policyId: `pol-${uid()}`,
      // The witness was computed from a stricter bar than the row now holds — the shape a migration
      // that relaxed a threshold would leave.
      storedHashOf: { minAcceptedRows: THRESHOLDS.minAcceptedRows + 11 },
      activate: true,
    });
    const out = await submit(boundaryId, policyId);
    expect(out.admissionGovernanceRefusal).toMatch(/no longer hashes to the definition it was registered with/);
    expect(out.admissionGovernanceRefusal).toContain(policyId);
    expect(out.admission.outcome).toBe("NOT_ASSESSABLE");
    expect(out.admission.admissibleForPilotAssessment).toBe(false);
    // The lifecycle of a row that fails its own witness is not reported: saying "ACTIVE" would dress it
    // as ordinarily governed. Same shape as `resolveGovernedAnalysisTerms`, which returns `state: null`.
    expect(out.admissionPolicyState).toBeNull();
    expect(out.admissionPolicyHash).toBeNull();
    // THE DATASET ROW IS STILL WRITTEN, and that is correct: the file was validated, and fitness is a
    // separate verdict that an unusable file would not even reach. What matters is that the recorded
    // decision cites NO policy and NO hash, so nothing downstream can bind an execution to it — the
    // scheduler refuses `NH-AX-1003` on an outcome that is not ADMISSIBLE, and `NH-AX-1004`-style
    // binding to a policy it never named is not expressible.
    const row = await prisma.pilotDatasetSubmissionRecord.findFirstOrThrow({ where: { boundaryId } });
    expect(row.admissionOutcome).toBe("NOT_ASSESSABLE");
    expect(row.admissionPolicyId).toBeNull();
    expect(row.admissionPolicyVersion).toBeNull();
    expect(row.admissionPolicyHash).toBeNull();
    // The tampered row's own hash never reached the submission record.
    const stored = await prisma.pilotAdmissionPolicyRecord.findFirstOrThrow({ where: { boundaryId, policyId } });
    expect(row.admissionPolicyHash).not.toBe(stored.policyHash);
  });

  it("3 · the refusal is NOT the lifecycle refusal and NOT the anti-tuning refusal", async () => {
    // Three different governance facts share one response field, so the message has to distinguish them
    // or an operator cannot tell "nobody activated this" from "this row changed under you".
    const boundaryId = `pb-${uid()}`;
    const { policyId } = await policyRow({
      boundaryId, policyId: `pol-${uid()}`,
      storedHashOf: { minCoverageDays: THRESHOLDS.minCoverageDays + 5 }, activate: true,
    });
    const out = await submit(boundaryId, policyId);
    expect(out.admissionGovernanceRefusal).not.toMatch(/draft|frozen|retired|not been activated/i);
    expect(out.admissionGovernanceRefusal).not.toMatch(/activated after this dataset/i);
  });

  it("4 · a tampered row cannot be PUT IN FORCE", async () => {
    const boundaryId = `pb-${uid()}`;
    // PROPOSED, so it is DRAFT and the lifecycle would otherwise permit activation. Without that the
    // 409 would be attributable to "cannot move from no state" and would prove nothing about the hash.
    const { policyId } = await policyRow({
      boundaryId, policyId: `pol-${uid()}`,
      storedHashOf: { maxRejectionRate: 0.99 }, propose: true,
    });
    const res = await move(boundaryId, policyId, "activate");
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/no longer hashes to the definition/);
    // It did not become ACTIVE, so it cannot judge by that route either.
    expect(
      await prisma.pilotAdmissionPolicyEventRecord.count({ where: { boundaryId, transition: "ACTIVATED" } }),
    ).toBe(0);
  });

  it("5 · but governance can still FREEZE and RETIRE one — stopping it must never be blocked", async () => {
    // THE ASYMMETRY THAT MATTERS. Refusing every transition on a suspect row would leave governance
    // unable to stop the very thing it just discovered. Only the transitions that GRANT evaluation
    // authority are refused; the ones that withdraw it are exactly what should still work.
    const boundaryId = `pb-${uid()}`;
    const { policyId } = await policyRow({
      boundaryId, policyId: `pol-${uid()}`,
      storedHashOf: { maxDuplicateRate: 0.44 }, activate: true,
    });
    expect((await move(boundaryId, policyId, "freeze")).statusCode).toBe(200);
    // ...and UNFREEZE is refused, because that would put it back in force.
    const unfroze = await move(boundaryId, policyId, "unfreeze");
    expect(unfroze.statusCode).toBe(409);
    expect(unfroze.json().message).toMatch(/no longer hashes to the definition/);
    // RETIRE, from FROZEN, is terminal and allowed.
    expect((await move(boundaryId, policyId, "retire")).statusCode).toBe(200);
  });

  it("6 · the check is FIRST, so a tampered row is never asked anything else", async () => {
    // A row that is both tampered AND never activated must report the tamper, not the lifecycle. The
    // order is the diagnosis: "this row changed" outranks "nobody put it in force", because the second
    // invites re-registering over it and the first forbids that.
    const boundaryId = `pb-${uid()}`;
    const { policyId } = await policyRow({
      boundaryId, policyId: `pol-${uid()}`,
      storedHashOf: { minDistinctEntities: THRESHOLDS.minDistinctEntities + 3 },
      // NOT activated: no lifecycle events at all.
    });
    const out = await submit(boundaryId, policyId);
    expect(out.admissionGovernanceRefusal).toMatch(/no longer hashes to the definition/);
    expect(out.admissionPolicyState).toBeNull();
  });
  it("7 · the governance READ reports INTEGRITY and BOTH HASHES, instead of hiding the row", async () => {
    // REVISED DELIBERATELY. This surface briefly refused a suspect row outright, which was the wrong
    // shape for the one surface whose job is to let someone LOOK at one: refusing to show it leaves
    // direct database access as the only way to inspect the anomaly. It now returns the row with its
    // integrity STATED and both hashes, so an auditor can see whether a single field moved or the whole
    // definition was replaced, and can check the comparison themselves.
    //
    // What must never happen is the row reading as sound. An explicit `integrity` block is a stronger
    // guard against that than an absent one — and the refusals that matter are untouched, which tests
    // 2 and 4 still hold.
    const boundaryId = `pb-${uid()}`;
    const { policyId } = await policyRow({
      boundaryId, policyId: `pol-${uid()}`,
      storedHashOf: { maxSingleReasonShare: 0.11 }, activate: true,
    });
    const res = await readGovernance(boundaryId, policyId);
    expect(res.statusCode).toBe(200);
    const view = res.json();
    expect(view.integrity.status).toBe("MISMATCH");
    expect(view.integrity.storedHash).toBe(view.policyHash);
    expect(view.integrity.computedHash).not.toBe(view.integrity.storedHash);
    expect(view.integrity.computedHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(view.integrity.detail).toMatch(/changed after it was registered/);
    // The lifecycle is visible too — an auditor needs to know a tampered row is ACTIVE, which is
    // precisely the fact that makes it urgent.
    expect(view.state).toBe("ACTIVE");
  });

  it("7b · POSITIVE CONTROL · a sound row reports INTACT, with the two hashes equal", async () => {
    // Without this, test 7 would pass against a surface that reported MISMATCH for everything.
    const boundaryId = `pb-${uid()}`;
    const { policyId } = await policyRow({ boundaryId, policyId: `pol-${uid()}`, propose: true });
    const view = (await readGovernance(boundaryId, policyId)).json();
    expect(view.integrity.status).toBe("INTACT");
    expect(view.integrity.computedHash).toBe(view.integrity.storedHash);
    expect(view.integrity.detail).toBeNull();
  });

  it("8 · a suspect row stays inspectable AND stoppable, but gains no authority", async () => {
    // The three properties together, on one row: visible, unable to judge, unable to be put in force,
    // and still stoppable. Any one of them alone is not the guarantee.
    const boundaryId = `pb-${uid()}`;
    const { policyId } = await policyRow({
      boundaryId, policyId: `pol-${uid()}`,
      storedHashOf: { minCoverageDays: THRESHOLDS.minCoverageDays + 9 }, activate: true,
    });
    // inspectable
    expect((await readGovernance(boundaryId, policyId)).json().integrity.status).toBe("MISMATCH");
    // judges nothing
    expect((await submit(boundaryId, policyId)).admission.outcome).toBe("NOT_ASSESSABLE");
    // cannot regain authority
    expect((await move(boundaryId, policyId, "freeze")).statusCode).toBe(200);
    expect((await move(boundaryId, policyId, "unfreeze")).statusCode).toBe(409);
    // ...and stopping it works
    expect((await move(boundaryId, policyId, "retire")).statusCode).toBe(200);
  });

  it("9 · POSITIVE CONTROL · a HISTORICAL row keeps its retired label and passes ALL THREE paths", async () => {
    // "Preserve historical calculationMethodVersion values" proven behaviourally rather than asserted.
    // A row recorded before the provenance correction carries "admission-2026.1". It is correctly hashed
    // FROM that value, so it must still read, still activate, and still judge — verification checks a row
    // against its OWN witness, never against what this build would stamp today.
    const boundaryId = `pb-${uid()}`;
    const { policyId } = await policyRow({
      boundaryId, policyId: `pol-${uid()}`,
      calculationMethodVersion: ADMISSION_CALC_VERSION, propose: true,
    });
    const row = await prisma.pilotAdmissionPolicyRecord.findFirstOrThrow({ where: { boundaryId, policyId } });
    expect(row.calculationMethodVersion).toBe("admission-2026.1");
    expect(row.calculationMethodVersion).not.toBe(ADMISSION_EVALUATOR_VERSION);

    // 1 · read
    const view = await readGovernance(boundaryId, policyId);
    expect(view.statusCode).toBe(200);
    expect(view.json().policyHash).toBe(row.policyHash);
    // 2 · put in force
    expect((await move(boundaryId, policyId, "activate")).statusCode).toBe(200);
    // 3 · judge
    const out = await submit(boundaryId, policyId);
    expect(out.admissionGovernanceRefusal).toBeNull();
    expect(out.admission.outcome).toBe("ADMISSIBLE");
    // The row was NOT restamped, repaired or rewritten by any of the three.
    const after = await prisma.pilotAdmissionPolicyRecord.findFirstOrThrow({ where: { boundaryId, policyId } });
    expect(after.calculationMethodVersion).toBe("admission-2026.1");
    expect(after.policyHash).toBe(row.policyHash);
  });
});
