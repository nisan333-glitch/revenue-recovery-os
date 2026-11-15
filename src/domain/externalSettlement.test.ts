import { describe, expect, it } from "vitest";
import {
  EXTERNAL_SETTLEMENT_METHOD_VERSION,
  FINAL_SETTLEMENT_STATES,
  SETTLEMENT_ATTESTATION_SCHEME,
  SETTLEMENT_FINALITY_STATES,
  externalSettlementProblems,
  externalSettlementSufficiency,
  settlementIdentity,
  settlementIsFinal,
  type ExternalSettlementFact,
  type ExternalSettlementInput,
} from "./externalSettlement";

const FACT: ExternalSettlementFact = Object.freeze({
  boundaryId: "b-alpha",
  sourceSystem: "acme-bank",
  sourceKind: "bank",
  externalSettlementRef: "CR-99001",
  finality: "BANK_CREDITED",
  amountMinor: 550000,
  currency: "USD",
  valueDate: "2026-03-10T00:00:00.000Z",
  correctiveInvoiceRef: "CN-9120",
  payerExternalRef: "PAYER-7781",
});

const INPUT: ExternalSettlementInput = Object.freeze({
  enabled: true,
  boundaryId: "b-alpha",
  claimedCollectedMinor: 550000,
  currency: "USD",
  caseCorrectiveInvoiceRef: "CN-9120",
  casePayerExternalRef: "PAYER-7781",
  correctionRaisedAt: "2026-03-01T00:00:00.000Z",
  now: "2026-03-15T00:00:00.000Z",
  facts: Object.freeze([FACT]),
  seenNonces: Object.freeze([]),
  nonces: Object.freeze(["nonce-aaaaaaaaaaaaaaaa"]),
  identitiesAlreadySubstantiating: Object.freeze([]),
});

const refuse = (over: Partial<ExternalSettlementInput>) =>
  externalSettlementSufficiency({ ...INPUT, ...over });

describe("stage 8 · external settlement · the positive control", () => {
  // A BUILD THAT REFUSED EVERYTHING WOULD SATISFY EVERY NEGATIVE ASSERTION BELOW AND BE USELESS.
  it("accepts one bank-credited settlement that matches the claim in every respect", () => {
    const verdict = externalSettlementSufficiency(INPUT);
    expect(verdict.sufficient).toBe(true);
    if (!verdict.sufficient) throw new Error("unreachable");
    expect(verdict.settledMinor).toBe(550000);
    expect(verdict.identities).toEqual([settlementIdentity(FACT)]);
    expect(verdict.sourceSystem).toBe("acme-bank");
    // NEVER causation. The correction preceding the money is necessary evidence of a relationship.
    expect(verdict.causationEstablished).toBe(false);
  });

  it("accepts a PSP payout, so the mechanism is not bank-only", () => {
    const psp = { ...FACT, sourceSystem: "acme-psp", sourceKind: "psp" as const, finality: "PSP_SETTLED" as const };
    const verdict = refuse({ facts: [psp] });
    expect(verdict.sufficient).toBe(true);
  });

  it("sums two DISTINCT settlements of one source, so a part payment in tranches is provable", () => {
    const a = { ...FACT, externalSettlementRef: "CR-1", amountMinor: 300000 };
    const b = { ...FACT, externalSettlementRef: "CR-2", amountMinor: 250000 };
    const verdict = refuse({ facts: [a, b], nonces: ["nonce-aaaaaaaaaaaaaaaa", "nonce-bbbbbbbbbbbbbbbb"] });
    expect(verdict.sufficient).toBe(true);
    if (!verdict.sufficient) throw new Error("unreachable");
    expect(verdict.settledMinor).toBe(550000);
  });
});

describe("stage 8 · authorisation is not settlement", () => {
  it("refuses an authorisation: a reservation is not money", () => {
    const v = refuse({
      facts: [{ ...FACT, sourceSystem: "acme-psp", sourceKind: "psp", finality: "AUTHORIZED" }],
    });
    expect(v).toMatchObject({ sufficient: false, code: "SETTLEMENT_NOT_FINAL" });
  });

  // THE LOAD-BEARING EXCLUSION: a capture is the COMPANY's own instruction, so counting it would let the
  // beneficiary's own action substantiate the beneficiary's own claim.
  it("refuses a capture, because the company issues it", () => {
    const v = refuse({
      facts: [{ ...FACT, sourceSystem: "acme-psp", sourceKind: "psp", finality: "CAPTURED" }],
    });
    expect(v).toMatchObject({ sufficient: false, code: "SETTLEMENT_NOT_FINAL" });
  });

  it("holds exactly two states final, and they are the two that assert arrival", () => {
    expect([...FINAL_SETTLEMENT_STATES]).toEqual(["PSP_SETTLED", "BANK_CREDITED"]);
    expect(SETTLEMENT_FINALITY_STATES.filter(settlementIsFinal)).toHaveLength(2);
    // FIVE STATES, not a boolean. Collapsing them would let AUTHORIZED wear BANK_CREDITED's guarantee.
    expect(SETTLEMENT_FINALITY_STATES).toHaveLength(5);
  });

  it("refuses a bank asserting an authorisation: the source could not know the fact", () => {
    const v = refuse({ facts: [{ ...FACT, finality: "AUTHORIZED" }] });
    expect(v).toMatchObject({
      sufficient: false, code: "SETTLEMENT_FINALITY_NOT_ASSERTABLE_BY_SOURCE",
    });
  });

  it("refuses a reversal outright, ahead of any arithmetic", () => {
    const v = refuse({
      facts: [FACT, { ...FACT, externalSettlementRef: "CR-2", finality: "REVERSED" }],
      nonces: ["nonce-aaaaaaaaaaaaaaaa", "nonce-bbbbbbbbbbbbbbbb"],
    });
    expect(v).toMatchObject({ sufficient: false, code: "SETTLEMENT_REVERSED" });
    if (v.sufficient) throw new Error("unreachable");
    expect(v.reason).toContain("new linked proof revision");
  });
});

describe("stage 8 · tenant isolation", () => {
  it("refuses a fact naming another tenant, BEFORE anything about the money", () => {
    // The amount is also wrong here. The tenant refusal must win, or the reason would describe the
    // wrong tenant's figures.
    const v = refuse({ facts: [{ ...FACT, boundaryId: "b-beta", amountMinor: 1 }] });
    expect(v).toMatchObject({ sufficient: false, code: "SETTLEMENT_TENANT_MISMATCH" });
  });

  it("puts the tenant inside the settlement identity, so one money cannot span tenants", () => {
    expect(settlementIdentity(FACT)).not.toBe(settlementIdentity({ ...FACT, boundaryId: "b-beta" }));
    expect(settlementIdentity(FACT).startsWith(`${SETTLEMENT_ATTESTATION_SCHEME}\u0000`)).toBe(true);
  });
});

describe("stage 8 · duplicates and double counting", () => {
  it("counts one settlement ONCE when it is attested twice", () => {
    const v = refuse({
      facts: [FACT, { ...FACT }],
      nonces: ["nonce-aaaaaaaaaaaaaaaa", "nonce-bbbbbbbbbbbbbbbb"],
    });
    expect(v.sufficient).toBe(true);
    if (!v.sufficient) throw new Error("unreachable");
    // 550000, NOT 1100000. Summing by record rather than by identity is how a figure doubles.
    expect(v.settledMinor).toBe(550000);
    expect(v.identities).toHaveLength(1);
  });

  it("refuses a settlement that already substantiates another claim", () => {
    const v = refuse({ identitiesAlreadySubstantiating: [settlementIdentity(FACT)] });
    expect(v).toMatchObject({ sufficient: false, code: "SETTLEMENT_ALREADY_SUBSTANTIATED" });
  });

  // THE SUBTLEST RULE: a provider payout and a bank credit are routinely the SAME money under two
  // references, and nothing in either record establishes otherwise.
  it("refuses to sum across two external source systems", () => {
    const psp = {
      ...FACT, sourceSystem: "acme-psp", sourceKind: "psp" as const, finality: "PSP_SETTLED" as const,
      externalSettlementRef: "PO-5", amountMinor: 275000,
    };
    const bank = { ...FACT, amountMinor: 275000 };
    const v = refuse({ facts: [psp, bank], nonces: ["nonce-aaaaaaaaaaaaaaaa", "nonce-bbbbbbbbbbbbbbbb"] });
    expect(v).toMatchObject({ sufficient: false, code: "SETTLEMENT_SOURCES_NOT_SUMMABLE" });
  });

  it("refuses a replayed attestation nonce", () => {
    const v = refuse({ seenNonces: ["nonce-aaaaaaaaaaaaaaaa"] });
    expect(v).toMatchObject({ sufficient: false, code: "SETTLEMENT_ATTESTATION_REPLAYED" });
    if (v.sufficient) throw new Error("unreachable");
    expect(v.reason).toContain("freshness alone");
  });

  it("refuses when a fact carries no nonce, so replay cannot be checked at all", () => {
    const v = refuse({ nonces: [] });
    expect(v).toMatchObject({ sufficient: false, code: "SETTLEMENT_FACT_MALFORMED" });
  });
});

describe("stage 8 · attribution and arithmetic", () => {
  it("refuses a settlement referencing a different corrective invoice", () => {
    const v = refuse({ facts: [{ ...FACT, correctiveInvoiceRef: "CN-OTHER" }] });
    expect(v).toMatchObject({ sufficient: false, code: "SETTLEMENT_REFERENCE_MISMATCH" });
  });

  it("refuses a settlement whose external payer is not the case's payer", () => {
    const v = refuse({ facts: [{ ...FACT, payerExternalRef: "PAYER-OTHER" }] });
    expect(v).toMatchObject({ sufficient: false, code: "SETTLEMENT_PAYER_MISMATCH" });
  });

  it("refuses a different currency, and converts nothing", () => {
    const v = refuse({ facts: [{ ...FACT, currency: "EUR" }] });
    expect(v).toMatchObject({ sufficient: false, code: "SETTLEMENT_CURRENCY_MISMATCH" });
  });

  it("refuses a shortfall and names both figures", () => {
    const v = refuse({ claimedCollectedMinor: 600000 });
    expect(v).toMatchObject({ sufficient: false, code: "SETTLEMENT_AMOUNT_INSUFFICIENT" });
    if (v.sufficient) throw new Error("unreachable");
    expect(v.reason).toContain("550000");
    expect(v.reason).toContain("600000");
  });

  it("accepts an overshoot, because more arriving is not less evidence", () => {
    expect(refuse({ claimedCollectedMinor: 400000 }).sufficient).toBe(true);
  });

  it("refuses money that cleared BEFORE the correction was raised", () => {
    const v = refuse({ correctionRaisedAt: "2026-03-12T00:00:00.000Z" });
    expect(v).toMatchObject({ sufficient: false, code: "SETTLEMENT_PRECEDES_CORRECTION" });
    if (v.sufficient) throw new Error("unreachable");
    expect(v.reason).toContain("never proof of causation");
  });

  it("refuses a value date in the future", () => {
    const v = refuse({ now: "2026-03-01T00:00:00.000Z", correctionRaisedAt: "2026-02-01T00:00:00.000Z" });
    expect(v).toMatchObject({ sufficient: false, code: "SETTLEMENT_VALUE_DATE_IN_FUTURE" });
  });
});

describe("stage 8 · fail closed", () => {
  it("refuses when the feature is not enabled, and says so by name", () => {
    const v = refuse({ enabled: false });
    expect(v).toMatchObject({ sufficient: false, code: "EXTERNAL_SETTLEMENT_NOT_ENABLED" });
  });

  it("refuses when nothing external was cited", () => {
    const v = refuse({ facts: [], nonces: [] });
    expect(v).toMatchObject({ sufficient: false, code: "NO_EXTERNAL_SETTLEMENT_EVIDENCE" });
  });

  it.each([
    ["an empty reference", { externalSettlementRef: "" }],
    ["a padded reference", { externalSettlementRef: " CR-1 " }],
    ["a control character", { externalSettlementRef: "CR\u00001" }],
    ["an over-long reference", { externalSettlementRef: "x".repeat(257) }],
    ["a zero amount", { amountMinor: 0 }],
    ["a negative amount", { amountMinor: -1 }],
    ["a fractional amount", { amountMinor: 1.5 }],
    ["an unknown source kind", { sourceKind: "wallet" as unknown as "bank" }],
    ["an unknown finality", { finality: "DONE" as unknown as "BANK_CREDITED" }],
    ["a non-date value date", { valueDate: "last Tuesday" }],
  ])("refuses %s", (_name, over) => {
    const v = refuse({ facts: [{ ...FACT, ...over }] });
    expect(v.sufficient).toBe(false);
    if (v.sufficient) throw new Error("unreachable");
    expect(["SETTLEMENT_FACT_MALFORMED", "SETTLEMENT_FINALITY_NOT_ASSERTABLE_BY_SOURCE"])
      .toContain(v.code);
  });

  it("never echoes a reference or an amount in a structural problem", () => {
    const problems = externalSettlementProblems({ ...FACT, externalSettlementRef: "SECRET-REF" });
    expect(problems.join(" ")).not.toContain("SECRET-REF");
  });

  it("refuses a malformed claimed amount", () => {
    const v = refuse({ claimedCollectedMinor: -1 });
    expect(v).toMatchObject({ sufficient: false, code: "SETTLEMENT_FACT_MALFORMED" });
  });
});

describe("stage 8 · the constants are pinned", () => {
  it("keeps its own scheme and method version", () => {
    expect(SETTLEMENT_ATTESTATION_SCHEME).toBe("nh-settlement-v1");
    expect(EXTERNAL_SETTLEMENT_METHOD_VERSION).toBe("xsa-2026.1");
    // NOT the evidence scheme. A shared id would let one payload verify as the other.
    expect(SETTLEMENT_ATTESTATION_SCHEME).not.toBe("nh-evidence-v1");
  });
});
