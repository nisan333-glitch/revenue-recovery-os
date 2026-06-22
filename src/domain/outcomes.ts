// Outcomes — roll events up into business PROBLEMS (the CEO-facing surface).
//
// A CEO wakes up with a problem ("renewals are leaking"), not a list of events.
// This groups the portfolio by leakageType and, for each problem, reports the
// three things that must never blend:
//   - atRisk / recoverable  → Revenue Opportunity ledger (FORECAST)
//   - recovered / auditable → Revenue Returned ledger   (PROVEN)
//
// The disjointness is the product's whole credibility, so it is asserted in
// tests: recoverable (forecast) is never mixed into recovered (proven).
import type { LeakageType, RecoveryEvent, RecoveryReason } from "./types";
import { OPEN_STATUSES } from "./types";
import { isAuditable, isCounted, reportableReturned } from "./invariants";
import { PLAYBOOK, recommend } from "./recommendation";

export interface Outcome {
  leakageType: LeakageType;
  // --- Revenue Opportunity (forecast — never counted as money) ---
  /** Open dollars at risk for this problem. */
  atRisk: number;
  /** Σ expectedValue over open events — what we forecast we can recover. */
  recoverable: number;
  openCount: number;
  // --- Revenue Returned (proven) ---
  /** Counted recovered revenue for this problem. */
  recovered: number;
  /** CFO-auditable subset of recovered. */
  auditable: number;
  recoveredCount: number;
  // --- Decision Engine guidance ---
  rootCause: string;
  recommendedReason: NonNullable<RecoveryReason>;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Group the portfolio into business problems, biggest open exposure first. */
export function outcomesByLeakage(events: RecoveryEvent[]): Outcome[] {
  const groups = new Map<LeakageType, RecoveryEvent[]>();
  for (const e of events) {
    const arr = groups.get(e.leakageType) ?? [];
    arr.push(e);
    groups.set(e.leakageType, arr);
  }

  const outcomes: Outcome[] = [...groups.entries()].map(([leakageType, es]) => {
    const open = es.filter((e) => OPEN_STATUSES.includes(e.status));
    const counted = es.filter(isCounted);
    const play = PLAYBOOK[leakageType];
    return {
      leakageType,
      atRisk: sum(open.map((e) => e.riskAmount)),
      recoverable: sum(open.map((e) => recommend(e).expectedValue)),
      openCount: open.length,
      recovered: sum(counted.map(reportableReturned)),
      auditable: sum(es.filter(isAuditable).map(reportableReturned)),
      recoveredCount: counted.length,
      rootCause: play.rootCause,
      recommendedReason: play.recommendedReason,
    };
  });

  // Surface the largest live problem first (open exposure), then proven scale.
  return outcomes.sort(
    (a, b) => b.atRisk + b.recoverable - (a.atRisk + a.recoverable) || b.recovered - a.recovered,
  );
}
