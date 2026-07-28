// EP-3 · Governed REST API acceptance tests. Proves the controlled write path
// (route → service → kernel → store → Postgres) and its guarantees. Skips without
// DATABASE_URL so the portable suite stays green where Postgres is unavailable.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp } from "../app";
import { prisma } from "../db";

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
    const caseId = `RC-${uid()}`;
    const proofId = `PF-${uid()}`;
    const res = await app.inject({ method: "POST", url: "/proofs", payload: approveBody(caseId, proofId) });
    expect(res.statusCode).toBe(201);
    expect(res.json().revenueReturned.minor).toBe(1_060_000); // collected − baseline, by the kernel

    const row = await prisma.proof.findUniqueOrThrow({ where: { proofId } });
    expect(Number(row.revenueReturnedMinor)).toBe(1_060_000); // durably persisted
  });

  it("2 · an invalid request is rejected before persistence", async () => {
    const proofId = `PF-${uid()}`;
    const bad = approveBody(`RC-${uid()}`, proofId) as Record<string, unknown>;
    delete bad.collectedMinor; // required field missing
    const res = await app.inject({ method: "POST", url: "/proofs", payload: bad });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_request");
    // nothing was written
    expect(await prisma.proof.findUnique({ where: { proofId } })).toBeNull();
  });

  it("3 · a direct counted-number injection is rejected", async () => {
    const proofId = `PF-${uid()}`;
    const injected = { ...approveBody(`RC-${uid()}`, proofId), revenueReturned: 9_999_999 };
    const res = await app.inject({ method: "POST", url: "/proofs", payload: injected });
    expect(res.statusCode).toBe(400); // additionalProperties:false rejects the injected number
    expect(await prisma.proof.findUnique({ where: { proofId } })).toBeNull();
  });

  it("4 · a stored proof is retrievable with complete provenance", async () => {
    const caseId = `RC-${uid()}`;
    const proofId = `PF-${uid()}`;
    await app.inject({ method: "POST", url: "/proofs", payload: approveBody(caseId, proofId) });

    const res = await app.inject({ method: "GET", url: `/proofs/${proofId}` });
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.policyVersion).toBe("policy-v1");
    expect(p.confidenceMethodologyVersion).toBe("conf-v1");
    expect(p.baselineVersion).toBe(1);
    expect(p.proofVersion).toBe(1);
    expect(p.approvedBy).toBe("cfo@nh");
    expect(p.revenueReturned.minor).toBe(1_060_000);
  });

  it("5 · a correction creates a linked revision", async () => {
    const caseId = `RC-${uid()}`;
    const p1 = `PF-${uid()}`;
    const p2 = `PF-${uid()}`;
    await app.inject({ method: "POST", url: "/proofs", payload: approveBody(caseId, p1) });

    const rev = await app.inject({
      method: "POST",
      url: `/proofs/${p1}/revisions`,
      payload: { newProofId: p2, status: "Corrected", at: "2026-07-27T00:00:00.000Z", collectedMinor: 1_400_000, approvedBy: "cfo-2@nh" },
    });
    expect(rev.statusCode).toBe(201);
    expect(rev.json().previousProofId).toBe(p1);
    expect(rev.json().proofVersion).toBe(2);

    const list = await app.inject({ method: "GET", url: `/cases/${caseId}/proofs` });
    expect(list.json()).toHaveLength(2); // append-only history preserved
  });

  it("6 · historical proof mutation remains rejected (no API path + DB guard)", async () => {
    const proofId = `PF-${uid()}`;
    await app.inject({ method: "POST", url: "/proofs", payload: approveBody(`RC-${uid()}`, proofId) });
    // there is no mutation endpoint; the DB rejects any direct update/delete
    await expect(
      prisma.proof.update({ where: { proofId }, data: { attribution: "tampered" } }),
    ).rejects.toThrow(/append-only/i);
    await expect(prisma.proof.delete({ where: { proofId } })).rejects.toThrow(/append-only/i);
  });

  it("7 · route handlers contain no direct Prisma write path", () => {
    const appSrc = readFileSync(fileURLToPath(new URL("../app.ts", import.meta.url)), "utf8");
    expect(/\bprisma\b/.test(appSrc)).toBe(false); // routes never reference Prisma
    expect(/from\s+["']\.\/db["']/.test(appSrc)).toBe(false); // nor the client
    expect(/proofStore/.test(appSrc)).toBe(false); // routes go through the service only
  });

  it("8 · the readiness endpoint accurately reports database availability", async () => {
    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().db).toBe("up"); // DB is connected in this run
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.json().status).toBe("ok");
  });
});
