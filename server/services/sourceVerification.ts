import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { ForbiddenError } from "../http/errors";

export interface SourceAttestation { keyId: string; issuedAt: string; signature: string }
export interface EvidenceClaim {
  evidenceId: string; sourceSystem: string; sourceRecordId: string; evidenceType: string;
  observedAt: string; amountMinor?: number; currency?: string;
}
export interface SourceReceipt {
  method: string; keyId: string; issuedAt: string; verifiedAt: string; payloadSha256: string;
  signedPayload: string; signature: string; publicKeyPem: string;
}
export interface SourceTrustKey { keyId: string; sourceSystem: string; publicKey: string }

// Ordered, versioned tuple: no JSON object-key-order ambiguity and no caller-chosen URL.
export function sourceSigningPayload(caseId: string, claim: EvidenceClaim, issuedAt: string): Buffer {
  return Buffer.from(JSON.stringify(["nh-evidence-v1", caseId, claim.evidenceId,
    claim.sourceSystem, claim.sourceRecordId, claim.evidenceType, claim.observedAt,
    claim.amountMinor ?? null, claim.currency ?? null, issuedAt]), "utf8");
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
      publicKeyPem: trusted.key.export({ type: "spki", format: "pem" }).toString() };
  }
}

export function sourceVerifierFromEnvironment(env: Readonly<Record<string, string | undefined>>): SourceVerifier {
  const keys: unknown = JSON.parse(env.NH_EVIDENCE_SOURCE_KEYS ?? "[]");
  if (!Array.isArray(keys)) throw new Error("NH_EVIDENCE_SOURCE_KEYS must be an array");
  return new SourceVerifier(keys);
}
