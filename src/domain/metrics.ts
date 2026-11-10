// Metrics — aggregates over events. Pure functions; the dashboard and CFO
// view read from here so the "detected vs proven" separation is computed once.
import type { RecoveryEvent, FunnelStage, RecoveryReason } from "./types";
import { OPEN_STATUSES } from "./types";
import {
  isAuditable,
  isClassifiedRecovery,
  isCounted,
  isProofRefusedRecovery,
  isUnprovenRecovery,
  reportableReturned,
} from "./invariants";

export interface PortfolioMetrics {
  /** Detected opportunity: riskAmount of still-open events. */
  detectedOpportunity: number;
  detectedCount: number;
  /** Proven recovered revenue: reportable return of COUNTED events. */
  recoveredRevenue: number;
  recoveredCount: number;
  /** Subset of recovered that is CFO-auditable (proof-grade). */
  auditableRevenue: number;
  auditableCount: number;
  /** Counted but not yet proof-grade. */
  unprovenRevenue: number;
  unprovenCount: number;
  /**
   * DETECTED AND REFUSED: cases where money was collected and the mechanism has no declared
   * correction channel, so no proof can exist. Reported apart from every other figure because it is
   * neither opportunity (it is not a forecast) nor recovered revenue (it is not proven), and folding
   * it into either would be the blend the constitution forbids.
   *
   * The figure is COLLECTED, never `collected − baseline`: the delta in the same units reads as
   * Revenue Returned whatever it is labelled.
   */
  proofRefusedCollected: number;
  proofRefusedCount: number;
  /**
   * Recovered count / (recovered + failed) — a true recovery rate.
   *
   * Counts CLASSIFIED recoveries, provable or not. A case whose mechanism cannot be attested still
   * recovered the money; calling it a non-recovery would answer a question nobody asked and would put
   * this portfolio's rate at 0.5 instead of 0.875 on the strength of a PROOF limitation.
   */
  recoveryRate: number;
  totalEvents: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function portfolioMetrics(events: RecoveryEvent[]): PortfolioMetrics {
  const open = events.filter((e) => OPEN_STATUSES.includes(e.status));
  const counted = events.filter(isCounted);
  const auditable = events.filter(isAuditable);
  const unproven = events.filter(isUnprovenRecovery);
  const refused = events.filter(isProofRefusedRecovery);
  const failed = events.filter((e) => e.status === "Failed");

  const recoveredCount = counted.length;
  // The rate's numerator is the operational one, not the monetary one — see the field's note.
  const classified = events.filter(isClassifiedRecovery);
  const denom = classified.length + failed.length;

  return {
    detectedOpportunity: sum(open.map((e) => e.riskAmount)),
    detectedCount: open.length,
    recoveredRevenue: sum(counted.map(reportableReturned)),
    recoveredCount,
    auditableRevenue: sum(auditable.map(reportableReturned)),
    auditableCount: auditable.length,
    unprovenRevenue: sum(unproven.map(reportableReturned)),
    unprovenCount: unproven.length,
    proofRefusedCollected: sum(refused.map((e) => e.collectedAmount)),
    proofRefusedCount: refused.length,
    recoveryRate: denom === 0 ? 0 : classified.length / denom,
    totalEvents: events.length,
  };
}

export interface Bucket {
  key: string;
  count: number;
  recovered: number;
  auditable: number;
}

export function byStage(events: RecoveryEvent[]): Bucket[] {
  const stages: FunnelStage[] = [
    "Signed",
    "Onboarding",
    "Activation",
    "FirstValue",
    "Renewal",
    "Expansion",
  ];
  return stages
    .map((stage) => bucket(stage, events.filter((e) => e.funnelStage === stage)))
    .filter((b) => b.count > 0);
}

export function byReason(events: RecoveryEvent[]): Bucket[] {
  const map = new Map<string, RecoveryEvent[]>();
  for (const e of events) {
    const key = e.recoveryReason ?? "Unclassified";
    const arr = map.get(key) ?? [];
    arr.push(e);
    map.set(key, arr);
  }
  return [...map.entries()]
    .map(([key, es]) => bucket(key, es))
    .sort((a, b) => b.recovered - a.recovered);
}

export interface OwnerBucket extends Bucket {
  avgConfidence: number;
}

export function byOwner(events: RecoveryEvent[]): OwnerBucket[] {
  const map = new Map<string, RecoveryEvent[]>();
  for (const e of events) {
    const key = e.owner ?? "Unassigned";
    const arr = map.get(key) ?? [];
    arr.push(e);
    map.set(key, arr);
  }
  return [...map.entries()]
    .map(([key, es]) => {
      const b = bucket(key, es);
      const conf = es.length ? sum(es.map((e) => e.confidence)) / es.length : 0;
      return { ...b, avgConfidence: Math.round(conf) };
    })
    .sort((a, b) => b.recovered - a.recovered);
}

function bucket(key: string, es: RecoveryEvent[]): Bucket {
  return {
    key,
    count: es.length,
    recovered: sum(es.filter(isCounted).map(reportableReturned)),
    auditable: sum(es.filter(isAuditable).map(reportableReturned)),
  };
}

/** Cumulative recovered revenue over time (for the trend sparkline). */
export function recoveredTrend(events: RecoveryEvent[], points = 12): number[] {
  const counted = events
    .filter(isCounted)
    .slice()
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  if (counted.length === 0) return new Array(points).fill(0);

  const series: number[] = [];
  let running = 0;
  const step = Math.max(1, Math.ceil(counted.length / points));
  for (let i = 0; i < counted.length; i++) {
    running += reportableReturned(counted[i]!);
    if (i % step === 0) series.push(running);
  }
  if (series[series.length - 1] !== running) series.push(running);
  return series;
}

export type { RecoveryReason };
