// `NH_EVIDENCE_SOURCE_KEYS` · the configuration surface of the evidence trust registry.
//
// FOUND BY MEASUREMENT, NOT BY READING. `scripts/pilot-config/resolve-point-of-use.ts` resolved the
// variable through this production function with the value removed and the call threw
// `Unexpected end of JSON input` — a raw parser message naming no variable, on the path that decides
// whether any attestation can verify at all.
import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { sourceTrustKeysFromEnvironment, sourceVerifierFromEnvironment } from "./sourceVerification";

const pem = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
const ONE_KEY = JSON.stringify([{ keyId: "k1", sourceSystem: "billing", publicKey: pem }]);

describe("NH_EVIDENCE_SOURCE_KEYS resolution", () => {
  // ── BACKWARD COMPATIBILITY · every value that worked before must still work ─────────────────────
  it("absent resolves to no keys, exactly as it did before", () => {
    expect(sourceTrustKeysFromEnvironment({})).toEqual([]);
  });

  it("an explicit empty array resolves to no keys", () => {
    expect(sourceTrustKeysFromEnvironment({ NH_EVIDENCE_SOURCE_KEYS: "[]" })).toEqual([]);
  });

  it("a populated array is returned unchanged", () => {
    const keys = sourceTrustKeysFromEnvironment({ NH_EVIDENCE_SOURCE_KEYS: ONE_KEY });
    expect(keys).toHaveLength(1);
    expect(keys[0]?.keyId).toBe("k1");
  });

  it("a non-array JSON value is still refused by name", () => {
    expect(() => sourceTrustKeysFromEnvironment({ NH_EVIDENCE_SOURCE_KEYS: '{"keyId":"k1"}' }))
      .toThrow(/NH_EVIDENCE_SOURCE_KEYS must be an array/);
  });

  // ── THE DEFECT ─────────────────────────────────────────────────────────────────────────────────
  it("a BLANK value resolves to no keys rather than crashing", () => {
    // The ordinary case: a manifest with an unset templated variable.
    expect(sourceTrustKeysFromEnvironment({ NH_EVIDENCE_SOURCE_KEYS: "" })).toEqual([]);
    expect(sourceTrustKeysFromEnvironment({ NH_EVIDENCE_SOURCE_KEYS: "   " })).toEqual([]);
    expect(sourceTrustKeysFromEnvironment({ NH_EVIDENCE_SOURCE_KEYS: "\n\t " })).toEqual([]);
  });

  it("a malformed value names OUR variable and never echoes the value", () => {
    // THE SECOND HALF IS THE ONE THAT MATTERS. A parse error is free to quote the input, and this
    // input is the envelope of a deployment secret — so the assertion is that the token does NOT
    // appear, not merely that the message is friendlier.
    const secretish = '[{"keyId":"PROD-BILLING-ROTATED-2026","publicKey":"-----BEGIN';
    let message = "";
    try { sourceTrustKeysFromEnvironment({ NH_EVIDENCE_SOURCE_KEYS: secretish }); }
    catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/NH_EVIDENCE_SOURCE_KEYS/);
    expect(message).toMatch(/could not be parsed as JSON/);
    expect(message).not.toContain("PROD-BILLING-ROTATED-2026");
    expect(message).not.toContain("BEGIN");
    // And it is not the bare parser message any more.
    expect(message).not.toMatch(/Unexpected end of JSON input|Unexpected token/);
  });

  it("the blank case STILL cannot verify anything — the fix did not loosen a gate", () => {
    // `[]` is only safe because it is fail-closed downstream, so that is asserted rather than argued:
    // a verifier built from a blank variable has no key and so no attestation can be independent.
    const verifier = sourceVerifierFromEnvironment({ NH_EVIDENCE_SOURCE_KEYS: "" });
    expect(() => verifier.verify("RC-1", {
      evidenceId: "EV-1", sourceSystem: "billing", sourceRecordId: "R-1",
      evidenceType: "invoice_paid", observedAt: new Date().toISOString(),
      amountMinor: 1_000, currency: "USD",
    }, { keyId: "k1", issuedAt: new Date().toISOString(), signature: "x".repeat(86) + "==" }))
      .toThrow(/source attestation is invalid or expired/);
  });
});
