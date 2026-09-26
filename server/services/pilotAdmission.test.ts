// EP-14 · Pilot Assessment Admission Gate — server integration, real HTTP + real PostgreSQL.
//
// The unit tests prove the evaluator's arithmetic. These prove the parts only the server can get
// wrong: where the thresholds come from, whose thresholds they are, and that a fitness verdict
// never creates anything.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import {
  SYNTHETIC_PROVENANCE,
  syntheticPilotCsv,
  syntheticPilotRows,
  syntheticViolationCases,
  toCsv,
} from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../src/contract/pilotDataContract";
import { ADMISSION_CALC_VERSION } from "../../src/contract/pilotAdmissionPolicy";
import { ensureGovernedTerms, GOVERNED_TERMS_FIELDS } from "../test/governedTerms";

const HAS_DB = !!process.env.DATABASE_URL;
const OPERATOR = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
const APPROVER = { "x-actor-id": "cfo@company", "x-actor-role": "approver" };
// EP-15 · A policy is now PROPOSED by the customer side and ACTIVATED by governance. These tests
// were written before that split and registered a policy that judged immediately; they now walk the
// real two-actor path. The assertions about admission itself are unchanged — only the setup is.
const STEWARD = { "x-actor-id": "gov@company", "x-actor-role": "steward" };
const uid = () => Math.random().toString(36).slice(2, 10);

/** A policy the clean synthetic dataset satisfies. Stated in full — nothing is defaulted. */
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
    boundaryId: `pilot-boundary-${uid()}`,
    datasetId: `dataset-${uid()}`,
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

describe.skipIf(!HAS_DB)("EP-14 · pilot admission gate (server)", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // EP-26 · Activate governed analysis terms for the payload's boundary before submitting: the
  // cut-off and the stall threshold are no longer request fields.
  const submit = async (payload: unknown, headers = OPERATOR) => {
      const boundaryId = (payload as { boundaryId?: string }).boundaryId;
      if (boundaryId) await ensureGovernedTerms(boundaryId);
    return app.inject({ method: "POST", url: "/pilot/datasets", headers, payload: payload as object });
  };

  /** Propose a policy. It is a DRAFT and judges nothing until governance activates it. */
  const register = (boundaryId: string, policy: Record<string, unknown>, headers = OPERATOR) =>
    app.inject({
      method: "POST",
      url: "/pilot/admission-policies",
      headers,
      payload: { boundaryId, policy, rationale: "agreed pilot fitness bar" } as object,
    });

  /** Put a proposed policy in force. Governance only, and never the proposer. */
  const activate = (boundaryId: string, policyId: string, headers = STEWARD, policyVersion = "1.0.0") =>
    app.inject({
      method: "POST",
      url: "/pilot/admission-policies/activate",
      headers,
      payload: { boundaryId, policyId, policyVersion, rationale: "reviewed and approved" } as object,
    });

  /** The normal two-actor setup: the customer proposes, governance activates. */
  const registerActive = async (boundaryId: string, policy: Record<string, unknown>) => {
    expect((await register(boundaryId, policy)).statusCode).toBe(201);
    expect((await activate(boundaryId, policy.policyId as string)).statusCode).toBe(200);
    return policy;
  };

  it("1 · a valid synthetic pilot with a satisfied policy is ADMISSIBLE", async () => {
    const boundaryId = `pilot-boundary-${uid()}`;
    const policy = await registerActive(boundaryId, policyBody());

    const res = await submit(datasetBody({ boundaryId, admissionPolicyId: policy.policyId }));
    expect(res.statusCode).toBe(200);
    const out = res.json();

    expect(out.usableForAssessment).toBe(true);
    expect(out.admission.outcome).toBe("ADMISSIBLE");
    expect(out.admission.admissibleForPilotAssessment).toBe(true);
    expect(out.admission.policyRef).toBe(`${policy.policyId}@1.0.0`);
    // The decision is reproducible: it stamps the policy, the evaluator and the exact bytes judged.
    expect(out.admission.datasetFingerprint).toBe(out.datasetFingerprint);
    expect(out.admission.calculationMethodVersion).toBeTruthy();
  });

  it("2 · one valid row among many rejected is usable but NOT admissible", async () => {
    const boundaryId = `pilot-boundary-${uid()}`;
    const policy = await registerActive(boundaryId, policyBody());

    const csv = toCsv([...syntheticPilotRows(1), ...syntheticViolationCases().map((c) => c.row)]);
    const out = (await submit(datasetBody({ boundaryId, csvText: csv, admissionPolicyId: policy.policyId }))).json();

    expect(out.usableForAssessment).toBe(true); // the existing meaning is unchanged …
    expect(out.counts.acceptedRows).toBe(1);
    expect(out.admission.outcome).toBe("NOT_ADMISSIBLE"); // … and fitness is a separate answer
    expect(out.admission.reasons.map((r: { code: string }) => r.code)).toContain("NH-AG-2001");
  });

  it("3 · naming no policy is NOT_ASSESSABLE — there is no implicit bar", async () => {
    const out = (await submit(datasetBody())).json();
    expect(out.usableForAssessment).toBe(true);
    expect(out.admission.outcome).toBe("NOT_ASSESSABLE");
    expect(out.admission.reasons.map((r: { code: string }) => r.code)).toContain("NH-AG-1001");
    expect(out.admission.checks).toEqual([]);
  });

  it("4 · a policy id that does not exist for this boundary is NOT_ASSESSABLE", async () => {
    const out = (await submit(datasetBody({ admissionPolicyId: `pol-does-not-exist-${uid()}` }))).json();
    expect(out.admission.outcome).toBe("NOT_ASSESSABLE");
    expect(out.admission.reasons.map((r: { code: string }) => r.code)).toContain("NH-AG-1001");
  });

  it("5 · CROSS-TENANT: one tenant's policy can never judge another tenant's data", async () => {
    // Tenant A registers a lax policy. Tenant B names the same policy id for a dataset that would
    // pass under it. If the lookup were not boundary-scoped, B would be admitted on A's bar — and
    // would also learn what A considers acceptable, which is commercially sensitive on its own.
    const tenantA = `pilot-boundary-a-${uid()}`;
    const tenantB = `pilot-boundary-b-${uid()}`;
    const shared = await registerActive(tenantA, policyBody({ minAcceptedRows: 1, minDistinctEntities: 1, minCoverageDays: 1 }));

    const out = (await submit(datasetBody({ boundaryId: tenantB, admissionPolicyId: shared.policyId }))).json();
    expect(out.admission.outcome).toBe("NOT_ASSESSABLE");
    expect(out.admission.reasons.map((r: { code: string }) => r.code)).toContain("NH-AG-1001");
    expect(out.admission.policyRef).toBeNull(); // A's thresholds are not even named back to B

    // A's own submission still works — the policy exists, just not for B.
    const ownRes = await submit(datasetBody({ boundaryId: tenantA, admissionPolicyId: shared.policyId }));
    expect(ownRes.json().admission.outcome).toBe("ADMISSIBLE");
  });

  it("6 · a scoped identity cannot register a policy for a boundary it does not hold", async () => {
    const scoped = buildApp({
      sourceVerifier: fixtureVerifier,
      identityResolver: async () =>
        Object.freeze({ actorId: "scoped@company", role: "operator" as const, boundaryIds: Object.freeze(["tenant-own"]) }),
    });
    await scoped.ready();
    try {
      const own = await scoped.inject({
        method: "POST", url: "/pilot/admission-policies", headers: OPERATOR,
        payload: { boundaryId: "tenant-own", policy: policyBody(), rationale: "r" } as object,
      });
      expect(own.statusCode).toBe(201);

      const other = await scoped.inject({
        method: "POST", url: "/pilot/admission-policies", headers: OPERATOR,
        payload: { boundaryId: "tenant-other", policy: policyBody(), rationale: "r" } as object,
      });
      expect(other.statusCode).toBe(403);
      expect(await prisma.pilotAdmissionPolicyRecord.count({ where: { boundaryId: "tenant-other" } })).toBe(0);
    } finally {
      await scoped.close();
    }
  });

  it("7 · a policy missing a threshold is refused at the schema, never stored half-configured", async () => {
    const boundaryId = `pilot-boundary-${uid()}`;
    const incomplete = policyBody() as Record<string, unknown>;
    delete incomplete.maxRejectionRate;
    const res = await register(boundaryId, incomplete);
    expect(res.statusCode).toBe(400);
    expect(await prisma.pilotAdmissionPolicyRecord.count({ where: { boundaryId } })).toBe(0);
  });

  it("8 · insufficient sample, coverage and duplicate rate each refuse with their own code", async () => {
    const boundaryId = `pilot-boundary-${uid()}`;
    const strict = await registerActive(boundaryId, policyBody({ minAcceptedRows: 500, minCoverageDays: 3650, maxDuplicateRate: 0 }));

    // FIVE pairs collide; fifteen cycles survive. The fixture used to duplicate EVERY row, which no
    // longer reaches the thresholds this test is about: since all colliding rows are excluded, a
    // wholly-duplicated file leaves zero accepted cycles, so the dataset is not usable and the gate
    // correctly answers NOT_ASSESSABLE (NH-AG-3001) instead of measuring anything. Threshold codes
    // can only be asserted on a dataset that survives far enough to be measured.
    const base = syntheticPilotRows(20);
    const out = (
      await submit(
        datasetBody({
          boundaryId,
          csvText: toCsv([...base, ...base.slice(0, 5)]),
          admissionPolicyId: strict.policyId,
        }),
      )
    ).json();

    const codes = out.admission.reasons.map((r: { code: string }) => r.code);
    expect(codes).toContain("NH-AG-2001"); // sample too small
    expect(codes).toContain("NH-AG-2006"); // coverage too short
    expect(codes).toContain("NH-AG-2005"); // duplicate rate
    expect(out.admission.outcome).toBe("NOT_ADMISSIBLE");
  });

  it("9 · repeated evaluation of the same dataset is byte-identical", async () => {
    const boundaryId = `pilot-boundary-${uid()}`;
    const policy = policyBody();
    await register(boundaryId, policy);
    const csvText = syntheticPilotCsv(30);

    // Two DIFFERENT dataset ids so the idempotency guard does not intercept the second submission —
    // what is being tested is the evaluator's determinism, not the duplicate rule.
    const a = (await submit(datasetBody({ boundaryId, csvText, datasetId: `d-${uid()}`, admissionPolicyId: policy.policyId }))).json();
    const b = (await submit(datasetBody({ boundaryId, csvText, datasetId: `d-${uid()}`, admissionPolicyId: policy.policyId }))).json();

    expect(JSON.stringify(a.admission.checks)).toBe(JSON.stringify(b.admission.checks));
    expect(a.admission.rates).toEqual(b.admission.rates);
    expect(a.admission.outcome).toBe(b.admission.outcome);
  });

  it("10 · no rejected-row content leaks into the admission decision", async () => {
    const boundaryId = `pilot-boundary-${uid()}`;
    const policy = await registerActive(
      boundaryId,
      policyBody({ minAcceptedRows: 1, minDistinctEntities: 1, minCoverageDays: 1, maxRejectionRate: 1 }),
    );

    const secret = "leaked.person@customer.example";
    const rows = [...syntheticPilotRows(20), { ...syntheticPilotRows(1)[0]!, entity_id: secret, subscription_id: `sub-leak-${uid()}` }];
    const res = await submit(datasetBody({ boundaryId, csvText: toCsv(rows), admissionPolicyId: policy.policyId }));

    expect(JSON.stringify(res.json().admission)).not.toContain(secret);
    // The rejection remains VISIBLE as a count and a code — representativeness stays auditable.
    expect(res.json().admission.counts.rejectedRows).toBeGreaterThan(0);
    expect(res.json().admission.rejectionDistribution.map((r: { code: string }) => r.code)).toContain("NH-DC-3002");
  });

  it("11 · the gate creates no Proof, Case, evidence or authority record", async () => {
    const boundaryId = `pilot-boundary-${uid()}`;
    const policy = await registerActive(boundaryId, policyBody());
    const payload = datasetBody({ boundaryId, admissionPolicyId: policy.policyId });
    const out = (await submit(payload)).json();
    expect(out.admission.outcome).toBe("ADMISSIBLE");

    const ids = [boundaryId, payload.datasetId as string, out.idempotencyKey as string];
    expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId } })).toBe(0);
    expect(await prisma.proof.count({ where: { recoveryCaseId: { in: ids } } })).toBe(0);
    expect(await prisma.authorityEvent.count({ where: { recoveryCaseId: { in: ids } } })).toBe(0);
    expect(await prisma.evidenceRecord.count({ where: { recoveryCaseId: { in: ids } } })).toBe(0);
    expect(await prisma.baselineSnapshot.count({ where: { recoveryCaseId: { in: ids } } })).toBe(0);
  });

  it("12 · a published policy version is immutable at the database level", async () => {
    const boundaryId = `pilot-boundary-${uid()}`;
    const policy = await registerActive(boundaryId, policyBody());

    // Re-registering the same version is refused: editing thresholds under a version a decision
    // already stamped would silently re-grade a dataset judged under the old bar.
    expect((await register(boundaryId, policy)).statusCode).toBe(409);
    await expect(
      prisma.pilotAdmissionPolicyRecord.update({
        where: { boundaryId_policyId_policyVersion: { boundaryId, policyId: policy.policyId as string, policyVersion: "1.0.0" } },
        data: { minAcceptedRows: 0 },
      }),
    ).rejects.toThrow(/append-only/i);
  });

  it("13 · an approver may not register a policy or submit a dataset", async () => {
    expect((await register(`pilot-boundary-${uid()}`, policyBody(), APPROVER)).statusCode).toBe(403);
    expect((await submit(datasetBody(), APPROVER)).statusCode).toBe(403);
  });
});
