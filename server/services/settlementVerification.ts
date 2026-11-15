// STAGE 8 · the server half — verifying that an EXTERNAL party signed the settlement fact.
//
// A SEPARATE MODULE, NOT A WIDENING OF `sourceVerification.ts`. That module verifies an EVIDENCE claim
// under `nh-evidence-v1` and every existing proof rests on it. Changing its payload or its window would
// change what every historical receipt means. This is an additive sibling with its own scheme id, its
// own registry shape and its own freshness policy — the pattern the expectation extract and Detector #2
// established.
//
// WHY THE FRESHNESS POLICY DIFFERS, which is the whole reason a second module was necessary.
// `sourceVerification` refuses an attestation older than FIVE MINUTES. That is correct for a live
// connector signing on demand, and it makes a settlement statement UNUSABLE: a bank signs a statement
// when it produces it, and the submission happens hours or days later. The audit named this as blocker
// A3. The resolution is not a longer window alone — a window is a weak replay defence at any length —
// but to separate the two jobs the single window was doing:
//
//   REPLAY is defended by a single-use NONCE inside the signed payload, checked against persisted state.
//   STALENESS is a separate, generous bound, so a monthly statement is usable and a years-old signature
//   is still refused with its own code.
//
// AND TWO TIMES STAY DISTINGUISHABLE. `issuedAt` is when the attestation was SIGNED; `valueDate` is when
// the money CLEARED. The value date may be far older than the signature and that is normal. What is
// forbidden is the reverse — a settlement attested before it happened — and the pure core refuses it.

import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { ForbiddenError } from "../http/errors";
import {
  SETTLEMENT_ATTESTATION_SCHEME,
  SETTLEMENT_SOURCE_KINDS,
  type ExternalSettlementFact,
  type SettlementSourceKind,
} from "../../src/domain/externalSettlement";

/**
 * How old a settlement SIGNATURE may be. Thirty days, because a statement cycle is monthly and a
 * submission a few days after the statement is ordinary operations rather than a sign of tampering.
 * Replay is not this constant's job — the nonce's uniqueness is — so making it generous costs nothing
 * and making it five minutes would refuse every real bank statement.
 */
export const SETTLEMENT_SIGNATURE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Tolerance for a signer's clock running ahead. Beyond it, a future-dated signature is refused. */
export const SETTLEMENT_SIGNATURE_MAX_SKEW_MS = 30_000;

export interface SettlementAttestation {
  readonly keyId: string;
  readonly issuedAt: string;
  /** Single-use. The replay defence, checked against persisted state by the caller. */
  readonly nonce: string;
  readonly signature: string;
}

/**
 * A registered external signing key.
 *
 * BOUND TO A BOUNDARY AS WELL AS A SOURCE SYSTEM. The tenant is inside the signed payload, so a
 * signature cannot be moved between tenants — but a key shared across tenants could still SIGN for
 * either. Binding the key to one boundary closes that, which is the tenant isolation requirement taken
 * at the key layer rather than only at the payload layer.
 */
export interface SettlementTrustKey {
  readonly keyId: string;
  readonly boundaryId: string;
  readonly sourceSystem: string;
  readonly sourceKind: SettlementSourceKind;
  readonly publicKey: string;
}

export interface SettlementReceipt {
  readonly method: string;
  readonly scheme: string;
  readonly keyId: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly verifiedAt: string;
  readonly payloadSha256: string;
  readonly signedPayload: string;
  readonly signature: string;
  readonly publicKeyPem: string;
}

/**
 * The signed sentence. An ORDERED, VERSIONED TUPLE rather than an object, so there is no JSON key-order
 * ambiguity and no caller-chosen shape — the same reasoning as `sourceSigningPayload`, and the scheme id
 * is the FIRST element so a payload of one scheme can never verify as another.
 */
export function settlementSigningPayload(
  fact: ExternalSettlementFact,
  nonce: string,
  issuedAt: string,
): Buffer {
  return Buffer.from(
    JSON.stringify([
      SETTLEMENT_ATTESTATION_SCHEME,
      fact.boundaryId,
      fact.sourceSystem,
      fact.sourceKind,
      fact.externalSettlementRef,
      fact.finality,
      fact.amountMinor,
      fact.currency,
      fact.valueDate,
      fact.correctiveInvoiceRef,
      fact.payerExternalRef,
      nonce,
      issuedAt,
    ]),
    "utf8",
  );
}

export class SettlementVerifier {
  private readonly keys = new Map<string, { readonly entry: SettlementTrustKey; readonly key: KeyObject }>();

  constructor(keys: readonly SettlementTrustKey[], private readonly now: () => number = Date.now) {
    for (const entry of keys) {
      if (
        !entry.keyId?.trim() || !entry.boundaryId?.trim() || !entry.sourceSystem?.trim()
        || !SETTLEMENT_SOURCE_KINDS.includes(entry.sourceKind) || this.keys.has(entry.keyId)
      ) {
        throw new Error("invalid settlement trust registry");
      }
      const key = createPublicKey(entry.publicKey);
      if (key.asymmetricKeyType !== "ed25519") throw new Error("settlement trust keys must be Ed25519");
      this.keys.set(entry.keyId, { entry, key });
    }
  }

  /**
   * Verify one attestation against one fact.
   *
   * FAILS CLOSED AND THROWS, never returns a partial result: a caller that received a falsy value could
   * carry on. Every refusal is a `ForbiddenError`, and the message says which check failed without ever
   * echoing an amount or a reference — a refusal reaches operators, and the external references are
   * customer data.
   */
  verify(fact: ExternalSettlementFact, attestation: SettlementAttestation): SettlementReceipt {
    const trusted = this.keys.get(attestation.keyId);
    if (trusted === undefined) {
      throw new ForbiddenError("settlement attestation key is not registered");
    }
    // THE KEY'S OWN BINDINGS, CHECKED BEFORE THE SIGNATURE. A valid signature by the wrong party's key
    // is worse than an invalid one, because it looks like evidence.
    if (trusted.entry.boundaryId !== fact.boundaryId) {
      throw new ForbiddenError("settlement attestation key is not registered for this tenant");
    }
    if (trusted.entry.sourceSystem !== fact.sourceSystem) {
      throw new ForbiddenError("settlement attestation key is not registered for this source system");
    }
    if (trusted.entry.sourceKind !== fact.sourceKind) {
      throw new ForbiddenError("settlement attestation key is not registered for this source kind");
    }
    if (typeof attestation.nonce !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(attestation.nonce)) {
      throw new ForbiddenError("settlement attestation nonce is malformed");
    }
    const issued = Date.parse(attestation.issuedAt);
    const now = this.now();
    if (!Number.isFinite(issued) || new Date(issued).toISOString() !== attestation.issuedAt) {
      throw new ForbiddenError("settlement attestation issuedAt is not a normalised ISO-8601 instant");
    }
    if (issued > now + SETTLEMENT_SIGNATURE_MAX_SKEW_MS) {
      throw new ForbiddenError("settlement attestation is dated in the future");
    }
    if (now - issued > SETTLEMENT_SIGNATURE_MAX_AGE_MS) {
      throw new ForbiddenError("settlement attestation signature is stale");
    }
    if (!/^[A-Za-z0-9+/]{86}==$/.test(attestation.signature)) {
      throw new ForbiddenError("settlement attestation signature is malformed");
    }
    const payload = settlementSigningPayload(fact, attestation.nonce, attestation.issuedAt);
    if (!verify(null, payload, trusted.key, Buffer.from(attestation.signature, "base64"))) {
      throw new ForbiddenError("settlement attestation signature does not verify");
    }
    return Object.freeze({
      method: "ed25519-v1",
      scheme: SETTLEMENT_ATTESTATION_SCHEME,
      keyId: attestation.keyId,
      nonce: attestation.nonce,
      issuedAt: attestation.issuedAt,
      verifiedAt: new Date(now).toISOString(),
      payloadSha256: createHash("sha256").update(payload).digest("hex"),
      signedPayload: payload.toString("utf8"),
      signature: attestation.signature,
      publicKeyPem: trusted.key.export({ type: "spki", format: "pem" }).toString(),
    });
  }
}

/** The feature flag. Default OFF, so a build that does not set it behaves exactly as it did. */
export function externalSettlementEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env.NH_EXTERNAL_SETTLEMENT_ENABLED;
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  // NEVER COERCE. A typo in a deployment variable must not silently decide a financial gate.
  throw new Error("NH_EXTERNAL_SETTLEMENT_ENABLED must be true or false");
}

export function settlementTrustKeysFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): SettlementTrustKey[] {
  const keys: unknown = JSON.parse(env.NH_SETTLEMENT_SOURCE_KEYS ?? "[]");
  if (!Array.isArray(keys)) throw new Error("NH_SETTLEMENT_SOURCE_KEYS must be an array");
  return keys as SettlementTrustKey[];
}

export function settlementVerifierFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): SettlementVerifier {
  return new SettlementVerifier(settlementTrustKeysFromEnvironment(env));
}
