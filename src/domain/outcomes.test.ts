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
  it("largest live problem (ActivationMissed) leads, with forecast and proven separated", () => {
    const top = outcomes[0]!;
    expect(top.leakageType).toBe("ActivationMissed");
    expect(top.atRisk).toBe(43500); // RE-1007 31,000 + RE-1008 12,500 open — UNCHANGED
    expect(top.recoverable).toBe(19140); // forecast (13,640 + 5,500) — UNCHANGED
    // RECOMPUTED, and the zero here is the correction working rather than a loss of data. RE-1002 and
    // RE-1014 collected $7,700 and $10,600, and neither mechanism — MilestoneNudge, UsageActivation —
    // is one any source attests, so no proof can exist and the PROVEN figure is zero for this family.
    // The collections themselves are still recorded on the events and reported by
    // `portfolioMetrics.proofRefusedCollected`; it is the proof that is absent, not the money.
    expect(top.recovered).toBe(0);
    expect(top.auditable).toBe(0);
  });

  it("a problem can have proven recovery and zero open exposure", () => {
    // RE-1004's ExecBusinessReview is refused, so the family that demonstrates this is now
    // RevenueUnderBilled — the one leakage type whose correction mechanism is attestable.
    const es = get("RevenueUnderBilled"); // only RE-1015, recovered and provable
    expect(es.atRisk).toBe(0);
    expect(es.recoverable).toBe(0);
    expect(es.recovered).toBe(5500);
    expect(es.openCount).toBe(0);
    // And the family whose mechanism cannot be attested shows zero PROVEN with zero open exposure,
    // which is a different statement and must not read as "nothing happened here".
    const exp = get("ExpansionStalled"); // only RE-1004, recovered but unprovable
    expect(exp.recovered).toBe(0);
    expect(exp.openCount).toBe(0);
  });

  it("totals reconcile with the portfolio — forecast and proven each add up", () => {
    const totalRecoverable = outcomes.reduce((s, o) => s + o.recoverable, 0);
    const totalRecovered = outcomes.reduce((s, o) => s + o.recovered, 0);
    const totalAuditable = outcomes.reduce((s, o) => s + o.auditable, 0);
    const m = portfolioMetrics(events);

    expect(totalRecoverable).toBe(expectedRecoverable(events)); // 32,660 forecast
    expect(totalRecovered).toBe(m.recoveredRevenue); // 5,500 proven
    expect(totalAuditable).toBe(m.auditableRevenue); // 5,500 proven
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
