/** Synthetic wiring verification only; no real payment or causal recovery is asserted. */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { fixtureVerifier } from "../test/sourceFixture";
import { prisma } from "../db";
import { AUTHOR, APPROVER, STEWARD, hdr, seedBaseline, seedIntervention, seedEvidence, approveBody } from "../test/fixtures";
import { ingestSecureCsv } from "./secureCsvIngestion";
import { PostgresCaseCandidateStore } from "./postgresCaseCandidateStore";
import { SYNTHETIC_OPTIONS, syntheticCsv, syntheticRecords } from "./fixtures/activation.synthetic";

describe.skipIf(!process.env.DATABASE_URL)("SYNTHETIC CSV to governed proof", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("links ingestion, human review, promotion, action and immutable proof without counting opportunity", async () => {
    const boundaryId = `SYNTHETIC-loop-${randomUUID()}`;
    const operator = hdr("SYNTHETIC-reviewer", "operator");
    const input = syntheticCsv([syntheticRecords()[0]!]);
    await expect(ingestSecureCsv(input, new PostgresCaseCandidateStore(), { ...SYNTHETIC_OPTIONS, boundaryId }))
      .resolves.toMatchObject({ created: 1 });
    const queue = await app.inject({ method: "GET", url: `/agent-candidates?boundaryId=${boundaryId}`, headers: operator });
    expect(queue.statusCode).toBe(200);
    expect(queue.json()).toHaveLength(1);
    const candidateId = queue.json()[0].candidateId;
    const promote = () => app.inject({ method: "POST", url: `/agent-candidates/${candidateId}/promote`, headers: operator, payload: { boundaryId } });
    expect((await promote()).statusCode).toBe(409);
    const review = await app.inject({ method: "POST", url: `/agent-candidates/${candidateId}/review`, headers: operator,
      payload: { boundaryId, decision: "accepted", reason: "SYNTHETIC wiring test" } });
    expect(review.statusCode).toBe(201);
    const promoted = await promote();
    expect(promoted.statusCode).toBe(201);
    const caseId = promoted.json().recoveryCase.recoveryCaseId;
    expect(promoted.json().recoveryCase.sourceCandidateId).toBe(candidateId);
    expect(promoted.json().recoveryCase.amountAtRiskMinor).toBe(10_000);
    expect(await prisma.proof.count({ where: { recoveryCaseId: caseId } })).toBe(0);
    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR })).statusCode).toBe(201);
    const baselineId = await seedBaseline(app, caseId, { calculatedMinor: 2_000 });
    await seedIntervention(app, caseId);
    const { evidenceId, res } = await seedEvidence(app, caseId, { amountMinor: 7_000, currency: "USD" });
    expect(res.statusCode).toBe(201);
    expect(res.json().sourceVerification).toMatchObject({ method: "ed25519-v1", keyId: "SYNTHETIC-billing" });
    const proofId = `SYNTHETIC-proof-${randomUUID()}`;
    const payload = approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId], collectedMinor: 7_000 });
    const selfApproval = await app.inject({ method: "POST", url: "/proofs", headers: hdr("dana@company", "approver"), payload });
    expect(selfApproval.statusCode).toBe(403);
    const approved = await app.inject({ method: "POST", url: "/proofs", headers: APPROVER, payload });
    expect(approved.statusCode, approved.body).toBe(201);
    expect(approved.json().revenueReturned.minor).toBe(5_000);
    const exported = await app.inject({ method: "GET", url: `/audit/cases/${caseId}/cfo-export`, headers: STEWARD });
    expect(exported.statusCode).toBe(200);
    expect(exported.json().provenRevenueReturnedMinor).toBe(5_000);
    expect(exported.json().auditableRevenueMinor).toBe(5_000);
    const before = await prisma.proof.findUniqueOrThrow({ where: { proofId } });
    await expect(ingestSecureCsv(input, new PostgresCaseCandidateStore(), { ...SYNTHETIC_OPTIONS, boundaryId }))
      .resolves.toMatchObject({ created: 0 });
    const replay = await promote();
    expect(replay.statusCode).toBe(200);
    expect(replay.json().recoveryCase.recoveryCaseId).toBe(caseId);
    expect(await prisma.proof.findUniqueOrThrow({ where: { proofId } })).toEqual(before);
    expect(await prisma.proof.count({ where: { recoveryCaseId: caseId } })).toBe(1);
  });

  it("does not turn a caller's billing label into independent proof", async () => {
    const caseId = `SYNTHETIC-unverified-${randomUUID()}`;
    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR })).statusCode).toBe(201);
    const baselineId = await seedBaseline(app, caseId, { calculatedMinor: 2_000 });
    await seedIntervention(app, caseId);
    const evidenceId = `EV-${randomUUID()}`;
    const payload = { evidenceId, sourceSystem: "billing", sourceRecordId: `SYNTHETIC-${randomUUID()}`,
      evidenceType: "invoice_paid", observedAt: new Date().toISOString(), amountMinor: 7_000, currency: "USD" };
    const ingested = await app.inject({ method: "POST", url: `/cases/${caseId}/evidence`, headers: AUTHOR, payload });
    expect(ingested.statusCode).toBe(201);
    expect(ingested.json()).toMatchObject({ trustClassification: "beneficiary_controlled", beneficiaryControl: true, sourceVerification: null });
    const proofId = `PF-${randomUUID()}`;
    const approval = await app.inject({ method: "POST", url: "/proofs", headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId], collectedMinor: 7_000 }) });
    expect(approval.statusCode).toBe(403);
    expect(await prisma.proof.findUnique({ where: { proofId } })).toBeNull();
    const supporting = await seedEvidence(app, caseId, { sourceSystem: "crm", evidenceType: "meeting_note" });
    expect(supporting.res.statusCode).toBe(201);
    const laundering = await app.inject({ method: "POST", url: "/proofs", headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId, supporting.evidenceId], collectedMinor: 7_000 }) });
    expect(laundering.statusCode).toBe(403);
    expect(laundering.json().message).toMatch(/authenticated independent outcome/);
    const forgedId = `EV-${randomUUID()}`;
    const forged = await app.inject({ method: "POST", url: `/cases/${caseId}/evidence`, headers: AUTHOR,
      payload: { ...payload, evidenceId: forgedId, sourceAttestation: {
        keyId: "SYNTHETIC-billing", issuedAt: new Date().toISOString(), signature: `${"A".repeat(86)}==`,
      } } });
    expect(forged.statusCode).toBe(403);
    expect(await prisma.evidenceRecord.findUnique({ where: { evidenceId: forgedId } })).toBeNull();
  });
});
