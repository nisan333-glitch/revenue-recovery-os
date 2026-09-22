import { apiRequest } from "./apiClient";
import type { DevActor } from "./devActor";

export interface CandidateSignalDTO {
  signalId: string;
  boundaryId: string;
  recoveryType: string;
  sourceRef: string;
  sourcePayloadHash: string;
  detectorVersion: string;
  observedAt: string;
  amountAtRiskMinor: number;
  currency: string;
  actionAvailable: boolean;
  expectedProofEvent: string;
}

export interface CandidateReviewDTO {
  reviewId: string;
  candidateId: string;
  boundaryId: string;
  decision: "accepted" | "rejected";
  reason: string;
  actorId: string;
  actorRole: "operator";
  policyVersion: string;
  decidedAt: string;
}

export interface CandidateQueueItemDTO {
  candidateId: string;
  dedupeKey: string;
  boundaryId: string;
  agentId: string;
  signal: CandidateSignalDTO;
  status: "pending_review";
  submittedAt: string;
  review: CandidateReviewDTO | null;
  recoveryCaseId: string | null;
}

export interface RecoveryCaseDTO {
  recoveryCaseId: string;
  boundaryId: string;
  sourceCandidateId: string;
  recoveryType: string;
  sourceRef: string;
  amountAtRiskMinor: number;
  currency: string;
  detectorVersion: string;
  openedByActorId: string;
  openedByRole: "operator";
  policyVersion: string;
  openedAt: string;
}

export function listCandidateQueue(boundaryId: string, actor: DevActor): Promise<CandidateQueueItemDTO[]> {
  return apiRequest("GET", `/agent-candidates?boundaryId=${encodeURIComponent(boundaryId)}`, actor);
}

export function reviewCandidate(
  candidateId: string,
  actor: DevActor,
  input: { boundaryId: string; decision: "accepted" | "rejected"; reason: string },
): Promise<CandidateReviewDTO> {
  return apiRequest(
    "POST",
    `/agent-candidates/${encodeURIComponent(candidateId)}/review`,
    actor,
    input,
  );
}

export function promoteCandidate(
  candidateId: string,
  actor: DevActor,
  boundaryId: string,
): Promise<{ recoveryCase: RecoveryCaseDTO; created: boolean }> {
  return apiRequest(
    "POST",
    `/agent-candidates/${encodeURIComponent(candidateId)}/promote`,
    actor,
    { boundaryId },
  );
}
