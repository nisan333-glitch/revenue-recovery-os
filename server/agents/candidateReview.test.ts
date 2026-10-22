import { describe, expect, it } from "vitest";
import type { ActorContext } from "../auth/identity";
import { CaseAdmissionService, InMemoryCaseCandidateStore } from "./caseAdmission";
import { CandidateReviewService, InMemoryCandidateReviewStore } from "./candidateReview";
import type { CandidateSignal } from "./types";

const OPERATOR: ActorContext = { actorId: "operator-1", role: "operator", boundaryIds: ["tenant-1"] };
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

  it("denies an operator outside the requested boundary", async () => {
    const service = new CandidateReviewService(new InMemoryCandidateReviewStore());
    expect(() => service.list({ actorId: "operator-2", role: "operator", boundaryIds: ["tenant-2"] }, "tenant-1"))
      .toThrow(/not authorized for this boundary/);
  });
});

// ── THE GRAIN DISCLOSURE ON THE QUEUE · where the promote decision is actually taken ──────────────
//
// A disclosure that arrives only on the Case arrives after the decision that created it. These assert the
// queue carries it, per item, and that adding it widened no gate.
describe("candidate queue · identity grain disclosure", () => {
  async function queueWith(signal: CandidateSignal = SIGNAL) {
    const store = new InMemoryCandidateReviewStore();
    const admitted = await new CaseAdmissionService(new InMemoryCaseCandidateStore(), () => new Date())
      .submit("activation-agent", signal, { recoveryType: "ActivationMissed", economicThresholdMinor: 10_000 });
    if (!admitted.admitted) throw new Error("fixture was not admitted");
    store.seed(admitted.candidate);
    return new CandidateReviewService(store, () => new Date()).list(OPERATOR, "tenant-1");
  }

  it("every queue item declares that its identity is ACCOUNT-grained", async () => {
    const items = await queueWith();
    expect(items).toHaveLength(1);
    const grain = items[0]!.identityGrain;
    expect(grain.grain).toBe("ACCOUNT_GRAINED_POTENTIAL");
    expect(grain.mayCoverMultipleObligations).toBe(true);
    expect(grain.obligationUniquenessGuaranteed).toBe(false);
    expect(grain.headline).toMatch(/ACCOUNT-LEVEL IDENTITY/);
  });

  it("NOT CHECKED is reported as not checked — the queue runs no forensic join", async () => {
    const items = await queueWith();
    // Claiming `count: 0` here would report work this read did not do.
    expect(items[0]!.identityGrain.absorbedObservations).toEqual({ checked: false });
  });

  it("the response stays an ARRAY — the disclosure is additive, per item", async () => {
    // Wrapping the list in `{ identityGrain, items }` would read tidier and would break every consumer
    // that treats this route as an array, including the browser journey's own pending count.
    const items = await queueWith();
    expect(Array.isArray(items)).toBe(true);
    expect(items[0]).toHaveProperty("candidateId");
    expect(items[0]).toHaveProperty("signal");
  });

  it("BOUNDARY ISOLATION is unchanged · refused SYNCHRONOUSLY, before any disclosure is built", async () => {
    // The assertion is `toThrow`, not `rejects.toThrow`, and that is the point rather than an accident.
    // The two pre-existing gate tests in the block above are written this way, so an implementation that
    // awaited the store would turn these refusals into rejected promises and break them. Asserting the
    // synchronous shape here pins the property that caught it.
    const store = new InMemoryCandidateReviewStore();
    const service = new CandidateReviewService(store, () => new Date());
    expect(() => service.list(OPERATOR, "tenant-OTHER")).toThrow(/not authorized for this boundary/);
    expect(() => service.list({ actorId: "cfo", role: "approver", boundaryIds: ["tenant-1"] }, "tenant-1"))
      .toThrow(/requires the operator role/);
  });

  it("a refused read builds NO disclosure at all — the gate runs first", async () => {
    // Not a wording check: the store is the only thing that can observe whether the read got past the
    // gate, so a store that records its calls proves the refusal happened before any work.
    const calls: string[] = [];
    const store = new InMemoryCandidateReviewStore();
    const listPending = store.listPending.bind(store);
    store.listPending = async (boundaryId: string) => {
      calls.push(boundaryId);
      return listPending(boundaryId);
    };
    const service = new CandidateReviewService(store, () => new Date());
    expect(() => service.list(OPERATOR, "tenant-OTHER")).toThrow();
    expect(calls).toEqual([]);
    await service.list(OPERATOR, "tenant-1");
    expect(calls).toEqual(["tenant-1"]); // and the permitted read does reach it
  });
});
