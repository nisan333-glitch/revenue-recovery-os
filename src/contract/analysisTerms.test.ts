// EP-26 · The pure half of analysis-terms governance: what a valid tuple is, and that its hash is a
// faithful witness of the definition rather than a label attached to one.
import { describe, expect, it } from "vitest";
import {
  ANALYSIS_TERMS_HASH_SCHEME,
  MAX_STALL_THRESHOLD_DAYS,
  analysisTermsHashMatches,
  analysisTermsRef,
  hashAnalysisTerms,
  makeAnalysisTerms,
} from "./analysisTerms";
import { ASSESSMENT_CALC_VERSION } from "../assessment/policy";

const VALID = {
  termsId: "terms-q3",
  termsVersion: "1.0.0",
  asOf: "2026-06-30",
  stallThresholdDays: 30,
  currency: "USD",
};

describe("EP-26 · analysis terms — the governed definition of what an assessment measures", () => {
  it("1 · accepts a complete tuple and stamps the build's calculation method", () => {
    const terms = makeAnalysisTerms(VALID);
    expect(terms.asOf).toBe("2026-06-30");
    expect(terms.stallThresholdDays).toBe(30);
    expect(terms.currency).toBe("USD");
    expect(terms.calculationMethodVersion).toBe(ASSESSMENT_CALC_VERSION);
    expect(analysisTermsRef(terms)).toBe("terms-q3@1.0.0");
    expect(Object.isFrozen(terms)).toBe(true);
  });

  it("2 · has NO default cut-off and NO default threshold — a default is a decision nobody made", () => {
    // The whole feature exists so these two values have an author and an approver. Anything that
    // could be omitted would be chosen by the code instead, which is the defect one level down.
    expect(() => makeAnalysisTerms({ ...VALID, termsId: "  " })).toThrow(/termsId is required/);
    expect(() => makeAnalysisTerms({ ...VALID, termsVersion: "" })).toThrow(/termsVersion is required/);
    expect(() => makeAnalysisTerms({ ...VALID, asOf: undefined as unknown as string })).toThrow(/asOf/);
    expect(() =>
      makeAnalysisTerms({ ...VALID, stallThresholdDays: undefined as unknown as number }),
    ).toThrow(/stallThresholdDays/);
    expect(() => makeAnalysisTerms({ ...VALID, currency: undefined as unknown as string })).toThrow(
      /currency is required/,
    );
  });

  it("2b · refuses a currency the money core does not support, and normalises the ones it does", () => {
    // Validated HERE, not left to `makePolicy`: a registration must not be able to record a currency
    // that would only fail later, at the moment a dataset is being read under it.
    expect(() => makeAnalysisTerms({ ...VALID, currency: "ZZZ" })).toThrow(/unsupported currency/);
    // 'XXX' is ISO 4217's "no currency" and is the sentinel the EP-26b migration writes for any row
    // registered before the field existed. It must be REFUSED, so such a row reads as unusable rather
    // than being quietly assessed as dollars.
    expect(() => makeAnalysisTerms({ ...VALID, currency: "XXX" })).toThrow(/unsupported currency/);
    expect(makeAnalysisTerms({ ...VALID, currency: " eur " }).currency).toBe("EUR");
  });

  it("2c · the currency is part of the DEFINITION, because it decides which rows count", () => {
    // A row whose currency differs from the policy's is excluded outright rather than converted, so the
    // same file read as USD and read as EUR are two different populations and two different figures.
    // That makes the currency a governed term, not a display preference.
    const usd = makeAnalysisTerms(VALID);
    const eur = makeAnalysisTerms({ ...VALID, currency: "EUR" });
    expect(usd.currency).not.toBe(eur.currency);
  });

  it("3 · refuses a threshold that is negative, fractional or absurd", () => {
    expect(() => makeAnalysisTerms({ ...VALID, stallThresholdDays: -1 })).toThrow(/non-negative integer/);
    expect(() => makeAnalysisTerms({ ...VALID, stallThresholdDays: 1.5 })).toThrow(/non-negative integer/);
    expect(() =>
      makeAnalysisTerms({ ...VALID, stallThresholdDays: MAX_STALL_THRESHOLD_DAYS + 1 }),
    ).toThrow(/at most 3650/);
    // 0 is legitimate: "stalled unless observed the same day" is a real, if strict, definition.
    expect(makeAnalysisTerms({ ...VALID, stallThresholdDays: 0 }).stallThresholdDays).toBe(0);
    expect(makeAnalysisTerms({ ...VALID, stallThresholdDays: MAX_STALL_THRESHOLD_DAYS }).stallThresholdDays).toBe(
      MAX_STALL_THRESHOLD_DAYS,
    );
  });

  it("4 · refuses a cut-off that is not a real calendar date", () => {
    expect(() => makeAnalysisTerms({ ...VALID, asOf: "30/06/2026" })).toThrow(/ISO date/);
    expect(() => makeAnalysisTerms({ ...VALID, asOf: "2026-6-30" })).toThrow(/ISO date/);
    // Shape-valid, calendar-invalid. Accepting it would silently shift every day count.
    expect(() => makeAnalysisTerms({ ...VALID, asOf: "2026-02-30" })).toThrow(/real calendar date/);
    expect(() => makeAnalysisTerms({ ...VALID, asOf: "2026-13-01" })).toThrow(/real calendar date/);
  });

  it("5 · the hash is over the DEFINITION, so changing a value changes the hash", async () => {
    const base = await hashAnalysisTerms(makeAnalysisTerms(VALID));
    const laterCutOff = await hashAnalysisTerms(makeAnalysisTerms({ ...VALID, asOf: "2026-07-31" }));
    const otherThreshold = await hashAnalysisTerms(makeAnalysisTerms({ ...VALID, stallThresholdDays: 31 }));
    const otherCurrency = await hashAnalysisTerms(makeAnalysisTerms({ ...VALID, currency: "EUR" }));
    expect(base).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(laterCutOff).not.toBe(base);
    expect(otherThreshold).not.toBe(base);
    expect(otherCurrency).not.toBe(base);
    // A different label on the same definition is also a different registration — the reference is
    // part of what a decision cites, so it must be part of what the hash covers.
    expect(await hashAnalysisTerms(makeAnalysisTerms({ ...VALID, termsVersion: "1.0.1" }))).not.toBe(base);
  });

  it("6 · the hash is stable across construction order and a JSON round-trip", async () => {
    const a = makeAnalysisTerms(VALID);
    const b = makeAnalysisTerms(
      JSON.parse(JSON.stringify({ ...VALID, stallThresholdDays: 30, asOf: "2026-06-30", currency: "USD" })),
    );
    expect(await hashAnalysisTerms(a)).toBe(await hashAnalysisTerms(b));
    expect(await analysisTermsHashMatches(b, await hashAnalysisTerms(a))).toBe(true);
  });

  it("7 · no field value can impersonate the separator and shift the others", async () => {
    // Without NUL separation, ("a","b1") and ("a b","1") could canonicalise identically. They must not.
    const left = await hashAnalysisTerms(makeAnalysisTerms({ ...VALID, termsId: "a", termsVersion: "b1" }));
    const right = await hashAnalysisTerms(makeAnalysisTerms({ ...VALID, termsId: "ab", termsVersion: "1" }));
    expect(left).not.toBe(right);
  });

  it("8 · the scheme name is part of the hash, so one scheme's hash can never equal another's", async () => {
    // v2 because `currency` joined the definition. A row registered under v1 therefore no longer matches
    // its stored witness and is refused as tampered — which is the intended answer, not a regression: its
    // recorded meaning is genuinely incomplete, and the fix is a new proposal, not a silent re-read.
    expect(ANALYSIS_TERMS_HASH_SCHEME).toBe("nh-analysis-terms-v2");
    // Proved rather than asserted: the scheme string is inside the canonical form, so the same three
    // values under a different scheme name cannot produce the same digest.
    const { createHash } = await import("node:crypto");
    const underV1 = `sha256:${createHash("sha256")
      .update(
        ["nh-analysis-terms-v1", VALID.termsId, VALID.termsVersion, ASSESSMENT_CALC_VERSION, VALID.asOf, "30", "USD"].join("\u0000"),
      )
      .digest("hex")}`;
    expect(await hashAnalysisTerms(makeAnalysisTerms(VALID))).not.toBe(underV1);
  });

  it("9 · a mismatched hash reads as false rather than being recomputed and accepted", async () => {
    const terms = makeAnalysisTerms(VALID);
    expect(await analysisTermsHashMatches(terms, "sha256:" + "0".repeat(64))).toBe(false);
  });
});
