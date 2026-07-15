// Observed Unpaid Value — computed ONLY from imported records over the stalled cohort, exact in
// minor units. This is the sole headline of the thin slice. Nothing here is estimated or forecast.
//
// Eligibility is explicit: only cycles classified `Unpaid` (due on/before asOf, not cancelled/
// refunded/partial/zero/unknown) contribute to `observedUnpaid`. Every other value is surfaced in
// its own bucket so the exclusion is visible, never silent.
import type { AssessmentPolicy } from "./policy";
import type { ExpectationCycle, ObservedSummary, PaymentState } from "./types";
import { classifyPayment } from "./paymentState";
import { type Money, addMoney, subMoney, zeroMoney, isPositive, clampNonNegative } from "../domain/money";

export function observedSummary(
  stalled: readonly ExpectationCycle[],
  policy: AssessmentPolicy,
): ObservedSummary {
  const cur = policy.currency;
  let grossEligible = zeroMoney(cur);
  let observedUnpaid = zeroMoney(cur);
  let partialOutstanding = zeroMoney(cur);
  let excludedValue = zeroMoney(cur);
  let unknownValue = zeroMoney(cur);
  const stateCounts: Record<PaymentState, number> = {
    NotYetDue: 0, Unpaid: 0, PartiallyPaid: 0, PaidOnTime: 0, PaidLate: 0, Refunded: 0, Cancelled: 0, Unknown: 0,
  };

  for (const c of stalled) {
    // Defensive: cohort currency must match the single-currency policy (adapter excludes mismatches).
    if (c.currency !== cur) {
      throw new Error(`observedSummary: cross-currency cycle ${c.cycleId} (${c.currency} vs policy ${cur})`);
    }
    const amount: Money = c.monetaryEvent.amount;
    const state = classifyPayment(c, policy.asOf);
    stateCounts[state] += 1;

    // "Eligible universe" = invoices that are due by asOf and not cancelled/refunded — i.e. could
    // legitimately be unpaid. NotYetDue is not part of the eligible universe.
    const inEligibleUniverse =
      state === "Unpaid" || state === "PartiallyPaid" || state === "PaidOnTime" || state === "PaidLate";
    if (inEligibleUniverse && isPositive(amount)) grossEligible = addMoney(grossEligible, amount);

    switch (state) {
      case "Unpaid":
        observedUnpaid = addMoney(observedUnpaid, amount);
        break;
      case "PartiallyPaid": {
        const paid = c.monetaryEvent.paidAmount ?? zeroMoney(cur);
        partialOutstanding = addMoney(partialOutstanding, clampNonNegative(subMoney(amount, paid)));
        break;
      }
      case "Cancelled":
      case "Refunded":
        excludedValue = addMoney(excludedValue, amount);
        break;
      case "Unknown":
        unknownValue = addMoney(unknownValue, amount);
        break;
      // NotYetDue / PaidOnTime / PaidLate contribute no unpaid value.
      default:
        break;
    }
  }

  return Object.freeze({
    currency: cur,
    stalledCount: stalled.length,
    grossEligible,
    observedUnpaid,
    partialOutstanding,
    excludedValue,
    unknownValue,
    stateCounts: Object.freeze(stateCounts),
  }) as ObservedSummary;
}
