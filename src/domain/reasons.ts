// Recovery Reasons — the canonical taxonomy.
// A recovery dollar is only counted when it is attributed to one of these.
import type { RecoveryReason } from "./types";

export interface ReasonDef {
  key: NonNullable<RecoveryReason>;
  label: string;
  description: string;
  /** Typical leakage this reason addresses (for guidance/UX). */
  appliesTo: string;
}

export const RECOVERY_REASONS: ReasonDef[] = [
  {
    key: "DunningRetry",
    label: "Dunning Retry",
    description:
      "Automated smart retry of a failed charge at an optimized time/path.",
    appliesTo: "FailedPayment, FailedRenewal",
  },
  {
    key: "CardUpdater",
    label: "Card Updater",
    description:
      "Network account updater refreshed an expired/changed card before retry.",
    appliesTo: "ExpiredCard, FailedPayment",
  },
  {
    key: "PaymentMethodSwitch",
    label: "Payment Method Switch",
    description: "Customer moved to a working payment method after prompting.",
    appliesTo: "FailedPayment, ExpiredCard",
  },
  {
    key: "ManualOutreach",
    label: "Manual Outreach",
    description: "Human (CS/AM) contacted the customer and secured payment.",
    appliesTo: "InvoluntaryChurn, FailedRenewal",
  },
  {
    key: "RenewalNudge",
    label: "Renewal Nudge",
    description: "Targeted reminder/offer that triggered a stalled renewal.",
    appliesTo: "FailedRenewal, InvoluntaryChurn",
  },
  {
    key: "DiscountOffer",
    label: "Discount / Save Offer",
    description: "Retention offer recovered a downgrading or churning account.",
    appliesTo: "Downgrade, InvoluntaryChurn",
  },
  {
    key: "BillingFix",
    label: "Billing Fix",
    description: "Corrected a billing/config error that blocked collection.",
    appliesTo: "BillingError",
  },
  {
    key: "CheckoutRescue",
    label: "Checkout Rescue",
    description: "Recovered an abandoned checkout via follow-up flow.",
    appliesTo: "AbandonedCheckout",
  },
];

export function reasonLabel(reason: RecoveryReason): string {
  if (reason === null) return "— (unclassified)";
  return RECOVERY_REASONS.find((r) => r.key === reason)?.label ?? reason;
}

export const ALL_REASON_KEYS = RECOVERY_REASONS.map((r) => r.key);
