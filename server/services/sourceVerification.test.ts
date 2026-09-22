import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SourceVerifier, sourceSigningPayload, sourceVerifierFromEnvironment } from "./sourceVerification";

const pair = generateKeyPairSync("ed25519");
const now = Date.parse("2026-09-22T00:00:00.000Z");
const issuedAt = new Date(now).toISOString();
const claim = { evidenceId: "ev", sourceSystem: "billing", sourceRecordId: "invoice-1", evidenceType: "invoice_paid",
  observedAt: "2026-09-21T00:00:00.000Z", amountMinor: 7000, currency: "USD" };
const key = { keyId: "provider-key-1", sourceSystem: "billing", publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString() };
const verifier = new SourceVerifier([key], () => now);
const attestation = { keyId: key.keyId, issuedAt, signature: sign(null, sourceSigningPayload("case-1", claim, issuedAt), pair.privateKey).toString("base64") };
describe("independent source attestations", () => {
  it("accepts an authentic case-bound envelope and records its digest", () => {
    expect(verifier.verify("case-1", claim, attestation)).toMatchObject({ method: "ed25519-v1", keyId: key.keyId, verifiedAt: issuedAt });
  });
  it("never grants independence to unsigned input", () => {
    expect(verifier.verify("case-1", claim)).toBeUndefined();
    expect(sourceVerifierFromEnvironment({}).verify("case-1", claim)).toBeUndefined();
  });
  it.each([{ amountMinor: 7001 }, { currency: "EUR" }, { sourceRecordId: "invoice-2" }, { evidenceId: "other" },
    { sourceSystem: "crm" }, { evidenceType: "payment_received" }, { observedAt: "2026-09-20T00:00:00.000Z" }])(
    "rejects changed claims: %j", (change) => {
      expect(() => verifier.verify("case-1", { ...claim, ...change }, attestation)).toThrow(/attestation/);
    });
  it("rejects cross-case replay, unknown issuer and malformed signature", () => {
    expect(() => verifier.verify("case-2", claim, attestation)).toThrow();
    expect(() => new SourceVerifier([]).verify("case-1", claim, attestation)).toThrow();
    expect(() => verifier.verify("case-1", claim, { ...attestation, signature: "fake" })).toThrow();
  });
  it.each([now + 300_001, now - 30_001])("rejects expired or future envelopes", (clock) => {
    expect(() => new SourceVerifier([key], () => clock).verify("case-1", claim, attestation)).toThrow();
  });
  it("rejects ambiguous trust configuration", () => {
    expect(() => new SourceVerifier([key, key])).toThrow();
    expect(() => sourceVerifierFromEnvironment({ NH_EVIDENCE_SOURCE_KEYS: "{}" })).toThrow();
  });
});
