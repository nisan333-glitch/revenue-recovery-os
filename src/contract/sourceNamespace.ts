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

// ── Step 5 · Resolving an AUTHORITATIVE namespace for one submission ─────────────────────────────
//
// D2: a governed boundary → permitted-namespace set, with automatic inheritance ONLY when exactly one
// namespace is permitted. Everything below is pure — the caller supplies the governance rows it read, so
// this module can be exercised exhaustively without a database and cannot reach one.
//
// THREE INVARIANTS THIS ENCODES, each of which fixes a defect found in review rather than a hypothetical:
//
//   1. CARDINALITY, NOT RECENCY. Nothing here ever picks "the latest ACTIVE" of anything. Where authority
//      must be singular, two ACTIVE rows is an INVARIANT VIOLATION and is refused. Choosing between them
//      would mean the system silently decided which authority governed a submission.
//   2. AN EMPTY BINDING HISTORY IS NOT THE SAME AS A RETIRED ONE. If a dataset has ever had an explicit
//      binding, the absence of an ACTIVE revision is a REFUSAL, never a fall-back to inheritance —
//      otherwise the RETIRE → ACTIVATE correction window would silently downgrade authority from explicit
//      to inherited, changing which namespace governs the bytes while nobody decided to.
//   3. DECLARED PROVENANCE IS CHECKED, NEVER TRUSTED. `provenance.sourceSystems.billing` is free text the
//      uploader types. It is compared against the resolved namespace's label and can only REFUSE; it can
//      never select, widen or establish authority.
//
// The ordering rule (`activatedAt <= firstSeenAt`) is deliberately adopted here, though EP-26 declined to
// copy it to analysis terms. The reasoning differs: re-reading an extract under a later cut-off is a
// legitimate question to re-ask, whereas where the bytes CAME FROM is a fact about provenance and cannot be
// re-asked. A permitted set activated after a dataset was first seen must not retroactively govern it.
import { sha256Hex } from "../assessment/fingerprint";
import { canonicalValue } from "../domain/canonicalValue";
import type { PolicyState } from "./policyLifecycle";

/** Version of the lineage-hash derivation. A change here is a new scheme, never a silent re-grade. */
export const SOURCE_RESOLUTION_SCHEME = "nh-source-resolution-v1";

/** Every way namespace resolution can refuse. Typed, named, and never thrown. */
export type SourceResolutionRefusal =
  /** No governance exists at all for this boundary. */
  | "source_namespace_unresolved"
  /** The resolved namespace has no ACTIVE version. */
  | "source_namespace_not_active"
  /** The resolved namespace has MORE THAN ONE ACTIVE version. Never resolved by recency. */
  | "source_namespace_version_ambiguous"
  /** The permitted set names more than one namespace, so inheritance cannot be unambiguous. */
  | "source_namespace_ambiguous"
  /** The boundary has no ACTIVE permitted set. */
  | "source_permitted_set_unresolved"
  /** The boundary has more than one ACTIVE permitted set. */
  | "source_permitted_set_ambiguous"
  /** More than one ACTIVE binding revision for these bytes. */
  | "source_binding_ambiguous"
  /** A binding history exists with no ACTIVE revision. NEVER falls back to inheritance. */
  | "source_binding_retired_without_replacement"
  /** The permitted set was activated after these bytes were first seen. */
  | "source_binding_postdates_sighting"
  /** The uploader's declared billing source disagrees with the resolved namespace. */
  | "source_provenance_declaration_mismatch";

export type SourceBindingMode = "explicit" | "inherited";

/** One explicit binding revision, as read from governance. */
export interface BindingRevisionRow {
  readonly revision: number;
  readonly namespaceId: string;
  readonly state: PolicyState | null;
}

/** One registered namespace version, as read from governance. */
export interface NamespaceVersionRow {
  readonly namespaceId: string;
  readonly namespaceVersion: string;
  readonly state: PolicyState | null;
  readonly label: string;
}

/** One permitted set version and its members, as read from governance. */
export interface PermittedSetRow {
  readonly setId: string;
  readonly setVersion: string;
  readonly state: PolicyState | null;
  /** RFC3339, or null when never activated. Compared against the dataset's first sighting. */
  readonly activatedAt: string | null;
  readonly memberNamespaceIds: readonly string[];
}

export interface SourceResolutionInput {
  readonly boundaryId: string;
  readonly datasetFingerprint: string;
  /** EVERY revision ever recorded for these bytes, in any state. Emptiness is meaningful — invariant 2. */
  readonly bindingRevisions: readonly BindingRevisionRow[];
  readonly permittedSets: readonly PermittedSetRow[];
  readonly namespaceVersions: readonly NamespaceVersionRow[];
  /** When this boundary first saw these bytes. From `recordDatasetSighting`, never from the request. */
  readonly firstSeenAt: string;
  /** `provenance.sourceSystems.billing` — a declaration with no authority. */
  readonly declaredBillingSource: string;
}

/** The lineage a resolution is reconstructable from. Audit only — never part of candidate identity. */
export interface SourceResolutionLineage {
  readonly sourceNamespaceId: string;
  readonly sourceNamespaceVersion: string;
  readonly sourceBindingMode: SourceBindingMode;
  readonly sourcePermittedSetId: string | null;
  readonly sourcePermittedSetVersion: string | null;
  readonly sourceBindingRevision: number | null;
}

export type SourceResolution =
  | { readonly resolved: true; readonly lineage: SourceResolutionLineage }
  | { readonly resolved: false; readonly reason: SourceResolutionRefusal; readonly detail: string };

function refuse(reason: SourceResolutionRefusal, detail: string): SourceResolution {
  return Object.freeze({ resolved: false, reason, detail });
}

/**
 * Exactly one ACTIVE version of `namespaceId`, or a typed refusal.
 *
 * INVARIANT 1 IN ITS SHARPEST FORM. "The latest ACTIVE version" is the tempting formulation and it is a
 * silent choice between two authorities — so 0 and >1 are BOTH refusals, and only a population of exactly
 * one resolves. The version that resolves is stamped on the execution, so a later reader knows which
 * registered definition governed, not merely which namespace.
 */
function soleActiveVersion(
  namespaceId: string,
  namespaceVersions: readonly NamespaceVersionRow[],
): NamespaceVersionRow | SourceResolutionRefusal {
  const active = namespaceVersions.filter((v) => v.namespaceId === namespaceId && v.state === "ACTIVE");
  if (active.length === 0) return "source_namespace_not_active";
  if (active.length > 1) return "source_namespace_version_ambiguous";
  return active[0]!;
}

/**
 * Resolve the authoritative namespace for one submission, or refuse with a named reason.
 *
 * NEVER THROWS on a governance condition: candidate-capable staging must fail closed while ordinary
 * assessment completes normally, which is the invariant EP-31c established and this preserves.
 */
export function resolveSourceNamespace(input: SourceResolutionInput): SourceResolution {
  // ── Invariant 2 · a binding HISTORY forecloses inheritance, whatever state it is in ──────────────
  if (input.bindingRevisions.length > 0) {
    const active = input.bindingRevisions.filter((r) => r.state === "ACTIVE");
    if (active.length > 1) {
      return refuse(
        "source_binding_ambiguous",
        "more than one explicit source binding is active for these bytes; no authority is chosen between them",
      );
    }
    if (active.length === 0) {
      // THE CORRECTION WINDOW. A retired binding with no activated replacement means authority is
      // temporarily absent — not that it reverts to whatever the boundary happens to permit.
      return refuse(
        "source_binding_retired_without_replacement",
        "these bytes have an explicit source-binding history with no active revision; authority does not " +
          "fall back to inheritance, so candidate-capable staging is refused until a replacement is activated",
      );
    }
    const binding = active[0]!;
    const version = soleActiveVersion(binding.namespaceId, input.namespaceVersions);
    if (typeof version === "string") {
      return refuse(version, `the explicitly bound namespace cannot be resolved to exactly one active version`);
    }
    return declarationChecked(input, {
      sourceNamespaceId: binding.namespaceId,
      sourceNamespaceVersion: version.namespaceVersion,
      sourceBindingMode: "explicit",
      sourcePermittedSetId: null,
      sourcePermittedSetVersion: null,
      sourceBindingRevision: binding.revision,
    }, version.label);
  }

  // ── No history at all: inheritance may be considered ────────────────────────────────────────────
  const activeSets = input.permittedSets.filter((s) => s.state === "ACTIVE");
  if (activeSets.length === 0) {
    return refuse(
      "source_permitted_set_unresolved",
      "this boundary has no active permitted-namespace set, so no namespace can be inherited",
    );
  }
  if (activeSets.length > 1) {
    return refuse(
      "source_permitted_set_ambiguous",
      "this boundary has more than one active permitted-namespace set; no authority is chosen between them",
    );
  }
  const set = activeSets[0]!;
  if (set.memberNamespaceIds.length !== 1) {
    // Multi-source boundaries are legitimate; they simply cannot be resolved by inheritance.
    return refuse(
      "source_namespace_ambiguous",
      `the active permitted set names ${set.memberNamespaceIds.length} namespaces, so an explicit binding is ` +
        "required for these bytes",
    );
  }
  if (set.activatedAt === null || set.activatedAt > input.firstSeenAt) {
    // The anti-tuning ordering. Authority must predate the data it governs.
    return refuse(
      "source_binding_postdates_sighting",
      "the permitted set was activated after these bytes were first seen; authority may not be granted " +
        "retroactively, so an explicit binding is required",
    );
  }
  const memberId = set.memberNamespaceIds[0]!;
  const version = soleActiveVersion(memberId, input.namespaceVersions);
  if (typeof version === "string") {
    return refuse(version, "the inherited namespace cannot be resolved to exactly one active version");
  }
  return declarationChecked(input, {
    sourceNamespaceId: memberId,
    sourceNamespaceVersion: version.namespaceVersion,
    sourceBindingMode: "inherited",
    sourcePermittedSetId: set.setId,
    sourcePermittedSetVersion: set.setVersion,
    sourceBindingRevision: null,
  }, version.label);
}

/**
 * The last gate: the uploader's declaration must AGREE with the resolved authority.
 *
 * It can only refuse. Following `SourceVerifier.verify`, which rejects when `trusted.sourceSystem` differs
 * from the claim rather than letting the claim decide, this compares and never selects. A boundary that
 * declares nothing is not blocked by it — an empty declaration is silence, not a contradiction.
 */
function declarationChecked(
  input: SourceResolutionInput,
  lineage: SourceResolutionLineage,
  resolvedLabel: string,
): SourceResolution {
  const declared = input.declaredBillingSource.trim();
  if (declared !== "" && declared !== resolvedLabel.trim()) {
    return refuse(
      "source_provenance_declaration_mismatch",
      "the declared billing source system does not match the governed namespace resolved for these bytes",
    );
  }
  return Object.freeze({ resolved: true, lineage: Object.freeze({ ...lineage }) });
}

/**
 * `sha256:<64 hex>` over the resolution lineage — the integrity check `bindingHash` cannot provide.
 *
 * WHY IT IS NOT IN `bindingHash`. `canonicalBinding` feeds BOTH `hashExecutionBinding` AND
 * `deriveExecutionId`, whose result is the execution's identity and its idempotency key. Adding these
 * fields there would change every execution id, break replay idempotency, make the frozen validation
 * cycles' recorded ids unreproducible, and constitute the contract's own definition of a MAJOR change. So
 * lineage is persisted beside the binding, and this hash makes it tamper-evident on its own terms.
 *
 * The encoding is `canonicalValue` — recursive, length-framed, key-order-insensitive at every depth, and
 * rejecting any value type with more than one plausible serialisation. Deliberately NOT a string
 * concatenation: `["a","bc"]` and `["ab","c"]` must not collide, and a joined string cannot promise that.
 */
export async function sourceResolutionHash(
  boundaryId: string,
  datasetFingerprint: string,
  lineage: SourceResolutionLineage,
): Promise<string> {
  const canonical = canonicalValue({
    scheme: SOURCE_RESOLUTION_SCHEME,
    boundaryId,
    datasetFingerprint,
    sourceNamespaceId: lineage.sourceNamespaceId,
    sourceNamespaceVersion: lineage.sourceNamespaceVersion,
    sourceBindingMode: lineage.sourceBindingMode,
    sourcePermittedSetId: lineage.sourcePermittedSetId,
    sourcePermittedSetVersion: lineage.sourcePermittedSetVersion,
    sourceBindingRevision: lineage.sourceBindingRevision,
  });
  return `sha256:${await sha256Hex(canonical)}`;
}
