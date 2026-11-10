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

// A LEAKAGE TYPE IS ALSO THE CASE'S RECOVERY TYPE, and that is a statement rather than a coincidence.
// The governed server records `RecoveryCaseRecord.recoveryType` as a free-form string and enforces the
// scope of exactly one reason against it (`ENFORCED_REASON_SCOPE`, today `BillingCorrection` →
// `RevenueUnderBilled`). The pure domain had no such concept at all, which is how the client-side
// approve path came to mint proofs no governed route would accept. Rather than invent a SECOND
// vocabulary to carry the same fact — two names for one thing being the defect this slice removes —
// the leakage type IS what is handed to `reasonScopeViolation`. `approval.test.ts` pins that the
// member spellings match the server's enforced values exactly: no case folding, no trimming.
export type LeakageType =
  | "StalledOnboarding"
  | "ActivationMissed"
  | "NoFirstValue"
  | "LowAdoption"
  | "RenewalAtRisk"
  | "ExpansionStalled"
  // Added through the sanctioned extension path (Constitution: *a new workflow = new `LeakageType` +
  // `PLAYBOOK` entry + `RecoveryReason` plays — never a special case carved into the invariants, the
  // ledger, or the proof chain*). It is the one leakage family whose correction mechanism has a
  // declared, source-attested channel, so it is the only one that can reach PROVEN — which is why its
  // absence here meant the domain could not express a provable recovery at all.
  | "RevenueUnderBilled";

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
  | "BillingCorrection"
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
