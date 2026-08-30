// EP-9 · Focused tests for the two new governed-read endpoints added to support the frontend
// migration: GET /cases/:caseId/baselines (plural — full history) and GET /cases/:caseId/evidence.
// Same AuditRead gate as every other provenance read (server/audit/auditService.ts). Skips
// without DATABASE_URL.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { uid, AUTHOR, APPROVER, VERIFIER, STEWARD, seedBaseline, seedEvidence } from "../test/fixtures";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("EP-9 · governed reads: baselines/evidence history", () => {
  const app = buildApp();
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("1 · GET /cases/:caseId/baselines returns the full history, including a superseded snapshot", async () => {
    const caseId = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    const firstId = await seedBaseline(app, caseId, { calculatedMinor: 100_000 });
    const secondId = await seedBaseline(app, caseId, { calculatedMinor: 150_000 });

    const res = await app.inject({ method: "GET", url: `/cases/${caseId}/baselines`, headers: APPROVER });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(2); // both — superseded is never hidden
    expect(list.map((b: { baselineId: string }) => b.baselineId)).toEqual([firstId, secondId]); // oldest first
  });

  it("2 · GET /cases/:caseId/evidence returns every ingested record for the case", async () => {
    const caseId = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    const first = await seedEvidence(app, caseId, { amountMinor: 100_000 });
    const second = await seedEvidence(app, caseId, { amountMinor: 200_000 });
    expect(first.res.statusCode).toBe(201);
    expect(second.res.statusCode).toBe(201);

    const res = await app.inject({ method: "GET", url: `/cases/${caseId}/evidence`, headers: APPROVER });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(2);
    expect(list.map((e: { evidenceId: string }) => e.evidenceId).sort()).toEqual(
      [first.evidenceId, second.evidenceId].sort(),
    );
  });

  it("3 · role matrix: author/operator denied (no AuditRead), approver/verifier/steward allowed", async () => {
    const caseId = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    await seedBaseline(app, caseId);

    const denied = await app.inject({ method: "GET", url: `/cases/${caseId}/baselines`, headers: AUTHOR });
    expect(denied.statusCode).toBe(403);
    const deniedEvidence = await app.inject({ method: "GET", url: `/cases/${caseId}/evidence`, headers: AUTHOR });
    expect(deniedEvidence.statusCode).toBe(403);

    for (const role of [APPROVER, VERIFIER, STEWARD]) {
      expect((await app.inject({ method: "GET", url: `/cases/${caseId}/baselines`, headers: role })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `/cases/${caseId}/evidence`, headers: role })).statusCode).toBe(200);
    }
  });

  it("4 · case-scoping: a baseline/evidence record from a different case never leaks in", async () => {
    const caseA = `RC-${uid()}`;
    const caseB = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseA}/author`, headers: AUTHOR });
    await app.inject({ method: "POST", url: `/cases/${caseB}/author`, headers: AUTHOR });
    await seedBaseline(app, caseA);
    await seedEvidence(app, caseA);

    const baselinesB = await app.inject({ method: "GET", url: `/cases/${caseB}/baselines`, headers: APPROVER });
    expect(baselinesB.json()).toHaveLength(0);
    const evidenceB = await app.inject({ method: "GET", url: `/cases/${caseB}/evidence`, headers: APPROVER });
    expect(evidenceB.json()).toHaveLength(0);
  });

  it("5 · unauthenticated reads are rejected (401)", async () => {
    const caseId = `RC-${uid()}`;
    expect((await app.inject({ method: "GET", url: `/cases/${caseId}/baselines` })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/cases/${caseId}/evidence` })).statusCode).toBe(401);
  });
});
