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

/** Thrown when the per-account figures do not sum to the aggregate. Stops the write rather than staging. */
export class AttributionReconciliationError extends Error {
  constructor(readonly expectedMinor: number, readonly actualMinor: number) {
    super(
      `staged attribution does not reconcile with the assessment total (expected ${expectedMinor}, got ${actualMinor}); ` +
        "no attribution was staged",
    );
    this.name = "AttributionReconciliationError";
  }
}

/**
 * Derive the rows to stage for one execution, or an empty list when staging is off for this boundary.
 *
 * THE RECONCILIATION IS CHECKED HERE, not only in the tests. If the per-account figures ever stopped
 * summing to `observedUnpaid + partialOutstanding`, the two computations would have diverged — and
 * candidates nobody can tie back to the finding are worse than no candidates. So the mismatch throws and
 * nothing is staged.
 */
export function deriveStagedAttributions(
  config: SignalStagingConfig | null,
  boundaryId: string,
  cycles: readonly ExpectationCycle[],
  policy: AssessmentPolicy,
  aggregate: { readonly observedUnpaid: Money; readonly partialOutstanding: Money },
): readonly StagedAttribution[] {
  if (!mayStage(config, boundaryId)) return Object.freeze([]);
  const result: EntityAttributionResult = attributeByEntity(cycles, policy);
  if (!attributionReconciles(result, aggregate.observedUnpaid, aggregate.partialOutstanding)) {
    throw new AttributionReconciliationError(
      aggregate.observedUnpaid.minor + aggregate.partialOutstanding.minor,
      result.totalAtRisk.minor,
    );
  }
  return Object.freeze(
    result.attributions.map((attribution) =>
      Object.freeze({
        sourceRef: stagedSourceRef(config!.sourceRefKey, boundaryId, attribution.entityId),
        amountAtRiskMinor: attribution.amountAtRisk.minor,
        currency: attribution.amountAtRisk.currency,
        contributingCycleCount: attribution.contributingCycleCount,
        attributionRule: result.rule,
      }),
    ),
  );
}
