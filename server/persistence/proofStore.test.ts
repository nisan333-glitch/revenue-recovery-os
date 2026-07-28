// EP-2/EP-4 acceptance tests — the six persistence guarantees against a real PostgreSQL
// database, including atomic proof + authority-ledger writes. Skips without DATABASE_URL.
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../db";
import { approveProof, reviseExistingProof, getCaseProofs, type AuthorityWrite } from "./proofStore";
import { money } from "../../src/domain/money";
import { effectiveProofs, type ProofApprovalInput } from "../../src/domain/proof";

const HAS_DB = !!process.env.DATABASE_URL;
const uid = () => Math.random().toString(36).slice(2, 10);

const approvalInput = (caseId: string, proofId: string): ProofApprovalInput => ({
  proofId,
  recoveryCaseId: caseId,
  approvedAt: "2026-07-26T00:00:00.000Z",
  collectedAmount: money(1_320_000, "USD"),
  baselineAmount: money(260_000, "USD"),
  excludedRecoveryAmount: money(0, "USD"),
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
  approvedBy: "cfo@company",
});

const auth = (caseId: string): AuthorityWrite => ({
  recoveryCaseId: caseId,
  actorId: "cfo@company",
  role: "approver",
  action: "Approve",
  policyVersion: "approval-2026.1",
});

describe.skipIf(!HAS_DB)("EP-2 · PostgreSQL is the authoritative, append-only proof store", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persists a proof whose counted number is computed by the kernel, not the store", async () => {
    const caseId = `RC-${uid()}`;
    const proofId = `PF-${uid()}`;
    const input = approvalInput(caseId, proofId);
    expect("revenueReturned" in input).toBe(false);

    const proof = await approveProof(input, auth(caseId));
    expect(proof.revenueReturned.minor).toBe(1_320_000 - 260_000);

    const row = await prisma.proof.findUniqueOrThrow({ where: { proofId } });
    expect(Number(row.revenueReturnedMinor)).toBe(1_060_000);
  });

  it("writes the proof and its authority record atomically (one transaction)", async () => {
    const caseId = `RC-${uid()}`;
    const proofId = `PF-${uid()}`;
    await approveProof(approvalInput(caseId, proofId), auth(caseId));
    const [proofRow, events] = await Promise.all([
      prisma.proof.findUnique({ where: { proofId } }),
      prisma.authorityEvent.findMany({ where: { recoveryCaseId: caseId, action: "Approve" } }),
    ]);
    expect(proofRow).not.toBeNull();
    expect(events).toHaveLength(1); // both rows committed together
    expect(events[0]!.actorId).toBe("cfo@company");
  });

  it("rejects direct mutation of a persisted proof (DB-level append-only)", async () => {
    const caseId = `RC-${uid()}`;
    const proofId = `PF-${uid()}`;
    await approveProof(approvalInput(caseId, proofId), auth(caseId));

    await expect(
      prisma.proof.update({ where: { proofId }, data: { revenueReturnedMinor: 9_999_999n } }),
    ).rejects.toThrow(/append-only/i);
    await expect(prisma.proof.delete({ where: { proofId } })).rejects.toThrow(/append-only/i);
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "Proof" SET "attribution"='tampered' WHERE "proofId"=$1`, proofId),
    ).rejects.toThrow(/append-only/i);

    const row = await prisma.proof.findUniqueOrThrow({ where: { proofId } });
    expect(Number(row.revenueReturnedMinor)).toBe(1_060_000);
    expect(row.attribution).toBe("ar-system");
  });

  it("creates a linked revision on correction and preserves the original", async () => {
    const caseId = `RC-${uid()}`;
    const p1Id = `PF-${uid()}`;
    const p2Id = `PF-${uid()}`;
    const p1 = await approveProof(approvalInput(caseId, p1Id), auth(caseId));

    const p2 = await reviseExistingProof(
      p1Id,
      {
        newProofId: p2Id,
        status: "Corrected",
        at: "2026-07-27T00:00:00.000Z",
        collectedAmount: money(1_400_000, "USD"),
        approvedBy: "cfo-2@company",
      },
      auth(caseId),
    );

    expect(p2.previousProofId).toBe(p1Id);
    expect(p2.chainId).toBe(p1.chainId);
    expect(p2.proofVersion).toBe(2);
    expect(p2.revenueReturned.minor).toBe(1_400_000 - 260_000);

    const original = await prisma.proof.findUniqueOrThrow({ where: { proofId: p1Id } });
    expect(Number(original.revenueReturnedMinor)).toBe(1_060_000);
    expect(original.previousProofId).toBeNull();

    const chain = await getCaseProofs(caseId);
    expect(chain).toHaveLength(2);
    const effective = effectiveProofs(chain);
    expect(effective).toHaveLength(1);
    expect(effective[0]!.proofId).toBe(p2Id);
  });

  it("persists provenance and version fields for auditability", async () => {
    const caseId = `RC-${uid()}`;
    const proofId = `PF-${uid()}`;
    await approveProof(approvalInput(caseId, proofId), auth(caseId));

    const row = await prisma.proof.findUniqueOrThrow({ where: { proofId } });
    expect(row.policyVersion).toBe("policy-v1");
    expect(row.confidenceMethodologyVersion).toBe("conf-v1");
    expect(row.baselineVersion).toBe(1);
    expect(row.proofVersion).toBe(1);
    expect(row.approvedBy).toBe("cfo@company");
    expect(row.persistedAt).toBeInstanceOf(Date);
  });
});
