import { describe, expect, it } from "vitest";
import { InMemoryCaseCandidateStore } from "./caseAdmission";
import { ingestSecureCsv } from "./secureCsvIngestion";
import { InMemoryCandidateReviewStore, CandidateReviewService } from "./candidateReview";
import { CandidatePromotionService } from "./recoveryCase";
import type { CaseCandidate, CaseCandidateStore } from "./caseAdmission";

const CSV = [
  "sourceIdentity,recoveryType,observedAt,amountAtRiskMinor,currency,actionAvailable,expectedProofEvent",
  "account@example.com,ActivationMissed,2026-09-13T00:00:00.000Z,50000,USD,true,invoice paid",
].join("\n");
const options = {
  boundaryId: "tenant-1", agentId: "csv-import", detectorVersion: "csv@1",
  sourceRefKey: "x".repeat(32),
  policies: new Map([["ActivationMissed", { recoveryType: "ActivationMissed", economicThresholdMinor: 10_000 }]]),
  now: () => new Date("2026-09-13T01:00:00.000Z"),
};

describe("secure CSV candidate ingestion", () => {
  it("pseudonymizes source identity and persists candidates only", async () => {
    const result = await ingestSecureCsv(CSV, new InMemoryCaseCandidateStore(), options);
    expect(result).toEqual({ rowsRead: 1, admitted: 1, created: 1, filtered: 0, rawCsvPersisted: false });
    expect(JSON.stringify(result)).not.toContain("account@example.com");
  });

  it("keeps the synthetic pilot path candidate-first through review and promotion", async () => {
    const candidates: CaseCandidate[] = [];
    const store: CaseCandidateStore = {
      async createIfAbsent(candidate) {
        candidates.push(candidate);
        return { candidate, created: true };
      },
    };
    await ingestSecureCsv(CSV, store, options);
    expect(candidates).toHaveLength(1);

    const reviews = new InMemoryCandidateReviewStore();
    reviews.seed(candidates[0]!);
    const review = await new CandidateReviewService(reviews, options.now).decide(
      { actorId: "operator-1", role: "operator" },
      { candidateId: candidates[0]!.candidateId, boundaryId: "tenant-1", decision: "accepted", reason: "synthetic fixture review" },
    );
    expect(review.decision).toBe("accepted");

    let promoted = false;
    const promotion = new CandidatePromotionService({
      async promote(input) {
        promoted = input.candidateId === candidates[0]!.candidateId;
        return { created: promoted, recoveryCase: {
          recoveryCaseId: input.recoveryCaseId, boundaryId: input.boundaryId,
          sourceCandidateId: input.candidateId, recoveryType: candidates[0]!.signal.recoveryType,
          sourceRef: candidates[0]!.signal.sourceRef, amountAtRiskMinor: candidates[0]!.signal.amountAtRiskMinor,
          currency: candidates[0]!.signal.currency, detectorVersion: candidates[0]!.signal.detectorVersion,
          openedByActorId: input.actorId, openedByRole: "operator", policyVersion: input.policyVersion,
          openedAt: options.now().toISOString(),
        } };
      },
    });
    const result = await promotion.promote({ actorId: "operator-1", role: "operator" }, candidates[0]!.candidateId, "tenant-1");
    expect(promoted).toBe(true);
    expect(result.created).toBe(true);
  });

  it("requires explicit confirmation for synonym mappings", async () => {
    const mapped = CSV.replace("sourceIdentity", "email");
    await expect(ingestSecureCsv(mapped, new InMemoryCaseCandidateStore(), {
      ...options, headerMap: { sourceIdentity: "email" },
    })).rejects.toThrow(/confirmation/);
    await expect(ingestSecureCsv(mapped, new InMemoryCaseCandidateStore(), {
      ...options, headerMap: { sourceIdentity: "email" }, confirmMappedHeaders: true,
    })).resolves.toMatchObject({ admitted: 1 });
  });

  it("rejects weak keys, unknown policies, malformed rows and NUL bytes", async () => {
    await expect(ingestSecureCsv(CSV, new InMemoryCaseCandidateStore(), { ...options, sourceRefKey: "weak" }))
      .rejects.toThrow(/32 bytes/);
    await expect(ingestSecureCsv(CSV.replace("ActivationMissed", "Other"), new InMemoryCaseCandidateStore(), options))
      .rejects.toThrow(/no admission policy/);
    await expect(ingestSecureCsv(Buffer.from(`${CSV}\0`), new InMemoryCaseCandidateStore(), options))
      .rejects.toThrow(/NUL/);
  });
});
