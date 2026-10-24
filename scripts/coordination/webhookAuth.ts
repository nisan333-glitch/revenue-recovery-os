// Authentication for the bridge's inbound event receiver · step 3 of the Phase 4 plan.
//
// WHAT THIS IS. The decision of whether an inbound HTTP delivery may be believed: GitHub signs every
// webhook body with HMAC-SHA256 over a shared secret and sends it as `X-Hub-Signature-256`. This module
// verifies that, and refuses a replayed delivery. It is pure — it holds no socket and no secret of its own,
// and the secret is a parameter so that a test can exercise the real comparison without an environment.
//
// WHY A RECEIVER NEEDS THIS AT ALL. The receiver's whole job is to accept an unauthenticated POST from the
// public internet and then act on it. Without signature verification, anyone who learns the URL could
// inject a message, and the bridge would record it as having come from GitHub — which is the
// beneficiary-determines-the-number failure in its purest form: the party that benefits from a message
// being believed would be the party asserting it arrived.
//
// SIGNATURE IS NOT PROVENANCE OF CONTENT, and the distinction is stated because it is easy to overclaim.
// A valid signature proves the body left a party holding the secret. It does NOT prove who authored the
// comment the body describes, which is a separate question answered by the `nh-msg` record's own `from`
// field and by `bridge.ts`'s rule that a sender can never acknowledge its own message.
//
// TIMING-SAFE COMPARISON IS NOT DECORATION. `===` on a hex digest leaks a prefix match through its
// duration, and an attacker who can send repeated deliveries can walk a forgery out of that. The compare
// is `timingSafeEqual` over equal-length buffers, with the length check done first and separately —
// `timingSafeEqual` throws on a length mismatch rather than returning false.
import { createHmac, timingSafeEqual } from "node:crypto";

/** The header GitHub sends. Lowercase, because Node lowercases incoming header names. */
export const SIGNATURE_HEADER = "x-hub-signature-256";
/** The per-delivery unique id GitHub sends; the replay guard is keyed on it. */
export const DELIVERY_HEADER = "x-github-delivery";
export const EVENT_HEADER = "x-github-event";

export const SIGNATURE_PREFIX = "sha256=";

export type AuthFailure =
  | "no_secret_configured"
  | "missing_signature"
  | "malformed_signature"
  | "bad_signature"
  | "missing_delivery_id"
  | "replayed_delivery";

export interface AuthResult {
  readonly ok: boolean;
  /** Set exactly when `ok` is false. One of a closed set, so a caller can branch without parsing prose. */
  readonly failure: AuthFailure | null;
  /** The delivery id, when one was present and the delivery was accepted. */
  readonly deliveryId: string | null;
}

/** The expected signature for a body under a secret. Exported so a test can sign the way GitHub does. */
export function sign(secret: string, rawBody: string): string {
  return `${SIGNATURE_PREFIX}${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Does this delivery carry a valid signature for this body?
 *
 * FAILS CLOSED ON AN ABSENT SECRET. A receiver started with no secret configured must not accept
 * everything: that is the single most likely misconfiguration, and the one whose consequence is an open
 * injection point. It is reported as its own failure so the operator is told the cause is the server's
 * configuration rather than the caller's request — blaming the caller for our own misconfiguration is the
 * mistake this repository has already recorded against `NH-AX-1009`.
 */
export function verifySignature(secret: string, rawBody: string, signatureHeader: unknown): AuthResult {
  if (typeof secret !== "string" || secret.length === 0) {
    return { ok: false, failure: "no_secret_configured", deliveryId: null };
  }
  if (typeof signatureHeader !== "string" || signatureHeader.length === 0) {
    return { ok: false, failure: "missing_signature", deliveryId: null };
  }
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return { ok: false, failure: "malformed_signature", deliveryId: null };
  }
  const offered = signatureHeader.slice(SIGNATURE_PREFIX.length);
  // Shape-checked BEFORE the compare, because `timingSafeEqual` throws on a length mismatch and a thrown
  // error inside a request handler is a 500 — a malformed header is the caller's fault and is a 4xx.
  if (!HEX64.test(offered)) {
    return { ok: false, failure: "malformed_signature", deliveryId: null };
  }
  const expected = sign(secret, rawBody).slice(SIGNATURE_PREFIX.length);
  const a = Buffer.from(offered, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, failure: "bad_signature", deliveryId: null };
  }
  return { ok: true, failure: null, deliveryId: null };
}

/**
 * A bounded set of delivery ids already handled.
 *
 * BOUNDED ON PURPOSE. An unbounded set is a memory leak in a long-running receiver, and "remember
 * everything forever" is not available to a process that can restart. The window is explicit, and the
 * consequence of it is stated rather than hidden: a replay delayed beyond `capacity` further deliveries is
 * NOT detected here. That is acceptable only because it is not the last line of defence — `bridge.ts`
 * dedupes on message id and body hash, so a replayed delivery that slips past this window still reaches a
 * ledger that reports it as `duplicate` and changes nothing.
 */
export class DeliveryWindow {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];

  constructor(private readonly capacity = 2048) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("delivery window capacity must be a positive integer");
  }

  /** True when this id has not been seen in the window; records it. False when it is a replay. */
  admit(deliveryId: string): boolean {
    if (this.seen.has(deliveryId)) return false;
    this.seen.add(deliveryId);
    this.order.push(deliveryId);
    while (this.order.length > this.capacity) {
      const evicted = this.order.shift();
      if (evicted !== undefined) this.seen.delete(evicted);
    }
    return true;
  }

  get size(): number {
    return this.seen.size;
  }
}

/**
 * The whole admission decision for one delivery: signature, then replay.
 *
 * ORDER MATTERS AND IS DELIBERATE. The signature is checked FIRST, so an unsigned caller can never consume
 * a slot in the replay window — otherwise an attacker could evict real delivery ids by flooding garbage,
 * and turn a replay guard into a replay enabler.
 */
export function admitDelivery(
  secret: string,
  rawBody: string,
  headers: Readonly<Record<string, unknown>>,
  window: DeliveryWindow,
): AuthResult {
  const sig = verifySignature(secret, rawBody, headers[SIGNATURE_HEADER]);
  if (!sig.ok) return sig;
  const id = headers[DELIVERY_HEADER];
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, failure: "missing_delivery_id", deliveryId: null };
  }
  if (!window.admit(id)) return { ok: false, failure: "replayed_delivery", deliveryId: id };
  return { ok: true, failure: null, deliveryId: id };
}

/** The HTTP status a failure deserves. 500 only for our own misconfiguration; never for a caller's input. */
export function statusFor(failure: AuthFailure): number {
  switch (failure) {
    case "no_secret_configured":
      return 500;
    case "replayed_delivery":
      return 200; // Already handled. GitHub must not retry it, so this is a success to the sender.
    default:
      return 401;
  }
}
