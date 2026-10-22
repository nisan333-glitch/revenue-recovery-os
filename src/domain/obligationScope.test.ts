// Obligation Scope — pure derivation, structural refusal and shared wording.
import { describe, it, expect } from "vitest";
import {
  deriveObligationScope,
  unavailableObligationScope,
  assertSingleObligation,
  unitNoun,
  UnsupportedSingleObligationAssertion,
  OBLIGATION_SCOPE_VERSION,
  type IdentityUnit,
} from "./obligationScope";

const u = (
  unitId: string,
  identityKey: string,
  amountMinor: number | null,
  basis: IdentityUnit["basis"] = "DERIVED_COMPOSITE",
  currency: string | null = "USD",
): IdentityUnit => ({ unitId, identityKey, basis, amountMinor, currency });

const derive = (units: IdentityUnit[], extra: { declared?: boolean } = {}) =>
  deriveObligationScope({
    surface: "ASSESSMENT",
    currency: "USD",
    units,
    absorptionDisposition: "EXCLUDED_FROM_TOTALS",
    obligationLevelIdentifierDeclared: extra.declared,
  });

describe("deriveObligationScope — identity grain", () => {
  it("no units ⇒ NOT_ESTABLISHED, single-obligation refused, never 'zero ambiguity'", () => {
    const s = derive([]);
    expect(s.version).toBe(OBLIGATION_SCOPE_VERSION);
    expect(s.identity.grain).toBe("NOT_ESTABLISHED");
    expect(s.singleObligation).toBe("REFUSED_UNSUPPORTED");
    expect(s.ambiguity.status).toBe("PRESENT");
    expect(s.ambiguity.reasons).toContain("NO_UNITS_EXAMINED");
  });

  it("source identifiers alone do NOT make a record an obligation (declaration required)", () => {
    const s = derive([u("r1", "SUB-1", 100_00, "SOURCE_IDENTIFIER"), u("r2", "SUB-2", 50_00, "SOURCE_IDENTIFIER")]);
    expect(s.identity.grain).toBe("SOURCE_IDENTIFIER");
    expect(s.singleObligation).toBe("REFUSED_UNSUPPORTED");
    expect(s.ambiguity.reasons).toEqual(["OBLIGATION_LEVEL_IDENTIFIER_NOT_DECLARED"]);
    expect(unitNoun(s)).toBe("record");
  });

  it("derived identities are DERIVED_COMPOSITE; mixed is MIXED; an undeclared basis fails closed", () => {
    expect(derive([u("r1", "k1", 1)]).identity.grain).toBe("DERIVED_COMPOSITE");
    expect(derive([u("r1", "k1", 1), u("r2", "SUB-9", 1, "SOURCE_IDENTIFIER")]).identity.grain).toBe("MIXED");
    const undeclared = derive([u("r1", "k1", 1, "SOURCE_IDENTIFIER"), u("r2", "k2", 1, "UNDECLARED")]);
    expect(undeclared.identity.grain).toBe("NOT_ESTABLISHED");
    expect(undeclared.identity.undeclaredCount).toBe(1);
    expect(undeclared.singleObligation).toBe("REFUSED_UNSUPPORTED");
  });

  it("single-obligation is SUPPORTED only with a declared obligation-level source id AND no collisions", () => {
    const ok = derive([u("r1", "INV-1", 1, "SOURCE_IDENTIFIER"), u("r2", "INV-2", 1, "SOURCE_IDENTIFIER")], {
      declared: true,
    });
    expect(ok.singleObligation).toBe("SUPPORTED");
    expect(ok.ambiguity.status).toBe("ABSENT");
    expect(unitNoun(ok)).toBe("obligation");
    expect(() => assertSingleObligation(ok, "test")).not.toThrow();

    // declared, but identity was synthesized ⇒ still refused
    expect(derive([u("r1", "k1", 1)], { declared: true }).singleObligation).toBe("REFUSED_UNSUPPORTED");
    // declared + source, but two units collapsed under one identity ⇒ still refused
    const collided = derive(
      [u("r1", "INV-1", 1, "SOURCE_IDENTIFIER"), u("r2", "INV-1", 1, "SOURCE_IDENTIFIER")],
      { declared: true },
    );
    expect(collided.singleObligation).toBe("REFUSED_UNSUPPORTED");
    expect(collided.ambiguity.reasons).toContain("IDENTITY_COLLISION_UNRESOLVED");
  });
});

describe("deriveObligationScope — ambiguity is not absorption", () => {
  it("derived identity with NO collision: ambiguity PRESENT, absorption NONE_RECORDED, exposure 0 (not null)", () => {
    const s = derive([u("r1", "k1", 100_00), u("r2", "k2", 50_00)]);
    expect(s.ambiguity.status).toBe("PRESENT");
    expect(s.recordedAbsorption.status).toBe("NONE_RECORDED");
    expect(s.recordedAbsorption.candidateExposureUpperBound).toEqual({ minor: 0, currency: "USD" });
    expect(s.disclosure.join("\n")).toContain("Recorded absorption: none");
    expect(s.disclosure.join("\n")).toContain("does not establish that no obligations were merged");
  });

  it("two separate obligations sharing a derived identity: both recorded as absorbed, exposure is an upper bound, nothing inferred", () => {
    // E1 has a $10,000.00 and a $4,000.00 charge with the same signed/due dates and no source id.
    const s = derive([u("row-2", "E1|2026-01-01|2026-02-01", 1_000_000), u("row-3", "E1|2026-01-01|2026-02-01", 400_000)]);
    expect(s.recordedAbsorption.status).toBe("RECORDED");
    expect(s.recordedAbsorption.groupCount).toBe(1);
    expect(s.recordedAbsorption.unitCount).toBe(2);
    expect(s.recordedAbsorption.unitIds).toEqual(["row-2", "row-3"]);
    expect(s.recordedAbsorption.candidateExposureUpperBound).toEqual({ minor: 1_400_000, currency: "USD" });
    expect(s.recordedAbsorption.unquantifiedUnitCount).toBe(0);
    const text = s.disclosure.join("\n");
    expect(text).toContain("$14,000.00");
    expect(text).toContain("upper bound");
    expect(text).toContain("unclassified bound, not a loss and not recovered value");
    expect(text).toContain("not inferred whether these records are duplicates of one obligation or separate obligations");
    // The scope exposes no field that classifies the units as separate or duplicate.
    expect(JSON.stringify(s)).not.toMatch(/"separate"|"duplicate"/);
  });

  it("absorption disposition is reported as given (excluded vs counted once)", () => {
    const rows = [u("a", "k", 1), u("b", "k", 1)];
    const counted = deriveObligationScope({
      surface: "RECOVERY_CASE",
      currency: "USD",
      units: rows,
      absorptionDisposition: "COUNTED_UNDER_ONE_CLAIM",
    });
    expect(counted.recordedAbsorption.disposition).toBe("COUNTED_UNDER_ONE_CLAIM");
    expect(counted.disclosure.join("\n")).toContain("counted once under a single claim");
    expect(derive(rows).disclosure.join("\n")).toContain("excluded from every total");
  });

  it("exposure is null (NOT_ESTABLISHED), never a partial sum, when an amount is unknown or currencies differ", () => {
    const unknown = derive([u("a", "k", 100_00), u("b", "k", null)]);
    expect(unknown.recordedAbsorption.candidateExposureUpperBound).toBeNull();
    expect(unknown.recordedAbsorption.unquantifiedUnitCount).toBe(1);
    expect(unknown.disclosure.join("\n")).toContain("not quantifiable");

    const mixed = derive([u("a", "k", 100_00), u("b", "k", 100_00, "DERIVED_COMPOSITE", "EUR")]);
    expect(mixed.recordedAbsorption.candidateExposureUpperBound).toBeNull();

    const negative = derive([u("a", "k", 100_00), u("b", "k", -5)]);
    expect(negative.recordedAbsorption.candidateExposureUpperBound).toBeNull();
  });
});

describe("deriveObligationScope — ledger vocabulary stays out of the disclosure", () => {
  it("never uses the word 'forecast' (the CFO export asserts forecast never appears) nor claims recovery", () => {
    const scopes = [
      derive([]),
      derive([u("a", "k", 100_00), u("b", "k", 50_00)]),
      derive([u("a", "k", null), u("b", "k", 50_00)]),
      deriveObligationScope({ surface: "RECOVERY_CASE", currency: "USD", units: [u("a", "k", 1), u("b", "k", 2)], absorptionDisposition: "COUNTED_UNDER_ONE_CLAIM" }),
      unavailableObligationScope("RECOVERY_CASE"),
    ];
    for (const s of scopes) {
      const all = JSON.stringify(s).toLowerCase();
      expect(all).not.toContain("forecast");
      expect(all).not.toContain("recovered revenue");
      expect(all).not.toContain("proven");
    }
  });
});

describe("deriveObligationScope — determinism and immutability", () => {
  it("is independent of input order and deeply frozen", () => {
    const rows = [u("c", "k1", 3), u("a", "k1", 1), u("b", "k2", 2), u("d", "k1", 4)];
    const s1 = derive(rows);
    const s2 = derive([...rows].reverse());
    expect(s2).toEqual(s1);
    expect(JSON.stringify(s2)).toBe(JSON.stringify(s1));
    expect(Object.isFrozen(s1)).toBe(true);
    expect(Object.isFrozen(s1.recordedAbsorption)).toBe(true);
    expect(Object.isFrozen(s1.disclosure)).toBe(true);
  });
});

describe("structural refusal of unsupported single-obligation assertions", () => {
  it("assertSingleObligation throws a typed error carrying the reasons", () => {
    const s = derive([u("r1", "k1", 1)]);
    expect(() => assertSingleObligation(s, "Observed unpaid")).toThrow(UnsupportedSingleObligationAssertion);
    try {
      assertSingleObligation(s, "Observed unpaid");
    } catch (e) {
      expect((e as UnsupportedSingleObligationAssertion).reasons).toContain("IDENTITY_NOT_SOURCED");
      expect((e as Error).message).toContain("Observed unpaid");
    }
  });

  it("a surface that never computed its scope is refused, not treated as 'no ambiguity'", () => {
    const s = unavailableObligationScope("ASSESSMENT");
    expect(s.singleObligation).toBe("REFUSED_UNSUPPORTED");
    expect(s.ambiguity.status).toBe("PRESENT");
    expect(s.ambiguity.reasons).toEqual(["SCOPE_NOT_COMPUTED"]);
    expect(s.disclosure.join(" ")).toContain("not computed");
    expect(() => assertSingleObligation(s, "x")).toThrow(UnsupportedSingleObligationAssertion);
    expect(unitNoun(s)).toBe("record");
  });
});
