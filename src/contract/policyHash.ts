// EP-15 · Deterministic hash of an admission policy.
//
// WHY A HASH AND NOT JUST id@version. A decision stamped with "pol-x@1.0.0" is only as trustworthy
// as the guarantee that pol-x@1.0.0 still means what it meant. The hash removes the need for that
// guarantee: it is computed from the thresholds themselves, so a historical decision carries proof
// of the exact bar it was judged under. If a row were ever altered — by a migration, a restore, or
// a bug — the stored hash and the recomputed hash diverge and the tampering is visible rather than
// silent.
//
// CANONICAL AND ORDERED. Fields are serialized in a fixed order, never by object-key enumeration,
// so the same policy always hashes identically regardless of how it was constructed or round-tripped
// through JSON. Numbers are rendered with an explicit fixed representation, so 0.2 and 0.20 cannot
// produce two different hashes for the same bar.
import { sha256Hex } from "../assessment/fingerprint";
import type { PilotAdmissionPolicy } from "./pilotAdmissionPolicy";

/** Version of the hashing scheme itself. A change here is a new scheme, not a re-grade. */
export const POLICY_HASH_SCHEME = "nh-admission-policy-v1";

/** Fixed field order. Adding a threshold means a new scheme version, never an append here. */
function canonicalize(policy: PilotAdmissionPolicy): string {
  const fields: readonly (string | number | boolean)[] = [
    POLICY_HASH_SCHEME,
    policy.policyId,
    policy.policyVersion,
    policy.calculationMethodVersion,
    policy.minAcceptedRows,
    policy.minDistinctEntities,
    // Rates are rendered to a fixed precision so 0.2 and 0.20 cannot hash differently.
    policy.maxRejectionRate.toFixed(6),
    policy.maxSingleReasonShare.toFixed(6),
    policy.maxDuplicateRate.toFixed(6),
    policy.minCoverageDays,
    // Sorted: ["stalled","reference"] and ["reference","stalled"] are the same requirement.
    [...policy.requiredLifecycleStates].sort().join(","),
    policy.maxOrderingDefectRate.toFixed(6),
    policy.maxMissingRecommendedColumns,
    policy.requireProvenanceDeclaration,
  ];
  // NUL-separated so no field value can impersonate a separator and shift the others.
  return fields.map(String).join("\u0000");
}

/** `sha256:<64 hex>` over the canonical form. */
export async function hashAdmissionPolicy(policy: PilotAdmissionPolicy): Promise<string> {
  return `sha256:${await sha256Hex(canonicalize(policy))}`;
}

/**
 * Does this policy still hash to what a decision recorded? A false answer means the stored policy
 * no longer matches the bar the decision was judged under — which is a tampering signal, not a
 * reason to recompute and carry on.
 */
export async function policyHashMatches(policy: PilotAdmissionPolicy, expected: string): Promise<boolean> {
  return (await hashAdmissionPolicy(policy)) === expected;
}
