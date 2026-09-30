// EP-31d commit 2 · SourceNamespace — the governed, INSTANCE-grained source vocabulary.
//
// WHY A NEW VOCABULARY RATHER THAN REUSING `sourceSystem`. The obvious move is to key candidate
// identity on the `sourceSystem` values already registered in `NH_EVIDENCE_SOURCE_KEYS`. That was
// examined and rejected on evidence, for three independent reasons:
//
//   1. THE EXISTING REGISTRY CANNOT REGISTER A NAMESPACE WITHOUT A SIGNING KEY. `SourceVerifier`'s
//      constructor refuses any entry lacking a `keyId`, a `sourceSystem` AND a parseable Ed25519
//      public key, and its map is keyed by `keyId` — so a `sourceSystem` exists only as a property of
//      a key entry. A customer whose billing system cannot sign could not be named at all.
//   2. IT IS NEVER PERSISTED. The verifier is built once from `process.env` at startup, so which
//      namespaces existed when a candidate was created is not reconstructable from any record.
//   3. `sourceSystem` IS LOAD-BEARING AT CLASS GRAIN IN THE PROOF PATH. `INDEPENDENT_SOURCE_SYSTEMS`
//      decides `trustClassification` (anything outside the four classes is forced to
//      `beneficiary_controlled`), and `OUTCOME_EVIDENCE_TYPES` is keyed on the literal `"billing"` to
//      decide `evidenceRole: "outcome"` — which is what the outcome-single-use index indexes. An
//      instance-grained value such as a specific billing deployment would therefore be silently
//      downgraded to `beneficiary_controlled` + `supporting`, breaking BOTH the independence
//      classification and the single-use guard.
//
// So this is a separate vocabulary on purpose, and (3) is why that is a correctness requirement rather
// than tidiness. NOTHING in the proof/evidence path is changed by this file: it does not redefine
// `INDEPENDENT_SOURCE_SYSTEMS`, `OUTCOME_EVIDENCE_TYPES`, `makeEvidence`, `deriveEvidenceRole` or the
// outcome-single-use rule. It imports the class list for exactly ONE purpose — to REFUSE those names as
// namespace ids, so the two vocabularies cannot be quietly conflated.
//
// THREE IDENTITY LAYERS. This file defines layer 1 and knows nothing of the other two:
//
//   1. SOURCE NAMESPACE identity — `sourceNamespaceId`. Governed, instance-grained, stable. THE ONLY
//      source component of a candidate leak-instance identity.
//   2. EVIDENCE VERIFICATION KEY identity — `keyId`/public key in the Ed25519 registry. A key may
//      later REFERENCE a namespace; the namespace never depends on the key, so rotating a signing key
//      cannot move any candidate identity.
//   3. PSEUDONYMISATION KEY identity — the HMAC key that turns an identity into a stored `sourceRef`.
//      Downstream of layer 1, and never an input to it.
//
// WHAT THIS FILE IS NOT. It is not a registry. There is no persistence here, no environment parsing and
// no lifecycle — a namespace is not authoritative merely because this type can hold it. Who may register
// one, who activates it, and which namespaces a boundary may use are governed objects that do not exist
// yet; until they do, `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` stays false and candidate emission stays
// refused. See docs/GOVERNED_DETECTION_V1.md.
import { INDEPENDENT_SOURCE_SYSTEMS } from "../domain/evidence";

/** Version of the namespace vocabulary itself. A change here is a new vocabulary, never a re-grade. */
export const SOURCE_NAMESPACE_SCHEME = "nh-source-namespace-v1";

/**
 * Canonical form of a namespace id: lowercase, starts alphanumeric, 3–64 chars, `. _ -` inside.
 *
 * Deliberately narrow. The id is a component of a candidate identity, so its spelling is load-bearing
 * forever: `NS-Billing` and `ns-billing` must not be able to denote the same source under two identities.
 * Lowercasing is therefore REQUIRED of the caller rather than applied here — silently normalising input
 * would mean two registrations that look different are the same, which is a decision for governance to
 * make explicitly, not for a validator to make quietly.
 */
export const SOURCE_NAMESPACE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;

/** Names that may NOT be a namespace id, because they already mean something else. */
export const RESERVED_NAMESPACE_IDS: readonly string[] = Object.freeze([...INDEPENDENT_SOURCE_SYSTEMS]);

/**
 * A registered source namespace: one authoritative system-of-record instance.
 *
 * `label` is descriptive and is NEVER part of any identity — it is the `datasetId` lesson applied in
 * advance. Renaming a namespace must not be able to create a second identity for the same source.
 */
export interface SourceNamespace {
  readonly sourceNamespaceId: string;
  readonly label: string;
}

/** Why this id is unusable, or null. Names the rule, and never blames the value's content. */
export function sourceNamespaceIdProblem(value: unknown): string | null {
  if (typeof value !== "string") return "sourceNamespaceId must be a string";
  if (value !== value.trim()) return "sourceNamespaceId must not be surrounded by whitespace";
  if (!SOURCE_NAMESPACE_ID_PATTERN.test(value)) {
    return "sourceNamespaceId must be 3–64 characters, lowercase, starting with a letter or digit";
  }
  if (RESERVED_NAMESPACE_IDS.includes(value)) {
    // The class-grained evidence vocabulary is not an instance-grained namespace. Accepting "billing"
    // here would put one name in two meanings, and the proof path's reading of it is the load-bearing
    // one — see this file's header, reason 3.
    return "sourceNamespaceId must not reuse a class-grained evidence source system name";
  }
  return null;
}

export function isValidSourceNamespaceId(value: unknown): boolean {
  return sourceNamespaceIdProblem(value) === null;
}

/**
 * Build a namespace, or throw. Frozen, and validated at construction so an invalid id cannot travel.
 *
 * Mirrors `makeEvidence`'s stance: the caller's opinion of what a value "is" never survives on its own.
 */
export function makeSourceNamespace(input: SourceNamespace): SourceNamespace {
  const problem = sourceNamespaceIdProblem(input.sourceNamespaceId);
  if (problem !== null) throw new Error(`invalid source namespace: ${problem}`);
  if (typeof input.label !== "string" || input.label.trim() === "") {
    throw new Error("invalid source namespace: label must be a non-empty string");
  }
  return Object.freeze({ sourceNamespaceId: input.sourceNamespaceId, label: input.label.trim() });
}
