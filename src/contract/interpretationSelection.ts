// Which DATA INTERPRETATION reads a submission — and nothing else.
//
// RUNTIME-INERT BY DESIGN. Nothing in production imports this module, and a structural test asserts
// that. It exists so the selection semantics of dual-major support are written down, argued and tested
// BEFORE any dispatch is wired, because the wiring is the part that cannot be undone quietly: it reaches
// the submission identity, the admission decision and the execution binding. Specifying the decision
// first is the cheap half; this is that half.
//
// ── THE STAGE BOUNDARY, WHICH THIS MODULE DOES NOT CROSS ─────────────────────────────────────────
//
// There are at least three independent semantic stages, and collapsing them into one "interpretation
// identity" would be wrong:
//
//   A · DATA INTERPRETATION — parser, mapping specification, normalization, validation rules, cycle
//       derivation (the adapter), and the dedupe rules that decide the accepted cycles.
//   B · ADMISSION DECISION semantics — `ADMISSION_EVALUATOR_VERSION`, the fitness bar's evaluator.
//   C · ASSESSMENT / EXECUTION semantics — `ASSESSMENT_CALC_VERSION`, cohorts and the observed summary.
//
// THIS MODULE IS ABOUT STAGE A ONLY. B and C have their own revisions already, they move for their own
// reasons, and a change in one must not re-key the others. An earlier analysis of mine proposed one
// global composite revision spanning all three; that was wrong and is not built here.
//
// WHETHER STAGE A IS ITSELF ONE COMPOSITE REVISION OR SEVERAL SEPARATELY BOUND ONES IS DEFERRED. This
// module deliberately cannot answer it: it returns an OPAQUE handle for a preserved interpretation and
// says nothing about how that handle is composed. A slice that needs the composition will have to decide
// it explicitly rather than inherit a shape chosen here by accident.
//
// ── WHY A NEW CONCEPT RATHER THAN EXTENDING `MAJOR_ROW_SEMANTICS` ────────────────────────────────
//
// `MAJOR_ROW_SEMANTICS` means exactly one thing: a previous major's ROW SEMANTICS ARE IDENTICAL to the
// implemented major's, so there is nothing to interpret differently. Its whole value is that the claim is
// truthful and machine-checked. Overloading it to also mean "supported through a DIFFERENT preserved
// interpreter" would destroy that property — the one entry would no longer tell a reader whether two
// interpretations exist.
//
// So support becomes a MODE per previous major, and `IDENTICAL` is one of the modes rather than the only
// possibility. `MAJOR_ROW_SEMANTICS` IS NOT MODIFIED, READ OR REPLACED BY THIS MODULE. A test shows that
// today's declaration maps onto `IDENTICAL`, which is evidence that the model subsumes the existing
// mechanism — not a migration, and not a derived view. Unification is DEFERRED.
import { parseContractVersion } from "./pilotDataContract";

/** Version of this selection rule. A change in what it decides is a new id, never a silent re-grade. */
export const INTERPRETATION_SELECTION_RULE = "nh-interpretation-selection-v1";

/**
 * How one PREVIOUS major is supported. There is no `UNSUPPORTED` member on purpose: a major is
 * unsupported by being ABSENT from the declaration, so the fail-closed default needs no one to write it
 * down. A mode nobody declared cannot be mistyped into existence.
 */
export type MajorSupportMode = "IDENTICAL" | "PRESERVED_INTERPRETER";

export interface MajorSupportDeclaration {
  readonly mode: MajorSupportMode;
  /**
   * WHICH preserved interpretation reads this major. Required iff mode is `PRESERVED_INTERPRETER`, and
   * refused when absent or blank — a preserved mode that cannot name its interpreter would otherwise fall
   * through to the current one, which is the single most dangerous silent behaviour in this whole design.
   *
   * DELIBERATELY AN OPAQUE HANDLE. This module does not define, parse or interpret its structure, because
   * the composition of a stage-A semantic revision is DEFERRED. It is a name the declaration supplies and
   * a future dispatcher resolves.
   */
  readonly interpreter?: string;
}

/**
 * Previous major → how it is supported. A major ABSENT from this map is UNSUPPORTED.
 *
 * Keyed by the PREVIOUS major, not by the implemented one, because the question this answers is always
 * "may THIS declared major be read, and by what?".
 */
export type MajorSupportDeclarations = Readonly<Record<number, MajorSupportDeclaration>>;

/** What was selected. Three outcomes, each meaning something different about which code must run. */
export type InterpretationSelectionKind =
  /** Declared major equals implemented major. The current interpretation applies, as it always has. */
  | "current_major"
  /** A previous major explicitly declared row-semantics-identical. The CURRENT interpretation applies. */
  | "previous_major_identical"
  /** A previous major supported through its own preserved interpretation. The CURRENT one must NOT run. */
  | "previous_major_preserved";

export interface InterpretationSelection {
  readonly rule: typeof INTERPRETATION_SELECTION_RULE;
  readonly kind: InterpretationSelectionKind;
  /** Echoed for audit. Never used to infer anything. */
  readonly declaredMajor: number;
  /**
   * The major whose STAGE-A interpretation must read this submission.
   *
   * THE DISTINCTION THAT MATTERS: for `previous_major_identical` this is the IMPLEMENTED major, because
   * identical semantics mean the current code is the correct reader. For `previous_major_preserved` it is
   * the DECLARED major, because the current code is the wrong reader. Collapsing the two would turn a
   * preserved interpretation into a silent use of current semantics.
   */
  readonly interpretationMajor: number;
  /** The opaque preserved-interpreter handle for `previous_major_preserved`; null for the other kinds. */
  readonly preservedInterpreter: string | null;
}

/** Every way selection can refuse. Named, so a caller never invents wording or a fallback. */
export type InterpretationRefusalReason =
  | "declared_version_malformed"
  | "implemented_version_malformed"
  | "declared_major_newer_than_implemented"
  | "declared_minor_or_patch_newer_than_implemented"
  | "previous_major_not_declared"
  | "preserved_interpreter_not_named"
  | "support_mode_unrecognised";

export interface InterpretationRefusal {
  readonly rule: typeof INTERPRETATION_SELECTION_RULE;
  readonly reason: InterpretationRefusalReason;
  /** A sentence naming the cause. Never echoes customer data — only version strings and majors. */
  readonly detail: string;
}

export type InterpretationDecision =
  | { readonly selected: true; readonly selection: InterpretationSelection }
  | { readonly selected: false; readonly refusal: InterpretationRefusal };

function refuse(reason: InterpretationRefusalReason, detail: string): InterpretationDecision {
  return Object.freeze({
    selected: false as const,
    refusal: Object.freeze({ rule: INTERPRETATION_SELECTION_RULE, reason, detail }),
  });
}

function select(
  kind: InterpretationSelectionKind,
  declaredMajor: number,
  interpretationMajor: number,
  preservedInterpreter: string | null,
): InterpretationDecision {
  return Object.freeze({
    selected: true as const,
    selection: Object.freeze({
      rule: INTERPRETATION_SELECTION_RULE,
      kind,
      declaredMajor,
      interpretationMajor,
      preservedInterpreter,
    }),
  });
}

/**
 * Select the stage-A data interpretation for a declared contract version, or refuse.
 *
 * PURE AND TOTAL: no clock, no randomness, no I/O, no throw. Every rejection is a named refusal, because
 * this decision is taken at intake where an unexpected exception would turn a version question into an
 * availability failure.
 *
 * IT DOES NOT CALL `isSupportedContractVersion`, and that is deliberate rather than duplication for its
 * own sake. That function resolves previous majors through `MAJOR_ROW_SEMANTICS`, which can only express
 * `IDENTICAL`. Calling it here would bake the one mode this module exists to generalise into the
 * generalisation itself. The WITHIN-MAJOR comparison below intentionally mirrors it exactly — same major,
 * not newer minor, not newer patch — so the two cannot disagree about a same-major submission.
 *
 * IT NEVER INFERS SUPPORT FROM VERSION PROXIMITY. Major 2 being one below major 3 means nothing. Support
 * comes from an explicit declaration or it does not exist.
 */
export function selectDataInterpretation(input: {
  readonly declaredVersion: string;
  readonly implementedVersion: string;
  readonly declarations: MajorSupportDeclarations;
}): InterpretationDecision {
  const declared = parseContractVersion(input.declaredVersion);
  if (declared === null) {
    return refuse("declared_version_malformed", `declared version '${input.declaredVersion}' is not a semver triple`);
  }
  const implemented = parseContractVersion(input.implementedVersion);
  if (implemented === null) {
    return refuse(
      "implemented_version_malformed",
      `implemented version '${input.implementedVersion}' is not a semver triple`,
    );
  }

  // A build never guesses at a contract it does not implement.
  if (declared.major > implemented.major) {
    return refuse(
      "declared_major_newer_than_implemented",
      `declared major ${declared.major} is newer than implemented major ${implemented.major}`,
    );
  }

  if (declared.major === implemented.major) {
    const newerMinor = declared.minor > implemented.minor;
    const newerPatch = declared.minor === implemented.minor && declared.patch > implemented.patch;
    if (newerMinor || newerPatch) {
      return refuse(
        "declared_minor_or_patch_newer_than_implemented",
        `declared ${input.declaredVersion} is newer than implemented ${input.implementedVersion}`,
      );
    }
    // An older supported minor or patch DOES NOT SELECT A SEPARATE PRESERVED INTERPRETER. It is read
    // under the current major's interpretation, because this build has exactly one interpretation per
    // major and the declared minor is never consulted by the parser, the mapping, the adapter or the
    // validator. So there is nothing to select between inside a major.
    //
    // NOT THE SAME AS "identical semantics", which would be too strong and is not what the policy
    // proves. A MINOR may add a header synonym or relax a rule, so a 2.0-declared file can be REJECTED
    // by a 2.0 build and ACCEPTED by a 2.1 one. The minor promise is one-directional — "a dataset valid
    // under X.Y is still valid under X.(Y+1)" — and guarantees that valid stays valid, never that the
    // outcome is unchanged. A minor that genuinely needed its own preserved interpreter would not be a
    // minor.
    return select("current_major", declared.major, implemented.major, null);
  }

  // ── declared.major < implemented.major ─────────────────────────────────────────────────────────
  // FAIL CLOSED: absent means unsupported, and no one has to remember to write that down.
  const declaration = Object.prototype.hasOwnProperty.call(input.declarations, declared.major)
    ? input.declarations[declared.major]
    : undefined;
  if (declaration === undefined) {
    return refuse(
      "previous_major_not_declared",
      `major ${declared.major} has no support declaration under implemented major ${implemented.major}`,
    );
  }

  if (declaration.mode === "IDENTICAL") {
    // The current interpretation is the CORRECT reader, because the semantics were declared identical.
    return select("previous_major_identical", declared.major, implemented.major, null);
  }

  if (declaration.mode === "PRESERVED_INTERPRETER") {
    const interpreter = declaration.interpreter;
    if (typeof interpreter !== "string" || interpreter.trim() === "") {
      // NO FALLBACK. A preserved mode that cannot name its interpreter must not quietly become the
      // current one — that would read a previous major's data under semantics it was never admitted
      // under, which is the exact failure the mode exists to prevent.
      return refuse(
        "preserved_interpreter_not_named",
        `major ${declared.major} declares PRESERVED_INTERPRETER but names no interpreter`,
      );
    }
    return select("previous_major_preserved", declared.major, declared.major, interpreter);
  }

  // Unreachable for a well-typed declaration, and checked anyway: declarations can arrive from data the
  // type system never saw, and an unrecognised mode must refuse rather than fall through to anything.
  return refuse(
    "support_mode_unrecognised",
    `major ${declared.major} declares an unrecognised support mode`,
  );
}
