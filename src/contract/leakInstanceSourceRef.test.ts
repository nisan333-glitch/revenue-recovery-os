// EP-31d commit 4 · Identity, pseudonym and key id are three different things, and a key change is loud.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MIN_SOURCE_REF_KEY_BYTES,
  SOURCE_REF_PATTERN,
  SOURCE_REF_SCHEME,
  deriveSourceRef,
  sourceRefKeyDecision,
} from "./leakInstanceSourceRef";
import { canonicalLeakInstanceKey, type CandidateLeakInstanceIdentity } from "./leakInstanceIdentity";

const BASE: CandidateLeakInstanceIdentity = Object.freeze({
  boundaryId: "boundary-alpha",
  recoveryType: "ActivationMissed",
  sourceNamespaceId: "ns-billing-primary",
  obligationRef: "OBL-100045",
});

// Synthetic test keys. Never a deployment secret, and both are exactly at the minimum length.
const K1 = "k1-".padEnd(48, "0");
const K2 = "k2-".padEnd(48, "0");

describe("EP-31d · pseudonymous sourceRef and its key id", () => {
  it("1 · PINNED GOLDEN VECTOR, and it matches node:crypto byte for byte", () => {
    // The two lanes must never disagree about who an obligation is: this file uses Web Crypto because it
    // is browser-reachable, the server lane uses `createHmac`. Asserting equality is what keeps a future
    // unification honest rather than hopeful.
    const expected = `${SOURCE_REF_SCHEME}:${createHmac("sha256", K1)
      .update(canonicalLeakInstanceKey(BASE), "utf8")
      .digest("hex")}`;
    return deriveSourceRef(K1, BASE).then((ref) => {
      expect(ref).toBe(expected);
      expect(ref).toMatch(SOURCE_REF_PATTERN);
      expect(ref).toBe(
        "hmac-sha256:4986d82e6e7489c23e87647a60a6ad18db05ca640349eabf6c9e970487113b06",
      );
    });
  });

  it("2 · the pseudonym is a function of the IDENTITY, so it is stable across everything else", async () => {
    const reference = await deriveSourceRef(K1, BASE);
    expect(await deriveSourceRef(K1, { ...BASE })).toBe(reference);
    // Different obligation, different namespace, different boundary ⇒ different pseudonym.
    expect(await deriveSourceRef(K1, { ...BASE, obligationRef: "OBL-100046" })).not.toBe(reference);
    expect(await deriveSourceRef(K1, { ...BASE, sourceNamespaceId: "ns-other" })).not.toBe(reference);
    // The boundary is INSIDE the pseudonym, so one obligation in two tenants is two unrelated values.
    expect(await deriveSourceRef(K1, { ...BASE, boundaryId: "boundary-beta" })).not.toBe(reference);
  });

  it("3 · CONTROL B · a different HMAC key keeps the IDENTITY and changes only the pseudonym", async () => {
    // The whole point of separating the layers. The identity is untouched by key material…
    expect(canonicalLeakInstanceKey(BASE)).toBe(canonicalLeakInstanceKey(BASE));
    // …while the stored pseudonym is not.
    const underK1 = await deriveSourceRef(K1, BASE);
    const underK2 = await deriveSourceRef(K2, BASE);
    expect(underK2).not.toBe(underK1);
    // And the mismatch BLOCKS rather than silently accepting the new pseudonym as the same row.
    const decision = sourceRefKeyDecision({ sourceRef: underK1, keyId: "hmac-key-1" }, "hmac-key-2");
    expect(decision.usable).toBe(false);
    expect(decision).toMatchObject({ reason: "source_ref_key_id_mismatch" });
    expect(sourceRefKeyDecision({ sourceRef: underK1, keyId: "hmac-key-1" }, "hmac-key-1")).toEqual({
      usable: true,
    });
  });

  it("4 · a row that does not say which key produced it is refused, not assumed current", async () => {
    const ref = await deriveSourceRef(K1, BASE);
    for (const keyId of [null, "", "   "]) {
      const decision = sourceRefKeyDecision({ sourceRef: ref, keyId }, "hmac-key-1");
      expect(decision).toMatchObject({ usable: false, reason: "source_ref_key_id_missing" });
    }
  });

  it("5 · a malformed stored pseudonym is refused by shape before anything else is considered", () => {
    for (const bad of ["", "OBL-100045", "hmac-sha256:xyz", `hmac-sha256:${"A".repeat(64)}`, "sha256:" + "a".repeat(64)]) {
      expect(sourceRefKeyDecision({ sourceRef: bad, keyId: "hmac-key-1" }, "hmac-key-1")).toMatchObject({
        usable: false,
        reason: "source_ref_malformed",
      });
    }
  });

  it("6 · stored data is REFUSED; missing configuration THROWS", async () => {
    // The stored side is row data and must never take a request down. The active key id is deployment
    // configuration, and a blank one is a fault to surface, exactly as the staging config does at boot.
    const ref = await deriveSourceRef(K1, BASE);
    expect(() => sourceRefKeyDecision({ sourceRef: ref, keyId: "k" }, "")).toThrow(/configuration/);
    expect(() => sourceRefKeyDecision({ sourceRef: ref, keyId: "k" }, "   ")).toThrow(/configuration/);
    expect(sourceRefKeyDecision({ sourceRef: "nonsense", keyId: null }, "k").usable).toBe(false);
  });

  it("7 · a short key and a malformed identity are both refused before any pseudonym exists", async () => {
    await expect(deriveSourceRef("too-short", BASE)).rejects.toThrow(/at least 32 bytes/);
    expect(MIN_SOURCE_REF_KEY_BYTES).toBe(32);
    await expect(deriveSourceRef(K1, { ...BASE, obligationRef: "" })).rejects.toThrow(/not encodable/);
    await expect(deriveSourceRef(K1, { ...BASE, obligationRef: "A\u0000B" })).rejects.toThrow(/not encodable/);
  });

  it("8 · NO ROTATION IS IMPLEMENTED HERE, and that is checked rather than promised", () => {
    const source = readFileSync(new URL("./leakInstanceSourceRef.ts", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    // No re-keying, no dual-key derivation, no migration: a mismatch has exactly one outcome, refusal.
    for (const forbidden of ["rotate", "reKey", "rekey", "previousKey", "fallbackKey", "migrate"]) {
      expect(source).not.toContain(forbidden);
    }
    // And the module derives FROM the identity, never the reverse — one-way, asserted structurally over
    // CODE: the identity module's header legitimately names this file to explain where the pseudonym is
    // computed, and an assertion that could not tell prose from an import would forbid the explanation.
    const identityCode = readFileSync(new URL("./leakInstanceIdentity.ts", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    expect(identityCode).not.toContain("leakInstanceSourceRef");
    expect(source).toContain('from "./leakInstanceIdentity"');
  });

  it("9 · CONTROL G · nothing these four commits add can persist a raw obligation reference", async () => {
    // The pseudonym is the ONLY value any of them offers for storage, and it is one-way by construction.
    // Asserted structurally because the alternative — trusting that no later edit adds a writer — is
    // exactly the kind of promise this codebase replaces with a check.
    const code = (name: string) =>
      readFileSync(new URL(`./${name}`, import.meta.url), "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
    const modules = {
      "leakInstanceIdentity.ts": code("leakInstanceIdentity.ts"),
      "sourceNamespace.ts": code("sourceNamespace.ts"),
      "leakInstanceSourceRef.ts": code("leakInstanceSourceRef.ts"),
      "../assessment/leakInstanceAttribution.ts": code("../assessment/leakInstanceAttribution.ts"),
    };
    for (const [name, source] of Object.entries(modules)) {
      for (const writer of ["prisma", "Store", "node:fs", "writeFile", "INSERT", "$queryRaw", "fetch("]) {
        expect(source, `${name} must not reach persistence via ${writer}`).not.toContain(writer);
      }
    }
    // And the pseudonym does not contain the reference it was derived from.
    const ref = await deriveSourceRef(K1, BASE);
    expect(ref).not.toContain(BASE.obligationRef);
    expect(ref).not.toContain(BASE.boundaryId);
    expect(ref).not.toContain(BASE.sourceNamespaceId);
    expect(ref.slice(SOURCE_REF_SCHEME.length + 1)).toMatch(/^[a-f0-9]{64}$/);
  });
});
