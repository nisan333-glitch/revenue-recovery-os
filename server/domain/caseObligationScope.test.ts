// Obligation Scope for a governed Recovery Case — pure adapter tests (no database).
import { describe, it, expect } from "vitest";
import { caseObligationScope } from "./caseObligationScope";
import { assertSingleObligation, UnsupportedSingleObligationAssertion } from "../../src/domain/obligationScope";

const ev = (evidenceId: string, amountMinor: number | null, currency: string | null = "USD") => ({
  evidenceId,
  amountMinor,
  currency,
});

describe("caseObligationScope — a Case is one governed claim, not a proven single obligation", () => {
  it("no outcome evidence ⇒ nothing established, single-obligation refused", () => {
    const s = caseObligationScope("RC-1", []);
    expect(s.surface).toBe("RECOVERY_CASE");
    expect(s.identity.grain).toBe("NOT_ESTABLISHED");
    expect(s.singleObligation).toBe("REFUSED_UNSUPPORTED");
    expect(s.ambiguity.reasons).toContain("NO_UNITS_EXAMINED");
  });

  it("ONE outcome record does not establish one obligation (a single payment may settle several)", () => {
    const s = caseObligationScope("RC-1", [ev("EV-1", 1_320_000)]);
    expect(s.identity.grain).toBe("SOURCE_IDENTIFIER");
    expect(s.identity.unitCount).toBe(1);
    expect(s.recordedAbsorption.status).toBe("NONE_RECORDED");
    expect(s.singleObligation).toBe("REFUSED_UNSUPPORTED");
    expect(s.ambiguity.status).toBe("PRESENT");
    expect(() => assertSingleObligation(s, "case RC-1")).toThrow(UnsupportedSingleObligationAssertion);
  });

  it("TWO outcome records under one case are RECORDED as merged under one claim; nothing is inferred", () => {
    const s = caseObligationScope("RC-1", [ev("EV-2", 400_000), ev("EV-1", 1_000_000)]);
    expect(s.recordedAbsorption.status).toBe("RECORDED");
    expect(s.recordedAbsorption.disposition).toBe("COUNTED_UNDER_ONE_CLAIM");
    expect(s.recordedAbsorption.groupCount).toBe(1);
    expect(s.recordedAbsorption.unitIds).toEqual(["EV-1", "EV-2"]);
    expect(s.recordedAbsorption.candidateExposureUpperBound).toEqual({ minor: 1_400_000, currency: "USD" });
    const text = s.disclosure.join("\n");
    expect(text).toContain("counted once under a single claim");
    expect(text).toContain("$14,000.00");
    expect(text).toContain("not inferred whether these records are duplicates of one obligation or separate obligations");
    expect(s.singleObligation).toBe("REFUSED_UNSUPPORTED");
  });

  it("unknown amount or mixed currency ⇒ exposure NOT quantifiable (null), never a partial sum", () => {
    expect(caseObligationScope("RC-1", [ev("A", 100), ev("B", null)]).recordedAbsorption.candidateExposureUpperBound).toBeNull();
    expect(caseObligationScope("RC-1", [ev("A", 100), ev("B", 100, "EUR")]).recordedAbsorption.candidateExposureUpperBound).toBeNull();
  });

  it("is deterministic and independent of evidence order", () => {
    const a = caseObligationScope("RC-1", [ev("EV-1", 1), ev("EV-2", 2), ev("EV-3", 3)]);
    const b = caseObligationScope("RC-1", [ev("EV-3", 3), ev("EV-1", 1), ev("EV-2", 2)]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("never contains ledger vocabulary the CFO export forbids (the word 'forecast')", () => {
    const s = caseObligationScope("RC-1", [ev("A", 100), ev("B", 200)]);
    expect(JSON.stringify(s).toLowerCase()).not.toContain("forecast");
  });
});
