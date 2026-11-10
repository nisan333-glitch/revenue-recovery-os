// Invariants — the product's truth, enforced in code.
// These are the rules that make "Revenue Returned" auditable. They are pure
// functions with unit tests; the UI must never bypass them.
import type { RecoveryEvent } from "./types";
import { PROOF_THRESHOLD } from "./confidence";
import { channelAbsenceReason, reasonHasDeclaredChannel } from "./correctionMapping";
import { reasonScopeViolation } from "./reasons";

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

/**
 * WHY NO PROOF CAN EXIST FOR THIS EVENT — or `null` when one can.
 *
 * This is the frontend half of the fail-closed correction the owner approved. The governed route has
 * refused an unprovable mechanism since D3; this path had no such check, so the same claim got two
 * answers depending on which door it came through. The gate is now asked in BOTH places, from the
 * same two functions (`reasonScopeViolation`, and the channel question in `correctionMapping`), so
 * there is one policy with two callers rather than two policies.
 *
 * IT DELIBERATELY DOES NOT ASK ABOUT EVIDENCE. A `RecoveryEvent` carries no evidence list, and the
 * question that can be answered without one is the decisive one: *could ANY correction ever evidence
 * this mechanism?* Where the answer is no — seven of the eight declared reasons — no evidence a case
 * might carry could change it, so the ledger figure is unavailable whatever is attached. Whether a
 * PARTICULAR correction satisfies a reason that does have a channel is `validateApproval`'s question,
 * because only it is handed the records.
 *
 * `null` reason returns `null` here on purpose: nothing can be said about a mechanism that was never
 * named, and `isCounted` already refuses an unclassified recovery on its own ground (rule 2). Two
 * gates, two reasons, neither standing in for the other.
 */
export interface ProofUnavailable {
  readonly code: "REASON_SCOPE_VIOLATION" | "CORRECTION_CHANNEL_NOT_DECLARED";
  readonly detail: string;
}

export function proofUnavailable(e: RecoveryEvent): ProofUnavailable | null {
  if (e.recoveryReason === null) return null;
  // Scope first: a reason naming a mechanism the case never had is a false statement about what
  // happened, which is more specific than a statement about what could be evidenced.
  const scope = reasonScopeViolation(e.recoveryReason, e.leakageType);
  if (scope !== null) return Object.freeze({ code: "REASON_SCOPE_VIOLATION" as const, detail: scope });
  if (!reasonHasDeclaredChannel(e.recoveryReason)) {
    return Object.freeze({
      code: "CORRECTION_CHANNEL_NOT_DECLARED" as const,
      detail: channelAbsenceReason(e.recoveryReason),
    });
  }
  return null;
}

/**
 * The event's PROVEN Revenue Returned, or `null` meaning NOT COMPUTED.
 *
 * `null` IS NOT ZERO, and the distinction is the whole point of this function existing beside
 * `revenueReturned`. A rendered `$0.00` asserts that a proof was looked for, found, and summed to
 * nothing; `null` says no proof can exist, which is a different statement and the true one. Every
 * surface that presents a proven figure must render NOT COMPUTED on `null` rather than coercing it —
 * `provenRevenueReturnedLabelling.test.ts` asserts no screen prints `$0.00` for an unavailable proof.
 *
 * `revenueReturned` itself is left exactly as it was: `collected − baseline` is arithmetic over two
 * recorded numbers and stays true regardless of whether it may be CLAIMED. Changing it would have
 * overwritten a fact in order to express a judgement about that fact.
 */
export function provenRevenueReturned(e: RecoveryEvent): number | null {
  if (!isCounted(e)) return null;
  return reportableReturned(e);
}

/**
 * Rule 2: events without a recoveryReason are not counted as recovery.
 *
 * AND, since the owner's Option 1 decision, events whose mechanism has no declared correction channel
 * are not counted either. Both totals in `metrics.ts` and every bucket flow through this predicate and
 * `isAuditable`, so gating here is what removes an unprovable mechanism from every figure at once —
 * rather than subtracting it at each of a dozen call sites, where the thirteenth would be missed.
 */
export function isCounted(e: RecoveryEvent): boolean {
  return isClassifiedRecovery(e) && proofUnavailable(e) === null;
}

/**
 * Recovered AND classified — rule 2 alone, WITHOUT the provability gate.
 *
 * It exists because gating everything on provability produced a wrong answer, caught by reading the
 * recomputed figures rather than by a test: `recoveryRate` is `recovered / (recovered + failed)`, and
 * with the gate applied to its numerator the seed portfolio's rate fell from 0.875 to 0.5 — which
 * would have said SEVEN RECOVERIES FAILED when the money was collected in every one of them. *Cannot
 * be proven* and *did not recover* are different facts, and a rate whose name is `recoveryRate` is
 * about the second.
 *
 * So the split is deliberate: `isCounted` gates the MONEY, because an unprovable dollar may not enter
 * the proven ledger; this gates the OPERATIONAL question, because a collection is a collection. Using
 * either one for the other's job misstates something.
 */
export function isClassifiedRecovery(e: RecoveryEvent): boolean {
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
    e.revenueReturned > 0 &&
    // The mechanism must be one a source can attest. A high confidence score is the beneficiary's
    // own estimate of their attribution and can never substitute for an attested correction.
    proofUnavailable(e) === null
  );
}

/**
 * DETECTED AND REFUSED — money that was collected on a case whose mechanism cannot be proven.
 *
 * It exists so the correction does not make $83,400 of synthetic demonstration money silently
 * disappear from every screen. Dropping it would be its own misstatement: the collection is a
 * recorded fact and the case is a real finding, and only the PROOF is unavailable.
 *
 * WHAT IS REPORTED IS `collectedAmount`, NEVER THE DELTA. `collected − baseline` presented on its own
 * is read as Revenue Returned whatever the column heading says — it is the same arithmetic in the same
 * units — so the figure offered here is the one that cannot be mistaken for a proven uplift.
 */
export function isProofRefusedRecovery(e: RecoveryEvent): boolean {
  return e.status === "Recovered" && e.recoveryReason !== null && proofUnavailable(e) !== null;
}

/**
 * Counted recovery that is NOT yet proof-grade (low/medium confidence).
 *
 * A case whose mechanism has no declared correction channel is NOT in this set, and that is a real
 * distinction rather than an omission: *not yet proof-grade* says the evidence is thin and more of it
 * would help, while *no channel exists* says no amount of evidence could. Collapsing them would tell
 * an operator to go and gather something that cannot settle the question. `isProofRefusedRecovery`
 * reports that set separately, for the same reason `leakInstanceIdentityStatus` and
 * `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` are kept apart.
 */
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
