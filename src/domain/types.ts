// Revenue Recovery OS — domain types.
// This module is PURE and UI-independent. It is the seed of the future
// recovery "engine" that could later run server-side or behind agents.

export type FunnelStage =
  | "Lead"
  | "Trial"
  | "Checkout"
  | "Onboarding"
  | "Renewal"
  | "Expansion";

export type LeakageType =
  | "FailedPayment"
  | "InvoluntaryChurn"
  | "AbandonedCheckout"
  | "ExpiredCard"
  | "FailedRenewal"
  | "Downgrade"
  | "BillingError";

// Lifecycle of a recovery event: Detect -> Queue -> Assign -> Fix -> Prove.
export type RecoveryStatus =
  | "Detected"
  | "Queued"
  | "Assigned"
  | "InProgress"
  | "Recovered"
  | "Failed"
  | "Dismissed";

// Canonical recovery reasons live in reasons.ts. Nullable on purpose:
// an event without a reason is NOT counted as proven recovery.
export type RecoveryReason =
  | "DunningRetry"
  | "CardUpdater"
  | "ManualOutreach"
  | "DiscountOffer"
  | "BillingFix"
  | "PaymentMethodSwitch"
  | "RenewalNudge"
  | "CheckoutRescue"
  | null;

export interface AuditEntry {
  id: string;
  at: string; // ISO timestamp
  actor: string; // who performed the change
  type:
    | "created"
    | "assigned"
    | "status_changed"
    | "action_added"
    | "reason_set"
    | "amounts_updated"
    | "evidence_updated";
  summary: string;
  before?: string;
  after?: string;
}

export interface RecoveryEvent {
  eventId: string;
  customer: string;
  funnelStage: FunnelStage;
  leakageType: LeakageType;
  recoveryReason: RecoveryReason;
  owner: string | null;
  status: RecoveryStatus;
  /** Detected dollars at risk (the opportunity). */
  riskAmount: number;
  /** What we would have collected WITHOUT intervention (the counterfactual). */
  baselineAmount: number;
  /** What was actually collected after intervention. */
  collectedAmount: number;
  /** ALWAYS computed = collectedAmount - baselineAmount. Never user-set. */
  revenueReturned: number;
  /** 0-100 confidence the recovery is real and correctly attributed. */
  confidence: number;
  actionsTaken: string[];
  evidenceNotes: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  audit: AuditEntry[];
}

// Open (still actionable) statuses vs terminal statuses.
export const OPEN_STATUSES: RecoveryStatus[] = [
  "Detected",
  "Queued",
  "Assigned",
  "InProgress",
];

export const TERMINAL_STATUSES: RecoveryStatus[] = [
  "Recovered",
  "Failed",
  "Dismissed",
];
