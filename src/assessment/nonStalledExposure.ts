// DETECTOR #2 · Overdue monetary exposure on obligations whose account did NOT stall.
//
// THE GAP THIS CLOSES, in one line. `observedSummary` is called with the stalled cohort only
// (`assess.ts`), so `for (const c of stalled)` means payment state is never evaluated for a cycle routed
// to `reference` or `undetermined`. An overdue unpaid invoice on an account that activated on time was
// therefore invisible BY CONSTRUCTION — not in the headline, not in `grossEligible`, not even in
// `excludedValue`. The frozen business register priced that blind spot at $14,800.00 across two planted
// obligations, both classified "REPRESENTABLE, NOT DETECTED".
//
// WHY A SEPARATE MODULE AND NOT A WIDENING OF `observedSummary`. Two independent reasons, and either
// alone would be decisive:
//
//   1. `ObservedSummary` carries `stalledCount` in its own shape. Feeding it a non-stalled population
//      would produce a field named `stalledCount` holding a non-stalled count — a semantic lie.
//   2. `computeBehaviourFingerprint` digests the WHOLE `ObservedSummary` object. Adding a key changes
//      the JSON and therefore the SHA-256, which fails the calculation-method lineage test, forces an
//      `ASSESSMENT_CALC_VERSION` bump, refuses scheduling `NH-AX-1014` until every governed terms
//      version is re-blessed, and makes every admitted extract need re-assessment. A separate summary
//      leaves the digested object byte-identical and fires none of that.
//
// WHAT THIS IS, STATED EXACTLY. OBSERVED monetary exposure: the sum of obligation amounts that are due
// by the cut-off and unsettled, read verbatim from the customer's own figures in exact minor units. It
// is NOT an estimate, NOT a forecast, NOT recoverable revenue, NOT proven revenue, and it asserts NO
// causal claim — nothing here says the absence of an activation stall caused the non-payment, or that
// anyone will collect a cent of it.
//
// DISJOINT BY CONSTRUCTION. `splitCohorts` assigns every cycle to exactly one of three arrays, so the
// stalled surface and this one cannot both contain the same cycle. The caller passes the complement; the
// additivity proof lives in the tests, where it is computed rather than asserted.
import type { AssessmentPolicy } from "./policy";
import type { ExpectationCycle, NonStalledExposureSummary, PaymentState } from "./types";
import { classifyPayment } from "./paymentState";
import { type Money, addMoney, subMoney, zeroMoney, isPositive, clampNonNegative } from "../domain/money";

/**
 * Overdue exposure over a population that excludes the stalled cohort.
 *
 * `classifyPayment` is reused UNCHANGED: it already takes a cycle and an `asOf` and has no notion of
 * stalling, so the capability was present all along and simply never called over these cycles. Every
 * false-positive control therefore behaves identically to the existing headline — which is the point.
 *
 * "OVERDUE" NEEDS NO EXTRA PREDICATE, and that is worth knowing rather than re-deriving: `classifyPayment`
 * returns `NotYetDue` BEFORE it can return `Unpaid` or `PartiallyPaid`, so both of those states already
 * imply `dueAt <= asOf`. Adding a second date comparison here would be dead code that looked like a
 * safeguard. The ordering is pinned by a test instead.
 */
export function nonStalledExposureSummary(
  nonStalled: readonly ExpectationCycle[],
  policy: AssessmentPolicy,
): NonStalledExposureSummary {
  const cur = policy.currency;
  let overdueUnpaid = zeroMoney(cur);
  let overduePartialOutstanding = zeroMoney(cur);
  let excludedValue = zeroMoney(cur);
  let unknownValue = zeroMoney(cur);
  const stateCounts: Record<PaymentState, number> = {
    NotYetDue: 0, Unpaid: 0, PartiallyPaid: 0, PaidOnTime: 0, PaidLate: 0, Refunded: 0, Cancelled: 0, Unknown: 0,
  };

  for (const c of nonStalled) {
    // Fail closed on cross-currency exactly as the stalled surface does. The adapter excludes mismatches,
    // so reaching here means an invariant upstream broke, and a thrown error is the honest response: a
    // silently dropped row would understate exposure, and a coerced one would invent an amount.
    if (c.currency !== cur) {
      throw new Error(
        `nonStalledExposureSummary: cross-currency cycle ${c.cycleId} (${c.currency} vs policy ${cur})`,
      );
    }
    const amount: Money = c.monetaryEvent.amount;
    const state = classifyPayment(c, policy.asOf);
    stateCounts[state] += 1;

    switch (state) {
      case "Unpaid":
        // The full obligated amount. Nothing is settled, so nothing is netted off.
        overdueUnpaid = addMoney(overdueUnpaid, amount);
        break;
      case "PartiallyPaid": {
        // THE REMAINDER ONLY, clamped. Using the full invoice amount here would overstate exposure by
        // whatever the customer has already paid — the single easiest way to inflate this number.
        const paid = c.monetaryEvent.paidAmount ?? zeroMoney(cur);
        overduePartialOutstanding = addMoney(
          overduePartialOutstanding,
          clampNonNegative(subMoney(amount, paid)),
        );
        break;
      }
      case "Cancelled":
      case "Refunded":
        // Surfaced in its own bucket rather than dropped, so the exclusion is visible and a reader can
        // see what was taken out. Both states require a DATED terminal event upstream; an undated one is
        // rejected at the adapter and never reaches a cycle.
        excludedValue = addMoney(excludedValue, amount);
        break;
      case "Unknown":
        // Settled by some amount whose timing cannot be placed as-of the cut-off. Never counted as
        // exposure — the zero-guess rule: we do not infer when a payment happened.
        unknownValue = addMoney(unknownValue, amount);
        break;
      // NotYetDue / PaidOnTime / PaidLate carry no overdue exposure. NotYetDue in particular is NOT a
      // leak: the obligation simply has not come due yet.
      default:
        break;
    }
  }

  return Object.freeze({
    currency: cur,
    population: nonStalled.length,
    overdueUnpaid,
    overduePartialOutstanding,
    excludedValue,
    unknownValue,
    stateCounts: Object.freeze(stateCounts),
  }) as NonStalledExposureSummary;
}

/**
 * The complement of the stalled cohort, in SOURCE ORDER.
 *
 * Source order rather than `[...reference, ...undetermined]` for two reasons: it is the deterministic
 * one (concatenation order is an arbitrary choice that a later refactor could flip), and it stays correct
 * by construction if `splitCohorts` ever grows a fourth cohort — the complement is defined by what is
 * NOT stalled, never by enumerating what is.
 *
 * `cycleId` is a safe key here because `dedupeCollisions` has already removed collisions: two cycles
 * sharing an id are both excluded upstream, so the accepted population has unique ids.
 */
export function nonStalledPopulation(
  accepted: readonly ExpectationCycle[],
  stalled: readonly ExpectationCycle[],
): readonly ExpectationCycle[] {
  const stalledIds = new Set(stalled.map((c) => c.cycleId));
  return Object.freeze(accepted.filter((c) => !stalledIds.has(c.cycleId)));
}

/** True when any overdue exposure was observed. Convenience for a reader; adds no semantics. */
export function hasNonStalledExposure(summary: NonStalledExposureSummary): boolean {
  return isPositive(summary.overdueUnpaid) || isPositive(summary.overduePartialOutstanding);
}
