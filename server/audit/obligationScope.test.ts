// Obligation Scope disclosure on the governed Recovery Case API (audit trail + CFO export).
// Needs the PostgreSQL store, like every other EP-8 acceptance test; skips without DATABASE_URL.
// Pins: the disclosure is present and refuses a single-obligation reading, it reflects the persisted
// outcome evidence, and it changes NO ledger figure, duplicate-count rule or authority outcome.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { uid, AUTHOR, APPROVER, STEWARD, seedAuditableCase, seedBaseline, seedIntervention, seedEvidence, approveBody } from "../test/fixtures";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("Obligation Scope · governed Recovery Case API disclosure", () => {
  const app = buildApp();
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("a one-evidence case: disclosed as a governed CLAIM, single-obligation refused, numbers unchanged", async () => {
    const { caseId, baselineId, evidenceId } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    const r = await app.inject({ method: "POST", url: "/proofs", headers: APPROVER, payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId] }) });
    expect(r.statusCode).toBe(201);

    const exp = (await app.inject({ method: "GET", url: `/audit/cases/${caseId}/cfo-export`, headers: STEWARD })).json();
    expect(exp.provenRevenueReturnedMinor).toBe(1_060_000); // unchanged ledger figures
    expect(exp.auditableRevenueMinor).toBe(1_060_000);
    expect(exp.obligationScope.surface).toBe("RECOVERY_CASE");
    expect(exp.obligationScope.identity.unitCount).toBe(1);
    expect(exp.obligationScope.singleObligation).toBe("REFUSED_UNSUPPORTED");
    expect(exp.obligationScope.recordedAbsorption.status).toBe("NONE_RECORDED");
    expect(JSON.stringify(exp).toLowerCase()).not.toContain("forecast"); // EP-8 ledger separation holds

    const trail = (await app.inject({ method: "GET", url: `/audit/cases/${caseId}`, headers: APPROVER })).json();
    expect(trail.obligationScope).toEqual(exp.obligationScope);
  });

  it("a case whose claim merges two outcome records records the merge and quantifies an upper bound only", async () => {
    const caseId = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    const baselineId = await seedBaseline(app, caseId);
    await seedIntervention(app, caseId);
    const e1 = await seedEvidence(app, caseId, { amountMinor: 1_000_000, currency: "USD" });
    const e2 = await seedEvidence(app, caseId, { amountMinor: 400_000, currency: "USD" });
    expect(e1.res.statusCode).toBe(201);
    expect(e2.res.statusCode).toBe(201);
    const proofId = `PF-${uid()}`;
    const r = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [e1.evidenceId, e2.evidenceId], collectedMinor: 1_400_000 }),
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().revenueReturned.minor).toBe(1_400_000 - 260_000); // the counted number is the kernel's, untouched

    const exp = (await app.inject({ method: "GET", url: `/audit/cases/${caseId}/cfo-export`, headers: STEWARD })).json();
    const s = exp.obligationScope;
    expect(s.recordedAbsorption.status).toBe("RECORDED");
    expect(s.recordedAbsorption.disposition).toBe("COUNTED_UNDER_ONE_CLAIM");
    expect(s.recordedAbsorption.unitCount).toBe(2);
    expect(s.recordedAbsorption.candidateExposureUpperBound).toEqual({ minor: 1_400_000, currency: "USD" });
    expect(s.singleObligation).toBe("REFUSED_UNSUPPORTED");
    expect(exp.provenRevenueReturnedMinor).toBe(1_400_000 - 260_000);
  });

  it("a case with no outcome evidence discloses that nothing is established (not 'no ambiguity')", async () => {
    const caseId = `RC-${uid()}`;
    const trail = (await app.inject({ method: "GET", url: `/audit/cases/${caseId}`, headers: APPROVER })).json();
    expect(trail.obligationScope.identity.grain).toBe("NOT_ESTABLISHED");
    expect(trail.obligationScope.ambiguity.status).toBe("PRESENT");
  });

  it("existing governance is preserved: a beneficiary still cannot read it, and a second counted root is still refused", async () => {
    const { caseId, baselineId, evidenceId } = await seedAuditableCase(app);
    const first = await app.inject({ method: "POST", url: "/proofs", headers: APPROVER, payload: approveBody({ proofId: `PF-${uid()}`, caseId, baselineId, evidenceIds: [evidenceId] }) });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: "POST", url: "/proofs", headers: APPROVER, payload: approveBody({ proofId: `PF-${uid()}`, caseId, baselineId, evidenceIds: [evidenceId] }) });
    expect(second.statusCode).toBe(409); // dedupe rule unchanged: the same claim is never counted twice
    const beneficiary = await app.inject({ method: "GET", url: `/audit/cases/${caseId}`, headers: AUTHOR });
    expect(beneficiary.statusCode).toBe(403);
    expect(JSON.stringify(beneficiary.json())).not.toContain("obligationScope");
  });
});
