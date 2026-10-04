// The evidence identity must be stable across re-freezes and must refuse everything it cannot pin down.
import { describe, expect, it } from "vitest";
import {
  COVERED_COMPONENTS,
  EVIDENCE_IDENTITY_SCHEME,
  EXCLUDED_METADATA,
  NonCanonicalValueError,
  assertKnownKeys,
  assertProspectiveRevision,
  canonicalValue,
  stableEvidenceDigest,
} from "./evidenceIdentity";

/** A minimal, entirely synthetic record. No customer data and no real digest appears in these tests. */
const RECORD = Object.freeze({
  systemUnderTestRevision: "unknown",
  datasets: Object.freeze([
    Object.freeze({ name: "dataset", sha256: "a".repeat(64) }),
    Object.freeze({ name: "spot", sha256: "b".repeat(64) }),
  ]),
  groundTruthSha256: "c".repeat(64),
  predictionSha256: "d".repeat(64),
  scriptSha256: Object.freeze({ "generate.mjs": "e".repeat(64), "verify.mjs": "f".repeat(64) }),
  runParameters: Object.freeze({ asOf: "2026-06-30", stallThresholdDays: 30, currency: "USD" }),
});

describe("evidence identity · stability", () => {
  it("1 · is UNCHANGED by frozenAt — the defect this scheme exists to fix", async () => {
    const early = await stableEvidenceDigest({ ...RECORD, frozenAt: "2026-09-26T14:19:22.321Z" });
    const later = await stableEvidenceDigest({ ...RECORD, frozenAt: "2026-09-30T09:36:24.399Z" });
    const absent = await stableEvidenceDigest(RECORD);
    expect(early).toBe(later);
    expect(early).toBe(absent);
    expect(early).toMatch(/^nhev_[a-f0-9]{64}$/);
  });

  it("2 · is UNCHANGED by the old verifier's gitHead, which is never promoted to evidence", async () => {
    // `git rev-parse HEAD` ignores a dirty tree, so this field is not trustworthy as historical evidence.
    // It stays outside the identity even though it looks like provenance.
    const a = await stableEvidenceDigest({ ...RECORD, gitHead: "1".repeat(40) });
    const b = await stableEvidenceDigest({ ...RECORD, gitHead: "2".repeat(40) });
    expect(a).toBe(b);
    expect(a).toBe(await stableEvidenceDigest(RECORD));
  });

  it("3 · IS changed by systemUnderTestRevision — it is substantive, not metadata", async () => {
    // Identical inputs against two product revisions can produce different results, so the revision is
    // part of what the evidence is. This is the assertion that proves it is covered rather than ignored.
    const unknown = await stableEvidenceDigest(RECORD);
    const known = await stableEvidenceDigest({ ...RECORD, systemUnderTestRevision: "a".repeat(40) });
    const other = await stableEvidenceDigest({ ...RECORD, systemUnderTestRevision: "b".repeat(40) });
    expect(known).not.toBe(unknown);
    expect(known).not.toBe(other);
    expect(COVERED_COMPONENTS).toContain("systemUnderTestRevision");
    expect(EXCLUDED_METADATA).toContain("gitHead");
    expect(EXCLUDED_METADATA).toContain("frozenAt");
  });

  it("4 · TAMPER · every covered component changes the digest", async () => {
    const base = await stableEvidenceDigest(RECORD);
    const tampered: readonly Record<string, unknown>[] = [
      { ...RECORD, groundTruthSha256: "0".repeat(64) },
      { ...RECORD, predictionSha256: "0".repeat(64) },
      { ...RECORD, datasets: [{ name: "dataset", sha256: "0".repeat(64) }, RECORD.datasets[1]!] },
      { ...RECORD, scriptSha256: { ...RECORD.scriptSha256, "verify.mjs": "0".repeat(64) } },
      { ...RECORD, runParameters: { ...RECORD.runParameters, stallThresholdDays: 31 } },
    ];
    for (const record of tampered) expect(await stableEvidenceDigest(record)).not.toBe(base);
  });

  it("5 · a renamed dataset is a different identity, and dataset ORDER is meaning", async () => {
    const renamed = await stableEvidenceDigest({
      ...RECORD,
      datasets: [{ name: "renamed", sha256: "a".repeat(64) }, RECORD.datasets[1]!],
    });
    const reordered = await stableEvidenceDigest({ ...RECORD, datasets: [...RECORD.datasets].reverse() });
    const base = await stableEvidenceDigest(RECORD);
    expect(renamed).not.toBe(base);
    expect(reordered).not.toBe(base);
  });
});

describe("evidence identity · canonicalisation", () => {
  it("6 · key order does NOT matter, at EVERY depth", () => {
    // A single-level sort would leave nested objects at the mercy of insertion order — the accidental input
    // `JSON.stringify` smuggles in. Asserted three levels down.
    const a = { z: { y: { x: 1, w: 2 }, v: [1, 2] }, u: "t" };
    const b = { u: "t", z: { v: [1, 2], y: { w: 2, x: 1 } } };
    expect(canonicalValue(a)).toBe(canonicalValue(b));
  });

  it("7 · array order DOES matter, and framing makes the encoding injective", () => {
    expect(canonicalValue([1, 2])).not.toBe(canonicalValue([2, 1]));
    // The classic ambiguity: two different shapes must not encode alike. Length framing is what prevents it.
    expect(canonicalValue(["a", "bc"])).not.toBe(canonicalValue(["ab", "c"]));
    expect(canonicalValue({ a: "b" })).not.toBe(canonicalValue({ ab: "" }));
    expect(canonicalValue([])).not.toBe(canonicalValue({}));
    expect(canonicalValue("")).not.toBe(canonicalValue(null));
    expect(canonicalValue(1)).not.toBe(canonicalValue("1"));
    expect(canonicalValue(true)).not.toBe(canonicalValue("true"));
  });

  it("8 · non-canonical value types are REJECTED, never guessed at", () => {
    const cases: readonly [string, unknown][] = [
      ["undefined", undefined],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["BigInt", BigInt(1)],
      ["Date", new Date(0)],
      ["function", () => 1],
      ["Map", new Map()],
      ["Symbol", Symbol("x")],
    ];
    for (const [label, value] of cases) {
      expect(() => canonicalValue(value), label).toThrow(NonCanonicalValueError);
    }
    // And nested, with the path named so a failure is actionable.
    expect(() => canonicalValue({ a: { b: [new Date(0)] } })).toThrow(/\$\.a\.b\[0\]/);
  });
});

describe("evidence identity · fail-closed", () => {
  it("9 · an UNKNOWN key is an error — silence is how frozenAt got in originally", async () => {
    await expect(stableEvidenceDigest({ ...RECORD, surpriseField: 1 })).rejects.toThrow(/unrecognised key/);
    expect(() => assertKnownKeys({ ...RECORD, a: 1, b: 2 })).toThrow(/a, b/);
    // Recognised metadata is accepted and ignored; that is the difference being drawn.
    for (const key of EXCLUDED_METADATA) expect(() => assertKnownKeys({ ...RECORD, [key]: "x" })).not.toThrow();
  });

  it("10 · a missing covered component is an error", () => {
    for (const component of COVERED_COMPONENTS) {
      const partial: Record<string, unknown> = { ...RECORD };
      delete partial[component];
      expect(() => assertKnownKeys(partial), component).toThrow(new RegExp(`missing covered component: ${component}`));
    }
  });

  it("11 · a malformed revision is refused", async () => {
    for (const bad of ["", "HEAD", "abc", "A".repeat(40), `${"a".repeat(40)}-dirtyish`]) {
      await expect(stableEvidenceDigest({ ...RECORD, systemUnderTestRevision: bad })).rejects.toThrow(/systemUnderTestRevision/);
    }
  });

  it("12 · a PROSPECTIVE freeze refuses 'unknown' and refuses a dirty tree", () => {
    expect(() => assertProspectiveRevision("a".repeat(40))).not.toThrow();
    expect(() => assertProspectiveRevision("unknown")).toThrow(/requires a known/);
    expect(() => assertProspectiveRevision(`${"a".repeat(40)}-dirty`)).toThrow(/dirty tree is not a revision/);
    expect(() => assertProspectiveRevision("nope")).toThrow(/malformed/);
  });

  it("13 · the scheme is inside the hash, so a future scheme cannot collide with this one", async () => {
    expect(EVIDENCE_IDENTITY_SCHEME).toBe("nh-validation-evidence-v1");
    const digest = await stableEvidenceDigest(RECORD);
    // Pure: same input, same answer, no clock, no randomness.
    expect(await stableEvidenceDigest(RECORD)).toBe(digest);
  });
});
