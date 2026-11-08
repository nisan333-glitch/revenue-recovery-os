// NO PROOF IS NOT A ZERO · the cfoAuditExport fix.
//
// THE DEFECT. The surface behind `GET /audit/cases/:caseId/cfo-export` answered for a case id that does
// not exist with `provenRevenueReturnedMinor: 0`, `auditableRevenueMinor: 0`, `currency: null` and
// `excluded: false` — so a case with no proof, a case whose proofs were all reversed, and a case that
// was never opened read identically on the most financially consequential read in the product.
//
// WHY IT DOES NOT FAIL CLOSED, measured rather than argued: `EventDetail.tsx:73` calls
// `loadCaseTrust(event.eventId, …)` with a SEED EVENT ID, and `loadCaseTrust` calls `getCfoExport`
// inside a `Promise.all`. A rejection fails the whole batch and the screen reads "Failed to load
// governed case data" for every seed event. That is the same reason `caseAuditTrail` is deliberately
// root-tolerant, and the two share that call site.
//
// AND WHY ONE ZERO SURVIVES: where proofs exist and none is auditable the figure stays `0`, because
// that zero is a FINDING — an exclusion or provenance gap removes an amount from the CFO-grade ledger
// while the proven history stands. `trustGate` and `auditService` already assert exactly that pair, and
// those assertions are UNCHANGED by this fix.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { APPROVER, AUTHOR, seedBaseline, seedEvidence, seedIntervention, uid, seedCorrection} from "../test/fixtures";
import { cfoAuditExport } from "./auditService";
import type { ActorContext } from "../auth/identity";

const HAS_DB = !!process.env.DATABASE_URL;

const PREREG = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../docs/architecture/cfo-audit-export-fix-preregistration.json", import.meta.url)),
    "utf8",
  ),
) as {
  properties: readonly { id: string; property: string; expectedReason?: string }[];
  adversarialCases: readonly { id: string; name: string; expected: string }[];
  measuredFactsThatDecideTheDESIGN: readonly { id: string; fact: string }[];
};

const steward: ActorContext = Object.freeze({
  actorId: "gov@test", role: "steward", boundaryIds: Object.freeze(["TEST-cfo-fix"]),
});

describe.skipIf(!HAS_DB)("cfoAuditExport · no proof is not a zero", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => { await app.ready(); }, 60_000);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("F1 · a case id that never existed reports null, not 0, with the reason named", async () => {
    const out = await cfoAuditExport(steward, `RC-never-existed-${uid()}`);
    expect(out.provenRevenueReturnedMinor).toBeNull();
    expect(out.auditableRevenueMinor).toBeNull();
    expect(out.monetaryUnavailableReason).toBe("no_governed_root_and_no_proof");
    expect(out.governedRootExists).toBe(false);
    expect(out.chain).toEqual([]);
    // It still ANSWERS — the route is root-tolerant on purpose, see the header.
    expect(out.recoveryCaseId).toMatch(/^RC-never-existed-/);
  });

  /**
   * F2 · THE TWO REASONS ARE DISTINGUISHED BY THE ROOT, which this test learned by being wrong first.
   *
   * I expected an authored case to report `no_effective_recovery_proof`. It reports
   * `no_governed_root_and_no_proof`, and that is CORRECT: `POST /cases/:id/author` writes an authority
   * event and creates no governed root at all. Only once a root exists does the reason narrow to "a
   * case was opened and nothing has been proven for it" — which is the distinction the flag was added
   * to make, now demonstrated rather than asserted.
   */
  it("F2 · an authored-but-rootless case and an opened-but-unproven one give DIFFERENT reasons", async () => {
    const caseId = `RC-${uid()}`;
    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR })).statusCode).toBe(201);
    const authored = await cfoAuditExport(steward, caseId);
    expect(authored.provenRevenueReturnedMinor).toBeNull();
    expect(authored.auditableRevenueMinor).toBeNull();
    expect(authored.governedRootExists).toBe(false);
    expect(authored.monetaryUnavailableReason).toBe("no_governed_root_and_no_proof");

    // `seedBaseline` establishes the governed root, so the SAME id now has one.
    await seedBaseline(app, caseId, { calculatedMinor: 1_000 });
    const opened = await cfoAuditExport(steward, caseId);
    expect(opened.governedRootExists).toBe(true);
    expect(opened.monetaryUnavailableReason).toBe("no_effective_recovery_proof");
    expect(opened.provenRevenueReturnedMinor).toBeNull();
    expect(opened.auditableRevenueMinor).toBeNull();
    // THE REASON MOVED WITHOUT THE MONEY MOVING, which is the whole point: both are still null, and a
    // reader can now tell which of the two situations they are looking at.
    expect(opened.monetaryUnavailableReason).not.toBe(authored.monetaryUnavailableReason);
  });

  it("E1/E3 · a real proof reports its figure, and a figure is never nullified once summed", async () => {
    const caseId = `RC-${uid()}`;
    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR })).statusCode).toBe(201);
    const baselineId = await seedBaseline(app, caseId, { calculatedMinor: 10_000 });
    await seedIntervention(app, caseId);
    const { evidenceId, res } = await seedEvidence(app, caseId, { amountMinor: 70_000, currency: "USD" });
    expect(res.statusCode, res.body).toBe(201);
    const approved = await app.inject({
      method: "POST", url: "/proofs", headers: APPROVER,
      payload: {
        proofId: `SYNTHETIC-proof-${randomUUID()}`, recoveryCaseId: caseId, currency: "USD",
        collectedMinor: 70_000, excludedRecoveryMinor: 0, exclusionStatement: "no exclusions asserted",
        recoveryReason: "BillingCorrection", attribution: "ar-system",
        evidenceIds: [evidenceId], baselineId, confidenceUsed: 95,
      },
    });
    expect(approved.statusCode, approved.body).toBe(201);

    const out = await cfoAuditExport(steward, caseId);
    expect(out.provenRevenueReturnedMinor).toBe(60_000);
    expect(out.auditableRevenueMinor).toBe(60_000);
    expect(out.monetaryUnavailableReason).toBeNull();
    expect(out.governedRootExists).toBe(true);
    expect(out.currency).toBe("USD");
  });

  /**
   * E2 / F4 · THE ZERO THAT MUST SURVIVE, pinned here as well as in `trustGate`.
   *
   * A proof with no recorded intervention is PROVEN-but-not-AUDITABLE: the gap removes the amount from
   * the CFO-grade ledger while the proven history stands. `auditableRevenueMinor: 0` is therefore a
   * FINDING over a real population, not an absence — and nullifying it would have been fixing one
   * meaning by destroying another. This is the assertion a future edit to the accumulators would break
   * first, so it is pinned in the fix's own file rather than only in the suite that happened to have it.
   */
  it("E2/F4 · a gapped proof keeps auditable at 0 — a finding, never nullified", async () => {
    const caseId = `RC-${uid()}`;
    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR })).statusCode).toBe(201);
    const baselineId = await seedBaseline(app, caseId, { calculatedMinor: 10_000 });
    // NO intervention recorded — an unknown fact, which is a provenance gap and never a block.
    // G1 · a VERIFIED CORRECTION, and still no Intervene event. The two are different facts: the
    // Intervene event is the operator's governed timing record, this is the billing source's signed
    // attestation that the corrective charge was raised. G1 requires the second; `interventionUnverified`
    // remains a provenance gap because the first is absent — which is exactly this test's subject.
    const fix = await seedCorrection(app, caseId);
    expect(fix.res.statusCode, fix.res.body).toBe(201);
    const { evidenceId, res } = await seedEvidence(app, caseId, { amountMinor: 70_000, currency: "USD" });
    expect(res.statusCode, res.body).toBe(201);
    const approved = await app.inject({
      method: "POST", url: "/proofs", headers: APPROVER,
      payload: {
        proofId: `SYNTHETIC-proof-${randomUUID()}`, recoveryCaseId: caseId, currency: "USD",
        collectedMinor: 70_000, excludedRecoveryMinor: 0, exclusionStatement: "no exclusions asserted",
        recoveryReason: "BillingCorrection", attribution: "ar-system",
        evidenceIds: [evidenceId], baselineId, confidenceUsed: 95,
      },
    });
    expect(approved.statusCode, approved.body).toBe(201);

    const out = await cfoAuditExport(steward, caseId);
    expect(out.provenRevenueReturnedMinor).toBe(60_000);
    // THE ZERO SURVIVES, and it is a number rather than a null.
    expect(out.auditableRevenueMinor).toBe(0);
    expect(out.auditableRevenueMinor).not.toBeNull();
    // Both figures are established, so no reason is stated: a reason beside a real zero would suggest
    // the figure was not computed when it was.
    expect(out.monetaryUnavailableReason).toBeNull();
  });

  it("E5 · currency and excluded are not presented as facts about a case that does not exist", async () => {
    const out = await cfoAuditExport(steward, `RC-never-existed-${uid()}`);
    // They are still answered — the route is root-tolerant — but the reason beside them says the
    // monetary ledger was not computed, so neither reads as a finding about a real case.
    expect(out.currency).toBeNull();
    expect(out.monetaryUnavailableReason).not.toBeNull();
    expect(out.governedRootExists).toBe(false);
  });

  it("E4 · no production reader coalesces either figure to zero", async () => {
    const files = [
      "../../src/data/governedTrustClient.ts",
      "../../src/state/RecoveryContext.tsx",
      "./auditService.ts",
    ];
    for (const rel of files) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const field of ["provenRevenueReturnedMinor", "auditableRevenueMinor"]) {
        expect(code, `${rel} must not coalesce ${field}`).not.toMatch(
          new RegExp(`${field}\\s*(\\?\\?|\\|\\|)\\s*0`),
        );
      }
    }
  });

  it("the DTO the UI compiles against admits the null, so a renderer cannot ignore it", () => {
    const dto = readFileSync(
      fileURLToPath(new URL("../../src/data/governedTrustClient.ts", import.meta.url)), "utf8",
    );
    const block = dto.slice(dto.indexOf("export interface CfoExportDTO"), dto.indexOf("export async function authorCase"));
    expect(block).toMatch(/provenRevenueReturnedMinor: number \| null/);
    expect(block).toMatch(/auditableRevenueMinor: number \| null/);
    expect(block).toMatch(/monetaryUnavailableReason/);
    expect(block).toMatch(/governedRootExists: boolean/);
  });

  it("the pre-registration governing this fix has not moved", async () => {
    const { createHash } = await import("node:crypto");
    const bytes = readFileSync(
      fileURLToPath(new URL("../../docs/architecture/cfo-audit-export-fix-preregistration.json", import.meta.url)),
    );
    expect(createHash("sha256").update(bytes).digest("hex"))
      .toBe("9aeffc0a1fb8f3ebca6d9b3e5f730a2bba63eaed75fd183ecb516bc240ce4ae9");
    expect(PREREG.properties.map((p) => p.id)).toEqual(["E1", "E2", "E3", "E4", "E5", "E6"]);
    expect(PREREG.adversarialCases.map((a) => a.id)).toEqual(["F1", "F2", "F3", "F4", "F5"]);
    expect(PREREG.measuredFactsThatDecideTheDESIGN.map((d) => d.id)).toEqual(["D1", "D2", "D3"]);
  });
});
