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
  /**
   * AUTHORITATIVE component identity per schedule line — `BASE`, `OVERAGE`, `SEAT-TIER-2`.
   *
   * It answers the one question that decides whether two live lines in a unit may be ADDED: does the
   * source state that they are distinct additive obligations? Two lines with DIFFERENT non-null
   * components are two obligations; anything less is one obligation described twice, or two
   * alternatives of which one applies, and summing it invents money.
   *
   * Optional, and absence means "not stated" — which refuses rather than permits. Supplied, never
   * inferred: deriving components from amounts, row ids, order or naming would be NH authoring the
   * distinctness it is supposed to be reading.
   *
   * OPEN GOVERNANCE QUESTION, recorded rather than assumed settled: claiming distinctness INFLATES the
   * expectation and therefore the exposure, so this fact points the same way the admission bar does and
   * would need the same governance before any production use.
   */
  readonly additiveLineComponents?: Readonly<Record<string, string>>;
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
  | "REFUSED_UNMATCHED_IDENTITY"
  | "REFUSED_AMBIGUOUS_LIVE_LINES";

export type PairingMechanism =
  | "ADJACENT_PERIOD_SAME_ENTITLEMENT"
  | "SIBLING_ENTITLEMENT_SAME_PAYER"
  | "SIBLING_PAYER_UNDER_HIERARCHY"
  /**
   * More than one counterpart survives the evidence, so NH declines to choose. The money stays HELD
   * OUT of the headline exactly as any other pairing holds it — the hold is the same, the honesty is
   * that no single mechanism is claimed.
   */
  | "AMBIGUOUS_MULTIPLE_COUNTERPARTS";

/**
 * The CLAIMS a pairing makes. A mechanism is admissible only while every part it needs survives, and
 * the parts are refuted independently — which is what stops a compound claim from borrowing support
 * from the half that happens to hold.
 */
export type SettlementHypothesis =
  /** The obligation was settled, in the wrong PERIOD. */
  | "TIMING_DISPLACEMENT"
  /** The money reached the company, under the wrong IDENTITY. */
  | "MISALLOCATION";

/** One counterpart that could explain a shortfall, with what it would have to claim to do so. */
export interface PairingCandidate {
  readonly counterpartUnit: string;
  readonly mechanism: Exclude<PairingMechanism, "AMBIGUOUS_MULTIPLE_COUNTERPARTS">;
  /** CONJUNCTIVE. A cross-period sibling needs BOTH, which is why it cannot outlive its timing half. */
  readonly requires: readonly SettlementHypothesis[];
}

export type PairingVerdict = {
  readonly mechanism: PairingMechanism;
  readonly counterpartUnit: string;
  /** Every surviving counterpart, sorted, when the verdict is ambiguous. Reporting, never selection. */
  readonly ambiguousWith?: readonly string[];
} | null;

/**
 * SELECT A PAIRING FROM EVIDENCE, NEVER FROM ORDER.
 *
 * The defect this replaces: the pairing pass scanned the negative units and took the FIRST whose
 * amount matched, so when two counterparts were reachable the mechanism assigned — and therefore
 * whether the money could ever be claimed — followed array position. Measured on the frozen package:
 * two sibling entitlements of one payer at one price, and the deficit of one of them was attributed to
 * the OTHER's surplus because that unit came first, under a mechanism that was factually wrong.
 *
 * The rule now, and the order of it matters:
 *
 *   1. enumerate EVERY plausible counterpart — no early exit;
 *   2. classify what each one would have to claim;
 *   3. drop the candidates whose claims the evidence refutes;
 *   4. pair ONLY when exactly one survives;
 *   5. otherwise HOLD, and say that more than one survived.
 *
 * Nothing here consults array order, file order, lexical order, amount similarity on its own, date
 * proximity on its own, or a stable sort. **Determinism is necessary and is not evidence** — a stable
 * tie-break would make the answer reproducible and still make it a guess, which is the same error as
 * breaking an append-only log's ties with a random id and calling the order total.
 *
 * `refutedParts` is where source evidence enters. The core itself refutes nothing: it has no fact that
 * speaks to either hypothesis, so it holds wherever more than one counterpart is reachable. A caller
 * with such a fact — the obligation-reference reading — passes it in, and both paths then share THIS
 * function, so neither can drift into a different notion of what counts as settled.
 */
export function selectPairing(
  candidates: readonly PairingCandidate[],
  refutedParts: (candidate: PairingCandidate) => readonly SettlementHypothesis[] = () => [],
): PairingVerdict {
  const surviving = candidates.filter((c) => {
    const dead = new Set(refutedParts(c));
    return !c.requires.some((part) => dead.has(part));
  });
  if (surviving.length === 0) return null;
  if (surviving.length === 1) {
    const only = surviving[0]!;
    return Object.freeze({ mechanism: only.mechanism, counterpartUnit: only.counterpartUnit });
  }
  return Object.freeze({
    mechanism: "AMBIGUOUS_MULTIPLE_COUNTERPARTS" as const,
    counterpartUnit: "(more than one counterpart survives the evidence)",
    ambiguousWith: Object.freeze([...new Set(surviving.map((c) => c.counterpartUnit))].sort()),
  });
}

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
  readonly pairedWith: PairingVerdict;
  /**
   * EVERY plausible counterpart, classified and unranked, whatever the verdict. Exposed so a caller
   * holding evidence the core does not have can re-run `selectPairing` over the same enumeration
   * instead of re-deriving it — a second enumeration is a second chance to disagree.
   */
  readonly pairingCandidates: readonly PairingCandidate[];
  readonly note: string;
}

export interface DeclaredCoverage {
  readonly monetary: "AVAILABLE" | "REFUSED";
  /**
   * Event reconciliation asks whether the expected settlement EVENTS happened — and that is a join
   * between two keyed sides, so it needs a per-obligation key on BOTH of them.
   *
   * This field used to read AVAILABLE whenever every live EXPECTATION carried a schedule line, which
   * claimed the capability from one side alone. `ObservationRow` carries no obligation reference at
   * all, so the billing side was never keyed and an event check was never possible — the field
   * announced availability exactly where the work could not be done. Found while measuring the
   * obligation-reference counterfactual, reported there, corrected here.
   *
   * So the core now reports the honest reason, and the two unavailable states stay DISTINGUISHABLE:
   * nothing keyed at all is a different position from the expectation side keyed and the billing side
   * silent, and collapsing them would hide which half is missing. A capability is declared available
   * only by a layer that holds the facts to perform it.
   */
  readonly event:
    | "AVAILABLE"
    | "UNAVAILABLE_NO_OBLIGATION_IDENTITY"
    | "UNAVAILABLE_BILLING_SIDE_UNKEYED";
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

const EMPTY_CANDIDATES: readonly PairingCandidate[] = Object.freeze([]);

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
  /**
   * The unmatched observations THEMSELVES, not merely their keys.
   *
   * The first form of this module kept a dataset-wide Set of entitlement refs and refused every
   * positive residual whenever it was non-empty. Against a realistic export that is fatal: 98
   * unmatched entitlements refused $85,942.00 of genuine leakage down to $0.00. The direction was
   * right — an unmatched invoice may be the missing one under another key — and the SCOPE had no
   * causal basis, because a dataset is not a settlement relationship.
   *
   * Keeping the rows lets the doubt be scoped by the facts that decide whether settlement between a
   * given invoice and a given obligation is POSSIBLE. See `couldSettle` and docs/TAINT_SCOPE_V1.md.
   */
  const unmatchedObservations: ObservationRow[] = [];
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
        unmatchedObservations.push(o);
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

  const payerRoot = (payer: string) => terms.payerHierarchy[payer] ?? payer;

  /**
   * COULD THIS UNMATCHED INVOICE SETTLE THIS OBLIGATION? Three authoritative facts, conjunctive, and
   * nothing else is consulted:
   *
   *   PAYER    — the same payer, or both under one root of the SUPPLIED hierarchy. An invoice billed to
   *              payer X cannot settle payer Y's obligation; the company billed someone else.
   *   PERIOD   — the same period, or within the GOVERNED displacement window. September cannot settle
   *              March unless a term says timing may move that far.
   *   CURRENCY — the governed currency. A EUR invoice cannot settle a USD obligation with no governed
   *              rate, and that unit is refused on its own grounds anyway.
   *
   * Deliberately NOT consulted, each for a reason that cost something to learn: amount similarity (two
   * unrelated obligations on one plan price are identical in amount — pairing them is the netting
   * defect under another name), date proximity on its own (co-location is not a mechanism), and any
   * name or prefix resemblance (that is inventing an alias, which the architecture test rejects).
   */
  const couldSettle = (unit: { entitlementRef: string; periodStart: string }, o: ObservationRow) => {
    const unitPayer = liveExpectations.find((e) => e.entitlementRef === unit.entitlementRef)?.customerRef ?? "";
    if (payerRoot(unitPayer) !== payerRoot(o.customerRef)) return false;
    if (Math.abs(monthIndex(o.periodStart) - monthIndex(unit.periodStart)) > terms.invoicingGracePeriods) return false;
    return o.currency === terms.currency;
  };

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
      pairingCandidates: EMPTY_CANDIDATES,
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
    if (unmatchedObservations.some((o) => alias(o.entitlementRef) === first.entitlementRef
      && couldSettle(base, o))) {
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

    // AMBIGUOUS LIVE LINES · more than one live expectation claims this unit.
    //
    // Summing them states an amount NEITHER LINE ASSERTS, and choosing one would be NH picking the
    // customer's number for them. Eight shapes can produce this and only two are additive — split
    // schedule lines and additive components — while the rest are a duplicated export row, two
    // mutually exclusive alternatives, a migration duplicate, or an unlinked amendment. Those six are
    // indistinguishable from the additive two unless the source says which it is.
    //
    // So addition requires EVERY line to carry a DISTINCT stated component. Distinct schedule-line ids
    // do not qualify: a duplicated export row has two ids for one obligation, which is exactly why row
    // identity cannot settle this. Neither do equal or unequal amounts, nor row order.
    //
    // This is the same semantic the expectation validator expresses as NH-EX-2016, with a DIFFERENT
    // REMEDY, and the difference matters. There, the rows are quarantined — correct at validation
    // time, where the row never joins a population. Here, quarantining would make the obligation
    // INVISIBLE, hiding a real obligation rather than declining to price it. The unit therefore stays
    // visible and carries a null residual.
    if (es.length > 1) {
      const components = es.map((e) =>
        e.scheduleLineRef === null ? null : (terms.additiveLineComponents ?? {})[e.scheduleLineRef] ?? null);
      const everyLineStated = components.every((c) => c !== null);
      const allDistinct = new Set(components).size === components.length;
      if (!everyLineStated || !allDistinct) {
        draft.push(Object.freeze({ ...base, state: "REFUSED_AMBIGUOUS_LIVE_LINES", residualMinor: null,
          expectedMinor: null, observedMinor,
          note: `${es.length} live expectation lines claim this unit and the source does not state them as distinct additive obligations; summing them would assert an amount none of them makes` }));
        continue;
      }
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
    const settlers = residualMinor > 0
      ? unmatchedObservations.filter((o) => couldSettle(base, o))
      : [];
    if (settlers.length > 0) {
      // An unmatched invoice THAT COULD HAVE SETTLED THIS OBLIGATION may be exactly this unit's missing
      // one under another key, so reporting the residual would manufacture money out of a re-key. The
      // doubt is scoped to the invoices for which settlement is authoritatively possible — not to the
      // dataset, which was the defect.
      draft.push(Object.freeze({ ...base, state: "REFUSED_UNMATCHED_IDENTITY", residualMinor: null,
        expectedMinor, observedMinor,
        note: `an unmatched observation for this payer within the governed window could have settled this obligation (${settlers.length}), so it cannot be distinguished from a re-keyed invoice` }));
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

  /**
   * Classify ONE counterpart. This decides what a pairing would have to CLAIM; it never decides which
   * counterpart wins. The branches are ordered because a candidate satisfying two relations is one
   * relation described two ways — a sibling of the same payer is also under that payer's root — and
   * naming the nearer one is classification, not preference between competing candidates.
   */
  const classify = (n: UnitResult, u: UnitResult): PairingCandidate | null => {
    const samePeriod = n.periodStart === u.periodStart && n.periodEnd === u.periodEnd;
    const withinWindow = Math.abs(monthIndex(n.periodStart) - monthIndex(u.periodStart)) <= terms.invoicingGracePeriods;
    const counterpartUnit = unitKey(n.entitlementRef, n.periodStart, n.periodEnd);

    if (n.entitlementRef === u.entitlementRef) {
      // One obligation, two periods. The whole claim is that the settlement landed in the wrong one.
      if (!withinWindow) return null;
      return Object.freeze({
        counterpartUnit, mechanism: "ADJACENT_PERIOD_SAME_ENTITLEMENT" as const,
        requires: Object.freeze(["TIMING_DISPLACEMENT" as const]),
      });
    }

    // A different identity. In the SAME period that is a pure misallocation. ACROSS periods it is a
    // COMPOUND claim — wrong identity AND wrong period — and it must carry both parts, because a
    // hypothesis that needs two independent errors may not be supported by whichever one survives.
    const requires = Object.freeze(
      samePeriod ? ["MISALLOCATION" as const] : ["MISALLOCATION" as const, "TIMING_DISPLACEMENT" as const],
    );
    if (!samePeriod && !withinWindow) return null;

    if (payerOf(n.entitlementRef) === payerOf(u.entitlementRef)) {
      return Object.freeze({ counterpartUnit, mechanism: "SIBLING_ENTITLEMENT_SAME_PAYER" as const, requires });
    }
    if (rootOf(payerOf(n.entitlementRef)) === rootOf(payerOf(u.entitlementRef))
      && terms.payerHierarchy[payerOf(u.entitlementRef)] !== undefined) {
      // ONLY under a SUPPLIED hierarchy. Two unrelated payers are never paired: doing so would let any
      // surplus anywhere excuse any shortfall, which is the netting defect under another name.
      return Object.freeze({ counterpartUnit, mechanism: "SIBLING_PAYER_UNDER_HIERARCHY" as const, requires });
    }
    return null;
  };

  const units = draft.map((u): UnitResult => {
    if (u.state !== "UNDER_BILLED") return u;
    // EVERY exact counterpart, enumerated with no early exit — the fix for the order defect starts here.
    const candidates = negatives
      .filter((n) => Math.abs(n.residualMinor!) === u.residualMinor)
      .map((n) => classify(n, u))
      .filter((c): c is PairingCandidate => c !== null);
    return Object.freeze({ ...u, pairingCandidates: Object.freeze(candidates), pairedWith: selectPairing(candidates) });
  });

  const under = units.filter((u) => u.state === "UNDER_BILLED");
  const unpairedPositiveMinor = under.filter((u) => u.pairedWith === null).reduce((n, u) => n + u.residualMinor!, 0);
  const pairedPositiveMinor = under.filter((u) => u.pairedWith !== null).reduce((n, u) => n + u.residualMinor!, 0);

  // Event reconciliation needs a per-obligation key on BOTH sides; correlation needs an authoritative
  // relation. Both are declared UNAVAILABLE rather than scored as zero when absent.
  //
  // The expectation side is all this layer can see: `ObservationRow` has no obligation reference, so
  // the billing side is unkeyed here BY CONSTRUCTION and never merely in this dataset. A layer that
  // does hold that fact may upgrade this to AVAILABLE; this one may not, and saying so is the fix.
  const everyLineKeyed = liveExpectations.length > 0 && liveExpectations.every((e) => e.scheduleLineRef !== null);
  const anyRelation = Object.keys(terms.payerHierarchy).length > 0;

  return Object.freeze({
    scheme: RECONCILIATION_SCHEME,
    methodVersion: RECONCILIATION_METHOD_VERSION,
    currency: terms.currency,
    coverage: Object.freeze({
      monetary: units.some((u) => u.state.startsWith("REFUSED")) ? "REFUSED" : "AVAILABLE",
      event: everyLineKeyed ? "UNAVAILABLE_BILLING_SIDE_UNKEYED" : "UNAVAILABLE_NO_OBLIGATION_IDENTITY",
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
