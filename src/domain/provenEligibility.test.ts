import { describe, expect, it } from "vitest";
import {
  provenEligibility, unprovenHeadline,
  type ObligationCoverage, type ProvenIneligibilityCode,
} from "./provenEligibility";

const single = (over: Partial<Extract<ObligationCoverage, { kind: "SINGLE_OBLIGATION" }>> = {}): ObligationCoverage =>
  Object.freeze({
    kind: "SINGLE_OBLIGATION" as const,
    obligationRef: "hmac-sha256:" + "a".repeat(64),
    expectedMinor: 120_000, billedMinor: 75_000, residualMinor: 45_000, currency: "USD",
    ...over,
  });

const CHECKED_CLEAN = { checked: true as const, count: 0 };

const code = (x: ReturnType<typeof provenEligibility>): ProvenIneligibilityCode | "ELIGIBLE" =>
  x.eligible ? "ELIGIBLE" : x.code;

describe("PROVEN eligibility · the approved rule", () => {
  it("a single obligation with all four facts and a checked, clean absorption is eligible", () => {
    const r = provenEligibility({ coverage: single(), absorbedObservations: CHECKED_CLEAN });
    expect(r.eligible).toBe(true);
    if (r.eligible) {
      expect(r.residualMinor).toBe(45_000);
      expect(r.obligationRef).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    }
    // THE POSITIVE BRANCH MUST BE REACHABLE. A gate that can only refuse is an off-switch, and an
    // off-switch cannot be distinguished from a gate that is wired to the wrong input.
    expect(unprovenHeadline(r)).toBeNull();
  });

  // ── THE RULE ITSELF ────────────────────────────────────────────────────────────────────────────────
  it("an ACCOUNT-LEVEL AGGREGATE is refused — this is the approved rule, stated in one assertion", () => {
    const r = provenEligibility({
      coverage: { kind: "ACCOUNT_AGGREGATE", unitCount: 2 },
      absorbedObservations: CHECKED_CLEAN,
    });
    expect(code(r)).toBe("OBLIGATION_COVERAGE_IS_AGGREGATE");
    expect(r.eligible).toBe(false);
    if (!r.eligible) {
      expect(r.reason).toContain("2 reconciliation units");
      expect(r.reason).toContain("PROVEN may not be assigned at account level");
    }
  });

  it("an aggregate of ONE unit is still an aggregate — the kind decides, never the count", () => {
    // A tempting shortcut is "unitCount === 1 is really a single obligation". It is not: the AGGREGATE
    // shape carries none of the four facts, so nothing traceable identifies that one unit. Reading the
    // count as the answer would mint a proof from a figure with no obligation reference behind it.
    const r = provenEligibility({
      coverage: { kind: "ACCOUNT_AGGREGATE", unitCount: 1 },
      absorbedObservations: CHECKED_CLEAN,
    });
    expect(code(r)).toBe("OBLIGATION_COVERAGE_IS_AGGREGATE");
  });

  // ── FAIL CLOSED ───────────────────────────────────────────────────────────────────────────────────
  it("no stated coverage refuses — silence is never read as a single obligation", () => {
    const r = provenEligibility({ coverage: null, absorbedObservations: CHECKED_CLEAN });
    expect(code(r)).toBe("OBLIGATION_COVERAGE_NOT_STATED");
  });

  it("an UNCHECKED absorption refuses, because not checked is not none", () => {
    const r = provenEligibility({ coverage: single(), absorbedObservations: { checked: false } });
    expect(code(r)).toBe("ABSORPTION_NOT_CHECKED");
  });

  it("a RECORDED absorption refuses even a perfect single-obligation claim", () => {
    const r = provenEligibility({
      coverage: single(), absorbedObservations: { checked: true, count: 1 },
    });
    expect(code(r)).toBe("ABSORBED_OBSERVATION_RECORDED");
    if (!r.eligible) expect(r.reason).toContain("folded into it");
  });

  // ── THE FOUR FACTS, EACH ON ITS OWN ───────────────────────────────────────────────────────────────
  it.each([
    ["obligation reference", { obligationRef: "" }],
    ["currency", { currency: "" }],
    ["expected amount", { expectedMinor: Number.NaN }],
    ["billed amount", { billedMinor: 1.5 }],
    ["discrepancy", { residualMinor: Number.POSITIVE_INFINITY }],
  ])("a missing or non-integral %s refuses as INCOMPLETE", (_label, over) => {
    const r = provenEligibility({
      coverage: single(over as never), absorbedObservations: CHECKED_CLEAN,
    });
    expect(code(r)).toBe("OBLIGATION_FACTS_INCOMPLETE");
  });

  it("the discrepancy is DERIVED, so a stamped figure that does not reconcile refuses", () => {
    const r = provenEligibility({
      coverage: single({ residualMinor: 44_999 }), absorbedObservations: CHECKED_CLEAN,
    });
    expect(code(r)).toBe("OBLIGATION_FACTS_INCONSISTENT");
    if (!r.eligible) expect(r.reason).toContain("does not equal expected");
  });

  it("a NEGATIVE discrepancy is self-consistent and is not this gate's business", () => {
    // Over-billing is a liability signal, never exposure. This predicate decides IDENTITY, and refusing
    // here would silently make it a second monetary rule in the wrong place.
    const r = provenEligibility({
      coverage: single({ expectedMinor: 50_000, billedMinor: 70_000, residualMinor: -20_000 }),
      absorbedObservations: CHECKED_CLEAN,
    });
    expect(r.eligible).toBe(true);
  });

  it("a ZERO discrepancy is self-consistent and eligible — zero is a figure, not a refusal", () => {
    const r = provenEligibility({
      coverage: single({ expectedMinor: 50_000, billedMinor: 50_000, residualMinor: 0 }),
      absorbedObservations: CHECKED_CLEAN,
    });
    expect(r.eligible).toBe(true);
  });

  // ── THE REFUSAL IS LEGIBLE AND CARRIES NO CUSTOMER VALUE ──────────────────────────────────────────
  it("every refusal has a distinct code and a non-empty reason", () => {
    const refusals = [
      provenEligibility({ coverage: null, absorbedObservations: CHECKED_CLEAN }),
      provenEligibility({ coverage: { kind: "ACCOUNT_AGGREGATE", unitCount: 3 }, absorbedObservations: CHECKED_CLEAN }),
      provenEligibility({ coverage: single({ obligationRef: "" }), absorbedObservations: CHECKED_CLEAN }),
      provenEligibility({ coverage: single({ residualMinor: 1 }), absorbedObservations: CHECKED_CLEAN }),
      provenEligibility({ coverage: single(), absorbedObservations: { checked: false } }),
      provenEligibility({ coverage: single(), absorbedObservations: { checked: true, count: 2 } }),
    ];
    const codes = refusals.map(code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const r of refusals) {
      expect(r.eligible).toBe(false);
      if (!r.eligible) {
        expect(r.reason.trim().length).toBeGreaterThan(20);
        expect(unprovenHeadline(r)).toContain("NOT PROVEN");
        expect(unprovenHeadline(r)).toContain(r.code);
      }
    }
  });

  it("no refusal reason contains a monetary symbol — a refusal is not a figure", () => {
    const r = provenEligibility({ coverage: null, absorbedObservations: { checked: false } });
    expect(unprovenHeadline(r)).not.toMatch(/\$|0\.00/);
  });

  // ── PURITY ────────────────────────────────────────────────────────────────────────────────────────
  it("is pure: the same input gives the same answer and the input is not mutated", () => {
    const input = { coverage: single(), absorbedObservations: CHECKED_CLEAN };
    const a = provenEligibility(input);
    const b = provenEligibility(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(input.coverage).toEqual(single());
  });

  it("the module imports nothing that can act", () => {
    // A structural guard reading IMPORT SPECIFIERS, not prose: this repository has recorded twelve
    // instances of a guard matching a term instead of the construct it asks about.
    const src = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "provenEligibility.ts"), "utf8",
    ) as string;
    const specifiers = [...src.matchAll(/^\s*(?:import|export)[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]!);
    expect(specifiers).toEqual(["./caseIdentityGrain"]);
  });
});

describe("AT_RISK_CONTRADICTS_COVERAGE · the detector must agree with itself", () => {
  const single = {
    kind: "SINGLE_OBLIGATION" as const,
    obligationRef: `hmac-sha256:${"a".repeat(64)}`,
    expectedMinor: 160_000,
    billedMinor: 100_000,
    residualMinor: 60_000,
    currency: "USD",
  };
  const checked = { checked: true as const, count: 0 };

  it("refuses when the stated at-risk figure differs from the declared discrepancy", () => {
    const v = provenEligibility({ coverage: single, absorbedObservations: checked, statedAtRiskMinor: 59_999 });
    expect(v.eligible).toBe(false);
    expect(!v.eligible && v.code).toBe("AT_RISK_CONTRADICTS_COVERAGE");
    expect(!v.eligible && v.reason).toContain("59999");
    expect(!v.eligible && v.reason).toContain("60000");
    // The refusal is about the MONEY, and says so: the finding itself stays reportable.
    expect(!v.eligible && v.reason).toContain("exposure itself remains reportable");
  });

  it("accepts when they agree", () => {
    expect(provenEligibility({ coverage: single, absorbedObservations: checked, statedAtRiskMinor: 60_000 }).eligible).toBe(true);
  });

  it("NULL IS NOT AGREEMENT, and is not refused on this ground either", () => {
    // A signal with no at-risk figure cannot contradict its coverage. The two states stay distinguishable:
    // absent is not "equal", and treating it as a default would decide the question by omission.
    for (const statedAtRiskMinor of [null, undefined]) {
      expect(provenEligibility({ coverage: single, absorbedObservations: checked, statedAtRiskMinor }).eligible).toBe(true);
    }
  });

  it("a more fundamental refusal still wins — the contradiction is checked last but one", () => {
    // An aggregate with a contradicting at-risk figure reports the aggregate, which is what the caller can
    // act on. Ordering most-informative-first is the rule this module already follows.
    const v = provenEligibility({
      coverage: { kind: "ACCOUNT_AGGREGATE", unitCount: 3 },
      absorbedObservations: checked,
      statedAtRiskMinor: 1,
    });
    expect(!v.eligible && v.code).toBe("OBLIGATION_COVERAGE_IS_AGGREGATE");
  });

  it("an ABSORBED observation outranks it, because a merged claim is not about one obligation at all", () => {
    const v = provenEligibility({
      coverage: single,
      absorbedObservations: { checked: true, count: 1 },
      statedAtRiskMinor: 60_000,
    });
    expect(!v.eligible && v.code).toBe("ABSORBED_OBSERVATION_RECORDED");
  });
});
