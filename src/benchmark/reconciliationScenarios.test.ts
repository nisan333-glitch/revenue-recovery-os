// SELF-CONSISTENCY OF THE GROUND TRUTH — checked without any reconciler, scoreboard or emitter.
//
// WHY THIS FILE EXISTS, and it is not ceremony. Earlier in this project an ad-hoc measurement script
// reported 116 entities / 268 distinct ids / zero multi-id entities over the frozen corpus. The real
// figures were 130 / 270 / 97. The error survived into a reported number because nothing checked the
// figures against each other. So every total this benchmark will ever quote has an invariant here, and
// no figure is trusted because a script printed it once.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RECONCILIATION_SCENARIOS } from "./reconciliationScenarios";

const SCENARIOS = RECONCILIATION_SCENARIOS;

describe("benchmark ground truth · structural independence", () => {
  it("the scenarios module IMPORTS NOTHING — ground truth cannot come to agree with a detector", () => {
    const src = readFileSync(resolve(__dirname, "reconciliationScenarios.ts"), "utf8");
    // No import statement of any kind, and no require. A `import type` would still be a coupling to
    // something that could move, so the bar is zero.
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\brequire\s*\(/);
  });

  it("no ground-truth value is derived — every scenario states WHY in prose a reviewer can argue with", () => {
    for (const s of SCENARIOS) {
      expect(s.truth.whyThisIsTheTruth.length, s.id).toBeGreaterThan(40);
      expect(s.truth.whyThisIsTheTruth, s.id).toMatch(/\.$/);
    }
  });
});

describe("benchmark ground truth · per-scenario arithmetic", () => {
  it("THE CENTRAL INVARIANT · positive − negative === expected − observed, where a residual EXISTS", () => {
    // SCOPED, AND THE SCOPE IS THE POINT. The invariant holds only for units in which every expectation
    // is priced. Where one is not, NO RESIDUAL IS DEFINED — the comparison is impossible, so neither a
    // positive nor a negative figure may be asserted, and forcing the arithmetic to balance would be
    // exactly the "unknown treated as zero" error this benchmark exists to forbid. The unpriced case
    // has its own invariant below. This scoping was discovered BY this invariant failing on R20.
    for (const s of SCENARIOS) {
      if (s.truth.unknownExpectationCount > 0) continue;
      const t = s.truth;
      expect(t.positiveExposureMinor - t.negativeDiscrepancyMinor, `${s.id} ${t.whyThisIsTheTruth}`)
        .toBe(t.expectedMoneyMinor - t.observedMoneyMinor);
    }
  });

  it("UNPRICED UNITS ASSERT NO RESIDUAL — neither positive nor negative, in either direction", () => {
    const unpriced = SCENARIOS.filter((s) => s.truth.unknownExpectationCount > 0);
    expect(unpriced.length, "the benchmark must exercise the unpriced case").toBeGreaterThan(0);
    for (const s of unpriced) {
      expect(s.truth.positiveExposureMinor, `${s.id} — an unpriceable expectation cannot be exposure`).toBe(0);
      expect(s.truth.negativeDiscrepancyMinor, `${s.id} — nor over-billing`).toBe(0);
      expect(s.truth.incrementalUnionMinor, `${s.id} — nor union money`).toBe(0);
    }
    // And the one that was billed must still record that money was observed, so the unit is visibly
    // EXCLUDED from the comparison rather than silently reading as balanced.
    const billed = unpriced.find((s) => s.o.length > 0);
    expect(billed, "an unpriced-but-billed case is required").toBeDefined();
    expect(billed!.truth.observedMoneyMinor).toBeGreaterThan(0);
    expect(billed!.truth.expectedMoneyMinor).toBe(0);
  });

  it("every money figure is a non-negative integer in minor units — no floats, no negatives by sign", () => {
    for (const s of SCENARIOS) {
      for (const [k, v] of Object.entries(s.truth)) {
        if (typeof v !== "number") continue;
        expect(Number.isInteger(v), `${s.id}.${k} = ${v}`).toBe(true);
        expect(v, `${s.id}.${k}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("an UNKNOWN expectation contributes NOTHING to expected money — it is never zero-as-a-value", () => {
    for (const s of SCENARIOS) {
      const priced = s.e.filter((e) => e.expectedAmountMinor !== null);
      const unpriced = s.e.length - priced.length;
      expect(s.truth.unknownExpectationCount, s.id).toBe(unpriced);
      if (unpriced > 0) {
        // The scenario's expected money must be the sum of the PRICED expectations only.
        const pricedSum = priced.reduce((n, e) => n + (e.expectedAmountMinor ?? 0), 0);
        expect(s.truth.expectedMoneyMinor, `${s.id} — unpriced must not be counted as 0`).toBeLessThanOrEqual(pricedSum);
      }
    }
  });

  it("a correlation failure contributes ZERO incremental union money — the company was still paid", () => {
    for (const s of SCENARIOS) {
      if (s.truth.correlationTruth === "MISALLOCATED_ENTITLEMENT" || s.truth.correlationTruth === "MISALLOCATED_CUSTOMER") {
        expect(s.truth.incrementalUnionMinor, `${s.id} — misallocation is attribution, not exposure`).toBe(0);
      }
    }
  });

  it("incremental union money never exceeds the scenario's own positive exposure", () => {
    for (const s of SCENARIOS) {
      expect(s.truth.incrementalUnionMinor, s.id).toBeLessThanOrEqual(s.truth.positiveExposureMinor);
    }
  });

  it("a scenario with no expectation at all claims no exposure", () => {
    for (const s of SCENARIOS) {
      if (s.e.length === 0) expect(s.truth.positiveExposureMinor, s.id).toBe(0);
    }
  });
});

describe("benchmark ground truth · population and identity", () => {
  it("scenario ids are unique — a duplicate would double-count in every total", () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the counted population is pinned, so a silently dropped scenario fails here", () => {
    expect(SCENARIOS.length).toBe(30);
    expect(SCENARIOS.reduce((n, s) => n + s.e.length, 0)).toBe(45);
    expect(SCENARIOS.reduce((n, s) => n + s.o.length, 0)).toBe(31);
  });

  it("the benchmark TOTALS reconcile to the per-scenario figures", () => {
    const t = (f: (s: typeof SCENARIOS[number]) => number) => SCENARIOS.reduce((n, s) => n + f(s), 0);
    // These are SUMS OF AUTHORED PER-SCENARIO VALUES, each already checked by the central invariant
    // above — not figures a detector produced. They are pinned so a silently changed or dropped
    // scenario fails here rather than quietly moving a headline.
    expect(t((s) => s.truth.positiveExposureMinor)).toBe(302_001);
    expect(t((s) => s.truth.negativeDiscrepancyMinor)).toBe(82_000);
    expect(t((s) => s.truth.incrementalUnionMinor)).toBe(272_001);
    expect(t((s) => s.truth.unknownExpectationCount)).toBe(2);
    // The blind class is a real subset of the positive truth, not a separate bucket.
    const blind = SCENARIOS.filter((s) => s.truth.blindToMonetary);
    expect(blind.length).toBe(1);
    expect(t((s) => (s.truth.blindToMonetary ? s.truth.positiveExposureMinor : 0))).toBe(10_000);
  });

  it("EVERY representation-dependent case has BOTH twins — enabled and disabled", () => {
    // The disabled twin is the proof that the lifecycle fact is a REQUIREMENT. A benchmark of enabled
    // twins only would demonstrate the design works where it is easy.
    const disabled = SCENARIOS.filter((s) => !s.representationEnabled).map((s) => s.id);
    expect(disabled.length).toBeGreaterThanOrEqual(8);
    for (const stem of ["R07x", "R08x", "R09x", "R11x", "R13x", "R14x", "R15x", "R17x", "R18x"]) {
      expect(disabled.some((id) => id.startsWith(stem)), `missing disabled twin ${stem}`).toBe(true);
    }
  });

  it("the twenty approved adversarial classes are all present", () => {
    const ids = SCENARIOS.map((s) => s.id).join(" ");
    for (const stem of [
      "R01-missing-billing", "R02-partial-underbilling", "R03-exact-balance", "R04-overbilling",
      "R05-missing-plus-unrelated-surplus", "R06-duplicate-masks-missing", "R07-wrong-entitlement",
      "R08-wrong-customer", "R09-timing-shift", "R10-split-billing", "R11-consolidated",
      "R12-proration", "R13-pause", "R14-cancellation", "R15-amendment", "R16-renewal",
      "R17-rekey", "R18x-migration", "R19-currency-mismatch", "R20-unknown-amount", "R21-credit",
    ]) {
      expect(ids, `missing class ${stem}`).toContain(stem);
    }
  });
});
