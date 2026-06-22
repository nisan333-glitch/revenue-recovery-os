// Locks the Recovery Loop summary AND the Constitution: the funnel narrows
// (identified → applied → proven) and the forecast ledger (opportunity) is never
// the same number as, nor summed into, the proven ledger (returned).
import { describe, it, expect } from "vitest";
import { seedEvents } from "../data/seed";
import { recoveryLoop } from "./loop";

const events = seedEvents();
const loop = recoveryLoop(events);

describe("recovery loop summary", () => {
  it("Identify: opportunity is the total at-risk we found (forecast ledger)", () => {
    // Σ riskAmount over all 14 seed events.
    expect(loop.opportunity).toBe(200200);
    expect(loop.identifiedCount).toBe(14);
    expect(loop.openCount).toBe(4);
    expect(loop.recoverableForecast).toBe(33900); // forecast, not proven
  });

  it("Fix: dominant play = the biggest live problem's recommended play; applied narrows", () => {
    // Largest open exposure is the stalled renewal (RE-1007, $31k).
    expect(loop.recommendedPlay).toBe("RenewalOutreach");
    // Acted on = not Detected/Queued/Dismissed → 11 of 14.
    expect(loop.appliedCount).toBe(11);
  });

  it("Prove: returned and auditable come straight from the proven ledger", () => {
    expect(loop.returned).toBe(83400);
    expect(loop.auditable).toBe(79800);
    expect(loop.provenCount).toBe(7);
    expect(loop.recoveryRate).toBeCloseTo(0.875, 5);
  });

  it("the funnel only narrows: identified ≥ applied ≥ proven", () => {
    expect(loop.identifiedCount).toBeGreaterThanOrEqual(loop.appliedCount);
    expect(loop.appliedCount).toBeGreaterThanOrEqual(loop.provenCount);
  });

  it("CONSTITUTION: Opportunity (forecast) and Returned (proven) are never the same number, nor summed", () => {
    expect(loop.opportunity).not.toBe(loop.returned);
    expect(loop.recoverableForecast).not.toBe(loop.returned);
    // Proven cash can never exceed the opportunity we found; auditable ≤ returned.
    expect(loop.returned).toBeLessThanOrEqual(loop.opportunity);
    expect(loop.auditable).toBeLessThanOrEqual(loop.returned);
  });
});
