// The single explicit decimal→minor conversion boundary (transition rule #2). These tests are the
// contract: any silent float→minor coercion, or acceptance of ambiguous precision, is a defect.
import { describe, it, expect } from "vitest";
import { fromDecimal, minorUnitDigits, formatMoney, isSupportedCurrency, SUPPORTED_CURRENCIES } from "./money";

const USD = "USD";
const JPY = "JPY";

describe("fromDecimal — the one governed decimal→minor boundary", () => {
  it("converts plain decimal strings to exact minor units", () => {
    expect(fromDecimal("79800.00", USD).minor).toBe(7_980_000);
    expect(fromDecimal("79800", USD).minor).toBe(7_980_000);
    expect(fromDecimal("0.01", USD).minor).toBe(1);
    expect(fromDecimal("1234.5", USD).minor).toBe(123_450);
    expect(fromDecimal("-42.50", USD).minor).toBe(-4_250);
    expect(fromDecimal("0", USD).minor).toBe(0);
  });

  it("does NOT use float arithmetic — classically-lossy values stay exact", () => {
    // 0.1 + 0.2 !== 0.3 in float; string composition makes this exact.
    expect(fromDecimal("0.30", USD).minor).toBe(30);
    expect(fromDecimal("70.07", USD).minor).toBe(7_007);
    expect(fromDecimal("1.10", USD).minor).toBe(110);
  });

  it("rejects MORE fractional digits than the currency supports (no silent rounding)", () => {
    expect(() => fromDecimal("1.234", USD)).toThrow(/exceed|precision/);
    expect(() => fromDecimal("1.005", USD)).toThrow(/exceed|precision/);
    // JPY has zero minor-unit digits: any fraction is refused.
    expect(minorUnitDigits(JPY)).toBe(0);
    expect(fromDecimal("500", JPY).minor).toBe(500);
    expect(() => fromDecimal("500.5", JPY)).toThrow(/exceed|precision/);
  });

  it("rejects ambiguous / non-decimal representations rather than coercing", () => {
    expect(() => fromDecimal("abc", USD)).toThrow();
    expect(() => fromDecimal("1,234.00", USD)).toThrow(); // thousands separators are ambiguous
    expect(() => fromDecimal("$5", USD)).toThrow();
    expect(() => fromDecimal("", USD)).toThrow();
    expect(() => fromDecimal(Number.NaN, USD)).toThrow(/non-finite/);
    expect(() => fromDecimal(Number.POSITIVE_INFINITY, USD)).toThrow(/non-finite/);
    expect(() => fromDecimal(1e21, USD)).toThrow(/exponential|ambiguous/);
  });

  it("tolerates a number input but re-validates it through the same exact path", () => {
    expect(fromDecimal(79800, USD).minor).toBe(7_980_000);
    expect(fromDecimal(42.5, USD).minor).toBe(4_250);
    // A number carrying more precision than the currency allows is refused, not rounded.
    expect(() => fromDecimal(1.234, USD)).toThrow(/exceed|precision/);
  });

  it("requires an explicit currency", () => {
    expect(() => fromDecimal("1.00", "")).toThrow(/currency/);
  });
});

describe("formatMoney safety + supported currencies", () => {
  it("formats supported currencies", () => {
    expect(formatMoney({ minor: 1000, currency: "USD" })).toBe("$10");
    expect(formatMoney({ minor: 1000, currency: "USD" }, { exact: true })).toBe("$10.00");
  });
  it("NEVER throws on an unsupported/invalid ISO code (final render containment)", () => {
    expect(() => formatMoney({ minor: 1000, currency: "ZZ" })).not.toThrow();
    expect(() => formatMoney({ minor: 1000, currency: "not-a-code" })).not.toThrow();
    expect(formatMoney({ minor: 1000, currency: "ZZ" })).toContain("ZZ");
  });
  it("isSupportedCurrency / SUPPORTED_CURRENCIES", () => {
    expect(isSupportedCurrency("USD")).toBe(true);
    expect(isSupportedCurrency("ZZ")).toBe(false);
    expect(SUPPORTED_CURRENCIES).toContain("USD");
  });
});
