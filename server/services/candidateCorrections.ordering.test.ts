import { describe, expect, it } from "vitest";
import { observationsFromRows } from "./candidateCorrections";

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
