/** SYNTHETIC integration controls. Run only against the disposable test database. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../db";
import { CandidateReviewService } from "./candidateReview";
import { PostgresCandidateReviewStore } from "./postgresCandidateReviewStore";
import { PostgresCaseCandidateStore } from "./postgresCaseCandidateStore";
import { CandidatePromotionService } from "./recoveryCase";
import { ingestSecureCsv } from "./secureCsvIngestion";
import { SYNTHETIC_OPTIONS, syntheticCsv, syntheticRecords } from "./fixtures/activation.synthetic";

const HAS_DB = !!process.env.DATABASE_URL;
const records = syntheticRecords();
const actor = { actorId: "SYNTHETIC-test-operator", role: "operator" as const, boundaryIds: ["*"] };
const options = () => ({ ...SYNTHETIC_OPTIONS, boundaryId: `SYNTHETIC-fixture-${randomUUID()}` });

describe.skipIf(!HAS_DB)("SYNTHETIC CSV PostgreSQL persistence and promotion", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it("persists 70 unique synthetic candidates with no raw source identity, including after replay", async () => {
    const context = options();
    const store = new PostgresCaseCandidateStore();
    const input = readFileSync(new URL("./fixtures/activation.well-formed.synthetic.csv", import.meta.url));
    await expect(ingestSecureCsv(input, store, context)).resolves.toMatchObject({ admitted: 75, created: 70, filtered: 20 });
    const before = await prisma.agentCaseCandidateRecord.findMany({ where: { boundaryId: context.boundaryId }, orderBy: { candidateId: "asc" } });
    expect(before).toHaveLength(70);
    await expect(ingestSecureCsv(input, store, context)).resolves.toMatchObject({ admitted: 75, created: 0, filtered: 20 });
    const after = await prisma.agentCaseCandidateRecord.findMany({ where: { boundaryId: context.boundaryId }, orderBy: { candidateId: "asc" } });
    expect(after).toEqual(before);
    const persisted = JSON.stringify(after);
    expect(persisted).not.toContain("sourceIdentity");
    for (const record of records.filter((record) => record.sourceIdentity)) expect(persisted).not.toContain(record.sourceIdentity.trim());
    for (const candidate of after) {
      expect(candidate.status).toBe("pending_review");
      expect(candidate.agentId).toContain("SYNTHETIC");
      expect(candidate.signal).toMatchObject({ detectorVersion: SYNTHETIC_OPTIONS.detectorVersion });
    }
    expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId: context.boundaryId } })).toBe(0);
  });

  it("persists nothing from the full mixed fixture", async () => {
    const context = options();
    const input = readFileSync(new URL("./fixtures/activation.synthetic.csv", import.meta.url));
    const before = Buffer.from(input);
    await expect(ingestSecureCsv(input, new PostgresCaseCandidateStore(), context))
      .rejects.toThrow("CSV row 97 amountAtRiskMinor is invalid");
    expect(await prisma.agentCaseCandidateRecord.count({ where: { boundaryId: context.boundaryId } })).toBe(0);
    expect(input.equals(before)).toBe(true);
  });

  it("requires an accepted review and promotes duplicate observations exactly once under concurrent retries", async () => {
    const context = options();
    await expect(ingestSecureCsv(syntheticCsv([records[2]!, records[92]!, records[2]!]), new PostgresCaseCandidateStore(), context))
      .resolves.toMatchObject({ admitted: 3, created: 1 });
    const store = new PostgresCandidateReviewStore();
    const review = new CandidateReviewService(store);
    const promotion = new CandidatePromotionService(store);
    const queue = await review.list(actor, context.boundaryId);
    expect(queue).toHaveLength(1);
    const candidateId = queue[0]!.candidateId;
    await expect(promotion.promote(actor, candidateId, context.boundaryId)).rejects.toThrow(/accepted review/);
    await review.decide(actor, { candidateId, boundaryId: context.boundaryId, decision: "accepted", reason: "SYNTHETIC test-only review" });
    const results = await Promise.all(Array.from({ length: 3 }, () => promotion.promote(actor, candidateId, context.boundaryId)));
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.recoveryCase.recoveryCaseId)).size).toBe(1);
    expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId: context.boundaryId } })).toBe(1);
    expect(await prisma.authorityEvent.count({ where: { recoveryCaseId: results[0]!.recoveryCase.recoveryCaseId, action: "PromoteCandidate" } })).toBe(1);
    expect(await review.list(actor, context.boundaryId)).toEqual([]);
    expect(results[0]!.recoveryCase.detectorVersion).toContain("SYNTHETIC");
  });

  // SPLIT INTO TWO TESTS ON PURPOSE. These were one test, with the schema assertion first — which
  // breaks its own negative control: restoring the constraint aborts on the schema line before the
  // concurrency half runs at all, so the control looks like it worked while proving nothing about
  // whether the concurrency assertions can catch anything. Same shape as the `endsWith` false pass
  // NC-12 found. Separated, each can fail on its own terms and be controlled on its own terms.

  it("leaves exactly one uniqueness arbiter on recovery_cases", async () => {
    // `ON CONFLICT (source_candidate_id)` suppresses conflicts ONLY on the arbiter index it names. A
    // second unique index over the same column can raise a duplicate-key error on a valid replay,
    // before the arbiter resolves it. The composite added no guarantee — candidate_id is the primary
    // key of agent_case_candidates and boundaryId is hashed into it — so it is gone, and the foreign
    // key to (candidate_id, boundary_id) is what still ties a case to its own tenant.
    const arbiters = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname::text AS conname FROM pg_constraint
       WHERE conrelid = 'recovery_cases'::regclass AND contype = 'u'`;
    expect(arbiters.map((row) => row.conname)).toContain("recovery_cases_source_candidate_key");
    expect(arbiters.map((row) => row.conname)).not.toContain("recovery_cases_candidate_boundary_unique");

    // The tenant guard the composite was mistaken for. Dropping a unique constraint on the REFERENCING
    // table cannot invalidate this: the foreign key depends on a unique constraint on the REFERENCED
    // table. Asserted so nobody "tidies" it away while removing another redundant index.
    const foreignKeys = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname::text AS conname FROM pg_constraint
       WHERE conrelid = 'recovery_cases'::regclass AND contype = 'f'`;
    expect(foreignKeys.map((row) => row.conname)).toContain("recovery_cases_candidate_fkey");
  });

  it("promotes a candidate exactly once under concurrency, and records one authority event", async () => {
    // What this proves regardless of whether the race fires: the replay path re-selects scoped to
    // candidate AND boundary and returns created:false, and the authority event is written only on the
    // creating branch — so a replay must never emit a second PromoteCandidate.
    const context = options();
    await expect(ingestSecureCsv(syntheticCsv(records.slice(0, 4)), new PostgresCaseCandidateStore(), context))
      .resolves.toMatchObject({ admitted: 4, created: 4 });
    const store = new PostgresCandidateReviewStore();
    const review = new CandidateReviewService(store);
    const promotion = new CandidatePromotionService(store);
    const queue = await review.list(actor, context.boundaryId);
    expect(queue).toHaveLength(4);
    for (const candidate of queue) {
      await review.decide(actor, { candidateId: candidate.candidateId, boundaryId: context.boundaryId,
        decision: "accepted", reason: "SYNTHETIC concurrency control" });
    }

    const promoted = await Promise.all(queue.map(async (candidate) => {
      const results = await Promise.all(Array.from({ length: 3 },
        () => promotion.promote(actor, candidate.candidateId, context.boundaryId)));
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(new Set(results.map((result) => result.recoveryCase.recoveryCaseId)).size).toBe(1);
      return results[0]!.recoveryCase.recoveryCaseId;
    }));
    expect(new Set(promoted).size).toBe(4);
    expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId: context.boundaryId } })).toBe(4);
    expect(await prisma.authorityEvent.count({ where: { recoveryCaseId: { in: promoted }, action: "PromoteCandidate" } })).toBe(4);
  });
});
