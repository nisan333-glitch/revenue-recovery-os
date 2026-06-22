// Recovery Reconciliation — the waterfall from gross recovered dollars down to
// CFO-auditable revenue, with every excluded dollar explained.
//
// The thesis in one place: "We do not count money we cannot explain."
// Gross Recovered  − Unclassified  = Counted Recovered
// Counted Recovered − (Missing Proof + Double Claim + Low Confidence) = Auditable
import type { RecoveryEvent } from "./types";
import { PROOF_THRESHOLD } from "./confidence";
import { isAuditable, reportableReturned } from "./invariants";

// Why a recovered dollar is held back from the CFO-auditable total.
// Ordered by priority — each excluded event is assigned exactly one reason,
// so the buckets are disjoint and sum exactly to the gap.
export type ExclusionReason =
  | "Unclassified" // no recovery reason — cannot be attributed
  | "DoubleClaim" // already credited elsewhere (dedupe) — future flag
  | "MissingProof" // no evidence captured
  | "LowConfidence"; // below proof-grade threshold

export const EXCLUSION_ORDER: ExclusionReason[] = [
  "Unclassified",
  "DoubleClaim",
  "MissingProof",
  "LowConfidence",
];

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  Unclassified: "Unclassified (no reason)",
  DoubleClaim: "Double Claim (deduped)",
  MissingProof: "Missing Proof (no evidence)",
  LowConfidence: "Low Confidence (below threshold)",
};

/** Is this event part of the recovered-dollar universe at all? */
function isRecoveredWithUplift(e: RecoveryEvent): boolean {
  return e.status === "Recovered" && reportableReturned(e) > 0;
}

/**
 * Assign a single exclusion reason to a recovered event that is NOT auditable.
 * Returns null if the event is auditable (nothing excluded).
 */
export function classifyExclusion(e: RecoveryEvent): ExclusionReason | null {
  if (!isRecoveredWithUplift(e)) return null;
  if (isAuditable(e)) return null;
  if (e.recoveryReason === null) return "Unclassified";
  // DoubleClaim would be set by a future dedupe flag; none in the model yet.
  if (e.evidenceNotes.trim().length < 10) return "MissingProof";
  if (e.confidence < PROOF_THRESHOLD) return "LowConfidence";
  return "MissingProof"; // safety net: excluded but no other reason fits
}

export interface ExclusionBucket {
  reason: ExclusionReason;
  label: string;
  amount: number;
  count: number;
}

export interface Reconciliation {
  /** Detected opportunity (open risk) — context, not part of the waterfall. */
  detectedOpportunity: number;
  /** All positive uplift on Recovered-status events, before any exclusion. */
  grossRecovered: number;
  /** Gross minus Unclassified — matches the product's "Recovered Revenue". */
  countedRecovered: number;
  /** The CFO number: counted minus proof exclusions. */
  auditableRevenue: number;
  /** Total held back from auditable (grossRecovered − auditableRevenue). */
  excludedTotal: number;
  /** Disjoint breakdown; always sums to excludedTotal. */
  buckets: ExclusionBucket[];
  /** Recovered − Auditable: the gap a CFO asks about. */
  recoveredToAuditableGap: number;
}

export function reconcile(events: RecoveryEvent[]): Reconciliation {
  const open = events.filter(
    (e) =>
      e.status === "Detected" ||
      e.status === "Queued" ||
      e.status === "Assigned" ||
      e.status === "InProgress",
  );
  const detectedOpportunity = open.reduce((s, e) => s + e.riskAmount, 0);

  const recovered = events.filter(isRecoveredWithUplift);
  const grossRecovered = recovered.reduce((s, e) => s + reportableReturned(e), 0);
  const auditableRevenue = events
    .filter(isAuditable)
    .reduce((s, e) => s + reportableReturned(e), 0);

  // Build disjoint exclusion buckets.
  const byReason = new Map<ExclusionReason, { amount: number; count: number }>();
  for (const r of EXCLUSION_ORDER) byReason.set(r, { amount: 0, count: 0 });
  let unclassifiedAmount = 0;
  for (const e of recovered) {
    const reason = classifyExclusion(e);
    if (!reason) continue;
    const cell = byReason.get(reason)!;
    cell.amount += reportableReturned(e);
    cell.count += 1;
    if (reason === "Unclassified") unclassifiedAmount += reportableReturned(e);
  }

  const buckets: ExclusionBucket[] = EXCLUSION_ORDER.map((reason) => ({
    reason,
    label: EXCLUSION_LABELS[reason],
    amount: byReason.get(reason)!.amount,
    count: byReason.get(reason)!.count,
  }));

  const excludedTotal = buckets.reduce((s, b) => s + b.amount, 0);
  const countedRecovered = grossRecovered - unclassifiedAmount;

  return {
    detectedOpportunity,
    grossRecovered,
    countedRecovered,
    auditableRevenue,
    excludedTotal,
    buckets,
    recoveredToAuditableGap: countedRecovered - auditableRevenue,
  };
}
