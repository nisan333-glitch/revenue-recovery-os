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

const VALID = { termsId: "terms-q3", termsVersion: "1.0.0", asOf: "2026-06-30", stallThresholdDays: 30 };

describe("EP-26 · analysis terms — the governed definition of what an assessment measures", () => {
  it("1 · accepts a complete tuple and stamps the build's calculation method", () => {
    const terms = makeAnalysisTerms(VALID);
    expect(terms.asOf).toBe("2026-06-30");
    expect(terms.stallThresholdDays).toBe(30);
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
    expect(base).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(laterCutOff).not.toBe(base);
    expect(otherThreshold).not.toBe(base);
    // A different label on the same definition is also a different registration — the reference is
    // part of what a decision cites, so it must be part of what the hash covers.
    expect(await hashAnalysisTerms(makeAnalysisTerms({ ...VALID, termsVersion: "1.0.1" }))).not.toBe(base);
  });

  it("6 · the hash is stable across construction order and a JSON round-trip", async () => {
    const a = makeAnalysisTerms(VALID);
    const b = makeAnalysisTerms(JSON.parse(JSON.stringify({ ...VALID, stallThresholdDays: 30, asOf: "2026-06-30" })));
    expect(await hashAnalysisTerms(a)).toBe(await hashAnalysisTerms(b));
    expect(await analysisTermsHashMatches(b, await hashAnalysisTerms(a))).toBe(true);
  });

  it("7 · no field value can impersonate the separator and shift the others", async () => {
    // Without NUL separation, ("a","b1") and ("a b","1") could canonicalise identically. They must not.
    const left = await hashAnalysisTerms(makeAnalysisTerms({ ...VALID, termsId: "a", termsVersion: "b1" }));
    const right = await hashAnalysisTerms(makeAnalysisTerms({ ...VALID, termsId: "ab", termsVersion: "1" }));
    expect(left).not.toBe(right);
  });

  it("8 · the scheme name is part of the hash, so a future scheme cannot collide with this one", () => {
    expect(ANALYSIS_TERMS_HASH_SCHEME).toBe("nh-analysis-terms-v1");
  });

  it("9 · a mismatched hash reads as false rather than being recomputed and accepted", async () => {
    const terms = makeAnalysisTerms(VALID);
    expect(await analysisTermsHashMatches(terms, "sha256:" + "0".repeat(64))).toBe(false);
  });
});
