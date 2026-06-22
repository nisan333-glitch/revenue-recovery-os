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
];

export function reasonLabel(reason: RecoveryReason): string {
  if (reason === null) return "— (unclassified)";
  return RECOVERY_REASONS.find((r) => r.key === reason)?.label ?? reason;
}

export const ALL_REASON_KEYS = RECOVERY_REASONS.map((r) => r.key);
