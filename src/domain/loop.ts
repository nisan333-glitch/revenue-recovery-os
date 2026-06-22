// Recovery Loop — the whole story as one number set, read top-down by the
// customer: Opportunity (found) → Recovery (applied) → Proof (returned).
//
// This is the BUSINESS-VALUE surface. It only composes existing pure helpers
// (metrics, recommendation, outcomes) — it never re-derives money. The two
// ledgers stay separate by construction: `opportunity`/`recoverableForecast`
// are FORECAST (Revenue Opportunity); `returned`/`auditable` are PROVEN
// (Revenue Returned). They are reported as distinct rungs, never summed.
import type { RecoveryEvent, RecoveryReason } from "./types";
import { OPEN_STATUSES } from "./types";
import { portfolioMetrics } from "./metrics";
import { expectedRecoverable } from "./recommendation";
import { outcomesByLeakage } from "./outcomes";

export interface RecoveryLoopSummary {
  // --- Identify (Revenue Opportunity ledger — FORECAST, never counted as money) ---
  /** Σ riskAmount over every account we identified at risk — "money found". */
  opportunity: number;
  /** Accounts identified at risk. */
  identifiedCount: number;
  /** Still open (not yet resolved). */
  openCount: number;
  /** Σ expectedValue over open events — the forecast of what we can recover. */
  recoverableForecast: number;
  // --- Act (the honest bridge to proof — only objectively observable states) ---
  /** The recommended play for the largest open problem (advice, not a state). */
  recommendedPlay: NonNullable<RecoveryReason> | null;
  /**
   * Accounts where a recovery action was actually logged (actionsTaken > 0).
   * This is observable and auditable — NOT a claim that the problem was "fixed".
   * We display "Action Taken", never "Fixed", until execution is fully modeled.
   */
  actionTakenCount: number;
  // --- Prove (Revenue Returned ledger — PROVEN, realized cash) ---
  /** Proven, counted recovered revenue. */
  returned: number;
  /** CFO-auditable subset of returned (proof-grade). */
  auditable: number;
  /** Number of proven recoveries. */
  provenCount: number;
  /** Recovered / (recovered + failed). */
  recoveryRate: number;
}

/**
 * The complete loop as a single summary. Forecast (opportunity) and proven
 * (returned) are distinct fields; nothing here adds one ledger to the other.
 * The middle of the loop reports only observable states ("action taken"), never
 * an unprovable claim that a problem was "fixed".
 */
export function recoveryLoop(events: RecoveryEvent[]): RecoveryLoopSummary {
  const m = portfolioMetrics(events);
  const open = events.filter((e) => OPEN_STATUSES.includes(e.status));
  // Observable + auditable: an action was logged on the account.
  const actioned = events.filter((e) => e.actionsTaken.length > 0);

  // The dominant play = the recommended play of the biggest LIVE problem.
  const outcomes = outcomesByLeakage(events);
  const topOpen = outcomes.find((o) => o.openCount > 0) ?? outcomes[0];

  return {
    opportunity: events.reduce((sum, e) => sum + e.riskAmount, 0),
    identifiedCount: events.length,
    openCount: open.length,
    recoverableForecast: expectedRecoverable(events),
    recommendedPlay: topOpen ? topOpen.recommendedReason : null,
    actionTakenCount: actioned.length,
    returned: m.recoveredRevenue,
    auditable: m.auditableRevenue,
    provenCount: m.recoveredCount,
    recoveryRate: m.recoveryRate,
  };
}
