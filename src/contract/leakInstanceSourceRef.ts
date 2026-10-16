// EP-31d commit 4 · The pseudonymous `sourceRef`, and the key it was produced under.
//
// THREE THINGS THAT ARE ROUTINELY CONFLATED, AND ARE NOT THE SAME.
//
//   1. The CANONICAL IDENTITY — `canonicalLeakInstanceKey`. Plain, deterministic, re-derivable, and a
//      function of four governed values. It does not depend on any key.
//   2. The PSEUDONYMOUS `sourceRef` — an HMAC OF that identity, which is what may be persisted. It
//      depends on the identity AND on secret key material.
//   3. The KEY ID that produced a stored `sourceRef` — which key was in force at the moment it was
//      written.
//
// The direction is one-way and must stay that way: (2) is derived from (1), never the reverse. That is
// why the identity module has no imports at all, and why this file imports it rather than the other way
// round.
//
// WHY THE KEY ID HAS TO BE RECORDED AT ALL — Q3, stated plainly. `sourceRef` is persisted, and the
// candidate dedupe key is derived from it under a UNIQUE index whose rows can be neither updated nor
// deleted. So if the HMAC key changes, the SAME leak instance derives a DIFFERENT `sourceRef`, hence a
// different dedupe key, hence a SECOND candidate for one obligation — created silently, and permanently,
// because nothing can remove the first. Worse, a stored row becomes non-reproducible, since the key that
// produced it is gone and nothing recorded which key that was. The projection avoided exactly this
// hazard by using ordinals precisely because they need "no key to leak, rotate or forget"; the `sourceRef`
// HMAC reintroduces it, and this module is what makes the failure LOUD instead of silent.
//
// THIS DOES NOT SOLVE ROTATION, AND MUST NOT BE READ AS DOING SO. There is no re-keying here, no dual-key
// derivation and no migration. The invariant it enforces is narrower and stated exactly:
//
//     A stored `sourceRef` produced under key K1 is NEVER silently re-derived under K2 and treated as
//     the same persisted identity. A mismatch is a NAMED refusal.
//
// Candidate identity is therefore CONDITIONALLY stable — stable under a fixed key, and not otherwise.
// It must not be described as unconditionally stable anywhere. The governed rotation/dual-key strategy
// remains an open decision (docs/GOVERNED_DETECTION_V1.md).
//
// WEB CRYPTO, NOT `node:crypto`. This module is reachable from the browser bundle, so it uses the same
// Web Crypto path and the same fail-loud stance as `fingerprint.ts`: if HMAC is unavailable it throws
// rather than degrading. The output is byte-identical to `createHmac("sha256", …).digest("hex")`, which
// a test asserts directly — the server lane and this lane must never disagree about who an obligation is.
import { canonicalLeakInstanceKey, type CandidateLeakInstanceIdentity } from "./leakInstanceIdentity";

/** The one-way scheme marker. Matches the persisted format the database CHECK already enforces. */
export const SOURCE_REF_SCHEME = "hmac-sha256";

/** `hmac-sha256:<64 lowercase hex>` — the exact shape of every stored pseudonym. */
export const SOURCE_REF_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/;

/**
 * Minimum key length, matching `secureCsvIngestion` and `resolveSignalStagingConfig` exactly rather than
 * introducing a second bar for the same secret.
 */
export const MIN_SOURCE_REF_KEY_BYTES = 32;

export class SourceRefHmacUnavailableError extends Error {
  constructor() {
    super(
      "Web Crypto HMAC-SHA256 is unavailable — cannot derive a pseudonymous source reference. " +
        "A candidate reference must not silently fall back to a weaker or unkeyed derivation.",
    );
    this.name = "SourceRefHmacUnavailableError";
  }
}

// Structurally typed for the same reason `fingerprint.ts` does it: this file is compiled for the browser
// bundle and for the server, whose tsconfig has no DOM lib.
interface SubtleHmac {
  importKey(
    format: "raw",
    keyData: Uint8Array,
    algorithm: { name: "HMAC"; hash: "SHA-256" },
    extractable: boolean,
    usages: readonly "sign"[],
  ): Promise<unknown>;
  sign(algorithm: "HMAC", key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
}

function subtle(): SubtleHmac | null {
  const c = (globalThis as { crypto?: { subtle?: SubtleHmac } }).crypto;
  return c && typeof c.subtle?.sign === "function" && typeof c.subtle?.importKey === "function"
    ? c.subtle
    : null;
}

/**
 * Derive the pseudonymous reference for one leak instance.
 *
 * KEYED, not a bare digest, and that is not decoration: obligation references are low-entropy and often
 * sequential, so an unkeyed hash of one is trivially brute-forced by anyone holding the staging table.
 * The key is what makes the pseudonym non-invertible.
 *
 * The canonical identity is hashed WHOLE — boundary, recovery type, namespace and reference together —
 * so the boundary is inside the pseudonym and the same obligation in two tenants yields two unrelated
 * references.
 */
export async function deriveSourceRef(
  keyMaterial: string,
  identity: CandidateLeakInstanceIdentity,
): Promise<string> {
  if (new TextEncoder().encode(keyMaterial).length < MIN_SOURCE_REF_KEY_BYTES) {
    throw new Error(`source reference key must be at least ${MIN_SOURCE_REF_KEY_BYTES} bytes`);
  }
  const s = subtle();
  if (!s) throw new SourceRefHmacUnavailableError();
  // Throws on an unusable component — a malformed identity must never reach a stored pseudonym.
  const message = canonicalLeakInstanceKey(identity);
  const key = await s.importKey(
    "raw",
    new TextEncoder().encode(keyMaterial),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await s.sign("HMAC", key, new TextEncoder().encode(message));
  const hex = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${SOURCE_REF_SCHEME}:${hex}`;
}

/** Why a stored pseudonym may not be used. Named, so no caller invents wording of its own. */
export type SourceRefKeyRefusal =
  /** The row does not say which key produced it, so it cannot be shown to match the active one. */
  | "source_ref_key_id_missing"
  /** The row was produced under a different key: the same obligation would now derive a new pseudonym. */
  | "source_ref_key_id_mismatch"
  /** The stored value is not a well-formed pseudonym at all. */
  | "source_ref_malformed";

export type SourceRefKeyDecision =
  | { readonly usable: true }
  | { readonly usable: false; readonly reason: SourceRefKeyRefusal; readonly detail: string };

const USABLE: SourceRefKeyDecision = Object.freeze({ usable: true });

/**
 * May a stored pseudonym be used under the key currently in force?
 *
 * FAIL-CLOSED, AND NEVER RE-DERIVING. The tempting behaviour on a mismatch is to recompute the
 * pseudonym under the active key and carry on. That is precisely the silent duplicate: the recomputed
 * value is a different dedupe key, so the obligation acquires a second, permanent candidate while
 * appearing to have been "migrated". Refusing is the only answer this layer is entitled to give.
 *
 * The STORED side is data and is therefore refused, never thrown on. The ACTIVE side is configuration:
 * a blank active key id is a deployment fault rather than a row condition, and it throws — the same
 * stance `resolveSignalStagingConfig` takes when it validates the key at boot rather than per request.
 */
export function sourceRefKeyDecision(
  stored: { readonly sourceRef: string; readonly keyId: string | null },
  activeKeyId: string,
): SourceRefKeyDecision {
  if (typeof activeKeyId !== "string" || activeKeyId.trim() === "") {
    throw new Error("active source reference key id is required; it is configuration, not row data");
  }
  if (typeof stored.sourceRef !== "string" || !SOURCE_REF_PATTERN.test(stored.sourceRef)) {
    return Object.freeze({
      usable: false,
      reason: "source_ref_malformed",
      detail: "the stored reference is not a well-formed hmac-sha256 pseudonym",
    });
  }
  if (stored.keyId === null || stored.keyId.trim() === "") {
    return Object.freeze({
      usable: false,
      reason: "source_ref_key_id_missing",
      detail:
        "the stored reference does not record which key produced it, so it cannot be shown to match " +
        "the key in force; it is refused rather than assumed current",
    });
  }
  if (stored.keyId !== activeKeyId) {
    return Object.freeze({
      usable: false,
      reason: "source_ref_key_id_mismatch",
      detail:
        "the stored reference was produced under a different pseudonymisation key; re-deriving it " +
        "under the key in force would create a second permanent candidate for one obligation, so it " +
        "is refused and no rotation is performed here",
    });
  }
  return USABLE;
}
