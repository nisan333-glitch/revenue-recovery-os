// Invariants — the product's truth, enforced in code.
// These are the rules that make "Revenue Returned" auditable. They are pure
// functions with unit tests; the UI must never bypass them.
import type { RecoveryEvent } from "./types";
import { PROOF_THRESHOLD } from "./confidence";

/**
 * Core equation. revenueReturned is ALWAYS derived, never user-set.
 * We keep the raw delta (can be negative if a recovery underperformed),
 * and report a clamped value for money-recovered totals.
 */
export function computeRevenueReturned(
  collectedAmount: number,
  baselineAmount: number,
): number {
  return collectedAmount - baselineAmount;
}

/** Reporting value: never let a negative recovery inflate (or deflate) totals. */
export function reportableReturned(e: RecoveryEvent): number {
  return Math.max(0, e.revenueReturned);
}

/**
 * Re-derive revenueReturned and return a corrected event. Call this on every
 * write so the stored value can never drift from the equation.
 */
export function withDerivedReturn<T extends RecoveryEvent>(e: T): T {
  const revenueReturned = computeRevenueReturned(
    e.collectedAmount,
    e.baselineAmount,
  );
  return { ...e, revenueReturned };
}

/** Rule 2: events without a recoveryReason are not counted as recovery. */
export function isCounted(e: RecoveryEvent): boolean {
  return e.recoveryReason !== null && e.status === "Recovered";
}

/**
 * Rule 4: CFO-grade / auditable. Only Recovered + reason + proof-grade
 * confidence + a real uplift counts toward the number a CFO signs off on.
 */
export function isAuditable(e: RecoveryEvent): boolean {
  return (
    e.status === "Recovered" &&
    e.recoveryReason !== null &&
    e.confidence >= PROOF_THRESHOLD &&
    e.revenueReturned > 0
  );
}

/** Counted recovery that is NOT yet proof-grade (low/medium confidence). */
export function isUnprovenRecovery(e: RecoveryEvent): boolean {
  return isCounted(e) && !isAuditable(e);
}

/**
 * Validate an event against all invariants. Returns a list of violations
 * (empty = valid). Useful for tests and for surfacing data-quality issues.
 */
export function validateEvent(e: RecoveryEvent): string[] {
  const problems: string[] = [];
  const expected = computeRevenueReturned(e.collectedAmount, e.baselineAmount);
  if (e.revenueReturned !== expected) {
    problems.push(
      `revenueReturned (${e.revenueReturned}) != collected - baseline (${expected})`,
    );
  }
  if (e.confidence < 0 || e.confidence > 100) {
    problems.push(`confidence out of range: ${e.confidence}`);
  }
  if (e.baselineAmount < 0) problems.push("baselineAmount is negative");
  if (e.collectedAmount < 0) problems.push("collectedAmount is negative");
  if (e.status === "Recovered" && e.recoveryReason === null) {
    problems.push("Recovered event has no recoveryReason (cannot be counted)");
  }
  return problems;
}
