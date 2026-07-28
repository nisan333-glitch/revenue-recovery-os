// EP-3 · Application service — the orchestration layer between REST routes and the
// persistence adapter. It validates/shapes inputs and delegates every counted-number
// write to the domain kernel (via the proof store). It contains NO recovery, proof,
// revenue, or attribution logic and never derives a number itself.
import {
  approveProof,
  reviseExistingProof,
  getCaseProofs,
  getProofById,
} from "../persistence/proofStore";
import { money } from "../../src/domain/money";
import type { Proof, ProofApprovalInput } from "../../src/domain/proof";
import { NotFoundError } from "../http/errors";

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
  approvedBy: string;
}

export interface ReviseProofRequest {
  newProofId: string;
  status: "Reversed" | "Superseded" | "Corrected";
  at: string;
  approvedBy: string;
  currency?: string;
  collectedMinor?: number;
  baselineMinor?: number;
  attribution?: string;
}

/** Approve a governed proof. The kernel (inside the store) computes the frozen number. */
export async function approve(req: ApproveProofRequest): Promise<Proof> {
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
    approvedBy: req.approvedBy,
  };
  return approveProof(input);
}

/** Create a linked correction/revision. The original proof is never overwritten. */
export async function revise(originalProofId: string, req: ReviseProofRequest): Promise<Proof> {
  const existing = await getProofById(originalProofId);
  if (!existing) throw new NotFoundError(`proof ${originalProofId} not found`);
  const currency = req.currency ?? existing.currency;
  return reviseExistingProof(originalProofId, {
    newProofId: req.newProofId,
    status: req.status,
    at: req.at,
    approvedBy: req.approvedBy,
    attribution: req.attribution,
    collectedAmount: req.collectedMinor !== undefined ? money(req.collectedMinor, currency) : undefined,
    baselineAmount: req.baselineMinor !== undefined ? money(req.baselineMinor, currency) : undefined,
  });
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
