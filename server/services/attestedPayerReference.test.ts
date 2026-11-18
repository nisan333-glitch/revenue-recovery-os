// G10 · THE SIGNING SCHEME THAT CARRIES THE PAYER, and the two directions of tampering it refuses.
//
// WHY THIS FILE EXISTS SEPARATELY FROM THE POSTGRES SUITE. The property that makes a source-attested
// payer reference an acceptable comparison target for stage 8 is cryptographic, not relational: the
// field cannot be inserted, removed or altered by anyone who does not hold the source system's private
// key. That is falsifiable without a database, so it is tested without one.
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_SIGNING_SCHEME_V1,
  EVIDENCE_SIGNING_SCHEME_V2,
  SourceVerifier,
  sourceSigningPayload,
  type EvidenceClaim,
} from "./sourceVerification";

const pair = generateKeyPairSync("ed25519");
const PEM = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
const OTHER = generateKeyPairSync("ed25519").privateKey;

const CASE = "RC-g10";
const KEY_ID = "SYNTHETIC-billing";
const verifier = () => new SourceVerifier([{ keyId: KEY_ID, sourceSystem: "billing", publicKey: PEM }]);

const claim = (over: Partial<EvidenceClaim> = {}): EvidenceClaim => ({
  evidenceId: "EV-1", sourceSystem: "billing", sourceRecordId: "CN-9120",
  evidenceType: "corrective_invoice_issued", observedAt: "2026-07-25T00:00:00.000Z", ...over,
});

const attest = (c: EvidenceClaim, key = pair.privateKey) => {
  const issuedAt = new Date().toISOString();
  return { keyId: KEY_ID, issuedAt, signature: sign(null, sourceSigningPayload(CASE, c, issuedAt), key).toString("base64") };
};

describe("G10 · the two signing schemes, selected by the claim's own shape", () => {
  it("a claim with NO payer reference signs v1, byte for byte as it always did", () => {
    // BACKWARD COMPATIBILITY AS A MEASUREMENT. Every signature any source system has ever produced was
    // made over this tuple; if its bytes moved, every historical attestation would stop verifying.
    const c = claim({ amountMinor: 1_320_000, currency: "USD" });
    const payload = sourceSigningPayload(CASE, c, "2026-07-26T00:00:00.000Z").toString("utf8");
    expect(JSON.parse(payload)).toEqual([
      EVIDENCE_SIGNING_SCHEME_V1, CASE, "EV-1", "billing", "CN-9120", "corrective_invoice_issued",
      "2026-07-25T00:00:00.000Z", 1_320_000, "USD", "2026-07-26T00:00:00.000Z",
    ]);
  });

  it("a claim WITH one signs v2 — the same tuple with the payer inserted before issuedAt", () => {
    // Inserted BEFORE the last element rather than appended after it, so v2 is v1 plus one element in
    // place rather than a reordering. A reordered tuple would silently re-interpret every position.
    const c = claim({ amountMinor: 1_320_000, currency: "USD", payerExternalRef: "PAYER-7781" });
    const payload = sourceSigningPayload(CASE, c, "2026-07-26T00:00:00.000Z").toString("utf8");
    expect(JSON.parse(payload)).toEqual([
      EVIDENCE_SIGNING_SCHEME_V2, CASE, "EV-1", "billing", "CN-9120", "corrective_invoice_issued",
      "2026-07-25T00:00:00.000Z", 1_320_000, "USD", "PAYER-7781", "2026-07-26T00:00:00.000Z",
    ]);
  });

  it("the positive control: each scheme verifies the claim it was signed for", () => {
    const v1 = claim();
    expect(verifier().verify(CASE, v1, attest(v1))).toMatchObject({ method: "ed25519-v1" });
    const v2 = claim({ payerExternalRef: "PAYER-7781" });
    expect(verifier().verify(CASE, v2, attest(v2)))
      .toMatchObject({ attestedPayerExternalRef: "PAYER-7781" });
  });
});

describe("G10 · neither direction of tampering survives", () => {
  it("ADDING a payer to a v1-signed claim fails — the field cannot be inserted by a transporter", () => {
    // THE ATTACK THE WHOLE DESIGN RESTS ON. If a caller could bolt a payer reference onto evidence the
    // source signed without one, they would be authoring the identity their own settlement must match.
    const signed = claim();
    const attestation = attest(signed);
    expect(() => verifier().verify(CASE, { ...signed, payerExternalRef: "PAYER-ATTACKER" }, attestation))
      .toThrow(/does not verify|invalid or expired/);
  });

  it("STRIPPING the payer from a v2-signed claim fails too", () => {
    const signed = claim({ payerExternalRef: "PAYER-7781" });
    const attestation = attest(signed);
    const { payerExternalRef: _dropped, ...stripped } = signed;
    expect(() => verifier().verify(CASE, stripped, attestation))
      .toThrow(/does not verify|invalid or expired/);
  });

  it("ALTERING the payer fails", () => {
    const signed = claim({ payerExternalRef: "PAYER-7781" });
    const attestation = attest(signed);
    expect(() => verifier().verify(CASE, { ...signed, payerExternalRef: "PAYER-0001" }, attestation))
      .toThrow(/does not verify|invalid or expired/);
  });

  it("a payer signed by the WRONG key fails", () => {
    const c = claim({ payerExternalRef: "PAYER-7781" });
    expect(() => verifier().verify(CASE, c, attest(c, OTHER))).toThrow(/does not verify|invalid or expired/);
  });

  it("a payer signed for ANOTHER CASE fails — the case id is inside the payload", () => {
    const c = claim({ payerExternalRef: "PAYER-7781" });
    const attestation = attest(c);
    expect(() => verifier().verify("RC-someone-else", c, attestation))
      .toThrow(/does not verify|invalid or expired/);
  });

  it("AN UNATTESTED CLAIM YIELDS NO RECEIPT, so a payer it carries is stored nowhere", () => {
    // The structural half: `attestedPayerExternalRef` lives inside the receipt, and there is no receipt
    // without a verified signature. An unsigned claim carrying a payer produces `undefined`, so no
    // stored shape can hold an unattested comparison target.
    expect(verifier().verify(CASE, claim({ payerExternalRef: "PAYER-UNSIGNED" }), undefined))
      .toBeUndefined();
  });

  it("the receipt omits the field entirely when the claim had none — absence is not an empty string", () => {
    const c = claim();
    const receipt = verifier().verify(CASE, c, attest(c))!;
    expect("attestedPayerExternalRef" in receipt).toBe(false);
  });
});
