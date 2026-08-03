// EP-2 · minimal REST-path test (EP-3 unblock check), updated for EP-4 authentication and
// EP-8.1 trust hardening (baseline/evidence must be established/ingested before approval).
// Uses fastify.inject with a dev approver actor header. Skips without DATABASE_URL.
import { describe, it, expect, afterAll } from "vitest";
import { buildApp } from "./app";
import { prisma } from "./db";
import { uid, APPROVER, seedAuditableCase, approveBody } from "./test/fixtures";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("EP-2 · REST path reaches the authoritative store (EP-3 unblock)", () => {
  const app = buildApp();
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("approves via POST /proofs and returns the kernel-computed number", async () => {
    const { caseId, baselineId, evidenceId, collectedMinor } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    const res = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId], collectedMinor }),
    });
    expect(res.statusCode).toBe(201);
    const proof = res.json();
    expect(proof.proofId).toBe(proofId);
    expect(proof.revenueReturned.minor).toBe(collectedMinor - 260_000);

    const p2Id = `PF-${uid()}`;
    const rev = await app.inject({
      method: "POST",
      url: `/proofs/${proofId}/revisions`,
      headers: APPROVER,
      payload: { newProofId: p2Id, status: "Corrected", collectedMinor: 1_400_000 },
    });
    expect(rev.statusCode).toBe(201);
    expect(rev.json().previousProofId).toBe(proofId);

    const list = await app.inject({ method: "GET", url: `/cases/${caseId}/proofs`, headers: APPROVER });
    expect(list.json()).toHaveLength(2);
  });
});
