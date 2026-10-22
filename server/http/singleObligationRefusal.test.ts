// Structural refusal of unsupported single-obligation assertions at the governed API boundary.
// There is deliberately NO request field through which a caller can assert that a claim, a baseline
// or an evidence record is "a single obligation" — `additionalProperties:false` rejects it with 400
// BEFORE any handler, authentication or persistence runs. These tests pin that: they need no database.
import { describe, it, expect, afterAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { uid, APPROVER, AUTHOR, approveBody } from "../test/fixtures";

describe("API refuses any single-obligation assertion field (no database required)", () => {
  const app = buildApp();
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const approve = approveBody({ proofId: `PF-${uid()}`, caseId: `RC-${uid()}`, baselineId: "BL-1", evidenceIds: ["EV-1"] });
  const evidence = {
    evidenceId: "EV-1",
    sourceSystem: "billing",
    sourceRecordId: "inv-1",
    evidenceType: "invoice_paid",
    observedAt: "2026-07-25T00:00:00.000Z",
  };
  const baseline = {
    baselineId: "BL-1",
    calculatedMinor: 260_000,
    currency: "USD",
    method: "matched_historical_cohort",
    methodVersion: 1,
    sourceRefs: ["src-1"],
    effectiveAt: "2026-07-01T00:00:00.000Z",
  };

  const assertions = [
    { singleObligation: true },
    { obligationCount: 1 },
    { isSingleInvoice: true },
    { obligationScope: { singleObligation: "SUPPORTED" } },
  ];

  for (const extra of assertions) {
    const key = Object.keys(extra)[0]!;

    it(`POST /proofs rejects "${key}" (400, nothing persisted)`, async () => {
      const res = await app.inject({ method: "POST", url: "/proofs", headers: APPROVER, payload: { ...approve, ...extra } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_request");
    });

    it(`POST /cases/:id/evidence rejects "${key}"`, async () => {
      const res = await app.inject({ method: "POST", url: "/cases/RC-x/evidence", headers: AUTHOR, payload: { ...evidence, ...extra } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_request");
    });

    it(`POST /cases/:id/baseline rejects "${key}"`, async () => {
      const res = await app.inject({ method: "POST", url: "/cases/RC-x/baseline", headers: AUTHOR, payload: { ...baseline, ...extra } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_request");
    });
  }
});
