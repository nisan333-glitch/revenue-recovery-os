// Payment-state classification, strictly as-of the analysis cut-off (asOf). No row is classified
// using information after asOf: an observation or payment recorded after asOf is treated as NOT YET
// known — a payment after the cut-off is therefore "Unpaid at asOf" (a later, separate assessment
// with a later asOf may reclassify it).
import type { ExpectationCycle, PaymentState } from "./types";
import { isAfter } from "./dateNormalize";
import { isPositive } from "../domain/money";

/**
 * Effective (as-of asOf) settling time: a payment recorded strictly after asOf is invisible.
 * Returns null when there is no payment observable by asOf.
 */
function effectivePaidAt(cycle: ExpectationCycle, asOf: string): string | null {
  const p = cycle.monetaryEvent.paidAt;
  if (p === null) return null;
  return isAfter(p, asOf) ? null : p; // paid after cut-off ⇒ not observed yet
}

export function classifyPayment(cycle: ExpectationCycle, asOf: string): PaymentState {
  const ev = cycle.monetaryEvent;

  // Terminal states independent of timing.
  if (ev.cancelled) return "Cancelled";
  if (ev.refunded) return "Refunded";

  // A non-positive obligation cannot be an "unpaid" amount — surfaced separately as Unknown here;
  // zero/negative amounts are excluded upstream at the adapter, so this is a defensive fallback.
  if (!isPositive(ev.amount)) return "Unknown";

  // Not yet due as-of asOf ⇒ cannot be unpaid.
  if (isAfter(ev.dueAt, asOf)) return "NotYetDue";

  const paidAt = effectivePaidAt(cycle, asOf);
  if (paidAt === null) {
    // A settled amount is evidenced but its timing cannot be placed as-of (no observable payment date):
    // it is therefore NOT a confident Unpaid. Surface it as Unknown (visible bucket) rather than count
    // its full value in the beneficiary-favorable Observed Unpaid headline. Zero-guess: we never infer
    // when the payment happened. Nothing settled at all ⇒ genuinely Unpaid.
    if (cycle.monetaryEvent.paidAmount !== null && cycle.monetaryEvent.paidAmount.minor > 0) return "Unknown";
    return "Unpaid"; // due on/before asOf, nothing settled by asOf
  }

  // A settling payment is observed by asOf.
  if (ev.paidAmount !== null && ev.paidAmount.minor < ev.amount.minor) return "PartiallyPaid";
  return isAfter(paidAt, ev.dueAt) ? "PaidLate" : "PaidOnTime";
}

/** Only fully-Unpaid, eligible obligations may enter the Observed Unpaid headline. */
export function isEligibleUnpaid(state: PaymentState): boolean {
  return state === "Unpaid";
}
