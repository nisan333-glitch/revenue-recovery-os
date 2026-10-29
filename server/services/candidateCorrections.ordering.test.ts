import { describe, expect, it } from "vitest";
import { observationsFromRows, summariseCorrections } from "./candidateCorrections";

const signal = {
  recoveryType: "SYNTHETIC_SHORTFALL",
  sourceRef: "hmac-sha256:" + "a".repeat(64),
  amountAtRiskMinor: 20_000,
  currency: "USD",
};

const row = (event_sequence: number | bigint) => ({
  event_sequence,
  boundary_id: "SYNTHETIC-ordering",
  result: [signal],
});

describe("candidate correction ordering integrity", () => {
  it("accepts exact bigint sequence values within the safe range", () => {
    const observations = observationsFromRows([row(1n), row(BigInt(Number.MAX_SAFE_INTEGER))]);
    expect(observations.map((r) => r.observed.eventSequence)).toEqual([1, Number.MAX_SAFE_INTEGER]);
  });

  it("refuses bigint values that would round to the same JS number", () => {
    expect(() => observationsFromRows([row(BigInt(Number.MAX_SAFE_INTEGER) + 1n)])).toThrow(/cannot be ordered safely/);
    expect(() => observationsFromRows([row(BigInt(Number.MAX_SAFE_INTEGER) + 2n)])).toThrow(/cannot be ordered safely/);
  });

  it("refuses fractional, zero, negative, and non-finite sequences", () => {
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity, 0n, -1n]) {
      expect(() => observationsFromRows([row(invalid)])).toThrow(/cannot be ordered safely/);
    }
  });

  it("does not invent an observation from a malformed task result", () => {
    expect(observationsFromRows([{ event_sequence: 1n, boundary_id: "SYNTHETIC-ordering", result: null }])).toEqual([]);
  });
});

// ── THE TIE · found while reviewing adb6a24/c3b11b0/488c294, and it is in MY file ───────────────────
//
// The guard those commits added validates each sequence VALUE and is correct. It does not cover a tie,
// because each tied value is individually safe. One task result may carry several signals and they all
// inherit that event's sequence, so two observations of ONE identity can share it — and the reported
// DIRECTION of the monetary correction then followed their position in the array.
describe("a tie in the append sequence is a refusal, not a choice", () => {
  const ref = `hmac-sha256:${"1".repeat(64)}`;
  const sig = (amountAtRiskMinor: number) => ({
    recoveryType: "RevenueUnderBilled",
    sourceRef: `hmac-sha256:${"a".repeat(64)}`,
    amountAtRiskMinor,
    currency: "USD",
    obligationCoverage: { kind: "SINGLE_OBLIGATION", obligationRef: ref },
  });
  const tied = (amounts: readonly number[]) => summariseCorrections(observationsFromRows([
    { event_sequence: 7n, boundary_id: "SYNTHETIC-tie", result: amounts.map(sig) },
  ]));

  it("reports ORDER_NOT_ESTABLISHABLE with every monetary field null, never zero", () => {
    const r = tied([60_000, 80_000]).records[0]!;
    expect(r.state).toBe("ORDER_NOT_ESTABLISHABLE");
    expect(r.orderCertain).toBe(false);
    expect(r.storedMinor).toBeNull();
    expect(r.latestObservedMinor).toBeNull();
    expect(r.deltaMinor).toBeNull();
    expect(r.direction).toBeNull();
    expect(r.undecidedMagnitudeMinor).toBeNull();
    // Every amount is still reported: the uncertainty is about ORDER, not about what was observed.
    expect(r.observedAmountsMinor).toEqual([60_000, 80_000]);
    expect(r.observationCount).toBe(2);
  });

  it("THE REGRESSION ITSELF · reversing the array no longer changes the answer", () => {
    // Before the fix: [60000, 80000] read UPWARD and [80000, 60000] read DOWNWARD, for the same facts.
    const forward = tied([60_000, 80_000]).records[0]!;
    const reverse = tied([80_000, 60_000]).records[0]!;
    expect(reverse.state).toBe(forward.state);
    expect(reverse.direction).toBe(forward.direction);
    expect(reverse.storedMinor).toBe(forward.storedMinor);
    // Byte-identical, which is the strongest form: nothing about the report depends on input position.
    expect(JSON.stringify(reverse)).toBe(JSON.stringify(forward));
  });

  it("a tied identity is counted apart and enters NEITHER monetary sum", () => {
    const report = tied([60_000, 80_000]);
    expect(report.totals.orderNotEstablishable).toBe(1);
    expect(report.totals.withCorrections).toBe(0);
    expect(report.totals.upwardUndecidedMinor).toBe(0);
    expect(report.totals.downwardUndecidedMinor).toBe(0);
  });

  it("distinct sequences in the same row are impossible, so a real correction still reports normally", () => {
    // The control: two EVENTS, two sequences. Order is establishable and the direction is reported.
    const r = summariseCorrections(observationsFromRows([
      { event_sequence: 1n, boundary_id: "SYNTHETIC-tie", result: [sig(60_000)] },
      { event_sequence: 2n, boundary_id: "SYNTHETIC-tie", result: [sig(80_000)] },
    ])).records[0]!;
    expect(r.state).toBe("CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED");
    expect(r.orderCertain).toBe(true);
    expect(r.direction).toBe("UPWARD");
    expect(r.undecidedMagnitudeMinor).toBe(20_000);
  });

  it("an identical replay in one row is still a replay, not an order problem", () => {
    // Equal amounts need no order to be understood, so the tie does not matter and must not escalate.
    const r = tied([30_000, 30_000]).records[0]!;
    expect(r.state).toBe("REPEATED_IDENTICAL_OBSERVATION");
    expect(r.deltaMinor).toBe(0);
  });
});
