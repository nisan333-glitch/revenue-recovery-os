import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySettlementAgainstRegister } from "./registerBackedSettlementVerification";
import { settlementSigningPayload } from "./settlementVerification";
import type { RegisteredSettlementKey, SettlementKeyRegister } from "./settlementKeyGovernance";
import { hashSettlementKey } from "../../src/contract/settlementKeyWitness";
import type { SettlementKeyEvent, SettlementKeyFacts } from "../../src/contract/settlementKeyLifecycle";
import type { ExternalSettlementFact } from "../../src/domain/externalSettlement";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const OTHER = generateKeyPairSync("ed25519");

const KEY: SettlementKeyFacts = Object.freeze({
  keyId: "k-bank-01", boundaryId: "b-alpha", sourceSystem: "acme-bank", sourceKind: "bank",
  publicKey: PEM, validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z",
});

const FACT: ExternalSettlementFact = Object.freeze({
  boundaryId: "b-alpha", sourceSystem: "acme-bank", sourceKind: "bank",
  externalSettlementRef: "CR-99001", finality: "BANK_CREDITED", amountMinor: 550000,
  currency: "USD", valueDate: "2026-03-10T00:00:00.000Z",
  correctiveInvoiceRef: "CN-9120", payerExternalRef: "PAYER-7781",
});

const NONCE = "nonce-aaaaaaaaaaaaaaaa";
const SIGNED_AT = "2026-03-15T00:00:00.000Z";
const NOW = "2026-03-16T00:00:00.000Z";

const ev = (transition: SettlementKeyEvent["transition"], at: string, over: Partial<SettlementKeyEvent> = {})
  : SettlementKeyEvent => ({ transition, at, actorId: "a", actorRole: "steward", rationale: "r", ...over });

const LIVE: SettlementKeyEvent[] = [
  ev("PROPOSED", "2026-02-01T00:00:00.000Z"), ev("ACTIVATED", "2026-02-02T00:00:00.000Z"),
];

const attest = (over: { key?: typeof privateKey; issuedAt?: string } = {}) => {
  const issuedAt = over.issuedAt ?? SIGNED_AT;
  return {
    keyId: "k-bank-01", issuedAt, nonce: NONCE,
    signature: sign(null, settlementSigningPayload(FACT, NONCE, issuedAt), over.key ?? privateKey)
      .toString("base64"),
  };
};

async function registerWith(
  events: SettlementKeyEvent[] = LIVE,
  facts: SettlementKeyFacts = KEY,
  witnessOverride?: string,
): Promise<SettlementKeyRegister> {
  const row: RegisteredSettlementKey = {
    facts, witness: witnessOverride ?? (await hashSettlementKey(facts)),
    evidence: { channelIndependentlyVerified: true,
      keyControlDemonstrated: true, ceremonyRecorded: true },
    registeredByActorId: "op-1", events,
  };
  return {
    async read(keyId) { return keyId === facts.keyId ? row : null; },
    async insertKey() { throw new Error("not used"); },
    async appendEvent() { throw new Error("not used"); },
  };
}

describe("G4 · verification resolves from the register, not an environment variable", () => {
  it("is the positive control: an in-force key verifies and carries its compromise status", async () => {
    const out = await verifySettlementAgainstRegister(await registerWith(), FACT, attest(), NOW);
    expect(out.receipt.scheme).toBe("nh-settlement-v1");
    expect(out.receipt.keyId).toBe("k-bank-01");
    expect(out.key).toEqual(KEY);
    expect(out.compromise.status).toBe("NOT_APPLICABLE");
  });

  it("refuses a key that is not in the register at all", async () => {
    const empty: SettlementKeyRegister = {
      async read() { return null; },
      async insertKey() { throw new Error("x"); }, async appendEvent() { throw new Error("x"); },
    };
    await expect(verifySettlementAgainstRegister(empty, FACT, attest(), NOW))
      .rejects.toThrow(/not registered/);
  });

  // THE REGISTER ROW IS NOT TRUSTED AS STORED. A migration or a restore that swapped the public key
  // keeps the stored witness, and this is the case the witness exists to detect.
  it("refuses a register row whose witness no longer matches its values", async () => {
    const swapped: SettlementKeyFacts = { ...KEY, publicKey: OTHER.publicKey.export({ type: "spki", format: "pem" }).toString() };
    const stale = await hashSettlementKey(KEY);
    await expect(verifySettlementAgainstRegister(await registerWith(LIVE, swapped, stale), FACT, attest(), NOW))
      .rejects.toThrow(/KEY_WITNESS_MISMATCH/);
  });

  it("builds its trust set from the ONE resolved row, so another key cannot satisfy the signature", async () => {
    // Signed by a key that is not the registered one. A verifier holding a wider registry could have
    // accepted this; a one-key verifier structurally cannot.
    await expect(verifySettlementAgainstRegister(await registerWith(), FACT, attest({ key: OTHER.privateKey }), NOW))
      .rejects.toThrow(/does not verify/);
  });
});

describe("G4 · the two questions are answered separately, and in order", () => {
  // QUESTION 1 · historical. A key retired on schedule still verifies what it signed while active —
  // this is what makes a frozen proof reproducible forever.
  it("accepts an attestation signed while ACTIVE even though the key is now RETIRED", async () => {
    const retired = [...LIVE, ev("RETIRED", "2026-03-16T00:00:00.000Z")];
    const out = await verifySettlementAgainstRegister(await registerWith(retired), FACT, attest(), "2026-04-01T00:00:00.000Z");
    expect(out.receipt.keyId).toBe("k-bank-01");
  });

  it("refuses an attestation signed before the key was activated", async () => {
    await expect(verifySettlementAgainstRegister(
      await registerWith(), FACT, attest({ issuedAt: "2026-02-01T12:00:00.000Z" }), NOW,
    )).rejects.toThrow(/SETTLEMENT_KEY_NOT_ACTIVE_AT_SIGNING/);
  });

  it("refuses an attestation signed after the declared window closed, by its own code", async () => {
    const long = [...LIVE, ev("RETIRED", "2028-01-01T00:00:00.000Z")];
    await expect(verifySettlementAgainstRegister(
      await registerWith(long), FACT, attest({ issuedAt: "2027-06-01T00:00:00.000Z" }), "2027-06-02T00:00:00.000Z",
    )).rejects.toThrow(/SETTLEMENT_KEY_EXPIRED/);
  });

  // QUESTION 2 · current. (1) alone would let a compromised key keep minting NEW proofs, because it
  // WAS in force when it signed. This is the separation the whole module exists for.
  it("refuses a NEW verification under a key revoked as compromised, though it WAS in force then", async () => {
    const revoked = [...LIVE, ev("REVOKED_COMPROMISED", "2026-03-16T00:00:00.000Z", { exposureFrom: null })];
    await expect(verifySettlementAgainstRegister(await registerWith(revoked), FACT, attest(), "2026-04-01T00:00:00.000Z"))
      .rejects.toThrow(/SETTLEMENT_KEY_REVOKED_COMPROMISED/);
  });

  it("says in that refusal that frozen proofs are flagged rather than rewritten", async () => {
    const revoked = [...LIVE, ev("REVOKED_COMPROMISED", "2026-03-16T00:00:00.000Z", { exposureFrom: null })];
    await expect(verifySettlementAgainstRegister(await registerWith(revoked), FACT, attest(), "2026-04-01T00:00:00.000Z"))
      .rejects.toThrow(/flagged\s+rather than rewritten/);
  });

  // THE ORDER MATTERS AND IS ASSERTED. A withdrawal of support must never report itself as the record
  // having changed, so the historical question is answered first and reports its own code.
  it("reports the HISTORICAL refusal when both questions would fail", async () => {
    const revoked = [...LIVE, ev("REVOKED_COMPROMISED", "2026-03-16T00:00:00.000Z", { exposureFrom: null })];
    await expect(verifySettlementAgainstRegister(
      await registerWith(revoked), FACT, attest({ issuedAt: "2026-02-01T12:00:00.000Z" }), "2026-04-01T00:00:00.000Z",
    )).rejects.toThrow(/SETTLEMENT_KEY_NOT_ACTIVE_AT_SIGNING/);
  });

  it("refuses when the register row's own lifecycle log is unusable", async () => {
    // A log with no birth. `validAt` reports it first, which is correct — the row is unusable either
    // way, and naming the lifecycle problem sends a reader to the record rather than to the key's state.
    await expect(verifySettlementAgainstRegister(await registerWith([]), FACT, attest(), NOW))
      .rejects.toThrow(/KEY_NEVER_PROPOSED/);
  });
});

describe("G4 · the compromise status travels with the receipt", () => {
  it("flags an attestation inside a KNOWN exposure window without refusing the signature", async () => {
    // Revoked AFTER `now`, so the current-state check passes and only the assessment speaks.
    const revoked = [...LIVE, ev("REVOKED_COMPROMISED", "2026-03-20T00:00:00.000Z",
      { exposureFrom: "2026-03-14T00:00:00.000Z" })];
    const out = await verifySettlementAgainstRegister(await registerWith(revoked), FACT, attest(), "2026-03-17T00:00:00.000Z");
    expect(out.compromise.status).toBe("FLAGGED_COMPROMISED_WINDOW");
    expect(out.compromise.exposureStartUnknown).toBe(false);
  });

  it("leaves an attestation before the exposure window UNAFFECTED", async () => {
    const revoked = [...LIVE, ev("REVOKED_COMPROMISED", "2026-03-20T00:00:00.000Z",
      { exposureFrom: "2026-03-16T00:00:00.000Z" })];
    const out = await verifySettlementAgainstRegister(await registerWith(revoked), FACT, attest(), "2026-03-17T00:00:00.000Z");
    expect(out.compromise.status).toBe("UNAFFECTED");
  });
});
