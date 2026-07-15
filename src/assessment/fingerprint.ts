// Local, deterministic, one-way source fingerprint.
//
// MANDATE: the canonical fingerprint is generated LOCALLY, is deterministic, uses the one-way
// cryptographic hash SHA-256 via Web Crypto, and is NEVER logged, transmitted, or used as a
// substitute for storing customer data. It exists only to prove that two runs used the same source
// and to derive a stable assessmentId — it holds no recoverable content, and is a function of the
// file CONTENT only (never the file name or path — the API accepts only the text).
//
// Web Crypto's digest is async and present in modern browsers and Node ≥ 20 (globalThis.crypto.subtle).
// If it is unavailable, this FAILS EXPLICITLY — it MUST NOT silently downgrade to a weaker hash. A
// degraded run without a cryptographic fingerprint is a decision for the caller to make deliberately.

export interface Fingerprint {
  readonly hash: string; // hex (SHA-256 ⇒ 64 chars)
  readonly algo: "SHA-256";
}

export class CanonicalHashUnavailableError extends Error {
  constructor() {
    super(
      "Web Crypto SHA-256 is unavailable — cannot produce a canonical source fingerprint. " +
        "The assessment must not silently downgrade to a weaker hash.",
    );
    this.name = "CanonicalHashUnavailableError";
  }
}

function subtle(): SubtleCrypto | null {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c && typeof c.subtle?.digest === "function" ? c.subtle : null;
}

/** The CANONICAL source fingerprint. SHA-256 only; throws explicitly if Web Crypto is unavailable. */
export async function fingerprintSource(text: string): Promise<Fingerprint> {
  const s = subtle();
  if (!s) throw new CanonicalHashUnavailableError();
  const bytes = new TextEncoder().encode(text);
  const digest = await s.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { hash, algo: "SHA-256" };
}

// --- Non-cryptographic helper, for stable IDENTIFIERS only (never the canonical fingerprint) ------
// 32-bit FNV-1a. Deterministic; used solely to derive a compact, non-secret assessmentId. It is not
// one-way-secure and must never stand in for the canonical fingerprint above.
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Deterministic short hash for stable ids (non-secret; NOT the canonical fingerprint). */
export function shortHash(text: string): string {
  return fnv1a(text);
}
