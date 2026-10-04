// EP-31 · Staging the per-account at-risk attribution a governed signal is later derived from.
//
// WHY STAGING EXISTS AT ALL. The account identity exists for exactly one moment: while the accepted
// cycles are in memory at schedule time. `projectExecutionInput` then replaces it with a
// first-appearance ordinal whose mapping is deliberately not stored and not recoverable, and the worker
// reads only that projection. So a signal cannot be derived where the finding is computed — the identity
// is gone by then, and the ordinals are row-order dependent, which would make one account two candidates
// on the next export. The attribution is therefore derived HERE and read LATER.
//
// AND WHY IT IS ONLY STAGING. A candidate must be strictly downstream of a COMPLETED execution: one that
// existed earlier could sit in a review queue pointing at a governed result that never arrived. So this
// module writes a derivation artefact, in the execution's own transaction, and stops. Nothing here knows
// what a CandidateSignal is, and nothing here can create one.
//
// IDENTITY IS PSEUDONYMOUS AND STABLE. The reference is
// `hmac-sha256:HMAC(key, boundaryId ‖ NUL ‖ entityId)` — the same scheme and the same key as secure CSV
// ingestion, so the two lanes cannot disagree about who an account is. It depends on nothing but the
// boundary and the customer's own account id, which is the property that matters: row order, row count,
// file bytes, `asOf` and the execution id can all change and the pseudonym does not. One account stays
// one candidate across re-exports. (It does rest on the customer using a stable `entity_id`; if they do
// not, nothing downstream can recover it, and the review gate is what contains that.)
import { createHmac } from "node:crypto";
import {
  attributeByEntity,
  attributionReconciles,
  type EntityAttributionResult,
} from "../../src/assessment/entityAttribution";
import type { ExpectationCycle } from "../../src/assessment/types";
import type { AssessmentPolicy } from "../../src/assessment/policy";
import type { Money } from "../../src/domain/money";
import { leakInstanceIdentityStatus } from "../../src/contract/leakInstanceIdentity";

export const SIGNAL_EMITTER_ENABLED_VARIABLE = "NH_PILOT_SIGNAL_EMITTER_ENABLED";
export const SIGNAL_EMITTER_BOUNDARIES_VARIABLE = "NH_PILOT_SIGNAL_EMITTER_BOUNDARIES";
export const SOURCE_REF_KEY_VARIABLE = "NH_INGEST_SOURCE_REF_KEY";

/** Minimum HMAC key length, matching `secureCsvIngestion` exactly rather than choosing a second bar. */
const MIN_SOURCE_REF_KEY_BYTES = 32;

/** One staged row, ready for the execution's transaction. No raw identifier survives into it. */
export interface StagedAttribution {
  readonly sourceRef: string;
  readonly amountAtRiskMinor: number;
  readonly currency: string;
  readonly contributingCycleCount: number;
  readonly attributionRule: string;
}

export interface SignalStagingConfig {
  /** Boundaries allowed to stage. EMPTY means off everywhere, even with the master switch on. */
  readonly boundaries: ReadonlySet<string>;
  readonly sourceRefKey: string;
}

/**
 * Resolve the staging configuration, or `null` for "off".
 *
 * OFF IS THE DEFAULT AND UNSET IS OFF. Only an explicit `"true"` enables; `"false"` disables; anything
 * else is a configuration error rather than a silent default, because a bridge into the Case lane that
 * switched itself on because a variable was misspelled would be the wrong kind of surprise. This mirrors
 * `optIn` in `activationDetector.ts` instead of inventing a second convention.
 *
 * PER BOUNDARY, NOT PER PROCESS. The agent handlers run for every id in `NH_AGENT_BOUNDARIES`, so a
 * single process-wide flag would switch this on for every tenant at once. The allowlist is the second
 * gate and both must pass.
 *
 * THE KEY IS VALIDATED HERE, AT BOOT, NOT AT REQUEST TIME. A missing or short key with an allowlisted
 * boundary is a misconfiguration, and the honest place to refuse it is startup. Discovering it per
 * request would leave a running server that silently stages nothing.
 */
export function resolveSignalStagingConfig(
  env: Readonly<Record<string, string | undefined>>,
): SignalStagingConfig | null {
  const enabled = env[SIGNAL_EMITTER_ENABLED_VARIABLE];
  if (enabled === undefined || enabled === "false") return null;
  if (enabled !== "true") throw new Error(`${SIGNAL_EMITTER_ENABLED_VARIABLE} must be true or false`);

  const boundaries = new Set(
    (env[SIGNAL_EMITTER_BOUNDARIES_VARIABLE] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value !== ""),
  );
  // Enabled with no allowlist is off everywhere, and needs no key. Deliberately not an error: it is the
  // state a deployment passes through while a boundary is being enrolled.
  if (boundaries.size === 0) return { boundaries, sourceRefKey: "" };

  const sourceRefKey = env[SOURCE_REF_KEY_VARIABLE] ?? "";
  if (Buffer.byteLength(sourceRefKey, "utf8") < MIN_SOURCE_REF_KEY_BYTES) {
    throw new Error(
      `${SOURCE_REF_KEY_VARIABLE} must be at least ${MIN_SOURCE_REF_KEY_BYTES} bytes when ` +
        `${SIGNAL_EMITTER_BOUNDARIES_VARIABLE} names any boundary`,
    );
  }
  return { boundaries, sourceRefKey };
}

/** Both gates: the master switch produced a config, and this boundary is named in it. */
export function mayStage(config: SignalStagingConfig | null, boundaryId: string): boolean {
  return config !== null && config.boundaries.has(boundaryId);
}

/**
 * The pseudonymous account reference. Boundary-scoped, so the same account in two tenants is two
 * different references and neither can be linked to the other.
 */
export function stagedSourceRef(sourceRefKey: string, boundaryId: string, entityId: string): string {
  const digest = createHmac("sha256", sourceRefKey).update(`${boundaryId}\0${entityId}`).digest("hex");
  return `hmac-sha256:${digest}`;
}

/**
 * Why candidate-capable staging did not happen. A NAMED outcome, never a thrown error.
 *
 * `boundary_not_enrolled` is the ordinary case and not a fault at all.
 * `leak_instance_identity_unavailable` is the standing blocker under the current contract.
 * `attribution_did_not_reconcile` was a THROWN error before EP-31c, which meant a divergence between the
 * per-account figures and the aggregate would abort the whole schedule request — a candidate-side fault
 * taking an ordinary assessment with it. It is fatal to staging and to nothing else now.
 */
export type CandidateStagingBlockedReason =
  | "boundary_not_enrolled"
  | "leak_instance_identity_unavailable"
  | "attribution_did_not_reconcile";

export interface CandidateStagingDecision {
  readonly staged: boolean;
  readonly reason: CandidateStagingBlockedReason | null;
  /** A sentence naming the cause. Never echoes a customer value. */
  readonly detail: string;
  /** ALWAYS empty when `staged` is false. There is no partial staging. */
  readonly attributions: readonly StagedAttribution[];
}

function blocked(reason: CandidateStagingBlockedReason, detail: string): CandidateStagingDecision {
  return Object.freeze({ staged: false, reason, detail, attributions: Object.freeze([]) });
}

/**
 * Decide what to stage for one execution — and NEVER THROW.
 *
 * THE INVARIANT THIS FILE EXISTS TO KEEP: *ordinary assessment may complete without leak-instance
 * identity; candidate-capable staging may not.* So every way this can decline is a typed, named result
 * that the caller records beside a perfectly normal execution. Throwing would convert a candidate-side
 * limitation into an assessment availability failure, which is the one outcome the design forbids.
 *
 * The order of the checks is the order of their cost, and each is reported in its own right rather than
 * collapsed into "nothing was staged".
 */
export function deriveStagedAttributions(
  config: SignalStagingConfig | null,
  boundaryId: string,
  cycles: readonly ExpectationCycle[],
  policy: AssessmentPolicy,
  aggregate: { readonly observedUnpaid: Money; readonly partialOutstanding: Money },
): CandidateStagingDecision {
  if (!mayStage(config, boundaryId)) {
    return blocked(
      "boundary_not_enrolled",
      "this boundary is not enrolled for candidate-capable staging, which is the default",
    );
  }

  // RECONCILIATION IS CHECKED BEFORE THE IDENTITY GATE, on purpose.
  //
  // The attribution does not depend on the occurrence key at all — `attributeByEntity` groups by
  // `entityId`, and the leak-instance identity would only ever enter at `stagedSourceRef`, which is
  // reached solely in the `staged: true` branch below. So computing it here builds nothing under an
  // unproven key, and putting the identity gate first would instead turn this check into dead code behind
  // a permanent block: a divergence between the per-account figures and the assessment total would stop
  // being reported for as long as identity is unavailable. It stays live.
  const result: EntityAttributionResult = attributeByEntity(cycles, policy);
  if (!attributionReconciles(result, aggregate.observedUnpaid, aggregate.partialOutstanding)) {
    // Fatal to staging, and to nothing else: candidates nobody can tie back to the finding are worse
    // than no candidates, but the finding itself is unaffected and the execution completes.
    return blocked(
      "attribution_did_not_reconcile",
      `the per-account figures do not sum to the assessment total (expected ` +
        `${aggregate.observedUnpaid.minor + aggregate.partialOutstanding.minor}, got ${result.totalAtRisk.minor})`,
    );
  }

  // THE STANDING BLOCKER, and the last word on whether anything is staged. Under the current data
  // contract this is always taken: no declared field can establish a stable obligation identity, so no
  // row may be written under a key that cannot tell one occurrence from the next.
  const identity = leakInstanceIdentityStatus();
  if (!identity.establishable) {
    return blocked("leak_instance_identity_unavailable", identity.detail);
  }

  return Object.freeze({
    staged: true,
    reason: null,
    detail: "candidate-capable attribution staged",
    attributions: Object.freeze(
      result.attributions.map((attribution) =>
        Object.freeze({
          sourceRef: stagedSourceRef(config!.sourceRefKey, boundaryId, attribution.entityId),
          amountAtRiskMinor: attribution.amountAtRisk.minor,
          currency: attribution.amountAtRisk.currency,
          contributingCycleCount: attribution.contributingCycleCount,
          attributionRule: result.rule,
        }),
      ),
    ),
  });
}
