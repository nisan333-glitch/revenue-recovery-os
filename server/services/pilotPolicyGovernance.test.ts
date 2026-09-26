// EP-15 · Policy governance — server integration, real HTTP + real PostgreSQL.
//
// The question these tests answer is not "does the lifecycle work" but "can the beneficiary set the
// bar that judges them". Every adversarial case below is an attempt to do exactly that by a
// different route.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { SYNTHETIC_PROVENANCE, syntheticPilotCsv } from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../src/contract/pilotDataContract";
import { ADMISSION_CALC_VERSION } from "../../src/contract/pilotAdmissionPolicy";
import { ensureGovernedTerms, GOVERNED_TERMS_FIELDS } from "../test/governedTerms";

const HAS_DB = !!process.env.DATABASE_URL;
const OPERATOR = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
const STEWARD = { "x-actor-id": "gov@company", "x-actor-role": "steward" };
const APPROVER = { "x-actor-id": "cfo@company", "x-actor-role": "approver" };
const uid = () => Math.random().toString(36).slice(2, 10);

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

describe.skipIf(!HAS_DB)("EP-15 · admission policy governance", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
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

  const submit = async (payload: unknown, headers = OPERATOR) => {
      const boundaryId = (payload as { boundaryId?: string }).boundaryId;
      if (boundaryId) await ensureGovernedTerms(boundaryId);
    return app.inject({ method: "POST", url: "/pilot/datasets", headers, payload: payload as object });
  };

  /** Propose + activate, the normal two-actor path. */
  async function activated(boundaryId: string, over: Record<string, unknown> = {}) {
    const policy = policyBody(over);
    expect((await propose(boundaryId, policy)).statusCode).toBe(201);
    expect((await move("activate", boundaryId, policy.policyId as string)).statusCode).toBe(200);
    return policy;
  }

  it("1 · a proposal is a DRAFT and cannot judge anything until governance activates it", async () => {
    const boundaryId = `pb-${uid()}`;
    const policy = policyBody();
    const proposed = await propose(boundaryId, policy);
    expect(proposed.statusCode).toBe(201);
    expect(proposed.json().state).toBe("DRAFT");
    expect(proposed.json().policyHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const out = (await submit(datasetBody({ boundaryId, admissionPolicyId: policy.policyId }))).json();
    expect(out.admission.outcome).toBe("NOT_ASSESSABLE");
    expect(out.admissionPolicyState).toBe("DRAFT");
    expect(out.admissionGovernanceRefusal).toMatch(/draft|not been activated/i);

    // After activation the same dataset would be judged — but only once a steward says so.
    expect((await move("activate", boundaryId, policy.policyId as string)).statusCode).toBe(200);
  });

  it("2 · the proposer cannot activate their own policy, even holding the right role", async () => {
    const boundaryId = `pb-${uid()}`;
    const policy = policyBody();
    await propose(boundaryId, policy);
    // A steward whose actorId happens to match the proposer's is still refused: role separation and
    // identity separation are two independent checks, and this one survives a permission change.
    const sameIdentity = { "x-actor-id": OPERATOR["x-actor-id"], "x-actor-role": "steward" };
    const res = await move("activate", boundaryId, policy.policyId as string, sameIdentity);
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/proposed .* cannot be the one who puts it in force/i);
  });

  it("3 · a customer-side actor may not activate, and an approver may neither propose nor activate", async () => {
    const boundaryId = `pb-${uid()}`;
    const policy = policyBody();
    await propose(boundaryId, policy);
    // The beneficiary side holds ProposePilotPolicy and nothing more.
    expect((await move("activate", boundaryId, policy.policyId as string, OPERATOR)).statusCode).toBe(403);
    expect((await move("retire", boundaryId, policy.policyId as string, OPERATOR)).statusCode).toBe(403);
    // And no unrelated role acquires either half.
    expect((await propose(boundaryId, policyBody(), APPROVER)).statusCode).toBe(403);
    expect((await move("activate", boundaryId, policy.policyId as string, APPROVER)).statusCode).toBe(403);
  });

  it("4 · CROSS-TENANT: neither proposal nor activation crosses a boundary", async () => {
    const tenantA = `pb-a-${uid()}`;
    const tenantB = `pb-b-${uid()}`;
    const policy = await activated(tenantA);

    // B cannot govern A's policy: it reads as absent, not as A's.
    const res = await move("retire", tenantB, policy.policyId as string);
    expect(res.statusCode).toBe(404);

    // And a scoped identity cannot even name A's boundary.
    const scoped = buildApp({
      sourceVerifier: fixtureVerifier,
      identityResolver: async () =>
        Object.freeze({ actorId: "scoped@co", role: "steward" as const, boundaryIds: Object.freeze([tenantB]) }),
    });
    await scoped.ready();
    try {
      const denied = await scoped.inject({
        method: "POST", url: "/pilot/admission-policies/activate", headers: STEWARD,
        payload: { boundaryId: tenantA, policyId: policy.policyId, policyVersion: "1.0.0", rationale: "x" } as object,
      });
      expect(denied.statusCode).toBe(403);
    } finally {
      await scoped.close();
    }
    // A's policy is untouched by any of it.
    const events = await prisma.pilotAdmissionPolicyEventRecord.findMany({ where: { boundaryId: tenantA } });
    expect(events.map((e) => e.transition).sort()).toEqual(["ACTIVATED", "PROPOSED"]);
  });

  it("5 · a RETIRED or FROZEN policy judges nothing", async () => {
    const boundaryId = `pb-${uid()}`;
    const policy = await activated(boundaryId);

    expect((await move("freeze", boundaryId, policy.policyId as string)).statusCode).toBe(200);
    let out = (await submit(datasetBody({ boundaryId, admissionPolicyId: policy.policyId }))).json();
    expect(out.admissionPolicyState).toBe("FROZEN");
    expect(out.admission.outcome).toBe("NOT_ASSESSABLE");
    expect(out.admissionGovernanceRefusal).toMatch(/frozen/i);

    // A freeze is reversible — that is what distinguishes it from retirement.
    expect((await move("unfreeze", boundaryId, policy.policyId as string)).statusCode).toBe(200);

    expect((await move("retire", boundaryId, policy.policyId as string)).statusCode).toBe(200);
    out = (await submit(datasetBody({ boundaryId, admissionPolicyId: policy.policyId }))).json();
    expect(out.admissionPolicyState).toBe("RETIRED");
    expect(out.admission.outcome).toBe("NOT_ASSESSABLE");
    // Retirement is terminal: it cannot be resurrected.
    expect((await move("activate", boundaryId, policy.policyId as string)).statusCode).toBe(409);
  });

  it("6 · an ACTIVE policy's thresholds are immutable at the database level", async () => {
    const boundaryId = `pb-${uid()}`;
    const policy = await activated(boundaryId);
    await expect(
      prisma.pilotAdmissionPolicyRecord.update({
        where: {
          boundaryId_policyId_policyVersion: {
            boundaryId, policyId: policy.policyId as string, policyVersion: "1.0.0",
          },
        },
        data: { minAcceptedRows: 0 },
      }),
    ).rejects.toThrow(/append-only/i);
    // The lifecycle log is equally immutable — history cannot be rewritten to invent an approval.
    const event = await prisma.pilotAdmissionPolicyEventRecord.findFirstOrThrow({ where: { boundaryId } });
    await expect(
      prisma.pilotAdmissionPolicyEventRecord.update({ where: { id: event.id }, data: { actorId: "someone-else" } }),
    ).rejects.toThrow(/append-only/i);
  });

  it("7 · a change is a NEW version with its own proposal and its own activation", async () => {
    const boundaryId = `pb-${uid()}`;
    const v1 = await activated(boundaryId);

    // Same id, new version: proposing it does NOT inherit v1's approval.
    const v2 = policyBody({ policyId: v1.policyId, policyVersion: "2.0.0", minAcceptedRows: 1 });
    expect((await propose(boundaryId, v2)).statusCode).toBe(201);
    const out = (
      await submit(datasetBody({ boundaryId, admissionPolicyId: v1.policyId, admissionPolicyVersion: "2.0.0" }))
    ).json();
    expect(out.admissionPolicyState).toBe("DRAFT");
    expect(out.admission.outcome).toBe("NOT_ASSESSABLE");

    expect((await move("activate", boundaryId, v1.policyId as string, STEWARD, "2.0.0")).statusCode).toBe(200);
    // v1 is unaffected by v2's existence.
    const v1gov = await app.inject({
      method: "GET",
      url: `/pilot/admission-policies/governance?boundaryId=${boundaryId}&policyId=${v1.policyId}&policyVersion=1.0.0`,
      headers: STEWARD,
    });
    expect(v1gov.json().state).toBe("ACTIVE");
  });

  it("8 · ANTI-TUNING: a policy activated after the dataset was first seen cannot judge it", async () => {
    // The attack: submit, read the verdict, then activate a laxer bar and resubmit. The dataset's
    // first sighting predates that activation, so the new policy is refused for this dataset.
    const boundaryId = `pb-${uid()}`;
    const strict = await activated(boundaryId, { minAcceptedRows: 500 });
    const dataset = datasetBody({ boundaryId, admissionPolicyId: strict.policyId });

    const first = (await submit(dataset)).json();
    expect(first.admission.outcome).toBe("NOT_ADMISSIBLE"); // too few rows under the strict bar

    // Now propose and activate a laxer version, having seen the result.
    const lax = policyBody({ minAcceptedRows: 1, minDistinctEntities: 1, minCoverageDays: 1 });
    expect((await propose(boundaryId, lax)).statusCode).toBe(201);
    expect((await move("activate", boundaryId, lax.policyId as string)).statusCode).toBe(200);

    const retry = (
      await submit(datasetBody({ boundaryId, datasetId: `ds-${uid()}`, csvText: dataset.csvText, admissionPolicyId: lax.policyId }))
    ).json();
    expect(retry.admission.outcome).toBe("NOT_ASSESSABLE");
    expect(retry.admissionGovernanceRefusal).toMatch(/activated after this dataset was first submitted/i);
  });

  it("8b · a policy activated BEFORE the dataset arrives judges it normally", async () => {
    // The control for the test above: the same machinery must not block the legitimate order.
    const boundaryId = `pb-${uid()}`;
    const policy = await activated(boundaryId);
    const out = (await submit(datasetBody({ boundaryId, admissionPolicyId: policy.policyId }))).json();
    expect(out.admission.outcome).toBe("ADMISSIBLE");
  });

  it("9 · every decision is stamped with the policy id, version and hash it was judged under", async () => {
    const boundaryId = `pb-${uid()}`;
    const policy = await activated(boundaryId);
    const res = await submit(datasetBody({ boundaryId, admissionPolicyId: policy.policyId }));
    const out = res.json();
    expect(out.admission.outcome).toBe("ADMISSIBLE");

    const stored = await prisma.pilotDatasetSubmissionRecord.findUniqueOrThrow({
      where: { idempotencyKey: out.idempotencyKey },
    });
    expect(stored.admissionOutcome).toBe("ADMISSIBLE");
    expect(stored.admissionPolicyId).toBe(policy.policyId);
    expect(stored.admissionPolicyVersion).toBe("1.0.0");
    expect(stored.admissionPolicyHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(stored.admissionPolicyHash).toBe(out.admissionPolicyHash);
  });

  it("10 · retiring a policy does not alter a decision already made under it", async () => {
    const boundaryId = `pb-${uid()}`;
    const policy = await activated(boundaryId);
    const out = (await submit(datasetBody({ boundaryId, admissionPolicyId: policy.policyId }))).json();
    const before = await prisma.pilotDatasetSubmissionRecord.findUniqueOrThrow({
      where: { idempotencyKey: out.idempotencyKey },
    });

    expect((await move("retire", boundaryId, policy.policyId as string)).statusCode).toBe(200);

    const after = await prisma.pilotDatasetSubmissionRecord.findUniqueOrThrow({
      where: { idempotencyKey: out.idempotencyKey },
    });
    expect(after).toEqual(before); // byte-identical: history is not re-graded by a later decision
    expect(after.admissionPolicyHash).toBe(before.admissionPolicyHash);
  });

  it("11 · the governance read carries complete audit metadata", async () => {
    const boundaryId = `pb-${uid()}`;
    const policy = await activated(boundaryId);
    const res = await app.inject({
      method: "GET",
      url: `/pilot/admission-policies/governance?boundaryId=${boundaryId}&policyId=${policy.policyId}&policyVersion=1.0.0`,
      headers: STEWARD,
    });
    expect(res.statusCode).toBe(200);
    const gov = res.json();

    expect(gov.state).toBe("ACTIVE");
    expect(gov.policyHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(gov.proposedBy).toBe(OPERATOR["x-actor-id"]);
    expect(gov.activatedBy).toBe(STEWARD["x-actor-id"]);
    expect(gov.proposedBy).not.toBe(gov.activatedBy); // the separation is visible in the record
    expect(Date.parse(gov.proposedAt)).toBeLessThanOrEqual(Date.parse(gov.activatedAt));
    for (const e of gov.events) {
      expect(e.actorId).toBeTruthy();
      expect(e.actorRole).toBeTruthy();
      expect(e.rationale).toBeTruthy(); // a governance decision with no stated reason is not one
      expect(e.at).toBeTruthy();
    }
  });

  it("12 · a proposal with no rationale is refused — governance needs something to review", async () => {
    const res = await app.inject({
      method: "POST", url: "/pilot/admission-policies", headers: OPERATOR,
      payload: { boundaryId: `pb-${uid()}`, policy: policyBody() } as object, // no rationale
    });
    expect(res.statusCode).toBe(400);
  });

  it("13 · governance creates no Proof, Case, evidence or authority record", async () => {
    const boundaryId = `pb-${uid()}`;
    const policy = await activated(boundaryId);
    await move("freeze", boundaryId, policy.policyId as string);
    await move("unfreeze", boundaryId, policy.policyId as string);
    await move("retire", boundaryId, policy.policyId as string);

    const ids = [boundaryId, policy.policyId as string];
    expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId } })).toBe(0);
    expect(await prisma.proof.count({ where: { recoveryCaseId: { in: ids } } })).toBe(0);
    expect(await prisma.authorityEvent.count({ where: { recoveryCaseId: { in: ids } } })).toBe(0);
    expect(await prisma.evidenceRecord.count({ where: { recoveryCaseId: { in: ids } } })).toBe(0);
    expect(await prisma.baselineSnapshot.count({ where: { recoveryCaseId: { in: ids } } })).toBe(0);
  });
});
