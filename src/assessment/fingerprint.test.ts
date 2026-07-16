import { describe, it, expect, vi, afterEach } from "vitest";
import { fingerprintSource, fnv1a, shortHash, CanonicalHashUnavailableError } from "./fingerprint";
import { assessCsv } from "./assess";
import { makePolicy } from "./policy";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fingerprint — canonical SHA-256, local, deterministic, one-way", () => {
  it("the canonical fingerprint uses Web Crypto SHA-256 (64 hex chars)", async () => {
    const f = await fingerprintSource("entity,amount\nE1,100.00");
    expect(f.algo).toBe("SHA-256");
    expect(f.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("identical content ⇒ same fingerprint; different content ⇒ different", async () => {
    const a = await fingerprintSource("E1,100.00");
    const b = await fingerprintSource("E1,100.00");
    const c = await fingerprintSource("E1,100.01");
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
  });

  it("depends on CONTENT only — file name / path are not inputs and cannot affect it", async () => {
    // The API accepts only the text; the same bytes yield the same hash regardless of any filename.
    const content = "col\nvalue";
    const first = await fingerprintSource(content);
    const second = await fingerprintSource(content); // "uploaded" under a different file name — same bytes
    expect(first.hash).toBe(second.hash);
  });

  it("is deterministic across repeated runs", async () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 5; i++) hashes.add((await fingerprintSource("same content")).hash);
    expect(hashes.size).toBe(1);
  });

  it("logs nothing and transmits nothing while hashing", async () => {
    const spies = ["log", "info", "warn", "error", "debug"].map((m) =>
      vi.spyOn(console, m as "log").mockImplementation(() => {}),
    );
    const fetchSpy = typeof globalThis.fetch === "function" ? vi.spyOn(globalThis, "fetch") : null;
    await fingerprintSource("SENSITIVE,amount\nAcme,999999.00");
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    if (fetchSpy) expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("helper hashes (fnv1a/shortHash) are NEVER the canonical fingerprint", async () => {
    const f = await fingerprintSource("abc");
    expect(f.hash).not.toBe(fnv1a("abc")); // different algorithm, different value
    expect(f.algo).toBe("SHA-256");
    expect(shortHash("abc")).toHaveLength(8); // fnv1a is 32-bit → 8 hex; not a 64-char SHA-256
    // End-to-end: the assessment's canonical fingerprint is SHA-256, the id uses the helper.
    const r = await assessCsv("entity_id,signed_at,next_invoice_due_at,next_invoice_amount,currency\nE1,2026-01-01,2026-02-01,100.00,USD", makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" }), { createdAt: "2026-03-02T00:00:00.000Z" });
    expect(r.fingerprintAlgo).toBe("SHA-256");
    expect(r.sourceFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(r.assessmentId.startsWith("A-")).toBe(true);
  });

  it("Web Crypto failure is handled EXPLICITLY — never silently downgraded to a weaker hash", async () => {
    vi.stubGlobal("crypto", {}); // Web Crypto without subtle.digest
    await expect(fingerprintSource("x")).rejects.toBeInstanceOf(CanonicalHashUnavailableError);
  });
});
