// EP-26 · Analysis terms — the governed definition of WHAT an assessment measures.
//
// THE GOVERNANCE GAP THIS CLOSES. `asOf` and `stallThresholdDays` decide, respectively, the analysis
// cut-off and what "stalled" MEANS. They arrived in a request body. The admission bar — which is less
// load-bearing, because it only decides whether a dataset is fit to judge at all — already required a
// proposal by one identity and an activation by another. So the system governed the smaller decision
// and left the larger one to whoever sent the request. Trust Invariant rule 2 says the baseline and
// recovery definition are established BEFORE the outcome is known; these two had slipped outside it.
//
// The constitution decision of 2026-09-26 (CLAUDE.md, docs/ASSESSMENT_IDENTITY_V1.md) is that the same
// extract MAY be read again under new terms — but only terms that were pre-registered and governed the
// way the bar is governed. An operator may not pick a new cut-off on their own authority.
//
// WHY THIS IS NOT THE ADMISSION BAR'S ANTI-TUNING RULE. A bar activated after a dataset was first seen
// may never judge it (`activatedAt > firstSeenAt` ⇒ refused): someone could otherwise read a verdict,
// activate a laxer bar and resubmit. Copying that ordering here would forbid the one thing the decision
// explicitly permits — asking "and how does this look as of a later date?" — and would push an operator
// into editing the export, changing data in order to ask a question about time. The guarantee here is
// structural instead: the requester cannot state these values at all, a change is a new version needing
// a second identity's approval and a written reason, and a new version produces a NEW execution
// identity, so it can never re-grade a finding that already exists.
//
// This module is PURE: a shape, its validation, and a deterministic hash. No storage, no authorization,
// no lifecycle — the lifecycle is `policyLifecycle.ts`, reused unchanged, because whether a versioned
// governance object may act is the same question for both and forking it would let the two drift.
import { sha256Hex } from "../assessment/fingerprint";
import { ASSESSMENT_CALC_VERSION } from "../assessment/policy";

/**
 * One registered, versioned analysis-terms tuple.
 *
 * `asOf` and `stallThresholdDays` travel TOGETHER and are one object rather than two governed fields:
 * a stall definition is meaningless without the cut-off it is measured to, and governing them
 * separately would let an operator hold one fixed and walk the other.
 */
export interface AnalysisTerms {
  readonly termsId: string;
  readonly termsVersion: string;
  /** Analysis cut-off (ISO date). No row may be classified using information after this date. */
  readonly asOf: string;
  /** N: max days from expectation to observation before a cycle is a Deviation (stalled). */
  readonly stallThresholdDays: number;
  /**
   * The calculation method the terms were registered against. A build constant, not an operator
   * choice — recorded so a historical registration says which implementation it was blessed for.
   */
  readonly calculationMethodVersion: string;
}

/** Upper bound on N. Mirrors the transport schema's limit so the two cannot diverge silently. */
export const MAX_STALL_THRESHOLD_DAYS = 3650;

export interface AnalysisTermsInput {
  readonly termsId: string;
  readonly termsVersion: string;
  readonly asOf: string;
  readonly stallThresholdDays: number;
  readonly calculationMethodVersion?: string;
}

/**
 * Validate and freeze a terms tuple.
 *
 * Every field is required and there is NO default: a default cut-off is a cut-off nobody decided, and
 * the whole point of this module is that these two values have an author and an approver. `makePolicy`
 * defaults `policyId`/`policyVersion` to `policy-default`/`1` for the in-process assessment core; that
 * latitude stops here, at the governed boundary.
 */
export function makeAnalysisTerms(input: AnalysisTermsInput): AnalysisTerms {
  const termsId = input.termsId?.trim() ?? "";
  const termsVersion = input.termsVersion?.trim() ?? "";
  if (!termsId) throw new Error("AnalysisTerms: termsId is required");
  if (!termsVersion) throw new Error("AnalysisTerms: termsVersion is required");
  if (!Number.isInteger(input.stallThresholdDays) || input.stallThresholdDays < 0) {
    throw new Error(
      `AnalysisTerms: stallThresholdDays must be a non-negative integer (got ${input.stallThresholdDays})`,
    );
  }
  if (input.stallThresholdDays > MAX_STALL_THRESHOLD_DAYS) {
    throw new Error(`AnalysisTerms: stallThresholdDays must be at most ${MAX_STALL_THRESHOLD_DAYS}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf ?? "")) {
    throw new Error(`AnalysisTerms: asOf must be an ISO date YYYY-MM-DD (got ${JSON.stringify(input.asOf)})`);
  }
  // Reject 2026-02-30 and friends: a round-trip through Date must give back the same day, or the
  // string named a date that does not exist and every downstream day-count would be off.
  const asOfDate = new Date(`${input.asOf}T00:00:00.000Z`);
  if (!Number.isFinite(asOfDate.getTime()) || asOfDate.toISOString().slice(0, 10) !== input.asOf) {
    throw new Error(`AnalysisTerms: asOf must be a real calendar date (got ${JSON.stringify(input.asOf)})`);
  }
  return Object.freeze({
    termsId,
    termsVersion,
    asOf: input.asOf,
    stallThresholdDays: input.stallThresholdDays,
    calculationMethodVersion: input.calculationMethodVersion ?? ASSESSMENT_CALC_VERSION,
  });
}

/** Version of the hashing scheme itself. A change here is a new scheme, not a re-grade. */
export const ANALYSIS_TERMS_HASH_SCHEME = "nh-analysis-terms-v1";

/**
 * Fixed field order — never object-key enumeration, so a round-trip through JSON cannot change the
 * hash. NUL-separated so no value can impersonate a separator and shift the fields after it.
 */
function canonicalize(terms: AnalysisTerms): string {
  return [
    ANALYSIS_TERMS_HASH_SCHEME,
    terms.termsId,
    terms.termsVersion,
    terms.calculationMethodVersion,
    terms.asOf,
    String(terms.stallThresholdDays),
  ].join("\u0000");
}

/**
 * `sha256:<64 hex>` over the canonical form.
 *
 * Stamped into every execution binding, so a historical run carries proof of the exact definition it
 * was measured under even if the registered row were ever altered — at which point the stored and
 * recomputed hashes diverge and the change is visible instead of silent.
 */
export async function hashAnalysisTerms(terms: AnalysisTerms): Promise<string> {
  return `sha256:${await sha256Hex(canonicalize(terms))}`;
}

/** Does this tuple still hash to what an execution recorded? False is a tampering signal. */
export async function analysisTermsHashMatches(terms: AnalysisTerms, expected: string): Promise<boolean> {
  return (await hashAnalysisTerms(terms)) === expected;
}

/** `termsId@termsVersion` — the human-readable reference used in responses and audit lines. */
export function analysisTermsRef(terms: Pick<AnalysisTerms, "termsId" | "termsVersion">): string {
  return `${terms.termsId}@${terms.termsVersion}`;
}
