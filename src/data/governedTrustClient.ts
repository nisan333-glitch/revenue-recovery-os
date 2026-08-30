// EP-9 · Async client for the governed trust half of the domain (baseline, intervention,
// evidence, proof, audit, CFO export) — the ONLY place these HTTP calls are made. Every DTO
// here mirrors exactly what the server returns; nothing is recomputed, reclassified, or
// re-derived on the client. In particular:
//  - `evidenceRole` / `trustClassification` on EvidenceRecordDTO are read-only — there is no
//    request shape anywhere in this file that accepts them as input (ingestEvidence's input
//    type has no such fields), matching the server schema exactly.
//  - `auditable` / `provenanceGaps` on ProofReconstructionDTO come only from the `/audit/*`
//    endpoints — this client never calls a local `proofIsAuditable`-equivalent.
// Every function takes the acting `DevActor` as an explicit parameter from the caller — there
// is no internally-fixed identity here, so a caller can never silently read as one actor while
// writing as another.
import { apiRequest } from "./apiClient";
import type { DevActor } from "./devActor";

export interface BaselineSnapshotDTO {
  baselineId: string;
  recoveryCaseId: string;
  calculatedMinor: number;
  currency: string;
  method: string;
  methodVersion: number;
  sourceRefs: string[];
  effectiveAt: string;
  establishedBy: string;
  establishedByRole: string;
  lockedAt: string;
  supersedes: string | null;
}

export interface EvidenceRecordDTO {
  evidenceId: string;
  recoveryCaseId: string;
  sourceSystem: string;
  sourceRecordId: string;
  evidenceType: string;
  observedAt: string;
  amountMinor: number | null;
  currency: string | null;
  trustClassification: "independent" | "beneficiary_controlled";
  evidenceRole: "outcome" | "supporting";
  roleMapVersion: string;
  ingestedBy: string;
  ingestedByRole: string;
  ingestedAt: string;
}

interface MoneyDTO {
  minor: number;
  currency: string;
}

export interface ProofDTO {
  proofId: string;
  recoveryCaseId: string;
  chainId: string;
  proofVersion: number;
  createdAt: string;
  approvedAt: string;
  status: string;
  currency: string;
  collectedAmount: MoneyDTO;
  baselineAmount: MoneyDTO;
  revenueReturned: MoneyDTO;
  excludedRecoveryAmount: MoneyDTO;
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
  previousProofId: string | null;
}

export interface ProofReconstructionDTO {
  proofId: string;
  recoveryCaseId: string;
  chainId: string;
  proofVersion: number;
  status: string;
  frozenProvenance: Record<string, unknown>;
  amounts: { collectedMinor: number; baselineMinor: number; storedRevenueReturnedMinor: number };
  reconstructedRevenueReturnedMinor: number;
  reconstructionMatches: boolean;
  provenanceGaps: string[];
  excluded: boolean;
  /** Read verbatim from the server — never recomputed client-side. */
  auditable: boolean;
}

export interface AuthorityRecordDTO {
  actorId: string;
  role: string;
  action: string;
  policyVersion: string;
  at: string;
}

export interface CaseAuditTrailDTO {
  recoveryCaseId: string;
  excluded: boolean;
  authorityTrail: AuthorityRecordDTO[];
  proofs: ProofReconstructionDTO[];
}

export interface CfoExportDTO {
  recoveryCaseId: string;
  generatedAt: string;
  excluded: boolean;
  currency: string | null;
  provenRevenueReturnedMinor: number;
  auditableRevenueMinor: number;
  authorityTrail: AuthorityRecordDTO[];
  chain: ProofReconstructionDTO[];
}

export async function authorCase(caseId: string, actor: DevActor): Promise<void> {
  await apiRequest<{ status: string }>("POST", `/cases/${caseId}/author`, actor, undefined);
}

export interface EstablishBaselineRequest {
  baselineId: string;
  calculatedMinor: number;
  currency: string;
  method: string;
  methodVersion: number;
  sourceRefs: string[];
  effectiveAt: string;
  supersedes?: string;
}

export async function establishBaseline(
  caseId: string,
  actor: DevActor,
  input: EstablishBaselineRequest,
): Promise<BaselineSnapshotDTO> {
  return apiRequest("POST", `/cases/${caseId}/baseline`, actor, input);
}

/** Full immutable history — every snapshot ever established for the case, oldest first. */
export async function listBaselines(caseId: string, actor: DevActor): Promise<BaselineSnapshotDTO[]> {
  return apiRequest("GET", `/cases/${caseId}/baselines`, actor);
}

export async function recordIntervention(caseId: string, actor: DevActor): Promise<void> {
  await apiRequest<{ status: string }>("POST", `/cases/${caseId}/intervention`, actor, undefined);
}

export interface IngestEvidenceRequest {
  evidenceId: string;
  sourceSystem: string;
  sourceRecordId: string;
  evidenceType: string;
  observedAt: string;
  amountMinor?: number;
  currency?: string;
  note?: string;
}

export async function ingestEvidence(
  caseId: string,
  actor: DevActor,
  input: IngestEvidenceRequest,
): Promise<EvidenceRecordDTO> {
  return apiRequest("POST", `/cases/${caseId}/evidence`, actor, input);
}

export async function listEvidence(caseId: string, actor: DevActor): Promise<EvidenceRecordDTO[]> {
  return apiRequest("GET", `/cases/${caseId}/evidence`, actor);
}

export interface ApproveProofRequest {
  proofId: string;
  recoveryCaseId: string;
  currency: string;
  collectedMinor: number;
  excludedRecoveryMinor: number;
  exclusionStatement: string;
  recoveryReason: string;
  attribution: string;
  evidenceIds: string[];
  baselineId: string;
  confidenceUsed: number;
}

export async function approveProof(actor: DevActor, input: ApproveProofRequest): Promise<ProofDTO> {
  return apiRequest("POST", "/proofs", actor, input);
}

export interface ReviseProofRequest {
  newProofId: string;
  status: "Reversed" | "Superseded" | "Corrected";
  currency?: string;
  collectedMinor?: number;
  attribution?: string;
}

export async function reviseProof(proofId: string, actor: DevActor, input: ReviseProofRequest): Promise<ProofDTO> {
  return apiRequest("POST", `/proofs/${proofId}/revisions`, actor, input);
}

export async function verifyProof(proofId: string, actor: DevActor): Promise<ProofDTO> {
  return apiRequest("POST", `/proofs/${proofId}/verify`, actor, undefined);
}

export async function getCaseAuditTrail(caseId: string, actor: DevActor): Promise<CaseAuditTrailDTO> {
  return apiRequest("GET", `/audit/cases/${caseId}`, actor);
}

export async function getCfoExport(caseId: string, actor: DevActor): Promise<CfoExportDTO> {
  return apiRequest("GET", `/audit/cases/${caseId}/cfo-export`, actor);
}
