// Falsifiers for the universal financial-outcome-evidence rule. One positive and one negative for every
// refusal the predicate can return, plus the property the rule exists for: the verdict does not depend on
// confidence at all, because confidence is not an input.
import { describe, expect, it } from "vitest";

import { financialOutcomeSufficiency, type OutcomeEvidenceItem } from "./outcomeEvidence";

const good = (over: Partial<OutcomeEvidenceItem> = {}): OutcomeEvidenceItem => ({
  evidenceId: "EV-1",
  amountMinor: 70_000,
  currency: "USD",
  sourceVerified: true,
  beneficiaryControl: false,
  trustClassification: "independent",
  ...over,
});

const ask = (over: Partial<Parameters<typeof financialOutcomeSufficiency>[0]> = {}) =>
  financialOutcomeSufficiency({
    claimedCollectedMinor: 70_000,
    currency: "USD",
    anyIndependent: true,
    outcomeItems: [good()],
    ...over,
  });

describe("the positive case", () => {
  it("accepts authenticated, independent, same-currency outcome evidence that covers the claim", () => {
    const v = ask();
    expect(v.sufficient).toBe(true);
    expect(v.sufficient && v.outcomeSumMinor).toBe(70_000);
  });

  it("sums several outcome records", () => {
    const v = ask({ outcomeItems: [good({ amountMinor: 40_000 }), good({ evidenceId: "EV-2", amountMinor: 30_000 })] });
    expect(v.sufficient).toBe(true);
    expect(v.sufficient && v.outcomeSumMinor).toBe(70_000);
  });

  it("accepts evidence that EXCEEDS the claim — over-evidencing is not a defect", () => {
    expect(ask({ outcomeItems: [good({ amountMinor: 90_000 })] }).sufficient).toBe(true);
  });
});

describe("every refusal, each on its own", () => {
  it("NO_INDEPENDENT_EVIDENCE · nothing cited is independent of the beneficiary", () => {
    const v = ask({ anyIndependent: false });
    expect(v.sufficient).toBe(false);
    expect(!v.sufficient && v.code).toBe("NO_INDEPENDENT_EVIDENCE");
  });

  it("NO_OUTCOME_EVIDENCE · supporting material only", () => {
    const v = ask({ outcomeItems: [] });
    expect(!v.sufficient && v.code).toBe("NO_OUTCOME_EVIDENCE");
  });

  it("OUTCOME_EVIDENCE_NOT_AUTHENTICATED · each of the three ways, separately", () => {
    for (const over of [
      { sourceVerified: false },
      { beneficiaryControl: true },
      { trustClassification: "beneficiary_controlled" },
    ]) {
      const v = ask({ outcomeItems: [good(over)] });
      expect(!v.sufficient && v.code, JSON.stringify(over)).toBe("OUTCOME_EVIDENCE_NOT_AUTHENTICATED");
    }
  });

  it("OUTCOME_EVIDENCE_CURRENCY_MISMATCH · amounts in two currencies are never summed", () => {
    const v = ask({ outcomeItems: [good({ amountMinor: 40_000 }), good({ evidenceId: "EV-2", amountMinor: 40_000, currency: "EUR" })] });
    expect(!v.sufficient && v.code).toBe("OUTCOME_EVIDENCE_CURRENCY_MISMATCH");
    // A null currency on a record that DOES state an amount is a mismatch too, not a wildcard.
    const nullCurrency = ask({ outcomeItems: [good({ currency: null })] });
    expect(!nullCurrency.sufficient && nullCurrency.code).toBe("OUTCOME_EVIDENCE_CURRENCY_MISMATCH");
  });

  it("OUTCOME_EVIDENCE_AMOUNT_NOT_STATED · an unstated amount is NOT COMPUTED, never zero", () => {
    // THE DEFECT THIS REFUSAL EXISTS FOR. The previous arithmetic was `sum + (e.amountMinor ?? 0)`, so
    // this record contributed a silent zero and 40_000 of evidence could clear a 40_000 claim while a
    // second record substantiating nothing sat beside it, invisible.
    const v = ask({
      claimedCollectedMinor: 40_000,
      outcomeItems: [good({ amountMinor: 40_000 }), good({ evidenceId: "EV-2", amountMinor: null })],
    });
    expect(!v.sufficient && v.code).toBe("OUTCOME_EVIDENCE_AMOUNT_NOT_STATED");
    const fractional = ask({ outcomeItems: [good({ amountMinor: 1.5 })] });
    expect(!fractional.sufficient && fractional.code).toBe("OUTCOME_EVIDENCE_AMOUNT_NOT_STATED");

    // ORDERING, asserted rather than assumed. The ingestion endpoint pairs amount and currency, so a
    // record with no amount has no currency either — and before this was reordered the currency refusal
    // masked this one and named the wrong problem.
    const neither = ask({ outcomeItems: [good({ amountMinor: null, currency: null })] });
    expect(!neither.sufficient && neither.code).toBe("OUTCOME_EVIDENCE_AMOUNT_NOT_STATED");
  });

  it("OUTCOME_EVIDENCE_INSUFFICIENT · the evidence totals less than the claim", () => {
    const v = ask({ outcomeItems: [good({ amountMinor: 69_999 })] });
    expect(!v.sufficient && v.code).toBe("OUTCOME_EVIDENCE_INSUFFICIENT");
    expect(!v.sufficient && v.reason).toContain("69999");
    // Exactly equal is sufficient: the boundary is >=, and it is asserted rather than assumed.
    expect(ask({ outcomeItems: [good({ amountMinor: 70_000 })] }).sufficient).toBe(true);
  });

  it("COLLECTED_AMOUNT_NOT_WELL_FORMED · a negative or fractional claim is refused before anything else", () => {
    for (const claimedCollectedMinor of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const v = ask({ claimedCollectedMinor });
      expect(!v.sufficient && v.code, String(claimedCollectedMinor)).toBe("COLLECTED_AMOUNT_NOT_WELL_FORMED");
    }
  });
});

describe("the property the rule exists for", () => {
  it("STRUCTURAL: confidence is not an input, so no verdict can depend on it", () => {
    // G2 was that the evidence bar moved with `confidenceUsed`. The predicate's input type has no such
    // field, so the dependency is not merely removed — it is unexpressible. A caller cannot pass one.
    const keys = Object.keys({
      claimedCollectedMinor: 0, currency: "", outcomeItems: [], anyIndependent: false,
    });
    expect(keys).toEqual(["claimedCollectedMinor", "currency", "outcomeItems", "anyIndependent"]);
    expect(keys.some((k) => /confidence|tier|auditable|threshold/i.test(k))).toBe(false);
  });

  it("a zero claim still requires outcome evidence — zero collected is not zero evidence", () => {
    expect(!ask({ claimedCollectedMinor: 0, outcomeItems: [] }).sufficient).toBe(true);
    expect(ask({ claimedCollectedMinor: 0 }).sufficient).toBe(true);
  });
});
