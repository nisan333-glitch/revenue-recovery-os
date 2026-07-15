// Revenue Recovery OS — domain types.
// This module is PURE and UI-independent. It is the seed of the future
// recovery "engine" that could later run server-side or behind agents.

export type FunnelStage =
  | "Signed"
  | "Onboarding"
  | "Activation"
  | "FirstValue"
  | "Renewal"
  | "Expansion";

export type LeakageType =
  | "StalledOnboarding"
  | "ActivationMissed"
  | "NoFirstValue"
  | "LowAdoption"
  | "RenewalAtRisk"
  | "ExpansionStalled";

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
  | "OnboardingReboot"
  | "MilestoneNudge"
  | "EnablementSession"
  | "CSMOutreach"
  | "ExecBusinessReview"
  | "RenewalOutreach"
  | "UsageActivation"
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
  // --- Trust layer links (optional; ids reference the append-only Baseline/Proof/Evidence
  // stores held alongside events, so RecoveryEvent stays import-free and non-circular). ---
  /** ISO 4217 for this Case's amounts. Defaults to USD when absent (legacy fixtures). */
  currency?: string;
  /** The governed baseline established/locked for this Case (see baseline store). */
  baselineId?: string | null;
  /** System-recorded time the recovery action was taken (for baseline temporal validity). */
  interventionAt?: string | null;
  /** System-recorded time the money outcome was observed (for baseline temporal validity). */
  outcomeObservedAt?: string | null;
  /** The accountable actor id (owner) — distinct from the proof approver. */
  ownerActorId?: string | null;
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
