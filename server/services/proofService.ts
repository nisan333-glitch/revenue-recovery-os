// EP-3/EP-4 · Application service — orchestration + authorization between REST routes
// and the persistence adapter. Every counted-number write is delegated to the domain
// kernel; every governed action passes the authority gate (least privilege + separation
// of duties) BEFORE the kernel, enforced here in the service layer (not only the route).
// The approver identity is the authenticated actor — a request body can never set it,
// so the beneficiary cannot authorize a counted number.
import {
  approveProof,
  reviseExistingProof,
  getCaseProofs,
  getProofById,
} from "../persistence/proofStore";
import { money } from "../../src/domain/money";
import type { Proof, ProofApprovalInput } from "../../src/domain/proof";
import { NotFoundError } from "../http/errors";
import type { ActorContext } from "../auth/identity";
import {
  requireCan,
  enforceSeparation,
  recordAuthority,
  AUTHORITY_POLICY_VERSION,
} from "../auth/authorityGate";

export interface ApproveProofRequest {
  proofId: string;
  recoveryCaseId: string;
  approvedAt: string;
  currency: string;
  collectedMinor: number;
  baselineMinor: number;
  excludedRecoveryMinor: number;
  exclusionStatement: string;
  recoveryReason: string;
  attribution: string;
  evidenceRefs: string[];
  baselineId: string;
  baselineMethodId: string;
  baselineVersion: number;
  baselineLockPolicy: string;
  policyVersion: string;
  confidenceMethodologyVersion: string;
  proofThresholdUsed: number;
  confidenceUsed: number;
}

export interface ReviseProofRequest {
  newProofId: string;
  status: "Reversed" | "Superseded" | "Corrected";
  at: string;
  currency?: string;
  collectedMinor?: number;
  baselineMinor?: number;
  attribution?: string;
}

/** Record a case's author/owner (the beneficiary). Requires the Author permission. */
export async function authorCase(actor: ActorContext, recoveryCaseId: string): Promise<void> {
  requireCan(actor, "Author");
  await enforceSeparation(recoveryCaseId, actor, "Author");
  await recordAuthority(recoveryCaseId, actor, "Author", AUTHORITY_POLICY_VERSION);
}

/** Approve a governed proof. Authorization + separation are enforced before the kernel. */
export async function approve(actor: ActorContext, req: ApproveProofRequest): Promise<Proof> {
  requireCan(actor, "Approve");
  await enforceSeparation(req.recoveryCaseId, actor, "Approve", req.collectedMinor);

  const input: ProofApprovalInput = {
    proofId: req.proofId,
    recoveryCaseId: req.recoveryCaseId,
    approvedAt: req.approvedAt,
    collectedAmount: money(req.collectedMinor, req.currency),
    baselineAmount: money(req.baselineMinor, req.currency),
    excludedRecoveryAmount: money(req.excludedRecoveryMinor, req.currency),
    exclusionStatement: req.exclusionStatement,
    recoveryReason: req.recoveryReason as ProofApprovalInput["recoveryReason"],
    attribution: req.attribution,
    evidenceRefs: req.evidenceRefs,
    baselineId: req.baselineId,
    baselineMethodId: req.baselineMethodId,
    baselineVersion: req.baselineVersion,
    baselineLockPolicy: req.baselineLockPolicy,
    policyVersion: req.policyVersion,
    confidenceMethodologyVersion: req.confidenceMethodologyVersion,
    proofThresholdUsed: req.proofThresholdUsed,
    confidenceUsed: req.confidenceUsed,
    approvedBy: actor.actorId, // identity from authentication, never from the body
  };
  // proof row + authority record are written atomically in one transaction.
  const proof = await approveProof(input, {
    recoveryCaseId: req.recoveryCaseId,
    actorId: actor.actorId,
    role: actor.role,
    action: "Approve",
    policyVersion: AUTHORITY_POLICY_VERSION,
  });
  return proof;
}

/** Create a linked correction/revision (an approver action; original never overwritten). */
export async function revise(
  actor: ActorContext,
  originalProofId: string,
  req: ReviseProofRequest,
): Promise<Proof> {
  requireCan(actor, "Approve");
  const existing = await getProofById(originalProofId);
  if (!existing) throw new NotFoundError(`proof ${originalProofId} not found`);
  await enforceSeparation(existing.recoveryCaseId, actor, "Approve", existing.collectedAmount.minor);
  const currency = req.currency ?? existing.currency;
  const revised = await reviseExistingProof(
    originalProofId,
    {
      newProofId: req.newProofId,
      status: req.status,
      at: req.at,
      approvedBy: actor.actorId,
      attribution: req.attribution,
      collectedAmount: req.collectedMinor !== undefined ? money(req.collectedMinor, currency) : undefined,
      baselineAmount: req.baselineMinor !== undefined ? money(req.baselineMinor, currency) : undefined,
    },
    {
      recoveryCaseId: existing.recoveryCaseId,
      actorId: actor.actorId,
      role: actor.role,
      action: "Approve",
      policyVersion: AUTHORITY_POLICY_VERSION,
    },
  );
  return revised;
}

/** Independently verify a proof (a governance stamp — never changes the counted number). */
export async function verifyProof(actor: ActorContext, proofId: string): Promise<Proof> {
  requireCan(actor, "Verify");
  const proof = await getProofById(proofId);
  if (!proof) throw new NotFoundError(`proof ${proofId} not found`);
  await enforceSeparation(proof.recoveryCaseId, actor, "Verify");
  await recordAuthority(proof.recoveryCaseId, actor, "Verify", AUTHORITY_POLICY_VERSION);
  return proof;
}

/** Governance flag — Steward may flag/halt a case; it can never count. */
export async function flagCase(actor: ActorContext, recoveryCaseId: string): Promise<void> {
  requireCan(actor, "Flag");
  await recordAuthority(recoveryCaseId, actor, "Flag", AUTHORITY_POLICY_VERSION);
}

/** Read one proof with its full frozen provenance. */
export async function getProof(proofId: string): Promise<Proof> {
  const proof = await getProofById(proofId);
  if (!proof) throw new NotFoundError(`proof ${proofId} not found`);
  return proof;
}

/** Read the full append-only revision history for a recovery case. */
export async function getCaseChain(caseId: string): Promise<Proof[]> {
  return getCaseProofs(caseId);
}
