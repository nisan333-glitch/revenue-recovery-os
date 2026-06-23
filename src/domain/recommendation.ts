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

// A PlaybookEntry is the RecoveryType Definition (the template / governed unit) for
// one LeakageType. It owns *when* a Case opens (creationRule), *whether it is worth
// opening* (economicThreshold), *how it proves out* (expectedProofEvent), *what to
// do* (recommendedReason = the defaultPlay), and the forecast priors. A new recovery
// workflow ships as one entry here — never a change to the Case schema or invariants.
// See docs/RECOVERY_CASE.md (§3a). All of this is FORECAST/metadata; none of it is
// proven money.
export interface PlaybookEntry {
  /** Plain-language diagnosis of why the money is at risk. */
  rootCause: string;
  /**
   * The concrete trigger that mints a Case of this type — the operational form of
   * admission criterion 1's "measurable risk". Lives on the type, never copied onto
   * each Case; the Case's evidence records that the rule fired.
   */
  creationRule: string;
  /**
   * Materiality floor: the minimum dollars at risk that justify opening a Case of
   * this type. Refines admission criterion 1 to `amountAtRisk ≥ economicThreshold`
   * (you open a Case on $70k, not $7). Metadata for now — read by the future
   * `canBeCase` gate, NOT by recommend(). Values here are illustrative defaults.
   */
  economicThreshold: number;
  /**
   * The concrete future money event that will confirm recovery (admission
   * criterion 3 made explicit) — e.g. "second invoice paid". Lives on the type.
   */
  expectedProofEvent: string;
  /**
   * The play we recommend — a canonical recovery reason. This IS the type's
   * `defaultPlay` (the Case's applied `recoveryReason` defaults from it). Kept as
   * `recommendedReason` to avoid churning recommend() and its tests.
   */
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
  StalledOnboarding: {
    rootCause: "Onboarding stalled after signature — kickoff/setup never progressed.",
    creationRule: "Signed but onboarding has not progressed past kickoff after X days.",
    economicThreshold: 5000,
    expectedProofEvent: "Onboarding milestone reached and the account resumes setup.",
    recommendedReason: "OnboardingReboot",
    recommendedActions: [
      "Re-kick off with a fresh onboarding plan and a named owner",
      "Book the first setup milestone within 7 days",
    ],
    probabilityOfSuccess: 0.65,
    effort: "Medium",
  },
  ActivationMissed: {
    rootCause: "The account never reached its activation milestone (the 'aha') by day N.",
    creationRule: "Signed but not activated after X days.",
    economicThreshold: 5000,
    expectedProofEvent: "Activation milestone reached and the second invoice is paid.",
    recommendedReason: "MilestoneNudge",
    recommendedActions: [
      "Guide the account to the specific activation milestone",
      "Trigger the in-product activation flow",
    ],
    probabilityOfSuccess: 0.55,
    effort: "Low",
  },
  NoFirstValue: {
    rootCause: "Technically live, but the account has not yet reached first value.",
    creationRule: "Live but no first-value event recorded after X days.",
    economicThreshold: 5000,
    expectedProofEvent: "First value event recorded and usage begins.",
    recommendedReason: "EnablementSession",
    recommendedActions: [
      "Run a focused enablement/training session",
      "Map the fastest path to a first value event",
    ],
    probabilityOfSuccess: 0.5,
    effort: "Medium",
  },
  LowAdoption: {
    rootCause: "Weak usage is putting the next invoice at risk — adoption never took hold.",
    creationRule: "Usage below the adoption threshold for X consecutive days.",
    economicThreshold: 5000,
    expectedProofEvent: "Adoption recovers and the next invoice is paid.",
    recommendedReason: "CSMOutreach",
    recommendedActions: [
      "Have the CSM reach out personally to unblock adoption",
      "Identify and remove the top usage blocker",
    ],
    probabilityOfSuccess: 0.45,
    effort: "High",
  },
  RenewalAtRisk: {
    rootCause: "The renewal / second invoice has stalled — inertia or unproven value.",
    creationRule: "Renewal at risk within X days of the term end with no commitment.",
    economicThreshold: 10000,
    expectedProofEvent: "Renewal booked / second invoice paid before the term lapses.",
    recommendedReason: "RenewalOutreach",
    recommendedActions: [
      "Direct renewal outreach with a value/usage recap",
      "Confirm the second invoice before the term lapses",
    ],
    probabilityOfSuccess: 0.6,
    effort: "Medium",
  },
  ExpansionStalled: {
    rootCause: "An expansion opportunity stalled — value not re-established with the buyer.",
    creationRule: "Expansion opportunity stalled with no movement for X days.",
    economicThreshold: 10000,
    expectedProofEvent: "Expansion order signed and invoiced.",
    recommendedReason: "ExecBusinessReview",
    recommendedActions: [
      "Run an executive business review tying usage to ROI",
      "Re-open the expansion with a quantified case",
    ],
    probabilityOfSuccess: 0.4,
    effort: "High",
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
