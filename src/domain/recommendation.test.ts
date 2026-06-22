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
  it("recommends the right play for RE-1007 (FailedPayment) with exact expected value", () => {
    const rec = recommend(byId("RE-1007"));
    // risk 31,000 − baseline 6,200 = 24,800 impact; × 0.70 = 17,360
    expect(rec.recommendedReason).toBe("DunningRetry");
    expect(rec.expectedImpact).toBe(24800);
    expect(rec.probabilityOfSuccess).toBe(0.7);
    expect(rec.expectedValue).toBe(17360);
    expect(rec.effort).toBe("Low");
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
    // RE-1007 17,360 + RE-1008 6,500 + RE-1009 3,520 + RE-1010 7,800 = 35,180
    expect(expectedRecoverable(events)).toBe(35180);
  });

  it("forecast never reads from terminal events (recovered/failed/dismissed)", () => {
    const openOnly = events.filter((e) => OPEN_STATUSES.includes(e.status));
    expect(expectedRecoverable(events)).toBe(expectedRecoverable(openOnly));
  });
});
