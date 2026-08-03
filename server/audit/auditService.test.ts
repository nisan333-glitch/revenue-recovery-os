// EP-8 · Governance, audit trail & explainability acceptance tests (16).
// Proves reconstruction, provenance-based exclusion, duplicate-count prevention,
// governance-without-count, governed audit reads, and a CFO export from persisted data
// only. Skips without DATABASE_URL.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import * as auditService from "./auditService";

const HAS_DB = !!process.env.DATABASE_URL;
const uid = () => Math.random().toString(36).slice(2, 10);
const hdr = (id: string, role: string) => ({ "x-actor-id": id, "x-actor-role": role });
const APPROVER = hdr("cfo@company", "approver");
const AUTHOR = hdr("dana@company", "author");
const VERIFIER = hdr("val@company", "verifier");
const STEWARD = hdr("gov@company", "steward");

const approveBody = (caseId: string, proofId: string, evidenceRefs: string[] = ["ev-1"]) => ({
  proofId,
  recoveryCaseId: caseId,
  approvedAt: "2026-07-26T00:00:00.000Z",
  currency: "USD",
  collectedMinor: 1_320_000,
  baselineMinor: 260_000,
  excludedRecoveryMinor: 0,
  exclusionStatement: "no exclusions asserted",
  recoveryReason: "UsageActivation",
  attribution: "ar-system",
  evidenceRefs,
  baselineId: "BL-1",
  baselineMethodId: "method-v1",
  baselineVersion: 1,
  baselineLockPolicy: "locked-before-intervention",
  policyVersion: "policy-v1",
  confidenceMethodologyVersion: "conf-v1",
  proofThresholdUsed: 0.9,
  confidenceUsed: 0.95,
});

describe.skipIf(!HAS_DB)("EP-8 · governance, audit trail & explainability", () => {
  const app = buildApp();
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // full author→approve pipeline; returns {caseId, proofId}
  const seedApproved = async (evidenceRefs?: string[]) => {
    const caseId = `RC-${uid()}`;
    const proofId = `PF-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    const r = await app.inject({ method: "POST", url: "/proofs", headers: APPROVER, payload: approveBody(caseId, proofId, evidenceRefs) });
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
    expect(r.frozenProvenance.policyVersion).toBe("policy-v1");
    expect(r.auditable).toBe(true);
  });

  it("2 · missing required provenance prevents auditable classification", async () => {
    const { proofId } = await seedApproved([]); // no evidence references
    const r = (await app.inject({ method: "GET", url: `/audit/proofs/${proofId}`, headers: APPROVER })).json();
    expect(r.provenanceGaps).toContain("evidenceRefs");
    expect(r.auditable).toBe(false); // incomplete provenance → excluded from auditable
  });

  it("3 · governance can flag/halt/exclude but cannot count or approve", async () => {
    const caseId = `RC-${uid()}`;
    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/flag`, headers: STEWARD })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/halt`, headers: STEWARD })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/exclude`, headers: STEWARD })).statusCode).toBe(201);
    const approve = await app.inject({ method: "POST", url: "/proofs", headers: STEWARD, payload: approveBody(caseId, `PF-${uid()}`) });
    expect(approve.statusCode).toBe(403); // steward may never approve/count
  });

  it("4 · duplicate recovery counting is rejected", async () => {
    const { caseId } = await seedApproved();
    const dup = await app.inject({ method: "POST", url: "/proofs", headers: APPROVER, payload: approveBody(caseId, `PF-${uid()}`) });
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
    await app.inject({ method: "POST", url: `/proofs/${proofId}/revisions`, headers: APPROVER, payload: { newProofId: p2, status: "Corrected", at: "2026-07-27T00:00:00.000Z", collectedMinor: 1_400_000 } });
    const trail = await auditService.caseAuditTrail(APPROVER_CTX, caseId);
    expect(trail.proofs).toHaveLength(2); // original + revision, both preserved
    expect(trail.authorityTrail.map((e) => e.action)).toEqual(["Author", "Approve", "Approve"]);
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
    const before = await prisma.authorityEvent.count();
    await app.inject({ method: "GET", url: `/audit/proofs/${proofId}`, headers: APPROVER });
    await app.inject({ method: "GET", url: `/audit/cases/${caseId}`, headers: APPROVER });
    await app.inject({ method: "GET", url: `/audit/cases/${caseId}/cfo-export`, headers: APPROVER });
    expect(await prisma.authorityEvent.count()).toBe(before); // reads created nothing
  });

  it("9 · every governed state transition produces an audit event", async () => {
    const caseId = `RC-${uid()}`;
    const proofId = `PF-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    await app.inject({ method: "POST", url: "/proofs", headers: APPROVER, payload: approveBody(caseId, proofId) });
    await app.inject({ method: "POST", url: `/proofs/${proofId}/verify`, headers: VERIFIER });
    await app.inject({ method: "POST", url: `/cases/${caseId}/flag`, headers: STEWARD });
    await app.inject({ method: "POST", url: `/cases/${caseId}/exclude`, headers: STEWARD });
    const events = await prisma.authorityEvent.findMany({ where: { recoveryCaseId: caseId }, orderBy: { at: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["Author", "Approve", "Verify", "Flag", "Exclude"]);
  });

  it("10 · no route or governance service bypasses the kernel/authority gate", async () => {
    // governance cannot approve; and the counted number is the kernel's, reconstructable
    const { proofId } = await seedApproved();
    const r = (await app.inject({ method: "GET", url: `/audit/proofs/${proofId}`, headers: APPROVER })).json();
    expect(r.reconstructionMatches).toBe(true);
    const stewardApprove = await app.inject({ method: "POST", url: "/proofs", headers: STEWARD, payload: approveBody(`RC-${uid()}`, `PF-${uid()}`) });
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
    const { proofId } = await seedApproved();
    const proofs = await prisma.proof.count();
    const events = await prisma.authorityEvent.count();
    await auditService.reconstructProof(APPROVER_CTX, proofId);
    expect(await prisma.proof.count()).toBe(proofs);
    expect(await prisma.authorityEvent.count()).toBe(events);
  });
});

// service-layer actor context reused by direct-call tests
const APPROVER_CTX = { actorId: "cfo@company", role: "approver" as const };
