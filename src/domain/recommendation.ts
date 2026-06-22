// Decision Engine — the recommendation playbook.
//
// This is the FRONT of the loop: Problem → Diagnosis → Recommendation. It is a
// transparent, rule-based playbook keyed by leakageType — NOT a black box. A
// future Learning layer will calibrate these priors from proven outcomes, but
// the math stays explainable so it survives the same scrutiny as the proof.
//
// Constitution: everything here is FORECAST (the Revenue Opportunity ledger).
// expectedValue is what we *expect* to recover, never what we *proved*. It must
// never be summed into recovered/auditable dollars.
import type { LeakageType, RecoveryEvent, RecoveryReason } from "./types";
import { OPEN_STATUSES } from "./types";

export type Effort = "Low" | "Medium" | "High";

export interface PlaybookEntry {
  /** Plain-language diagnosis of why the money is at risk. */
  rootCause: string;
  /** The play we recommend — a canonical recovery reason. */
  recommendedReason: NonNullable<RecoveryReason>;
  /** Concrete next steps the owner should take. */
  recommendedActions: string[];
  /** Prior probability the play works (0..1). Illustrative, explainable. */
  probabilityOfSuccess: number;
  /** Relative cost to execute the play. */
  effort: Effort;
}

// Priors are deliberately conservative and human-readable. The Learning layer
// (Phase 3) will blend these with realized success rates from proven events.
export const PLAYBOOK: Record<LeakageType, PlaybookEntry> = {
  FailedPayment: {
    rootCause: "A charge failed (insufficient funds / bank decline), not a churn decision.",
    recommendedReason: "DunningRetry",
    recommendedActions: [
      "Schedule a smart retry at an optimized time",
      "Prompt the customer to confirm or switch payment method",
    ],
    probabilityOfSuccess: 0.7,
    effort: "Low",
  },
  ExpiredCard: {
    rootCause: "The card on file expired or rotated — collection is blocked by stale credentials.",
    recommendedReason: "CardUpdater",
    recommendedActions: [
      "Run network Account Updater to refresh the card",
      "Auto-charge the refreshed card",
    ],
    probabilityOfSuccess: 0.65,
    effort: "Low",
  },
  FailedRenewal: {
    rootCause: "A renewal stalled — usually inertia or unproven value, not a hard cancel.",
    recommendedReason: "RenewalNudge",
    recommendedActions: [
      "Send a value-based renewal nudge with a usage report",
      "Offer to walk through ROI before the term lapses",
    ],
    probabilityOfSuccess: 0.5,
    effort: "Medium",
  },
  AbandonedCheckout: {
    rootCause: "The customer dropped at the payment step — intent was high, friction won.",
    recommendedReason: "CheckoutRescue",
    recommendedActions: [
      "Trigger the checkout-rescue follow-up flow",
      "Offer a one-click resume link",
    ],
    probabilityOfSuccess: 0.4,
    effort: "Low",
  },
  InvoluntaryChurn: {
    rootCause: "An account is lapsing without an explicit decision — recoverable with a human touch.",
    recommendedReason: "ManualOutreach",
    recommendedActions: [
      "Have the CS/AM owner reach out personally",
      "Confirm intent and remove the blocker to pay",
    ],
    probabilityOfSuccess: 0.45,
    effort: "High",
  },
  Downgrade: {
    rootCause: "The account intends to reduce spend — a retention/save play can hold value.",
    recommendedReason: "DiscountOffer",
    recommendedActions: [
      "Extend a targeted save/loyalty offer",
      "Reframe the tier on the value they actually use",
    ],
    probabilityOfSuccess: 0.5,
    effort: "Medium",
  },
  BillingError: {
    rootCause: "A billing/config error blocks an invoice the customer is willing to pay.",
    recommendedReason: "BillingFix",
    recommendedActions: [
      "Diagnose the misconfiguration (tax rule, plan mapping)",
      "Correct it and re-issue the invoice",
    ],
    probabilityOfSuccess: 0.8,
    effort: "Medium",
  },
};

export interface Recommendation {
  rootCause: string;
  recommendedReason: NonNullable<RecoveryReason>;
  recommendedActions: string[];
  /** riskAmount − baselineAmount: the uplift available over the counterfactual. */
  expectedImpact: number;
  probabilityOfSuccess: number;
  effort: Effort;
  /** expectedImpact × probabilityOfSuccess. FORECAST — never proven money. */
  expectedValue: number;
}

/** The recoverable uplift if the play fully succeeds (clamped ≥ 0). */
export function expectedImpact(e: RecoveryEvent): number {
  return Math.max(0, e.riskAmount - e.baselineAmount);
}

/** The Decision Engine's recommendation for a single event. Pure, explainable. */
export function recommend(e: RecoveryEvent): Recommendation {
  const play = PLAYBOOK[e.leakageType];
  const impact = expectedImpact(e);
  return {
    rootCause: play.rootCause,
    recommendedReason: play.recommendedReason,
    recommendedActions: play.recommendedActions,
    expectedImpact: impact,
    probabilityOfSuccess: play.probabilityOfSuccess,
    effort: play.effort,
    expectedValue: Math.round(impact * play.probabilityOfSuccess),
  };
}

/**
 * Σ expectedValue over OPEN events — the portfolio forecast of what is
 * recoverable if we work the queue. Opportunity ledger; never proven revenue.
 */
export function expectedRecoverable(events: RecoveryEvent[]): number {
  return events
    .filter((e) => OPEN_STATUSES.includes(e.status))
    .reduce((sum, e) => sum + recommend(e).expectedValue, 0);
}
