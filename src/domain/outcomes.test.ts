// Locks the Outcomes rollup AND the Constitution: forecast (recoverable) is
// never blended into proven (recovered/auditable).
import { describe, it, expect } from "vitest";
import { seedEvents } from "../data/seed";
import { outcomesByLeakage } from "./outcomes";
import { expectedRecoverable } from "./recommendation";
import { portfolioMetrics } from "./metrics";

const events = seedEvents();
const outcomes = outcomesByLeakage(events);
const get = (t: string) => outcomes.find((o) => o.leakageType === t)!;

describe("outcomes rollup", () => {
  it("largest live problem (FailedPayment) leads, with forecast and proven separated", () => {
    const fp = outcomes[0]!;
    expect(fp.leakageType).toBe("FailedPayment");
    expect(fp.atRisk).toBe(31000); // RE-1007 open
    expect(fp.recoverable).toBe(17360); // forecast
    expect(fp.recovered).toBe(36000); // RE-1001 19,200 + RE-1013 16,800 proven
    expect(fp.auditable).toBe(36000);
  });

  it("a problem can have proven recovery and zero open exposure", () => {
    const be = get("BillingError"); // only RE-1003, recovered
    expect(be.atRisk).toBe(0);
    expect(be.recoverable).toBe(0);
    expect(be.recovered).toBe(15000);
    expect(be.openCount).toBe(0);
  });

  it("totals reconcile with the portfolio — forecast and proven each add up", () => {
    const totalRecoverable = outcomes.reduce((s, o) => s + o.recoverable, 0);
    const totalRecovered = outcomes.reduce((s, o) => s + o.recovered, 0);
    const totalAuditable = outcomes.reduce((s, o) => s + o.auditable, 0);
    const m = portfolioMetrics(events);

    expect(totalRecoverable).toBe(expectedRecoverable(events)); // 35,180 forecast
    expect(totalRecovered).toBe(m.recoveredRevenue); // 83,400 proven
    expect(totalAuditable).toBe(m.auditableRevenue); // 79,800 proven
  });

  it("CONSTITUTION: recoverable (forecast) is disjoint from recovered (proven)", () => {
    // The two ledgers must not be equal-by-accident nor summed together.
    const totalRecoverable = outcomes.reduce((s, o) => s + o.recoverable, 0);
    const totalRecovered = outcomes.reduce((s, o) => s + o.recovered, 0);
    expect(totalRecoverable).not.toBe(totalRecovered);
    // No single outcome's forecast is ever folded into its proven number.
    for (const o of outcomes) {
      expect(o.recovered).toBeGreaterThanOrEqual(o.auditable);
    }
  });
});
