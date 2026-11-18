import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { ForbiddenError } from "../http/errors";

export interface SourceAttestation { keyId: string; issuedAt: string; signature: string }
export interface EvidenceClaim {
  evidenceId: string; sourceSystem: string; sourceRecordId: string; evidenceType: string;
  observedAt: string; amountMinor?: number; currency?: string;
  /**
   * G10 · WHO THE SOURCE SYSTEM SAYS THE PAYER IS, in the external world's own terms.
   *
   * WHY IT IS HERE AND NOT ON THE CASE. Stage 8 compares a bank's attestation against the payer this
   * case concerns, and the case holds only NH's own HMAC pseudonym, which a bank cannot name. The
   * detector's raw `payerRef` is no better: it comes from the CUSTOMER'S OWN EXTRACT, so sourcing it
   * from there would be the beneficiary stating the identity their own evidence must match.
   *
   * A SOURCE SYSTEM'S SIGNED CLAIM IS THE ONE CHANNEL THAT IS NEITHER. The billing or ERP system signs
   * with a key NH holds only the public half of and the customer's team does not hold at all, so the
   * payer reference arrives attested by an institution rather than asserted by a beneficiary. The
   * comparison stage 8 then performs is between TWO INDEPENDENT INSTITUTIONAL STATEMENTS — billing's
   * and the bank's — rather than between an attestation and a string NH was handed.
   *
   * OPTIONAL, AND ITS ABSENCE IS NOT A DEFAULT. A claim without it signs exactly as it always did; a
   * case with no attested payer reference leaves the settlement path REFUSING. Nothing is inferred.
   */
  payerExternalRef?: string;
}
export interface SourceReceipt {
  method: string; keyId: string; issuedAt: string; verifiedAt: string; payloadSha256: string;
  signedPayload: string; signature: string; publicKeyPem: string;
  /**
   * G10 · the payer reference THIS SIGNATURE COVERED, present only when the claim carried one.
   *
   * IT LIVES ON THE RECEIPT, NOT BESIDE IT, and that placement is the control. A receipt is NH's
   * record of what it verified, so a payer reference here is one the signature was checked over —
   * there is no shape in which an unattested payer can be stored, because the only field that holds
   * one is inside the object that exists only after a signature verified. That is strictly stronger
   * than a separate column with a CHECK constraint saying the same thing, and it needs no migration:
   * `EvidenceRecord.sourceVerification` is already `Json?` and already append-only by trigger.
   */
  attestedPayerExternalRef?: string;
}
export interface SourceTrustKey { keyId: string; sourceSystem: string; publicKey: string }

// Ordered, versioned tuple: no JSON object-key-order ambiguity and no caller-chosen URL.
//
// TWO SCHEMES, SELECTED BY THE CLAIM'S OWN SHAPE, and that is what makes G10 backward compatible
// WITHOUT weakening anything:
//
//   * a claim with NO payer reference signs the v1 tuple, byte for byte as it always did, so every
//     signature any source system has ever produced still verifies and no source has to change;
//   * a claim WITH one signs v2, which includes it.
//
// NEITHER DIRECTION OF TAMPERING SURVIVES, which is the property that matters. Adding a payer
// reference to a v1-signed claim makes the verifier build the v2 tuple, so the stored signature no
// longer matches; stripping one from a v2-signed claim makes it build v1, and that fails too. The
// field cannot be inserted by anyone who does not hold the source's private key — which is the whole
// reason it is an acceptable origin for a comparison target.
export const EVIDENCE_SIGNING_SCHEME_V1 = "nh-evidence-v1";
export const EVIDENCE_SIGNING_SCHEME_V2 = "nh-evidence-v2";

export function sourceSigningPayload(caseId: string, claim: EvidenceClaim, issuedAt: string): Buffer {
  const base = [caseId, claim.evidenceId, claim.sourceSystem, claim.sourceRecordId,
    claim.evidenceType, claim.observedAt, claim.amountMinor ?? null, claim.currency ?? null];
  // `issuedAt` stays LAST in both tuples and the new field is inserted before it, so v2 is v1 with one
  // element added rather than a reordering — a reordered tuple would silently re-interpret positions.
  return claim.payerExternalRef === undefined
    ? Buffer.from(JSON.stringify([EVIDENCE_SIGNING_SCHEME_V1, ...base, issuedAt]), "utf8")
    : Buffer.from(
        JSON.stringify([EVIDENCE_SIGNING_SCHEME_V2, ...base, claim.payerExternalRef, issuedAt]),
        "utf8",
      );
}

export class SourceVerifier {
  private readonly keys = new Map<string, { sourceSystem: string; key: KeyObject }>();
  constructor(keys: readonly SourceTrustKey[], private readonly now: () => number = Date.now) {
    for (const item of keys) {
      if (!item.keyId?.trim() || !item.sourceSystem?.trim() || this.keys.has(item.keyId)) throw new Error("invalid source trust registry");
      const key = createPublicKey(item.publicKey);
      if (key.asymmetricKeyType !== "ed25519") throw new Error("source trust keys must be Ed25519");
      this.keys.set(item.keyId, { sourceSystem: item.sourceSystem, key });
    }
  }

  verify(caseId: string, claim: EvidenceClaim, attestation?: SourceAttestation): SourceReceipt | undefined {
    if (!attestation) return undefined;
    const trusted = this.keys.get(attestation.keyId);
    const issued = Date.parse(attestation.issuedAt);
    const now = this.now();
    if (!trusted || trusted.sourceSystem !== claim.sourceSystem || !Number.isFinite(issued)
      || new Date(issued).toISOString() !== attestation.issuedAt || issued > now + 30_000 || now - issued > 300_000
      || !/^[A-Za-z0-9+/]{86}==$/.test(attestation.signature)) {
      throw new ForbiddenError("source attestation is invalid or expired");
    }
    const payload = sourceSigningPayload(caseId, claim, attestation.issuedAt);
    if (!verify(null, payload, trusted.key, Buffer.from(attestation.signature, "base64"))) {
      throw new ForbiddenError("source attestation is invalid or expired");
    }
    return { method: "ed25519-v1", keyId: attestation.keyId, issuedAt: attestation.issuedAt,
      verifiedAt: new Date(now).toISOString(), payloadSha256: createHash("sha256").update(payload).digest("hex"),
      signedPayload: payload.toString("utf8"), signature: attestation.signature,
      publicKeyPem: trusted.key.export({ type: "spki", format: "pem" }).toString(),
      // Carried only when the claim had one, so the field's PRESENCE already means "a signature
      // covered this". `payload` above is the v2 tuple in exactly that case.
      ...(claim.payerExternalRef === undefined ? {} : { attestedPayerExternalRef: claim.payerExternalRef }) };
  }
}

export function sourceTrustKeysFromEnvironment(env: Readonly<Record<string, string | undefined>>): SourceTrustKey[] {
  const keys: unknown = JSON.parse(env.NH_EVIDENCE_SOURCE_KEYS ?? "[]");
  if (!Array.isArray(keys)) throw new Error("NH_EVIDENCE_SOURCE_KEYS must be an array");
  return keys;
}

export function sourceVerifierFromEnvironment(env: Readonly<Record<string, string | undefined>>): SourceVerifier {
  return new SourceVerifier(sourceTrustKeysFromEnvironment(env));
}
