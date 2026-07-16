import { describe, it, expect } from "vitest";
import { normalizeAmount } from "./amountNormalize";
import { fromDecimal } from "../domain/money";
import { assessCsv } from "./assess";
import { makePolicy } from "./policy";

const ok = (r: ReturnType<typeof normalizeAmount>): string => {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}: ${r.detail}`);
  return r.decimal;
};

describe("normalizeAmount — self-disambiguating cases (no format needed)", () => {
  it("passes a plain decimal through unchanged", () => {
    expect(ok(normalizeAmount("1200.00"))).toBe("1200.00");
    expect(ok(normalizeAmount("0"))).toBe("0");
  });
  it("strips a currency symbol", () => {
    expect(ok(normalizeAmount("$1200.00"))).toBe("1200.00");
    expect(ok(normalizeAmount("€99.90"))).toBe("99.90");
    expect(ok(normalizeAmount("₪1500"))).toBe("1500");
  });
  it("strips an ISO code prefix/suffix", () => {
    expect(ok(normalizeAmount("USD 1200.00"))).toBe("1200.00");
    expect(ok(normalizeAmount("1200.00 USD"))).toBe("1200.00");
  });
  it("resolves both separators by last-occurrence (US and EU)", () => {
    expect(ok(normalizeAmount("1,200.00"))).toBe("1200.00"); // comma=grouping, dot=decimal
    expect(ok(normalizeAmount("1.200,00"))).toBe("1200.00"); // dot=grouping, comma=decimal
    expect(ok(normalizeAmount("$1,234,567.89"))).toBe("1234567.89");
  });
  it("treats a repeated single separator as grouping only", () => {
    expect(ok(normalizeAmount("1.200.000"))).toBe("1200000");
    expect(ok(normalizeAmount("1,200,000"))).toBe("1200000");
  });
  it("treats a single separator with a non-3-digit tail as the decimal separator", () => {
    expect(ok(normalizeAmount("12,5"))).toBe("12.5");
    expect(ok(normalizeAmount("99,90"))).toBe("99.90");
    expect(ok(normalizeAmount("1.5"))).toBe("1.5");
  });
  it("reads accounting parentheses as a negative", () => {
    expect(ok(normalizeAmount("(1,200.00)"))).toBe("-1200.00");
    expect(ok(normalizeAmount("($99.90)"))).toBe("-99.90");
  });
  it("drops grouping whitespace incl. NBSP / narrow NBSP", () => {
    expect(ok(normalizeAmount("1 200,00", { format: "EU" }))).toBe("1200.00"); // ascii space grouping
    expect(ok(normalizeAmount("1 200,50"))).toBe("1200.50"); // NBSP grouping, comma decimal (tail=2)
    expect(ok(normalizeAmount("1 200.75"))).toBe("1200.75"); // narrow NBSP grouping
  });
});

describe("normalizeAmount — genuine ambiguity fails closed", () => {
  it("rejects a single separator with a 3-digit tail when no format is given", () => {
    expect(normalizeAmount("1,200")).toMatchObject({ ok: false, reason: "ambiguous_amount" });
    expect(normalizeAmount("1.200")).toMatchObject({ ok: false, reason: "ambiguous_amount" });
  });
  it("resolves the ambiguous case with an explicit format", () => {
    expect(ok(normalizeAmount("1,200", { format: "US" }))).toBe("1200"); // comma=grouping
    expect(ok(normalizeAmount("1,200", { format: "EU" }))).toBe("1.200"); // comma=decimal
    expect(ok(normalizeAmount("1.200", { format: "US" }))).toBe("1.200"); // dot=decimal
    expect(ok(normalizeAmount("1.200", { format: "EU" }))).toBe("1200"); // dot=grouping
  });
  it("rejects non-numeric junk", () => {
    expect(normalizeAmount("abc")).toMatchObject({ ok: false, reason: "invalid_amount" });
    expect(normalizeAmount("")).toMatchObject({ ok: false, reason: "invalid_amount" });
  });
});

describe("normalizeAmount → fromDecimal still enforces currency precision (no rounding)", () => {
  it("a normalized decimal with too many fraction digits is rejected downstream", () => {
    const r = normalizeAmount("1.234"); // dot, 3-digit tail → ambiguous
    expect(r.ok).toBe(false);
    // But an unambiguous over-precise value (4 frac digits) normalizes, then fromDecimal refuses to round.
    const r2 = normalizeAmount("1.2345");
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(() => fromDecimal(r2.decimal, "USD")).toThrow(/minor-unit precision/i);
  });
});

// --- End-to-end: a real-looking export with $ + thousands separators now runs -----------------------
describe("assessCsv accepts formatted amounts", () => {
  const policy = () => makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" });
  const FORMATTED =
    "entity_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency\n" +
    'E1,2026-01-01,,2026-02-01,"$10,000.00",USD';

  it("does not exclude a $-and-comma amount row (exclusions not inflated)", async () => {
    const r = await assessCsv(FORMATTED, policy(), { createdAt: "2026-03-02T00:00:00.000Z" });
    expect(r.acceptedCycleCount).toBe(1);
    expect(r.excludedRowCount).toBe(0);
    expect(r.observed.observedUnpaid.minor).toBe(10000_00);
  });

  it("a different amountFormat is a different assessment (folded into assessmentId)", async () => {
    const AMBIG =
      "entity_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency\n" +
      "E1,2026-01-01,,2026-02-01,1.200,USD"; // ambiguous "1.200" → needs a format
    const us = await assessCsv(AMBIG, policy(), { createdAt: "2026-03-02T00:00:00.000Z", amountFormat: "US" });
    const eu = await assessCsv(AMBIG, policy(), { createdAt: "2026-03-02T00:00:00.000Z", amountFormat: "EU" });
    // EU: dot = grouping → $1,200.00 (accepted). US: dot = decimal → 1.200 = 3 dp, which fromDecimal
    // refuses for USD (2 dp) → the row is EXCLUDED. Same bytes, different interpretation, different result.
    expect(eu.observed.observedUnpaid.minor).toBe(1200_00);
    expect(eu.acceptedCycleCount).toBe(1);
    expect(us.acceptedCycleCount).toBe(0); // precision guard still holds — no silent rounding
    expect(us.assessmentId).not.toBe(eu.assessmentId);
    expect(eu.amountFormat).toBe("EU");
  });

  it("rejects an ambiguous amount when no format is chosen (excluded, not silently guessed)", async () => {
    const AMBIG =
      "entity_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency\n" +
      "E1,2026-01-01,,2026-02-01,1.200,USD";
    const r = await assessCsv(AMBIG, policy(), { createdAt: "2026-03-02T00:00:00.000Z" });
    expect(r.acceptedCycleCount).toBe(0);
    expect(r.exclusions[0]!.reason).toBe("ambiguous_amount");
  });
});
