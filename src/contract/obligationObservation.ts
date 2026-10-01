// 2.1.0 · OBSERVATION ONLY. What the obligation references in a real export actually look like.
//
// WHY THIS EXISTS, AND WHY IT COUNTS NOTHING. The data contract now declares `obligation_ref`, and every
// property an identity needs from it is UNKNOWN: whether it is unique, whether it survives a correction,
// whether it survives a reschedule, whether it is a source-native id or a display number a billing system
// re-issues. Those questions are answerable only from real exports. This module is how they get answered —
// by measuring, and by refusing to act on the measurement.
//
// SO IT IS DELIBERATELY INERT. It writes nothing, persists nothing, and is read by no gate. It does not
// return a verdict, an admission, a candidate, or an amount that anything may count. The only honest
// summary of its output is "here is what the references in this file look like", and the claim boundary
// below says exactly that in the structure rather than in a comment.
//
// WHAT IT CANNOT SEE, STATED FIRST. The question "does this row aggregate more than one obligation?" has
// NO OBSERVABLE PREDICATE anywhere in this system. An aggregate row is a single, clean, non-duplicate row;
// the two row-identity predicates that exist (`duplicate_cycle_id` and `DUPLICATE_SOURCE_ROW`) both detect
// MANY ROWS claiming ONE identity, which is the opposite direction. So grain completeness is a customer
// assertion NH cannot verify, and nothing below should be read as establishing it. See
// docs/OBLIGATION_IDENTITY_V1.md.
//
// WHAT IT CAN SEE is the inverse: one reference claimed by several contributing cycles, references missing
// from part of a population, malformed references, and — the quiet one that matters most — obligations
// already LOST upstream to `duplicate_cycle_id` before any reference was read.
import type { ExpectationCycle } from "../assessment/types";
import type { AssessmentPolicy } from "../assessment/policy";
import { attributeByLeakInstance } from "../assessment/leakInstanceAttribution";
import { isWellFormedObligationRef } from "./pilotDataContract";

/** Version of this observation rule. Changing what is measured is a new id, never a silent re-grade. */
export const OBLIGATION_OBSERVATION_VERSION = "nh-obligation-observation-v1";

/**
 * The attribute the adapter carries the reference on. Named once so the observation and the adapter cannot
 * drift apart silently.
 */
export const OBLIGATION_REF_ATTRIBUTE = "obligation_ref";

/**
 * Why this population could not be keyed on its obligation references, in the order a reader should care.
 *
 * These are OBSERVATIONS, not refusals — nothing is being refused, because nothing is being attempted. The
 * names deliberately match the `LeakInstanceIdentityRefusal` vocabulary so that if emission is ever
 * enabled, the thing that blocked it is already the thing that was being reported here.
 */
export type ObligationObservationBlocker =
  /** No accepted cycle carries a reference at all. */
  | "no_reference_present"
  /** Some accepted cycles carry one and others do not. A partial population cannot be keyed. */
  | "reference_incomplete"
  /** At least one reference is not a usable identifier shape. */
  | "reference_malformed"
  /** One reference is claimed by more than one contributing cycle — the resolver is not at obligation grain. */
  | "reference_ambiguous"
  /** Rows were excluded as duplicate cycles, so genuine obligations may already have been lost upstream. */
  | "obligations_lost_to_cycle_collision"
  /**
   * ALWAYS PRESENT, and that is the point. Row grain is a customer assertion with no observable predicate,
   * so no file can ever clear this one. It is listed as a blocker rather than a footnote so that a reader
   * cannot mistake an otherwise-clean report for a green light.
   */
  | "row_grain_unverifiable";

export interface ObligationObservation {
  readonly rule: typeof OBLIGATION_OBSERVATION_VERSION;

  // ── What the references look like ───────────────────────────────────────────────────────────────
  /** Accepted cycles in the population. */
  readonly acceptedCycles: number;
  readonly cyclesWithReference: number;
  readonly cyclesWithoutReference: number;
  /** Distinct reference values among accepted cycles. */
  readonly distinctReferences: number;
  /** References carried by more than one accepted cycle, whether or not those cycles contribute value. */
  readonly referencesOnMoreThanOneCycle: number;
  /** References present but not a usable identifier shape. */
  readonly malformedReferences: number;

  // ── What was already lost before a reference could matter ───────────────────────────────────────
  /**
   * Rows excluded as `duplicate_cycle_id`. Each one is a row that yielded a cycle and was then discarded
   * because another row claimed the same cycle key — which, when two genuine obligations of one
   * subscription collide, is a real obligation silently removed from the measured amount. A reference on
   * the row cannot rescue it: the collision pass runs first.
   */
  readonly rowsLostToCycleCollision: number;

  // ── The shadow attribution ──────────────────────────────────────────────────────────────────────
  /**
   * What attribution at reference grain WOULD have produced. Computed with the real rule
   * (`attributeByLeakInstance`), so the numbers are not a second implementation — and used for nothing.
   */
  readonly shadowAttributions: number;
  /** References claimed by more than one CONTRIBUTING cycle. Non-empty means not at obligation grain. */
  readonly shadowAmbiguousReferences: number;
  /** Contributing cycles with no reference. Non-zero means the population is not keyable. */
  readonly shadowUnresolvedContributingCycles: number;

  // ── The verdict that is not a verdict ───────────────────────────────────────────────────────────
  /** Every blocker observed, in declaration order. NEVER empty — `row_grain_unverifiable` is always in it. */
  readonly blockers: readonly ObligationObservationBlocker[];
  /**
   * What this output may and may not be used for. Structural, not advisory: a reader who ignores the
   * comments still has to look at these four flags.
   */
  readonly claimBoundary: {
    readonly observationOnly: true;
    readonly establishesObligationIdentity: false;
    readonly establishesRowGrain: false;
    readonly enablesCandidateEmission: false;
  };
}

/** The reference on a cycle, or "" when absent. Trimmed by the adapter already; not re-normalised here. */
function referenceOf(cycle: ExpectationCycle): string {
  return cycle.attributes[OBLIGATION_REF_ATTRIBUTE] ?? "";
}

/**
 * What one observation reads.
 *
 * A NAMED OBJECT rather than three positional parameters, because the two call paths speak different
 * vocabularies for the same fact: `assessCsv` reports a collision as an `ExclusionRecord` with reason
 * `duplicate_cycle_id`, while `validatePilotDataset` reports it as a row finding `NH-DC-2016`. Taking the
 * COUNT lets either caller supply it in its own terms, and naming the field makes it impossible to pass
 * the wrong total by position.
 */
export interface ObligationObservationInput {
  /** The population that survived to be measured. */
  readonly acceptedCycles: readonly ExpectationCycle[];
  /**
   * Rows that yielded a cycle and were then discarded because another row claimed the same cycle key.
   * When two genuine obligations of one subscription collide, each of these is a real obligation removed
   * from the measured amount — and a reference on the row cannot rescue it, because the collision pass
   * runs first.
   */
  readonly rowsLostToCycleCollision: number;
  readonly policy: AssessmentPolicy;
}

/**
 * Observe the obligation references in one accepted population.
 *
 * Pure and deterministic: no clock, no randomness, no I/O, no persistence. Total — it reports on an empty
 * population rather than throwing, because "this export carries no references" is an observation worth
 * having and not an error.
 */
export function observeObligationReferences(input: ObligationObservationInput): ObligationObservation {
  const { acceptedCycles, rowsLostToCycleCollision, policy } = input;
  const withReference = acceptedCycles.filter((c) => referenceOf(c) !== "");
  const counts = new Map<string, number>();
  let malformedReferences = 0;
  for (const cycle of withReference) {
    const ref = referenceOf(cycle);
    counts.set(ref, (counts.get(ref) ?? 0) + 1);
    if (!isWellFormedObligationRef(ref)) malformedReferences += 1;
  }
  const referencesOnMoreThanOneCycle = [...counts.values()].filter((n) => n > 1).length;

  // The shadow run. Keyed on the REFERENCE ALONE — deliberately not on a `CandidateLeakInstanceIdentity`.
  // That identity requires a boundary and a governed source namespace, and inventing either here would
  // produce a string that LOOKS like a candidate key while being authoritative for nothing. The question
  // being measured is whether the reference separates obligations, and the reference alone answers it.
  const shadow = attributeByLeakInstance(acceptedCycles, policy, (cycle) => {
    const ref = referenceOf(cycle);
    return ref === "" ? null : ref;
  });

  const blockers: ObligationObservationBlocker[] = [];
  if (withReference.length === 0) blockers.push("no_reference_present");
  else if (withReference.length !== acceptedCycles.length) blockers.push("reference_incomplete");
  if (malformedReferences > 0) blockers.push("reference_malformed");
  if (shadow.ambiguousKeys.length > 0) blockers.push("reference_ambiguous");
  if (rowsLostToCycleCollision > 0) blockers.push("obligations_lost_to_cycle_collision");
  // Unconditional, and last so it reads as the floor rather than one finding among several.
  blockers.push("row_grain_unverifiable");

  return Object.freeze({
    rule: OBLIGATION_OBSERVATION_VERSION,
    acceptedCycles: acceptedCycles.length,
    cyclesWithReference: withReference.length,
    cyclesWithoutReference: acceptedCycles.length - withReference.length,
    distinctReferences: counts.size,
    referencesOnMoreThanOneCycle,
    malformedReferences,
    rowsLostToCycleCollision,
    shadowAttributions: shadow.attributions.length,
    shadowAmbiguousReferences: shadow.ambiguousKeys.length,
    shadowUnresolvedContributingCycles: shadow.unresolvedContributingCycles,
    blockers: Object.freeze(blockers),
    claimBoundary: Object.freeze({
      observationOnly: true as const,
      establishesObligationIdentity: false as const,
      establishesRowGrain: false as const,
      enablesCandidateEmission: false as const,
    }),
  });
}
