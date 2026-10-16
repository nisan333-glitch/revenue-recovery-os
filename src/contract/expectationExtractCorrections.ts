// APPEND-ONLY ERRATA against the expectation extract's recorded design decisions.
//
// WHY THIS IS A SEPARATE FILE. Append-only is a property worth making STRUCTURAL rather than promising.
// Nothing here can edit `expectationExtract.ts`, so the original conclusions stay inspectable in the
// words they were written in, and a correction can only ever be added beside them.
//
// THE RULE, which is the benchmark-revision discipline applied to a DESIGN record rather than to a
// measurement:
//
//   **A superseded conclusion is CORRECTED AND PRESERVED, never deleted and never silently rewritten.**
//   A correction must state which conclusion it supersedes, the evidence that superseded it, what
//   remains valid, what no longer is, and the exact commits that caused it. The old conclusion stays
//   readable and is marked so no future reader can mistake it for current architecture.
//
// WHY NO VERSION BUMP. `EXPECTATION_EXTRACT_VERSION` stays `1.1.0`. Its governed fields, tiers,
// validator semantics and acceptance behaviour are all unchanged — a correction to recorded REASONING
// changes no byte of what the validator accepts or refuses. A version that signalled a change which did
// not happen would be its own defect: it would force a re-reading of every extract to express a
// dependency that does not exist.
import { STOPPED_FIELDS } from "./expectationExtract";

export type CorrectionStatus =
  /** Part of the reasoning fell; the conclusion survives in a changed form. */
  | "SUPERSEDED_IN_PART"
  /** The whole conclusion fell. */
  | "SUPERSEDED_IN_FULL";

export interface StoppedFieldCorrection {
  /** The `STOPPED_FIELDS` candidate this corrects, matched EXACTLY so it cannot drift. */
  readonly correctsCandidate: string;
  readonly status: CorrectionStatus;
  readonly correctedOn: string;
  /** The claim that no longer holds, quoted from the original record. */
  readonly supersededConclusion: string;
  /** What established that it does not hold. Measurement, not argument. */
  readonly evidence: readonly string[];
  /** The exact commits that produced that evidence. */
  readonly causingCommits: readonly string[];
  /** Parts of the original reasoning that STILL BIND. */
  readonly stillValid: readonly string[];
  /** Parts that are no longer valid. */
  readonly noLongerValid: readonly string[];
  /** What the architecture is now. */
  readonly currentArchitecture: string;
  /** Where the full treatment lives. */
  readonly recordedIn: readonly string[];
}

function correction(spec: StoppedFieldCorrection): StoppedFieldCorrection {
  return Object.freeze(spec);
}

export const STOPPED_FIELD_CORRECTIONS: readonly StoppedFieldCorrection[] = Object.freeze([
  correction({
    correctsCandidate: "obligation_ref as a cross-system join key",
    status: "SUPERSEDED_IN_PART",
    correctedOn: "2026-10-07",
    supersededConclusion:
      "that a billing migration re-keys the entire book at once, so the whole expected book would read as missing — offered as a reason no obligation reference could serve as a cross-system join key.",
    evidence: Object.freeze([
      "M14 (bare re-key, no retained mapping): 12 REFUSED_UNMATCHED_IDENTITY refusals fell to 0, resolved from the obligation reference alone WITH NO ALIAS MAP SUPPLIED.",
      "M15 (whole-book migration, 28 entitlements, every billing key changed at once): resolved WITHOUT the retained legacy key — the case the original objection named as fatal.",
      "The mechanism: an authoritative obligation reference survives billing's internal re-key PRECISELY BECAUSE it was never billing's internal key. The objection assumed the reference would be the thing that got re-keyed.",
      "Measured on the frozen obligation-ref variant with the ruler and the ground truth byte-identical: headline claimable money $60,246.00 -> $79,846.00 with fabricated money $0.00 before and after.",
    ]),
    causingCommits: Object.freeze([
      "bc2303a41beb2a6370a74876d9d8a625ff462712 — the controlled counterfactual: one new column, two controls reproducing the baseline identically including the witness",
      "2bf15817530f884e8f3981a483c339e0e01a2fa3 — the pairing-order correction, which released the remainder and proved the residual hold was an internal defect rather than a missing fact",
    ]),
    stillValid: Object.freeze([
      "THE TWO SIDES IDENTIFY AT DIFFERENT GRAINS. Unchanged, and still binding.",
      "CONSOLIDATION AND SPLITTING ARE MANY-TO-MANY. M05 (one obligation settled by two lines summing correctly) and M06 (two periods on one invoice) are exactly these cases. The counterfactual handled them MONETARILY and explicitly could NOT establish a duplicate as an EVENT — which needs an expected settlement count, a second and separate fact.",
      "`schedule_line_ref` IS SCOPED WITHIN THE EXPECTATION EXTRACT and is deliberately not a cross-system key. It is the TARGET the billing side points at; it does not itself reach across.",
      "THE GRAIN QUESTION REMAINS OPEN. An aggregate row stays structurally invisible at obligation grain, and no contract field may promote grain.",
      "A GENERIC INVOICE-LEVEL REFERENCE IS STILL NOT SUFFICIENT. What was measured is an OBLIGATION-level reference naming the contract system's own identifier — not an invoice-level one.",
    ]),
    noLongerValid: Object.freeze([
      "That a whole-book billing migration defeats an obligation reference. REFUTED BY MEASUREMENT on M15.",
      "That a re-key makes the expected book read as missing. REFUTED BY MEASUREMENT on M14.",
      "That no cross-system join key can be made to work at all — which the original entry implied by stopping the field outright rather than relocating it.",
    ]),
    currentArchitecture:
      "The cross-system obligation reference lives on the BILLING/SETTLEMENT side, as `obligation_ref` on `nh.settlement-extract@1.0.0`, carrying the contract system's own obligation identifier onto the line that settles it. It is a CONDITIONAL, FAIL-CLOSED capability there: absent, SETTLEMENT_OBLIGATION_LINK_AVAILABLE closes and no row is rejected. It remains STOPPED on the expectation side, for the reason the original entry gave and which still holds — a join key must exist on both sides, and the grain study established that billing emits no contract identity, so the reference is the thing billing must add. `schedule_line_ref` is unchanged and stays scoped within the expectation extract.",
    recordedIn: Object.freeze([
      "docs/OBLIGATION_REF_COUNTERFACTUAL_V1.md",
      "docs/PAIRING_ORDER_V1.md",
      "docs/CUSTOMER_DATA_READINESS_V1.md",
      "src/contract/settlementExtract.ts",
    ]),
  }),
]);

/**
 * The corrections for one candidate, or an empty list. Used by anything rendering the stopped-field
 * record so a reader cannot be shown the old conclusion without its correction.
 */
export function correctionsFor(candidate: string): readonly StoppedFieldCorrection[] {
  return Object.freeze(STOPPED_FIELD_CORRECTIONS.filter((c) => c.correctsCandidate === candidate));
}

/** Candidates carrying a correction, for the marker guard. */
export const CORRECTED_CANDIDATES: readonly string[] = Object.freeze(
  [...new Set(STOPPED_FIELD_CORRECTIONS.map((c) => c.correctsCandidate))].sort(),
);

/**
 * Every correction must name a candidate that actually exists in `STOPPED_FIELDS`. A correction
 * pointing at nothing would read as diligence while correcting no record at all.
 */
export const ORPHANED_CORRECTIONS: readonly string[] = Object.freeze(
  STOPPED_FIELD_CORRECTIONS
    .filter((c) => !STOPPED_FIELDS.some((s) => s.candidate === c.correctsCandidate))
    .map((c) => c.correctsCandidate),
);
