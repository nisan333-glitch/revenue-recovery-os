// EP-31d commit 3 · Attribution at LEAK-INSTANCE grain.
//
// WHY A SECOND GRAIN EXISTS AT ALL. `attributeByEntity` resolves the stalled cohort's at-risk value per
// ACCOUNT, and that is what EP-31 staged. It is too coarse to key a candidate on: one account holds many
// obligations, so an account-grained key makes a genuinely new obligation indistinguishable from one
// already seen — dedupe property B fails permanently, because the candidate row can be neither updated
// nor deleted. This module resolves the SAME value per obligation instead.
//
// IT IS THE SAME ARITHMETIC, NOT A SECOND ONE — and that is enforced by construction rather than
// asserted. `splitCohorts`, `classifyPayment` and `cycleContribution` are IMPORTED from the modules that
// already own them; only the GROUPING KEY differs. So the property both grains rest on — that the
// per-row figures sum to `observedUnpaid + partialOutstanding` — is a consequence of sharing one
// definition, not a coincidence two implementations happen to preserve. `attributionReconciles` is
// reused unchanged and holds for both.
//
// THE IDENTITY ARRIVES INJECTED, AND THAT IS DELIBERATE. `ExpectationCycle` carries no obligation
// reference: the data contract declares no such field, and adding one is a later, separately governed
// step. A resolver parameter keeps this module correct under every remaining open decision — it can be
// tested against an authoritative identity today without asserting anything about where that identity
// will come from, and it cannot accidentally become wired into staging or emission.
//
// GROUPING GRAIN CHANGES ATTRIBUTION ONLY. Nothing here reads or writes an assessment: the cohort split,
// the payment classification, the finding and every figure the assessment reports are untouched. A
// caller that never calls this module observes no difference at all.
//
// WHAT IT IS NOT. Not a claim. The value is AT RISK — an obligation observed unsettled as of the
// governed cut-off — never recovered, collected or proven money.
import type { ExpectationCycle } from "./types";
import type { AssessmentPolicy } from "./policy";
import { splitCohorts } from "./cohort";
import { cycleContribution } from "./entityAttribution";
import { type Money, addMoney, zeroMoney } from "../domain/money";

/** Version of THIS rule. A new grain is a new rule id, never a silent re-grade of the account grain. */
export const LEAK_INSTANCE_ATTRIBUTION_VERSION = "nh-leak-instance-attribution-v1";

/**
 * Resolve a cycle's leak-instance identity, or null when it has none.
 *
 * Pure and total: it must not throw, must not consult a clock, and must return the same answer for the
 * same cycle every time. Returning null is how a cycle says "no authoritative identity", which the
 * caller turns into a whole-population refusal rather than a silent omission.
 */
export type LeakInstanceResolver = (cycle: ExpectationCycle) => string | null;

/** One obligation's at-risk total within one assessment. */
export interface LeakInstanceAttribution {
  /** The resolved leak-instance identity. The caller pseudonymises; this module does not. */
  readonly leakInstanceKey: string;
  readonly amountAtRisk: Money;
  /**
   * How many stalled cycles contributed.
   *
   * At obligation grain this is normally 1, and a value above 1 is INFORMATION rather than noise: it
   * says the resolver's identity is not at obligation grain for this population. It is reported so a
   * caller can refuse on it; it is never smoothed away here.
   */
  readonly contributingCycleCount: number;
}

export interface LeakInstanceAttributionResult {
  readonly rule: typeof LEAK_INSTANCE_ATTRIBUTION_VERSION;
  readonly currency: string;
  /** Sorted by `leakInstanceKey`, so the same cycles always produce the same order. */
  readonly attributions: readonly LeakInstanceAttribution[];
  /** Σ over all attributions — must equal observedUnpaid + partialOutstanding. */
  readonly totalAtRisk: Money;
  /** Stalled cycles that CONTRIBUTE value but resolve to no identity. Non-zero ⇒ refuse the population. */
  readonly unresolvedContributingCycles: number;
  /** Identities claimed by more than one contributing cycle. Non-empty ⇒ refuse the population. */
  readonly ambiguousKeys: readonly string[];
}

/**
 * Attribute the stalled cohort's at-risk value to the OBLIGATIONS that own it.
 *
 * Pure and deterministic: no clock, no randomness, no I/O, no identity transformation.
 *
 * An obligation whose contributions sum to zero is OMITTED rather than reported as zero — there is
 * nothing at risk, and a zero-value candidate would be noise with a governed object wrapped around it.
 *
 * `unresolvedContributingCycles` counts only cycles that would have CONTRIBUTED. A stalled cycle that is
 * cancelled, refunded or unknown contributes nothing, so its lack of an identity cannot change any
 * figure and must not block a population — counting it would refuse datasets for a gap that has no
 * effect on the number.
 */
export function attributeByLeakInstance(
  cycles: readonly ExpectationCycle[],
  policy: AssessmentPolicy,
  resolve: LeakInstanceResolver,
): LeakInstanceAttributionResult {
  const { stalled } = splitCohorts(cycles, policy);
  const totals = new Map<string, { amount: Money; cycles: number }>();
  let unresolvedContributingCycles = 0;

  for (const cycle of stalled) {
    // Same defensive throw as the account grain, and for the same reason: the adapter excludes
    // cross-currency rows and `observedSummary` throws on this condition, so silently dropping one here
    // would make the two totals disagree — the one failure this module exists to make impossible.
    if (cycle.currency !== policy.currency) {
      throw new Error(
        `attributeByLeakInstance: cross-currency cycle ${cycle.cycleId} (${cycle.currency} vs policy ${policy.currency})`,
      );
    }
    const amount = cycleContribution(cycle, policy);
    if (amount === null) continue;
    const key = resolve(cycle);
    if (key === null || key === "") {
      unresolvedContributingCycles += 1;
      continue;
    }
    const prior = totals.get(key);
    totals.set(key, {
      amount: prior ? addMoney(prior.amount, amount) : amount,
      cycles: (prior?.cycles ?? 0) + 1,
    });
  }

  const attributions: LeakInstanceAttribution[] = [];
  const ambiguousKeys: string[] = [];
  let totalAtRisk = zeroMoney(policy.currency);
  for (const leakInstanceKey of [...totals.keys()].sort()) {
    const { amount, cycles: contributingCycleCount } = totals.get(leakInstanceKey)!;
    if (contributingCycleCount > 1) ambiguousKeys.push(leakInstanceKey);
    if (amount.minor === 0) continue;
    attributions.push(Object.freeze({ leakInstanceKey, amountAtRisk: amount, contributingCycleCount }));
    totalAtRisk = addMoney(totalAtRisk, amount);
  }

  return Object.freeze({
    rule: LEAK_INSTANCE_ATTRIBUTION_VERSION,
    currency: policy.currency,
    attributions: Object.freeze(attributions),
    totalAtRisk,
    unresolvedContributingCycles,
    ambiguousKeys: Object.freeze(ambiguousKeys),
  });
}
