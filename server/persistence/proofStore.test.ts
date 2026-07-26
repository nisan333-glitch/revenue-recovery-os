// EP-2 acceptance tests — proves the six required persistence guarantees against a
// real PostgreSQL database. Skips cleanly when no DATABASE_URL is configured.
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../db";
import { approveProof, reviseExistingProof, getCaseProofs } from "./proofStore";
import { money } from "../../src/domain/money";
import { effectiveProofs, type ProofApprovalInput } from "../../src/domain/proof";

const HAS_DB = !!process.env.DATABASE_URL;
const uid = () => Math.random().toString(36).slice(2, 10);

const approvalInput = (caseId: string, proofId: string): ProofApprovalInput => ({
  proofId,
  recoveryCaseId: caseId,
  approvedAt: "2026-07-26T00:00:00.000Z",
  collectedAmount: money(1_320_000, "USD"), // $13,200.00
  baselineAmount: money(260_000, "USD"), //   $2,600.00
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
  approvedBy: "cfo@nh",
});

describe.skipIf(!HAS_DB)("EP-2 · PostgreSQL is the authoritative, append-only proof store", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persists a proof whose counted number is computed by the kernel, not the store", async () => {
    const caseId = `RC-${uid()}`;
    const proofId = `PF-${uid()}`;
    const input = approvalInput(caseId, proofId);

    // The store's input structurally cannot carry the number — the kernel derives it.
    expect("revenueReturned" in input).toBe(false);

    const proof = await approveProof(input);
    expect(proof.revenueReturned.minor).toBe(1_320_000 - 260_000); // 1,060,000 by the kernel

    const row = await prisma.proof.findUniqueOrThrow({ where: { proofId } });
    expect(Number(row.revenueReturnedMinor)).toBe(1_060_000); // persisted exactly as frozen
  });

  it("rejects direct mutation of a persisted proof (DB-level append-only)", async () => {
    const caseId = `RC-${uid()}`;
    const proofId = `PF-${uid()}`;
    await approveProof(approvalInput(caseId, proofId));

    await expect(
      prisma.proof.update({ where: { proofId }, data: { revenueReturnedMinor: 9_999_999n } }),
    ).rejects.toThrow(/append-only/i);
    await expect(prisma.proof.delete({ where: { proofId } })).rejects.toThrow(/append-only/i);
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "Proof" SET "attribution"='tampered' WHERE "proofId"=$1`, proofId),
    ).rejects.toThrow(/append-only/i);

    const row = await prisma.proof.findUniqueOrThrow({ where: { proofId } });
    expect(Number(row.revenueReturnedMinor)).toBe(1_060_000); // survived untouched
    expect(row.attribution).toBe("ar-system");
  });

  it("creates a linked revision on correction and preserves the original", async () => {
    const caseId = `RC-${uid()}`;
    const p1Id = `PF-${uid()}`;
    const p2Id = `PF-${uid()}`;
    const p1 = await approveProof(approvalInput(caseId, p1Id));

    const p2 = await reviseExistingProof(p1Id, {
      newProofId: p2Id,
      status: "Corrected",
      at: "2026-07-27T00:00:00.000Z",
      collectedAmount: money(1_400_000, "USD"), // corrected upward
      approvedBy: "cfo-2@nh",
    });

    expect(p2.previousProofId).toBe(p1Id); // linked back to the original
    expect(p2.chainId).toBe(p1.chainId); // same chain
    expect(p2.proofVersion).toBe(2);
    expect(p2.revenueReturned.minor).toBe(1_400_000 - 260_000); // kernel recomputed for the revision

    const original = await prisma.proof.findUniqueOrThrow({ where: { proofId: p1Id } });
    expect(Number(original.revenueReturnedMinor)).toBe(1_060_000); // ORIGINAL untouched
    expect(original.previousProofId).toBeNull();

    const chain = await getCaseProofs(caseId);
    expect(chain).toHaveLength(2); // both rows preserved (append-only history)
    const effective = effectiveProofs(chain);
    expect(effective).toHaveLength(1); // exactly one effective record per chain
    expect(effective[0]!.proofId).toBe(p2Id); // the latest revision
  });

  it("persists provenance and version fields for auditability", async () => {
    const caseId = `RC-${uid()}`;
    const proofId = `PF-${uid()}`;
    await approveProof(approvalInput(caseId, proofId));

    const row = await prisma.proof.findUniqueOrThrow({ where: { proofId } });
    expect(row.policyVersion).toBe("policy-v1");
    expect(row.confidenceMethodologyVersion).toBe("conf-v1");
    expect(row.baselineVersion).toBe(1);
    expect(row.proofVersion).toBe(1);
    expect(row.approvedBy).toBe("cfo@nh");
    expect(row.persistedAt).toBeInstanceOf(Date); // DB-recorded provenance
  });
});
