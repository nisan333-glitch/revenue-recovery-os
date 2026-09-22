import { describe, expect, it } from "vitest";
import {
  advanceSyntheticScenario,
  initialSyntheticPilot,
  syntheticAuditTrail,
  syntheticPilotTotals,
  syntheticRevenueReturnedMinor,
} from "./syntheticPilotV2";

const runToEnd = (index: number) => {
  let state = initialSyntheticPilot()[index]!;
  for (let step = 0; step < 4; step += 1) state = advanceSyntheticScenario(state);
  return state;
};

describe("Synthetic Pilot v2 governed scenarios", () => {
  it("counts only the successful independently verified scenario", () => {
    const success = runToEnd(0);
    const rejected = runToEnd(1);
    const blocked = runToEnd(2);
    expect(success.stage).toBe("proof_approved");
    expect(rejected.stage).toBe("rejected");
    expect(blocked.stage).toBe("proof_blocked");
    expect(syntheticPilotTotals([success, rejected, blocked])).toEqual({
      opportunityMinor: 4_000_000,
      revenueReturnedMinor: 500_000,
      auditableRevenueMinor: 500_000,
      stoppedCount: 2,
    });
  });

  it("never counts opportunity or an unverified claimed collection as returned revenue", () => {
    const initial = initialSyntheticPilot();
    expect(syntheticPilotTotals(initial).revenueReturnedMinor).toBe(0);
    expect(syntheticRevenueReturnedMinor(runToEnd(2))).toBe(0);
  });

  it("stops a human rejection before a Recovery Case is created", () => {
    const rejected = advanceSyntheticScenario(initialSyntheticPilot()[1]!);
    expect(rejected.stage).toBe("rejected");
    expect(syntheticAuditTrail(rejected).map((entry) => entry.action)).toEqual([
      "Candidate emitted",
      "Review rejected",
    ]);
  });

  it("records every successful decision in order", () => {
    const audit = syntheticAuditTrail(runToEnd(0));
    expect(audit.map((entry) => entry.action)).toEqual([
      "Candidate emitted",
      "Review accepted",
      "Activation play recorded",
      "Outcome evidence received",
      "Proof approved",
    ]);
  });

  it("is terminal and idempotent after rejection, block or proof", () => {
    for (const index of [0, 1, 2]) {
      const terminal = runToEnd(index);
      expect(advanceSyntheticScenario(terminal)).toBe(terminal);
    }
  });
});
