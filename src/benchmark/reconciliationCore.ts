// THE PURE RECONCILIATION CORE.
//
// Given independently established EXPECTATION facts and OBSERVATION facts, it identifies monetary
// discrepancies. It is a pure function: no I/O, no clock, no persistence, no customer file, no admission,
// no contract field. It consumes the benchmark model and explicitly supplied governed terms, and returns
// a frozen result.
//
// IT HAS ITS OWN SCHEME AND METHOD VERSION, reusing none of `pds`, `PAD-`, `PAX-`, the assessment finding
// schemes, or Detector #2's exposure scheme. The witness digests the inputs AND the result, so a reading
// can be re-derived and argued with rather than taken on faith.
//
// ── THREE RULES THE TYPES ENFORCE RATHER THAN ASK FOR ────────────────────────────────────────────────
//
//  1. `NO_LEAKAGE` DOES NOT EXIST in `UnitState`. A balanced unit is `MONETARILY_BALANCED`, which says
//     monetary equality at this grain and nothing else. The stronger claim is unrepresentable, not
//     discouraged — the treatment `constitutesProof: false as const` already gets.
//  2. AN UNPRICED EXPECTATION HAS NO NUMERIC RESIDUAL. `NO_RESIDUAL_UNPRICED` carries no money at all,
//     in either direction. Coercing it to zero would make an unpriceable obligation read as balanced.
//  3. NOTHING IS NETTED. A negative residual is never subtracted from a positive one. Pairing CLASSIFIES
//     a positive residual; it never reduces the gross figure.
//
// ── WHAT IT REFUSES, AND WHY A REFUSAL IS AN ANSWER ─────────────────────────────────────────────────
//
// Five refusal classes, from the approved D2.1 package. A refusal is the honest output when the evidence
// cannot support an arithmetic answer; falling back to a coarser grain would not be a weaker answer but a
// DIFFERENT and more concealing one, and inventing a synthetic key would manufacture identity. So the core
// never widens the grain and never derives an identity.
import { sha256Hex } from "../assessment/fingerprint";
import type { ExpectationRow, ObservationRow } from "./reconciliationScenarios";

export const RECONCILIATION_SCHEME = "nh-expectation-reconciliation-v1";
export const RECONCILIATION_METHOD_VERSION = "recon-2026.1";

/** Governed, supplied by the caller. NOTHING here is inferred from the data. */
export interface GovernedReconciliationTerms {
  readonly currency: string;
  /** Adjacent-period tolerance for the timing mechanism, in periods. A governed term, not a guess. */
  readonly invoicingGracePeriods: number;
  /**
   * AUTHORITATIVE payer relation, child → parent. Supplied, never inferred: deriving a hierarchy from a
   * name prefix would be exactly the invented identity the design forbids.
   */
  readonly payerHierarchy: Readonly<Record<string, string>>;
  /** AUTHORITATIVE re-key map, old identity → new. Supplied; a guess here would manufacture a match. */
  readonly identityAliases: Readonly<Record<string, string>>;
}

export type UnitState =
  | "MONETARILY_BALANCED"
  | "UNDER_BILLED"
  | "OVER_BILLED"
  | "NOT_EXPECTED"
  | "NO_RESIDUAL_UNPRICED"
  | "REFUSED_UNALLOCATABLE_OBSERVATION"
  | "REFUSED_OVERLAPPING_PERIODS"
  | "REFUSED_CURRENCY_MISMATCH"
  | "REFUSED_PERIOD_BOUNDARY_DISAGREEMENT"
  | "REFUSED_UNMATCHED_IDENTITY";

export type PairingMechanism =
  | "ADJACENT_PERIOD_SAME_ENTITLEMENT"
  | "SIBLING_ENTITLEMENT_SAME_PAYER"
  | "SIBLING_PAYER_UNDER_HIERARCHY";

export interface UnitResult {
  readonly entitlementRef: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly state: UnitState;
  /** null whenever no residual is defined — unpriced, refused, or not expected. NEVER 0 as a stand-in. */
  readonly residualMinor: number | null;
  readonly expectedMinor: number | null;
  readonly observedMinor: number;
  readonly unpricedExpectationCount: number;
  /** Set only on an UNDER_BILLED unit whose counterpart is reachable through a named mechanism. */
  readonly pairedWith: { readonly mechanism: PairingMechanism; readonly counterpartUnit: string } | null;
  readonly note: string;
}

export interface DeclaredCoverage {
  readonly monetary: "AVAILABLE" | "REFUSED";
  readonly event: "AVAILABLE" | "UNAVAILABLE_NO_OBLIGATION_IDENTITY";
  readonly correlation: "AVAILABLE" | "UNAVAILABLE_NO_AUTHORITATIVE_RELATION";
}

export interface ReconciliationResult {
  readonly scheme: typeof RECONCILIATION_SCHEME;
  readonly methodVersion: typeof RECONCILIATION_METHOD_VERSION;
  readonly currency: string;
  readonly coverage: DeclaredCoverage;
  readonly units: readonly UnitResult[];
  /** Σ positive residuals with NO mechanism-linked counterpart. THE HEADLINE MONEY FIGURE. */
  readonly unpairedPositiveMinor: number;
  /** Σ positive residuals held out pending attribution. Classified, never subtracted from gross. */
  readonly pairedPositiveMinor: number;
  /** `unpaired + paired`. Nothing negative is ever netted out of it. */
  readonly grossPositiveMinor: number;
  readonly grossNegativeMinor: number;
  readonly unpricedExpectationCount: number;
  readonly refusedUnitCount: number;
  readonly claimBoundary: {
    readonly observationOnly: true;
    readonly provesEventCorrectness: false;
    readonly constitutesProof: false;
    readonly constitutesRevenue: false;
  };
}

const unitKey = (entitlementRef: string, periodStart: string, periodEnd: string) =>
  `${entitlementRef}|${periodStart}|${periodEnd}`;

/** Calendar-month distance, for the adjacency mechanism only. Periods are closed calendar intervals. */
function monthIndex(iso: string): number {
  const [y, m] = iso.split("-");
  return Number(y) * 12 + Number(m);
}

const intersects = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  aStart <= bEnd && bStart <= aEnd;

function overlaps(a: ExpectationRow, b: ExpectationRow): boolean {
  return intersects(a.periodStart, a.periodEnd, b.periodStart, b.periodEnd)
    && !(a.periodStart === b.periodStart && a.periodEnd === b.periodEnd);
}

function coveredByPause(e: ExpectationRow): boolean {
  return e.pauseStart !== null && e.pauseEnd !== null
    && e.pauseStart <= e.periodStart && e.periodEnd <= e.pauseEnd;
}

function terminatedBefore(e: ExpectationRow): boolean {
  return e.terminatedAt !== null && e.terminatedAt < e.periodStart;
}

export function reconcile(
  expectations: readonly ExpectationRow[],
  observations: readonly ObservationRow[],
  terms: GovernedReconciliationTerms,
): ReconciliationResult {
  // ── IDENTITY · aliases are APPLIED, never invented ───────────────────────────────────────────────
  const alias = (ref: string) => terms.identityAliases[ref] ?? ref;

  // ── SUPERSESSION · an expectation superseded within the same unit is not a second obligation ──────
  const superseded = new Set(
    expectations.map((e) => e.supersedesRef).filter((r): r is string => r !== null),
  );
  const liveExpectations = expectations.filter(
    (e) => e.scheduleLineRef === null || !superseded.has(e.scheduleLineRef),
  );

  const unitKeys: string[] = [];
  const expByUnit = new Map<string, ExpectationRow[]>();
  for (const e of liveExpectations) {
    const k = unitKey(e.entitlementRef, e.periodStart, e.periodEnd);
    if (!expByUnit.has(k)) { expByUnit.set(k, []); unitKeys.push(k); }
    expByUnit.get(k)!.push(e);
  }

  const obsByUnit = new Map<string, ObservationRow[]>();
  const unmatchedEntitlements = new Set<string>();
  // Entitlements where both sides name the SAME obligation but draw its period differently. Held apart
  // from an unmatched identity on purpose. The first form of this module had no such set and tested the
  // bounds inside the unit loop instead — which could never fire, because a unit's bucket key IS
  // (entitlement, start, end), so every observation in a bucket agrees with it by construction. The
  // disagreement therefore surfaced as REFUSED_UNMATCHED_IDENTITY: the right refusal for the wrong
  // reason, blaming identity for a period problem. Both refuse and neither reports money, so no figure
  // was ever wrong — but a refusal NH cannot explain correctly is a refusal it should not make.
  const boundaryDisagreement = new Set<string>();
  for (const o of observations) {
    const ref = alias(o.entitlementRef);
    const k = unitKey(ref, o.periodStart, o.periodEnd);
    if (!expByUnit.has(k)) {
      // An observation with no expectation unit. Two causes, distinguished by whether the EXPECTATION
      // side knows this entitlement over an intersecting period: if it does, the sides disagree about
      // the boundaries; if it does not, the likelier cause is a re-key or a migration. Neither is
      // guessed at and neither yields money.
      if (liveExpectations.some((e) => e.entitlementRef === ref
        && intersects(e.periodStart, e.periodEnd, o.periodStart, o.periodEnd))) {
        boundaryDisagreement.add(ref);
      } else {
        unmatchedEntitlements.add(ref);
      }
      continue;
    }
    if (!obsByUnit.has(k)) obsByUnit.set(k, []);
    obsByUnit.get(k)!.push(o);
  }

  // Entitlements whose expectation periods overlap cannot be reconciled: an invoice could belong to
  // either, and apportioning would be a guess.
  const overlapping = new Set<string>();
  for (const a of liveExpectations) {
    for (const b of liveExpectations) {
      if (a !== b && a.entitlementRef === b.entitlementRef && overlaps(a, b)) overlapping.add(a.entitlementRef);
    }
  }

  const draft: UnitResult[] = [];
  for (const k of unitKeys) {
    const es = expByUnit.get(k)!;
    const os = obsByUnit.get(k) ?? [];
    const first = es[0]!;
    const base = {
      entitlementRef: first.entitlementRef,
      periodStart: first.periodStart,
      periodEnd: first.periodEnd,
      unpricedExpectationCount: es.filter((e) => e.expectedAmountMinor === null).length,
      pairedWith: null,
    };
    const observedMinor = os.filter((o) => !o.isCredit).reduce((n, o) => n + o.billedAmountMinor, 0);

    // REFUSAL 1 · an identity that could not be matched taints its whole entitlement.
    //
    // AND IT MUST ALSO TAINT EVERY UNBILLED UNIT, which the first form of this check missed. The
    // unmatched key is the OBSERVATION's (the old key, after a re-key); the unbilled unit is under the
    // EXPECTATION's (the new key), so an entitlement-scoped taint never reached it and a re-key was
    // reported as $100 of missing money. If any observation could not be matched, NH cannot tell
    // whether that invoice settles one of these unbilled units, so no unbilled unit may be reported as
    // exposure. Applied below, once the residual is known.
    if (unmatchedEntitlements.has(first.entitlementRef)) {
      draft.push(Object.freeze({ ...base, state: "REFUSED_UNMATCHED_IDENTITY", residualMinor: null,
        expectedMinor: null, observedMinor,
        note: "an observation names an identity with no expectation and no authoritative alias; a re-key or migration cannot be told from an unexpected invoice" }));
      continue;
    }
    // REFUSAL 2 · currency. Never converted, on either side.
    if (es.some((e) => e.currency !== terms.currency) || os.some((o) => o.currency !== terms.currency)) {
      draft.push(Object.freeze({ ...base, state: "REFUSED_CURRENCY_MISMATCH", residualMinor: null,
        expectedMinor: null, observedMinor: 0,
        note: "expectation and observation are not both in the governed currency; no rate is governed, so no comparison is made" }));
      continue;
    }
    // REFUSAL 3 · overlapping periods within one entitlement.
    if (overlapping.has(first.entitlementRef)) {
      draft.push(Object.freeze({ ...base, state: "REFUSED_OVERLAPPING_PERIODS", residualMinor: null,
        expectedMinor: null, observedMinor,
        note: "two expectations of this entitlement cover overlapping periods, so an invoice cannot be assigned to one of them" }));
      continue;
    }
    // REFUSAL 4 · period boundaries that disagree between the two sides. Entitlement-scoped, because an
    // invoice drawn over different bounds may belong to any of this entitlement's periods it touches.
    if (boundaryDisagreement.has(first.entitlementRef)) {
      draft.push(Object.freeze({ ...base, state: "REFUSED_PERIOD_BOUNDARY_DISAGREEMENT", residualMinor: null,
        expectedMinor: null, observedMinor,
        note: "the sides disagree about this period's boundaries; NH does not manufacture a period" }));
      continue;
    }

    // Lifecycle, where it is REPRESENTED. Where it is not, the unit reads as live — which is the twin's
    // whole purpose, and the resulting false positive is the evidence that the field is required.
    if (es.every((e) => coveredByPause(e) || terminatedBefore(e))) {
      draft.push(Object.freeze({ ...base, state: "NOT_EXPECTED", residualMinor: null,
        expectedMinor: null, observedMinor,
        note: "a dated pause or termination covers this period, so nothing was owed" }));
      continue;
    }
    // RULE 2 · unpriced ⇒ no residual, in either direction.
    if (base.unpricedExpectationCount > 0) {
      draft.push(Object.freeze({ ...base, state: "NO_RESIDUAL_UNPRICED", residualMinor: null,
        expectedMinor: null, observedMinor,
        note: "an expectation here carries no authoritative amount; the comparison is impossible and this unit reduces coverage" }));
      continue;
    }

    const expectedMinor = es.reduce((n, e) => n + (e.expectedAmountMinor ?? 0), 0);
    // REFUSAL 5 · a single observation larger than the obligation it claims, while a sibling period of
    // the same entitlement is unbilled. That is the signature of an invoice covering more than one
    // period with no allocation — and it cannot be told from over-billing plus a separate omission, so
    // it is refused rather than apportioned.
    const siblingUnbilled = unitKeys.some((other) => {
      if (other === k) return false;
      const o2 = expByUnit.get(other)!;
      return o2[0]!.entitlementRef === first.entitlementRef && (obsByUnit.get(other) ?? []).length === 0;
    });
    if (os.length === 1 && os[0]!.billedAmountMinor > expectedMinor && siblingUnbilled) {
      draft.push(Object.freeze({ ...base, state: "REFUSED_UNALLOCATABLE_OBSERVATION", residualMinor: null,
        expectedMinor, observedMinor,
        note: "one invoice exceeds this period's obligation while a sibling period is unbilled; it cannot be allocated, and apportioning would be a guess" }));
      continue;
    }

    const residualMinor = expectedMinor - observedMinor;
    if (residualMinor > 0 && unmatchedEntitlements.size > 0) {
      // See REFUSAL 1. An unmatched invoice elsewhere in the extract may be exactly this unit's missing
      // one under another key, so reporting it as exposure would manufacture money out of a re-key.
      draft.push(Object.freeze({ ...base, state: "REFUSED_UNMATCHED_IDENTITY", residualMinor: null,
        expectedMinor, observedMinor,
        note: "an observation elsewhere could not be matched to any expectation, so this unbilled unit cannot be distinguished from a re-keyed invoice" }));
      continue;
    }
    const state: UnitState = residualMinor > 0 ? "UNDER_BILLED" : residualMinor < 0 ? "OVER_BILLED" : "MONETARILY_BALANCED";
    draft.push(Object.freeze({ ...base, state, residualMinor, expectedMinor, observedMinor,
      note: state === "MONETARILY_BALANCED"
        ? "monetary equality at this grain, and nothing more"
        : state === "UNDER_BILLED" ? "obligated money not billed" : "billed beyond the obligation — a liability signal, never exposure" }));
  }

  // ── PAIRING · a SEPARATE pass, after the arithmetic, and it only CLASSIFIES ───────────────────────
  const negatives = draft.filter((u) => u.state === "OVER_BILLED");
  const payerOf = (ref: string) => liveExpectations.find((e) => e.entitlementRef === ref)?.customerRef ?? "";
  const rootOf = (payer: string) => terms.payerHierarchy[payer] ?? payer;

  const units = draft.map((u): UnitResult => {
    if (u.state !== "UNDER_BILLED") return u;
    for (const n of negatives) {
      if (Math.abs(n.residualMinor!) !== u.residualMinor) continue; // only an exact counterpart
      let mechanism: PairingMechanism | null = null;
      if (n.entitlementRef === u.entitlementRef
        && Math.abs(monthIndex(n.periodStart) - monthIndex(u.periodStart)) <= terms.invoicingGracePeriods) {
        mechanism = "ADJACENT_PERIOD_SAME_ENTITLEMENT";
      } else if (n.entitlementRef !== u.entitlementRef && payerOf(n.entitlementRef) === payerOf(u.entitlementRef)) {
        mechanism = "SIBLING_ENTITLEMENT_SAME_PAYER";
      } else if (rootOf(payerOf(n.entitlementRef)) === rootOf(payerOf(u.entitlementRef))
        && terms.payerHierarchy[payerOf(u.entitlementRef)] !== undefined) {
        // ONLY under a SUPPLIED hierarchy. Two unrelated payers are never paired: doing so would let any
        // surplus anywhere excuse any shortfall, which is the netting defect under another name.
        mechanism = "SIBLING_PAYER_UNDER_HIERARCHY";
      }
      if (mechanism) {
        return Object.freeze({ ...u, pairedWith: Object.freeze({ mechanism,
          counterpartUnit: unitKey(n.entitlementRef, n.periodStart, n.periodEnd) }) });
      }
    }
    return u;
  });

  const under = units.filter((u) => u.state === "UNDER_BILLED");
  const unpairedPositiveMinor = under.filter((u) => u.pairedWith === null).reduce((n, u) => n + u.residualMinor!, 0);
  const pairedPositiveMinor = under.filter((u) => u.pairedWith !== null).reduce((n, u) => n + u.residualMinor!, 0);

  // Event reconciliation needs a per-obligation key on EVERY live expectation; correlation needs an
  // authoritative relation. Both are declared UNAVAILABLE rather than scored as zero when absent.
  const everyLineKeyed = liveExpectations.length > 0 && liveExpectations.every((e) => e.scheduleLineRef !== null);
  const anyRelation = Object.keys(terms.payerHierarchy).length > 0;

  return Object.freeze({
    scheme: RECONCILIATION_SCHEME,
    methodVersion: RECONCILIATION_METHOD_VERSION,
    currency: terms.currency,
    coverage: Object.freeze({
      monetary: units.some((u) => u.state.startsWith("REFUSED")) ? "REFUSED" : "AVAILABLE",
      event: everyLineKeyed ? "AVAILABLE" : "UNAVAILABLE_NO_OBLIGATION_IDENTITY",
      correlation: anyRelation ? "AVAILABLE" : "UNAVAILABLE_NO_AUTHORITATIVE_RELATION",
    }) as DeclaredCoverage,
    units: Object.freeze(units),
    unpairedPositiveMinor,
    pairedPositiveMinor,
    grossPositiveMinor: unpairedPositiveMinor + pairedPositiveMinor,
    grossNegativeMinor: units.filter((u) => u.state === "OVER_BILLED").reduce((n, u) => n + Math.abs(u.residualMinor!), 0),
    unpricedExpectationCount: units.reduce((n, u) => n + u.unpricedExpectationCount, 0),
    refusedUnitCount: units.filter((u) => u.state.startsWith("REFUSED")).length,
    claimBoundary: Object.freeze({
      observationOnly: true as const,
      provesEventCorrectness: false as const,
      constitutesProof: false as const,
      constitutesRevenue: false as const,
    }),
  });
}

/** `sha256:<hex>` over the inputs AND the result, so a reading is independently re-derivable. */
export async function reconciliationWitness(
  expectations: readonly ExpectationRow[],
  observations: readonly ObservationRow[],
  terms: GovernedReconciliationTerms,
  result: ReconciliationResult,
): Promise<string> {
  const canonical = JSON.stringify({
    scheme: RECONCILIATION_SCHEME,
    methodVersion: RECONCILIATION_METHOD_VERSION,
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
      o.billedAmountMinor, o.currency, o.isCredit,
    ]),
    result: {
      coverage: result.coverage,
      unpaired: result.unpairedPositiveMinor,
      paired: result.pairedPositiveMinor,
      grossNegative: result.grossNegativeMinor,
      unpriced: result.unpricedExpectationCount,
      refused: result.refusedUnitCount,
      units: result.units.map((u) => [
        u.entitlementRef, u.periodStart, u.periodEnd, u.state, u.residualMinor,
        u.pairedWith?.mechanism ?? null,
      ]),
    },
  });
  return `sha256:${await sha256Hex(canonical)}`;
}
