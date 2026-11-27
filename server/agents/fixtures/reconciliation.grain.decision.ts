/**
 * THE OWNER'S GRAIN DECISION · 2026-11-27 · recorded ADDITIVELY.
 *
 * WHY A NEW FILE AND NOT AN EDIT. `reconciliation.scenarios.expectations.ts` is hashed into
 * `SCENARIOS.FREEZE.lock.json`, and its `PROVEN_GRAIN_AUTHORIZATION.businessAuthorizationProven` is
 * `false`. That record was accurate when it was written, and rewriting an expectation to match a
 * later decision is exactly what the freeze exists to prevent — *a superseded conclusion is corrected
 * and preserved, never deleted and never silently rewritten*. So the frozen file is UNTOUCHED, its
 * lock still verifies, and the decision that supersedes part of it lives here with a link back.
 *
 * WHAT THE OWNER APPROVED, in their words: obligation-grained identity as **the intended business
 * architecture** for S-DUP-2 — and explicitly NOT a certification of implementation correctness,
 * production readiness, or prevention of cross-case double attribution. Those three stay open, and
 * the fields below keep them open rather than letting the approval be read as covering them.
 */

/** What `PROVEN_GRAIN_AUTHORIZATION` said, quoted so the supersession is checkable in one place. */
export const SUPERSEDED_IN_PART = Object.freeze({
  file: "server/agents/fixtures/reconciliation.scenarios.expectations.ts",
  constant: "PROVEN_GRAIN_AUTHORIZATION",
  frozenValue: Object.freeze({
    routeExists: true,
    businessAuthorizationProven: false,
    doubleAttributionPrevented: "WITHIN_CASE_ONLY",
  }),
  status: "SUPERSEDED IN PART — the business authorization is now given; the rest stands",
  untouched: true,
});

export const OBLIGATION_GRAIN_DECISION = Object.freeze({
  id: "S-DUP-2-GRAIN",
  decidedAt: "2026-11-27",
  decidedBy: "owner",

  /** The one thing the approval settles. */
  businessAuthorizationProven: true,
  architecture: "obligation-grained identity, one candidate per reconciliation unit where the "
    + "obligation's identity is authoritative; account-grained fallback where it is not",

  /**
   * THE THREE THINGS THE APPROVAL EXPLICITLY DOES NOT CERTIFY, each as its own field so no single
   * boolean can be quoted as covering all of them.
   */
  certifiesImplementationCorrectness: false,
  certifiesProductionReadiness: false,
  certifiesCrossCaseDoubleAttributionPrevented: false,

  /**
   * Cross-case double attribution, as it now stands. `ADMISSION_REFUSES_OVERLAP` is stronger than the
   * frozen `WITHIN_CASE_ONLY`, and deliberately not called "prevented": it refuses the overlap it can
   * DERIVE — an account-grained aggregate for the same payer in the same boundary — and the reverse
   * direction is argued unreachable rather than checked. See `caseAdmission.ts`.
   */
  doubleAttributionPrevented: "ADMISSION_REFUSES_DERIVABLE_OVERLAP" as const,

  /** What the frozen `requiredOutcome` asked for, and how this build answers it. */
  requiredOutcomeSatisfiedBy: "the record now DISTINGUISHES the two obligations, rather than stating "
    + "that it cannot — the stronger disjunct of the frozen requirement, with the $900.00 conservation "
    + "assertion unchanged and asserted first",

  /** Preserved so a reader can see the gap closed rather than taking it on trust. */
  closesKnownGap: "which obligation contributed is not recoverable from the candidate",

  /** Not authorised by this decision, and listed so the boundary of the approval is explicit. */
  stillRequiresOwnerApproval: Object.freeze([
    "any push of the implementing commits",
    "any production migration",
    "any deployment",
    "retiring an existing account-grained aggregate candidate in a boundary already assessed",
  ]),
});
