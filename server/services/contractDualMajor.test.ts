// EP-27 · §10's two-major promise, at the two places it has to be true: what the database records about a
// decision's contract, and whether a decision made under one version may still be executed.
//
// The promise is "two majors are supported concurrently for at least one full pilot cycle". Honouring it
// requires three things this suite measures rather than asserts:
//
//   1. the DECLARED version is persisted, so which contract judged a dataset is auditable per decision;
//   2. the schedule-time re-check asks whether this build can still interpret that contract, NOT whether
//      the version strings match — the old exact-equality check refused execution after a PATCH bump;
//   3. a version the build cannot interpret is still refused, with its own code.
//
// Reasoning and the rejected alternatives: docs/CONTRACT_DUAL_MAJOR_V1.md.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { SYNTHETIC_PROVENANCE, syntheticPilotCsv, SCENARIO_POLICY } from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../src/contract/pilotDataContract";
import { ADMISSION_CALC_VERSION } from "../../src/contract/pilotAdmissionPolicy";
import { ensureGovernedTerms, GOVERNED_TERMS_FIELDS } from "../test/governedTerms";

const HAS_DB = !!process.env.DATABASE_URL;
const OPERATOR = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
const STEWARD = { "x-actor-id": "gov@company", "x-actor-role": "steward" };
const uid = () => Math.random().toString(36).slice(2, 10);

describe.skipIf(!HAS_DB)("EP-27 · §10's two-major window, where it has to hold", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function activeBar(boundaryId: string) {
    const policyId = `pol-${uid()}`;
    expect(
      (await app.inject({
        method: "POST",
        url: "/pilot/admission-policies",
        headers: OPERATOR,
        payload: {
          boundaryId,
          policy: {
            policyId,
            policyVersion: "1.0.0",
            calculationMethodVersion: ADMISSION_CALC_VERSION,
            ...SCENARIO_POLICY,
            requiredLifecycleStates: [...SCENARIO_POLICY.requiredLifecycleStates],
          },
          rationale: "fixture",
        },
      })).statusCode,
    ).toBe(201);
    expect(
      (await app.inject({
        method: "POST",
        url: "/pilot/admission-policies/activate",
        headers: STEWARD,
        payload: { boundaryId, policyId, policyVersion: "1.0.0", rationale: "reviewed" },
      })).statusCode,
    ).toBe(200);
    return policyId;
  }

  async function admittedDataset(declaredVersion = PILOT_DATA_CONTRACT_VERSION) {
    const boundaryId = `pb-${uid()}`;
    const datasetId = `ds-${uid()}`;
    const csvText = syntheticPilotCsv(40);
    await ensureGovernedTerms(boundaryId);
    const policyId = await activeBar(boundaryId);

    const submitted = await app.inject({
      method: "POST",
      url: "/pilot/datasets",
      headers: OPERATOR,
      payload: {
        boundaryId,
        datasetId,
        declaredVersion,
        csvText,
        provenance: SYNTHETIC_PROVENANCE,
        ...GOVERNED_TERMS_FIELDS,
        admissionPolicyId: policyId,
        admissionPolicyVersion: "1.0.0",
      },
    });
    return { boundaryId, datasetId, csvText, submitted };
  }

  const schedule = (
    boundaryId: string,
    datasetId: string,
    csvText: string,
    // S4 · When given, scheduling anchors on the decision instead of re-discovering it from the fields
    // below. A row whose contract MAJOR differs from this build's can only be reached this way: the
    // discovery key embeds the build's major, so it would simply not be found.
    admissionDecisionId?: string,
  ) =>
    app.inject({
      method: "POST",
      url: "/pilot/assessments",
      headers: OPERATOR,
      payload: {
        // S5 · no `declaredVersion`: the scheduling body has no such field, and this suite is
        // precisely about reading the admitted version from the stored decision instead.
        boundaryId,
        datasetId,
        csvText,
        provenance: SYNTHETIC_PROVENANCE,
        ...GOVERNED_TERMS_FIELDS,
        ...(admissionDecisionId ? { admissionDecisionId } : {}),
      },
    });

  /**
   * Write a decision row directly, as a build serving another contract version would have written it.
   *
   * NOT an UPDATE: `pilot_dataset_submissions` carries an append-only trigger, so an already-written
   * decision cannot be edited — which is the guarantee, and it is why this inserts instead. Every field is
   * computed with the real contract and the real decision-id derivation, so the ONLY anomaly in the row is
   * the version. Test 4a is the positive control that proves that: the same construction with a supported
   * version schedules successfully, so a refusal in 4b is attributable to the version and to nothing else.
   */
  async function insertDecisionRow(opts: {
    readonly declaredVersion: string | null;
    readonly contractVersion?: string;
  }) {
    const boundaryId = `pb-${uid()}`;
    const datasetId = `ds-${uid()}`;
    const csvText = syntheticPilotCsv(40);
    await ensureGovernedTerms(boundaryId);
    const policyId = await activeBar(boundaryId);

    const { validatePilotDataset } = await import("../../src/contract/validateDataset");
    const { makePolicy } = await import("../../src/assessment/policy");
    const { TEST_ANALYSIS_TERMS } = await import("../test/governedTerms");
    const { deriveAdmissionDecisionId } = await import("../../src/contract/assessmentExecution");
    const { hashAdmissionPolicy } = await import("../../src/contract/policyHash");
    const { findAdmissionPolicy } = await import("../persistence/pilotAdmissionPolicyStore");

    const report = await validatePilotDataset({
      boundary: { boundaryId, datasetId },
      declaredVersion: PILOT_DATA_CONTRACT_VERSION,
      csvText,
      provenance: SYNTHETIC_PROVENANCE,
      policy: makePolicy({
        policyId: TEST_ANALYSIS_TERMS.termsId,
        policyVersion: TEST_ANALYSIS_TERMS.termsVersion,
        stallThresholdDays: TEST_ANALYSIS_TERMS.stallThresholdDays,
        asOf: TEST_ANALYSIS_TERMS.asOf,
        currency: TEST_ANALYSIS_TERMS.currency,
      }),
    });
    const stored = await findAdmissionPolicy(boundaryId, policyId, "1.0.0");
    const policyHash = await hashAdmissionPolicy(stored!.policy);
    const contractVersion = opts.contractVersion ?? PILOT_DATA_CONTRACT_VERSION;

    // S4 · THE KEY IS MINTED UNDER THIS ROW'S OWN MAJOR, because that is what the build it pretends to
    // be would have done: the submission key embeds the contract major that was current when it was
    // written. Leaving it at this build's major would make the row internally inconsistent — its stored
    // identity would not re-derive from its own recorded facts — and scheduling would refuse it as a
    // changed record (NH-AX-1012) instead of on the version question these tests are about. The anomaly
    // in the row stays exactly one thing: the version.
    const { deriveIdempotencyKey } = await import("../../src/contract/validateDataset");
    const { parseContractVersion } = await import("../../src/contract/pilotDataContract");
    const idempotencyKey = await deriveIdempotencyKey({
      boundary: { boundaryId, datasetId },
      datasetFingerprint: report.datasetFingerprint,
      dateLocale: "auto",
      amountFormat: "auto",
      asOf: TEST_ANALYSIS_TERMS.asOf,
      stallThresholdDays: TEST_ANALYSIS_TERMS.stallThresholdDays,
      currency: TEST_ANALYSIS_TERMS.currency,
      contractMajor: parseContractVersion(contractVersion)!.major,
    });
    const admissionDecisionId = await deriveAdmissionDecisionId({
      boundaryId,
      idempotencyKey,
      datasetFingerprint: report.datasetFingerprint,
      contractVersion,
      outcome: "ADMISSIBLE",
      admissionPolicyId: policyId,
      admissionPolicyVersion: "1.0.0",
      admissionPolicyHash: policyHash,
    });

    await prisma.pilotDatasetSubmissionRecord.create({
      data: {
        idempotencyKey,
        boundaryId,
        datasetId,
        contractVersion,
        declaredVersion: opts.declaredVersion,
        // S4a · the interpretation snapshot a real intake writes, with nothing pinned.
        snapshotDateLocale: "auto",
        snapshotAmountFormat: "auto",
        snapshotTermsId: TEST_ANALYSIS_TERMS.termsId,
        snapshotTermsVersion: TEST_ANALYSIS_TERMS.termsVersion,
        datasetFingerprint: report.datasetFingerprint,
        accepted: true,
        usable: true,
        dataRows: 40,
        acceptedRows: 40,
        rejectedRows: 0,
        warnedRows: 0,
        findingCodes: [],
        admissionOutcome: "ADMISSIBLE",
        admissionPolicyId: policyId,
        admissionPolicyVersion: "1.0.0",
        admissionPolicyHash: policyHash,
        admissionDecisionId,
        submittedByActorId: "constructed@company",
        submittedByRole: "operator",
      },
    });
    return { boundaryId, datasetId, csvText, admissionDecisionId };
  }

  it("1 · the DECLARED version is persisted, not only the version the build implemented", async () => {
    // Without this column nothing in the database can say which contract judged a dataset, so §10's
    // promise is unauditable however the gate behaves. Read from the row, not from the response.
    const { boundaryId, submitted } = await admittedDataset();
    expect(submitted.statusCode).toBe(200);
    const row = await prisma.pilotDatasetSubmissionRecord.findFirstOrThrow({ where: { boundaryId } });
    expect(row.declaredVersion).toBe(PILOT_DATA_CONTRACT_VERSION);
    expect(row.contractVersion).toBe(PILOT_DATA_CONTRACT_VERSION);
  });

  it("2 · an older MINOR of the same major is accepted and RECORDED AS DECLARED, not as the build's", async () => {
    // `acceptsOlderMinorOfSameMajor` is a published promise. What was missing is the evidence trail: the
    // row used to record only the build's version, so a decision made under 1.0.0 was indistinguishable
    // from one made under 1.1.0 afterwards.
    const { boundaryId, submitted } = await admittedDataset("1.0.0");
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().accepted).toBe(true);
    const row = await prisma.pilotDatasetSubmissionRecord.findFirstOrThrow({ where: { boundaryId } });
    expect(row.declaredVersion).toBe("1.0.0");
    expect(row.contractVersion).toBe(PILOT_DATA_CONTRACT_VERSION);
    expect(row.declaredVersion).not.toBe(row.contractVersion);
  });

  it("3 · a dataset admitted under an older minor can still be EXECUTED", async () => {
    // The check this replaces was `decision.contractVersion !== report.contractVersion`. It compared the
    // build's version at submit time with the build's version now — so it could not fail here, and it
    // WOULD fail for every admitted dataset the moment the build's version moved by a patch. Test 4 is
    // the half that could not be written before.
    const { boundaryId, datasetId, csvText } = await admittedDataset("1.0.0");
    const out = (await schedule(boundaryId, datasetId, csvText)).json();
    expect(out.refusal, JSON.stringify(out.refusalDetail)).toBeNull();
    expect(out.scheduled).toBe(true);
  });

  it("4a · POSITIVE CONTROL · a constructed decision row with a SUPPORTED version schedules", async () => {
    // Without this, test 4b would prove only that a hand-built row cannot be scheduled — which says
    // nothing about the version. Same construction, same derivations, one field different.
    const built = await insertDecisionRow({ declaredVersion: PILOT_DATA_CONTRACT_VERSION });
    const out = (await schedule(built.boundaryId, built.datasetId, built.csvText)).json();
    expect(out.refusal, JSON.stringify(out.refusalDetail)).toBeNull();
    expect(out.scheduled).toBe(true);
  });

  it("4b · a decision recorded under a version this build CANNOT interpret is refused, with its own code", async () => {
    // The case NH-AX-1006 exists for, and the only case in which "the fields may not mean the same thing"
    // is a true statement: a decision made by a build serving a contract this one does not implement.
    const built = await insertDecisionRow({ declaredVersion: "9.9.9" });
    const out = (await schedule(built.boundaryId, built.datasetId, built.csvText)).json();
    expect(out.scheduled).toBe(false);
    expect(out.refusal.code).toBe("NH-AX-1006");
    expect(out.refusalDetail).toContain("9.9.9");
    expect(out.refusalDetail).toContain("does not accept it");
  });

  it("5 · a row with NO declaration falls back to the version it was recorded with, never to optimism", async () => {
    // Rows written before EP-27's column existed. The migration backfilled them from `contract_version`;
    // this proves the application agrees with that backfill rather than treating null as "compatible".
    const supported = await insertDecisionRow({ declaredVersion: null });
    const ok = (await schedule(supported.boundaryId, supported.datasetId, supported.csvText)).json();
    expect(ok.refusal, JSON.stringify(ok.refusalDetail)).toBeNull();
    expect(ok.scheduled).toBe(true);

    // ...and null is NOT a free pass: with an uninterpretable recorded build version it is still refused,
    // so the fallback is to the recorded value rather than to acceptance.
    //
    // CITED, not discovered: a row recorded by a build serving major 9 carries a major-9 submission key,
    // which this build's discovery derivation cannot reach. Reaching it by reference is the point — the
    // support gate must still fire on the fully authoritative path, where every fact came from the record.
    const unsupported = await insertDecisionRow({ declaredVersion: null, contractVersion: "9.9.9" });
    const out = (
      await schedule(
        unsupported.boundaryId,
        unsupported.datasetId,
        unsupported.csvText,
        unsupported.admissionDecisionId,
      )
    ).json();
    expect(out.scheduled).toBe(false);
    expect(out.refusal.code).toBe("NH-AX-1006");
  });

  it("6 · a NEWER version is still refused at intake, and writes no row", async () => {
    // `acceptsNewerThanImplemented: false`. The two-major window opens backwards only — a build never
    // guesses at a contract it does not implement. EP-28 · the probe is 3.0.0 now: 2.0.0 became the
    // implemented version, so using it here would have quietly stopped testing anything.
    const boundaryId = `pb-${uid()}`;
    await ensureGovernedTerms(boundaryId);
    const res = await app.inject({
      method: "POST",
      url: "/pilot/datasets",
      headers: OPERATOR,
      payload: {
        boundaryId,
        datasetId: `ds-${uid()}`,
        declaredVersion: "3.0.0",
        csvText: syntheticPilotCsv(40),
        provenance: SYNTHETIC_PROVENANCE,
        ...GOVERNED_TERMS_FIELDS,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(false);
    expect((res.json().datasetFindings as { code: string }[]).map((f) => f.code)).toContain("NH-DC-5001");
    expect(await prisma.pilotDatasetSubmissionRecord.count({ where: { boundaryId } })).toBe(0);
  });
});
