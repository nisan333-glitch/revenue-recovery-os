// The sweep detects corruption that per-resolve verification would only find one row at a time.
//
// WHY IT EXISTS, stated as the gap it closes: enforcement is per-resolve, so a migration that altered
// many rows surfaces one refusal at a time, from whoever happens to touch each row next — and a row
// nobody touches is never checked at all. The sweep asks every record at once.
//
// WHAT IT MUST NEVER DO is repair. These tests therefore assert not only that it finds the rows, but
// that the rows are BYTE-IDENTICAL afterwards.
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../db";
import { SCENARIO_POLICY } from "../../src/contract/syntheticPilotDataset";
import { ADMISSION_EVALUATOR_VERSION } from "../../src/contract/admissionGate";
import { makeAdmissionPolicy } from "../../src/contract/pilotAdmissionPolicy";
import { hashAdmissionPolicy } from "../../src/contract/policyHash";
import { makeAnalysisTerms, hashAnalysisTerms } from "../../src/contract/analysisTerms";
import { TEST_ANALYSIS_TERMS } from "../test/governedTerms";
import { sweepRegisterIntegrity, sweepPassed } from "./registerIntegritySweep";

const HAS_DB = !!process.env.DATABASE_URL;
const uid = () => Math.random().toString(36).slice(2, 10);
const THRESHOLDS = Object.freeze({
  ...SCENARIO_POLICY,
  requiredLifecycleStates: [...SCENARIO_POLICY.requiredLifecycleStates],
});

describe.skipIf(!HAS_DB)("the register integrity sweep", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function policyRow(boundaryId: string, over: { witnessOf?: Record<string, unknown>; raw?: Record<string, unknown> } = {}) {
    const policyId = `pol-${uid()}`;
    const actual = makeAdmissionPolicy({
      policyId, policyVersion: "1.0.0",
      calculationMethodVersion: ADMISSION_EVALUATOR_VERSION, ...THRESHOLDS,
    });
    const witnessed = makeAdmissionPolicy({ ...actual, ...(over.witnessOf ?? {}) } as never);
    await prisma.pilotAdmissionPolicyRecord.create({
      data: {
        boundaryId, policyId, policyVersion: "1.0.0",
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
        registeredByActorId: "sweep-fixture@company",
        registeredByRole: "operator",
        // `raw` writes values the DOMAIN would refuse, which is how UNVERIFIABLE is reached. The column
        // types allow it; only the constructor forbids it, and the constructor is not in the write path.
        ...(over.raw ?? {}),
      },
    });
    return policyId;
  }

  async function termsRow(boundaryId: string, over: { witnessOf?: Record<string, unknown>; raw?: Record<string, unknown> } = {}) {
    const termsId = `terms-${uid()}`;
    const actual = makeAnalysisTerms({ ...TEST_ANALYSIS_TERMS, termsId });
    const witnessed = makeAnalysisTerms({ ...actual, ...(over.witnessOf ?? {}) } as never);
    await prisma.pilotAnalysisTermsRecord.create({
      data: {
        boundaryId, termsId, termsVersion: actual.termsVersion,
        asOf: actual.asOf, stallThresholdDays: actual.stallThresholdDays,
        currency: actual.currency, calculationMethodVersion: actual.calculationMethodVersion,
        termsHash: await hashAnalysisTerms(witnessed),
        registeredByActorId: "sweep-fixture@company",
        registeredByRole: "operator",
        ...(over.raw ?? {}),
      },
    });
    return termsId;
  }

  it("1 · POSITIVE CONTROL · sound records verify, in both registers", async () => {
    // SCOPED TO ITS OWN BOUNDARY, and that is a consequence of the design rather than a convenience: the
    // sweep is deliberately NOT boundary-scoped, so it also sees the corruption the tests below plant,
    // and a "the whole database passes" assertion here would depend on test order. The global property —
    // everything the application has ever written verifies — is exercised by `npm run verify:registers`
    // on a fresh database, where nothing has planted anything.
    const boundaryId = `pb-${uid()}`;
    await policyRow(boundaryId);
    await termsRow(boundaryId);
    const report = await sweepRegisterIntegrity();
    expect(report.failures.filter((f) => f.boundaryId === boundaryId)).toEqual([]);
    expect(report.checked).toBeGreaterThanOrEqual(2);
    expect(report.byRegister.admission_policy.checked).toBeGreaterThanOrEqual(1);
    expect(report.byRegister.analysis_terms.checked).toBeGreaterThanOrEqual(1);
    // `intact` and `failures` must account for every record checked, whatever else is in the database.
    expect(report.intact + report.failures.length).toBe(report.checked);
  });

  it("1b · `sweepPassed` is exactly \"no failures\", with nothing else folded in", async () => {
    // The exit code of `verify:registers` is this predicate and nothing more, so it is pinned directly
    // rather than inferred from a run that happens to be clean.
    const report = await sweepRegisterIntegrity();
    expect(sweepPassed({ ...report, failures: [] })).toBe(true);
    expect(
      sweepPassed({
        ...report,
        failures: [
          {
            register: "analysis_terms",
            boundaryId: "pb-synthetic",
            ref: "terms-synthetic@1.0.0",
            integrity: { status: "MISMATCH", storedHash: "sha256:a", computedHash: "sha256:b", detail: null },
          },
        ],
      }),
    ).toBe(false);
  });

  it("2 · it detects a MISMATCH in each register, with both hashes, and repairs nothing", async () => {
    const boundaryId = `pb-${uid()}`;
    const policyId = await policyRow(boundaryId, { witnessOf: { minAcceptedRows: THRESHOLDS.minAcceptedRows + 13 } });
    const termsId = await termsRow(boundaryId, { witnessOf: { stallThresholdDays: 888 } });
    const before = {
      policy: await prisma.pilotAdmissionPolicyRecord.findFirstOrThrow({ where: { boundaryId, policyId } }),
      terms: await prisma.pilotAnalysisTermsRecord.findFirstOrThrow({ where: { boundaryId, termsId } }),
    };

    const report = await sweepRegisterIntegrity();
    expect(sweepPassed(report)).toBe(false);

    const found = report.failures.filter((f) => f.boundaryId === boundaryId);
    expect(found).toHaveLength(2);
    expect(found.map((f) => f.register).sort()).toEqual(["admission_policy", "analysis_terms"]);
    for (const f of found) {
      expect(f.integrity.status).toBe("MISMATCH");
      expect(f.integrity.computedHash).not.toBe(f.integrity.storedHash);
      expect(f.integrity.computedHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(f.integrity.detail).toMatch(/changed after it was registered/);
    }

    // REPAIRS NOTHING. Byte-identical afterwards, including the witness it just reported as wrong.
    expect(await prisma.pilotAdmissionPolicyRecord.findFirstOrThrow({ where: { boundaryId, policyId } })).toEqual(before.policy);
    expect(await prisma.pilotAnalysisTermsRecord.findFirstOrThrow({ where: { boundaryId, termsId } })).toEqual(before.terms);
  });

  it("3 · it reports UNVERIFIABLE separately — a row with no computable hash is not a mismatch", async () => {
    // FINDING, worth stating: most corruption classes are UNREACHABLE AT REST. The tables carry CHECK
    // constraints — rates must be fractions, counts non-negative, `as_of` a real ISO date, thresholds in
    // range — so a first attempt at this test (a rejection rate of 7.5) was refused by the database
    // itself, not by the sweep. That narrows what UNVERIFIABLE can actually mean to the gaps between the
    // DB's constraints and the domain's, and these are two of them: `required_lifecycle_states` is a
    // bare `String[]` with no constraint on its contents, and `currency` has no CHECK at all. The domain
    // forbids both, and the domain is not in the write path.
    //
    // There is no hash to compare for either, so calling them mismatches would assert a comparison that
    // never happened.
    const boundaryId = `pb-${uid()}`;
    await policyRow(boundaryId, { raw: { requiredLifecycleStates: ["definitely-not-a-lifecycle-state"] } });
    await termsRow(boundaryId, { raw: { currency: "ZZZ" } });

    const report = await sweepRegisterIntegrity();
    const found = report.failures.filter((f) => f.boundaryId === boundaryId);
    expect(found).toHaveLength(2);
    for (const f of found) {
      expect(f.integrity.status).toBe("UNVERIFIABLE");
      expect(f.integrity.computedHash).toBeNull();
      expect(f.integrity.detail).toMatch(/do not rebuild into/);
      // The stored witness is still reported — it is the one fact about the row that is not in doubt.
      expect(f.integrity.storedHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    // And the detail names no field and no value: this report gets pasted around.
    for (const f of found) expect(f.integrity.detail).not.toMatch(/ZZZ|definitely-not-a-lifecycle-state/);
  });

  it("4 · it is not boundary-scoped — corruption in ANY tenant is reported", async () => {
    // Deliberately unlike every request path. This is an operator asking whether the database is intact,
    // not a tenant asking about their own data; scoping it would hide exactly what it exists to find.
    const a = `pb-${uid()}`;
    const b = `pb-${uid()}`;
    await policyRow(a, { witnessOf: { minCoverageDays: THRESHOLDS.minCoverageDays + 4 } });
    await policyRow(b, { witnessOf: { minDistinctEntities: THRESHOLDS.minDistinctEntities + 4 } });
    const report = await sweepRegisterIntegrity();
    const boundaries = new Set(report.failures.map((f) => f.boundaryId));
    expect(boundaries.has(a)).toBe(true);
    expect(boundaries.has(b)).toBe(true);
  });

  it("5 · the report carries governance labels and hashes only — no customer value", async () => {
    const boundaryId = `pb-${uid()}`;
    await policyRow(boundaryId, { witnessOf: { maxDuplicateRate: 0.4242 } });
    const report = await sweepRegisterIntegrity();
    const serialized = JSON.stringify(report.failures);
    // The thresholds themselves are customer commercial choices and must not travel in an operator
    // report that is pasted into tickets.
    expect(serialized).not.toContain("0.4242");
    expect(serialized).not.toContain("minAcceptedRows");
    // What it does carry: the register, the boundary, the ref, the status and the two hashes.
    const one = report.failures.find((f) => f.boundaryId === boundaryId)!;
    expect(Object.keys(one).sort()).toEqual(["boundaryId", "integrity", "ref", "register"]);
    expect(Object.keys(one.integrity).sort()).toEqual(["computedHash", "detail", "status", "storedHash"]);
  });
});
