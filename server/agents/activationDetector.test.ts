import { describe, expect, it } from "vitest";
import { activationDetector, configuredAgentHandlers } from "./activationDetector";

export const observation = {
  sourceRef: `hmac-sha256:${"a".repeat(64)}`, signedAt: "2026-01-01T00:00:00.000Z",
  activationDueAt: "2026-01-10T00:00:00.000Z", activatedAt: null,
  observedAt: "2026-01-11T00:00:00.000Z", amountAtRiskMinor: 10_000, currency: "USD", actionAvailable: true,
};
const context = { taskId: "t", boundaryId: "b", attempt: 1 };
const detector = activationDetector(() => Date.parse("2026-01-12T00:00:00.000Z"));
describe("activation deadline detector", () => {
  it("emits a stable scoped candidate for a missed deadline", async () => {
    const output = await detector.run(observation, context);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({ boundaryId: "b", recoveryType: "ActivationMissed", amountAtRiskMinor: 10_000 });
    expect(await detector.run(observation, { ...context, attempt: 2 })).toEqual(output);
  });
  it.each([{ activatedAt: "2026-01-05T00:00:00.000Z" }, { observedAt: "2026-01-09T00:00:00.000Z" }, { actionAvailable: false }])(
    "does not report completed, not-yet-due, or nonactionable observations: %j", async (change) => {
      expect(await detector.run({ ...observation, ...change }, context)).toEqual([]);
    });
  it.each([{ collectedMinor: 100 }, { sourceRef: "raw-account" }, { activatedAt: undefined },
    { observedAt: "2027-01-01T00:00:00.000Z" }, { signedAt: "2026-01-11T00:00:00.000Z" }, { amountAtRiskMinor: -1 }])(
    "rejects invalid observations: %j", async (change) => {
      await expect(detector.run({ ...observation, ...change }, context)).rejects.toThrow();
    });
  it("requires explicit opt-in", () => {
    expect(configuredAgentHandlers({})).toEqual([]);
    expect(configuredAgentHandlers({ NH_ACTIVATION_DETECTOR_ENABLED: "true" })).toHaveLength(1);
    expect(() => configuredAgentHandlers({ NH_ACTIVATION_DETECTOR_ENABLED: "yes" })).toThrow();
  });
});
