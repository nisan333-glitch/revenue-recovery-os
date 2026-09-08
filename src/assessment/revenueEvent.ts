// Revenue Event — EXPECT → DETECT, contractual class only.
//
// This module answers ONE question, deterministically: "a billing obligation was objectively
// established; did the corresponding billing event actually occur, on time, for the right amount?"
//
// WHAT THIS MODULE IS NOT:
//  • It is NOT a Baseline. A Baseline is a COUNTERFACTUAL ("what would have been collected without
//    the intervention") used for causal attribution. An ExpectedRevenueEvent is a NORMATIVE
//    obligation ("what was supposed to happen"). They are different epistemic objects and are
//    deliberately kept apart — this module never imports, produces, or resembles a Baseline.
//  • It is NOT a Proof, a Case, or a ledger entry. A Discrepancy is a REVIEWABLE FINDING. It is not
//    leakage, not recovered money, not revenue, and never fee-bearing. Promotion of a finding into
//    the governed world stays on the existing manual Case → Evidence → Proof path.
//  • It is NOT an estimate. Nothing here is modelled, projected, or inferred from cohort behaviour.
//
// FAIL CLOSED: when the obligation, the identity, the deadline, or the observed fact cannot be
// established objectively, the result is UNKNOWN. UNKNOWN is never company-recoverable.
import type { Money } from "../domain/money";
import { eqMoney, subMoney, isPositive } from "../domain/money";
import type { ExpectationCycle } from "./types";
import type { AssessmentPolicy } from "./policy";
import { isAfter } from "./dateNormalize";

/**
 * The three epistemically different classes of expectation. They are declared together so the
 * distinction is explicit in the type system and cannot be blurred by accident — but only
 * CONTRACTUAL is derivable in this slice.
 *
 *  • CONTRACTUAL — an obligation established by a contract/entitlement/billing term. May be
 *    deterministic. The ONLY class allowed into the recoverable-candidate path.
 *  • OPERATIONAL — an SLA/policy/process target (e.g. "activate within N days"). Real, but it does
 *    NOT by itself establish that money is owed.
 *  • STATISTICAL — cohort/model/propensity expectation. Never establishes an obligation, and is
 *    structurally barred from this module (nothing here reads a cohort, rate, or projection).
 */
export type ExpectationBasis = "CONTRACTUAL" | "OPERATIONAL" | "STATISTICAL";

/** The single revenue-event type authorized in this slice. */
export type RevenueEventType = "BillingEvent";

/** What was objectively supposed to happen. Never fabricated: every field traces to source data. */
export interface ExpectedRevenueEvent {
  readonly expectationBasis: "CONTRACTUAL";
  readonly eventType: RevenueEventType;
  /** Identity used to line the expectation up with its observation. */
  readonly cycleId: string;
  /** Provenance: the originating source row. */
  readonly sourceRef: string;
  /** What established the obligation (here: the commitment/signature date on the source record). */
  readonly basisRef: string;
  /** The deadline by which the billing event was due. ISO date. */
  readonly expectedAt: string;
  /**
   * The obligated amount, exact minor units — copied verbatim from the source record, never
   * derived, estimated, defaulted or rounded. null when it cannot be established objectively.
   */
  readonly expectedAmount: Money | null;
  readonly currency: string;
}

/** What was actually observed. Absence of an observation is never read as evidence of an event. */
export interface ObservedRevenueEvent {
  readonly eventType: RevenueEventType;
  readonly cycleId: string;
  readonly sourceRef: string;
  /** When the billing event settled. null = no settling event recorded (NOT "it happened"). */
  readonly observedAt: string | null;
  /** Settled amount when known. null = unknown (NOT zero). */
  readonly observedAmount: Money | null;
  /**
   * False when the settling time is not trustworthy — e.g. a bare boolean "paid" column with no
   * timestamp, which the adapter documents as unable to distinguish on-time from late. Timing
   * conclusions must fail closed when this is false.
   */
  readonly timingKnown: boolean;
  readonly refunded: boolean;
  readonly cancelled: boolean;
}

/**
 * How the observation diverges from the obligation.
 *  • NONE      — no divergence detectable (includes "not yet due").
 *  • MISSING   — deadline passed, no billing event observed at all.
 *  • DELAYED   — the event occurred, but after the deadline. The money arrived.
 *  • INCORRECT — the event occurred for an objectively different amount.
 *  • UNKNOWN   — cannot be established. Always fails closed.
 */
export type DiscrepancyKind = "NONE" | "MISSING" | "DELAYED" | "INCORRECT" | "UNKNOWN";

/**
 * Which side a divergence favours. Direction is not cosmetic: a customer-favourable discrepancy
 * (the customer paid MORE than owed) is a real finding that must be surfaced, and must never be
 * added to a company-recoverable total.
 */
export type DiscrepancyDirection = "NEUTRAL" | "COMPANY_FAVOURABLE" | "CUSTOMER_FAVOURABLE";

export interface Discrepancy {
  readonly kind: DiscrepancyKind;
  readonly direction: DiscrepancyDirection;
  readonly cycleId: string;
  readonly sourceRef: string;
  /** Exact divergence where objectively derivable; null otherwise. Never estimated. */
  readonly delta: Money | null;
  /**
   * A REVIEW CANDIDATE ONLY. True means: "a human should look at this." It does NOT mean leakage,
   * confirmed leakage, recoverable revenue, recovered cash, or anything fee-bearing. Nothing in the
   * product may treat this flag as money. UNKNOWN and CUSTOMER_FAVOURABLE are never true here.
   */
  readonly companyRecoverableCandidate: boolean;
  /** Plain-language basis for the classification, for review and audit. */
  readonly reason: string;
}

export interface RevenueEventTriple {
  readonly expected: ExpectedRevenueEvent;
  readonly observed: ObservedRevenueEvent;
  readonly discrepancy: Discrepancy;
}

/** Marker the adapter sets when "paid" came from a bare boolean with no timestamp. */
const UNKNOWN_TIMING_MARKER = "unknown_from_bool";

/**
 * Derive the CONTRACTUAL billing expectation from a cycle.
 *
 * `basis` is an explicit parameter, not an assumption: passing OPERATIONAL or STATISTICAL returns
 * null rather than quietly producing a contractual obligation. An operational target (e.g. the
 * policy's stall threshold) and a cohort expectation can therefore never wear contractual clothes.
 *
 * Returns null (fail closed) when identity, deadline, amount or currency cannot be established.
 */
export function deriveContractualExpectation(
  cycle: ExpectationCycle,
  basis: ExpectationBasis = "CONTRACTUAL",
): ExpectedRevenueEvent | null {
  if (basis !== "CONTRACTUAL") return null; // operational/statistical never establish an obligation
  if (!cycle.cycleId.trim()) return null; // ambiguous identity fails closed
  const due = cycle.monetaryEvent.dueAt;
  if (!due.trim()) return null; // no deadline → no objective obligation
  const amount = cycle.monetaryEvent.amount;
  // The obligation amount is taken verbatim. A currency that disagrees with the cycle is a data
  // contradiction, not something to reconcile here.
  if (amount.currency !== cycle.currency) return null;

  return Object.freeze({
    expectationBasis: "CONTRACTUAL" as const,
    eventType: "BillingEvent" as const,
    cycleId: cycle.cycleId,
    sourceRef: cycle.sourceRowId,
    basisRef: cycle.expectationAt, // the commitment that creates the obligation to invoice
    expectedAt: due,
    expectedAmount: amount,
    currency: cycle.currency,
  });
}

/** Read the observed billing fact. Never infers an event from its expected existence. */
export function deriveObservedEvent(cycle: ExpectationCycle): ObservedRevenueEvent {
  const m = cycle.monetaryEvent;
  return Object.freeze({
    eventType: "BillingEvent" as const,
    cycleId: cycle.cycleId,
    sourceRef: cycle.sourceRowId,
    observedAt: m.paidAt,
    observedAmount: m.paidAmount,
    timingKnown: cycle.attributes["paid_timing"] !== UNKNOWN_TIMING_MARKER,
    refunded: m.refunded,
    cancelled: m.cancelled,
  });
}

function unknown(cycleId: string, sourceRef: string, reason: string): Discrepancy {
  return Object.freeze({
    kind: "UNKNOWN" as const,
    direction: "NEUTRAL" as const,
    cycleId,
    sourceRef,
    delta: null,
    companyRecoverableCandidate: false,
    reason,
  });
}

/**
 * Compare obligation against observation as of the policy cut-off.
 *
 * Order matters: identity/void checks first, then "is it even due yet", then amount (materially
 * more significant than timing), then timing. Every branch that cannot be established objectively
 * returns UNKNOWN.
 */
export function detectDiscrepancy(
  expected: ExpectedRevenueEvent,
  observed: ObservedRevenueEvent,
  policy: AssessmentPolicy,
): Discrepancy {
  const id = expected.cycleId;
  const src = expected.sourceRef;

  if (observed.cycleId !== expected.cycleId) {
    return unknown(id, src, "identity mismatch between expectation and observation");
  }
  if (expected.expectedAmount === null) {
    return unknown(id, src, "obligation amount could not be established objectively");
  }
  // A cancelled or refunded obligation may have been legitimately voided or reversed. Whether it
  // still stands is a contractual judgement this module cannot make from the data available.
  if (observed.cancelled) return unknown(id, src, "obligation cancelled — cannot establish it still stands");
  if (observed.refunded) return unknown(id, src, "obligation refunded/reversed — cannot establish net position");

  // Not yet due: the expectation window is still open. Silence is not a discrepancy.
  if (isAfter(expected.expectedAt, policy.asOf)) {
    return Object.freeze({
      kind: "NONE" as const,
      direction: "NEUTRAL" as const,
      cycleId: id,
      sourceRef: src,
      delta: null,
      companyRecoverableCandidate: false,
      reason: `not yet due (due ${expected.expectedAt}, as-of ${policy.asOf})`,
    });
  }

  const expAmt = expected.expectedAmount;

  // No settling event of any kind, past the deadline → the billing event is absent.
  if (observed.observedAt === null && observed.observedAmount === null) {
    return Object.freeze({
      kind: "MISSING" as const,
      direction: "COMPANY_FAVOURABLE" as const,
      cycleId: id,
      sourceRef: src,
      delta: expAmt,
      companyRecoverableCandidate: true,
      reason: `no billing event observed by as-of ${policy.asOf} for an obligation due ${expected.expectedAt}`,
    });
  }

  // Amount divergence is checked before timing: a wrong amount is materially more significant
  // than a late-but-correct settlement.
  if (observed.observedAmount !== null) {
    if (observed.observedAmount.currency !== expAmt.currency) {
      return unknown(id, src, "observed amount is in a different currency than the obligation");
    }
    if (!eqMoney(observed.observedAmount, expAmt)) {
      const shortfall = subMoney(expAmt, observed.observedAmount);
      const companyIsOwed = isPositive(shortfall);
      return Object.freeze({
        kind: "INCORRECT" as const,
        direction: (companyIsOwed ? "COMPANY_FAVOURABLE" : "CUSTOMER_FAVOURABLE") as DiscrepancyDirection,
        cycleId: id,
        sourceRef: src,
        // Delta is always reported as a magnitude in the direction stated above.
        delta: companyIsOwed ? shortfall : subMoney(observed.observedAmount, expAmt),
        // A customer who paid MORE than owed is a real finding, but it is money the company may
        // owe back — it can never enter a company-recoverable total.
        companyRecoverableCandidate: companyIsOwed,
        reason: companyIsOwed
          ? "settled amount is below the obligated amount"
          : "settled amount exceeds the obligated amount (customer-favourable)",
      });
    }
  }

  // Amount is either correct or unknown; the event did occur. Timing is all that remains.
  if (!observed.timingKnown) {
    return unknown(id, src, "settlement timing not observable (boolean paid flag without a timestamp)");
  }
  if (observed.observedAt !== null && isAfter(observed.observedAt, expected.expectedAt)) {
    return Object.freeze({
      kind: "DELAYED" as const,
      direction: "NEUTRAL" as const,
      cycleId: id,
      sourceRef: src,
      delta: null,
      // The money arrived. Late settlement is an operational finding, not recoverable value.
      companyRecoverableCandidate: false,
      reason: `settled ${observed.observedAt}, after the obligation date ${expected.expectedAt}`,
    });
  }
  if (observed.observedAmount === null && observed.observedAt === null) {
    return unknown(id, src, "no observable settlement fact");
  }

  return Object.freeze({
    kind: "NONE" as const,
    direction: "NEUTRAL" as const,
    cycleId: id,
    sourceRef: src,
    delta: null,
    companyRecoverableCandidate: false,
    reason: "obligation settled as expected",
  });
}

/**
 * Convenience: the full EXPECT → DETECT triple for one cycle. Returns null when no contractual
 * obligation can be established (fail closed) — the caller gets nothing rather than a guess.
 */
export function analyseCycle(cycle: ExpectationCycle, policy: AssessmentPolicy): RevenueEventTriple | null {
  const expected = deriveContractualExpectation(cycle);
  if (!expected) return null;
  const observed = deriveObservedEvent(cycle);
  return Object.freeze({ expected, observed, discrepancy: detectDiscrepancy(expected, observed, policy) });
}
