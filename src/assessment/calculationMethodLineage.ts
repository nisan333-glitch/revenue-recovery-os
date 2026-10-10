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
// A FINGERPRINT IS NOT A PROOF, and the first version of this module came too close to treating it as
// one. A digest over a frozen fixture establishes that two methods agree ON THAT FIXTURE. It cannot
// establish that they agree on every input: the fixture is finite, the input space is not, and no
// enumeration closes that gap. A reviewer who sees matching fingerprints has seen NECESSARY evidence
// and nothing more.
//
// So equivalence is carried by an EXPLICIT REVIEWED DECLARATION, and the fingerprint is one of its
// preconditions rather than its substance. A declaration must name:
//
//   • WHO reviewed it and WHEN — a person owns the claim; no constant and no test can own it;
//   • IMPLEMENTATION EVIDENCE — what in the code was compared, and why the change cannot alter an
//     answer. "The fingerprints matched" is not evidence of this kind and is explicitly insufficient;
//   • TARGETED TESTS, by path — and the checking test asserts those files EXIST, so a declaration
//     cannot cite tests nobody wrote;
//   • a RATIONALE, in words, for why the arithmetic is untouched.
//
// A declaration missing any of those, or whose fingerprints do not match, grants NO compatibility. That
// is the fail-closed direction, and it is enforced by `reviewedEquivalenceIsWellFormed` rather than
// trusted to review discipline.
//
// WHAT THE FINGERPRINT STILL DOES, which is worth keeping: it catches an implementation that moved
// without the version moving. Change `splitCohorts`, `observedSummary` or `classifyStall` so that any
// answer differs, and the declared fingerprint stops matching — you must bump the version or revert.
// That is a real guarantee and it is the one thing a finite fixture CAN give.
//
// ZERO IMPORTS, deliberately. This is the declaration; computing the fingerprint from the real
// calculation belongs in the test that checks the declaration, not in the thing being checked.
//
// UNKNOWN COMPATIBILITY IS BLOCKED. A method this registry does not describe is never compatible with
// anything, not even with itself by string equality: a build that cannot say what a method DOES cannot
// claim its answers are unchanged.

/**
 * A reviewed claim that two calculation methods compute the same answers.
 *
 * A PERSON owns this. The fields are what make the claim auditable later: who stood behind it, what they
 * compared, which tests establish it, and why the change cannot alter a result. None of them is
 * derivable from the code, which is the point — if equivalence could be computed, it would not need
 * reviewing.
 */
export interface ReviewedEquivalence {
  /** The method this one is declared equivalent to. */
  readonly of: string;
  /** The reviewing identity. Not a role: a role cannot be asked what it was thinking. */
  readonly reviewedBy: string;
  /** ISO date of the review. */
  readonly reviewedAt: string;
  /**
   * What in the IMPLEMENTATION was compared, and why the change cannot alter an answer.
   *
   * "The fingerprints matched" does not belong here and is explicitly insufficient: the fingerprint is a
   * precondition checked elsewhere. This is the reasoning a reader needs in order to disagree.
   */
  readonly implementationEvidence: readonly string[];
  /**
   * Repository paths of the tests that establish the equivalence. Their EXISTENCE is checked, so a
   * declaration cannot cite tests nobody wrote.
   */
  readonly tests: readonly string[];
  readonly rationale: string;
}

/** Whether a method stands alone, or carries a reviewed equivalence to another. */
export type CalculationCompatibility =
  /** No claim. Compatible with itself and nothing else. */
  | { readonly kind: "STANDALONE" }
  | { readonly kind: "REVIEWED_EQUIVALENT"; readonly equivalence: ReviewedEquivalence };

/** A declared calculation method and what is claimed about it. */
export interface CalculationMethodEntry {
  /**
   * Fingerprint of the OBSERVABLE BEHAVIOUR of this method over the frozen fixture, as
   * `calculationMethodLineage.test.ts` computes it.
   *
   * Its job is to catch an implementation that moved without the version moving. It is a NECESSARY
   * precondition of an equivalence claim and never a sufficient one — see this file's header.
   */
  readonly behaviour: string;
  readonly compatibility: CalculationCompatibility;
}

/**
 * Every calculation method this build knows about, newest last.
 *
 * A version is added here in the same commit that changes `ASSESSMENT_CALC_VERSION`, never afterwards:
 * the test fails until it is, which is the point.
 */
export const CALCULATION_METHOD_LINEAGE: Readonly<Record<string, CalculationMethodEntry>> = Object.freeze({
  // The only method this codebase has ever had, so it stands alone: there is nothing for it to be
  // equivalent TO. Its fingerprint is pinned by the test from the real `splitCohorts` +
  // `observedSummary` over the frozen fixture.
  "assess-2026.1-thin": Object.freeze({
    behaviour: "nhcm_12b105f78dcae1c1",
    compatibility: Object.freeze({ kind: "STANDALONE" as const }),
  }),
});

/** A registry of declared methods. The real one is `CALCULATION_METHOD_LINEAGE`. */
export type CalculationMethodLineage = Readonly<Record<string, CalculationMethodEntry>>;

/**
 * Is this entry's equivalence claim WELL FORMED — complete enough to be allowed to grant compatibility?
 *
 * Checked rather than trusted to review discipline, and every clause fails closed:
 *
 *   • the named predecessor must exist;
 *   • the fingerprints must match — necessary, and the only part a machine can check;
 *   • a reviewer, a date and a rationale must be present and non-blank;
 *   • implementation evidence must be given, and at least one test cited.
 *
 * A malformed declaration grants nothing. It does not warn and it does not degrade: an incomplete claim
 * is indistinguishable from an unreviewed one, so it is treated as one.
 */
export function reviewedEquivalenceIsWellFormed(
  entry: CalculationMethodEntry | undefined,
  lineage: CalculationMethodLineage = CALCULATION_METHOD_LINEAGE,
): boolean {
  if (entry === undefined || entry.compatibility.kind !== "REVIEWED_EQUIVALENT") return false;
  const e = entry.compatibility.equivalence;
  const predecessor = lineage[e.of];
  if (predecessor === undefined) return false;
  if (predecessor.behaviour !== entry.behaviour) return false;
  if (e.reviewedBy.trim() === "" || e.reviewedAt.trim() === "" || e.rationale.trim() === "") return false;
  if (e.implementationEvidence.length === 0 || e.tests.length === 0) return false;
  if (e.implementationEvidence.some((x) => x.trim() === "") || e.tests.some((x) => x.trim() === "")) return false;
  return true;
}

/**
 * The chain of methods this one is declared equivalent to, nearest first. Empty for an unknown version,
 * and TRUNCATED at the first malformed declaration rather than stepping over it.
 *
 * `lineage` is a parameter so a chain can be exercised against a registry built for the purpose. The real
 * registry has one entry and will for as long as there is one method, which would otherwise leave this
 * logic — the part that decides whether an old blessing still holds — unreached by any test until the
 * day it first mattered. Production never passes it.
 */
export function reviewedEquivalenceChain(
  version: string,
  lineage: CalculationMethodLineage = CALCULATION_METHOD_LINEAGE,
): readonly string[] {
  const chain: string[] = [];
  let cursor: string = version;
  // Bounded by the registry size, so a cycle in the declarations terminates instead of hanging.
  while (chain.length <= Object.keys(lineage).length) {
    const entry: CalculationMethodEntry | undefined = lineage[cursor];
    if (!reviewedEquivalenceIsWellFormed(entry, lineage)) break;
    const compatibility = entry!.compatibility;
    if (compatibility.kind !== "REVIEWED_EQUIVALENT") break;
    const next: string = compatibility.equivalence.of;
    chain.push(next);
    cursor = next;
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
  // BOTH DIRECTIONS. A definition blessed before a reviewed equivalence must stay usable after it, and
  // one blessed after must stay usable if the build is rolled back — the claim is that the arithmetic is
  // the same, which is symmetric.
  return (
    reviewedEquivalenceChain(current, lineage).includes(blessed) ||
    reviewedEquivalenceChain(blessed, lineage).includes(current)
  );
}
