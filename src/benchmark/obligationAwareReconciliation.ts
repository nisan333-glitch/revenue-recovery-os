// THE OBLIGATION-REFERENCE COUNTERFACTUAL.
//
// It answers one commercial question: what additional money becomes TRUSTWORTHILY detectable if the
// billing side supplies an authoritative reference to the obligation each invoice line settles?
//
// WHY THIS IS A SIBLING AND NOT AN EDIT. `reconciliationCore.ts` is hashed, measured and quoted; its
// witness is `recon-2026.1`. Widening it would mean *same historical input + same governed terms =>
// different result*, which is the trap Detector #2 rejected and for the same reason: the witness would
// become a function of the build. So this module gets its own scheme and method version, calls the
// UNMODIFIED `reconcile()`, and adds exactly two things around it:
//
//   BEFORE · identity resolution. A billing line's own obligation reference says which contract
//            obligation it settles, so a re-keyed or migrated subscription is matched from the
//            source's own words rather than from an alias map NH was handed separately.
//   AFTER  · pairing refutation. A pairing is WITHDRAWN where the references prove the surplus
//            settles its own period's obligation and therefore cannot be a displaced settlement of
//            the deficit's.
//
// IT ADDS NO ARITHMETIC. Every residual, every refusal and every state is the core's. The only money
// that moves is money moving between `pairedPositiveMinor` and `unpairedPositiveMinor`, and the gross
// figures are unchanged by construction — asserted in the tests, not hoped for.
//
// WHAT IT REFUSES TO CONCLUDE, and this is the substance rather than a caveat. Two billing lines
// citing one obligation is NOT evidence of a duplicate. M05-split-invoice in the frozen package is one
// obligation legitimately settled by two lines that sum correctly, and under obligation identity it is
// STRUCTURALLY IDENTICAL to M07's double-billed February. Distinguishing them needs a fact no
// reference carries: how many settlement events the obligation expects. So this module reports
// `MULTIPLE_SETTLEMENTS_OBSERVED` and never the word duplicate.
import {
  reconcile, selectPairing,
  type GovernedReconciliationTerms, type PairingCandidate, type ReconciliationResult,
  type SettlementHypothesis, type UnitResult,
} from "./reconciliationCore";
import type { ExpectationRow, ObservationRow } from "./reconciliationScenarios";

export const OBLIGATION_RECONCILIATION_SCHEME = "nh-obligation-aware-reconciliation-v1" as const;
export const OBLIGATION_RECONCILIATION_METHOD_VERSION = "oblig-2026.1" as const;

/**
 * A billing row that additionally names the obligation it settles. Declared HERE rather than by
 * widening `ObservationRow`, which lives in the frozen examiner.
 *
 * `obligationRef` is null when the source did not supply one. Null means NOT STATED, and every
 * capability below treats it as such: it closes a gate and rejects no row — capability gating per
 * detector, never global dataset rejection.
 */
export interface ObligationObservationRow extends ObservationRow {
  readonly obligationRef: string | null;
}

/** The two readings obligation identity can establish on its own, and nothing further. */
export type ObligationEventKind =
  /** POSITIVELY PROVABLE: the obligation exists and no settlement line cites it. */
  | "OBLIGATION_NEVER_SETTLED"
  /**
   * More than one non-credit settlement cites one obligation. NOT a duplicate finding: an obligation
   * may legitimately be settled in instalments, and nothing in a reference says which this is.
   */
  | "MULTIPLE_SETTLEMENTS_OBSERVED"
  /** A reference naming no obligation on the expectation side. Reported, never silently matched. */
  | "SETTLEMENT_CITES_UNKNOWN_OBLIGATION";

export interface ObligationEvent {
  readonly kind: ObligationEventKind;
  readonly obligationRef: string;
  readonly entitlementRef: string;
  readonly settlementCount: number;
  /** The fact that would be needed to say more than this. Named on the finding, not in a footnote. */
  readonly missingFactForStrongerClaim: string | null;
}

export interface ObligationCoverage {
  /** Both sides keyed, or the capability is closed. The expectation side alone is not enough. */
  readonly obligationIdentity: "AVAILABLE" | "UNAVAILABLE_BILLING_SIDE_UNKEYED" | "PARTIAL_BILLING_SIDE";
  /** Whether a duplicate could be ESTABLISHED, which needs the expected settlement count. */
  readonly duplicateEstablishable: "UNAVAILABLE_NO_EXPECTED_SETTLEMENT_COUNT";
}

export interface ObligationAwareResult extends Omit<ReconciliationResult, "scheme" | "methodVersion"> {
  readonly scheme: typeof OBLIGATION_RECONCILIATION_SCHEME;
  readonly methodVersion: typeof OBLIGATION_RECONCILIATION_METHOD_VERSION;
  /** The core's own witness, carried so a reader can see which arithmetic produced the residuals. */
  readonly underlyingMethodVersion: ReconciliationResult["methodVersion"];
  readonly obligationCoverage: ObligationCoverage;
  readonly obligationEvents: readonly ObligationEvent[];
  /** Pairings withdrawn on obligation evidence, each with the unit and the counterpart it named. */
  readonly refutedPairings: readonly {
    readonly unit: string;
    readonly counterpartUnit: string;
    readonly releasedMinor: number;
    readonly because: string;
  }[];
  /** How many billing rows carried no reference. The capability's own excluded count, never zero. */
  readonly unkeyedObservationCount: number;
}

const unitKey = (u: { entitlementRef: string; periodStart: string; periodEnd: string }) =>
  `${u.entitlementRef}|${u.periodStart}|${u.periodEnd}`;

/**
 * Resolve each billing row's grain identity from the obligation it says it settles.
 *
 * THIS IS THE WHOLE IDENTITY CAPABILITY. The reference names an obligation; the obligation names an
 * entitlement on the expectation side; so the billing row's entitlement follows from the SOURCE'S OWN
 * WORDS. Nothing here reads an amount, a date, a payer, a name or a row position — a re-key that
 * retains no legacy anything is still resolved, because the obligation reference was never billing's
 * internal key in the first place.
 *
 * A row whose reference is missing or names no known obligation keeps the identity it arrived with, so
 * the capability FAILS CLOSED into today's behaviour rather than discarding the row.
 */
function resolveIdentity(
  expectations: readonly ExpectationRow[],
  observations: readonly ObligationObservationRow[],
): { readonly resolved: readonly ObservationRow[]; readonly unkeyed: number; readonly dangling: readonly ObligationObservationRow[] } {
  const entitlementOf = new Map<string, string>();
  for (const e of expectations) {
    if (e.scheduleLineRef !== null) entitlementOf.set(e.scheduleLineRef, e.entitlementRef);
  }
  let unkeyed = 0;
  const dangling: ObligationObservationRow[] = [];
  const resolved = observations.map((o) => {
    const ref = (o.obligationRef ?? "").trim();
    if (ref === "") { unkeyed += 1; return o; }
    const ent = entitlementOf.get(ref);
    if (ent === undefined) { dangling.push(o); return o; }
    return Object.freeze({ ...o, entitlementRef: ent });
  });
  return { resolved: Object.freeze(resolved), unkeyed, dangling: Object.freeze(dangling) };
}

/**
 * THE REFUTATION, and the reason it is scoped the way it is.
 *
 * A pairing CLAIMS something. Obligation identity can refute exactly one of the two claims the core's
 * mechanisms are built from:
 *
 *   TIMING_DISPLACEMENT says the obligation was settled in the wrong period. A reference speaks to that
 *   claim directly, because it states which period's obligation each line settles. REFUTABLE.
 *
 *   MISALLOCATION says the money reached the company under another identity. A reference cannot speak
 *   to that claim, because under the declared semantics it is produced by the very allocation step that
 *   failed: it says where billing PUT the money, which is the thing in question. NOT REFUTABLE.
 *
 * That asymmetry is not a convenience. It is "doubt is scoped to the evidence that creates it" applied
 * to the evidence rather than to the doubt — a fact may only settle the questions it can testify
 * about. Were it ignored, M08-wrong-entitlement would release $2,798 of money the company was ALREADY
 * PAID, which is fabricated money under a confident name.
 *
 * And it is why a CROSS-PERIOD sibling candidate dies here while a same-period one survives: the
 * cross-period one is a compound claim that needs the timing half too, and the references kill the
 * timing half. A compound hypothesis may not be propped up by whichever of its parts happens to hold.
 */
function timingRefuted(
  deficitObligations: readonly string[],
  counterpartUnit: string,
  settlementsByUnit: ReadonlyMap<string, readonly ObligationObservationRow[]>,
  obligationOfUnit: ReadonlyMap<string, readonly string[]>,
  citedAnywhere: ReadonlySet<string>,
): boolean {
  if (deficitObligations.length === 0) return false; // nothing to reason about

  // (a) NOBODY settled the deficit's obligation. Positively provable, and the stronger half.
  if (!deficitObligations.every((ref) => !citedAnywhere.has(ref))) return false;

  // (b) ...and every line in the surplus names the SURPLUS's own obligation, so the surplus is an
  //     over-settlement of its own period and not an early or late settlement of the deficit's.
  const surplusLines = (settlementsByUnit.get(counterpartUnit) ?? []).filter((o) => !o.isCredit);
  if (surplusLines.length === 0) return false;
  const own = new Set(obligationOfUnit.get(counterpartUnit) ?? []);
  return surplusLines.every((o) => own.has((o.obligationRef ?? "").trim()));
}

/**
 * Reconcile with the billing side's obligation references available.
 *
 * The core does all the arithmetic. This adds identity resolution before it and pairing refutation
 * after it, and reports what obligation identity can and cannot establish.
 */
export function reconcileWithObligationIdentity(
  expectations: readonly ExpectationRow[],
  observations: readonly ObligationObservationRow[],
  terms: GovernedReconciliationTerms,
): ObligationAwareResult {
  const { resolved, unkeyed, dangling } = resolveIdentity(expectations, observations);
  const base = reconcile(expectations, resolved, terms);

  // Index the ORIGINAL rows under the units the core actually produced, so the refutation reasons
  // about the same buckets the arithmetic used.
  const byUnit = new Map<string, ObligationObservationRow[]>();
  resolved.forEach((r, i) => {
    const key = `${r.entitlementRef}|${r.periodStart}|${r.periodEnd}`;
    const list = byUnit.get(key) ?? [];
    list.push({ ...observations[i]!, entitlementRef: r.entitlementRef });
    byUnit.set(key, list);
  });
  const obligationOfUnit = new Map<string, string[]>();
  for (const e of expectations) {
    if (e.scheduleLineRef === null) continue;
    const key = `${e.entitlementRef}|${e.periodStart}|${e.periodEnd}`;
    const list = obligationOfUnit.get(key) ?? [];
    list.push(e.scheduleLineRef);
    obligationOfUnit.set(key, list);
  }

  const citedAnywhere = new Set(
    [...byUnit.values()].flat().filter((o) => !o.isCredit).map((o) => (o.obligationRef ?? "").trim()),
  );
  const refutedPairings: Array<ObligationAwareResult["refutedPairings"][number]> = [];

  // RE-SELECT OVER THE CORE'S OWN ENUMERATION, through the core's own `selectPairing`. Not a second
  // enumeration and not a second selection rule: a second one is a second chance to disagree, and the
  // property under test — that the verdict follows evidence rather than order — has to hold on ONE
  // implementation or it holds on neither.
  const units = base.units.map((u): UnitResult => {
    if (u.state !== "UNDER_BILLED") return u;
    const deficitObligations = obligationOfUnit.get(unitKey(u)) ?? [];
    const refutedParts = (c: PairingCandidate): readonly SettlementHypothesis[] =>
      timingRefuted(deficitObligations, c.counterpartUnit, byUnit, obligationOfUnit, citedAnywhere)
        ? ["TIMING_DISPLACEMENT"] : [];
    const verdict = selectPairing(u.pairingCandidates, refutedParts);
    if (verdict === u.pairedWith) return u;
    if (verdict === null && u.pairedWith !== null) {
      refutedPairings.push(Object.freeze({
        unit: unitKey(u), counterpartUnit: u.pairedWith.counterpartUnit,
        releasedMinor: u.residualMinor!,
        because: `every counterpart the core could reach needs a timing displacement, and the references refute it: no settlement anywhere names ${deficitObligations.join(", ") || "this obligation"}, and each surplus names its own period's obligation`,
      }));
    }
    return Object.freeze({ ...u, pairedWith: verdict });
  });

  // ── The event readings · what obligation identity alone can say ────────────────────────────────
  const settlementsByObligation = new Map<string, ObligationObservationRow[]>();
  for (const o of observations) {
    const ref = (o.obligationRef ?? "").trim();
    if (ref === "" || o.isCredit) continue;
    const list = settlementsByObligation.get(ref) ?? [];
    list.push(o);
    settlementsByObligation.set(ref, list);
  }
  const liveObligations = new Map<string, string>();
  for (const e of expectations) {
    if (e.scheduleLineRef !== null) liveObligations.set(e.scheduleLineRef, e.entitlementRef);
  }
  const obligationEvents: ObligationEvent[] = [];
  for (const [ref, ent] of liveObligations) {
    const n = settlementsByObligation.get(ref)?.length ?? 0;
    if (n === 0) {
      obligationEvents.push(Object.freeze({
        kind: "OBLIGATION_NEVER_SETTLED", obligationRef: ref, entitlementRef: ent, settlementCount: 0,
        missingFactForStrongerClaim: null,
      }));
    } else if (n > 1) {
      obligationEvents.push(Object.freeze({
        kind: "MULTIPLE_SETTLEMENTS_OBSERVED", obligationRef: ref, entitlementRef: ent, settlementCount: n,
        missingFactForStrongerClaim:
          "an authoritative EXPECTED SETTLEMENT COUNT for this obligation — without it, settled twice and settled in two instalments are the same observation",
      }));
    }
  }
  for (const o of dangling) {
    obligationEvents.push(Object.freeze({
      kind: "SETTLEMENT_CITES_UNKNOWN_OBLIGATION", obligationRef: (o.obligationRef ?? "").trim(),
      entitlementRef: o.entitlementRef, settlementCount: 1,
      missingFactForStrongerClaim: "the obligation this reference names does not appear on the expectation side at all",
    }));
  }

  const under = units.filter((u) => u.state === "UNDER_BILLED");
  const unpairedPositiveMinor = under.filter((u) => u.pairedWith === null).reduce((n, u) => n + u.residualMinor!, 0);
  const pairedPositiveMinor = under.filter((u) => u.pairedWith !== null).reduce((n, u) => n + u.residualMinor!, 0);

  const obligationIdentity: ObligationCoverage["obligationIdentity"] =
    observations.length === 0 || unkeyed === observations.length ? "UNAVAILABLE_BILLING_SIDE_UNKEYED"
      : unkeyed > 0 ? "PARTIAL_BILLING_SIDE" : "AVAILABLE";

  return Object.freeze({
    ...base,
    scheme: OBLIGATION_RECONCILIATION_SCHEME,
    methodVersion: OBLIGATION_RECONCILIATION_METHOD_VERSION,
    underlyingMethodVersion: base.methodVersion,
    units: Object.freeze(units),
    unpairedPositiveMinor,
    pairedPositiveMinor,
    // Gross is the SUM and is therefore invariant under refutation: refuting a pairing moves money
    // between the two columns and creates none. The test beside this asserts it rather than trusting it.
    grossPositiveMinor: unpairedPositiveMinor + pairedPositiveMinor,
    obligationCoverage: Object.freeze({
      obligationIdentity,
      duplicateEstablishable: "UNAVAILABLE_NO_EXPECTED_SETTLEMENT_COUNT",
    }),
    obligationEvents: Object.freeze(obligationEvents),
    refutedPairings: Object.freeze(refutedPairings),
    unkeyedObservationCount: unkeyed,
  });
}

/**
 * The variant's OWN witness. It commits the new fact explicitly — every `obligationRef` is in the
 * preimage — so a result taken with the references cannot be confused with one taken without them,
 * and it carries its own scheme rather than borrowing `recon-2026.1`.
 */
export async function obligationReconciliationWitness(
  expectations: readonly ExpectationRow[],
  observations: readonly ObligationObservationRow[],
  terms: GovernedReconciliationTerms,
  result: ObligationAwareResult,
): Promise<string> {
  const canonical = JSON.stringify({
    scheme: OBLIGATION_RECONCILIATION_SCHEME,
    methodVersion: OBLIGATION_RECONCILIATION_METHOD_VERSION,
    underlyingMethodVersion: result.underlyingMethodVersion,
    terms: {
      currency: terms.currency,
      invoicingGracePeriods: terms.invoicingGracePeriods,
      payerHierarchy: Object.entries(terms.payerHierarchy).sort(([a], [b]) => a.localeCompare(b)),
      identityAliases: Object.entries(terms.identityAliases).sort(([a], [b]) => a.localeCompare(b)),
    },
    expectations: expectations.map((e) => [
      e.entitlementRef, e.customerRef, e.periodStart, e.periodEnd, e.expectedAmountMinor, e.currency,
      e.terminatedAt, e.pauseStart, e.pauseEnd, e.amendedAt, e.supersedesRef, e.scheduleLineRef,
    ]),
    observations: observations.map((o) => [
      o.invoiceRef, o.entitlementRef, o.customerRef, o.periodStart, o.periodEnd,
      o.billedAmountMinor, o.currency, o.isCredit, o.obligationRef,
    ]),
    result: {
      coverage: result.coverage,
      obligationCoverage: result.obligationCoverage,
      unpaired: result.unpairedPositiveMinor,
      paired: result.pairedPositiveMinor,
      grossNegative: result.grossNegativeMinor,
      refuted: result.refutedPairings.map((r) => [r.unit, r.counterpartUnit, r.releasedMinor]),
      events: result.obligationEvents.map((e) => [e.kind, e.obligationRef, e.settlementCount]),
      states: result.units.map((u) => [u.entitlementRef, u.periodStart, u.state, u.residualMinor]),
    },
  });
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
