import { describe, expect, it } from "vitest";
import type { ActorContext } from "../auth/identity";
import { CaseAdmissionService, InMemoryCaseCandidateStore } from "./caseAdmission";
import { CandidateReviewService, InMemoryCandidateReviewStore } from "./candidateReview";
import type { CandidateSignal } from "./types";

const OPERATOR: ActorContext = { actorId: "operator-1", role: "operator" };
const SIGNAL: CandidateSignal = {
  signalId: "signal-1",
  boundaryId: "tenant-1",
  recoveryType: "ActivationMissed",
  sourceRef: "crm:account-1",
  sourcePayloadHash: "a".repeat(64),
  detectorVersion: "activation@1",
  observedAt: "2026-09-13T00:00:00.000Z",
  amountAtRiskMinor: 50_000,
  currency: "USD",
  actionAvailable: true,
  expectedProofEvent: "invoice paid",
};

async function candidate() {
  const admitted = await new CaseAdmissionService(new InMemoryCaseCandidateStore(), () => new Date())
    .submit("activation-agent", SIGNAL, { recoveryType: "ActivationMissed", economicThresholdMinor: 10_000 });
  if (!admitted.admitted) throw new Error("fixture was not admitted");
  return admitted.candidate;
}

describe("candidate review boundary", () => {
  it("keeps an accepted candidate retryable until a RecoveryCase root exists", async () => {
    const store = new InMemoryCandidateReviewStore();
    const item = await candidate();
    store.seed(item);
    const service = new CandidateReviewService(store, () => new Date("2026-09-13T01:00:00.000Z"));
    await service.decide(OPERATOR, {
      candidateId: item.candidateId,
      boundaryId: item.boundaryId,
      decision: "accepted",
      reason: "source checked",
    });
    await expect(service.list(OPERATOR, item.boundaryId)).resolves.toMatchObject([
      { candidateId: item.candidateId, review: { decision: "accepted" }, recoveryCaseId: null },
    ]);
  });

  it("removes a rejected candidate and refuses a second immutable decision", async () => {
    const store = new InMemoryCandidateReviewStore();
    const item = await candidate();
    store.seed(item);
    const service = new CandidateReviewService(store);
    const input = { candidateId: item.candidateId, boundaryId: item.boundaryId, decision: "rejected" as const, reason: "false positive" };
    await service.decide(OPERATOR, input);
    await expect(service.list(OPERATOR, item.boundaryId)).resolves.toEqual([]);
    await expect(service.decide(OPERATOR, input)).rejects.toThrow(/immutable review/);
  });

  it("requires an operator for review reads and decisions", async () => {
    const service = new CandidateReviewService(new InMemoryCandidateReviewStore());
    expect(() => service.list({ actorId: "a", role: "approver" }, "tenant-1")).toThrow(/operator/);
  });
});
