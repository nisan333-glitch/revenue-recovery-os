// EP-3 · Governed REST API acceptance tests (updated for EP-4 authentication and EP-8.1 trust
// hardening: approval no longer accepts a policy/baseline/evidence assertion inline — it
// references a previously established+locked baseline snapshot and previously ingested evidence).
// Proves the controlled write path and its guarantees. Skips without DATABASE_URL.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp } from "../app";
import { prisma } from "../db";
import { uid, APPROVER, seedAuditableCase, approveBody } from "../test/fixtures";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("EP-3 · governed REST API", () => {
  const app = buildApp();
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("1 · a valid request passes through the kernel and persists", async () => {
    const { caseId, baselineId, evidenceId, collectedMinor } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    const res = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId], collectedMinor }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().revenueReturned.minor).toBe(collectedMinor - 260_000);
    expect(res.json().approvedBy).toBe("cfo@company"); // identity from auth, not the body

    const row = await prisma.proof.findUniqueOrThrow({ where: { proofId } });
    expect(Number(row.revenueReturnedMinor)).toBe(collectedMinor - 260_000);
  });

  it("2 · an invalid request is rejected before persistence", async () => {
    const { caseId, baselineId, evidenceId } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    const bad = approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId] }) as Record<string, unknown>;
    delete bad.collectedMinor;
    const res = await app.inject({ method: "POST", url: "/proofs", headers: APPROVER, payload: bad });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_request");
    expect(await prisma.proof.findUnique({ where: { proofId } })).toBeNull();
  });

  it("3 · a direct counted-number injection is rejected", async () => {
    const { caseId, baselineId, evidenceId } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    const injected = { ...approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId] }), revenueReturned: 9_999_999 };
    const res = await app.inject({ method: "POST", url: "/proofs", headers: APPROVER, payload: injected });
    expect(res.statusCode).toBe(400);
    expect(await prisma.proof.findUnique({ where: { proofId } })).toBeNull();
  });

  it("4 · a stored proof is retrievable with complete provenance", async () => {
    const { caseId, baselineId, evidenceId, collectedMinor } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId], collectedMinor }),
    });

    const res = await app.inject({ method: "GET", url: `/proofs/${proofId}`, headers: APPROVER });
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.policyVersion).toBe("policy-2026.1");
    expect(p.baselineVersion).toBe(1);
    expect(p.proofVersion).toBe(1);
    expect(p.approvedBy).toBe("cfo@company");
    expect(p.revenueReturned.minor).toBe(collectedMinor - 260_000);
  });

  it("5 · a correction creates a linked revision", async () => {
    const { caseId, baselineId, evidenceId } = await seedAuditableCase(app);
    const p1 = `PF-${uid()}`;
    const p2 = `PF-${uid()}`;
    await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId: p1, caseId, baselineId, evidenceIds: [evidenceId] }),
    });

    const rev = await app.inject({
      method: "POST",
      url: `/proofs/${p1}/revisions`,
      headers: APPROVER,
      payload: { newProofId: p2, status: "Corrected", collectedMinor: 1_400_000 },
    });
    expect(rev.statusCode).toBe(201);
    expect(rev.json().previousProofId).toBe(p1);
    expect(rev.json().proofVersion).toBe(2);

    const list = await app.inject({ method: "GET", url: `/cases/${caseId}/proofs`, headers: APPROVER });
    expect(list.json()).toHaveLength(2);
  });

  it("6 · historical proof mutation remains rejected (no API path + DB guard)", async () => {
    const { caseId, baselineId, evidenceId } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId] }),
    });
    await expect(
      prisma.proof.update({ where: { proofId }, data: { attribution: "tampered" } }),
    ).rejects.toThrow(/append-only/i);
    await expect(prisma.proof.delete({ where: { proofId } })).rejects.toThrow(/append-only/i);
  });

  it("7 · route handlers contain no direct Prisma write path", () => {
    const appSrc = readFileSync(fileURLToPath(new URL("../app.ts", import.meta.url)), "utf8");
    expect(/\bprisma\b/.test(appSrc)).toBe(false);
    expect(/from\s+["']\.\/db["']/.test(appSrc)).toBe(false);
    expect(/proofStore/.test(appSrc)).toBe(false);
  });

  it("8 · the readiness endpoint accurately reports database availability", async () => {
    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().db).toBe("up");
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.json().status).toBe("ok");
  });
});
