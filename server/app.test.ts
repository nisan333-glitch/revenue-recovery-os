// EP-2 · minimal REST-path test (EP-3 unblock check). Uses fastify.inject (no port).
// Proves the authoritative store is reachable through an API and the number still
// comes from the kernel. Skips when no DATABASE_URL is configured.
import { describe, it, expect, afterAll } from "vitest";
import { buildApp } from "./app";
import { prisma } from "./db";

const HAS_DB = !!process.env.DATABASE_URL;
const uid = () => Math.random().toString(36).slice(2, 10);

const approveBody = (caseId: string, proofId: string) => ({
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
  evidenceRefs: ["ev-1"],
  baselineId: "BL-1",
  baselineMethodId: "method-v1",
  baselineVersion: 1,
  baselineLockPolicy: "locked-before-intervention",
  policyVersion: "policy-v1",
  confidenceMethodologyVersion: "conf-v1",
  proofThresholdUsed: 0.9,
  confidenceUsed: 0.95,
  approvedBy: "cfo@nh",
});

describe.skipIf(!HAS_DB)("EP-2 · REST path reaches the authoritative store (EP-3 unblock)", () => {
  const app = buildApp();
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("approves via POST /proofs and returns the kernel-computed number", async () => {
    const caseId = `RC-${uid()}`;
    const proofId = `PF-${uid()}`;
    const res = await app.inject({ method: "POST", url: "/proofs", payload: approveBody(caseId, proofId) });
    expect(res.statusCode).toBe(201);
    const proof = res.json();
    expect(proof.proofId).toBe(proofId);
    expect(proof.revenueReturned.minor).toBe(1_060_000); // collected − baseline, by the kernel

    // then a correction via the revisions route creates a linked revision
    const p2Id = `PF-${uid()}`;
    const rev = await app.inject({
      method: "POST",
      url: `/proofs/${proofId}/revisions`,
      payload: { newProofId: p2Id, status: "Corrected", at: "2026-07-27T00:00:00.000Z", collectedMinor: 1_400_000, approvedBy: "cfo-2@nh" },
    });
    expect(rev.statusCode).toBe(201);
    expect(rev.json().previousProofId).toBe(proofId);

    const list = await app.inject({ method: "GET", url: `/cases/${caseId}/proofs` });
    expect(list.json()).toHaveLength(2); // full append-only history is returned
  });
});
