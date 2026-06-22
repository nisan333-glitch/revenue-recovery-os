// Confidence Score model + thresholds.
// Confidence is what separates "we think we recovered this" from
// "a CFO can sign off on this". The model is intentionally transparent.
import type { RecoveryEvent } from "./types";

export type ConfidenceBand = "Low" | "Medium" | "High";

/** Events at or above this confidence are eligible for the CFO proof ledger. */
export const PROOF_THRESHOLD = 80;
export const MEDIUM_THRESHOLD = 50;

export function bandOf(confidence: number): ConfidenceBand {
  if (confidence >= PROOF_THRESHOLD) return "High";
  if (confidence >= MEDIUM_THRESHOLD) return "Medium";
  return "Low";
}

export interface ConfidenceFactor {
  label: string;
  detail: string;
  delta: number; // contribution to the score (illustrative, transparent)
}

// A transparent, explainable breakdown of why an event has its confidence.
// This is illustrative scoring (not ML) so the methodology survives audit.
export function explainConfidence(e: RecoveryEvent): ConfidenceFactor[] {
  const factors: ConfidenceFactor[] = [];

  factors.push({
    label: "Recovery reason attributed",
    detail: e.recoveryReason
      ? `Credited to "${e.recoveryReason}"`
      : "No reason set — cannot attribute",
    delta: e.recoveryReason ? 30 : 0,
  });

  factors.push({
    label: "Collection confirmed",
    detail:
      e.collectedAmount > e.baselineAmount
        ? "Collected exceeds baseline (real uplift)"
        : "No uplift over baseline",
    delta: e.collectedAmount > e.baselineAmount ? 25 : 0,
  });

  factors.push({
    label: "Evidence captured",
    detail: e.evidenceNotes.trim()
      ? "Evidence notes present"
      : "No evidence notes",
    delta: e.evidenceNotes.trim().length > 20 ? 20 : 0,
  });

  factors.push({
    label: "Actions documented",
    detail: `${e.actionsTaken.length} action(s) recorded`,
    delta: Math.min(15, e.actionsTaken.length * 5),
  });

  factors.push({
    label: "Owner accountable",
    detail: e.owner ? `Owned by ${e.owner}` : "Unassigned",
    delta: e.owner ? 10 : 0,
  });

  return factors;
}

/** Sum of factors, clamped 0-100. Used to sanity-check stored confidence. */
export function computeConfidence(e: RecoveryEvent): number {
  const total = explainConfidence(e).reduce((s, f) => s + f.delta, 0);
  return Math.max(0, Math.min(100, total));
}
