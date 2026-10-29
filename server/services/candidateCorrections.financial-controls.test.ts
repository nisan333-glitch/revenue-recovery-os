import { describe, expect, it } from "vitest";
import { observationsFromRows, summariseCorrections } from "./candidateCorrections";

// Financial controls at the observation-to-report boundary. These do NOT assert
// billing was corrected, a case was approved, or any money was collected.
const boundary = "SYNTHETIC-financial-controls";
const sourceRef = "hmac-sha256:" + "a".repeat(64);
const event = (sequence: bigint, obligationRef: string, amount: number) => ({
  event_sequence: sequence,
  boundary_id: boundary,
  result: [{
    recoveryType: "SYNTHETIC_SHORTFALL",
    sourceRef,
    amountAtRiskMinor: amount,
    currency: "USD",
    obligationCoverage: { kind: "SINGLE_OBLIGATION", obligationRef },
  }],
});

describe("financial correction reporting controls (synthetic, read-only)", () => {
  it("preserves distinct obligations and refuses to net opposing unresolved corrections", () => {
    const observations = observationsFromRows([
      event(1n, "OBL-A", 60_000),
      event(2n, "OBL-B", 60_000),
      event(3n, "OBL-A", 80_000), // upward $200
      event(4n, "OBL-B", 20_000), // downward $400
    ]);
    const report = summariseCorrections(observations);
    expect(report.totals.identities).toBe(2);
    expect(report.totals.withCorrections).toBe(2);
    expect(report.totals.upwardUndecidedMinor).toBe(20_000);
    expect(report.totals.downwardUndecidedMinor).toBe(40_000);
    expect(report.netIsDeliberatelyAbsent).toBe(true);
    expect(Object.keys(report.totals)).not.toContain("netMinor");
    expect(report.records.map((r) => r.obligationRef).sort()).toEqual(["OBL-A", "OBL-B"]);
    for (const record of report.records) {
      expect(record.state).toBe("CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED");
      expect(record.storedMinor).toBe(60_000); // persisted first-wins is not authoritative
      expect(record.observationCount).toBe(2);
      expect(record.obligationGrained).toBe(true);
    }
    expect(report.records.find((r) => r.obligationRef === "OBL-A")?.observedAmountsMinor).toEqual([60_000, 80_000]);
    expect(report.records.find((r) => r.obligationRef === "OBL-B")?.observedAmountsMinor).toEqual([60_000, 20_000]);
  });

  it("replaying an identical observation is not a correction or recovered revenue", () => {
    const report = summariseCorrections(observationsFromRows([
      event(1n, "OBL-A", 30_000),
      event(2n, "OBL-A", 30_000),
    ]));
    expect(report.totals.identities).toBe(1);
    expect(report.totals.withCorrections).toBe(0);
    expect(report.totals.repeatedIdentical).toBe(1);
    expect(report.totals.upwardUndecidedMinor).toBe(0);
    expect(report.totals.downwardUndecidedMinor).toBe(0);
    expect(report.records[0]?.state).toBe("REPEATED_IDENTICAL_OBSERVATION");
  });

  it("keeps account-grained and obligation-grained histories separate", () => {
    const accountRow = {
      event_sequence: 1n,
      boundary_id: boundary,
      result: [{
        recoveryType: "SYNTHETIC_SHORTFALL", sourceRef,
        amountAtRiskMinor: 90_000, currency: "USD",
      }],
    };
    const report = summariseCorrections(observationsFromRows([
      accountRow, event(2n, "OBL-A", 40_000), event(3n, "OBL-B", 50_000),
    ]));
    expect(report.totals.identities).toBe(3);
    expect(report.totals.withCorrections).toBe(0);
    expect(report.records.filter((r) => r.obligationGrained)).toHaveLength(2);
    expect(report.records.filter((r) => !r.obligationGrained)).toHaveLength(1);
  });
});
