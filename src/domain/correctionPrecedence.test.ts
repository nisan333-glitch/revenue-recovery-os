// Falsifiers for S-DUP-4. One positive and one negative for every refusal, the partial-payment support the
// rule was asked for, the double-counting refusals, and the two properties that make it a rule rather than
// a tie-break: it consults no order, and it never reduces what was owed by what was paid.
import { describe, expect, it } from "vitest";

import { resolvePrecedence, type AuthoritativeBilling } from "./correctionPrecedence";

const billing = (over: Partial<AuthoritativeBilling> = {}): AuthoritativeBilling => ({
  billedAmountsMinor: [60_000],
  collectedAmountsMinor: [60_000],
  currency: "USD",
  billedRecordIds: ["EV-FIX-1"],
  collectedRecordIds: ["EV-PAY-1"],
  ...over,
});

const ask = (over: Partial<Parameters<typeof resolvePrecedence>[0]> = {}) =>
  resolvePrecedence({
    observedAmountsMinor: [60_000, 55_000],
    currency: "USD",
    obligationGrained: true,
    billing: billing(),
    ...over,
  });

describe("the positive case · the corrective charge names the authoritative amount", () => {
  it("resolves to the observed amount the charge was raised for, not the first observation", () => {
    // 55_000 is listed FIRST in the observations. Order is not consulted, so the charge decides.
    const v = resolvePrecedence({
      observedAmountsMinor: [55_000, 60_000],
      currency: "USD",
      obligationGrained: true,
      billing: billing(),
    });
    expect(v.resolved).toBe(true);
    expect(v.resolved && v.authoritativeMinor).toBe(60_000);
    expect(v.resolved && v.settlement).toBe("FULLY_SETTLED");
    expect(v.resolved && v.outstandingMinor).toBe(0);
  });

  it("ORDER IS NOT CONSULTED · every permutation of the observations gives the same answer", () => {
    // The rule the instruction exists for. A stable tie-break would also be deterministic; that is not
    // the same as being evidence-based, so determinism is demonstrated ACROSS permutations rather than
    // across repeated runs of one input.
    const perms = [[60_000, 55_000], [55_000, 60_000], [55_000, 60_000, 55_000], [60_000, 60_000, 55_000]];
    for (const observedAmountsMinor of perms) {
      const v = resolvePrecedence({ observedAmountsMinor, currency: "USD", obligationGrained: true, billing: billing() });
      expect(v.resolved && v.authoritativeMinor, JSON.stringify(observedAmountsMinor)).toBe(60_000);
    }
  });
});

describe("verified partial payments · supported, and never double counted", () => {
  it("sums a payment series and reports the remainder WITHOUT reducing the authoritative amount", () => {
    const v = resolvePrecedence({
      observedAmountsMinor: [60_000],
      currency: "USD",
      obligationGrained: true,
      billing: billing({
        collectedAmountsMinor: [20_000, 15_000],
        collectedRecordIds: ["EV-PAY-1", "EV-PAY-2"],
      }),
    });
    expect(v.resolved).toBe(true);
    if (!v.resolved) return;
    expect(v.collectedMinor).toBe(35_000);
    expect(v.settlement).toBe("PARTIALLY_SETTLED");
    // THE AMOUNT OWED IS NOT REDUCED BY WHAT WAS PAID. The shortfall is counted once and its settlement
    // is a separate fact; subtracting here would under-report the obligation.
    expect(v.authoritativeMinor).toBe(60_000);
    expect(v.outstandingMinor).toBe(25_000);
  });

  it("no payment at all is UNSETTLED, and the amount is still authoritative", () => {
    const v = resolvePrecedence({
      observedAmountsMinor: [60_000], currency: "USD", obligationGrained: true,
      billing: billing({ collectedAmountsMinor: [], collectedRecordIds: [] }),
    });
    expect(v.resolved && v.settlement).toBe("UNSETTLED");
    expect(v.resolved && v.authoritativeMinor).toBe(60_000);
    expect(v.resolved && v.outstandingMinor).toBe(60_000);
  });

  it("DOUBLE COUNTING · the same payment id twice is refused, not summed", () => {
    const v = ask({
      billing: billing({
        collectedAmountsMinor: [30_000, 30_000],
        collectedRecordIds: ["EV-PAY-1", "EV-PAY-1"],
      }),
    });
    expect(!v.resolved && v.code).toBe("BILLING_EVIDENCE_CONTRADICTORY");
    expect(!v.resolved && v.reason).toContain("more than once");
  });

  it("DOUBLE COUNTING · one record counted as both the charge and its payment is refused", () => {
    const v = ask({ billing: billing({ collectedRecordIds: ["EV-FIX-1"] }) });
    expect(!v.resolved && v.code).toBe("BILLING_EVIDENCE_CONTRADICTORY");
    expect(!v.resolved && v.reason).toContain("cannot be both");
  });
});

describe("every refusal, each on its own", () => {
  it("OBLIGATION_IDENTITY_AMBIGUOUS · an account-level grouping is refused first", () => {
    const v = ask({ obligationGrained: false });
    expect(!v.resolved && v.code).toBe("OBLIGATION_IDENTITY_AMBIGUOUS");
  });

  it("NO_AUTHORITATIVE_BILLING_EVIDENCE · absent evidence, and absent charges", () => {
    expect(!ask({ billing: null }).resolved).toBe(true);
    const none = ask({ billing: null });
    expect(!none.resolved && none.code).toBe("NO_AUTHORITATIVE_BILLING_EVIDENCE");
    const noCharge = ask({ billing: billing({ billedAmountsMinor: [], billedRecordIds: [] }) });
    expect(!noCharge.resolved && noCharge.code).toBe("NO_AUTHORITATIVE_BILLING_EVIDENCE");
  });

  it("BILLED_AMOUNT_AMBIGUOUS · two corrective charges are not summed", () => {
    // THE ASYMMETRY, asserted. Two charges may be two additive charges or one re-issued, and nothing
    // establishes which — so they are refused, while two PAYMENTS are summed.
    const v = ask({
      billing: billing({ billedAmountsMinor: [30_000, 30_000], billedRecordIds: ["EV-FIX-1", "EV-FIX-2"] }),
    });
    expect(!v.resolved && v.code).toBe("BILLED_AMOUNT_AMBIGUOUS");
    expect(!v.resolved && v.reason).toContain("distinct additive charges");
  });

  it("BILLING_EVIDENCE_CONTRADICTORY · more collected than was ever charged", () => {
    const v = ask({ billing: billing({ collectedAmountsMinor: [60_001] }) });
    expect(!v.resolved && v.code).toBe("BILLING_EVIDENCE_CONTRADICTORY");
    expect(!v.resolved && v.reason).toContain("than was ever charged");
  });

  it("BILLING_EVIDENCE_CONTRADICTORY · a currency disagreement is never reconciled", () => {
    const v = ask({ billing: billing({ currency: "EUR" }) });
    expect(!v.resolved && v.code).toBe("BILLING_EVIDENCE_CONTRADICTORY");
  });

  it("BILLING_EVIDENCE_CONTRADICTORY · malformed amounts and mismatched id counts", () => {
    for (const over of [
      { billedAmountsMinor: [-1] },
      { billedAmountsMinor: [1.5] },
      { collectedAmountsMinor: [Number.NaN] },
      { billedRecordIds: ["EV-FIX-1", "EV-FIX-2"] },
    ]) {
      const v = ask({ billing: billing(over) });
      expect(!v.resolved && v.code, JSON.stringify(over)).toBe("BILLING_EVIDENCE_CONTRADICTORY");
    }
  });

  it("NO_OBSERVATION_MATCHES_BILLED · the charge corroborates none of them", () => {
    const v = ask({ observedAmountsMinor: [55_000, 70_000] });
    expect(!v.resolved && v.code).toBe("NO_OBSERVATION_MATCHES_BILLED");
    expect(!v.resolved && v.reason).toContain("60000");
  });
});

describe("the ordering of the refusals, asserted rather than assumed", () => {
  it("identity outranks everything, because corroborating the wrong subject is the worse error", () => {
    const v = resolvePrecedence({
      observedAmountsMinor: [], currency: "EUR", obligationGrained: false,
      billing: billing({ billedAmountsMinor: [1, 2], billedRecordIds: ["a", "b"], collectedRecordIds: ["a"] }),
    });
    expect(!v.resolved && v.code).toBe("OBLIGATION_IDENTITY_AMBIGUOUS");
  });

  it("a contradiction outranks the ambiguity of two charges, because neither figure is trusted", () => {
    const v = ask({
      billing: billing({
        billedAmountsMinor: [30_000, 30_000], billedRecordIds: ["EV-FIX-1", "EV-FIX-2"],
        collectedRecordIds: ["EV-FIX-1"],
      }),
    });
    expect(!v.resolved && v.code).toBe("BILLING_EVIDENCE_CONTRADICTORY");
  });
});
