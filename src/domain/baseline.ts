// Baseline — a governed object, not a free money field. Trust Invariant #1/#2 + clarification #2:
// the baseline is established and LOCKED before the intervention or before the outcome is known
// (whichever comes first). After lock it is immutable; a legitimate correction produces a new
// linked revision that preserves the prior value and reason. The beneficiary can never silently
// move it.
import type { Money } from "./money";
import type { LeakageType } from "./types";

export interface Baseline {
  readonly baselineId: string;
  readonly method: string; // e.g. "matched_historical_cohort"
  readonly methodVersion: number;
  readonly sourceRefs: string[]; // references to the data the baseline was computed from
  readonly calculatedAmount: Money;
  readonly currency: string;
  readonly applicableLeakType: LeakageType;
  readonly effectiveAt: string; // the pre-outcome point in time this baseline represents
  readonly establishedAt: string; // system-recorded creation time
  readonly establishedBy: string;
  readonly lockedAt: string | null;
  readonly lockReason: string | null;
  readonly supersedes: string | null; // previous baselineId in a correction chain
}

export function establishBaseline(input: {
  baselineId: string;
  method: string;
  methodVersion: number;
  sourceRefs: string[];
  calculatedAmount: Money;
  applicableLeakType: LeakageType;
  effectiveAt: string;
  establishedAt: string;
  establishedBy: string;
}): Baseline {
  return Object.freeze({
    ...input,
    currency: input.calculatedAmount.currency,
    lockedAt: null,
    lockReason: null,
    supersedes: null,
  });
}

export function lockBaseline(b: Baseline, at: string, reason: string): Baseline {
  if (b.lockedAt) return b; // already locked — immutable
  return Object.freeze({ ...b, lockedAt: at, lockReason: reason });
}

export function isLocked(b: Baseline): boolean {
  return b.lockedAt !== null;
}

/**
 * A legitimate post-lock correction. Never mutates `prev`: returns a NEW baseline that
 * `supersedes` it, preserving the previous value and reason in history.
 */
export function reviseBaseline(
  prev: Baseline,
  input: {
    baselineId: string;
    calculatedAmount: Money;
    sourceRefs: string[];
    establishedAt: string;
    establishedBy: string;
    reason: string;
  },
): Baseline {
  return Object.freeze({
    ...prev,
    baselineId: input.baselineId,
    calculatedAmount: input.calculatedAmount,
    currency: input.calculatedAmount.currency,
    sourceRefs: [...input.sourceRefs],
    establishedAt: input.establishedAt,
    establishedBy: input.establishedBy,
    effectiveAt: prev.effectiveAt, // still represents the same pre-outcome point
    lockedAt: input.establishedAt,
    lockReason: input.reason,
    supersedes: prev.baselineId,
  });
}

/**
 * Temporal validity gate (clarification #2). The baseline must have been established and
 * locked BEFORE the intervention and BEFORE the outcome was observed. Untrusted or missing
 * lock timestamps fail closed.
 */
export function baselineTemporallyValid(
  b: Baseline,
  ctx: { interventionAt: string | null; outcomeObservedAt: string | null },
): { ok: boolean; reason?: string } {
  if (!b.lockedAt) return { ok: false, reason: "baseline is not locked" };
  if (ctx.interventionAt && b.lockedAt > ctx.interventionAt) {
    return { ok: false, reason: "baseline locked after the intervention" };
  }
  if (ctx.outcomeObservedAt && b.lockedAt > ctx.outcomeObservedAt) {
    return { ok: false, reason: "baseline locked after the outcome was observed" };
  }
  return { ok: true };
}
