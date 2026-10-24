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
    key: "OnboardingReboot",
    label: "Onboarding Reboot",
    description:
      "Re-kicked off a stalled onboarding with a fresh plan and owner.",
    appliesTo: "StalledOnboarding",
  },
  {
    key: "MilestoneNudge",
    label: "Milestone Nudge",
    description:
      "Guided the account to the activation milestone it had not reached.",
    appliesTo: "ActivationMissed, NoFirstValue",
  },
  {
    key: "EnablementSession",
    label: "Enablement Session",
    description: "Training/enablement that drove the account to first value.",
    appliesTo: "NoFirstValue, LowAdoption",
  },
  {
    key: "CSMOutreach",
    label: "CSM Outreach",
    description: "CSM reached the customer personally to unblock adoption.",
    appliesTo: "LowAdoption, StalledOnboarding",
  },
  {
    key: "ExecBusinessReview",
    label: "Exec Business Review",
    description: "EBR re-established value before a stalled renewal/expansion.",
    appliesTo: "ExpansionStalled, RenewalAtRisk",
  },
  {
    key: "RenewalOutreach",
    label: "Renewal Outreach",
    description: "Direct outreach that recovered a stalled renewal / 2nd invoice.",
    appliesTo: "RenewalAtRisk",
  },
  {
    key: "UsageActivation",
    label: "Usage Activation",
    description: "Targeted in-product flow that triggered the activation event.",
    appliesTo: "ActivationMissed, LowAdoption",
  },
  {
    key: "BillingCorrection",
    label: "Billing Correction",
    description:
      "A corrective invoice or credit-note reversal was raised by billing and the shortfall was collected. " +
      "A classification of HOW the money came back — the raising of the invoice is not itself a recovery.",
    appliesTo: "RevenueUnderBilled",
  },
];

export function reasonLabel(reason: RecoveryReason): string {
  if (reason === null) return "— (unclassified)";
  return RECOVERY_REASONS.find((r) => r.key === reason)?.label ?? reason;
}

export const ALL_REASON_KEYS = RECOVERY_REASONS.map((r) => r.key);

// ── ENFORCED REASON SCOPE ───────────────────────────────────────────────────────────────────────────
//
// `appliesTo` above is GUIDANCE for the screen. It has never been enforced, which is harmless for a label
// that is merely suggestive and wrong for one whose truth is part of an IMMUTABLE proof: a proof frozen
// with a reason that names a mechanism the case never had is a false statement that cannot be corrected,
// only superseded.
//
// So the scope of ONE reason is enforced, and deliberately only that one. `BillingCorrection` was added
// (2026-10-23) with its scope stated as `RevenueUnderBilled`; enforcing what its own definition says
// changes no existing combination. The other seven reasons keep their historical behaviour — applying a
// rule to them would be a NEW governance rule on existing values, which has an owner and is not taken here.
//
// Fail-closed in both directions: a case whose recovery type is unknown cannot carry an enforced reason
// (absent is not "any"), and matching is exact — no case folding, no trimming.
export const ENFORCED_REASON_SCOPE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  BillingCorrection: Object.freeze(["RevenueUnderBilled"]),
});

/**
 * Returns `null` when the reason may be attached to a case of `recoveryType`, otherwise a refusal message.
 * The message names the reason and the types — never any amount, identifier or case content.
 */
export function reasonScopeViolation(reason: string, recoveryType: string | null): string | null {
  const allowed = Object.prototype.hasOwnProperty.call(ENFORCED_REASON_SCOPE, reason) ? ENFORCED_REASON_SCOPE[reason] : undefined;
  if (allowed === undefined) return null; // not an enforced reason: historical behaviour, unchanged
  if (recoveryType === null) {
    return `reason '${reason}' applies only to ${allowed.join(", ")} cases, and this case has no recorded recovery type`;
  }
  if (!allowed.includes(recoveryType)) {
    return `reason '${reason}' applies only to ${allowed.join(", ")} cases; this case is '${recoveryType}'`;
  }
  return null;
}
