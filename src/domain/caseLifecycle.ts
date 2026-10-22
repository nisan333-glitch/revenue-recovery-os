// Recovery Case lifecycle — DERIVED, never stored.
//
// WHY DERIVED. `RecoveryCaseRecord` carries who opened a case and when, and no status. That is the right
// shape: the lifecycle is already written across four APPEND-ONLY tables, and a `status` column would be
// a mutable cache of an immutable history — the classic way the two drift, and the thing this repository
// has refused for admission decisions, analysis terms and execution events alike. So status is a pure
// function of the history, computed here, and nothing persists it.
//
// IT TAKES FOUR INPUTS, AND THAT IS A CORRECTION TO AN EARLIER ASSUMPTION OF MINE. I expected the whole
// lifecycle in the `AuthorityEvent` ledger. It is not. The ledger has THREE writers, which took reading
// all of them to establish:
//
//   • `recordAuthority` — `Author`, `Intervene`, `Verify`, `Flag`, `Halt`, `Exclude`.
//   • `proofStore.authorityRow` — `Approve`, written directly rather than through `recordAuthority`.
//   • `postgresCandidateReviewStore.promote` — `PromoteCandidate`, likewise written directly.
//
// while `EstablishBaseline` and `IngestEvidence` — which `HALTED_MUTATIONS` does cover — leave their
// trace in `BaselineSnapshot` and `EvidenceRecord` instead and reach the ledger not at all. A derivation
// reading only the authority ledger would have reported a fully proven case as merely OWNED. The inputs
// are therefore explicit.
//
// A FINDING REPORTED HERE AND DELIBERATELY NOT PATCHED. `revise()` writes `action: "Approve"`, the same
// token `approve()` writes, so the ledger cannot tell an original approval from a linked correction —
// the *stay distinguishable* rule failing on an existing governed surface. Changing the token written
// would change how every historical row is read, which is a governance decision with an owner, not an
// implementation detail to fix in passing. It costs this module nothing: `PROVEN` is derived from an
// EFFECTIVE proof, which is the stronger fact anyway — a reversed proof leaves its `Approve` row behind
// and must not read as proven.
//
// THE MONETARY SEPARATION IS ENFORCED BY THE TYPE SYSTEM, not by a naming convention. Observed exposure
// and proven Revenue Returned are branded, so the compiler refuses to put one where the other belongs,
// and `ProvenRevenueReturned` cannot be minted without naming the proof it came from. The constitution's
// rule is that the day a forecast is summed into a proven number the moat is gone; a convention is not a
// mechanism, and this is the mechanism.
import type { Money } from "./money";

declare const EXPOSURE_BRAND: unique symbol;
declare const RETURNED_BRAND: unique symbol;

/**
 * What a detector says is AT RISK. Never recovered, never proven, never summed into a ledger.
 *
 * On the activation entry this figure arrives as a REQUEST INPUT rather than being derived from customer
 * data, so it is doubly not evidence of anything. The brand stops it reaching the other field; the label
 * is what stops a reader mistaking it.
 */
export type ObservedExposure = Money & { readonly [EXPOSURE_BRAND]: "observed_exposure" };

/** Money a verified proof chain established as returned. Mintable only by naming that proof. */
export type ProvenRevenueReturned = Money & { readonly [RETURNED_BRAND]: "proven_revenue_returned" };

export function observedExposure(amount: Money): ObservedExposure {
  return amount as ObservedExposure;
}

/**
 * Brand an amount as proven. Requires EVERY proof it was summed from, so the call site has to have the
 * proofs in hand and the amount stays attributable to all of them.
 *
 * A LIST, NOT ONE ID, because the case ledger sums effective proofs — `cfoAuditExport` does exactly that
 * — and a sum over N proofs that names one of them is an attribution claim the evidence does not make.
 * An empty list, or one with a blank entry, throws rather than returning a zero: "we could not find a
 * proof" and "a proof established nothing" are different claims, and the second is almost never what
 * happened.
 */
export function provenRevenueReturned(
  amount: Money,
  fromProofIds: readonly string[],
): ProvenRevenueReturned {
  if (fromProofIds.length === 0 || fromProofIds.some((id) => !id.trim())) {
    throw new Error(
      "provenRevenueReturned requires every proof it came from: an amount with no proof behind it is " +
        "not proven revenue, and returning zero here would assert that a proof found nothing",
    );
  }
  return amount as ProvenRevenueReturned;
}

/** Every action the authority ledger's three writers actually record. Enumerated from the code. */
export type AuthorityAction =
  | "PromoteCandidate"
  | "Author"
  | "Intervene"
  | "Approve"
  | "Verify"
  | "Flag"
  | "Halt"
  | "Exclude";

export const AUTHORITY_ACTIONS: readonly AuthorityAction[] = Object.freeze([
  "PromoteCandidate",
  "Author",
  "Intervene",
  "Approve",
  "Verify",
  "Flag",
  "Halt",
  "Exclude",
]);

/** How far a case has got. Ordered, and the order is the definition. */
export type CaseProgress = "OPENED" | "OWNED" | "BASELINED" | "INTERVENED" | "EVIDENCED" | "PROVEN";

export const CASE_PROGRESS_ORDER: readonly CaseProgress[] = Object.freeze([
  "OPENED",
  "OWNED",
  "BASELINED",
  "INTERVENED",
  "EVIDENCED",
  "PROVEN",
]);

/**
 * A governance marker. REPORTED ALONGSIDE progress, not instead of it.
 *
 * Collapsing these into one status would hide that a halted case was already proven, or that an excluded
 * case has a complete evidence trail — and a halt is supposed to make a case MORE inspectable, which
 * `caseGuard.ts` says in as many words. The same *stay distinguishable* rule that keeps
 * `leakInstanceIdentityStatus` and `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` apart.
 */
export type CaseGovernanceMarker = "FLAGGED" | "HALTED" | "EXCLUDED";

export interface AuthorityEntry {
  readonly actorId: string;
  readonly role: string;
  readonly action: string;
  readonly at: string;
}

export interface CaseRoot {
  readonly recoveryCaseId: string;
  readonly boundaryId: string;
  readonly sourceCandidateId: string;
  readonly recoveryType: string;
  readonly sourceRef: string;
  readonly detectorVersion: string;
  readonly openedByActorId: string;
  readonly openedByRole: string;
  readonly openedAt: string;
  readonly amountAtRiskMinor: number;
  readonly currency: string;
}

export interface CaseLifecycleInput {
  readonly root: CaseRoot;
  readonly authority: readonly AuthorityEntry[];
  readonly baselineCount: number;
  readonly evidenceCount: number;
  /**
   * Computed by the caller from `effectiveProofs`/`provenLedger`, NOT re-derived here.
   *
   * `null` means no effective proof exists. It is deliberately not `0`: a second implementation of the
   * ledger rule is a second thing that can drift from it, and a zero would assert that a proof was found
   * and established nothing.
   */
  readonly provenRevenueReturned: { readonly amount: Money; readonly proofIds: readonly string[] } | null;
}

export interface CaseTransition {
  readonly action: string;
  readonly actorId: string;
  readonly role: string;
  readonly at: string;
}

export interface CaseLifecycle {
  readonly recoveryCaseId: string;
  readonly progress: CaseProgress;
  readonly governance: readonly CaseGovernanceMarker[];
  /** Who holds the case. The `Author` event's actor — null until one exists. */
  readonly responsible: { readonly actorId: string; readonly role: string } | null;
  readonly trail: readonly CaseTransition[];
  /**
   * True when two or more authority rows share a timestamp, so the trail's order is not established.
   *
   * `AuthorityEvent.at` is `@default(now())` with NO append-sequence column — the same shape the
   * execution-event slice fixed with a Postgres sequence after measuring 4 ties in 40 trials. The
   * headline below is computed from SET MEMBERSHIP, so a tie cannot change it; the trail's order can be
   * ambiguous and says so rather than being silently resolved.
   */
  readonly trailOrderCertain: boolean;
  readonly exposure: ObservedExposure;
  /** `null` = NOT COMPUTED. Never zero-for-absent. */
  readonly revenueReturned: ProvenRevenueReturned | null;
  /** Structural, so no renderer can imply otherwise. */
  readonly exposureIsNotRecoveredRevenue: true;
}

const isAction = (value: string): value is AuthorityAction =>
  (AUTHORITY_ACTIONS as readonly string[]).includes(value);

/** The furthest progress state the history supports. */
function deriveProgress(input: CaseLifecycleInput): CaseProgress {
  const actions = new Set(input.authority.map((a) => a.action));
  // Highest first: a proven case is proven whatever else is recorded.
  if (input.provenRevenueReturned !== null) return "PROVEN";
  if (input.evidenceCount > 0) return "EVIDENCED";
  if (actions.has("Intervene")) return "INTERVENED";
  if (input.baselineCount > 0) return "BASELINED";
  if (actions.has("Author")) return "OWNED";
  return "OPENED";
}

function deriveGovernance(input: CaseLifecycleInput): readonly CaseGovernanceMarker[] {
  const actions = new Set(input.authority.map((a) => a.action));
  const markers: CaseGovernanceMarker[] = [];
  if (actions.has("Flag")) markers.push("FLAGGED");
  if (actions.has("Halt")) markers.push("HALTED");
  if (actions.has("Exclude")) markers.push("EXCLUDED");
  return Object.freeze(markers);
}

/**
 * Derive the lifecycle. PURE: no clock, no database, no randomness, no I/O.
 *
 * An unrecognised authority action is kept in the trail and ignored for the status. It is not an error:
 * the ledger is append-only and older rows may carry an action this build does not know, and refusing to
 * render a historical case because of a vocabulary addition would make the audit surface LESS available
 * exactly where it matters. It cannot promote a case either, since the status reads known actions only.
 */
export function deriveCaseLifecycle(input: CaseLifecycleInput): CaseLifecycle {
  const trail: readonly CaseTransition[] = Object.freeze(
    input.authority.map((a) =>
      Object.freeze({ action: a.action, actorId: a.actorId, role: a.role, at: a.at }),
    ),
  );
  const stamps = input.authority.map((a) => a.at);
  const author = input.authority.find((a) => a.action === "Author") ?? null;

  return Object.freeze({
    recoveryCaseId: input.root.recoveryCaseId,
    progress: deriveProgress(input),
    governance: deriveGovernance(input),
    responsible: author === null ? null : Object.freeze({ actorId: author.actorId, role: author.role }),
    trail,
    trailOrderCertain: new Set(stamps).size === stamps.length,
    exposure: observedExposure({
      minor: input.root.amountAtRiskMinor,
      currency: input.root.currency,
    } as Money),
    revenueReturned:
      input.provenRevenueReturned === null
        ? null
        : provenRevenueReturned(input.provenRevenueReturned.amount, input.provenRevenueReturned.proofIds),
    exposureIsNotRecoveredRevenue: true as const,
  });
}

/** Known actions only, for a caller that wants to report what it ignored. */
export function unknownAuthorityActions(entries: readonly AuthorityEntry[]): readonly string[] {
  return Object.freeze([...new Set(entries.map((e) => e.action).filter((a) => !isAction(a)))].sort());
}
