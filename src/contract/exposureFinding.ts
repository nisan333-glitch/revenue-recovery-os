// DETECTOR #2's governed artifact — a SIBLING of `AssessmentFinding`, never a part of it.
//
// WHY THIS FILE EXISTS AT ALL, and it is the whole architectural point of the slice.
//
// The obvious implementation was to add two money scalars to `AssessmentFinding` and to
// `canonicalFinding`. That is a SILENT SEMANTIC RE-GRADE and it is not permitted. `canonicalFinding`
// serialises a fixed key list, so adding a key changes the JSON and therefore the SHA-256. The
// consequence, stated exactly:
//
//     same historical input + same governed terms + same ASSESSMENT_CALC_VERSION
//        ⇒ DIFFERENT findingHash
//
// `findingHash` would stop being a function of (input, terms, calculation method) and become a function
// of (input, terms, calculation method, BUILD). That is precisely the drift `ASSESSMENT_CALC_VERSION`
// exists to make visible, and it breaks the Trust Invariant's rule 5 — historical proof must stay
// reproducible forever. A hash you can no longer recompute from the facts it covers is not a witness.
//
// It would not have BROKEN anything today: `hashFinding` has exactly one production caller, at the moment
// a finding is produced; nothing re-hashes a stored finding; the table is append-only and a finished task
// is never re-claimed. That is why the defect would have been silent, and why "nothing fails" was never
// the right test.
//
// SO THE NEW COMPUTATION GETS ITS OWN EVERYTHING: its own scheme id, its own canonical form, its own
// hash, and — the part that matters most — ITS OWN VERSION CONSTANT. A future change to how non-stalled
// exposure is computed is then visible in `NON_STALLED_EXPOSURE_METHOD_VERSION` without touching the
// assessment's calculation method, re-blessing a single governed terms version, or re-assessing one
// admitted extract. This mirrors how the repository already separates concerns: `POLICY_HASH_SCHEME`,
// `ANALYSIS_TERMS_HASH_SCHEME`, `EXECUTION_BINDING_SCHEME` and `LEAK_INSTANCE_IDENTITY_SCHEME` each own
// their own identity rather than sharing one.
//
// WHAT THIS ARTIFACT IS NOT. Not proof, not revenue, not a recovery case, not a candidate. It is an
// OBSERVED exposure reading, and `claimBoundary` says so in the payload rather than only in this comment.
import type { NonStalledExposureSummary } from "../assessment/types";
import { sha256Hex } from "../assessment/fingerprint";

/** A change here is a NEW scheme id, never a silent re-grade of what the old one meant. */
export const EXPOSURE_FINDING_SCHEME = "nh-non-stalled-exposure-v1";

/**
 * The method version for NON-STALLED EXPOSURE, deliberately independent of `ASSESSMENT_CALC_VERSION`.
 *
 * Separate so the two can move without dragging each other: a change to how this exposure is computed
 * must be visible, and must NOT invalidate a single historical assessment finding or require a governed
 * terms version to be re-blessed. Collapsing the two constants would reintroduce exactly the coupling
 * this file was written to avoid.
 */
export const NON_STALLED_EXPOSURE_METHOD_VERSION = "nse-2026.1";

/**
 * The persisted reading. Flat scalars in minor units, so it is comparable and diffable without parsing
 * nested money objects — the same shape discipline `AssessmentFinding` uses.
 */
export interface NonStalledExposureFinding {
  readonly scheme: typeof EXPOSURE_FINDING_SCHEME;
  readonly methodVersion: string;
  readonly executionId: string;
  readonly boundaryId: string;
  /** Accepted cycles evaluated: the accepted population minus the stalled cohort. */
  readonly population: number;
  readonly currency: string;
  /** Exact minor units. OBSERVED exposure — never proven, never recoverable. */
  readonly overdueUnpaidMinor: number;
  readonly overduePartialOutstandingMinor: number;
  readonly excludedValueMinor: number;
  readonly unknownValueMinor: number;
  readonly stateCounts: Readonly<Record<string, number>>;
  /**
   * Stated in the payload, not merely in a comment, so a consumer that never reads this file still
   * cannot mistake the figure for money returned.
   */
  readonly claimBoundary: {
    readonly observationOnly: true;
    readonly constitutesProof: false;
    readonly constitutesRevenue: false;
    readonly createsRecoveryCase: false;
  };
}

export function makeNonStalledExposureFinding(input: {
  readonly executionId: string;
  readonly boundaryId: string;
  readonly summary: NonStalledExposureSummary;
}): NonStalledExposureFinding {
  const s = input.summary;
  return Object.freeze({
    scheme: EXPOSURE_FINDING_SCHEME,
    methodVersion: NON_STALLED_EXPOSURE_METHOD_VERSION,
    executionId: input.executionId,
    boundaryId: input.boundaryId,
    population: s.population,
    currency: s.currency,
    overdueUnpaidMinor: s.overdueUnpaid.minor,
    overduePartialOutstandingMinor: s.overduePartialOutstanding.minor,
    excludedValueMinor: s.excludedValue.minor,
    unknownValueMinor: s.unknownValue.minor,
    stateCounts: Object.freeze({ ...s.stateCounts }),
    claimBoundary: Object.freeze({
      observationOnly: true as const,
      constitutesProof: false as const,
      constitutesRevenue: false as const,
      createsRecoveryCase: false as const,
    }),
  });
}

/**
 * Canonical JSON — fixed key order, state counts sorted, so the hash is a stable witness.
 *
 * The scheme and the method version are INSIDE the preimage rather than prefixed onto the digest, so a
 * future scheme cannot collide with this one even over identical figures.
 */
export function canonicalExposureFinding(finding: NonStalledExposureFinding): string {
  return JSON.stringify({
    scheme: finding.scheme,
    methodVersion: finding.methodVersion,
    executionId: finding.executionId,
    boundaryId: finding.boundaryId,
    population: finding.population,
    currency: finding.currency,
    overdueUnpaidMinor: finding.overdueUnpaidMinor,
    overduePartialOutstandingMinor: finding.overduePartialOutstandingMinor,
    excludedValueMinor: finding.excludedValueMinor,
    unknownValueMinor: finding.unknownValueMinor,
    stateCounts: Object.fromEntries(
      Object.entries(finding.stateCounts).sort(([a], [b]) => a.localeCompare(b)),
    ),
  });
}

/** `sha256:<64 hex>` over the canonical form. Its own witness, covering only this artifact. */
export async function hashExposureFinding(finding: NonStalledExposureFinding): Promise<string> {
  return `sha256:${await sha256Hex(canonicalExposureFinding(finding))}`;
}
