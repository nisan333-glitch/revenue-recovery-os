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
  // --- Fix ---
  /** The recommended play for the largest open problem (null if nothing open). */
  recommendedPlay: NonNullable<RecoveryReason> | null;
  /** Accounts a recovery play has been put in motion on (acted, not just queued). */
  appliedCount: number;
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

// "Applied" = a play was actually put in motion — not merely detected/queued,
// and not dismissed. Recovered and Failed both count as worked.
const APPLIED_STATUSES: readonly string[] = [
  "Assigned",
  "InProgress",
  "Recovered",
  "Failed",
];

/**
 * The complete loop as a single summary. Forecast (opportunity) and proven
 * (returned) are distinct fields; nothing here adds one ledger to the other.
 */
export function recoveryLoop(events: RecoveryEvent[]): RecoveryLoopSummary {
  const m = portfolioMetrics(events);
  const open = events.filter((e) => OPEN_STATUSES.includes(e.status));
  const applied = events.filter((e) => APPLIED_STATUSES.includes(e.status));

  // The dominant play = the recommended play of the biggest LIVE problem.
  const outcomes = outcomesByLeakage(events);
  const topOpen = outcomes.find((o) => o.openCount > 0) ?? outcomes[0];

  return {
    opportunity: events.reduce((sum, e) => sum + e.riskAmount, 0),
    identifiedCount: events.length,
    openCount: open.length,
    recoverableForecast: expectedRecoverable(events),
    recommendedPlay: topOpen ? topOpen.recommendedReason : null,
    appliedCount: applied.length,
    returned: m.recoveredRevenue,
    auditable: m.auditableRevenue,
    provenCount: m.recoveredCount,
    recoveryRate: m.recoveryRate,
  };
}
