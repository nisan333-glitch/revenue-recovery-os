// MAY THIS CASE REACH PROVEN AT ALL? The obligation-identity half of that question, as a pure predicate.
//
// THE RULE IT ENFORCES, approved as a mandatory product rule and not a recommendation:
//
//   > PROVEN must never be assigned at account level when the identity of the specific underlying
//   > obligation has not been established with sufficient evidence.
//
// and, from the same decision, the four facts a proof must rest on: the OBLIGATION IDENTITY, the
// EXPECTED billing, the ACTUAL billing and the FINANCIAL DISCREPANCY between them — each supported by
// traceable evidence. An ambiguous case stays unproven and says why.
//
// WHY A SEPARATE MODULE FROM `caseIdentityGrain`. That module answers what a case's identity COVERS, for
// a reader. This one answers whether a MONETARY PROOF may be minted, for a gate. Collapsing them would
// make a disclosure sentence load-bearing for money, and a renderer's wording change would then move a
// financial control — so they stay apart, and this module takes the other's output as an input.
//
// WHAT IT DOES **NOT** DO, stated because the distinction is the whole point. `leakInstanceIdentityStatus`
// asks whether the DATA CONTRACT declares a stable, cross-system obligation identifier. It does not
// (`OBLIGATION_IDENTITY_FIELDS = []`) and nothing here changes that. This module asks a different and
// strictly weaker question: does THIS CLAIM cover exactly one reconciliation unit, as the server itself
// determined when it read the customer's two extracts? A single-unit claim has a determinate obligation
// WITHIN THAT READING, which is traceable evidence for the identity of what is being claimed, and is NOT
// a cross-system identity and never becomes one. The two must stay distinguishable for the same reason
// `leakInstanceIdentityStatus` and `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` are named apart: collapsing
// them would let closing the easier one look like closing both.
//
// FAIL CLOSED EVERYWHERE, AND "NOT CHECKED" IS NOT "NONE". Absent coverage refuses. An aggregate refuses.
// A recorded absorption refuses. And an UNCHECKED absorption refuses too — reading silence as "no
// absorption" would let a surface that never ran the query mint a proof, which is the `$0.00`-for-an-
// absent-proof mistake with money on the other side of it.
//
// PURE: no clock, no I/O, no randomness, no imports that can act.
import type { AbsorbedObservations } from "./caseIdentityGrain";

/**
 * What the server determined this claim covers. STATED BY THE SERVER, NEVER BY A REQUEST — it is derived
 * from the reconciliation the server performed over the customer's own extracts, and a caller has no
 * field by which to assert it. That asymmetry is structural, exactly as the readiness ladder refuses a
 * `provenanceEstablished` parameter.
 */
export type ObligationCoverage =
  | {
      readonly kind: "SINGLE_OBLIGATION";
      /** Pseudonymous reference to the ONE reconciliation unit this claim covers. Never a raw identifier. */
      readonly obligationRef: string;
      /** What the contract side said was owed. */
      readonly expectedMinor: number;
      /** What the billing side said was raised. */
      readonly billedMinor: number;
      /** `expectedMinor − billedMinor`. Re-derived here, never trusted as stated. */
      readonly residualMinor: number;
      readonly currency: string;
    }
  | {
      readonly kind: "ACCOUNT_AGGREGATE";
      /** How many reconciliation units were summed into this one account-grained claim. */
      readonly unitCount: number;
    };

export type ProvenIneligibilityCode =
  /** No coverage was stated at all — a legacy candidate, or a path that does not state one. */
  | "OBLIGATION_COVERAGE_NOT_STATED"
  /** The claim sums several units, so no single obligation underlies it. */
  | "OBLIGATION_COVERAGE_IS_AGGREGATE"
  /** Stated as a single obligation but missing one of the four required facts. */
  | "OBLIGATION_FACTS_INCOMPLETE"
  /** The stated discrepancy does not equal expected − billed, so the figures are not self-consistent. */
  | "OBLIGATION_FACTS_INCONSISTENT"
  /** Stored evidence shows a second observation was folded into this claim. */
  | "ABSORBED_OBSERVATION_RECORDED"
  /** Nobody ran the absorption query, so a merge can be neither excluded nor shown. */
  | "ABSORPTION_NOT_CHECKED";

export type ProvenEligibility =
  | { readonly eligible: true; readonly obligationRef: string; readonly residualMinor: number }
  | { readonly eligible: false; readonly code: ProvenIneligibilityCode; readonly reason: string };

const deny = (code: ProvenIneligibilityCode, reason: string): ProvenEligibility =>
  Object.freeze({ eligible: false as const, code, reason });

export interface ProvenEligibilityInput {
  readonly coverage: ObligationCoverage | null;
  readonly absorbedObservations: AbsorbedObservations;
}

/**
 * Decide eligibility. The denials are ordered so the most specific, most informative one wins: a caller
 * told "this is an aggregate" can act on it, while "coverage was not stated" sends them to a different
 * place entirely.
 */
export function provenEligibility(input: ProvenEligibilityInput): ProvenEligibility {
  const { coverage } = input;

  if (coverage === null) {
    return deny(
      "OBLIGATION_COVERAGE_NOT_STATED",
      "this case states no obligation coverage, so the identity of the obligation being claimed is not " +
        "established — a proof may not be minted for a claim whose subject is unknown",
    );
  }

  if (coverage.kind === "ACCOUNT_AGGREGATE") {
    return deny(
      "OBLIGATION_COVERAGE_IS_AGGREGATE",
      `this case is an account-level aggregate of ${coverage.unitCount} reconciliation units, so no single ` +
        "obligation underlies it — PROVEN may not be assigned at account level",
    );
  }

  // The four facts, each required and each checked individually. A missing one is not a zero.
  if (
    coverage.obligationRef.trim() === "" ||
    coverage.currency.trim() === "" ||
    !Number.isSafeInteger(coverage.expectedMinor) ||
    !Number.isSafeInteger(coverage.billedMinor) ||
    !Number.isSafeInteger(coverage.residualMinor)
  ) {
    return deny(
      "OBLIGATION_FACTS_INCOMPLETE",
      "a single-obligation claim must carry the obligation reference, the expected amount, the billed " +
        "amount, the discrepancy and the currency; one or more is absent or not a whole minor amount",
    );
  }

  // DERIVED, NEVER NARRATED. A stamped discrepancy that does not equal expected − billed is a figure
  // nobody can trace, whichever of the three is wrong.
  if (coverage.residualMinor !== coverage.expectedMinor - coverage.billedMinor) {
    return deny(
      "OBLIGATION_FACTS_INCONSISTENT",
      `the stated discrepancy ${coverage.residualMinor} does not equal expected ${coverage.expectedMinor} ` +
        `minus billed ${coverage.billedMinor}, so the figures are not self-consistent`,
    );
  }

  // ABSORPTION LAST, because it can defeat an otherwise perfect single-obligation claim: a second
  // observation folded into this candidate means the claim no longer covers only what it states.
  if (!input.absorbedObservations.checked) {
    return deny(
      "ABSORPTION_NOT_CHECKED",
      "whether a second observation was absorbed into this case was not checked, and an unchecked " +
        "absorption is not an absence — a merge can neither be excluded nor shown",
    );
  }
  if (input.absorbedObservations.count > 0) {
    return deny(
      "ABSORBED_OBSERVATION_RECORDED",
      `${input.absorbedObservations.count} further observation(s) were admitted against this case and ` +
        "folded into it, so it may cover more than the one obligation it states",
    );
  }

  return Object.freeze({
    eligible: true as const,
    obligationRef: coverage.obligationRef,
    residualMinor: coverage.residualMinor,
  });
}

/**
 * The sentence an UNPROVEN case shows. One wording, one place — a screen must never author its own, and
 * must never render a monetary zero where a refusal belongs.
 */
export function unprovenHeadline(result: ProvenEligibility): string | null {
  if (result.eligible) return null;
  return `NOT PROVEN — ${result.code}. ${result.reason}`;
}
