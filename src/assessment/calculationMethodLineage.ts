// Which calculation methods are COMPATIBLE with which — declared per version, checked by a test.
//
// THE PROBLEM THIS SOLVES. `ASSESSMENT_CALC_VERSION` is a build constant that governed AnalysisTerms
// record as the method they were blessed for, and scheduling refuses terms blessed for a method this
// build does not implement (NH-AX-1014). That is correct, and it treats two very different events
// identically:
//
//   • the implementation CHANGED — the same data now yields a different answer;
//   • the LABEL changed — a rename, a scheme tidy-up, nothing about the arithmetic.
//
// Both currently force every governed definition to be re-proposed and every extract re-submitted. For a
// result-altering change that is exactly right. For a rename it is a migration imposed on every pilot
// for no reason, and nothing in the system could tell the two apart.
//
// HOW IT IS TOLD APART, and why this shape. A `behaviour` fingerprint per version, over a frozen fixture
// — a DECLARATION a human writes, which a test then checks against the implementation actually present.
// Exactly the shape `MAJOR_ROW_SEMANTICS` and `PREVIOUS_MAJOR_SUPPORT` already use in this codebase: a
// claim that is checkable, rather than a clock or a convention. Consequences:
//
//   • change the implementation without bumping the version → the fingerprint no longer matches and the
//     test fails. You must bump, or revert. There is no third option.
//   • bump the version and declare `labelOnlyOf` → the test requires the fingerprint to be IDENTICAL to
//     that predecessor's. A false "nothing changed" claim fails.
//   • bump the version without `labelOnlyOf` → the test requires the fingerprint to DIFFER. A bump that
//     changed nothing is either a mistake or a rename that should say so.
//
// ZERO IMPORTS, deliberately. This is the declaration; computing the fingerprint from the real
// calculation belongs in the test that checks the declaration, not in the thing being checked.
//
// WHAT IT DOES NOT DECIDE. Whether a RESULT-ALTERING change should let an existing admission be
// re-assessed without re-submission is not here, and is not derivable from the code — see
// docs/CALCULATION_IDENTITY_V1.md §6.

/** A declared calculation method and how it relates to its predecessor. */
export interface CalculationMethodEntry {
  /**
   * Fingerprint of the OBSERVABLE BEHAVIOUR of this method over the frozen fixture, as
   * `calculationMethodLineage.test.ts` computes it. Not a version string and not a file hash: two
   * implementations that compute the same answers have the same fingerprint however differently written.
   */
  readonly behaviour: string;
  /**
   * The version this one is a pure RENAME of, or null for a method that stands on its own.
   *
   * A non-null value is a claim that the arithmetic is unchanged, and the test enforces it by requiring
   * both fingerprints to be equal. It is what lets a rename avoid forcing every pilot to re-submit.
   */
  readonly labelOnlyOf: string | null;
}

/**
 * Every calculation method this build knows about, newest last.
 *
 * A version is added here in the same commit that changes `ASSESSMENT_CALC_VERSION`, never afterwards:
 * the test fails until it is, which is the point.
 */
export const CALCULATION_METHOD_LINEAGE: Readonly<Record<string, CalculationMethodEntry>> = Object.freeze({
  // The only method this codebase has ever had. Its fingerprint is pinned by the test from the real
  // `splitCohorts` + `observedSummary` over the frozen fixture.
  "assess-2026.1-thin": Object.freeze({
    behaviour: "nhcm_12b105f78dcae1c1",
    labelOnlyOf: null,
  }),
});

/** A registry of declared methods. The real one is `CALCULATION_METHOD_LINEAGE`. */
export type CalculationMethodLineage = Readonly<Record<string, CalculationMethodEntry>>;

/**
 * The chain of versions this one is a rename of, nearest first. Empty for an unknown version.
 *
 * `lineage` is a parameter so a rename CHAIN can be exercised against a registry built for the purpose.
 * The real registry has one entry and will for as long as there is one method, which would otherwise
 * leave the chain logic — the part that decides whether an old blessing still holds — unreached by any
 * test until the day it first mattered. Production never passes it.
 */
export function labelOnlyAncestry(
  version: string,
  lineage: CalculationMethodLineage = CALCULATION_METHOD_LINEAGE,
): readonly string[] {
  const chain: string[] = [];
  let cursor = lineage[version]?.labelOnlyOf ?? null;
  // Bounded by the registry size, so a cycle in the declarations terminates instead of hanging.
  while (cursor !== null && chain.length <= Object.keys(lineage).length) {
    chain.push(cursor);
    cursor = lineage[cursor]?.labelOnlyOf ?? null;
  }
  return Object.freeze(chain);
}

/**
 * May a definition blessed for `blessed` be measured by a build implementing `current`?
 *
 * TRUE only when they are the same method or provably the same arithmetic under two names. An UNKNOWN
 * version is never compatible — not even with itself-by-string-equality — because a build that cannot
 * say what a method DOES cannot claim its answers are unchanged. That is the fail-closed direction, and
 * it is why the registry must be updated in the same commit as the constant.
 */
export function calculationMethodsCompatible(
  blessed: string,
  current: string,
  lineage: CalculationMethodLineage = CALCULATION_METHOD_LINEAGE,
): boolean {
  if (!(blessed in lineage) || !(current in lineage)) return false;
  if (blessed === current) return true;
  // BOTH DIRECTIONS. A definition blessed before a rename must stay usable after it, and one blessed
  // after must stay usable if the build is rolled back — the arithmetic is the same either way.
  return (
    labelOnlyAncestry(current, lineage).includes(blessed) || labelOnlyAncestry(blessed, lineage).includes(current)
  );
}
