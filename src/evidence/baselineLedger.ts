// Preservation ledger for the reconciliation benchmark's HISTORICAL BASELINE MEASUREMENTS.
//
// WHY THIS IS A SIBLING AND NOT A WIDENING. `evidenceIdentity.ts` identifies a synthetic-validation
// CYCLE: its covered components are `datasets`, `groundTruthSha256`, `predictionSha256`, `scriptSha256`
// and `runParameters`, and `assertKnownKeys` fails closed on anything else. A baseline is a different kind
// of object — one hand-taken snapshot of a scorer's output — so widening that scheme to hold both would
// change what `nh-validation-evidence-v1` means and re-identify records that are already attested. This is
// the pattern Detector #2, the Expectation Extract and the obligation-ref variant all set: an additive,
// separately governed sibling artefact, never a widening of one whose canonical form is already hashed.
// `evidenceIdentity.ts`'s scheme, components and digests are unchanged by this file existing.
//
// WHAT A BASELINE IS, established from the code rather than assumed. No command writes a `baseline.*`
// file: `score.mjs` writes `scoreboard.json` and `report.txt`, and `run.ts` writes `results.json`. A
// baseline is a copy taken by hand at a moment someone wanted to keep. That is exactly what makes it a
// PRESERVED MEASUREMENT rather than a regenerated output, and why tracking one cannot dirty the tree on a
// routine run — the test that `results.json` fails.
//
// WHAT THIS LEDGER DOES NOT CLAIM, and the three fields that make the refusal structural rather than
// rhetorical:
//
//   • `producingRevision` is the literal "NOT_ESTABLISHED". No baseline file carries a core revision, a
//     scorer revision or a timestamp — their only top-level keys are `totalPlantedMinor`, `knownCases`,
//     `unknownCases`, `mustRefuseCases` and `candidates` — and none was ever tracked, so nothing in the
//     repository states which build produced which measurement.
//   • `historicalReproducibility` is "NOT_CLAIMED". The reconciliation core has moved four times since the
//     earliest of these; a pre-correction baseline cannot be reproduced on this build at all, and the
//     version gates would block the attempt rather than silently answer it.
//   • `independentValidation` is "NONE". Every artefact here was produced, kept and now attested by the
//     same party.
//
// `attestingRevision` — the revision at which we HASHED the bytes — is excluded metadata, reported and
// never hashed, and it may never be read as the revision that PRODUCED the measurement. That is
// `evidenceIdentity.ts`'s point-2/point-3 split applied to this family: a record of when we looked is not
// a record of what was tested.
import { sha256Hex } from "../assessment/fingerprint";
import { canonicalValue, framed } from "../domain/canonicalValue";

/** Version of this ledger's derivation. A change here is a new scheme, never a silent re-grade. */
export const BASELINE_LEDGER_SCHEME = "nh-benchmark-baseline-ledger-v1";

/**
 * Components that ARE the evidence, in canonical order.
 *
 * The three claim fields are COVERED, not metadata, and that is deliberate: upgrading one is a different
 * statement about what this evidence is, so it must change the identity. The same reasoning that puts
 * `systemUnderTestRevision` inside the cycle identity and keeps `frozenAt` outside it.
 */
export const BASELINE_COVERED_COMPONENTS: readonly string[] = Object.freeze([
  "authenticatedBaselines",
  "unauthenticatedBaselines",
  "producingRevision",
  "historicalReproducibility",
  "independentValidation",
]);

/** Recognised but deliberately OUTSIDE the identity. Present so an unknown key can be told from these. */
export const BASELINE_EXCLUDED_METADATA: readonly string[] = Object.freeze([
  "ledgerScheme",
  "ledgerIdentity",
  "attestedAt",
  "attestedNote",
  "attestingRevision",
  "producingRevisionReason",
  "historicalReproducibilityReason",
  "independentValidationReason",
]);

/**
 * The three claims, as REQUIRED LITERALS.
 *
 * Enforced rather than described, for the reason `submitterStillControls` is a required non-empty list
 * rather than a paragraph: prose about a limitation can be rewritten into optimism and a required literal
 * cannot. Raising any of these is a deliberate act that changes the ledger identity and fails this
 * assertion until the code is changed with it.
 */
export const REQUIRED_CLAIMS: Readonly<Record<string, string>> = Object.freeze({
  producingRevision: "NOT_ESTABLISHED",
  historicalReproducibility: "NOT_CLAIMED",
  independentValidation: "NONE",
});

/** A 64-hex digest and nothing else. */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface BaselineEntry {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

/**
 * A baseline whose hash is recorded elsewhere in the repository beside a core revision.
 *
 * This establishes WHICH MEASUREMENT the bytes are. It does not establish who produced them or when, and
 * the citation is a repository artefact the same party controls — so an authenticated entry is better
 * evidence than an unauthenticated one and is still not provenance.
 */
export interface AuthenticatedBaselineEntry extends BaselineEntry {
  readonly recordedHashSource: string;
  readonly recordedCoreSha256: string;
  readonly recordedCoreCommit: string;
}

/**
 * THE DECLARED SET. Fifteen paths, declared and never globbed.
 *
 * A glob would silently absorb a future `baseline.v4.*` into a record whose prose was written about
 * fifteen files — *a serialised artefact's schema is declared, never inferred from a sample of its own
 * rows*, which this repository has already paid for once in `csv(rows)` dropping a late column. An
 * undeclared `baseline.*` found on disk is an error, not a silent addition.
 */
export const DECLARED_BASELINES: readonly string[] = Object.freeze([
  "e2e/fixtures/reconciliation-obligation-ref/baseline.variant.json",
  "e2e/fixtures/reconciliation-obligation-ref/baseline.variant.postcapability.json",
  "e2e/fixtures/reconciliation-obligation-ref/baseline.variant.postpairing.json",
  "e2e/fixtures/reconciliation-obligation-ref/baseline.variant.postpairing.txt",
  "e2e/fixtures/reconciliation-obligation-ref/baseline.variant.txt",
  "e2e/fixtures/reconciliation-synthetic/baseline.postfix.v2.json",
  "e2e/fixtures/reconciliation-synthetic/baseline.postfix.v2.txt",
  "e2e/fixtures/reconciliation-synthetic/baseline.prefix.v2.json",
  "e2e/fixtures/reconciliation-synthetic/baseline.prefix.v2.txt",
  "e2e/fixtures/reconciliation-synthetic/baseline.v3.postcapability.json",
  "e2e/fixtures/reconciliation-synthetic/baseline.v3.postfix.json",
  "e2e/fixtures/reconciliation-synthetic/baseline.v3.postfix.txt",
  "e2e/fixtures/reconciliation-synthetic/baseline.v3.postpairing.json",
  "e2e/fixtures/reconciliation-synthetic/baseline.v3.prefix.json",
  "e2e/fixtures/reconciliation-synthetic/baseline.v3.prefix.txt",
]);

/**
 * The ONE baseline whose hash is recorded in the repository, and where.
 *
 * `docs/BENCHMARK_REVISION_V2.md` §5 records it beside core
 * `c80b35c5ee929293264c61397f62aee77140454d22b663641753ce6fc50018ea` — the official PRE-FIX baseline,
 * measured against the unmodified core at commit `fa28a80`. The citation is checked against the document
 * on every verification rather than copied here and trusted: *a governed definition is verified against
 * its own witness wherever it is resolved for use.*
 */
export const RECORDED_BASELINE: Readonly<{
  readonly path: string;
  readonly sha256: string;
  readonly recordedHashSource: string;
  readonly recordedCoreSha256: string;
  readonly recordedCoreCommit: string;
}> = Object.freeze({
  path: "e2e/fixtures/reconciliation-synthetic/baseline.prefix.v2.json",
  sha256: "5a951e406350d2a6b3c6d0d3cb3dde0fd154da230cd12e374826f0fdd5a82fef",
  recordedHashSource: "docs/BENCHMARK_REVISION_V2.md",
  recordedCoreSha256: "c80b35c5ee929293264c61397f62aee77140454d22b663641753ce6fc50018ea",
  recordedCoreCommit: "fa28a80",
});

/**
 * Reject a ledger that carries a key this module has never heard of.
 *
 * FAIL-CLOSED ON THE UNKNOWN, for `evidenceIdentity.ts`'s reason: ignoring an unfamiliar field is how a
 * future addition ends up silently outside the identity.
 */
export function assertBaselineLedgerKeys(ledger: Readonly<Record<string, unknown>>): void {
  const known = new Set([...BASELINE_COVERED_COMPONENTS, ...BASELINE_EXCLUDED_METADATA]);
  const unknown = Object.keys(ledger).filter((key) => !known.has(key)).sort();
  if (unknown.length > 0) {
    throw new Error(
      `baseline ledger has unrecognised key(s): ${unknown.join(", ")}. Add it to ` +
        "BASELINE_COVERED_COMPONENTS or BASELINE_EXCLUDED_METADATA deliberately — an unknown field is " +
        "never silently left outside the ledger identity.",
    );
  }
  for (const component of BASELINE_COVERED_COMPONENTS) {
    if (!(component in ledger)) throw new Error(`baseline ledger is missing covered component: ${component}`);
  }
}

/**
 * The claims may not be softened, and the two sets may not be merged.
 *
 * THE SETS ARE SEPARATE ARRAYS RATHER THAN ONE LIST WITH A FLAG. *The unavailable states stay
 * distinguishable* is better served by a shape that cannot express the mixed set than by a label that can
 * be misread — the same reason `leakInstanceIdentityStatus` and `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE`
 * are named apart. A path in both sets, or in neither, is an error.
 */
export function assertBaselineLedgerClaims(ledger: Readonly<Record<string, unknown>>): void {
  for (const [field, required] of Object.entries(REQUIRED_CLAIMS)) {
    if (ledger[field] !== required) {
      throw new Error(
        `baseline ledger claim '${field}' must be the literal '${required}' — this ledger attests ` +
          "continuity of bytes from its attestedAt date forward and nothing earlier. Raising it is a " +
          "deliberate act requiring independently established evidence and a code change here.",
      );
    }
  }
  const authenticated = ledger["authenticatedBaselines"] as readonly BaselineEntry[];
  const unauthenticated = ledger["unauthenticatedBaselines"] as readonly BaselineEntry[];
  if (!Array.isArray(authenticated) || !Array.isArray(unauthenticated)) {
    throw new Error("baseline ledger: both baseline sets must be arrays");
  }
  const authPaths = authenticated.map((e) => e.path);
  const unauthPaths = unauthenticated.map((e) => e.path);
  const overlap = authPaths.filter((p) => unauthPaths.includes(p));
  if (overlap.length > 0) {
    throw new Error(`baseline ledger: ${overlap.join(", ")} appears in BOTH sets — the sets are disjoint by design`);
  }
  const all = [...authPaths, ...unauthPaths].sort();
  const declared = [...DECLARED_BASELINES].sort();
  const missing = declared.filter((p) => !all.includes(p));
  const extra = all.filter((p) => !declared.includes(p));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      "baseline ledger does not cover exactly the declared set" +
        (missing.length > 0 ? ` · missing: ${missing.join(", ")}` : "") +
        (extra.length > 0 ? ` · undeclared: ${extra.join(", ")}` : ""),
    );
  }
  for (const entry of [...authenticated, ...unauthenticated]) {
    if (!SHA256_PATTERN.test(entry.sha256)) throw new Error(`baseline ledger: ${entry.path} has a malformed sha256`);
    if (!Number.isInteger(entry.bytes) || entry.bytes <= 0) {
      throw new Error(`baseline ledger: ${entry.path} has a non-positive byte count`);
    }
  }
}

/**
 * The stable ledger identity. Deterministic, timestamp-free, a function of the covered components only.
 *
 * Returns `nhbl_<sha256>`, prefixed so it can never be mistaken for `nhev_` or for a bare hash.
 */
export async function stableBaselineLedgerDigest(ledger: Readonly<Record<string, unknown>>): Promise<string> {
  assertBaselineLedgerKeys(ledger);
  assertBaselineLedgerClaims(ledger);
  const encoded = BASELINE_COVERED_COMPONENTS.map((component) =>
    framed("c", framed("k", component) + framed("v", canonicalValue(ledger[component], `$.${component}`))),
  ).join("");
  return `nhbl_${await sha256Hex(`${BASELINE_LEDGER_SCHEME}${encoded}`)}`;
}

/**
 * Does this document text cite that hash?
 *
 * ONE IMPLEMENTATION, shared by the attester and the verifier, because a second implementation of the same
 * rule is a second thing that can drift from it — the lesson the verifier-log slice recorded when a
 * sanitizer was re-derived beside a call site.
 *
 * The full 64 hex characters, matched as a whole token. A prefix match would let a truncated or a
 * near-miss hash satisfy the citation, which is the kind of guard that passes while meaning nothing.
 */
export function citesHash(documentText: string, sha256: string): boolean {
  if (!SHA256_PATTERN.test(sha256)) return false;
  return new RegExp(`(?<![0-9a-f])${sha256}(?![0-9a-f])`).test(documentText);
}

/**
 * The one-line statement of what this ledger attests, derived from the ledger itself.
 *
 * Deliberately the same shape as `continuityLine` for the cycle records, and deliberately NOT the same
 * function: that one reads `attestedAt` beside a downgrade marker and this one reads it beside three claim
 * fields. Sharing one would mean one of the two reporting a field the other does not have.
 */
export function baselineContinuityLine(ledger: Readonly<Record<string, unknown>>): string {
  const since = typeof ledger["attestedAt"] === "string" ? ledger["attestedAt"] : "an unstated date";
  const authenticated = (ledger["authenticatedBaselines"] as readonly BaselineEntry[] | undefined)?.length ?? 0;
  const unauthenticated = (ledger["unauthenticatedBaselines"] as readonly BaselineEntry[] | undefined)?.length ?? 0;
  return (
    `attests  : continuity of ${authenticated + unauthenticated} baseline(s) since ${since} · ` +
    `producing revision ${String(ledger["producingRevision"])} · ` +
    `reproducibility ${String(ledger["historicalReproducibility"])} · ` +
    `independent validation ${String(ledger["independentValidation"])}`
  );
}
