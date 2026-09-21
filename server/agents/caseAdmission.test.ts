import { describe, expect, it } from "vitest";
import { CaseAdmissionService, InMemoryCaseCandidateStore } from "./caseAdmission";
import type { CandidateSignal } from "./types";

const SIGNAL: CandidateSignal = {
  signalId: "sig-1",
  boundaryId: "tenant-1",
  recoveryType: "ActivationMissed",
  sourceRef: "crm:account-1",
  sourcePayloadHash: "a".repeat(64),
  detectorVersion: "activation-detector@1.0.0",
  observedAt: "2026-09-07T00:00:00.000Z",
  amountAtRiskMinor: 50_000,
  currency: "USD",
  actionAvailable: true,
  expectedProofEvent: "second invoice paid",
};

const POLICY = { recoveryType: "ActivationMissed", economicThresholdMinor: 10_000 };

describe("Case candidate admission boundary", () => {
  it("creates a pending-review candidate, never a Recovery Case or proof", async () => {
    const service = new CaseAdmissionService(
      new InMemoryCaseCandidateStore(),
      () => new Date("2026-09-07T01:00:00.000Z"),
    );
    const result = await service.submit("activation-detector", SIGNAL, POLICY);
    expect(result).toMatchObject({ admitted: true, created: true });
    if (!result.admitted) throw new Error("expected admission");
    expect(result.candidate.status).toBe("pending_review");
    expect(result.candidate).not.toHaveProperty("revenueReturned");
    expect(result.candidate).not.toHaveProperty("proofId");
  });

  it("deduplicates the same atomic source across agents and detector versions", async () => {
    const store = new InMemoryCaseCandidateStore();
    const service = new CaseAdmissionService(store, () => new Date("2026-09-07T01:00:00.000Z"));
    const first = await service.submit("agent-a", SIGNAL, POLICY);
    const second = await service.submit("agent-b", {
      ...SIGNAL,
      signalId: "sig-2",
      detectorVersion: "activation-detector@1.1.0",
    }, POLICY);
    expect(first).toMatchObject({ admitted: true, created: true });
    expect(second).toMatchObject({ admitted: true, created: false });
    if (first.admitted && second.admitted) {
      expect(second.candidate.candidateId).toBe(first.candidate.candidateId);
    }
  });

  it("keeps tenant boundaries separate", async () => {
    const store = new InMemoryCaseCandidateStore();
    const service = new CaseAdmissionService(store, () => new Date("2026-09-07T01:00:00.000Z"));
    const first = await service.submit("agent-a", SIGNAL, POLICY);
    const second = await service.submit("agent-a", { ...SIGNAL, boundaryId: "tenant-2" }, POLICY);
    expect(first).toMatchObject({ admitted: true, created: true });
    expect(second).toMatchObject({ admitted: true, created: true });
  });

  it("rejects a candidate below the economic threshold", async () => {
    const service = new CaseAdmissionService(
      new InMemoryCaseCandidateStore(),
      () => new Date("2026-09-07T01:00:00.000Z"),
    );
    await expect(service.submit("agent-a", { ...SIGNAL, amountAtRiskMinor: 9_999 }, POLICY))
      .resolves.toMatchObject({ admitted: false });
  });
});
