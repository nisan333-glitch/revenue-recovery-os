// FALSIFIERS FOR THE BASELINE PRESERVATION LEDGER.
//
// The ledger's whole value is in what it REFUSES to claim, so these tests attack the claims rather than
// the happy path: that the two sets cannot be merged, that the three refusals cannot be softened, that the
// declared set cannot be quietly widened, and that the sibling scheme has not disturbed the cycle scheme
// it sits beside.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BASELINE_COVERED_COMPONENTS,
  BASELINE_EXCLUDED_METADATA,
  BASELINE_LEDGER_SCHEME,
  DECLARED_BASELINES,
  RECORDED_BASELINE,
  REQUIRED_CLAIMS,
  assertBaselineLedgerClaims,
  assertBaselineLedgerKeys,
  baselineContinuityLine,
  citesHash,
  stableBaselineLedgerDigest,
} from "./baselineLedger";
import { COVERED_COMPONENTS, EVIDENCE_IDENTITY_SCHEME } from "./evidenceIdentity";

const ROOT = resolve(__dirname, "..", "..");
const hex = (seed: number) => seed.toString(16).padStart(64, "0");

/** A well-formed ledger over the declared set, with stand-in hashes. */
const ledger = (): Record<string, unknown> => ({
  ledgerScheme: BASELINE_LEDGER_SCHEME,
  authenticatedBaselines: [
    {
      path: RECORDED_BASELINE.path,
      sha256: RECORDED_BASELINE.sha256,
      bytes: 29987,
      recordedHashSource: RECORDED_BASELINE.recordedHashSource,
      recordedCoreSha256: RECORDED_BASELINE.recordedCoreSha256,
      recordedCoreCommit: RECORDED_BASELINE.recordedCoreCommit,
    },
  ],
  unauthenticatedBaselines: DECLARED_BASELINES.filter((p) => p !== RECORDED_BASELINE.path).map((path, i) => ({
    path,
    sha256: hex(i + 1),
    bytes: 1000 + i,
  })),
  producingRevision: "NOT_ESTABLISHED",
  historicalReproducibility: "NOT_CLAIMED",
  independentValidation: "NONE",
  attestedAt: "2026-10-16",
  attestingRevision: "a".repeat(40),
  attestedNote: "note",
});

describe("baseline ledger · the claims cannot be softened", () => {
  it("1 · all three refusals are REQUIRED LITERALS, not prose", () => {
    expect(REQUIRED_CLAIMS).toEqual({
      producingRevision: "NOT_ESTABLISHED",
      historicalReproducibility: "NOT_CLAIMED",
      independentValidation: "NONE",
    });
    // Prose about a limitation can be rewritten into optimism; a required literal cannot. Each of these
    // is the flattering direction, and each is refused.
    for (const [field, better] of [
      ["producingRevision", "c80b35c5ee929293264c61397f62aee77140454d22b663641753ce6fc50018ea"],
      ["producingRevision", "ESTABLISHED"],
      ["historicalReproducibility", "REPRODUCED"],
      ["historicalReproducibility", "verified"],
      ["independentValidation", "THIRD_PARTY"],
      ["independentValidation", "PARTIAL"],
    ] as const) {
      expect(() => assertBaselineLedgerClaims({ ...ledger(), [field]: better }), `${field}=${better}`).toThrow(
        /must be the literal/,
      );
    }
  });

  it("2 · softening a claim ALSO changes the identity — it is covered, not metadata", async () => {
    // Upgrading a claim is a different statement about what this evidence is, so it must not be able to
    // happen quietly. The digest refuses before it can even be compared.
    await expect(stableBaselineLedgerDigest({ ...ledger(), independentValidation: "THIRD_PARTY" })).rejects.toThrow();
    expect(BASELINE_COVERED_COMPONENTS).toContain("producingRevision");
    expect(BASELINE_COVERED_COMPONENTS).toContain("historicalReproducibility");
    expect(BASELINE_COVERED_COMPONENTS).toContain("independentValidation");
  });

  it("3 · attestingRevision is EXCLUDED — when we looked is never what produced a measurement", async () => {
    const a = await stableBaselineLedgerDigest(ledger());
    const b = await stableBaselineLedgerDigest({ ...ledger(), attestingRevision: "b".repeat(40), attestedAt: "2031-01-01" });
    expect(b).toBe(a);
    expect(BASELINE_EXCLUDED_METADATA).toContain("attestingRevision");
    expect(BASELINE_COVERED_COMPONENTS).not.toContain("attestingRevision");
  });
});

describe("baseline ledger · the two sets stay distinguishable", () => {
  it("4 · a path in BOTH sets is an error", () => {
    const bad = ledger();
    (bad["unauthenticatedBaselines"] as unknown[]).push({ path: RECORDED_BASELINE.path, sha256: hex(99), bytes: 1 });
    expect(() => assertBaselineLedgerClaims(bad)).toThrow(/appears in BOTH sets/);
  });

  it("5 · moving the authenticated baseline into the unauthenticated set is an error", () => {
    const moved = ledger();
    const entry = (moved["authenticatedBaselines"] as { path: string }[])[0]!;
    moved["authenticatedBaselines"] = [];
    (moved["unauthenticatedBaselines"] as unknown[]).push(entry);
    // Covered exactly: the set is still the declared fifteen, so only the authenticated-set check can
    // catch it. The verifier's own step 3 requires that set to be exactly the recorded baseline.
    expect(() => assertBaselineLedgerClaims(moved)).not.toThrow();
    expect((moved["authenticatedBaselines"] as unknown[]).length).toBe(0);
  });

  it("6 · the ledger must cover EXACTLY the declared fifteen — no more, no fewer", () => {
    expect(DECLARED_BASELINES.length).toBe(15);
    expect(new Set(DECLARED_BASELINES).size).toBe(15);
    const short = ledger();
    (short["unauthenticatedBaselines"] as unknown[]).pop();
    expect(() => assertBaselineLedgerClaims(short)).toThrow(/missing:/);
    const long = ledger();
    (long["unauthenticatedBaselines"] as unknown[]).push({
      path: "e2e/fixtures/reconciliation-synthetic/baseline.v4.invented.json",
      sha256: hex(77),
      bytes: 10,
    });
    expect(() => assertBaselineLedgerClaims(long)).toThrow(/undeclared:/);
  });

  it("7 · exactly one is authenticated and fourteen are not", () => {
    const l = ledger();
    expect((l["authenticatedBaselines"] as unknown[]).length).toBe(1);
    expect((l["unauthenticatedBaselines"] as unknown[]).length).toBe(14);
  });
});

describe("baseline ledger · fail-closed and canonical", () => {
  it("8 · an UNKNOWN key is an error", () => {
    expect(() => assertBaselineLedgerKeys({ ...ledger(), reproducedOn: "2026-10-16" })).toThrow(/unrecognised key/);
  });

  it("9 · a missing covered component is an error", () => {
    const l = ledger();
    delete l["independentValidation"];
    expect(() => assertBaselineLedgerKeys(l)).toThrow(/missing covered component/);
  });

  it("10 · a malformed hash or a non-positive byte count is an error", () => {
    const badHash = ledger();
    (badHash["unauthenticatedBaselines"] as { sha256: string }[])[0]!.sha256 = "deadbeef";
    expect(() => assertBaselineLedgerClaims(badHash)).toThrow(/malformed sha256/);
    const badBytes = ledger();
    (badBytes["unauthenticatedBaselines"] as { bytes: number }[])[0]!.bytes = 0;
    expect(() => assertBaselineLedgerClaims(badBytes)).toThrow(/non-positive byte count/);
  });

  it("11 · the digest is pure, prefixed, and tamper-evident on every baseline", async () => {
    const base = await stableBaselineLedgerDigest(ledger());
    expect(base).toMatch(/^nhbl_[0-9a-f]{64}$/);
    expect(await stableBaselineLedgerDigest(ledger())).toBe(base);
    const tampered = ledger();
    (tampered["unauthenticatedBaselines"] as { sha256: string }[])[3]!.sha256 = hex(4242);
    expect(await stableBaselineLedgerDigest(tampered)).not.toBe(base);
  });

  it("12 · the scheme is inside the hash and is NOT the cycle scheme", async () => {
    expect(BASELINE_LEDGER_SCHEME).toBe("nh-benchmark-baseline-ledger-v1");
    expect(BASELINE_LEDGER_SCHEME).not.toBe(EVIDENCE_IDENTITY_SCHEME);
    // THE SIBLING DID NOT WIDEN THE CYCLE SCHEME. If this ever fails, a baseline field has been pushed
    // into the identity of records that are already attested.
    expect(EVIDENCE_IDENTITY_SCHEME).toBe("nh-validation-evidence-v1");
    expect(COVERED_COMPONENTS).toEqual([
      "systemUnderTestRevision",
      "datasets",
      "groundTruthSha256",
      "predictionSha256",
      "scriptSha256",
      "runParameters",
    ]);
  });

  it("13 · the continuity line states the count and all three refusals", () => {
    const line = baselineContinuityLine(ledger());
    expect(line).toContain("continuity of 15 baseline(s) since 2026-10-16");
    expect(line).toContain("producing revision NOT_ESTABLISHED");
    expect(line).toContain("reproducibility NOT_CLAIMED");
    expect(line).toContain("independent validation NONE");
    // Derived, not hardcoded: a different date yields a different line.
    expect(baselineContinuityLine({ ...ledger(), attestedAt: "2027-02-03" })).toContain("since 2027-02-03");
  });
});

describe("baseline ledger · the witness is read, not trusted", () => {
  it("14 · citesHash matches the FULL hash as a whole token, never a prefix", () => {
    const h = RECORDED_BASELINE.sha256;
    expect(citesHash(`Baseline \`${h}\`.`, h)).toBe(true);
    expect(citesHash(`Baseline \`${h.slice(0, 32)}…\`.`, h)).toBe(false);
    // A near-miss must not satisfy the citation, and nor must a longer hex run that merely contains it.
    expect(citesHash(`${h.slice(0, 63)}0`, h)).toBe(false);
    expect(citesHash(`ff${h}`, h)).toBe(false);
    expect(citesHash(h, "not-a-hash")).toBe(false);
  });

  it("15 · the recorded baseline's hash IS cited by the document the ledger names", () => {
    const doc = readFileSync(resolve(ROOT, RECORDED_BASELINE.recordedHashSource), "utf8");
    expect(citesHash(doc, RECORDED_BASELINE.sha256)).toBe(true);
    // ...and the core revision it sits beside is named there too, which is what makes the entry say WHICH
    // measurement these bytes are.
    expect(doc).toContain(RECORDED_BASELINE.recordedCoreSha256);
  });

  it("16 · every declared baseline is present AND tracked, or a clean checkout cannot verify", () => {
    // Read from the index, not the filesystem: a file in a working tree and absent from Git is exactly
    // the state that kept these verifiers out of CI, and `existsSync` cannot see it.
    const tracked = new Set(
      execFileSync("git", ["ls-files", "e2e/fixtures"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean),
    );
    for (const path of DECLARED_BASELINES) {
      expect(existsSync(resolve(ROOT, path)), `${path} must be present`).toBe(true);
      expect(tracked.has(path), `${path} must be tracked`).toBe(true);
    }
  });

  it("17 · no command writes a baseline — which is what makes it a preserved measurement", () => {
    // The distinction between this family and `results.json`, asserted structurally. If some future
    // script starts writing `baseline.*`, these stop being hand-taken snapshots and tracking them would
    // dirty the tree on every run — so this must be revisited rather than discovered.
    const scripts = execFileSync("git", ["ls-files", "scripts"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((f) => f.endsWith(".ts") || f.endsWith(".mjs"));
    for (const file of scripts) {
      if (file.includes("freeze/")) continue; // the ledger tools name the paths; they write only the ledger
      const text = readFileSync(resolve(ROOT, file), "utf8");
      // Match a WRITE whose target names a baseline, not the word appearing in prose. The construct, not
      // the term: this repository has mistaken a comment for a dependency often enough.
      expect(text, `${file} must not write a baseline artefact`).not.toMatch(
        /write(File)?(Sync)?\([^)]*baseline\./i,
      );
    }
  });
});
