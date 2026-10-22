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
//   * UNDER_BILLED with `pairedWith === null`  → ONE candidate for the residual (expected − billed).
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
// A reconciliation UNIT is (entitlement, period). A unit is not proven to be ONE OBLIGATION: two live
// expectation lines in one unit are refused by the core precisely because the contract carries a count
// of rows, not a count of obligations. `sourceRef` below pseudonymises the UNIT. That keeps two units of
// one customer from silently absorbing each other in the candidate store — but it does NOT make the case
// a per-obligation claim, and the case disclosure (identity cannot guarantee a single obligation) is
// left exactly as it is. Obligation-grained identity needs a primary-key migration on the assessment
// path and is governed separately; nothing here depends on it or pretends to.
//
// FIRST OBSERVATION WINS. The candidate store keeps the first amount observed for a dedupe key. A later,
// corrected run of the same unit is absorbed and does not change the existing candidate's figure. That
// is the store's documented behaviour, pinned by a test here, not something this module works around.
//
// SYNTHETIC. This module has no knowledge of any customer. The payload it reads is whatever the harness
// or a future governed ingestion supplies; nothing in this file is real data.
import { createHash, createHmac } from "node:crypto";
import { assertCandidateSignal } from "./admission";
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

export interface PlannedCandidate {
  readonly entitlementRef: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  /** expected − billed, integer minor units, strictly positive. OBSERVED exposure, never money. */
  readonly residualMinor: number;
  readonly expectedMinor: number;
  readonly observedMinor: number;
}

/** Counts of everything that did NOT become a candidate. A refusal and an unknown are answers. */
export interface ReconciliationPlanCounts {
  readonly units: number;
  readonly candidates: number;
  readonly monetarilyBalanced: number;
  readonly overBilledLiability: number;
  readonly underBilledPairedHeld: number;
  /** UNDER_BILLED, unpaired, but a sibling period of the SAME entitlement was refused — see planReconciliation. */
  readonly underBilledWithheldBySiblingRefusal: number;
  readonly unpricedUnknown: number;
  readonly refused: number;
  readonly notExpected: number;
  readonly expectationRowsRejected: number;
  readonly billingRowsRejected: number;
}

export interface ReconciliationPlan {
  readonly usable: boolean;
  readonly currency: string;
  readonly candidates: readonly PlannedCandidate[];
  readonly counts: ReconciliationPlanCounts;
  /** Σ candidate residuals. OBSERVED exposure for display next to — never inside — any proven figure. */
  readonly observedExposureMinor: number;
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
    units: 0, candidates: 0, monetarilyBalanced: 0, overBilledLiability: 0, underBilledPairedHeld: 0,
    underBilledWithheldBySiblingRefusal: 0, unpricedUnknown: 0, refused: 0, notExpected: 0,
    expectationRowsRejected: e.rejections.length, billingRowsRejected: b.rejections.length,
  };
  const boundary = Object.freeze({ observationOnly: true as const, constitutesProof: false as const, constitutesRevenue: false as const });
  // An unreadable extract is NOT an empty book. Reporting zero candidates from a file nobody could read
  // would read as "nothing is owed".
  if (!e.usable || !b.usable) {
    return Object.freeze({
      usable: false, currency, candidates: Object.freeze([]), counts: Object.freeze(emptyCounts),
      observedExposureMinor: 0, claimBoundary: boundary,
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
  const candidates: PlannedCandidate[] = [];
  let balanced = 0, over = 0, held = 0, withheld = 0, unpriced = 0, refused = 0, notExpected = 0;
  for (const u of result.units) {
    switch (u.state) {
      case "UNDER_BILLED":
        if (u.pairedWith !== null) { held += 1; break; }
        if (refusedEntitlements.has(u.entitlementRef)) { withheld += 1; break; }
        if (u.residualMinor !== null && u.residualMinor > 0 && u.expectedMinor !== null) {
          candidates.push(Object.freeze({
            entitlementRef: u.entitlementRef, periodStart: u.periodStart, periodEnd: u.periodEnd,
            residualMinor: u.residualMinor, expectedMinor: u.expectedMinor, observedMinor: u.observedMinor,
          }));
        }
        break;
      case "MONETARILY_BALANCED": balanced += 1; break;
      case "OVER_BILLED": over += 1; break;
      case "NO_RESIDUAL_UNPRICED": unpriced += 1; break;
      case "NOT_EXPECTED": notExpected += 1; break;
      default: refused += 1; // every REFUSED_* state, counted and never zeroed
    }
  }
  // Order is by identity, never by input position: reordering the files must not change the plan.
  candidates.sort((x, y) =>
    `${x.entitlementRef}|${x.periodStart}|${x.periodEnd}`.localeCompare(`${y.entitlementRef}|${y.periodStart}|${y.periodEnd}`));

  return Object.freeze({
    usable: true,
    currency,
    candidates: Object.freeze(candidates),
    counts: Object.freeze({
      units: result.units.length, candidates: candidates.length, monetarilyBalanced: balanced,
      overBilledLiability: over, underBilledPairedHeld: held, underBilledWithheldBySiblingRefusal: withheld, unpricedUnknown: unpriced, refused, notExpected,
      expectationRowsRejected: e.rejections.length, billingRowsRejected: b.rejections.length,
    }),
    observedExposureMinor: candidates.reduce((n, c) => n + c.residualMinor, 0),
    claimBoundary: boundary,
  });
}

/** A stable pseudonym for ONE reconciliation unit. The key is a deployment secret, never a payload field. */
export function unitSourceRef(key: string, c: Pick<PlannedCandidate, "entitlementRef" | "periodStart" | "periodEnd">): string {
  return `hmac-sha256:${createHmac("sha256", key)
    .update(JSON.stringify(["reconciliation-unit", c.entitlementRef, c.periodStart, c.periodEnd]))
    .digest("hex")}`;
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
      c.entitlementRef, c.periodStart, c.periodEnd, c.expectedMinor, c.observedMinor, c.residualMinor, plan.currency,
    ])).digest("hex");
    const signal: CandidateSignal = {
      signalId: `REC-${digest.slice(0, 32)}`,
      boundaryId: context.boundaryId,
      recoveryType: RECONCILIATION_RECOVERY_TYPE,
      sourceRef: unitSourceRef(context.pseudonymKey, c),
      sourcePayloadHash: digest,
      detectorVersion: RECONCILIATION_AGENT_ID,
      observedAt: context.observedAt,
      amountAtRiskMinor: c.residualMinor,
      currency: plan.currency,
      actionAvailable: context.actionAvailable,
      expectedProofEvent: RECONCILIATION_EXPECTED_PROOF_EVENT,
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
