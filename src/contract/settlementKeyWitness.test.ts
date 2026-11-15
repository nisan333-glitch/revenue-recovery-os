import { describe, expect, it } from "vitest";
import {
  SETTLEMENT_KEY_HASH_SCHEME,
  hashSettlementKey,
  settlementKeyWitnessMatches,
} from "./settlementKeyWitness";
import { POLICY_HASH_SCHEME } from "./policyHash";
import type { SettlementKeyFacts } from "./settlementKeyLifecycle";

const FACTS: SettlementKeyFacts = Object.freeze({
  keyId: "k-bank-01",
  boundaryId: "b-alpha",
  sourceSystem: "acme-bank",
  sourceKind: "bank",
  publicKey: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----\n",
  validFrom: "2026-01-01T00:00:00.000Z",
  validUntil: "2027-01-01T00:00:00.000Z",
});

describe("G1 · the register row's witness", () => {
  it("is the positive control: a row matches its own witness", async () => {
    const witness = await hashSettlementKey(FACTS);
    expect(witness).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(await settlementKeyWitnessMatches(FACTS, witness)).toBe(true);
  });

  it("is deterministic across reconstruction and JSON round-trip", async () => {
    const a = await hashSettlementKey(FACTS);
    const b = await hashSettlementKey({ ...FACTS });
    const c = await hashSettlementKey(JSON.parse(JSON.stringify(FACTS)) as SettlementKeyFacts);
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  // A SUBSTITUTED PUBLIC KEY MUST NOT KEEP THE ROW'S WITNESS. This is the register-tamper case.
  it.each([
    ["the public key", { publicKey: "-----BEGIN PUBLIC KEY-----\nAAAAAAAAAAAA\n-----END PUBLIC KEY-----\n" }],
    ["the key id", { keyId: "k-bank-02" }],
    ["the tenant", { boundaryId: "b-beta" }],
    ["the source system", { sourceSystem: "other-bank" }],
    ["the source kind", { sourceKind: "psp" }],
    ["validFrom", { validFrom: "2026-01-02T00:00:00.000Z" }],
    ["validUntil", { validUntil: "2027-01-02T00:00:00.000Z" }],
  ])("diverges when %s changes", async (_name, over) => {
    const witness = await hashSettlementKey(FACTS);
    expect(await settlementKeyWitnessMatches({ ...FACTS, ...over }, witness)).toBe(false);
  });

  // NUL SEPARATION, and MUTATION N20 SURVIVED THE FIRST FORM OF THIS TEST — the second time in two
  // slices that a test of mine passed for a reason other than the one it named.
  //
  // The first form injected a NUL *into* a value and asserted the hash moved. That tests NUL
  // INJECTION, not SEPARATOR ABSENCE: with the separator removed the two preimages still differed,
  // because one of them contained the injected NUL. So replacing `join("\u0000")` with `join("")`
  // broke nothing and the test went on passing.
  //
  // THE ATTACK THE SEPARATOR ACTUALLY PREVENTS is two DIFFERENT field splits that concatenate to one
  // string. Without a separator `("k-bank-01b", "-alpha")` and `("k-bank-01", "b-alpha")` are the same
  // preimage and therefore the same witness — a substituted row keeping its own witness, which is the
  // whole thing this hash exists to detect.
  it("cannot be forged by re-splitting one concatenation across two fields", async () => {
    const left: SettlementKeyFacts = { ...FACTS, keyId: "k-bank-01", boundaryId: "b-alpha" };
    const right: SettlementKeyFacts = { ...FACTS, keyId: "k-bank-01b", boundaryId: "-alpha" };
    // Identical when joined with nothing; different identities, so they must hash differently.
    expect(left.keyId + left.boundaryId).toBe(right.keyId + right.boundaryId);
    expect(await hashSettlementKey(left)).not.toBe(await hashSettlementKey(right));
  });

  it("also refuses a NUL injected INTO a value, which is a different attack", async () => {
    const injected: SettlementKeyFacts = { ...FACTS, keyId: "k-bank-01\u0000b-alpha", boundaryId: "" };
    expect(await hashSettlementKey(injected)).not.toBe(await hashSettlementKey(FACTS));
  });

  it("carries its own scheme id, distinct from every other hashing scheme here", async () => {
    expect(SETTLEMENT_KEY_HASH_SCHEME).toBe("nh-settlement-key-v1");
    expect(SETTLEMENT_KEY_HASH_SCHEME).not.toBe(POLICY_HASH_SCHEME);
  });

  // THE SCHEME IS INSIDE THE PREIMAGE. A future scheme over the same fields must not collide with this
  // one, and this test fails the moment the scheme id leaves the preimage — the control that mutation
  // M13 taught me to write, after an equivalent one survived in stage 8.
  it("refuses to agree with the same fields hashed under a different scheme id", async () => {
    const { sha256Hex } = await import("../assessment/fingerprint");
    const withoutScheme = [
      FACTS.keyId, FACTS.boundaryId, FACTS.sourceSystem, FACTS.sourceKind,
      FACTS.publicKey, FACTS.validFrom, FACTS.validUntil,
    ].join("\u0000");
    const otherScheme = ["nh-settlement-key-v2", withoutScheme].join("\u0000");
    expect(await hashSettlementKey(FACTS)).not.toBe(`sha256:${await sha256Hex(otherScheme)}`);
    // And the scheme really is in there: the preimage without it hashes differently too.
    expect(await hashSettlementKey(FACTS)).not.toBe(`sha256:${await sha256Hex(withoutScheme)}`);
  });

  // THE STATE IS DERIVED AND MUST NOT ENTER THE WITNESS, or a legitimate activation would read as
  // tampering. Proved by hashing an object carrying a state field and showing it is ignored.
  it("ignores anything that is not one of the seven immutable facts", async () => {
    const withExtras = { ...FACTS, state: "ACTIVE", revokedAt: "2026-09-01T00:00:00.000Z" };
    expect(await hashSettlementKey(withExtras as SettlementKeyFacts))
      .toBe(await hashSettlementKey(FACTS));
  });

  it("refuses a witness from a different row", async () => {
    const other = await hashSettlementKey({ ...FACTS, keyId: "k-bank-02" });
    expect(await settlementKeyWitnessMatches(FACTS, other)).toBe(false);
    expect(await settlementKeyWitnessMatches(FACTS, "sha256:" + "0".repeat(64))).toBe(false);
    expect(await settlementKeyWitnessMatches(FACTS, "")).toBe(false);
  });
});
