// FINDING 3 · The admission policy's calculation-method provenance.
//
// WHAT WAS WRONG. `PilotAdmissionPolicy.calculationMethodVersion` documents itself as "Which evaluator
// computed the rates" — a statement about the SERVER's implementation — and yet it arrived from the
// operator, in the request body, validated only as a non-empty string. An audit proved the consequence
// empirically: an arbitrary label passed `validateAdmissionPolicy` with ZERO defects, changed
// `admissionPolicyHash`, and therefore changed the `PAD-` frozen into the decision, while the evaluator
// that actually ran was untouched and recorded separately. The label changed no outcome, no count, no
// rate and no check — so the harm was never a wrong verdict. It was the PROOF carrying an
// operator-authored claim about which calculation produced it, which Trust Invariant rule 4 forbids.
//
// WHY ONE CONCEPT AND NOT TWO LAYERS. Both constants arrived in the same commit (079ca1e).
// `ADMISSION_CALC_VERSION`'s module doc says it mirrors `AssessmentPolicy` — "method version, frozen at
// construction, stamped into every decision" — but the decision is stamped from
// `ADMISSION_EVALUATOR_VERSION`, so that mirror was never implemented. And `ADMISSION_CALC_VERSION` is
// read by no evaluator anywhere. One concept, two inconsistent constants.
//
// WHAT IS TRUE NOW. The field is gone from the request and the server stamps
// `ADMISSION_EVALUATOR_VERSION`, so `admissionPolicyHash` commits the evaluator that will really judge.
//
// HISTORY IS NOT TOUCHED. A row recorded "admission-2026.1"; that remains what it recorded. Proofs I and
// J pin its hash and its PAD to absolute values so no future change can quietly reinterpret them.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { SYNTHETIC_PROVENANCE, syntheticPilotCsv, SCENARIO_POLICY } from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../src/contract/pilotDataContract";
import { ADMISSION_CALC_VERSION, makeAdmissionPolicy } from "../../src/contract/pilotAdmissionPolicy";
import { ADMISSION_EVALUATOR_VERSION } from "../../src/contract/admissionGate";
import { hashAdmissionPolicy, POLICY_HASH_SCHEME } from "../../src/contract/policyHash";
import { deriveAdmissionDecisionId } from "../../src/contract/assessmentExecution";
import { ensureGovernedTerms, GOVERNED_TERMS_FIELDS } from "../test/governedTerms";
import { admissionPolicySchema } from "../http/schemas";
import { registerPilotAdmissionPolicy } from "./pilotIntakeService";

const HAS_DB = !!process.env.DATABASE_URL;
const OPERATOR = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
const STEWARD = { "x-actor-id": "gov@company", "x-actor-role": "steward" };
const uid = () => Math.random().toString(36).slice(2, 10);
const read = (p: string) => readFileSync(resolve(__dirname, "..", "..", p), "utf8");

/** The thresholds, WITHOUT provenance — exactly what a request may now say. */
const THRESHOLDS = Object.freeze({
  ...SCENARIO_POLICY,
  requiredLifecycleStates: [...SCENARIO_POLICY.requiredLifecycleStates],
});

describe("Finding 3 · admission-policy provenance is stamped, never accepted", () => {
  // ── I, J · HISTORY · no database needed, and deliberately pinned to absolute values ──────────────

  it("I · a historical policy carrying the retired label still hashes byte-identically", async () => {
    // The whole point of the immutability promise. A row written before this correction recorded
    // "admission-2026.1"; recomputing its hash from its OWN stored values must return the same digest
    // forever, whatever this build now stamps on new rows. Pinned absolutely, so a future change to the
    // canonicalisation cannot be hidden behind a relative assertion that moves with it.
    const historical = makeAdmissionPolicy({
      policyId: "pol-historical",
      policyVersion: "1.0.0",
      calculationMethodVersion: ADMISSION_CALC_VERSION,
      ...THRESHOLDS,
    });
    expect(historical.calculationMethodVersion).toBe("admission-2026.1");
    expect(await hashAdmissionPolicy(historical)).toBe(
      "sha256:7d92cfd3205404b4209149abf7ffc27dfb13d3c28b16a5de6734c20d4edddb43",
    );
  });

  it("J · and still derives the same PAD, which is what makes the frozen decision reproducible", async () => {
    const historical = makeAdmissionPolicy({
      policyId: "pol-historical",
      policyVersion: "1.0.0",
      calculationMethodVersion: ADMISSION_CALC_VERSION,
      ...THRESHOLDS,
    });
    const pad = await deriveAdmissionDecisionId({
      boundaryId: "pb-historical",
      idempotencyKey: `pds_${"0".repeat(64)}`,
      datasetFingerprint: "0".repeat(64),
      contractVersion: "2.0.0",
      outcome: "ADMISSIBLE",
      admissionPolicyId: "pol-historical",
      admissionPolicyVersion: "1.0.0",
      admissionPolicyHash: await hashAdmissionPolicy(historical),
    });
    expect(pad).toBe("PAD-299cffde22d5840237b14e02358032bd");
  });

  it("and the SAME thresholds with corrected provenance hash DIFFERENTLY — desirable evidence", async () => {
    // Stated as a positive expectation rather than tolerated as a side effect. A policy registered now
    // commits the evaluator that will judge; one registered before committed a label nobody checked. They
    // are not the same definition and must not share an identity.
    const corrected = makeAdmissionPolicy({
      policyId: "pol-historical",
      policyVersion: "1.0.0",
      calculationMethodVersion: ADMISSION_EVALUATOR_VERSION,
      ...THRESHOLDS,
    });
    expect(await hashAdmissionPolicy(corrected)).toBe(
      "sha256:69e9ca67065e56686957ce576caf75d637d4a8d35e2d7caf9cbac2b69fd65b8e",
    );
    expect(await hashAdmissionPolicy(corrected)).not.toBe(
      "sha256:7d92cfd3205404b4209149abf7ffc27dfb13d3c28b16a5de6734c20d4edddb43",
    );
  });

  it("the hash SCHEME is unchanged — this was a value correction, not a canonicalisation change", async () => {
    // The five-point proof, pinned where it can fail. Field set and order live in `canonicalize`, which
    // this slice did not touch; what changed is which VALUE the server puts in one existing field. A new
    // scheme would have re-identified every future policy for no reason and broken the one thing that
    // must not break — that a historical row verifies from its own stored values.
    expect(POLICY_HASH_SCHEME).toBe("nh-admission-policy-v1");
    const source = read("src/contract/policyHash.ts");
    const open = source.indexOf("function canonicalize(");
    const block = source.slice(open, source.indexOf("\n}", open));
    for (const field of [
      "POLICY_HASH_SCHEME",
      "policy.policyId",
      "policy.policyVersion",
      "policy.calculationMethodVersion",
      "policy.minAcceptedRows",
    ]) {
      expect(block, field).toContain(field);
    }
  });

  // ── C, D · the two production callers emit no such property ──────────────────────────────────────

  it("C · the governance UI cannot send it, and says why", () => {
    // Source-level: types are erased and this suite is not typechecked. The UI still NAMES the evaluator
    // constant — it previews the policy the server will construct so its local defect list is honest —
    // which is why the assertion is about the property form, not about the mention.
    const ui = read("src/modules/governance/PilotPolicyGovernance.tsx");
    const open = ui.indexOf("function completePolicy(");
    expect(open).toBeGreaterThan(-1);
    const block = ui.slice(open, ui.indexOf("\n}", open));
    expect(block).not.toMatch(/calculationMethodVersion\s*:/);
    // The client's request type must not accept one either.
    expect(read("src/data/pilotPolicyClient.ts")).toContain('Omit<PilotAdmissionPolicy, "calculationMethodVersion">');
  });

  it("D · the rehearsal agent cannot send it", () => {
    const agent = read("server/agents/pilotAssessmentRehearsal.ts");
    expect(agent).not.toMatch(/calculationMethodVersion\s*:/);
    expect(agent).not.toContain("ADMISSION_CALC_VERSION");
  });

  it("pins the admission-policy body as an ALLOWLIST, so no provenance field re-enters renamed", () => {
    // Same technique and same reason as the scheduling surface test: a behavioural test only covers the
    // field someone thought to inject. What has to hold is shape-shaped — the request states THRESHOLDS
    // and an identity, and says nothing about the implementation that will judge them. A new field fails
    // this until someone states what it is.
    const policy = admissionPolicySchema.body.properties.policy;
    expect(Object.keys(policy.properties).sort()).toEqual([
      "maxDuplicateRate",
      "maxMissingRecommendedColumns",
      "maxOrderingDefectRate",
      "maxRejectionRate",
      "maxSingleReasonShare",
      "minAcceptedRows",
      "minCoverageDays",
      "minDistinctEntities",
      "policyId",
      "policyVersion",
      "requireProvenanceDeclaration",
      "requiredLifecycleStates",
    ]);
    expect(policy.required as readonly string[]).not.toContain("calculationMethodVersion");
    expect(policy.additionalProperties).toBe(false);
    expect(admissionPolicySchema.body.additionalProperties).toBe(false);
    // The ajv option is what turns that into a 400 rather than a silent strip. Pinned by reading it.
    expect(read("server/app.ts")).toMatch(
      /ajv:\s*\{\s*customOptions:\s*\{\s*removeAdditional:\s*false\s*\}\s*\}/,
    );
  });

  it("the retired constant describes itself as retired, and no production path reads it", () => {
    // Kept rather than deleted, because historical rows store this exact string and proofs I/J need to
    // name it. What must not survive is its use as a description of a CURRENT evaluator.
    const decl = read("src/contract/pilotAdmissionPolicy.ts");
    expect(decl).toMatch(/RETIRED 2026-10-04/);
    expect(ADMISSION_CALC_VERSION).toBe("admission-2026.1");
    for (const p of [
      "src/modules/governance/PilotPolicyGovernance.tsx",
      "server/agents/pilotAssessmentRehearsal.ts",
      "server/services/pilotIntakeService.ts",
      "server/http/schemas.ts",
    ]) {
      expect(read(p), p).not.toContain("ADMISSION_CALC_VERSION");
    }
  });
});

describe.skipIf(!HAS_DB)("Finding 3 · over the real transport and the real register", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const propose = (boundaryId: string, policy: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: "/pilot/admission-policies",
      headers: OPERATOR,
      payload: { boundaryId, policy, rationale: "fixture" },
    });

  async function registered() {
    const boundaryId = `pb-${uid()}`;
    const policyId = `pol-${uid()}`;
    const res = await propose(boundaryId, { policyId, policyVersion: "1.0.0", ...THRESHOLDS });
    expect(res.statusCode, res.body).toBe(201);
    return { boundaryId, policyId };
  }

  // ── A, B · the request cannot express it ─────────────────────────────────────────────────────────

  it("A+B · an injected calculationMethodVersion is REJECTED 400, not silently stripped", async () => {
    const boundaryId = `pb-${uid()}`;
    const policyId = `pol-${uid()}`;
    // The existing schema policy decides this: `additionalProperties: false` under
    // `removeAdditional: false`. Stripping would also be safe for the hash, but it would tell a caller
    // their provenance claim was accepted.
    for (const value of [ADMISSION_EVALUATOR_VERSION, ADMISSION_CALC_VERSION, "totally-made-up-v99"]) {
      const res = await propose(boundaryId, {
        policyId,
        policyVersion: "1.0.0",
        calculationMethodVersion: value,
        ...THRESHOLDS,
      });
      expect(res.statusCode, value).toBe(400);
    }
    // Even the CORRECT value is refused, which is the point: this is not a validation of the label, it
    // is the removal of the caller's standing to state one at all.
    expect(await prisma.pilotAdmissionPolicyRecord.count({ where: { boundaryId } })).toBe(0);
  });

  // ── E, F · what the server actually stores and hashes ────────────────────────────────────────────

  it("E+F · a server-created policy stores the EVALUATOR version, and the hash commits it", async () => {
    const { boundaryId, policyId } = await registered();
    const row = await prisma.pilotAdmissionPolicyRecord.findFirstOrThrow({ where: { boundaryId, policyId } });
    expect(row.calculationMethodVersion).toBe(ADMISSION_EVALUATOR_VERSION);

    // Recomputed independently from the row's own values — not read back from the response.
    const expected = await hashAdmissionPolicy(
      makeAdmissionPolicy({
        policyId: row.policyId,
        policyVersion: row.policyVersion,
        calculationMethodVersion: row.calculationMethodVersion,
        minAcceptedRows: row.minAcceptedRows,
        minDistinctEntities: row.minDistinctEntities,
        maxRejectionRate: row.maxRejectionRate,
        maxSingleReasonShare: row.maxSingleReasonShare,
        maxDuplicateRate: row.maxDuplicateRate,
        minCoverageDays: row.minCoverageDays,
        requiredLifecycleStates: row.requiredLifecycleStates as never,
        maxOrderingDefectRate: row.maxOrderingDefectRate,
        maxMissingRecommendedColumns: row.maxMissingRecommendedColumns,
        requireProvenanceDeclaration: row.requireProvenanceDeclaration,
      }),
    );
    expect(row.policyHash).toBe(expected);
    // And it is NOT the hash the retired label would have produced.
    expect(row.calculationMethodVersion).not.toBe(ADMISSION_CALC_VERSION);
  });

  // ── G · the policy and the decision now agree ───────────────────────────────────────────────────

  it("G · the decision's evaluator version equals the NEW policy's — the mirror finally holds", async () => {
    // This is the agreement the original module comment promised and never delivered: the policy records
    // the evaluator, and the decision is stamped from the evaluator, so for a new record they match.
    const { boundaryId, policyId } = await registered();
    expect(
      (await app.inject({
        method: "POST", url: "/pilot/admission-policies/activate", headers: STEWARD,
        payload: { boundaryId, policyId, policyVersion: "1.0.0", rationale: "reviewed" },
      })).statusCode,
    ).toBe(200);
    await ensureGovernedTerms(boundaryId);
    const submitted = (await app.inject({
      method: "POST", url: "/pilot/datasets", headers: OPERATOR,
      payload: {
        boundaryId, datasetId: `ds-${uid()}`, declaredVersion: PILOT_DATA_CONTRACT_VERSION,
        csvText: syntheticPilotCsv(40), provenance: SYNTHETIC_PROVENANCE, ...GOVERNED_TERMS_FIELDS,
        admissionPolicyId: policyId, admissionPolicyVersion: "1.0.0",
      },
    })).json();
    expect(submitted.admission.outcome).toBe("ADMISSIBLE");
    const row = await prisma.pilotAdmissionPolicyRecord.findFirstOrThrow({ where: { boundaryId, policyId } });
    expect(submitted.admission.calculationMethodVersion).toBe(row.calculationMethodVersion);
    expect(submitted.admission.calculationMethodVersion).toBe(ADMISSION_EVALUATOR_VERSION);
  });

  // ── H · the caller's label cannot reach anything ─────────────────────────────────────────────────

  it("H · an attempted label changes no hash, no PAD, no verdict and no stored policy", async () => {
    // Refused BEFORE governance, so there is nothing downstream to compare: the comparison is against a
    // clean registration of the identical thresholds.
    const clean = await registered();
    const cleanRow = await prisma.pilotAdmissionPolicyRecord.findFirstOrThrow({
      where: { boundaryId: clean.boundaryId, policyId: clean.policyId },
    });

    const attempted = `pb-${uid()}`;
    const attemptedId = `pol-${uid()}`;
    const res = await propose(attempted, {
      policyId: attemptedId, policyVersion: "1.0.0",
      calculationMethodVersion: "totally-made-up-v99", ...THRESHOLDS,
    });
    expect(res.statusCode).toBe(400);
    // No row, so no hash and no PAD could have been derived from it.
    expect(await prisma.pilotAdmissionPolicyRecord.count({ where: { boundaryId: attempted } })).toBe(0);
    expect(await prisma.pilotAdmissionPolicyEventRecord.count({ where: { boundaryId: attempted } })).toBe(0);

    // And a clean registration of the same thresholds under that id hashes to exactly what the
    // evaluator version implies — computed independently here rather than compared against the first
    // registration, because `policyId` is itself in the preimage and the two ids differ by design.
    const second = await propose(attempted, { policyId: attemptedId, policyVersion: "1.0.0", ...THRESHOLDS });
    expect(second.statusCode).toBe(201);
    const secondRow = await prisma.pilotAdmissionPolicyRecord.findFirstOrThrow({
      where: { boundaryId: attempted, policyId: attemptedId },
    });
    expect(secondRow.calculationMethodVersion).toBe(ADMISSION_EVALUATOR_VERSION);
    expect(secondRow.policyHash).toBe(
      await hashAdmissionPolicy(
        makeAdmissionPolicy({
          policyId: attemptedId,
          policyVersion: "1.0.0",
          calculationMethodVersion: ADMISSION_EVALUATOR_VERSION,
          ...THRESHOLDS,
        }),
      ),
    );
    // ...and NOT what the attempted label would have produced, had it been honoured.
    expect(secondRow.policyHash).not.toBe(
      await hashAdmissionPolicy(
        makeAdmissionPolicy({
          policyId: attemptedId,
          policyVersion: "1.0.0",
          calculationMethodVersion: "totally-made-up-v99",
          ...THRESHOLDS,
        }),
      ),
    );
    // The clean registration from the other boundary is untouched throughout.
    expect(
      (await prisma.pilotAdmissionPolicyRecord.findFirstOrThrow({
        where: { boundaryId: clean.boundaryId, policyId: clean.policyId },
      })).policyHash,
    ).toBe(cleanRow.policyHash);
  });

  it("the SERVICE ignores a smuggled value even if the transport ever let one through", async () => {
    // FOUND BY A FALSIFIER THAT MASKED ITSELF. Reversing the spread order in the service is only
    // observable if the transport does not reject the field first — so a falsifier that reinstates the
    // schema AND reverses the order fails on the 400 and proves nothing about the inner layer. This
    // bypasses the transport entirely, which is the case the spread order exists for: an in-process
    // caller, a future route, a script. Same shape as the analysis-terms suite's own smuggling test.
    const boundaryId = `pb-${uid()}`;
    const policyId = `pol-${uid()}`;
    const actor = { actorId: OPERATOR["x-actor-id"], role: "operator" as const, boundaryIds: Object.freeze(["*"]) };
    await registerPilotAdmissionPolicy(actor, {
      boundaryId,
      policy: {
        policyId,
        policyVersion: "1.0.0",
        ...THRESHOLDS,
        // Smuggled past the type as a caller who ignored it would.
        calculationMethodVersion: "smuggled-in-process-v1",
      } as never,
      rationale: "smuggling probe",
    });
    const row = await prisma.pilotAdmissionPolicyRecord.findFirstOrThrow({ where: { boundaryId, policyId } });
    expect(row.calculationMethodVersion).toBe(ADMISSION_EVALUATOR_VERSION);
    expect(row.policyHash).toBe(
      await hashAdmissionPolicy(
        makeAdmissionPolicy({
          policyId,
          policyVersion: "1.0.0",
          calculationMethodVersion: ADMISSION_EVALUATOR_VERSION,
          ...THRESHOLDS,
        }),
      ),
    );
  });

  // ── L · a correction may not overwrite history ───────────────────────────────────────────────────

  it("L · re-registering an existing policyId@policyVersion is refused; the stored row is unchanged", async () => {
    // The corrected definition is a NEW version, never a mutation. The primary key and the append-only
    // trigger both stand behind that, and the row is re-read afterwards to prove nothing moved.
    const { boundaryId, policyId } = await registered();
    const before = await prisma.pilotAdmissionPolicyRecord.findFirstOrThrow({ where: { boundaryId, policyId } });

    const again = await propose(boundaryId, {
      policyId, policyVersion: "1.0.0", ...THRESHOLDS, minAcceptedRows: THRESHOLDS.minAcceptedRows + 7,
    });
    expect(again.statusCode).toBeGreaterThanOrEqual(400);

    const after = await prisma.pilotAdmissionPolicyRecord.findFirstOrThrow({ where: { boundaryId, policyId } });
    expect(after.policyHash).toBe(before.policyHash);
    expect(after.minAcceptedRows).toBe(before.minAcceptedRows);
    expect(after.calculationMethodVersion).toBe(before.calculationMethodVersion);

    // A new VERSION is the supported path, and it is a different definition with a different hash.
    const next = await propose(boundaryId, {
      policyId, policyVersion: "2.0.0", ...THRESHOLDS, minAcceptedRows: THRESHOLDS.minAcceptedRows + 7,
    });
    expect(next.statusCode).toBe(201);
    const nextRow = await prisma.pilotAdmissionPolicyRecord.findFirstOrThrow({
      where: { boundaryId, policyId, policyVersion: "2.0.0" },
    });
    expect(nextRow.policyHash).not.toBe(before.policyHash);
  });
});
