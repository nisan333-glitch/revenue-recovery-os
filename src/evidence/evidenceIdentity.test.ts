// The evidence identity must be stable across re-freezes and must refuse everything it cannot pin down.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COVERED_COMPONENTS,
  EVIDENCE_IDENTITY_SCHEME,
  EXCLUDED_METADATA,
  NonCanonicalValueError,
  assertKnownKeys,
  assertProspectiveRevision,
  canonicalValue,
  continuityLine,
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 14-19 · THE TRACKED RECORDS, AND THE LIMITATION THEY CARRY
//
// The five hash-covered artefacts of each cycle became tracked on 2026-10-16, which is what lets
// `verify:evidence` run from a clean checkout and sit inside the CI gate. That changes what is verifiable
// going forward and changes nothing about the past. These tests hold the two halves apart: the records are
// preserved exactly as attested, and the limitation is stated rather than implied.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("tracked evidence records · continuity, not provenance", () => {
  const CYCLES = ["synthetic-validation", "synthetic-validation-2026-09-27"] as const;
  const read = (cycle: string) =>
    JSON.parse(readFileSync(resolve(__dirname, `../../e2e/evidence/${cycle}.evidence.json`), "utf8")) as Record<
      string,
      unknown
    >;

  it("14 · both records still say the tested revision is UNKNOWN and downgraded", () => {
    for (const cycle of CYCLES) {
      const record = read(cycle);
      // Tracking the bytes does not retroactively establish which build produced them. If a future slice
      // ever fills these in, it must do so from independently established evidence and say how.
      expect(record["systemUnderTestRevision"], cycle).toBe("unknown");
      expect(record["historicalReproducibility"], cycle).toBe("downgraded");
      expect(record["attestedAt"], cycle).toBe("2026-09-30");
    }
  });

  it("15 · the continuity line states the date and REFUSES to imply provenance", () => {
    for (const cycle of CYCLES) {
      const line = continuityLine(read(cycle));
      expect(line).toContain("continuity since 2026-09-30");
      expect(line).toContain("NOT original historical provenance");
      expect(line).toContain("tested revision unknown");
    }
  });

  it("16 · the line is DERIVED — a different record yields a different line, with no hardcoded date", () => {
    // The failure this forbids is a literal "2026-09-30" outliving the record that justifies it: the shape
    // of `wouldBeLiftedBy` naming unbuilt channels and of the stale `settled_at` caveat.
    const other = continuityLine({ ...read("synthetic-validation"), attestedAt: "2027-01-02" });
    expect(other).toContain("continuity since 2027-01-02");
    expect(other).not.toContain("2026-09-30");
    const promoted = continuityLine({
      attestedAt: "2027-01-02",
      systemUnderTestRevision: "b".repeat(40),
    });
    expect(promoted).toContain("provenance as recorded in systemUnderTestRevision");
    expect(promoted).not.toContain("NOT original");
  });

  it("17 · a record with no attestedAt says so instead of inventing one", () => {
    expect(continuityLine({ systemUnderTestRevision: "unknown" })).toContain("continuity since an unstated date");
  });

  it("18 · the records carry NO customer data, which is why the verifier may print them in full", () => {
    // The codes-only rule in dataReadiness.ts exists because a validator `detail` quotes cells from a
    // customer's file. These records are our own constants over synthetic fixtures, so the full-text
    // printing restored on 2026-10-16 is sound — and that is asserted here rather than assumed.
    for (const cycle of CYCLES) {
      const text = readFileSync(resolve(__dirname, `../../e2e/evidence/${cycle}.evidence.json`), "utf8");
      expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      // Every identifier in the covered fixtures is `synthetic-` prefixed; none of them reach the record,
      // which holds hashes and parameters only.
      expect(text).not.toMatch(/synthetic-[a-z]-/);
    }
  });

  it("19 · every hash-covered artefact of both cycles is TRACKED, so a clean checkout can verify", () => {
    // The property the tracking commit exists for, asserted against Git rather than the working tree: a
    // file present on disk but untracked is exactly what made `verify:evidence` exit 1 on every clean
    // checkout, and it is invisible to any test that only reads the filesystem.
    const root = resolve(__dirname, "../..");
    const tracked = new Set(
      execFileSync("git", ["ls-files", "e2e/fixtures", "scripts"], { cwd: root, encoding: "utf8" })
        .split("\n")
        .filter(Boolean),
    );
    for (const cycle of CYCLES) {
      const record = read(cycle);
      const datasets = record["datasets"] as { name: string }[];
      const scripts = Object.keys(record["scriptSha256"] as Record<string, string>);
      const covered = [
        ...datasets.map((d) => `e2e/fixtures/${cycle}/${d.name}.csv`),
        `e2e/fixtures/${cycle}/ground-truth.json`,
        `e2e/fixtures/${cycle}/prediction.json`,
        ...scripts.map((f) => `scripts/${cycle}/${f}`),
      ];
      expect(covered.length).toBe(10);
      for (const path of covered) expect(tracked.has(path), `${path} must be tracked`).toBe(true);
    }
    // And the deliberate exclusion stays excluded: FROZEN.json is not hash-covered, so tracking it would
    // put unverifiable bytes in the evidence set.
    for (const cycle of CYCLES) expect(tracked.has(`e2e/fixtures/${cycle}/FROZEN.json`)).toBe(false);
  });
});
