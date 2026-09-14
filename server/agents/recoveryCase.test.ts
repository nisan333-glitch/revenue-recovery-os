import { describe, expect, it } from "vitest";
import type { CandidatePromotionStore } from "./recoveryCase";
import { CandidatePromotionService } from "./recoveryCase";

describe("candidate promotion service", () => {
  it("creates a server-owned RecoveryCase id and never accepts one from the caller", async () => {
    let captured: Parameters<CandidatePromotionStore["promote"]>[0] | undefined;
    const store: CandidatePromotionStore = {
      async promote(input) {
        captured = input;
        return { created: true, recoveryCase: {
          recoveryCaseId: input.recoveryCaseId,
          boundaryId: input.boundaryId,
          sourceCandidateId: input.candidateId,
          recoveryType: "ActivationMissed",
          sourceRef: "source:1",
          amountAtRiskMinor: 10_000,
          currency: "USD",
          detectorVersion: "detector@1",
          openedByActorId: input.actorId,
          openedByRole: "operator",
          policyVersion: input.policyVersion,
          openedAt: "2026-09-13T00:00:00.000Z",
        } };
      },
    };
    const service = new CandidatePromotionService(store);
    const result = await service.promote({ actorId: "operator-1", role: "operator" }, "CC-1", "tenant-1");
    expect(result.recoveryCase.recoveryCaseId).toMatch(/^RC-[0-9a-f-]{36}$/);
    expect(captured).toMatchObject({ candidateId: "CC-1", boundaryId: "tenant-1", actorId: "operator-1" });
  });

  it("denies non-operators", async () => {
    const service = new CandidatePromotionService({ promote: async () => { throw new Error("unreachable"); } });
    expect(() => service.promote({ actorId: "steward-1", role: "steward" }, "CC-1", "tenant-1"))
      .toThrow(/operator/);
  });
});
