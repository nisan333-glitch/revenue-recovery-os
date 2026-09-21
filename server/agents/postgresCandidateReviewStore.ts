import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ConflictError, NotFoundError } from "../http/errors";
import { assertCandidateSignal } from "./admission";
import { assertCaseCandidateIdentity, type CaseCandidate } from "./caseAdmission";
import type { CandidateReview, CandidateReviewStore, ReviewQueueItem } from "./candidateReview";
import type { CandidatePromotionStore, RecoveryCase } from "./recoveryCase";

interface CandidateRow {
  candidate_id: string;
  dedupe_key: string;
  boundary_id: string;
  agent_id: string;
  signal: unknown;
  submitted_at: Date;
  review_id: string | null;
  decision: string | null;
  reason: string | null;
  actor_id: string | null;
  actor_role: string | null;
  policy_version: string | null;
  decided_at: Date | null;
  recovery_case_id: string | null;
}

interface RecoveryCaseRow {
  recovery_case_id: string;
  boundary_id: string;
  source_candidate_id: string;
  recovery_type: string;
  source_ref: string;
  amount_at_risk_minor: bigint | number | string;
  currency: string;
  detector_version: string;
  opened_by_actor_id: string;
  opened_by_role: string;
  policy_version: string;
  opened_at: Date;
}

type SqlClient = Prisma.TransactionClient | PrismaClient;

export class PostgresCandidateReviewStore implements CandidateReviewStore, CandidatePromotionStore {
  constructor(private readonly client: PrismaClient = prisma) {}

  async listPending(boundaryId: string): Promise<readonly ReviewQueueItem[]> {
    const rows = await this.client.$queryRaw<CandidateRow[]>`
      SELECT c.candidate_id, c.dedupe_key, c.boundary_id, c.agent_id, c.signal,
             c.submitted_at, r.review_id, r.decision, r.reason, r.actor_id,
             r.actor_role, r.policy_version, r.decided_at, rc.recovery_case_id
        FROM agent_case_candidates c
        LEFT JOIN agent_case_candidate_reviews r
          ON r.candidate_id = c.candidate_id AND r.boundary_id = c.boundary_id
        LEFT JOIN recovery_cases rc
          ON rc.source_candidate_id = c.candidate_id AND rc.boundary_id = c.boundary_id
       WHERE c.boundary_id = ${boundaryId}
         AND rc.recovery_case_id IS NULL
         AND (r.review_id IS NULL OR r.decision = 'accepted')
       ORDER BY c.submitted_at ASC, c.candidate_id ASC`;
    return rows.map(mapQueueItem);
  }

  async recordDecision(review: CandidateReview): Promise<CandidateReview> {
    return this.client.$transaction(async (tx) => {
      const candidate = await tx.$queryRaw<Array<{ candidate_id: string }>>`
        SELECT candidate_id FROM agent_case_candidates
         WHERE candidate_id = ${review.candidateId} AND boundary_id = ${review.boundaryId}
         FOR SHARE`;
      if (!candidate[0]) throw new NotFoundError("candidate not found in this boundary");
      const rows = await tx.$queryRaw<Array<{ decided_at: Date }>>`
        INSERT INTO agent_case_candidate_reviews
          (review_id, candidate_id, boundary_id, decision, reason, actor_id, actor_role, policy_version, decided_at)
        VALUES (${review.reviewId}, ${review.candidateId}, ${review.boundaryId}, ${review.decision},
                ${review.reason}, ${review.actorId}, ${review.actorRole}, ${review.policyVersion}, clock_timestamp())
        RETURNING decided_at`;
      return Object.freeze({ ...review, decidedAt: rows[0]!.decided_at.toISOString() });
    });
  }

  async promote(input: {
    readonly recoveryCaseId: string;
    readonly candidateId: string;
    readonly boundaryId: string;
    readonly actorId: string;
    readonly actorRole: "operator";
    readonly policyVersion: string;
  }): Promise<{ readonly recoveryCase: RecoveryCase; readonly created: boolean }> {
    return this.client.$transaction(async (tx) => {
      const existing = await findRecoveryCase(tx, input.candidateId, input.boundaryId);
      if (existing) return { recoveryCase: mapRecoveryCase(existing), created: false };

      const candidates = await tx.$queryRaw<CandidateRow[]>`
        SELECT c.candidate_id, c.dedupe_key, c.boundary_id, c.agent_id, c.signal,
               c.submitted_at, NULL::text AS review_id, NULL::text AS decision,
               NULL::text AS reason, NULL::text AS actor_id, NULL::text AS actor_role,
               NULL::text AS policy_version, NULL::timestamptz AS decided_at,
               NULL::text AS recovery_case_id
          FROM agent_case_candidates c
         WHERE c.candidate_id = ${input.candidateId} AND c.boundary_id = ${input.boundaryId}
         FOR SHARE`;
      const candidate = candidates[0];
      if (!candidate) throw new NotFoundError("candidate not found in this boundary");
      const mapped = mapCandidate(candidate);
      assertCaseCandidateIdentity(mapped);

      const review = await tx.$queryRaw<Array<{ decision: string }>>`
        SELECT decision FROM agent_case_candidate_reviews
         WHERE candidate_id = ${input.candidateId} AND boundary_id = ${input.boundaryId}
         FOR SHARE`;
      if (review[0]?.decision !== "accepted") {
        throw new ConflictError("candidate must have an immutable accepted review before promotion");
      }

      const signal = mapped.signal;
      const inserted = await tx.$queryRaw<RecoveryCaseRow[]>`
        INSERT INTO recovery_cases
          (recovery_case_id, boundary_id, source_candidate_id, recovery_type, source_ref,
           amount_at_risk_minor, currency, detector_version, opened_by_actor_id,
           opened_by_role, policy_version, opened_at, persisted_at)
        VALUES (${input.recoveryCaseId}, ${input.boundaryId}, ${input.candidateId},
                ${signal.recoveryType}, ${signal.sourceRef}, ${signal.amountAtRiskMinor},
                ${signal.currency}, ${signal.detectorVersion}, ${input.actorId},
                ${input.actorRole}, ${input.policyVersion}, clock_timestamp(), clock_timestamp())
        ON CONFLICT (source_candidate_id) DO NOTHING
        RETURNING recovery_case_id, boundary_id, source_candidate_id, recovery_type, source_ref,
                  amount_at_risk_minor, currency, detector_version, opened_by_actor_id,
                  opened_by_role, policy_version, opened_at`;
      if (!inserted[0]) {
        const raced = await findRecoveryCase(tx, input.candidateId, input.boundaryId);
        if (!raced) throw new ConflictError("candidate was promoted in another boundary");
        return { recoveryCase: mapRecoveryCase(raced), created: false };
      }

      await tx.authorityEvent.create({ data: {
        id: `AE-${randomUUID()}`,
        recoveryCaseId: inserted[0].recovery_case_id,
        actorId: input.actorId,
        role: input.actorRole,
        action: "PromoteCandidate",
        policyVersion: input.policyVersion,
      } });
      return { recoveryCase: mapRecoveryCase(inserted[0]), created: true };
    });
  }
}

function mapCandidate(row: CandidateRow): CaseCandidate {
  assertCandidateSignal(row.signal);
  const candidate: CaseCandidate = Object.freeze({
    candidateId: row.candidate_id,
    dedupeKey: row.dedupe_key,
    boundaryId: row.boundary_id,
    agentId: row.agent_id,
    signal: Object.freeze({ ...row.signal }),
    status: "pending_review",
    submittedAt: row.submitted_at.toISOString(),
  });
  assertCaseCandidateIdentity(candidate);
  return candidate;
}

function mapQueueItem(row: CandidateRow): ReviewQueueItem {
  const candidate = mapCandidate(row);
  const review = row.review_id === null ? null : Object.freeze({
    reviewId: row.review_id,
    candidateId: row.candidate_id,
    boundaryId: row.boundary_id,
    decision: row.decision as "accepted" | "rejected",
    reason: row.reason!,
    actorId: row.actor_id!,
    actorRole: row.actor_role as "operator",
    policyVersion: row.policy_version!,
    decidedAt: row.decided_at!.toISOString(),
  });
  return Object.freeze({ ...candidate, review, recoveryCaseId: row.recovery_case_id });
}

async function findRecoveryCase(client: SqlClient, candidateId: string, boundaryId: string) {
  const rows = await client.$queryRaw<RecoveryCaseRow[]>`
    SELECT recovery_case_id, boundary_id, source_candidate_id, recovery_type, source_ref,
           amount_at_risk_minor, currency, detector_version, opened_by_actor_id,
           opened_by_role, policy_version, opened_at
      FROM recovery_cases
     WHERE source_candidate_id = ${candidateId} AND boundary_id = ${boundaryId}
     FOR SHARE`;
  return rows[0] ?? null;
}

function mapRecoveryCase(row: RecoveryCaseRow): RecoveryCase {
  const amount = Number(row.amount_at_risk_minor);
  if (!Number.isSafeInteger(amount)) throw new Error("persisted recovery amount is outside the safe integer range");
  if (row.opened_by_role !== "operator") throw new Error("persisted recovery case has an invalid opener role");
  return Object.freeze({
    recoveryCaseId: row.recovery_case_id,
    boundaryId: row.boundary_id,
    sourceCandidateId: row.source_candidate_id,
    recoveryType: row.recovery_type,
    sourceRef: row.source_ref,
    amountAtRiskMinor: amount,
    currency: row.currency,
    detectorVersion: row.detector_version,
    openedByActorId: row.opened_by_actor_id,
    openedByRole: "operator",
    policyVersion: row.policy_version,
    openedAt: row.opened_at.toISOString(),
  });
}
