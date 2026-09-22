import { describe, expect, it } from "vitest";
import { InMemoryCaseCandidateStore } from "./caseAdmission";
import { ingestSecureCsv } from "./secureCsvIngestion";
import { InMemoryCandidateReviewStore, CandidateReviewService } from "./candidateReview";
import { CandidatePromotionService } from "./recoveryCase";
import type { CaseCandidate, CaseCandidateStore } from "./caseAdmission";

const CSV = [
  "sourceIdentity,recoveryType,observedAt,amountAtRiskMinor,currency,actionAvailable,expectedProofEvent",
  "synthetic-account-0001,ActivationMissed,2026-09-13T00:00:00.000Z,50000,USD,true,SYNTHETIC invoice paid",
].join("\n");
const options = {
  boundaryId: "tenant-1", agentId: "csv-import", detectorVersion: "csv@1",
  sourceRefKey: "x".repeat(32),
  policies: new Map([["ActivationMissed", { recoveryType: "ActivationMissed", economicThresholdMinor: 10_000 }]]),
  now: () => new Date("2026-09-13T01:00:00.000Z"),
};

describe("secure CSV candidate ingestion", () => {
  it.each([
    '"synthetic-account-0002"trailing',
    'synthetic-account-"0002"',
    '"synthetic-account-0002" "tail"',
    '"""synthetic-account-0002"""trailing',
  ])("rejects malformed quoting before any write: %s", async (identity) => {
    const invalidRow = CSV.split("\n")[1]!.replace("synthetic-account-0001", identity);
    let writes = 0;
    const store: CaseCandidateStore = {
      async createIfAbsent(candidate) { writes += 1; return { candidate, created: true }; },
    };
    await expect(ingestSecureCsv(`${CSV}\n${invalidRow}`, store, options)).rejects.toThrow(/CSV.*quot/i);
    expect(writes).toBe(0);
  });

  it.each(["\n", "\r\n"])("preserves valid quoted commas, escaped quotes and embedded newlines with %j records", async (newline) => {
    const proofEvent = 'SYNTHETIC activation "done", verified\r\nnext observation';
    const line = `"synthetic-account-0001",ActivationMissed,2026-09-13T00:00:00.000Z,50000,USD,true,"${proofEvent.replace(/"/g, '""')}"`;
    const candidates: CaseCandidate[] = [];
    const store: CaseCandidateStore = {
      async createIfAbsent(candidate) { candidates.push(candidate); return { candidate, created: true }; },
    };
    // Closing quote at EOF and with a record terminator must both work.
    for (const ending of ["", newline]) {
      await expect(ingestSecureCsv(`${CSV.split("\n")[0]}${newline}${line}${ending}`, store, options))
        .resolves.toMatchObject({ created: 1 });
    }
    expect(candidates.every((candidate) => candidate.signal.expectedProofEvent === proofEvent)).toBe(true);
  });

  it("rejects an unterminated quote and an empty quoted required value without writes", async () => {
    const store: CaseCandidateStore = { async createIfAbsent() { throw new Error("unexpected persistence call"); } };
    await expect(ingestSecureCsv(CSV.replace("SYNTHETIC invoice paid", '"SYNTHETIC invoice paid'), store, options))
      .rejects.toThrow("CSV has an unterminated quoted field");
    await expect(ingestSecureCsv(CSV.replace("SYNTHETIC invoice paid", '""'), store, options))
      .rejects.toThrow("CandidateSignal.expectedProofEvent must be a non-empty string");
  });

  it("pseudonymizes source identity and persists candidates only", async () => {
    const underlying = new InMemoryCaseCandidateStore();
    const persisted: CaseCandidate[] = [];
    const result = await ingestSecureCsv(CSV, {
      async createIfAbsent(candidate) {
        const stored = await underlying.createIfAbsent(candidate);
        persisted.push(stored.candidate);
        return stored;
      },
    }, options);
    expect(result).toEqual({ rowsRead: 1, admitted: 1, created: 1, filtered: 0, rawCsvPersisted: false });
    expect(persisted).toHaveLength(1);
    expect(JSON.stringify(persisted)).not.toContain("synthetic-account-0001");
    expect(persisted[0]!.signal.sourceRef).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
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
      { actorId: "operator-1", role: "operator", boundaryIds: ["tenant-1"] },
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
    const result = await promotion.promote(
      { actorId: "operator-1", role: "operator", boundaryIds: ["tenant-1"] },
      candidates[0]!.candidateId,
      "tenant-1",
    );
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
