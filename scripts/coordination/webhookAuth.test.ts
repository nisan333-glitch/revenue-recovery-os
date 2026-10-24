// Falsifiers for the receiver's authentication.
//
// The accepting case is one test. The rest are the refusals, because a receiver that accepts a forged
// delivery records an injected message as having come from GitHub.
import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  DELIVERY_HEADER,
  DeliveryWindow,
  SIGNATURE_HEADER,
  admitDelivery,
  sign,
  statusFor,
  verifySignature,
} from "./webhookAuth.ts";

const SECRET = "a-test-secret-value-not-a-real-one";
const BODY = '{"action":"created","comment":{"id":1}}';

const headers = (over: Record<string, unknown> = {}) => ({
  [SIGNATURE_HEADER]: sign(SECRET, BODY),
  [DELIVERY_HEADER]: "11111111-2222-3333-4444-555555555555",
  ...over,
});

describe("webhookAuth · signature", () => {
  it("accepts a body signed the way GitHub signs it", () => {
    // Computed independently of `sign`, so this asserts the ALGORITHM rather than self-consistency: if
    // `sign` changed to something else, this test fails even though every other test would still pass.
    const independent = `sha256=${createHmac("sha256", SECRET).update(BODY, "utf8").digest("hex")}`;
    expect(verifySignature(SECRET, BODY, independent).ok).toBe(true);
  });

  it("refuses a body that changed by ONE BYTE under a valid-looking signature", () => {
    const good = sign(SECRET, BODY);
    const result = verifySignature(SECRET, `${BODY} `, good);
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("bad_signature");
  });

  it("refuses a signature made with a different secret", () => {
    expect(verifySignature(SECRET, BODY, sign("some-other-secret", BODY)).failure).toBe("bad_signature");
  });

  it("FAILS CLOSED when no secret is configured, and blames the server not the caller", () => {
    // The most likely misconfiguration, and the one whose consequence is an open injection point. It is
    // also a 500 rather than a 401: reporting our own misconfiguration as the caller's fault would point
    // the operator at the wrong thing.
    const result = verifySignature("", BODY, sign(SECRET, BODY));
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("no_secret_configured");
    expect(statusFor(result.failure!)).toBe(500);
  });

  it("refuses a missing, empty, non-string or wrong-prefix signature", () => {
    expect(verifySignature(SECRET, BODY, undefined).failure).toBe("missing_signature");
    expect(verifySignature(SECRET, BODY, "").failure).toBe("missing_signature");
    expect(verifySignature(SECRET, BODY, 12345).failure).toBe("missing_signature");
    expect(verifySignature(SECRET, BODY, `sha1=${"a".repeat(40)}`).failure).toBe("malformed_signature");
  });

  it("a malformed digest is a 4xx and NEVER an exception", () => {
    // `timingSafeEqual` throws on a length mismatch, so the shape check has to come first; a throw inside
    // a request handler is a 500, and a malformed header is the caller's fault.
    for (const bad of ["sha256=", "sha256=zz", `sha256=${"a".repeat(63)}`, `sha256=${"A".repeat(64)}`]) {
      const result = verifySignature(SECRET, BODY, bad);
      expect(result.ok, bad).toBe(false);
      expect(result.failure, bad).toBe("malformed_signature");
      expect(statusFor(result.failure!)).toBe(401);
    }
  });
});

describe("webhookAuth · replay", () => {
  it("admits a delivery once and reports the second as a replay", () => {
    const window = new DeliveryWindow();
    const first = admitDelivery(SECRET, BODY, headers(), window);
    expect(first.ok).toBe(true);
    expect(first.deliveryId).toBe("11111111-2222-3333-4444-555555555555");
    const second = admitDelivery(SECRET, BODY, headers(), window);
    expect(second.ok).toBe(false);
    expect(second.failure).toBe("replayed_delivery");
  });

  it("a replay answers 200, so GitHub stops retrying something already handled", () => {
    expect(statusFor("replayed_delivery")).toBe(200);
  });

  it("refuses a signed delivery with no delivery id", () => {
    const window = new DeliveryWindow();
    const result = admitDelivery(SECRET, BODY, headers({ [DELIVERY_HEADER]: undefined }), window);
    expect(result.failure).toBe("missing_delivery_id");
  });

  it("AN UNSIGNED CALLER CANNOT CONSUME A SLOT in the replay window", () => {
    // The ordering rule. If the window were filled before the signature was checked, an attacker could
    // evict real delivery ids by flooding garbage and turn the replay guard into a replay enabler.
    const window = new DeliveryWindow(2);
    for (let i = 0; i < 50; i += 1) {
      const result = admitDelivery(SECRET, BODY, { [SIGNATURE_HEADER]: "sha256=" + "0".repeat(64), [DELIVERY_HEADER]: `junk-${i}` }, window);
      expect(result.failure).toBe("bad_signature");
    }
    expect(window.size).toBe(0);
    // And a genuine delivery still gets its slot afterwards.
    expect(admitDelivery(SECRET, BODY, headers(), window).ok).toBe(true);
  });

  it("the window is BOUNDED, and the bound is stated rather than hidden", () => {
    // A replay delayed beyond the window is not caught here. That is survivable only because it is not the
    // last line of defence: bridge.ts dedupes on id + body hash, so such a delivery still reports
    // `duplicate` and changes no ledger. This test pins the eviction so the limitation stays visible.
    const window = new DeliveryWindow(2);
    expect(window.admit("a")).toBe(true);
    expect(window.admit("b")).toBe(true);
    expect(window.admit("c")).toBe(true); // evicts "a"
    expect(window.size).toBe(2);
    expect(window.admit("a")).toBe(true); // the stated gap: "a" is no longer remembered
  });

  it("refuses a capacity that is not a positive integer", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => new DeliveryWindow(bad)).toThrow();
  });
});

describe("webhookAuth · the module holds no secret and no socket", () => {
  it("imports only node:crypto", () => {
    const code = readFileSync("scripts/coordination/webhookAuth.ts", "utf8");
    const specifiers = [...code.matchAll(/^\s*import[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]!);
    expect(specifiers).toEqual(["node:crypto"]);
  });

  it("reads no environment variable — the secret is a parameter", () => {
    // So a test can exercise the real comparison without an environment, and so the secret has exactly one
    // place it can enter the process: the receiver's own startup.
    const code = readFileSync("scripts/coordination/webhookAuth.ts", "utf8").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/process\.env/);
  });
});
