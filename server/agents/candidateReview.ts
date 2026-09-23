import { randomUUID } from "node:crypto";
import { requireBoundaryAccess, type ActorContext } from "../auth/identity";
import { ConflictError, ForbiddenError, NotFoundError } from "../http/errors";
import type { CaseCandidate } from "./caseAdmission";

export const CANDIDATE_REVIEW_POLICY_VERSION = "candidate-review-v1";

export type CandidateReviewDecision = "accepted" | "rejected";

export interface CandidateReview {
  readonly reviewId: string;
  readonly candidateId: string;
  readonly boundaryId: string;
  readonly decision: CandidateReviewDecision;
  readonly reason: string;
  readonly actorId: string;
  readonly actorRole: "operator";
  readonly policyVersion: string;
  readonly decidedAt: string;
}

export interface ReviewQueueItem extends CaseCandidate {
  readonly review: CandidateReview | null;
  readonly recoveryCaseId: string | null;
}

export interface CandidateReviewStore {
  listPending(boundaryId: string): Promise<readonly ReviewQueueItem[]>;
  recordDecision(review: CandidateReview): Promise<CandidateReview>;
}

function requireOperator(actor: ActorContext): asserts actor is ActorContext & { role: "operator" } {
  if (actor.role !== "operator") throw new ForbiddenError("candidate review requires the operator role");
}

export class CandidateReviewService {
  constructor(
    private readonly store: CandidateReviewStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(actor: ActorContext, boundaryId: string): Promise<readonly ReviewQueueItem[]> {
    requireOperator(actor);
    if (!boundaryId.trim()) throw new Error("boundaryId is required");
    requireBoundaryAccess(actor, boundaryId);
    return this.store.listPending(boundaryId);
  }

  decide(
    actor: ActorContext,
    input: { candidateId: string; boundaryId: string; decision: CandidateReviewDecision; reason: string },
  ): Promise<CandidateReview> {
    requireOperator(actor);
    if (!input.candidateId.trim() || !input.boundaryId.trim() || !input.reason.trim()) {
      throw new Error("candidateId, boundaryId and reason are required");
    }
    requireBoundaryAccess(actor, input.boundaryId);
    return this.store.recordDecision(Object.freeze({
      reviewId: `CR-${randomUUID()}`,
      candidateId: input.candidateId,
      boundaryId: input.boundaryId,
      decision: input.decision,
      reason: input.reason.trim(),
      actorId: actor.actorId,
      actorRole: "operator",
      policyVersion: CANDIDATE_REVIEW_POLICY_VERSION,
      decidedAt: this.now().toISOString(),
    }));
  }
}

export class InMemoryCandidateReviewStore implements CandidateReviewStore {
  private readonly candidates = new Map<string, ReviewQueueItem>();
  private readonly reviews = new Map<string, CandidateReview>();

  seed(candidate: CaseCandidate): void {
    this.candidates.set(candidate.candidateId, { ...candidate, review: null, recoveryCaseId: null });
  }

  async listPending(boundaryId: string): Promise<readonly ReviewQueueItem[]> {
    return [...this.candidates.values()].filter((candidate) => {
      if (candidate.boundaryId !== boundaryId || candidate.recoveryCaseId) return false;
      const review = this.reviews.get(candidate.candidateId);
      return !review || review.decision === "accepted";
    }).map((candidate) => ({ ...candidate, review: this.reviews.get(candidate.candidateId) ?? null }));
  }

  async recordDecision(review: CandidateReview): Promise<CandidateReview> {
    const candidate = this.candidates.get(review.candidateId);
    if (!candidate || candidate.boundaryId !== review.boundaryId) throw new NotFoundError("candidate not found");
    if (this.reviews.has(review.candidateId)) throw new ConflictError("candidate already has an immutable review");
    this.reviews.set(review.candidateId, review);
    return review;
  }
}
