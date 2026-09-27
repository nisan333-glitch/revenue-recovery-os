// EP-31 · Per-entity attribution of the stalled cohort's at-risk value.
//
// WHY THIS EXISTS. `observedSummary` answers "how much is at risk in this population" — one number per
// bucket, over the whole stalled cohort. A governed recovery case is about ONE ACCOUNT, so the bridge
// into the Case lane needs the same arithmetic resolved per entity. This module does exactly that and
// nothing else.
//
// IT IS THE SAME PARTITION, NOT A SECOND ONE. The cohort split and the payment classification are
// `splitCohorts` and `classifyPayment`, imported unchanged. Re-implementing either would create two
// definitions of "stalled and unpaid" that could drift, and the number a case is opened on would stop
// being the number the assessment reported. `attributionReconciles` below is the assertion of that
// identity, and the tests hold it to the minor unit.
//
// WHAT IT IS NOT. Not a claim. The value is AT RISK — an obligation observed unsettled as of the
// governed cut-off — never recovered, collected or proven money. Nothing here imports the proof kernel,
// the ledger, or anything that can count a dollar, and nothing here knows what a CandidateSignal is.
//
// AGGREGATED PER ENTITY, WHICH IS NOT COSMETIC. One entity may own many cycles (`ExpectationCycle.entityId`
// is explicitly "NOT assumed unique"), and downstream the candidate identity is keyed on the account, not
// the cycle. Emitting per cycle would let two rows for one account collapse to whichever arrived first, so
// the per-account total is the only shape that reconciles.
import type { ExpectationCycle } from "./types";
import type { AssessmentPolicy } from "./policy";
import { splitCohorts } from "./cohort";
import { classifyPayment } from "./paymentState";
import { type Money, addMoney, subMoney, zeroMoney, clampNonNegative } from "../domain/money";

/** Version of the attribution rule itself. A change here is a new rule, never a silent re-grade. */
export const ENTITY_ATTRIBUTION_VERSION = "nh-entity-attribution-v1";

/** One account's at-risk total within one assessment, with the evidence of how it was reached. */
export interface EntityAttribution {
  /** The owning account, as the source names it. The caller pseudonymises; this module does not. */
  readonly entityId: string;
  /** Σ of this entity's contributions. Exact minor units, never estimated. */
  readonly amountAtRisk: Money;
  /** How many stalled cycles contributed. Reported so a single figure is never mistaken for one invoice. */
  readonly contributingCycleCount: number;
}

export interface EntityAttributionResult {
  readonly rule: typeof ENTITY_ATTRIBUTION_VERSION;
  readonly currency: string;
  /** Sorted by `entityId`, so the same cycles always produce the same order. */
  readonly attributions: readonly EntityAttribution[];
  /** Σ over all attributions — the figure that must equal observedUnpaid + partialOutstanding. */
  readonly totalAtRisk: Money;
}

/**
 * Which states contribute, and how much each contributes.
 *
 * This mirrors `observedSummary` exactly (see `observed.ts`), and the exclusions are the point rather
 * than an omission:
 *
 *   • `Unpaid`         → the full obligation. Due by asOf, nothing settled by asOf.
 *   • `PartiallyPaid`  → the REMAINDER only (amount − paid, clamped). The settled part is not at risk.
 *   • `Cancelled` / `Refunded` → nothing. This value is excluded, and excluded value must never be
 *     re-presented as at risk — that is the whole reason `excludedValue` has its own bucket.
 *   • `Unknown`        → nothing. The payment evidence could not be placed as of the cut-off, so an
 *     at-risk claim would be asserting something the data does not support.
 *   • `NotYetDue` / `PaidOnTime` / `PaidLate` → nothing at risk.
 */
function contribution(cycle: ExpectationCycle, policy: AssessmentPolicy): Money | null {
  const state = classifyPayment(cycle, policy.asOf);
  if (state === "Unpaid") return cycle.monetaryEvent.amount;
  if (state === "PartiallyPaid") {
    const paid = cycle.monetaryEvent.paidAmount ?? zeroMoney(policy.currency);
    return clampNonNegative(subMoney(cycle.monetaryEvent.amount, paid));
  }
  return null;
}

/**
 * Attribute the stalled cohort's at-risk value to the accounts that own it.
 *
 * Pure and deterministic: no clock, no randomness, no I/O, no identity transformation. The same cycles
 * and the same policy always produce a byte-identical result, which is what lets a downstream candidate
 * be re-derived and checked rather than trusted.
 *
 * An entity whose contributions sum to zero is OMITTED rather than reported as zero — there is nothing at
 * risk, and a zero-value candidate would be noise with a governed object wrapped around it.
 */
export function attributeByEntity(
  cycles: readonly ExpectationCycle[],
  policy: AssessmentPolicy,
): EntityAttributionResult {
  const { stalled } = splitCohorts(cycles, policy);
  const totals = new Map<string, { amount: Money; cycles: number }>();

  for (const cycle of stalled) {
    // Defensive, and deliberately a throw rather than a skip: the adapter excludes cross-currency rows
    // and `observedSummary` throws on the same condition. Silently dropping one here would make the two
    // totals disagree, which is the one failure this module exists to make impossible.
    if (cycle.currency !== policy.currency) {
      throw new Error(
        `attributeByEntity: cross-currency cycle ${cycle.cycleId} (${cycle.currency} vs policy ${policy.currency})`,
      );
    }
    const amount = contribution(cycle, policy);
    if (amount === null) continue;
    const prior = totals.get(cycle.entityId);
    totals.set(cycle.entityId, {
      amount: prior ? addMoney(prior.amount, amount) : amount,
      cycles: (prior?.cycles ?? 0) + 1,
    });
  }

  const attributions: EntityAttribution[] = [];
  let totalAtRisk = zeroMoney(policy.currency);
  // Sorted so the output is stable regardless of the order cycles arrived in. An unstable order would
  // make a re-derivation compare unequal for no reason a reader could act on.
  for (const entityId of [...totals.keys()].sort()) {
    const { amount, cycles: contributingCycleCount } = totals.get(entityId)!;
    if (amount.minor === 0) continue; // nothing at risk ⇒ no attribution at all
    attributions.push(Object.freeze({ entityId, amountAtRisk: amount, contributingCycleCount }));
    totalAtRisk = addMoney(totalAtRisk, amount);
  }

  return Object.freeze({
    rule: ENTITY_ATTRIBUTION_VERSION,
    currency: policy.currency,
    attributions: Object.freeze(attributions),
    totalAtRisk,
  });
}

/**
 * Does the per-entity total equal the aggregate the assessment reported?
 *
 * The assessment's at-risk value is `observedUnpaid + partialOutstanding` — the headline plus the
 * remainder reported beside it. `excludedValue` and `unknownValue` are deliberately NOT included, for the
 * same reason they contribute nothing above.
 *
 * Exposed rather than left to the tests because the server asserts it at the moment it stages the
 * attribution: a mismatch there means the two computations have diverged, which must stop the write
 * rather than produce candidates nobody can tie back to the finding.
 */
export function attributionReconciles(
  result: EntityAttributionResult,
  observedUnpaid: Money,
  partialOutstanding: Money,
): boolean {
  return (
    result.totalAtRisk.currency === observedUnpaid.currency &&
    observedUnpaid.currency === partialOutstanding.currency &&
    result.totalAtRisk.minor === observedUnpaid.minor + partialOutstanding.minor
  );
}
