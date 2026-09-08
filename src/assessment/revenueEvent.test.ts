/// <reference types="node" />
// Locking tests for the EXPECT → DETECT slice. These encode the boundaries the Opus review made
// binding: contractual ≠ operational ≠ statistical, UNKNOWN fails closed, customer-favourable
// findings never enter company-recoverable totals, and nothing here can reach Proof/ProvenLedger.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyseCycle,
  deriveContractualExpectation,
  deriveObservedEvent,
  detectDiscrepancy,
  type Discrepancy,
} from "./revenueEvent";
import { makePolicy } from "./policy";
import { money, zeroMoney, addMoney } from "../domain/money";
import type { ExpectationCycle } from "./types";

const policy = makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD", excludedStatuses: [] });

function cycle(over: Partial<ExpectationCycle> = {}, monetary: Partial<ExpectationCycle["monetaryEvent"]> = {}): ExpectationCycle {
  return {
    cycleId: "SUB-1",
    sourceRowId: "row-1",
    entityId: "E1",
    expectationAt: "2026-01-01",
    observationAt: null,
    monetaryEvent: {
      dueAt: "2026-02-01",
      amount: money(10_000_00, "USD"),
      paidAt: null,
      paidAmount: null,
      refunded: false,
      cancelled: false,
      ...monetary,
    },
    currency: "USD",
    statusRaw: null,
    attributes: {},
    ...over,
  };
}

const SOURCE = readFileSync(join(__dirname, "revenueEvent.ts"), "utf8");
// Structural assertions below scan EXECUTABLE CODE only. The module's doc comments deliberately
// discuss Baseline, forecast and fee-bearing in order to state the boundaries it must not cross;
// scanning prose would force those explanations to be deleted to satisfy a regex, which is exactly
// backwards. (No string literal in the module contains a comment marker, so this strip is safe.)
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("Revenue Event — contractual expectation", () => {
  it("1 · derives a CONTRACTUAL expectation from deterministic input", () => {
    const e = deriveContractualExpectation(cycle());
    expect(e).not.toBeNull();
    expect(e!.expectationBasis).toBe("CONTRACTUAL");
    expect(e!.eventType).toBe("BillingEvent");
    expect(e!.expectedAt).toBe("2026-02-01");
    expect(e!.basisRef).toBe("2026-01-01"); // the commitment that creates the obligation
    expect(e!.expectedAmount).toEqual(money(10_000_00, "USD"));
  });

  it("2 · OPERATIONAL expectation cannot masquerade as CONTRACTUAL", () => {
    expect(deriveContractualExpectation(cycle(), "OPERATIONAL")).toBeNull();
  });

  it("3 · STATISTICAL/forecast expectation cannot enter the contractual path", () => {
    expect(deriveContractualExpectation(cycle(), "STATISTICAL")).toBeNull();
    // and the module structurally cannot consult a cohort/model/projection
    expect(CODE).not.toMatch(/cohort|forecast|estimate|projection|propensity/i);
  });

  it("5 · ambiguous identity or missing deadline fails closed", () => {
    expect(deriveContractualExpectation(cycle({ cycleId: "   " }))).toBeNull();
    expect(deriveContractualExpectation(cycle({}, { dueAt: "" }))).toBeNull();
    // a currency contradiction between obligation and cycle is not reconciled here
    expect(deriveContractualExpectation(cycle({ currency: "EUR" }))).toBeNull();
  });

  it("6 · the expected amount is copied verbatim, never fabricated or defaulted", () => {
    const src = cycle({}, { amount: money(7_531_29, "USD") });
    const e = deriveContractualExpectation(src)!;
    expect(e.expectedAmount).toEqual(src.monetaryEvent.amount);
    // no rounding, no unit conversion, no substituted default anywhere in the module
    expect(CODE).not.toMatch(/Math\.round|toFixed|\|\|\s*0\b/);
  });
});

describe("Revenue Event — discrepancy detection", () => {
  const detect = (c: ExpectationCycle): Discrepancy => analyseCycle(c, policy)!.discrepancy;

  it("4 · MISSING and DELAYED are distinguished by deadline + asOf", () => {
    const missing = detect(cycle()); // due 2026-02-01, asOf 2026-03-01, nothing observed
    expect(missing.kind).toBe("MISSING");
    expect(missing.direction).toBe("COMPANY_FAVOURABLE");
    expect(missing.delta).toEqual(money(10_000_00, "USD"));

    const delayed = detect(cycle({}, { paidAt: "2026-02-15", paidAmount: money(10_000_00, "USD") }));
    expect(delayed.kind).toBe("DELAYED");
    expect(delayed.companyRecoverableCandidate).toBe(false); // the money did arrive
  });

  it("4b · an obligation that is not yet due is not a discrepancy", () => {
    const notYetDue = detect(cycle({}, { dueAt: "2026-06-01" }));
    expect(notYetDue.kind).toBe("NONE");
    expect(notYetDue.companyRecoverableCandidate).toBe(false);
  });

  it("settles on time and in full → no discrepancy", () => {
    const ok = detect(cycle({}, { paidAt: "2026-01-28", paidAmount: money(10_000_00, "USD") }));
    expect(ok.kind).toBe("NONE");
  });

  it("underpayment is INCORRECT and company-favourable", () => {
    const under = detect(cycle({}, { paidAt: "2026-01-30", paidAmount: money(6_000_00, "USD") }));
    expect(under.kind).toBe("INCORRECT");
    expect(under.direction).toBe("COMPANY_FAVOURABLE");
    expect(under.delta).toEqual(money(4_000_00, "USD"));
    expect(under.companyRecoverableCandidate).toBe(true);
  });

  it("7 · a customer-favourable discrepancy carries the right direction and is excluded from recoverable totals", () => {
    const over = detect(cycle({}, { paidAt: "2026-01-30", paidAmount: money(12_500_00, "USD") }));
    expect(over.kind).toBe("INCORRECT");
    expect(over.direction).toBe("CUSTOMER_FAVOURABLE");
    expect(over.delta).toEqual(money(2_500_00, "USD")); // magnitude, in the stated direction
    expect(over.companyRecoverableCandidate).toBe(false);

    // summing only company-recoverable candidates must exclude it entirely
    const total = [over].reduce(
      (acc, d) => (d.companyRecoverableCandidate && d.delta ? addMoney(acc, d.delta) : acc),
      zeroMoney("USD"),
    );
    expect(total).toEqual(zeroMoney("USD"));
  });

  it("8 · UNKNOWN never becomes company-recoverable", () => {
    const cancelled = detect(cycle({}, { cancelled: true }));
    const refunded = detect(cycle({}, { refunded: true }));
    const boolTiming = detect(
      cycle({ attributes: { paid_timing: "unknown_from_bool" } }, { paidAt: "2026-02-01", paidAmount: null }),
    );
    for (const d of [cancelled, refunded, boolTiming]) {
      expect(d.kind).toBe("UNKNOWN");
      expect(d.companyRecoverableCandidate).toBe(false);
      expect(d.delta).toBeNull();
    }
  });

  it("identity mismatch between expectation and observation fails closed", () => {
    const expected = deriveContractualExpectation(cycle())!;
    const observed = deriveObservedEvent(cycle({ cycleId: "OTHER" }));
    const d = detectDiscrepancy(expected, observed, policy);
    expect(d.kind).toBe("UNKNOWN");
    expect(d.companyRecoverableCandidate).toBe(false);
  });

  it("a settled amount in a different currency fails closed rather than being converted", () => {
    const d = detect(cycle({}, { paidAt: "2026-01-30", paidAmount: money(9_000_00, "EUR") }));
    expect(d.kind).toBe("UNKNOWN");
  });
});

describe("Revenue Event — trust boundaries (structural)", () => {
  it("9,10,11 · cannot reach Proof, ProvenLedger, approval, or the governed server path", () => {
    for (const forbidden of ["proof", "provenLedger", "approval", "server/", "prisma"]) {
      expect(CODE.includes(`from "../domain/${forbidden}`)).toBe(false);
      expect(CODE.includes(forbidden === "server/" ? 'from "../../server' : `${forbidden}"`)).toBe(false);
    }
    // the only cross-layer import permitted is the pure, exact Money type/helpers
    const imports = [...CODE.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(imports)).toEqual(new Set(["../domain/money", "./types", "./policy", "./dateNormalize"]));
  });

  it("12 · does not touch or re-interpret Baseline (the counterfactual object)", () => {
    expect(CODE).not.toMatch(/baseline/i);
  });

  it("16,17 · detection truth carries no commercial-model dependency", () => {
    expect(CODE).not.toMatch(/fee|pricing|performance model|fixed model|12%|success[_ ]?fee/i);
    // identical input yields identical output — no hidden state, no pricing branch
    const a = analyseCycle(cycle(), policy);
    const b = analyseCycle(cycle(), policy);
    expect(a).toEqual(b);
  });

  it("a finding is never expressed as revenue, leakage, or recovered money", () => {
    const d = analyseCycle(cycle(), policy)!.discrepancy;
    expect(Object.keys(d)).toEqual([
      "kind",
      "direction",
      "cycleId",
      "sourceRef",
      "delta",
      "companyRecoverableCandidate",
      "reason",
    ]);
  });
});
