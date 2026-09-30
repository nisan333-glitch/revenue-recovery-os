// Stable evidence identity for a synthetic-validation cycle.
//
// WHY THIS EXISTS. The validation cycles were "frozen" with a `compositeSha256` computed over the whole
// manifest — including `frozenAt: new Date().toISOString()` and a `gitHead` read from `git rev-parse HEAD`.
// Two consequences, both demonstrated rather than suspected:
//
//   • The digest changes on every re-freeze even when nothing substantive moved. A controlled test found
//     `datasets`, `groundTruthSha256`, `predictionSha256`, `scriptSha256`, `runParameters` and `gitHead` all
//     IDENTICAL across two runs 1.1s apart, with `frozenAt` and `compositeSha256` the only differing fields.
//     So it could never serve as a cross-session identity, and reporting it as "INTACT" was wrong.
//   • `git rev-parse HEAD` ignores a dirty working tree, so the recorded `gitHead` attests to the last
//     commit rather than to the code actually tested. Both historical cycles were provably dirty: cycle 1's
//     ground truth requires a generator newer than its recorded commit, and cycle 2's scripts did not exist
//     at its recorded commit at all.
//
// THE THREE FIELDS THIS MODULE KEEPS APART, because collapsing them is the original defect:
//
//   1. `frozenAt` — nondeterministic METADATA. Excluded. Reported, never hashed.
//   2. `gitHead` as written by the old verifier — EXCLUDED and never promoted. It is not trustworthy as
//      historical evidence merely because it appears in a regenerated manifest.
//   3. `systemUnderTestRevision` — SUBSTANTIVE and COVERED. Identical datasets, ground truth and scripts run
//      against two different product revisions can produce different results, so the revision is part of
//      what the evidence *is*. It is only ever set from independently established evidence; where it cannot
//      be established it is the literal `"unknown"`, which is recorded and downgrades the record rather than
//      being quietly filled in from (2).
//
// WHAT IT DOES NOT DO. It does not manufacture a historical Git freeze that never existed. Neither cycle
// ever had one: `.gitignore` excludes all of `e2e/fixtures/`, so no dataset, ground truth, prediction or
// manifest was ever tracked. A tracked evidence record attests to components verified on the date it was
// written, and says so.
import { sha256Hex } from "../assessment/fingerprint";

/** Version of the identity derivation. A change here is a new scheme, never a silent re-grade. */
export const EVIDENCE_IDENTITY_SCHEME = "nh-validation-evidence-v1";

/**
 * Components that ARE the evidence, in canonical order. Enumerated explicitly: an identity derived from
 * "whatever keys happen to be present" is how `frozenAt` got inside the old composite in the first place.
 */
export const COVERED_COMPONENTS: readonly string[] = Object.freeze([
  "systemUnderTestRevision",
  "datasets",
  "groundTruthSha256",
  "predictionSha256",
  "scriptSha256",
  "runParameters",
]);

/** Recognised but deliberately OUTSIDE the identity. Present so an unknown key can be told from these. */
export const EXCLUDED_METADATA: readonly string[] = Object.freeze([
  "frozenAt",
  "gitHead",
  "compositeSha256",
  "cycle",
  "supersedes",
  "note",
  "historicalReproducibility",
  "historicalReproducibilityReason",
  "evidenceIdentity",
  "attestedAt",
  "attestedNote",
]);

/** `unknown`, a 40-hex commit, or a 40-hex commit marked dirty. Nothing else is a revision. */
export const REVISION_PATTERN = /^(unknown|[0-9a-f]{40}(-dirty)?)$/;

export class NonCanonicalValueError extends Error {
  constructor(path: string, detail: string) {
    super(`evidence record is not canonical at ${path}: ${detail}`);
    this.name = "NonCanonicalValueError";
  }
}

const utf8 = new TextEncoder();
const framed = (tag: string, value: string) => `${tag}${utf8.encode(value).length}:${value}`;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Canonical encoding of one value. RECURSIVE, and length-framed at every level.
 *
 * Object keys are sorted at EVERY DEPTH — a single-level sort would leave nested objects at the mercy of
 * insertion order, which is exactly the kind of accidental input `JSON.stringify` smuggles in. Arrays keep
 * their defined order, because order is meaning in a list of datasets.
 *
 * Length framing rather than separator-joining means no value can impersonate a delimiter, so the encoding
 * is injective without having to forbid characters that legitimately appear in customer-facing strings.
 *
 * Anything that is not a string, finite number, boolean, null, plain object or array is REJECTED. A `Date`,
 * a `BigInt`, `NaN`, `undefined` or a class instance each have more than one plausible serialisation, and an
 * identity built on a guess about which one is not an identity.
 */
export function canonicalValue(value: unknown, path = "$"): string {
  if (value === null) return "z";
  if (typeof value === "string") return framed("s", value);
  if (typeof value === "boolean") return value ? "bT" : "bF";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new NonCanonicalValueError(path, `non-finite number (${value})`);
    return framed("n", String(value));
  }
  if (Array.isArray(value)) {
    const items = value.map((item, i) => canonicalValue(item, `${path}[${i}]`));
    return `a${items.length}:${items.map((item) => framed("i", item)).join("")}`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const parts = keys.map((key) => framed("k", key) + framed("v", canonicalValue(value[key], `${path}.${key}`)));
    return `o${keys.length}:${parts.join("")}`;
  }
  const kind =
    typeof value === "function" ? "function"
    : typeof value === "symbol" ? "symbol"
    : typeof value === "bigint" ? "bigint"
    : typeof value === "undefined" ? "undefined"
    : value instanceof Date ? "Date"
    : "non-plain object";
  throw new NonCanonicalValueError(path, `unsupported value type (${kind})`);
}

export interface EvidenceRecordInput {
  readonly systemUnderTestRevision: string;
  readonly datasets: readonly { readonly name: string; readonly sha256: string }[];
  readonly groundTruthSha256: string;
  readonly predictionSha256: string;
  readonly scriptSha256: Readonly<Record<string, string>>;
  readonly runParameters: Readonly<Record<string, unknown>>;
}

/**
 * Reject a record that carries a key this module has never heard of.
 *
 * FAIL-CLOSED ON THE UNKNOWN. Ignoring an unfamiliar field is how a future manifest addition would end up
 * silently outside the identity — the same failure mode as the original composite, arrived at from the other
 * direction. So an unknown key is an error, and adding one is a deliberate act with a scheme bump.
 */
export function assertKnownKeys(record: Readonly<Record<string, unknown>>): void {
  const known = new Set([...COVERED_COMPONENTS, ...EXCLUDED_METADATA]);
  const unknown = Object.keys(record).filter((key) => !known.has(key)).sort();
  if (unknown.length > 0) {
    throw new Error(
      `evidence record has unrecognised key(s): ${unknown.join(", ")}. ` +
        "Add it to COVERED_COMPONENTS or EXCLUDED_METADATA deliberately — an unknown field is never " +
        "silently left outside the evidence identity.",
    );
  }
  for (const component of COVERED_COMPONENTS) {
    if (!(component in record)) throw new Error(`evidence record is missing covered component: ${component}`);
  }
}

/** A revision usable for a PROSPECTIVE freeze: a real commit, and not a dirty tree. */
export function assertProspectiveRevision(revision: string): void {
  if (!REVISION_PATTERN.test(revision)) throw new Error(`systemUnderTestRevision is malformed: expected 40-hex, '<sha>-dirty' or 'unknown'`);
  if (revision === "unknown") throw new Error("a prospective freeze requires a known systemUnderTestRevision");
  if (revision.endsWith("-dirty")) {
    throw new Error(
      "a prospective freeze refuses a dirty working tree: a dirty tree is not a revision, and recording " +
        "its last commit would repeat the defect this scheme exists to fix",
    );
  }
}

/**
 * The stable evidence identity. Deterministic, timestamp-free, and a function of the covered components only.
 *
 * Returns `nhev_<sha256>` — prefixed like the contract's `pds_` keys so a digest can never be mistaken for a
 * bare hash of something else.
 */
export async function stableEvidenceDigest(record: Readonly<Record<string, unknown>>): Promise<string> {
  assertKnownKeys(record);
  const revision = record["systemUnderTestRevision"];
  if (typeof revision !== "string" || !REVISION_PATTERN.test(revision)) {
    throw new Error("systemUnderTestRevision must be 'unknown', a 40-hex commit, or '<40-hex>-dirty'");
  }
  const encoded = COVERED_COMPONENTS.map((component) =>
    framed("c", framed("k", component) + framed("v", canonicalValue(record[component], `$.${component}`))),
  ).join("");
  return `nhev_${await sha256Hex(`${EVIDENCE_IDENTITY_SCHEME}${encoded}`)}`;
}
