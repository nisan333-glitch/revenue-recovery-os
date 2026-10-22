import { randomUUID } from "node:crypto";
import { requireBoundaryAccess, type ActorContext } from "../auth/identity";
import { ConflictError, ForbiddenError, NotFoundError } from "../http/errors";
import type { CaseCandidate } from "./caseAdmission";
import {
  deriveCaseIdentityGrain,
  type CaseIdentityGrainDisclosure,
} from "../../src/domain/caseIdentityGrain";
import {
  leakInstanceIdentityStatus,
  LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL,
} from "../../src/contract/leakInstanceIdentity";

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

/**
 * A queue item plus what its identity COVERS.
 *
 * ADDITIVE, PER ITEM, AND NOT A CHANGE OF THE ARRAY'S SHAPE. Wrapping the list in
 * `{ identityGrain, items }` would have been the tidier-looking option and would have broken every
 * consumer that treats this route as an array — including the browser journey's own `pending` count. The
 * grain is a property of the candidate anyway, so it belongs on the item.
 *
 * WHY THE QUEUE AND NOT ONLY THE CASE: this is the screen where an operator decides to promote. A
 * disclosure that arrives only after the case exists is a disclosure that arrives after the decision.
 */
export interface ReviewQueueItemWithGrain extends ReviewQueueItem {
  readonly identityGrain: CaseIdentityGrainDisclosure;
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

  /**
   * The pending queue, each item carrying the grain disclosure.
   *
   * Derived HERE rather than in a store, so both the Postgres and the in-memory store get it and there is
   * one derivation to read — the *second implementation is a second thing that can drift* rule.
   *
   * `absorbedObservations: { checked: false }` and the payload says so. Establishing absorption needs a
   * content join over `agent_tasks` jsonb, which is forensic and unindexed; claiming `count: 0` here
   * would report work this read did not do.
   *
   * DELIBERATELY NOT `async`, AND THIS IS A GATE PROPERTY RATHER THAN A STYLE CHOICE. The three refusals
   * above throw SYNCHRONOUSLY out of this call, as they did before the disclosure existed. Adding `async`
   * and awaiting the store — the tidier-looking form, and the form I wrote first — converts every one of
   * them into a rejected promise, so a caller written as `try { svc.list(…) } catch` stops seeing them.
   * Two pre-existing tests assert exactly that shape and FAILED on the async form, which is what caught
   * it: a gate's delivery mechanism is part of the gate. The store call is chained instead, so the
   * refusals keep their original semantics and only the resolved value is new.
   */
  list(actor: ActorContext, boundaryId: string): Promise<readonly ReviewQueueItemWithGrain[]> {
    requireOperator(actor);
    if (!boundaryId.trim()) throw new Error("boundaryId is required");
    requireBoundaryAccess(actor, boundaryId);
    const identityGrain = deriveCaseIdentityGrain({
      obligationIdentityEstablishable: leakInstanceIdentityStatus().establishable,
      identityRefusalDetail: LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL,
      absorbedObservations: { checked: false },
    });
    return this.store
      .listPending(boundaryId)
      .then((items) => Object.freeze(items.map((item) => Object.freeze({ ...item, identityGrain }))));
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
