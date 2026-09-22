import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app";
import { CandidateReviewService, type CandidateReviewStore } from "./candidateReview";
import { CandidatePromotionService, type CandidatePromotionStore } from "./recoveryCase";

describe("candidate API boundary authorization", () => {
  const listPending = vi.fn<CandidateReviewStore["listPending"]>(async () => []);
  const recordDecision = vi.fn<CandidateReviewStore["recordDecision"]>(async (review) => review);
  const promote = vi.fn<CandidatePromotionStore["promote"]>(async () => { throw new Error("unreachable"); });
  const app = buildApp({
    identityResolver: async () => ({
      actorId: "operator-2",
      role: "operator",
      boundaryIds: ["tenant-2"],
    }),
    candidateReviewService: new CandidateReviewService({ listPending, recordDecision }),
    candidatePromotionService: new CandidatePromotionService({ promote }),
  });

  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); });

  it.each([
    { method: "GET", url: "/agent-candidates?boundaryId=tenant-1" },
    {
      method: "POST",
      url: "/agent-candidates/CC-1/review",
      payload: { boundaryId: "tenant-1", decision: "accepted", reason: "reviewed" },
    },
    {
      method: "POST",
      url: "/agent-candidates/CC-1/promote",
      payload: { boundaryId: "tenant-1" },
    },
  ] as const)("rejects $method $url before persistence", async ({ method, url, ...options }) => {
    const response = await app.inject({ method, url, ...options });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "forbidden" });
  });

  it("never calls a candidate store for rejected cross-boundary requests", () => {
    expect(listPending).not.toHaveBeenCalled();
    expect(recordDecision).not.toHaveBeenCalled();
    expect(promote).not.toHaveBeenCalled();
  });
});
