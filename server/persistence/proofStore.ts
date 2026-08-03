// EP-2 · Proof persistence — the only write path to the authoritative Postgres store.
//
// Governance guarantees (enforced here + at the DB level):
//  * Every counted number is computed by the DOMAIN KERNEL, never by this store.
//    `approveProof` calls `createApprovedProof` (kernel freezes revenueReturned =
//    collected − baseline); `reviseExistingProof` calls `reviseProof` (kernel builds
//    the linked revision). This module only maps kernel snapshots to/from rows.
//  * Writes are INSERT-only. There is no update path. A correction INSERTs a new
//    linked revision; the original row is never touched. The DB triggers reject any
//    UPDATE/DELETE that tries to bypass this.
import { prisma } from "../db";
import {
  createApprovedProof,
  reviseProof,
  type Proof,
  type ProofApprovalInput,
  type ProofStatus,
} from "../../src/domain/proof";
import { money } from "../../src/domain/money";

type ProofRow = Awaited<ReturnType<typeof prisma.proof.findFirstOrThrow>>;
type ReviseChange = Parameters<typeof reviseProof>[1];

/** Map an immutable kernel Proof snapshot to a Postgres row (money → minor BigInt). */
function proofToRow(p: Proof) {
  return {
    proofId: p.proofId,
    recoveryCaseId: p.recoveryCaseId,
    chainId: p.chainId,
    proofVersion: p.proofVersion,
    previousProofId: p.previousProofId,
    status: p.status,
    currency: p.currency,
    collectedMinor: BigInt(p.collectedAmount.minor),
    baselineMinor: BigInt(p.baselineAmount.minor),
    revenueReturnedMinor: BigInt(p.revenueReturned.minor),
    excludedRecoveryMinor: BigInt(p.excludedRecoveryAmount.minor),
    exclusionStatement: p.exclusionStatement,
    recoveryReason: p.recoveryReason,
    attribution: p.attribution,
    evidenceRefs: [...p.evidenceRefs],
    baselineId: p.baselineId,
    baselineMethodId: p.baselineMethodId,
    baselineVersion: p.baselineVersion,
    baselineLockPolicy: p.baselineLockPolicy,
    policyVersion: p.policyVersion,
    confidenceMethodologyVersion: p.confidenceMethodologyVersion,
    proofThresholdUsed: p.proofThresholdUsed,
    confidenceUsed: p.confidenceUsed,
    approvedBy: p.approvedBy,
    createdAt: new Date(p.createdAt),
    approvedAt: new Date(p.approvedAt),
  };
}

/** Reconstruct a domain Proof from a persisted row (minor BigInt → money). */
function rowToProof(r: ProofRow): Proof {
  return {
    proofId: r.proofId,
    recoveryCaseId: r.recoveryCaseId,
    chainId: r.chainId,
    proofVersion: r.proofVersion,
    createdAt: r.createdAt.toISOString(),
    approvedAt: r.approvedAt.toISOString(),
    status: r.status as ProofStatus,
    currency: r.currency,
    collectedAmount: money(Number(r.collectedMinor), r.currency),
    baselineAmount: money(Number(r.baselineMinor), r.currency),
    revenueReturned: money(Number(r.revenueReturnedMinor), r.currency),
    excludedRecoveryAmount: money(Number(r.excludedRecoveryMinor), r.currency),
    exclusionStatement: r.exclusionStatement,
    recoveryReason: r.recoveryReason as Proof["recoveryReason"],
    attribution: r.attribution,
    evidenceRefs: r.evidenceRefs,
    baselineId: r.baselineId,
    baselineMethodId: r.baselineMethodId,
    baselineVersion: r.baselineVersion,
    baselineLockPolicy: r.baselineLockPolicy,
    policyVersion: r.policyVersion,
    confidenceMethodologyVersion: r.confidenceMethodologyVersion,
    proofThresholdUsed: r.proofThresholdUsed,
    confidenceUsed: r.confidenceUsed,
    approvedBy: r.approvedBy,
    previousProofId: r.previousProofId,
  };
}

/** Authority-ledger payload written atomically with the proof it authorizes. */
export interface AuthorityWrite {
  recoveryCaseId: string;
  actorId: string;
  role: string;
  action: string;
  policyVersion: string;
}

function authorityRow(a: AuthorityWrite) {
  return {
    id: `AE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    recoveryCaseId: a.recoveryCaseId,
    actorId: a.actorId,
    role: a.role,
    action: a.action,
    policyVersion: a.policyVersion,
  };
}

/**
 * Approve a proof: the kernel computes and freezes the number; the proof row AND its
 * authority-ledger record are written in ONE transaction — both commit or both roll back.
 */
export async function approveProof(input: ProofApprovalInput, authority: AuthorityWrite): Promise<Proof> {
  const proof = createApprovedProof(input); // revenueReturned computed ONCE by the kernel
  await prisma.$transaction([
    prisma.proof.create({ data: proofToRow(proof) }),
    prisma.authorityEvent.create({ data: authorityRow(authority) }),
  ]);
  return proof;
}

/**
 * Correct/reverse a proof: INSERT a new linked revision plus its authority record in ONE
 * transaction. The original is never overwritten.
 */
export async function reviseExistingProof(
  originalProofId: string,
  change: ReviseChange,
  authority: AuthorityWrite,
): Promise<Proof> {
  const originalRow = await prisma.proof.findUniqueOrThrow({ where: { proofId: originalProofId } });
  const revised = reviseProof(rowToProof(originalRow), change); // kernel builds the linked revision
  await prisma.$transaction([
    prisma.proof.create({ data: proofToRow(revised) }),
    prisma.authorityEvent.create({ data: authorityRow(authority) }),
  ]);
  return revised;
}

/**
 * Does a counted proof-chain root already exist for this claim? Enforces the frozen
 * one-chain-per-recoveryCaseId rule (a chain root has previousProofId = null).
 */
export async function chainRootExists(recoveryCaseId: string): Promise<boolean> {
  const root = await prisma.proof.findFirst({ where: { recoveryCaseId, previousProofId: null } });
  return root !== null;
}

/** Read a single persisted proof by id, reconstructed with full provenance (or null). */
export async function getProofById(proofId: string): Promise<Proof | null> {
  const row = await prisma.proof.findUnique({ where: { proofId } });
  return row ? rowToProof(row) : null;
}

/** Read every persisted revision for a recovery case, oldest first. */
export async function getCaseProofs(recoveryCaseId: string): Promise<Proof[]> {
  const rows = await prisma.proof.findMany({
    where: { recoveryCaseId },
    orderBy: { proofVersion: "asc" },
  });
  return rows.map(rowToProof);
}
