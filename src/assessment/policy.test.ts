import { describe, it, expect } from "vitest";
import { makePolicy } from "./policy";

const base = { stallThresholdDays: 30, asOf: "2026-03-01" };

describe("makePolicy — currency validation (before any formatting logic)", () => {
  it("accepts supported ISO-4217 codes", () => {
    for (const c of ["USD", "EUR", "GBP", "ILS", "JPY"]) {
      expect(makePolicy({ ...base, currency: c }).currency).toBe(c);
    }
  });

  it("normalizes case and whitespace", () => {
    expect(makePolicy({ ...base, currency: " usd " }).currency).toBe("USD");
  });

  it("rejects unsupported or malformed currency codes (never reaches formatting)", () => {
    expect(() => makePolicy({ ...base, currency: "US" })).toThrow(/unsupported currency/i);
    expect(() => makePolicy({ ...base, currency: "XXX" })).toThrow(/unsupported currency/i);
    expect(() => makePolicy({ ...base, currency: "😀" })).toThrow(/unsupported currency/i);
    expect(() => makePolicy({ ...base, currency: "" })).toThrow(/currency is required/i);
  });

  it("still validates N and asOf", () => {
    expect(() => makePolicy({ stallThresholdDays: -1, asOf: "2026-03-01", currency: "USD" })).toThrow(/stallThresholdDays/);
    expect(() => makePolicy({ stallThresholdDays: 30, asOf: "03/01/2026", currency: "USD" })).toThrow(/asOf/);
  });
});
