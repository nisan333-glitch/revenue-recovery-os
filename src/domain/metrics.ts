// Metrics — aggregates over events. Pure functions; the dashboard and CFO
// view read from here so the "detected vs proven" separation is computed once.
import type { RecoveryEvent, FunnelStage, RecoveryReason } from "./types";
import { OPEN_STATUSES } from "./types";
import {
  isAuditable,
  isCounted,
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
  /** Recovered count / (recovered + failed) — a true recovery rate. */
  recoveryRate: number;
  totalEvents: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function portfolioMetrics(events: RecoveryEvent[]): PortfolioMetrics {
  const open = events.filter((e) => OPEN_STATUSES.includes(e.status));
  const counted = events.filter(isCounted);
  const auditable = events.filter(isAuditable);
  const unproven = events.filter(isUnprovenRecovery);
  const failed = events.filter((e) => e.status === "Failed");

  const recoveredCount = counted.length;
  const denom = recoveredCount + failed.length;

  return {
    detectedOpportunity: sum(open.map((e) => e.riskAmount)),
    detectedCount: open.length,
    recoveredRevenue: sum(counted.map(reportableReturned)),
    recoveredCount,
    auditableRevenue: sum(auditable.map(reportableReturned)),
    auditableCount: auditable.length,
    unprovenRevenue: sum(unproven.map(reportableReturned)),
    unprovenCount: unproven.length,
    recoveryRate: denom === 0 ? 0 : recoveredCount / denom,
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
