// EP-8.1 · Trust Gate Hardening — permanent regression tests for every adversarial probe
// discovered during the Sonnet + Fable review that preceded this implementation:
//   C1 trusted policy/threshold/evidence enforcement
//   C2 fail-closed ownership/self-approval protection
//   H1 proof-chain concurrency protection
//   H2 governed provenance reads
//   M1 additive boundary validation
//   immutable BaselineSnapshot / governed Intervention timing / pre-proof Evidence ingestion
//   server-derived evidence role / independent-evidence classification
//   amount+currency+case binding / single-use outcome evidence / server-pinned timestamps
//   fail-closed temporal trust / CFO export exclusion for unresolved trust gaps
// Each `it` below reproduces one specific adversarial finding; the pre-EP-8.1 behavior is noted
// in the test body's comment so a future regression is caught, not just "some test failed."
// Skips without DATABASE_URL.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import {
  uid,
  AUTHOR,
  APPROVER,
  VERIFIER,
  STEWARD,
  seedAuditableCase,
  seedBaseline,
  seedIntervention,
  seedEvidence,
  approveBody,
} from "../test/fixtures";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("EP-8.1 · trust gate hardening (adversarial regressions)", () => {
  const app = buildApp();
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("1 · C2: approval of a never-authored (unowned) case is rejected, fail-closed — was 201", async () => {
    const caseId = `RC-${uid()}`;
    // deliberately no POST /cases/:id/author call — the case has no recorded owner at all
    const res = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId: `PF-${uid()}`, caseId, baselineId: `BL-${uid()}`, evidenceIds: ["ev-1"] }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/no authoritative case author|unowned/i);
  });

  it("2 · H1: concurrent revision requests cannot fork the proof chain — was 201/201, two v2 rows", async () => {
    const { caseId, baselineId, evidenceId } = await seedAuditableCase(app);
    const p1 = `PF-${uid()}`;
    const created = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId: p1, caseId, baselineId, evidenceIds: [evidenceId] }),
    });
    expect(created.statusCode).toBe(201);

    const [r1, r2] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/proofs/${p1}/revisions`,
        headers: APPROVER,
        payload: { newProofId: `PF-${uid()}`, status: "Corrected", collectedMinor: 1_400_000 },
      }),
      app.inject({
        method: "POST",
        url: `/proofs/${p1}/revisions`,
        headers: APPROVER,
        payload: { newProofId: `PF-${uid()}`, status: "Corrected", collectedMinor: 1_450_000 },
      }),
    ]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([201, 409]);
    const v2Rows = await prisma.proof.findMany({ where: { chainId: p1, proofVersion: 2 } });
    expect(v2Rows).toHaveLength(1); // exactly one — the DB unique index closes the race
  });

  it("3 · manual-only evidence at auditable-tier confidence is rejected, not silently allowed", async () => {
    const caseId = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    const baselineId = await seedBaseline(app, caseId);
    await seedIntervention(app, caseId);
    const { evidenceId, res: evRes } = await seedEvidence(app, caseId, {
      sourceSystem: "manual",
      sourceRecordId: `note-${uid()}`,
      evidenceType: "operator_note",
      amountMinor: 1_320_000,
    });
    expect(evRes.statusCode).toBe(201);
    const res = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId: `PF-${uid()}`, caseId, baselineId, evidenceIds: [evidenceId], confidenceUsed: 95 }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/independent evidence/i);
  });

  // Item 4 (legitimate billing outcome → auditable) is covered end-to-end by
  // server/http/api.test.ts #1, server/audit/auditService.test.ts #1, and
  // server/auth/authz.test.ts #12 — the full legitimate path is exercised there.

  it("5 · C1: client-supplied pinned/frozen fields are rejected before persistence — was silently accepted", async () => {
    const { caseId, baselineId, evidenceId } = await seedAuditableCase(app);
    const base = approveBody({ proofId: `PF-${uid()}`, caseId, baselineId, evidenceIds: [evidenceId] });
    const injectedFields: Record<string, unknown> = {
      policyVersion: "attacker-policy",
      confidenceMethodologyVersion: "attacker-conf",
      proofThresholdUsed: 0,
      baselineMinor: 1,
      baselineMethodId: "attacker-method",
      baselineVersion: 99,
      baselineLockPolicy: "attacker-policy",
      approvedAt: "2020-01-01T00:00:00.000Z",
      evidenceRefs: ["fake-ev"],
    };
    for (const [field, value] of Object.entries(injectedFields)) {
      const res = await app.inject({
        method: "POST",
        url: "/proofs",
        headers: APPROVER,
        payload: { ...base, proofId: `PF-${uid()}`, [field]: value },
      });
      expect(res.statusCode, `field '${field}' should be rejected`).toBe(400);
    }
  });

  it("6 · M1: an invalid recoveryReason or currency is rejected", async () => {
    const { caseId, baselineId, evidenceId } = await seedAuditableCase(app);
    const base = approveBody({ proofId: `PF-${uid()}`, caseId, baselineId, evidenceIds: [evidenceId] });
    const badReason = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: { ...base, proofId: `PF-${uid()}`, recoveryReason: "NotARealReason" },
    });
    expect(badReason.statusCode).toBe(400);
    const badCurrency = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: { ...base, proofId: `PF-${uid()}`, currency: "XXX" },
    });
    expect(badCurrency.statusCode).toBe(400);
  });

  it("7 · H2: a beneficiary (author) cannot read provenance-bearing proof endpoints — was 200", async () => {
    const { caseId, baselineId, evidenceId } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId] }),
    });
    expect((await app.inject({ method: "GET", url: `/proofs/${proofId}`, headers: AUTHOR })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/cases/${caseId}/proofs`, headers: AUTHOR })).statusCode).toBe(403);
  });

  it("8 · H2: approver/verifier/steward may still read provenance-bearing proof endpoints", async () => {
    const { caseId, baselineId, evidenceId } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId] }),
    });
    for (const role of [APPROVER, VERIFIER, STEWARD]) {
      expect((await app.inject({ method: "GET", url: `/proofs/${proofId}`, headers: role })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `/cases/${caseId}/proofs`, headers: role })).statusCode).toBe(200);
    }
  });

  it("9 · a nonexistent/foreign baseline id is rejected, never invented", async () => {
    const caseId = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    const res = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId: `PF-${uid()}`, caseId, baselineId: `BL-nonexistent-${uid()}`, evidenceIds: ["ev-1"] }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("10 · a baseline locked after a KNOWN intervention is rejected — known violations block", async () => {
    const caseId = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    await seedIntervention(app, caseId); // intervention recorded FIRST
    const baselineId = await seedBaseline(app, caseId); // baseline locked AFTER — a real violation
    const { evidenceId, res: evRes } = await seedEvidence(app, caseId, { amountMinor: 1_320_000 });
    expect(evRes.statusCode).toBe(201);
    const res = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId: `PF-${uid()}`, caseId, baselineId, evidenceIds: [evidenceId] }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/locked after the intervention/i);
  });

  it("11 · a baseline locked after KNOWN outcome evidence ingestion is rejected", async () => {
    const caseId = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    const { evidenceId, res: evRes } = await seedEvidence(app, caseId, { amountMinor: 1_320_000 }); // outcome evidence FIRST
    expect(evRes.statusCode).toBe(201);
    const baselineId = await seedBaseline(app, caseId); // baseline locked AFTER — a real violation
    const res = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId: `PF-${uid()}`, caseId, baselineId, evidenceIds: [evidenceId] }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/locked after the outcome/i);
  });

  it("12 · the CFO export excludes a gapped (Proven-but-not-Auditable) proof from the auditable ledger", async () => {
    const caseId = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    const baselineId = await seedBaseline(app, caseId);
    // no intervention recorded — an unknown fact (a gap), never a block
    const { evidenceId, res: evRes } = await seedEvidence(app, caseId, { amountMinor: 1_320_000, currency: "USD" });
    expect(evRes.statusCode).toBe(201);
    const proofId = `PF-${uid()}`;
    const approveRes = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId] }),
    });
    expect(approveRes.statusCode).toBe(201); // unknown timing never blocks approval
    const exp = (await app.inject({ method: "GET", url: `/audit/cases/${caseId}/cfo-export`, headers: STEWARD })).json();
    expect(exp.provenRevenueReturnedMinor).toBe(1_060_000); // proven history preserved
    expect(exp.auditableRevenueMinor).toBe(0); // gapped — excluded from the CFO-grade ledger
  });

  it("13 · evidence role is derived server-side; a non-outcome type is never classified 'outcome'", async () => {
    const caseId = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    const { evidenceId, res } = await seedEvidence(app, caseId, {
      sourceSystem: "crm",
      sourceRecordId: `crm-${uid()}`,
      evidenceType: "meeting_note",
    });
    expect(res.statusCode).toBe(201);
    const stored = await prisma.evidenceRecord.findUniqueOrThrow({ where: { evidenceId } });
    // crm is an INDEPENDENT source, yet its role is still "supporting" — independence and
    // outcome-role are separate, orthogonal classifications; one cannot buy the other.
    expect(stored.trustClassification).toBe("independent");
    expect(stored.evidenceRole).toBe("supporting");
  });

  it("14 · the same outcome source record cannot back two separate recoveries — single-use", async () => {
    const caseA = `RC-${uid()}`;
    const caseB = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseA}/author`, headers: AUTHOR });
    await app.inject({ method: "POST", url: `/cases/${caseB}/author`, headers: AUTHOR });
    const sharedRecordId = `inv-shared-${uid()}`;
    const first = await seedEvidence(app, caseA, { sourceRecordId: sharedRecordId, amountMinor: 500_000 });
    expect(first.res.statusCode).toBe(201);
    const second = await seedEvidence(app, caseB, { sourceRecordId: sharedRecordId, amountMinor: 500_000 });
    expect(second.res.statusCode).toBe(409); // the DB unique index rejects the reuse
  });

  it("15 · evidence ingested for a different case is rejected, never silently borrowed", async () => {
    const { caseId: otherCase, evidenceId: otherEvidenceId } = await seedAuditableCase(app);
    void otherCase;
    const caseId = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    const baselineId = await seedBaseline(app, caseId);
    await seedIntervention(app, caseId);
    const res = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId: `PF-${uid()}`, caseId, baselineId, evidenceIds: [otherEvidenceId] }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("16a · outcome evidence currency mismatch is rejected", async () => {
    const caseId = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    const baselineId = await seedBaseline(app, caseId, { currency: "USD" });
    await seedIntervention(app, caseId);
    const { evidenceId, res: evRes } = await seedEvidence(app, caseId, { amountMinor: 1_320_000, currency: "EUR" });
    expect(evRes.statusCode).toBe(201);
    const res = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId: `PF-${uid()}`, caseId, baselineId, evidenceIds: [evidenceId], currency: "USD" }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/currency/i);
  });

  it("16b · insufficient outcome evidence amount is rejected", async () => {
    const caseId = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    const baselineId = await seedBaseline(app, caseId);
    await seedIntervention(app, caseId);
    const { evidenceId, res: evRes } = await seedEvidence(app, caseId, { amountMinor: 100_000, currency: "USD" }); // far short of the claim
    expect(evRes.statusCode).toBe(201);
    const res = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId: `PF-${uid()}`, caseId, baselineId, evidenceIds: [evidenceId], collectedMinor: 1_320_000 }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/does not substantiate/i);
  });

  it("17 · a favorable client-claimed observedAt cannot rescue a real ordering violation", async () => {
    const caseId = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    await seedIntervention(app, caseId); // intervention recorded FIRST
    const baselineId = await seedBaseline(app, caseId); // baseline locked AFTER — a real violation
    const { evidenceId, res: evRes } = await seedEvidence(app, caseId, {
      amountMinor: 1_320_000,
      observedAt: "2020-01-01T00:00:00.000Z", // a favorably early CLAIMED date — must not matter
    });
    expect(evRes.statusCode).toBe(201);
    const res = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId: `PF-${uid()}`, caseId, baselineId, evidenceIds: [evidenceId] }),
    });
    expect(res.statusCode).toBe(409); // still rejected — the server clock (ingestedAt) is authoritative, not the claim
    expect(res.json().message).toMatch(/locked after the intervention/i);
  });

  it("18 · a superseding baseline snapshot never changes an already-approved proof", async () => {
    const { caseId, baselineId, evidenceId, collectedMinor } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    const approveRes = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId], collectedMinor }),
    });
    expect(approveRes.statusCode).toBe(201);

    const supersede = await app.inject({
      method: "POST",
      url: `/cases/${caseId}/baseline`,
      headers: AUTHOR,
      payload: {
        baselineId: `BL-${uid()}`,
        calculatedMinor: 999_000,
        currency: "USD",
        method: "matched_historical_cohort",
        methodVersion: 2,
        sourceRefs: ["src-2"],
        effectiveAt: "2026-08-01T00:00:00.000Z",
        supersedes: baselineId,
      },
    });
    expect(supersede.statusCode).toBe(201);

    const stored = await prisma.proof.findUniqueOrThrow({ where: { proofId } });
    expect(stored.baselineId).toBe(baselineId); // untouched — still the ORIGINAL locked snapshot
    expect(Number(stored.baselineMinor)).toBe(260_000);
    expect(Number(stored.revenueReturnedMinor)).toBe(collectedMinor - 260_000);
  });

  it("19 · only author/operator may establish baselines, record interventions, or ingest evidence", async () => {
    const caseId = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    const baselinePayload = {
      baselineId: `BL-${uid()}`,
      calculatedMinor: 100_000,
      currency: "USD",
      method: "matched_historical_cohort",
      methodVersion: 1,
      sourceRefs: ["src-1"],
      effectiveAt: "2026-07-01T00:00:00.000Z",
    };
    for (const role of [APPROVER, VERIFIER, STEWARD]) {
      expect(
        (await app.inject({ method: "POST", url: `/cases/${caseId}/baseline`, headers: role, payload: baselinePayload })).statusCode,
      ).toBe(403);
      expect((await app.inject({ method: "POST", url: `/cases/${caseId}/intervention`, headers: role })).statusCode).toBe(403);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/cases/${caseId}/evidence`,
            headers: role,
            payload: {
              evidenceId: `EV-${uid()}`,
              sourceSystem: "billing",
              sourceRecordId: `r-${uid()}`,
              evidenceType: "invoice_paid",
              observedAt: "2026-07-01T00:00:00.000Z",
            },
          })
        ).statusCode,
      ).toBe(403);
    }
  });

  // Item 20 (all prior EP-2/3/4/8 guarantees remain green) is the rest of the suite — this
  // file only adds the NEW EP-8.1 regressions; it does not replace the existing coverage.
});
