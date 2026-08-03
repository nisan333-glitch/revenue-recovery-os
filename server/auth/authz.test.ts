// EP-4 · Security / AuthN / AuthZ / separation-of-duties acceptance tests.
// Proves the enforcement model end-to-end (routes) and in the service layer directly.
// Skips without DATABASE_URL. Updated for EP-8.1: approval now references a governed
// baseline/evidence setup — tests that fail on authentication/authorization/separation
// (before those checks run) use placeholder ids; tests that must reach a real approval
// use the shared `seedAuditableCase` fixture.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import * as proofService from "../services/proofService";
import { uid, hdr, seedAuditableCase, approveBody } from "../test/fixtures";

const HAS_DB = !!process.env.DATABASE_URL;

const placeholderApproveBody = (caseId: string, proofId: string) =>
  approveBody({ proofId, caseId, baselineId: "BL-1", evidenceIds: ["ev-1"] });

describe.skipIf(!HAS_DB)("EP-4 · authentication, authorization & separation of duties", () => {
  const app = buildApp();
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("1 · unauthenticated requests are rejected (401)", async () => {
    const res = await app.inject({ method: "POST", url: "/proofs", payload: placeholderApproveBody(`RC-${uid()}`, `PF-${uid()}`) });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("unauthorized");
  });

  it("2 · authenticated but unauthorized requests are rejected (403)", async () => {
    // an 'author' role may not approve
    const res = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: hdr("dana@company", "author"),
      payload: placeholderApproveBody(`RC-${uid()}`, `PF-${uid()}`),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("forbidden");
  });

  it("3 · an author can perform only permitted author actions", async () => {
    const caseId = `RC-${uid()}`;
    const authored = await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: hdr("dana@company", "author") });
    expect(authored.statusCode).toBe(201);
    // but cannot approve
    const denied = await app.inject({ method: "POST", url: "/proofs", headers: hdr("dana@company", "author"), payload: placeholderApproveBody(caseId, `PF-${uid()}`) });
    expect(denied.statusCode).toBe(403);
  });

  it("4 · an author cannot approve their own case (self-approval denied)", async () => {
    const caseId = `RC-${uid()}`;
    const proofId = `PF-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: hdr("dana@company", "author") });
    // same identity, now bearing the approver role, tries to approve its own case
    const res = await app.inject({ method: "POST", url: "/proofs", headers: hdr("dana@company", "approver"), payload: placeholderApproveBody(caseId, proofId) });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/author.*cannot approve/i);
    expect(await prisma.proof.findUnique({ where: { proofId } })).toBeNull(); // nothing counted
  });

  it("5 · an approver cannot verify the same case", async () => {
    const { caseId, baselineId, evidenceId } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    await app.inject({ method: "POST", url: "/proofs", headers: hdr("cfo@company", "approver"), payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId] }) });
    const verify = await app.inject({ method: "POST", url: `/proofs/${proofId}/verify`, headers: hdr("cfo@company", "verifier") });
    expect(verify.statusCode).toBe(403);
    expect(verify.json().message).toMatch(/approver cannot verify/i);
  });

  it("6 · a verifier cannot author or approve that same case", async () => {
    const { caseId, baselineId, evidenceId } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    await app.inject({ method: "POST", url: "/proofs", headers: hdr("cfo@company", "approver"), payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId] }) });
    await app.inject({ method: "POST", url: `/proofs/${proofId}/verify`, headers: hdr("val@company", "verifier") });
    // the verifier now tries to author and to approve the same case
    const auth = await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: hdr("val@company", "author") });
    expect(auth.statusCode).toBe(403);
    const appr = await app.inject({ method: "POST", url: "/proofs", headers: hdr("val@company", "approver"), payload: placeholderApproveBody(caseId, `PF-${uid()}`) });
    expect(appr.statusCode).toBe(403);
  });

  it("7 · a beneficiary cannot authorize a counted number", async () => {
    const caseId = `RC-${uid()}`;
    const proofId = `PF-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: hdr("beneficiary@company", "author") });
    const res = await app.inject({ method: "POST", url: "/proofs", headers: hdr("beneficiary@company", "approver"), payload: placeholderApproveBody(caseId, proofId) });
    expect(res.statusCode).toBe(403);
    expect(await prisma.proof.findUnique({ where: { proofId } })).toBeNull();
  });

  it("8 · Steward can flag/halt but cannot count", async () => {
    const caseId = `RC-${uid()}`;
    const flag = await app.inject({ method: "POST", url: `/cases/${caseId}/flag`, headers: hdr("gov@company", "steward") });
    expect(flag.statusCode).toBe(201);
    const approve = await app.inject({ method: "POST", url: "/proofs", headers: hdr("gov@company", "steward"), payload: placeholderApproveBody(caseId, `PF-${uid()}`) });
    expect(approve.statusCode).toBe(403); // steward may never approve/count
  });

  it("9 · a privileged identity cannot bypass separation of duties", async () => {
    // there is no admin/superuser role: an invalid claimed role is unauthenticated
    const admin = await app.inject({ method: "POST", url: "/proofs", headers: hdr("root@company", "admin"), payload: placeholderApproveBody(`RC-${uid()}`, `PF-${uid()}`) });
    expect(admin.statusCode).toBe(401);
    // and the most-privileged real role (steward) still cannot count
    const steward = await app.inject({ method: "POST", url: "/proofs", headers: hdr("gov@company", "steward"), payload: placeholderApproveBody(`RC-${uid()}`, `PF-${uid()}`) });
    expect(steward.statusCode).toBe(403);
  });

  it("10 · every governed action records complete authority provenance", async () => {
    const { caseId, baselineId, evidenceId } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    await app.inject({ method: "POST", url: "/proofs", headers: hdr("cfo@company", "approver"), payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId] }) });
    await app.inject({ method: "POST", url: `/proofs/${proofId}/verify`, headers: hdr("val@company", "verifier") });

    const events = await prisma.authorityEvent.findMany({ where: { recoveryCaseId: caseId }, orderBy: { at: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["Author", "Intervene", "Approve", "Verify"]);
    for (const e of events) {
      expect(e.actorId).toBeTruthy();
      expect(e.role).toBeTruthy();
      expect(e.policyVersion).toBeTruthy();
      expect(e.at).toBeInstanceOf(Date);
    }
  });

  it("11 · authorization is enforced in the service layer, not only the route", async () => {
    const caseId = `RC-${uid()}`;
    await proofService.authorCase({ actorId: "dana@company", role: "author" }, caseId);
    // calling the service directly (bypassing any route check) still rejects self-approval
    await expect(
      proofService.approve({ actorId: "dana@company", role: "approver" }, placeholderApproveBody(caseId, `PF-${uid()}`)),
    ).rejects.toThrow(/author.*cannot approve/i);
  });

  it("12 · a legitimate three-party flow (distinct author/approver/verifier) succeeds", async () => {
    const { caseId, baselineId, evidenceId } = await seedAuditableCase(app, { caseId: `RC-${uid()}` });
    const proofId = `PF-${uid()}`;
    expect((await app.inject({ method: "POST", url: "/proofs", headers: hdr("cfo@company", "approver"), payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId] }) })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/proofs/${proofId}/verify`, headers: hdr("val@company", "verifier") })).statusCode).toBe(200);
  });
});
