// The name of today's complete STAGE-A DATA INTERPRETATION, and nothing else.
//
// RUNTIME-INERT. Nothing in production imports this module, and a structural test asserts it. The
// revision is a SEMANTIC MARKER in this slice: no path branches on it, no identity function reads it, no
// record stores it. It exists so that the stage-A semantic surface has a name BEFORE anything is
// preserved, dispatched or bound — because a preserved interpreter nobody can detect drifting is not a
// preserved interpreter.
//
// ── THREE TERMS THAT MUST NOT BE CONFLATED ───────────────────────────────────────────────────────
//
// An earlier design of mine said "the preserved 2.x interpreter is a single pure cycle-key rule". That
// conflated the first term with the third and was wrong as a durable statement. Stated apart:
//
//   D1_SEMANTIC_RULE
//     ONE narrow semantic rule — the cycle-key derivation whose behaviour the first 3.x cutover changes.
//     It is a component, not an interpretation.
//
//   DATA_INTERPRETATION_IDENTITY        ← what this module names
//     The identity of the COMPLETE stage-A semantic behaviour: parsing, mapping, normalization,
//     validation, cycle-key derivation and dedupe, taken together as one named revision.
//
//   PRESERVED_INTERPRETER_IMPLEMENTATION
//     The code required to reproduce a given identity. Today one revision exists, so every component is
//     shared and NOTHING is duplicated. "Today" is load-bearing in that sentence: the moment a second
//     revision exists, whichever components differ must be preserved, and the conformance vectors in
//     this module's test are what force that to be noticed.
//
// ── WHAT THE IDENTITY PROMISES ───────────────────────────────────────────────────────────────────
//
//   A submission read under revision R yields the same accepted-cycle population and the same findings
//   from the same bytes, whichever build runs it.
//
// It promises NOTHING about any other stage. Those have their own revisions, they move for their own
// reasons, and a change in one must never re-key the others:
//
//   • ADMISSION DECISION semantics      — `ADMISSION_EVALUATOR_VERSION` (stage B). NOT part of this.
//   • ASSESSMENT / EXECUTION semantics  — `ASSESSMENT_CALC_VERSION` (stage C). NOT part of this.
//   • CANDIDATE / PROOF semantics       — their own schemes (stage D). NOT part of this.
//   • The BUILD version                 — `PILOT_DATA_CONTRACT_VERSION` is what this binary ships, not
//     what it means. Two builds implementing the same semantics must share one revision, or every patch
//     re-keys everything.
//
// ── WHY THE IDENTIFIER LOOKS LIKE THIS ───────────────────────────────────────────────────────────
//
// It is SEMANTIC and STABLE, and deliberately derived from none of: the build SHA, the package version,
// a timestamp, `PARSER_VERSION`, or `SAAS_ADAPTER_VERSION`. Any of those would move for reasons that are
// not semantic — a refactor, a release, a clock — and a semantic identity that moves for a non-semantic
// reason is worse than none, because it manufactures false distinctions.
//
//   nh-data-interpretation-2x-r1
//   │                       │  └─ revision WITHIN that major's semantics, so a drift correction can mint
//   │                       │     r2 without pretending the major changed
//   │                       └──── the MAJOR whose published row semantics this implements. A major IS a
//   │                             semantic commitment, which is why it belongs in a semantic identity
//   └──────────────────────────── stage A, named, so no one mistakes it for B, C or D
//
// NO 3.x REVISION IS DECLARED HERE. There is exactly one revision because there is exactly one stage-A
// behaviour. Declaring a future one now would assert semantics nobody has implemented.

/** The one stage-A revision that exists. A change in what it DOES is a new revision, never an edit. */
export const DATA_INTERPRETATION_REVISION = "nh-data-interpretation-2x-r1";

/**
 * The stage-A components a revision's identity covers.
 *
 * Declared as DATA so the conformance test can assert that every one of them has at least one pinned
 * vector. A surface listed here with nothing pinning it is a gap the test reports rather than a claim
 * the comment makes.
 */
export const DATA_INTERPRETATION_SURFACE: readonly string[] = Object.freeze([
  "parsing",
  "mapping",
  "normalization",
  "validation",
  "cycle_key_derivation",
  "dedupe",
]);

/**
 * Stage-A surfaces this identity explicitly does NOT cover. Listed, not merely omitted, so a future
 * reader cannot assume the identity is broader than it is.
 */
export const DATA_INTERPRETATION_EXCLUSIONS: readonly string[] = Object.freeze([
  "admission_evaluation",
  "assessment_calculation",
  "candidate_semantics",
  "proof_semantics",
  "build_version",
]);

/**
 * A registry entry, as a TYPE only — no entries are declared in this slice.
 *
 * The shape exists because the eventual design needs an APPEND-ONLY registry that is separate from the
 * mutable list of majors accepted for NEW submissions. Keeping them separate is what lets support for a
 * major be withdrawn at intake WITHOUT destroying the interpretation identity under which already
 * admitted work was read. Nothing enforces that yet; this is the shape it will take.
 */
export interface DataInterpretationRegistryEntry {
  /** The semantic revision this entry names. Never reused for different behaviour. */
  readonly revision: string;
  /** The major whose published row semantics it implements. */
  readonly major: number;
  /** Why this revision exists. A drift correction and a major cutover are different reasons. */
  readonly rationale: string;
}
