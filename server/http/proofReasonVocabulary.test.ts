import { describe, expect, it } from "vitest";
import { ALL_REASON_KEYS } from "../../src/domain/reasons";
import { approveProofSchema } from "./schemas";

// The HTTP enum and the domain table are two hand-kept lists of one vocabulary. They have drifted apart
// silently before in other places; this pins them together so a value added to one and not the other
// fails here instead of surfacing as a 400 on a legitimate proof.
describe("proof recovery-reason vocabulary", () => {
  const httpEnum = (approveProofSchema.body.properties.recoveryReason as { enum: readonly string[] }).enum;

  it("the HTTP enum and the domain table list the same reasons, in the same order", () => {
    expect([...httpEnum]).toEqual([...ALL_REASON_KEYS]);
  });

  it("accepts BillingCorrection and still refuses an unlisted value", () => {
    expect(httpEnum).toContain("BillingCorrection");
    expect(httpEnum).not.toContain("billing_correction");
    expect(httpEnum).not.toContain("");
    expect(httpEnum).not.toContain("Other");
  });

  it("is a closed set — the schema forbids extra body properties", () => {
    expect(approveProofSchema.body.additionalProperties).toBe(false);
  });
});
