import { describe, it, expect } from "vitest";
import { ALL_REASON_KEYS, ENFORCED_REASON_SCOPE, RECOVERY_REASONS, reasonScopeViolation } from "./reasons";

// The rule exists so an IMMUTABLE proof cannot carry a reason naming a mechanism the case never had.
// It is scoped to ONE reason on purpose; the pins below are what keep it from quietly widening.

describe("BillingCorrection is enforced to RevenueUnderBilled cases", () => {
  it("is allowed on the case type its own definition names", () => {
    expect(reasonScopeViolation("BillingCorrection", "RevenueUnderBilled")).toBeNull();
  });

  it("is refused on every other recovery type, naming both sides and nothing else", () => {
    for (const t of ["StalledOnboarding", "ActivationMissed", "NoFirstValue", "RenewalAtRisk", "ExpansionStalled", "LowAdoption", "SomethingNew"]) {
      const msg = reasonScopeViolation("BillingCorrection", t);
      expect(msg).toContain("BillingCorrection");
      expect(msg).toContain("RevenueUnderBilled");
      expect(msg).toContain(`'${t}'`);
    }
  });

  it("fails closed when the case has no recorded recovery type — absent is not 'any'", () => {
    const msg = reasonScopeViolation("BillingCorrection", null);
    expect(msg).toContain("no recorded recovery type");
  });

  it("matches exactly: no case folding, no trimming, no prefix or substring match", () => {
    for (const t of ["revenueunderbilled", "REVENUEUNDERBILLED", " RevenueUnderBilled", "RevenueUnderBilled ", "RevenueUnderBilledX", "Revenue", ""]) {
      expect(reasonScopeViolation("BillingCorrection", t)).not.toBeNull();
    }
  });
});

describe("the rule does not widen", () => {
  it("leaves every OTHER reason's historical behaviour unchanged, for any case type including none", () => {
    const others = ALL_REASON_KEYS.filter((k) => k !== "BillingCorrection");
    expect(others.length).toBe(7);
    for (const reason of others) {
      for (const t of ["RevenueUnderBilled", "StalledOnboarding", "ActivationMissed", "Unknown", null]) {
        expect(reasonScopeViolation(reason, t)).toBeNull();
      }
    }
  });

  it("treats a reason outside the vocabulary as not enforced here (the HTTP enum refuses it earlier)", () => {
    expect(reasonScopeViolation("billing_correction", "StalledOnboarding")).toBeNull();
  });

  it("is not fooled by inherited object keys", () => {
    for (const k of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(reasonScopeViolation(k, "StalledOnboarding")).toBeNull();
    }
  });

  it("enforces exactly one reason today — a second must be a deliberate, reviewed addition", () => {
    expect(Object.keys(ENFORCED_REASON_SCOPE)).toEqual(["BillingCorrection"]);
  });

  it("the table cannot be mutated at runtime", () => {
    expect(Object.isFrozen(ENFORCED_REASON_SCOPE)).toBe(true);
    expect(Object.isFrozen(ENFORCED_REASON_SCOPE["BillingCorrection"])).toBe(true);
  });
});

describe("enforcement and the displayed guidance cannot drift apart", () => {
  it("every enforced reason is a real reason, and its displayed `appliesTo` is exactly what is enforced", () => {
    for (const [reason, types] of Object.entries(ENFORCED_REASON_SCOPE)) {
      const def = RECOVERY_REASONS.find((r) => r.key === reason);
      expect(def).toBeDefined();
      expect(def?.appliesTo).toBe(types.join(", "));
    }
  });
});
