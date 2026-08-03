// EP-8 · Governance, audit trail & explainability acceptance tests, updated for EP-8.1 trust
// hardening (governed baseline/intervention/evidence setup precedes approval; two new
// re-derived trust gaps — interventionUnverified, baselineOrderingViolation — plus the existing
// field-completeness gaps decide auditable classification). Skips without DATABASE_URL.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import * as auditService from "./auditService";
import { uid, AUTHOR, APPROVER, VERIFIER, STEWARD, seedAuditableCase, seedBaseline, seedEvidence, approveBody } from "../test/fixtures";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("EP-8 · governance, audit trail & explainability", () => {
  const app = buildApp();
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // full author→baseline→intervention→evidence→approve pipeline; returns {caseId, proofId}
  const seedApproved = async () => {
    const { caseId, baselineId, evidenceId } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    const r = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId] }),
    });
    expect(r.statusCode).toBe(201);
    return { caseId, proofId };
  };

  it("1 · a counted proof is fully reconstructable from frozen provenance", async () => {
    const { proofId } = await seedApproved();
    const res = await app.inject({ method: "GET", url: `/audit/proofs/${proofId}`, headers: APPROVER });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.reconstructionMatches).toBe(true); // recomputed collected−baseline === stored
    expect(r.reconstructedRevenueReturnedMinor).toBe(1_060_000);
    expect(r.frozenProvenance.policyVersion).toBe("policy-2026.1");
    expect(r.auditable).toBe(true);
  });

  it("2 · unverified intervention timing prevents auditable classification (a gap, never a block)", async () => {
    const caseId = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    const baselineId = await seedBaseline(app, caseId);
    // deliberately no /intervention call — the fix timing stays unknown/unverified
    const { evidenceId, res: evRes } = await seedEvidence(app, caseId, { amountMinor: 1_320_000, currency: "USD" });
    expect(evRes.statusCode).toBe(201);
    const proofId = `PF-${uid()}`;
    const res = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId] }),
    });
    expect(res.statusCode).toBe(201); // unknown timing never blocks approval — still Proven
    const r = (await app.inject({ method: "GET", url: `/audit/proofs/${proofId}`, headers: APPROVER })).json();
    expect(r.provenanceGaps).toContain("interventionUnverified");
    expect(r.auditable).toBe(false); // incomplete provenance → excluded from auditable
  });

  it("3 · governance can flag/halt/exclude but cannot count or approve", async () => {
    const caseId = `RC-${uid()}`;
    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/flag`, headers: STEWARD })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/halt`, headers: STEWARD })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/exclude`, headers: STEWARD })).statusCode).toBe(201);
    const approve = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: STEWARD,
      payload: approveBody({ proofId: `PF-${uid()}`, caseId, baselineId: "BL-1", evidenceIds: ["ev-1"] }),
    });
    expect(approve.statusCode).toBe(403); // steward may never approve/count
  });

  it("4 · duplicate recovery counting is rejected", async () => {
    const { caseId } = await seedApproved();
    const dup = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId: `PF-${uid()}`, caseId, baselineId: "BL-1", evidenceIds: ["ev-1"] }),
    });
    expect(dup.statusCode).toBe(409); // a second chain root for the same claim
    expect(dup.json().error).toBe("conflict");
  });

  it("5 · historical audit records cannot be updated, deleted, or truncated", async () => {
    const { caseId } = await seedApproved();
    const ev = await prisma.authorityEvent.findFirstOrThrow({ where: { recoveryCaseId: caseId } });
    await expect(prisma.authorityEvent.update({ where: { id: ev.id }, data: { role: "steward" } })).rejects.toThrow(/append-only/i);
    await expect(prisma.authorityEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/i);
    await expect(prisma.$executeRawUnsafe('TRUNCATE "AuthorityEvent"')).rejects.toThrow(/append-only/i);
  });

  it("6 · a linked correction preserves the original audit chain", async () => {
    const { caseId, proofId } = await seedApproved();
    const p2 = `PF-${uid()}`;
    await app.inject({ method: "POST", url: `/proofs/${proofId}/revisions`, headers: APPROVER, payload: { newProofId: p2, status: "Corrected", collectedMinor: 1_400_000 } });
    const trail = await auditService.caseAuditTrail(APPROVER_CTX, caseId);
    expect(trail.proofs).toHaveLength(2); // original + revision, both preserved
    expect(trail.authorityTrail.map((e) => e.action)).toEqual(["Author", "Intervene", "Approve", "Approve"]);
  });

  it("7 · forecast and auditable ledgers cannot blend", async () => {
    const { caseId } = await seedApproved();
    const exp = (await app.inject({ method: "GET", url: `/audit/cases/${caseId}/cfo-export`, headers: STEWARD })).json();
    expect(exp).toHaveProperty("provenRevenueReturnedMinor");
    expect(exp).toHaveProperty("auditableRevenueMinor");
    expect(JSON.stringify(exp).toLowerCase()).not.toContain("forecast"); // never present
  });

  it("8 · audit endpoints are read-only (no state mutation)", async () => {
    const { caseId, proofId } = await seedApproved();
    // Scoped to this case: the suite runs many test files against the same shared dev
    // database, so an unscoped global count can pick up unrelated concurrent writes.
    const before = await prisma.authorityEvent.count({ where: { recoveryCaseId: caseId } });
    await app.inject({ method: "GET", url: `/audit/proofs/${proofId}`, headers: APPROVER });
    await app.inject({ method: "GET", url: `/audit/cases/${caseId}`, headers: APPROVER });
    await app.inject({ method: "GET", url: `/audit/cases/${caseId}/cfo-export`, headers: APPROVER });
    expect(await prisma.authorityEvent.count({ where: { recoveryCaseId: caseId } })).toBe(before); // reads created nothing
  });

  it("9 · every governed state transition produces an audit event", async () => {
    const { caseId, baselineId, evidenceId } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    await app.inject({ method: "POST", url: "/proofs", headers: APPROVER, payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId] }) });
    await app.inject({ method: "POST", url: `/proofs/${proofId}/verify`, headers: VERIFIER });
    await app.inject({ method: "POST", url: `/cases/${caseId}/flag`, headers: STEWARD });
    await app.inject({ method: "POST", url: `/cases/${caseId}/exclude`, headers: STEWARD });
    const events = await prisma.authorityEvent.findMany({ where: { recoveryCaseId: caseId }, orderBy: { at: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["Author", "Intervene", "Approve", "Verify", "Flag", "Exclude"]);
  });

  it("10 · no route or governance service bypasses the kernel/authority gate", async () => {
    // governance cannot approve; and the counted number is the kernel's, reconstructable
    const { proofId } = await seedApproved();
    const r = (await app.inject({ method: "GET", url: `/audit/proofs/${proofId}`, headers: APPROVER })).json();
    expect(r.reconstructionMatches).toBe(true);
    const stewardApprove = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: STEWARD,
      payload: approveBody({ proofId: `PF-${uid()}`, caseId: `RC-${uid()}`, baselineId: "BL-1", evidenceIds: ["ev-1"] }),
    });
    expect(stewardApprove.statusCode).toBe(403);
  });

  it("11 · a governance exclusion removes the amount from the auditable ledger only", async () => {
    const { caseId } = await seedApproved();
    const before = (await app.inject({ method: "GET", url: `/audit/cases/${caseId}/cfo-export`, headers: STEWARD })).json();
    expect(before.auditableRevenueMinor).toBe(1_060_000);
    await app.inject({ method: "POST", url: `/cases/${caseId}/exclude`, headers: STEWARD });
    const after = (await app.inject({ method: "GET", url: `/audit/cases/${caseId}/cfo-export`, headers: STEWARD })).json();
    expect(after.auditableRevenueMinor).toBe(0); // excluded from auditable
    expect(after.provenRevenueReturnedMinor).toBe(1_060_000); // proven history preserved
  });

  it("12 · a complete CFO audit export is generated from persisted data only", async () => {
    const { caseId, proofId } = await seedApproved();
    const exp = (await app.inject({ method: "GET", url: `/audit/cases/${caseId}/cfo-export`, headers: STEWARD })).json();
    expect(exp.recoveryCaseId).toBe(caseId);
    expect(exp.chain[0].proofId).toBe(proofId);
    expect(exp.chain[0].reconstructionMatches).toBe(true);
    expect(exp.authorityTrail.length).toBeGreaterThan(0);
    expect(typeof exp.generatedAt).toBe("string");
  });

  // ---- audit-authorization (clarification #1) ----
  it("A · unauthenticated audit reads are rejected (401)", async () => {
    const { proofId } = await seedApproved();
    const res = await app.inject({ method: "GET", url: `/audit/proofs/${proofId}` });
    expect(res.statusCode).toBe(401);
  });

  it("B · a beneficiary (author) is not authorized to read audit provenance (403)", async () => {
    const { proofId } = await seedApproved();
    const res = await app.inject({ method: "GET", url: `/audit/proofs/${proofId}`, headers: AUTHOR });
    expect(res.statusCode).toBe(403);
  });

  it("C · audit authorization is enforced in the service layer (route bypass still fails)", async () => {
    const { proofId } = await seedApproved();
    await expect(
      auditService.reconstructProof({ actorId: "dana@company", role: "author" }, proofId),
    ).rejects.toThrow(/may not perform/i);
  });

  it("D · an authorized audit read mutates no state", async () => {
    const { caseId, proofId } = await seedApproved();
    // Scoped to this case — the suite runs many test files against the same shared dev
    // database, so an unscoped global count can pick up unrelated concurrent writes.
    const proofs = await prisma.proof.count({ where: { recoveryCaseId: caseId } });
    const events = await prisma.authorityEvent.count({ where: { recoveryCaseId: caseId } });
    await auditService.reconstructProof(APPROVER_CTX, proofId);
    expect(await prisma.proof.count({ where: { recoveryCaseId: caseId } })).toBe(proofs);
    expect(await prisma.authorityEvent.count({ where: { recoveryCaseId: caseId } })).toBe(events);
  });
});

// service-layer actor context reused by direct-call tests
const APPROVER_CTX = { actorId: "cfo@company", role: "approver" as const };
