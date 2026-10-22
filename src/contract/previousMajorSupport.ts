// PREVIOUS-MAJOR SUPPORT — the single explicit registry of which older majors this product accepts,
// HOW FAR, and by what means.
//
// ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────────────────────
//
// `isSupportedContractVersion` returned as soon as it saw a declared major BELOW the implemented one,
// before any minor or patch comparison. So with major 1 declared row-semantics-identical, an implemented
// 2.0.0 build accepted `1.0.0`, `1.1.0` — and also `1.999.999`, a version no build ever implemented.
// Inside the implemented major, "newer than implemented" fails closed; for a previous major, "newer than
// anything that ever existed" passed. `selectDataInterpretation` had the same hole and a worse
// consequence: it would hand `2.999.999` to a preserved 2.x interpreter that implements no such thing.
//
// That is also a divergence from a PUBLISHED promise, not merely an internal gap — the customer contract
// says a newer version than the build implements is REFUSED (`NH-DC-5001`), "never interpreted
// optimistically" (docs/CUSTOMER_PILOT_DATA_CONTRACT_V1.md).
//
// ── WHY THIS IS A SEPARATE FACT FROM `MAJOR_ROW_SEMANTICS` ───────────────────────────────────────
//
// `MAJOR_ROW_SEMANTICS` means exactly one thing and keeps it: *this previous major's row-level semantics
// are IDENTICAL to the implemented major's* — no field added, removed or renamed, no field's meaning
// changed, no validation rule tightened. Its whole value is that the claim is narrow and
// machine-checkable, and `docs/DUAL_MAJOR_SEMANTIC_CHANGE_V1.md` warns that any finer declaration
// weakens that property and "must earn its way past it".
//
// A CEILING IS A DIFFERENT FACT: *the highest version within that major this product ever implemented
// and will read.* Folding it into `MAJOR_ROW_SEMANTICS` would overload one declaration with two
// unrelated claims, so it lives here. `MAJOR_ROW_SEMANTICS` IS NOT READ, WRITTEN OR REPLACED BY THIS
// MODULE; a test asserts the two agree about WHICH majors, and nothing more.
//
// ── THE CEILING IS DECLARED, NEVER DERIVED ───────────────────────────────────────────────────────
//
// Not from git history, not from major proximity, not from `MAJOR_ROW_SEMANTICS`. The published versions
// were `1.0.0`, `1.1.0`, then `2.0.0` — and a `2.1.0` that was an unauthorized experiment and was
// reverted before release. A ceiling computed from history would have swallowed that `2.1.0`, which is
// precisely why this is a written human statement and not a calculation.
//
// ── WHAT IT IS NOT ───────────────────────────────────────────────────────────────────────────────
//
// NOT AN EXACT-VERSION ALLOWLIST. The ceiling means "up to and including", because that is the approved
// model and because the contract's own minor promise — a dataset valid under X.Y stays valid under
// X.(Y+1) — is a range promise. Listing exact versions would be a stronger policy than anything the
// constitution states, and inventing one here would be the same overreach as leaving the hole open.
//
// NOT DISPATCH. Naming a preserved interpreter does not build, select or run one. No entry uses
// `PRESERVED_INTERPRETER` today, and the mode exists so the ceiling rule is already written for the
// first one that does.
//
// ── IMPORTS NOTHING, DELIBERATELY ────────────────────────────────────────────────────────────────
//
// `pilotDataContract.ts` has no imports at all — it is the root of this module graph — and it must
// consume this registry. So this module must not import back, or the contract root acquires its first
// cycle. It therefore takes the DECLARED version already parsed, which both consumers have in hand
// anyway, and parses only its own ceiling strings. `parseTriple` below is a format check, not a policy:
// the single ceiling FACT still lives in exactly one place, and a test pins that it agrees with
// `parseContractVersion` on a battery of inputs, malformed ones included.

/** Version of this registry's rule. A change in what it decides is a new id, never a silent re-grade. */
export const PREVIOUS_MAJOR_SUPPORT_RULE = "nh-previous-major-support-v1";

/**
 * How one previous major is read.
 *
 * `IDENTICAL` — its row semantics are identical, so the CURRENT interpretation is the correct reader.
 * `PRESERVED_INTERPRETER` — it needs its own reader, which must be named.
 *
 * There is no `UNSUPPORTED` member on purpose: a major is unsupported by being ABSENT, so the
 * fail-closed default needs nobody to write it down and cannot be mistyped into existence.
 */
export type PreviousMajorSupportMode = "IDENTICAL" | "PRESERVED_INTERPRETER";

export interface PreviousMajorSupportEntry {
  readonly mode: PreviousMajorSupportMode;
  /**
   * The highest version within this previous major that is supported, INCLUSIVE.
   *
   * REQUIRED, never optional. An entry that could omit its ceiling would re-open the defect the moment
   * someone forgot one, so the type makes a ceiling-less entry unwriteable. That is the difference
   * between a rule and a reminder.
   */
  readonly maxSupportedVersion: string;
  /**
   * WHICH preserved interpretation reads this major. Required iff mode is `PRESERVED_INTERPRETER`.
   *
   * An opaque handle: this module does not define, parse or resolve its structure.
   */
  readonly interpreter?: string;
}

/**
 * implemented major → previous major → how far and by what means.
 *
 * Keyed by the IMPLEMENTED major first, mirroring `MAJOR_ROW_SEMANTICS`, because the question is always
 * "what may THIS build read?". A major with no entry supports no previous major at all.
 *
 * TODAY: an implemented major 2 reads major 1 up to 1.1.0 under the current interpretation. `1.1.0` is
 * the last 1.x this product published — stated, not computed.
 */
export const PREVIOUS_MAJOR_SUPPORT: Readonly<
  Record<number, Readonly<Record<number, PreviousMajorSupportEntry>>>
> = Object.freeze({
  1: Object.freeze({}),
  2: Object.freeze({
    1: Object.freeze({ mode: "IDENTICAL" as const, maxSupportedVersion: "1.1.0" }),
  }),
});

/** The entry for one previous major under one implemented major, or null when unsupported. */
export function previousMajorSupport(
  implementedMajor: number,
  declaredMajor: number,
): PreviousMajorSupportEntry | null {
  const forImplemented = PREVIOUS_MAJOR_SUPPORT[implementedMajor];
  if (forImplemented === undefined) return null;
  // `hasOwnProperty` rather than a truthiness check: a declared major of, say, `0` must still resolve
  // through the registry rather than through JavaScript's opinion about falsy keys.
  if (!Object.prototype.hasOwnProperty.call(forImplemented, declaredMajor)) return null;
  return forImplemented[declaredMajor] ?? null;
}

/** A parsed semver triple, structurally — so this module needs no import to accept one. */
export interface VersionTriple {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * Strict triple parse for this module's OWN ceiling strings.
 *
 * DELIBERATELY RULE-IDENTICAL TO `parseContractVersion`, down to the leading `trim()`, and a test pins
 * that the two agree on a battery of inputs — malformed ones included — rather than trusting that they
 * do. That guard earned its place immediately: the first version of this function omitted the trim, so
 * `" 1.1.0"` parsed there and not here, and the agreement test caught it on its first run. The
 * divergence could not have affected a real ceiling, which is a literal in the registry below, but a
 * duplicated rule that is merely *believed* to match is how drift starts.
 */
export function parseTriple(value: string): VersionTriple | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!m) return null;
  return Object.freeze({ major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) });
}

/**
 * THE ONE CEILING COMPARISON. Internal: every ceiling question in this module routes through it, so a
 * second interpretation of "within the ceiling" cannot come into existence.
 *
 * Fails closed on everything. A malformed ceiling refuses rather than admits — a typo in the registry
 * must not silently become "no limit", which is the defect this module exists to remove — and a ceiling
 * recorded under a different major refuses too, because comparing it would be meaningless.
 */
function ceilingAdmits(entry: PreviousMajorSupportEntry, declared: VersionTriple): boolean {
  const ceiling = parseTriple(entry.maxSupportedVersion ?? "");
  if (ceiling === null) return false;
  if (ceiling.major !== declared.major) return false;
  if (declared.minor > ceiling.minor) return false;
  if (declared.minor === ceiling.minor && declared.patch > ceiling.patch) return false;
  return true;
}

/**
 * THE COMPLETE PREVIOUS-MAJOR SUPPORT DECISION. One function, one answer.
 *
 * It owns the WHOLE gate — entry presence, the ceiling, the mode and the mode's own requirement — so a
 * caller cannot obtain "supported" while skipping a part of it. That is not stylistic: the predicate
 * this replaced was a conjunction assembled at the call site, and assembling it slightly wrong is
 * exactly how the defect below got in.
 *
 * ── THE DEFECT THIS FIXES ────────────────────────────────────────────────────────────────────────
 *
 * The live predicate required `MAJOR_ROW_SEMANTICS` membership for EVERY mode. That is right for
 * `IDENTICAL` and wrong for `PRESERVED_INTERPRETER`, whose whole premise is that the row semantics are
 * NOT identical. A future real entry
 * `{3: {2: {mode: "PRESERVED_INTERPRETER", interpreter: "nh-interp-2x", …}}}` would therefore have been
 * refused by the live gate while the selector accepted it — the two consumers disagreeing, and the mode
 * silently unusable at the exact moment the dual-major work needs it.
 *
 * Worse, the obvious-looking repair would have been to add major 2 to `MAJOR_ROW_SEMANTICS[3]` — a FALSE
 * IDENTITY DECLARATION, asserting semantics are identical precisely when they are not. The defect
 * invited the wrong fix, which is why it is corrected here rather than deferred.
 *
 * ── WHY THE EVIDENCE ARRIVES AS A BOOLEAN ────────────────────────────────────────────────────────
 *
 * `rowSemanticsIdentical` is the caller's reading of `MAJOR_ROW_SEMANTICS` — it is NOT re-derived here,
 * because this module imports nothing (`pilotDataContract.ts` has no imports of its own and must consume
 * this registry, so importing back would give the contract root a cycle). Passing it in also makes the
 * mode rule testable against HYPOTHETICAL entries, which is the only way a future major's behaviour can
 * be proven before any constant is bumped.
 *
 * NOT DISPATCH. `PRESERVED_INTERPRETER` requires that an interpreter be NAMED; nothing here builds,
 * selects or runs one.
 */
export function previousMajorSupportDecision(
  entry: PreviousMajorSupportEntry | null,
  declared: VersionTriple,
  rowSemanticsIdentical: boolean,
): boolean {
  // Absent means unsupported — the fail-closed default nobody has to write down.
  if (entry === null) return false;
  // THE CEILING IS ENFORCED HERE, for every mode, before any mode is considered. No mode can opt out of
  // it and no caller can forget it.
  if (!ceilingAdmits(entry, declared)) return false;
  switch (entry.mode) {
    case "IDENTICAL":
      // Row semantics declared identical ⇒ the current interpretation is the correct reader, and that
      // claim must be backed by the evidence declaration. Without it the entry asserts an identity
      // nobody checked.
      return rowSemanticsIdentical === true;
    case "PRESERVED_INTERPRETER":
      // Deliberately does NOT consult `rowSemanticsIdentical`: this mode exists precisely because the
      // semantics differ. What it requires instead is that the preserved reader be NAMED — an unnamed
      // one would fall through to the current interpretation, which is the single most dangerous
      // silent behaviour in this design.
      return typeof entry.interpreter === "string" && entry.interpreter.trim() !== "";
    default:
      // NO FALLTHROUGH. Unreachable for a well-typed entry, and checked anyway: entries can arrive from
      // data the type system never saw, and an unrecognised mode must refuse rather than inherit the
      // ceiling result as an acceptance.
      return false;
  }
}

/**
 * Is an already-parsed `declared` version within the ceiling its previous major declares?
 *
 * A NARROW QUERY, NOT A SUPPORT GATE. It answers the ceiling question alone and says nothing about the
 * mode or its requirements, so it must never be used as an alternative admission check —
 * `previousMajorSupportDecision` is the only complete one, and a structural test asserts the live
 * predicate uses that and not this. Kept exported because the ceiling on its own is worth asserting
 * directly in tests and worth reading in an audit.
 */
export function withinPreviousMajorCeiling(implementedMajor: number, declared: VersionTriple): boolean {
  const entry = previousMajorSupport(implementedMajor, declared.major);
  if (entry === null) return false;
  return ceilingAdmits(entry, declared);
}

/**
 * The registry's real facts, projected into the shape `selectDataInterpretation` consumes.
 *
 * THIS IS WHY THE `1.1.0` LITERAL EXISTS EXACTLY ONCE. The selector is parameterised on its
 * declarations and must not import this module — it has to stay exercisable at a hypothetical
 * implemented major, which a registry of real majors cannot serve. So the real facts travel to it as
 * DATA, through this projection, and the only place a real ceiling is written down is the registry
 * above. A caller that wants the live rule passes `projectSupportDeclarations(implementedMajor)`; a test
 * that wants a hypothetical passes its own object. The selector cannot tell, and does not need to.
 *
 * The return type is declared structurally rather than imported, so this module keeps zero imports and
 * the dependency stays one-directional. A test asserts the projection is assignable to the selector's
 * own `MajorSupportDeclarations`, which is what makes the structural type safe rather than hopeful.
 */
export function projectSupportDeclarations(
  implementedMajor: number,
): Readonly<Record<number, PreviousMajorSupportEntry>> {
  const forImplemented = PREVIOUS_MAJOR_SUPPORT[implementedMajor];
  return forImplemented ?? Object.freeze({});
}

/** Every previous major declared under one implemented major, ascending. Audit/consistency use. */
export function declaredPreviousMajors(implementedMajor: number): readonly number[] {
  const forImplemented = PREVIOUS_MAJOR_SUPPORT[implementedMajor];
  if (forImplemented === undefined) return Object.freeze([]);
  return Object.freeze(
    Object.keys(forImplemented)
      .map(Number)
      .sort((a, b) => a - b),
  );
}
