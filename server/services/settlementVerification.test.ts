import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SETTLEMENT_SIGNATURE_MAX_AGE_MS,
  SETTLEMENT_SIGNATURE_MAX_SKEW_MS,
  SettlementVerifier,
  externalSettlementEnabled,
  settlementSigningPayload,
  settlementTrustKeysFromEnvironment,
  type SettlementTrustKey,
} from "./settlementVerification";
import { sourceSigningPayload, SourceVerifier } from "./sourceVerification";
import type { ExternalSettlementFact } from "../../src/domain/externalSettlement";

const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { pem: publicKey.export({ type: "spki", format: "pem" }).toString(), privateKey };
};

const BANK = pair();
const OTHER = pair();
const NOW = Date.parse("2026-03-15T00:00:00.000Z");

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

const REGISTRY: SettlementTrustKey[] = [
  { keyId: "k-bank", boundaryId: "b-alpha", sourceSystem: "acme-bank", sourceKind: "bank", publicKey: BANK.pem },
];

const verifier = (keys: readonly SettlementTrustKey[] = REGISTRY) =>
  new SettlementVerifier(keys, () => NOW);

const NONCE = "nonce-aaaaaaaaaaaaaaaa";
const ISSUED = "2026-03-14T00:00:00.000Z";

const attest = (
  fact: ExternalSettlementFact = FACT,
  over: { nonce?: string; issuedAt?: string; key?: typeof BANK.privateKey } = {},
) => {
  const nonce = over.nonce ?? NONCE;
  const issuedAt = over.issuedAt ?? ISSUED;
  return {
    keyId: "k-bank",
    issuedAt,
    nonce,
    signature: sign(null, settlementSigningPayload(fact, nonce, issuedAt), over.key ?? BANK.privateKey)
      .toString("base64"),
  };
};

describe("stage 8 · settlement verification · the positive control", () => {
  // Without this, every refusal below could be a verifier that rejects everything.
  it("verifies a correctly signed settlement and returns a receipt that names its scheme", () => {
    const receipt = verifier().verify(FACT, attest());
    expect(receipt.scheme).toBe("nh-settlement-v1");
    expect(receipt.method).toBe("ed25519-v1");
    expect(receipt.keyId).toBe("k-bank");
    expect(receipt.nonce).toBe(NONCE);
    expect(receipt.verifiedAt).toBe("2026-03-15T00:00:00.000Z");
    expect(receipt.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.publicKeyPem).toContain("BEGIN PUBLIC KEY");
  });
});

describe("stage 8 · forgery", () => {
  it("refuses a signature by a key that is not registered", () => {
    expect(() => verifier().verify(FACT, attest(FACT, { key: OTHER.privateKey })))
      .toThrow(/does not verify/);
  });

  it("refuses an unregistered keyId", () => {
    const a = { ...attest(), keyId: "k-unknown" };
    expect(() => verifier().verify(FACT, a)).toThrow(/not registered/);
  });

  it.each([
    ["the amount", { amountMinor: 999999 }],
    ["the currency", { currency: "EUR" }],
    ["the finality", { finality: "PSP_SETTLED" as const }],
    ["the settlement reference", { externalSettlementRef: "CR-TAMPERED" }],
    ["the corrective invoice reference", { correctiveInvoiceRef: "CN-OTHER" }],
    ["the payer", { payerExternalRef: "PAYER-OTHER" }],
    ["the value date", { valueDate: "2026-03-11T00:00:00.000Z" }],
    ["the tenant", { boundaryId: "b-beta" }],
  ])("refuses when %s is changed after signing", (_name, over) => {
    const signed = attest();
    // EVERY field is in the signed tuple, so altering any one breaks the signature. The tenant case
    // additionally trips the key binding, which is why it is asserted loosely here.
    expect(() => verifier().verify({ ...FACT, ...over }, signed)).toThrow();
  });

  it.each([
    ["too short", "x".repeat(10)],
    ["not base64", "!".repeat(88)],
    ["wrong length", "A".repeat(87) + "=="],
  ])("refuses a malformed signature (%s)", (_name, signature) => {
    expect(() => verifier().verify(FACT, { ...attest(), signature })).toThrow(/malformed/);
  });
});

describe("stage 8 · cross-scheme replay is structurally impossible", () => {
  // THE WHOLE REASON THIS IS A SEPARATE MODULE WITH ITS OWN SCHEME ID.
  it("refuses an EVIDENCE attestation presented as a settlement, even signed by the same key", () => {
    const claim = {
      evidenceId: "E-1", sourceSystem: "acme-bank", sourceRecordId: "CR-99001",
      evidenceType: "payment_received", observedAt: "2026-03-10T00:00:00.000Z",
      amountMinor: 550000, currency: "USD",
    };
    const signature = sign(null, sourceSigningPayload("RC-1", claim, ISSUED), BANK.privateKey)
      .toString("base64");
    expect(() => verifier().verify(FACT, { keyId: "k-bank", issuedAt: ISSUED, nonce: NONCE, signature }))
      .toThrow(/does not verify/);
  });

  // MUTATION M13 SURVIVED THE FIRST FORM OF THIS BLOCK, and the lesson is worth more than the test.
  // Removing the scheme id from the signed payload broke NOTHING: the two cross-scheme tests above
  // still passed, because an evidence payload and a settlement payload differ in SHAPE — 10 elements
  // against 13 — so they never collide whether the scheme id is there or not. Those tests proved the
  // two payloads differ, which is true for an incidental reason, and could not detect the removal of
  // the mechanism I claimed provided it. A test that passes for a reason other than the one it names
  // is the "a test that cannot fail is not a control" family in a subtler costume.
  //
  // THE ACTUAL CLAIM the scheme id makes is about a FUTURE scheme of the SAME shape: "the scheme is
  // inside the key so a future scheme cannot collide with this one even under the same key material".
  // This is that claim, and it fails the moment the scheme id leaves the payload.
  it("refuses a payload that differs from this scheme ONLY in its scheme id", () => {
    const forged = Buffer.from(
      JSON.stringify([
        "nh-settlement-v2",
        FACT.boundaryId, FACT.sourceSystem, FACT.sourceKind, FACT.externalSettlementRef,
        FACT.finality, FACT.amountMinor, FACT.currency, FACT.valueDate,
        FACT.correctiveInvoiceRef, FACT.payerExternalRef, NONCE, ISSUED,
      ]),
      "utf8",
    );
    // Same key, same tenant, same money, same nonce, same instant — one element different.
    const signature = sign(null, forged, BANK.privateKey).toString("base64");
    expect(() => verifier().verify(FACT, { keyId: "k-bank", issuedAt: ISSUED, nonce: NONCE, signature }))
      .toThrow(/does not verify/);
  });

  it("puts the scheme id FIRST in the payload, where a prefix cannot be confused for a field", () => {
    const payload = JSON.parse(settlementSigningPayload(FACT, NONCE, ISSUED).toString("utf8"));
    expect(payload[0]).toBe("nh-settlement-v1");
    expect(payload).toHaveLength(13);
  });

  it("refuses a SETTLEMENT attestation presented as evidence, in the other direction", () => {
    const evidenceVerifier = new SourceVerifier(
      [{ keyId: "k-bank", sourceSystem: "acme-bank", publicKey: BANK.pem }],
      () => NOW,
    );
    const claim = {
      evidenceId: "E-1", sourceSystem: "acme-bank", sourceRecordId: "CR-99001",
      evidenceType: "payment_received", observedAt: "2026-03-10T00:00:00.000Z",
      amountMinor: 550000, currency: "USD",
    };
    const issuedAt = new Date(NOW - 1000).toISOString();
    const signature = sign(null, settlementSigningPayload(FACT, NONCE, issuedAt), BANK.privateKey)
      .toString("base64");
    expect(() => evidenceVerifier.verify("RC-1", claim, { keyId: "k-bank", issuedAt, signature }))
      .toThrow(/invalid or expired/);
  });
});

describe("stage 8 · tenant isolation at the key layer", () => {
  it("refuses a key registered for another tenant, BEFORE checking the signature", () => {
    const beta: SettlementTrustKey = { ...REGISTRY[0]!, boundaryId: "b-beta" };
    // The signature is genuine; the key simply is not this tenant's. A valid signature by the wrong
    // party's key is worse than an invalid one, because it looks like evidence.
    expect(() => verifier([beta]).verify(FACT, attest())).toThrow(/not registered for this tenant/);
  });

  it("refuses a key registered for another source system", () => {
    const other: SettlementTrustKey = { ...REGISTRY[0]!, sourceSystem: "other-bank" };
    expect(() => verifier([other]).verify(FACT, attest())).toThrow(/not registered for this source system/);
  });

  it("refuses a key registered for another source kind", () => {
    const psp: SettlementTrustKey = { ...REGISTRY[0]!, sourceKind: "psp" };
    expect(() => verifier([psp]).verify(FACT, attest())).toThrow(/not registered for this source kind/);
  });
});

describe("stage 8 · the freshness window, and what it is NOT for", () => {
  it("accepts a signature from four weeks ago, so a monthly statement is usable", () => {
    const issuedAt = new Date(NOW - 28 * 24 * 60 * 60 * 1000).toISOString();
    expect(verifier().verify(FACT, attest(FACT, { issuedAt })).issuedAt).toBe(issuedAt);
  });

  it("refuses a signature older than the governed maximum", () => {
    const issuedAt = new Date(NOW - SETTLEMENT_SIGNATURE_MAX_AGE_MS - 1000).toISOString();
    expect(() => verifier().verify(FACT, attest(FACT, { issuedAt }))).toThrow(/stale/);
  });

  it("refuses a signature dated beyond the clock tolerance", () => {
    const issuedAt = new Date(NOW + SETTLEMENT_SIGNATURE_MAX_SKEW_MS + 1000).toISOString();
    expect(() => verifier().verify(FACT, attest(FACT, { issuedAt }))).toThrow(/future/);
  });

  it("refuses a non-normalised issuedAt, so two spellings cannot be one instant", () => {
    expect(() => verifier().verify(FACT, { ...attest(), issuedAt: "2026-03-14" }))
      .toThrow(/normalised ISO-8601/);
  });

  // THE WINDOW IS A STALENESS BOUND, NOT A REPLAY DEFENCE. A VALUE DATE far older than the signature is
  // ordinary — a bank signs a statement when it produces it — and the pure core, not this module,
  // decides what the dates mean.
  it("is indifferent to how old the VALUE DATE is", () => {
    const old = { ...FACT, valueDate: "2024-01-01T00:00:00.000Z" };
    expect(verifier().verify(old, attest(old)).scheme).toBe("nh-settlement-v1");
  });

  it("states a window long enough for a statement cycle and short of a year", () => {
    expect(SETTLEMENT_SIGNATURE_MAX_AGE_MS).toBeGreaterThan(28 * 24 * 60 * 60 * 1000);
    expect(SETTLEMENT_SIGNATURE_MAX_AGE_MS).toBeLessThan(365 * 24 * 60 * 60 * 1000);
  });
});

describe("stage 8 · the nonce", () => {
  it.each([["too short", "abc"], ["illegal characters", "nonce with spaces!!!!!"], ["empty", ""]])
    ("refuses a malformed nonce (%s)", (_name, nonce) => {
      expect(() => verifier().verify(FACT, { ...attest(), nonce })).toThrow(/nonce is malformed/);
    });

  it("binds the nonce into the signature, so it cannot be swapped", () => {
    const signed = attest();
    expect(() => verifier().verify(FACT, { ...signed, nonce: "nonce-bbbbbbbbbbbbbbbb" }))
      .toThrow(/does not verify/);
  });
});

describe("stage 8 · the registry refuses to be built wrong", () => {
  it.each([
    ["a blank keyId", { keyId: " " }],
    ["a blank boundary", { boundaryId: "" }],
    ["a blank source system", { sourceSystem: "" }],
    ["an unknown source kind", { sourceKind: "wallet" as unknown as "bank" }],
  ])("refuses %s", (_name, over) => {
    expect(() => verifier([{ ...REGISTRY[0]!, ...over }])).toThrow(/invalid settlement trust registry/);
  });

  it("refuses a duplicate keyId", () => {
    expect(() => verifier([REGISTRY[0]!, REGISTRY[0]!])).toThrow(/invalid settlement trust registry/);
  });

  it("refuses a non-Ed25519 key", () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(() => verifier([{ ...REGISTRY[0]!, publicKey: pem }])).toThrow();
  });

  it("defaults to an EMPTY registry, so an unconfigured build verifies nothing", () => {
    expect(settlementTrustKeysFromEnvironment({})).toEqual([]);
    expect(() => new SettlementVerifier([], () => NOW).verify(FACT, attest()))
      .toThrow(/not registered/);
  });

  it("refuses a registry that is not an array", () => {
    expect(() => settlementTrustKeysFromEnvironment({ NH_SETTLEMENT_SOURCE_KEYS: "{}" })).toThrow();
  });
});

describe("stage 8 · the feature flag", () => {
  it("is OFF when unset, so an existing build behaves exactly as it did", () => {
    expect(externalSettlementEnabled({})).toBe(false);
    expect(externalSettlementEnabled({ NH_EXTERNAL_SETTLEMENT_ENABLED: "false" })).toBe(false);
  });

  it("is ON only for the exact string", () => {
    expect(externalSettlementEnabled({ NH_EXTERNAL_SETTLEMENT_ENABLED: "true" })).toBe(true);
  });

  // NEVER COERCE. A typo must not silently decide a financial gate.
  it.each(["TRUE", "1", "yes", "on", ""])("throws on %o rather than coercing", (value) => {
    expect(() => externalSettlementEnabled({ NH_EXTERNAL_SETTLEMENT_ENABLED: value })).toThrow(
      /must be true or false/,
    );
  });
});
