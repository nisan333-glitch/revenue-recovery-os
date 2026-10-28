// RECONCILIATION OBSERVER · the first agent whose observation comes from comparing what a contract
// system says is owed with what a billing system actually raised.
//
// WHAT IT IS. A pure adapter and a thin AgentHandler around it:
//
//   expectation extract ─┐
//                         ├─ the REAL validators ─ accepted rows ─ the reconciliation core ─ units
//   billing extract ──────┘                                                                      │
//                                                                  UNDER_BILLED + unpaired + priced
//                                                                                                 ▼
//                                                                                     CandidateSignal
//
// WHAT IT IS NOT. It is not a finding of lost money, it is not a recovery and it is not proof. Every
// signal is OBSERVED exposure that enters the Revenue Opportunity ledger and nowhere else. Revenue
// Returned is computed later, and only from signed evidence under a locked baseline — never from the
// figure this module emits.
//
// ── WHAT BECOMES A CANDIDATE, AND WHAT DELIBERATELY DOES NOT ─────────────────────────────────────────
//
//   * UNDER_BILLED with `pairedWith === null`  → a qualifying UNIT; one payer's units form ONE candidate.
//   * UNDER_BILLED but PAIRED with a counterpart → NOT a candidate. The core holds that money out of
//     its headline "pending attribution" because the shortfall may be money already received under
//     another unit. Emitting it would turn a deliberate hold into a claim.
//   * OVER_BILLED → NOT a candidate. A negative residual is a liability signal, never exposure, and
//     it is never netted against a positive one.
//   * Any REFUSED_* state, NO_RESIDUAL_UNPRICED, NOT_EXPECTED, MONETARILY_BALANCED → NOT a candidate.
//     They are COUNTED in the plan, not zeroed: a refusal is an answer, and an unpriced obligation is
//     an UNKNOWN, which must never read as "checked and found clean".
//   * `MONETARILY_BALANCED` says monetary equality at this grain and nothing else. It is not
//     "no leakage", and this module has no way to say so — the word is not in the core's type.
//
// ── THE GRAIN, STATED RATHER THAN IMPLIED ────────────────────────────────────────────────────────────
//
// A reconciliation UNIT is (entitlement, period), and a unit is not proven to be ONE OBLIGATION: two live
// expectation lines in one unit are refused by the core precisely because the contract carries a count
// of rows, not a count of obligations. The CANDIDATE, however, is ACCOUNT-GRAINED — one candidate per
// payer — because that is what every read surface already says a candidate is ("account pseudonym",
// "account-level", and the identity disclosure beneath them). Pseudonymising the unit instead would have
// made those screens describe a unit reference as an account, which is a false statement on the page.
//
// So the units are reconciled individually, and the POSITIVE residuals of one payer's units are summed
// into that payer's single candidate. Only positives are summed: a payer's over-billed unit is a
// liability signal and is never subtracted. The consequence is the product's existing, disclosed one —
// a LATER run that finds a new shortfall for the same payer is absorbed by the first candidate and its
// money reaches no figure — and nothing here pretends otherwise. Obligation-grained identity needs a
// primary-key migration on the assessment path and is governed separately.
//
// FIRST OBSERVATION WINS. The candidate store keeps the first amount observed for a dedupe key. A later,
// corrected run of the same unit is absorbed and does not change the existing candidate's figure. That
// is the store's documented behaviour, pinned by a test here, not something this module works around.
//
// SYNTHETIC. This module has no knowledge of any customer. The payload it reads is whatever the harness
// or a future governed ingestion supplies; nothing in this file is real data.
import { createHash, createHmac } from "node:crypto";
import { assertCandidateSignal } from "./admission";
import type { ObligationCoverage } from "../../src/domain/provenEligibility";
import type { AgentHandler, CandidateSignal } from "./types";
import {
  validateExpectationExtract,
  type RawExpectationRow,
} from "../../src/contract/expectationExtractValidator";
import {
  validateBillingExtract,
  type RawBillingRow,
} from "../../src/contract/billingExtractValidator";
import type { ExpectationRow } from "../../src/benchmark/reconciliationScenarios";
import type { GovernedReconciliationTerms } from "../../src/benchmark/reconciliationCore";
import {
  reconcileWithObligationIdentity,
  type ObligationObservationRow,
} from "../../src/benchmark/obligationAwareReconciliation";

export const RECONCILIATION_AGENT_ID = "reconciliation-observation-v1";
/** A free string on the server; admission requires a matching entry in NH_AGENT_ADMISSION_POLICIES. */
export const RECONCILIATION_RECOVERY_TYPE = "RevenueUnderBilled";
export const RECONCILIATION_EXPECTED_PROOF_EVENT = "corrective invoice raised and collected";
/** Bounds on what one task may carry. A task payload is stored; it is not a bulk-ingestion channel. */
export const MAX_EXTRACT_ROWS = 5_000;
export const MAX_EXTRACT_COLUMNS = 64;

const PAYLOAD_FIELDS = ["expectation", "billing", "currency", "observedAt", "actionAvailable"] as const;

interface RawExtract {
  readonly columns: readonly string[];
  readonly rows: readonly { readonly rowNumber: number; readonly cells: Readonly<Record<string, string>> }[];
}

export interface ReconciliationObservationInput {
  readonly expectation: RawExtract;
  readonly billing: RawExtract;
  readonly currency: string;
}

/** One reconciliation unit that is UNDER_BILLED, unpaired and priced. Not yet a candidate. */
export interface PlannedUnit {
  readonly entitlementRef: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  /** expected − billed, integer minor units, strictly positive. OBSERVED exposure, never money. */
  readonly residualMinor: number;
  readonly expectedMinor: number;
  readonly observedMinor: number;
}

/** ONE candidate per payer: the sum of that payer's qualifying units. Positives only, never netted. */
export interface PlannedCandidate {
  readonly accountRef: string;
  readonly units: readonly PlannedUnit[];
  readonly residualMinor: number;
}

/** Counts of everything that did NOT become a candidate. A refusal and an unknown are answers. */
export interface ReconciliationPlanCounts {
  readonly units: number;
  /** Qualifying UNITS (before they are grouped by payer). */
  readonly candidateUnits: number;
  /** Candidates = payers with at least one qualifying unit. */
  readonly candidates: number;
  readonly monetarilyBalanced: number;
  readonly overBilledLiability: number;
  readonly underBilledPairedHeld: number;
  /** UNDER_BILLED, unpaired, but a sibling period of the SAME entitlement was refused — see planReconciliation. */
  readonly underBilledWithheldBySiblingRefusal: number;
  /** UNDER_BILLED, unpaired, but no single payer could be named for the unit — withheld, never guessed. */
  readonly underBilledWithheldNoSingleAccount: number;
  readonly unpricedUnknown: number;
  readonly refused: number;
  readonly notExpected: number;
  readonly expectationRowsRejected: number;
  readonly billingRowsRejected: number;
}

/**
 * WHAT A REFUSAL COSTS, stated rather than left as a count beside a zero (S-ID-1).
 *
 * THE DEFECT THIS ANSWERS. A dangling obligation reference refuses its unit — correctly: the billing
 * side cannot be trusted for it. But `observedExposureMinor` then reads 0 with only `counts.refused`
 * beside it, so a surface reading the money cannot tell "nothing was owed" from "we refused to say".
 * Measured on synthetic data: 450.00 of establishable shortfall left the figure while the same payer's
 * contract side plainly stated 1,200.00 owed.
 *
 * `UNDETERMINED`, NEVER ZERO AND NEVER A RESIDUAL. The expected figure is reported because the
 * CONTRACT side stated it and that statement is not in doubt. The residual is NOT reported, because the
 * residual is exactly what the refusal is about: publishing one would be the authored figure the
 * refusal exists to prevent. Two facts, neither standing in for the other.
 */
export interface RefusedExposure {
  /**
   * THREE STATES, AND THEY STAY DISTINGUISHABLE. `NOT_EXAMINED` is an unreadable extract — nobody
   * looked, so "no refusals" would claim work that never happened, the same reason this module already
   * refuses to report zero candidates from a file it could not read. `NONE_REFUSED` means the units
   * were examined and none was refused.
   */
  readonly state: "NOT_EXAMINED" | "NONE_REFUSED" | "UNDETERMINED";
  readonly refusedUnits: number;
  /** Sum of expected amounts on refused units, from the contract side. NOT exposure, never summed into it. */
  readonly refusedExpectedMinor: number;
  /**
   * Refused units whose expected amount the contract side did not state either. Reported SEPARATELY so
   * `refusedExpectedMinor` is never mistaken for a complete figure: where this is above zero, the
   * expected total is a lower bound and the report says so by carrying the count.
   */
  readonly refusedWithoutExpected: number;
  readonly currency: string;
  /** One wording, one place. A screen must not author its own, and must not render a monetary zero. */
  readonly headline: string | null;
}

/** The sentence a surface shows where units were refused. */
/** The sentence where the extract could not be read at all. */
export const NOT_EXAMINED_HEADLINE =
  "NOT EXAMINED. The extracts could not be read, so no reconciliation unit was evaluated and nothing " +
  "is reported about refusals or exposure. This is not a finding of nothing owed.";

export const REFUSED_EXPOSURE_HEADLINE =
  "EXPOSURE UNDETERMINED ON REFUSED UNITS. One or more reconciliation units were refused, so no " +
  "residual could be established for them and NONE is reported. The expected amount beside this is " +
  "what the contract side stated was owed on those units; it is not exposure and is never added to it. " +
  "A refusal is not a finding of nothing owed.";

export interface ReconciliationPlan {
  readonly usable: boolean;
  readonly currency: string;
  readonly candidates: readonly PlannedCandidate[];
  readonly counts: ReconciliationPlanCounts;
  /** Σ candidate residuals. OBSERVED exposure for display next to — never inside — any proven figure. */
  readonly observedExposureMinor: number;
  /**
   * What the refusals withhold. ADDITIVE: no digest, signal id or candidate identity reads this object —
   * `signalsForPlan` digests the units and the account — so adding it moves nothing.
   */
  readonly refusedExposure: RefusedExposure;
  readonly claimBoundary: {
    readonly observationOnly: true;
    readonly constitutesProof: false;
    readonly constitutesRevenue: false;
  };
}

/**
 * The governed reading terms. They are CONSTANTS of this module, not payload fields: a term that decides
 * which counterpart can explain a shortfall is exactly what the beneficiary of a larger number must not
 * be able to set per request. The payer hierarchy and alias map are empty because nothing authoritative
 * supplies them here, and an empty map is the honest value — deriving one from names would be NH
 * authoring the relationship it is supposed to be reading.
 */
export function governedReconciliationTerms(currency: string): GovernedReconciliationTerms {
  return Object.freeze({
    currency,
    invoicingGracePeriods: 1,
    payerHierarchy: Object.freeze({}),
    identityAliases: Object.freeze({}),
  });
}

/** PURE. No clock, no I/O, no persistence. Same input ⇒ same plan, in any row order. */
export function planReconciliation(input: ReconciliationObservationInput): ReconciliationPlan {
  const currency = input.currency.trim().toUpperCase();
  const e = validateExpectationExtract(
    input.expectation.columns,
    input.expectation.rows as readonly RawExpectationRow[],
    { currency },
  );
  const b = validateBillingExtract(
    input.billing.columns,
    input.billing.rows as readonly RawBillingRow[],
    { currency },
  );
  const emptyCounts: ReconciliationPlanCounts = {
    units: 0, candidateUnits: 0, candidates: 0, monetarilyBalanced: 0, overBilledLiability: 0, underBilledPairedHeld: 0,
    underBilledWithheldBySiblingRefusal: 0, underBilledWithheldNoSingleAccount: 0, unpricedUnknown: 0, refused: 0, notExpected: 0,
    expectationRowsRejected: e.rejections.length, billingRowsRejected: b.rejections.length,
  };
  const boundary = Object.freeze({ observationOnly: true as const, constitutesProof: false as const, constitutesRevenue: false as const });
  // An unreadable extract is NOT an empty book. Reporting zero candidates from a file nobody could read
  // would read as "nothing is owed".
  if (!e.usable || !b.usable) {
    return Object.freeze({
      usable: false, currency, candidates: Object.freeze([]), counts: Object.freeze(emptyCounts),
      observedExposureMinor: 0,
      // NOT `NONE_REFUSED`. No unit was examined, so stating that none was refused would assert a
      // population was checked and found clean.
      refusedExposure: Object.freeze({
        state: "NOT_EXAMINED" as const, refusedUnits: 0, refusedExpectedMinor: 0,
        refusedWithoutExpected: 0, currency, headline: NOT_EXAMINED_HEADLINE,
      }),
      claimBoundary: boundary,
    });
  }

  const expectations: ExpectationRow[] = e.accepted.map((a) => Object.freeze({
    entitlementRef: a.entitlementRef,
    customerRef: a.payerRef ?? "",
    periodStart: a.periodStart,
    periodEnd: a.periodEnd,
    expectedAmountMinor: a.expectedAmountMinor,
    currency: a.currency,
    terminatedAt: a.terminatedAt,
    pauseStart: a.pauseStart,
    pauseEnd: a.pauseEnd,
    amendedAt: a.amendedAt,
    supersedesRef: a.supersedesRef,
    scheduleLineRef: a.scheduleLineRef,
  }));
  // The billing extract carries NO entitlement. The obligation reference it cites is the source's own
  // statement of which contract obligation a line settles; the obligation-aware reading resolves the
  // entitlement from THAT, and a row that cites nothing keeps an empty identity and is left unresolved
  // rather than guessed. A line in another currency keeps its own currency so the core can refuse it.
  const observations: ObligationObservationRow[] = b.accepted.map((l) => Object.freeze({
    invoiceRef: l.invoiceRef,
    entitlementRef: "",
    customerRef: l.payerRef,
    periodStart: l.periodStart ?? "",
    periodEnd: l.periodEnd ?? "",
    billedAmountMinor: l.invoiceLineAmountMinor,
    currency: l.currency,
    isCredit: l.isCredit,
    obligationRef: l.obligationRef,
  }));

  const result = reconcileWithObligationIdentity(expectations, observations, governedReconciliationTerms(currency));

  // DOUBT IS SCOPED TO THE EVIDENCE THAT CREATES IT. A refused unit is one the core could not allocate
  // money for, and the money it could not allocate may belong to a SIBLING period of the same
  // entitlement — the canonical case is one invoice that exceeds its own period's obligation while the
  // neighbouring period sits unbilled. The core refuses the first and, because a refusal is not an
  // OVER_BILLED counterpart, offers the second as an unpaired shortfall. Emitting that shortfall would
  // turn money that may already have been paid into a candidate. So an UNDER_BILLED unit is withheld
  // when ANY unit of the same entitlement was refused. The scope is the entitlement and nothing wider:
  // a refusal elsewhere is no evidence about this one.
  const refusedEntitlements = new Set(
    result.units.filter((u) => u.state.startsWith("REFUSED_")).map((u) => u.entitlementRef),
  );
  // The payer of a unit is whatever the CONTRACT side says it is. Exactly one distinct, stated payer or
  // the unit cannot be attributed to an account and is withheld: choosing between two payers, or using
  // the billing side's payer, would be NH authoring the identity it is supposed to be reading.
  const payersOfUnit = new Map<string, Set<string>>();
  for (const x of expectations) {
    const k = `${x.entitlementRef}|${x.periodStart}|${x.periodEnd}`;
    const set = payersOfUnit.get(k) ?? new Set<string>();
    if (x.customerRef !== "") set.add(x.customerRef);
    payersOfUnit.set(k, set);
  }
  const units: { readonly accountRef: string; readonly unit: PlannedUnit }[] = [];
  let balanced = 0, over = 0, held = 0, withheld = 0, noAccount = 0, unpriced = 0, refused = 0, notExpected = 0;
  let refusedExpected = 0;
  let refusedWithoutExpected = 0;
  for (const u of result.units) {
    switch (u.state) {
      case "UNDER_BILLED":
        if (u.pairedWith !== null) { held += 1; break; }
        if (refusedEntitlements.has(u.entitlementRef)) { withheld += 1; break; }
        if (u.residualMinor !== null && u.residualMinor > 0 && u.expectedMinor !== null) {
          const payers = payersOfUnit.get(`${u.entitlementRef}|${u.periodStart}|${u.periodEnd}`) ?? new Set<string>();
          if (payers.size !== 1) { noAccount += 1; break; }
          units.push({
            accountRef: [...payers][0]!,
            unit: Object.freeze({
              entitlementRef: u.entitlementRef, periodStart: u.periodStart, periodEnd: u.periodEnd,
              residualMinor: u.residualMinor, expectedMinor: u.expectedMinor, observedMinor: u.observedMinor,
            }),
          });
        }
        break;
      case "MONETARILY_BALANCED": balanced += 1; break;
      case "OVER_BILLED": over += 1; break;
      case "NO_RESIDUAL_UNPRICED": unpriced += 1; break;
      case "NOT_EXPECTED": notExpected += 1; break;
      default:
        refused += 1; // every REFUSED_* state, counted and never zeroed
        // AND ITS EXPECTED FIGURE KEPT. What the contract side said was owed is not in doubt; only the
        // residual is. Discarding it is what made a refusal indistinguishable from "nothing was owed".
        // `expectedMinor` is `number | null` on the core unit: a refused unit may carry no expected
        // figure at all. A null is COUNTED rather than added as zero, so the reported total cannot be
        // read as complete when part of it was never stated.
        if (u.expectedMinor === null || !Number.isSafeInteger(u.expectedMinor)) refusedWithoutExpected += 1;
        else refusedExpected += u.expectedMinor;
    }
  }
  // Group by payer. Order is by identity, never by input position: reordering the files must not change
  // the plan, so units sort by (entitlement, period) and accounts by their reference.
  const byAccount = new Map<string, PlannedUnit[]>();
  for (const { accountRef, unit } of units) byAccount.set(accountRef, [...(byAccount.get(accountRef) ?? []), unit]);
  const byIdentity = (x: PlannedUnit, y: PlannedUnit): number =>
    `${x.entitlementRef}|${x.periodStart}|${x.periodEnd}`.localeCompare(`${y.entitlementRef}|${y.periodStart}|${y.periodEnd}`);
  const candidates: PlannedCandidate[] = [...byAccount.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([accountRef, us]) => {
      const sorted = [...us].sort(byIdentity);
      return Object.freeze({
        accountRef,
        units: Object.freeze(sorted),
        residualMinor: sorted.reduce((n, x) => n + x.residualMinor, 0),
      });
    });

  return Object.freeze({
    usable: true,
    currency,
    candidates: Object.freeze(candidates),
    counts: Object.freeze({
      units: result.units.length, candidateUnits: units.length, candidates: candidates.length,
      monetarilyBalanced: balanced, overBilledLiability: over, underBilledPairedHeld: held,
      underBilledWithheldBySiblingRefusal: withheld, underBilledWithheldNoSingleAccount: noAccount,
      unpricedUnknown: unpriced, refused, notExpected,
      expectationRowsRejected: e.rejections.length, billingRowsRejected: b.rejections.length,
    }),
    observedExposureMinor: candidates.reduce((n, c) => n + c.residualMinor, 0),
    refusedExposure: Object.freeze({
      state: refused === 0 ? ("NONE_REFUSED" as const) : ("UNDETERMINED" as const),
      refusedUnits: refused,
      refusedExpectedMinor: refusedExpected,
      refusedWithoutExpected,
      currency,
      headline: refused === 0 ? null : REFUSED_EXPOSURE_HEADLINE,
    }),
    claimBoundary: boundary,
  });
}

/** A stable pseudonym for ONE payer account. The key is a deployment secret, never a payload field. */
export function accountSourceRef(key: string, accountRef: string): string {
  return `hmac-sha256:${createHmac("sha256", key)
    .update(JSON.stringify(["reconciliation-account", accountRef]))
    .digest("hex")}`;
}

/**
 * The pseudonymous reference for ONE reconciliation unit, beside `accountSourceRef` and under the same
 * key. The namespace string differs so a unit reference can never collide with an account reference —
 * two different things must not hash to one value just because they share a key.
 */
export function unitObligationRef(key: string, unit: PlannedUnit): string {
  return `hmac-sha256:${createHmac("sha256", key)
    .update(JSON.stringify(["reconciliation-obligation", unit.entitlementRef, unit.periodStart, unit.periodEnd]))
    .digest("hex")}`;
}

/**
 * What a candidate covers, stated from the plan the server itself produced.
 *
 * ONE UNIT IS A SINGLE OBLIGATION; TWO OR MORE IS AN AGGREGATE. The aggregate variant deliberately
 * carries NO per-obligation figures, because there are none: the candidate's amount is a sum, and
 * attaching an expected/billed pair to it would invent a per-obligation claim the data does not support.
 */
export function coverageForCandidate(c: PlannedCandidate, currency: string, key: string): ObligationCoverage {
  if (c.units.length === 1) {
    const u = c.units[0]!;
    return Object.freeze({
      kind: "SINGLE_OBLIGATION" as const,
      obligationRef: unitObligationRef(key, u),
      expectedMinor: u.expectedMinor,
      billedMinor: u.observedMinor,
      // DERIVED from the two figures beside it rather than copied from `u.residualMinor`, so a plan that
      // ever disagreed with its own arithmetic produces a refusal at the gate instead of a stamped lie.
      residualMinor: u.expectedMinor - u.observedMinor,
      currency,
    });
  }
  return Object.freeze({ kind: "ACCOUNT_AGGREGATE" as const, unitCount: c.units.length });
}

function isRawExtract(value: unknown): value is RawExtract {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { columns?: unknown; rows?: unknown };
  if (!Array.isArray(v.columns) || v.columns.length === 0 || v.columns.length > MAX_EXTRACT_COLUMNS) return false;
  if (!v.columns.every((c) => typeof c === "string")) return false;
  if (!Array.isArray(v.rows) || v.rows.length > MAX_EXTRACT_ROWS) return false;
  return v.rows.every((r) => {
    if (typeof r !== "object" || r === null) return false;
    const row = r as { rowNumber?: unknown; cells?: unknown };
    if (!Number.isInteger(row.rowNumber) || typeof row.cells !== "object" || row.cells === null) return false;
    return Object.values(row.cells as Record<string, unknown>).every((c) => typeof c === "string");
  });
}

/**
 * Signals for a plan. Exported separately so tests can hold the plan and the signals side by side.
 */
export function signalsForPlan(
  plan: ReconciliationPlan,
  context: { readonly boundaryId: string; readonly observedAt: string; readonly actionAvailable: boolean; readonly pseudonymKey: string },
): CandidateSignal[] {
  if (!plan.usable || !context.actionAvailable) return [];
  return plan.candidates.map((c) => {
    const digest = createHash("sha256").update(JSON.stringify([
      c.accountRef,
      c.units.map((u) => [u.entitlementRef, u.periodStart, u.periodEnd, u.expectedMinor, u.observedMinor, u.residualMinor]),
      c.residualMinor, plan.currency,
    ])).digest("hex");
    const signal: CandidateSignal = {
      signalId: `REC-${digest.slice(0, 32)}`,
      boundaryId: context.boundaryId,
      recoveryType: RECONCILIATION_RECOVERY_TYPE,
      sourceRef: accountSourceRef(context.pseudonymKey, c.accountRef),
      sourcePayloadHash: digest,
      detectorVersion: RECONCILIATION_AGENT_ID,
      observedAt: context.observedAt,
      amountAtRiskMinor: c.residualMinor,
      currency: plan.currency,
      actionAvailable: context.actionAvailable,
      expectedProofEvent: RECONCILIATION_EXPECTED_PROOF_EVENT,
      // NOT IN `digest` ABOVE, deliberately. That preimage already carries every unit's identity and
      // figures, so the coverage is a function of it: adding the field would change `signalId` and
      // `sourcePayloadHash` for every signal while expressing nothing the digest did not already fix.
      obligationCoverage: coverageForCandidate(c, plan.currency, context.pseudonymKey),
    };
    assertCandidateSignal(signal);
    return signal;
  });
}

/**
 * The handler. `pseudonymKey` must be a deployment secret of at least 32 characters; without one the
 * handler cannot be built, so a misconfigured deployment fails at startup rather than publishing
 * references an operator could invert.
 */
export function reconciliationObserver(
  pseudonymKey: string,
  now: () => number = Date.now,
): AgentHandler {
  if (typeof pseudonymKey !== "string" || pseudonymKey.length < 32) {
    throw new Error("NH_RECONCILER_PSEUDONYM_KEY must be at least 32 characters");
  }
  return {
    agentId: RECONCILIATION_AGENT_ID,
    publishesCandidates: true,
    async run(payload, context) {
      const keys = Object.keys(payload);
      if (keys.length !== PAYLOAD_FIELDS.length || PAYLOAD_FIELDS.some((k) => !(k in payload))
        || keys.some((k) => !(PAYLOAD_FIELDS as readonly string[]).includes(k))) {
        throw new Error("invalid reconciliation observation fields");
      }
      if (!isRawExtract(payload.expectation) || !isRawExtract(payload.billing)) {
        throw new Error("reconciliation observations require bounded raw extracts");
      }
      if (typeof payload.currency !== "string" || !/^[A-Z]{3}$/.test(payload.currency)) {
        throw new Error("reconciliation currency must be an ISO code");
      }
      const observedAt = payload.observedAt;
      if (typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt))
        || new Date(observedAt).toISOString() !== observedAt || Date.parse(observedAt) > now()) {
        throw new Error("reconciliation observedAt must be a canonical ISO date not in the future");
      }
      if (typeof payload.actionAvailable !== "boolean") throw new Error("actionAvailable must be boolean");
      const plan = planReconciliation({
        expectation: payload.expectation, billing: payload.billing, currency: payload.currency,
      });
      return signalsForPlan(plan, {
        boundaryId: context.boundaryId, observedAt, actionAvailable: payload.actionAvailable, pseudonymKey,
      });
    },
  };
}
