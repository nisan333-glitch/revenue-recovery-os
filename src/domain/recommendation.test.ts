// Locks the Decision Engine's recommendations against the seed portfolio.
import { describe, it, expect } from "vitest";
import { seedEvents } from "../data/seed";
import { OPEN_STATUSES } from "./types";
import {
  PLAYBOOK,
  expectedImpact,
  expectedRecoverable,
  recommend,
} from "./recommendation";

const events = seedEvents();
const byId = (id: string) => events.find((e) => e.eventId === id)!;

describe("recommendation playbook", () => {
  it("recommends the right play for RE-1007 (RenewalAtRisk) with exact expected value", () => {
    const rec = recommend(byId("RE-1007"));
    // risk 31,000 − baseline 6,200 = 24,800 impact; × 0.60 = 14,880
    expect(rec.recommendedReason).toBe("RenewalOutreach");
    expect(rec.expectedImpact).toBe(24800);
    expect(rec.probabilityOfSuccess).toBe(0.6);
    expect(rec.expectedValue).toBe(14880);
    expect(rec.effort).toBe("Medium");
  });

  it("expectedImpact is clamped at zero and equals risk − baseline", () => {
    expect(expectedImpact(byId("RE-1008"))).toBe(10000); // 12,500 − 2,500
    expect(expectedImpact(byId("RE-1009"))).toBe(8800); // 8,800 − 0
  });

  it("every leakage type maps to a play with a valid probability", () => {
    for (const entry of Object.values(PLAYBOOK)) {
      expect(entry.probabilityOfSuccess).toBeGreaterThan(0);
      expect(entry.probabilityOfSuccess).toBeLessThanOrEqual(1);
      expect(entry.recommendedActions.length).toBeGreaterThan(0);
    }
  });

  it("expectedRecoverable sums expected value over OPEN events only", () => {
    // RE-1007 RenewalAtRisk 24,800×0.60 = 14,880
    // RE-1008 ActivationMissed 10,000×0.55 = 5,500
    // RE-1009 StalledOnboarding 8,800×0.65 = 5,720
    // RE-1010 NoFirstValue 15,600×0.50 = 7,800  → total 33,900
    expect(expectedRecoverable(events)).toBe(33900);
  });

  it("forecast never reads from terminal events (recovered/failed/dismissed)", () => {
    const openOnly = events.filter((e) => OPEN_STATUSES.includes(e.status));
    expect(expectedRecoverable(events)).toBe(expectedRecoverable(openOnly));
  });
});
