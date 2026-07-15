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
import { provenLedger } from "./provenLedger";
import type { Money } from "./money";
import type { Proof } from "./proof";

export interface RecoveryLoopSummary {
  // --- Identify (Revenue Opportunity ledger — FORECAST / PROVISIONAL, Case-derived) ---
  // These are forecast/operational numbers derived from mutable Cases. They are NEVER money and
  // are reported separately from the proven ledger below.
  /** PROVISIONAL. Open dollars still at risk right now — the live exposure ("money at risk"). */
  moneyAtRisk: number;
  /** PROVISIONAL. Σ riskAmount over every account we identified at risk — total surfaced to date. */
  opportunity: number;
  /** Accounts identified at risk. */
  identifiedCount: number;
  /** Still open (not yet resolved). */
  openCount: number;
  /** PROVISIONAL forecast. Σ expectedValue over open events — what we forecast we can recover. */
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
  // --- Prove (Revenue Returned ledger — PROVEN, from IMMUTABLE APPROVED PROOFS ONLY) ---
  // These come only from approved effective Proof chains (provenLedger). They are Money (exact
  // minor units) and are NEVER recomputed from mutable Cases — marking a Case Recovered does not
  // move them; approving a Proof does.
  /** PROOF-DERIVED. Proven recovered revenue = Σ effective, non-reversed proofs. */
  returned: Money;
  /** PROOF-DERIVED. CFO-auditable subset (stamped confidence ≥ stamped threshold, positive uplift). */
  auditable: Money;
  /** PROOF-DERIVED. Number of proven (effective, non-reversed) proofs. */
  provenCount: number;
  /** PROOF-DERIVED. Number of CFO-auditable proofs. */
  auditableCount: number;
  /** OPERATIONAL. Recovered / (recovered + failed) — a Case-lifecycle rate, not a money value. */
  recoveryRate: number;
}

/**
 * The complete loop as a single summary. Forecast/provisional (Case-derived) and proven
 * (Proof-derived) are distinct fields; nothing here adds one ledger to the other. Proven money
 * (`returned`/`auditable`) is read ONLY from approved Proofs via `provenLedger` — never from
 * mutable Cases. The middle of the loop reports only observable states ("action taken").
 */
export function recoveryLoop(
  events: RecoveryEvent[],
  proofs: Proof[],
  currency = "USD",
): RecoveryLoopSummary {
  const m = portfolioMetrics(events);
  const pl = provenLedger(proofs, currency); // proven/auditable from immutable Proofs only
  const open = events.filter((e) => OPEN_STATUSES.includes(e.status));
  // Observable + auditable: an action was logged on the account.
  const actioned = events.filter((e) => e.actionsTaken.length > 0);

  // The dominant play = the recommended play of the biggest LIVE problem.
  const outcomes = outcomesByLeakage(events);
  const topOpen = outcomes.find((o) => o.openCount > 0) ?? outcomes[0];

  return {
    moneyAtRisk: m.detectedOpportunity,
    opportunity: events.reduce((sum, e) => sum + e.riskAmount, 0),
    identifiedCount: events.length,
    openCount: open.length,
    recoverableForecast: expectedRecoverable(events),
    recommendedPlay: topOpen ? topOpen.recommendedReason : null,
    actionTakenCount: actioned.length,
    returned: pl.revenueReturned, // PROOF-DERIVED
    auditable: pl.auditableRevenue, // PROOF-DERIVED
    provenCount: pl.provenCount, // PROOF-DERIVED
    auditableCount: pl.auditableCount, // PROOF-DERIVED
    recoveryRate: m.recoveryRate,
  };
}
