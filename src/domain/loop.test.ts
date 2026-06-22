// Locks the Recovery Loop summary AND the Constitution: the funnel narrows
// (identified → applied → proven) and the forecast ledger (opportunity) is never
// the same number as, nor summed into, the proven ledger (returned).
import { describe, it, expect } from "vitest";
import { seedEvents } from "../data/seed";
import { recoveryLoop } from "./loop";

const events = seedEvents();
const loop = recoveryLoop(events);

describe("recovery loop summary", () => {
  it("Identify: money at risk is the live open exposure; opportunity is total surfaced", () => {
    expect(loop.moneyAtRisk).toBe(71800); // open risk only — the live exposure
    // Σ riskAmount over all 14 seed events.
    expect(loop.opportunity).toBe(200200);
    expect(loop.identifiedCount).toBe(14);
    expect(loop.openCount).toBe(4);
    expect(loop.recoverableForecast).toBe(32660); // forecast, not proven
  });

  it("Act: dominant play is advice; action-taken counts only logged, observable actions", () => {
    // Largest open exposure is the missed activation (RE-1007, $31k second invoice).
    expect(loop.recommendedPlay).toBe("MilestoneNudge");
    // Observable bridge: accounts with a logged action (actionsTaken > 0) → 11 of 14.
    // Excludes RE-1006/1007/1010 (no action logged); we never claim "fixed".
    expect(loop.actionTakenCount).toBe(11);
  });

  it("Prove: returned and auditable come straight from the proven ledger", () => {
    expect(loop.returned).toBe(83400);
    expect(loop.auditable).toBe(79800);
    expect(loop.provenCount).toBe(7);
    expect(loop.recoveryRate).toBeCloseTo(0.875, 5);
  });

  it("the funnel only narrows: identified ≥ action taken ≥ proven", () => {
    expect(loop.identifiedCount).toBeGreaterThanOrEqual(loop.actionTakenCount);
    expect(loop.actionTakenCount).toBeGreaterThanOrEqual(loop.provenCount);
  });

  it("CONSTITUTION: Opportunity (forecast) and Returned (proven) are never the same number, nor summed", () => {
    expect(loop.opportunity).not.toBe(loop.returned);
    expect(loop.recoverableForecast).not.toBe(loop.returned);
    // Proven cash can never exceed the opportunity we found; auditable ≤ returned.
    expect(loop.returned).toBeLessThanOrEqual(loop.opportunity);
    expect(loop.auditable).toBeLessThanOrEqual(loop.returned);
  });
});
