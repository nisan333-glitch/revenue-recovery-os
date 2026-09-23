// EP-14 · The versioned policy the Pilot Assessment Admission Gate evaluates against.
//
// THE ONE RULE: there are no default thresholds, and there is no code path that supplies one.
//
// Every threshold below is REQUIRED. A policy missing one does not fall back to "no limit" or to a
// figure someone once found reasonable — it makes the dataset NOT_ASSESSABLE, naming the threshold
// that was not set. The reason is not fussiness: a fitness bar ("how many rejected rows is too
// many?") is a commercial judgement belonging to the people running the pilot. A system that picks
// its own bar is grading its own homework, and the number it picks will later be quoted as though
// someone chose it.
//
// This mirrors AssessmentPolicy (src/assessment/policy.ts): identity + version + method version,
// frozen at construction, stamped into every decision so a verdict is reproducible and a changed
// parameter produces a NEW decision rather than silently altering an old one.
import { POLICY_CODES, type AdmissionCodeSpec } from "./admissionCodes";

export const ADMISSION_CALC_VERSION = "admission-2026.1";

/** Lifecycle states a policy may require the accepted rows to contain. */
export type RequiredLifecycleState = "stalled" | "reference" | "undetermined";

export interface PilotAdmissionPolicy {
  readonly policyId: string;
  readonly policyVersion: string;
  /** Which evaluator computed the rates. A change here is a new decision, never a silent re-grade. */
  readonly calculationMethodVersion: string;

  /** Minimum accepted rows. A handful of survivors cannot characterise a population. */
  readonly minAcceptedRows: number;
  /** Minimum DISTINCT entities — many cycles from few accounts is not a large sample. */
  readonly minDistinctEntities: number;
  /** Maximum share of data rows that may be rejected, as a fraction 0..1. */
  readonly maxRejectionRate: number;
  /** Maximum share of rejections allowed to come from any single reason code, 0..1. */
  readonly maxSingleReasonShare: number;
  /** Maximum share of data rows that may be duplicates, 0..1. */
  readonly maxDuplicateRate: number;
  /** Minimum span, in days, between the earliest and latest obligation date in the accepted rows. */
  readonly minCoverageDays: number;
  /** Lifecycle states that must each be present among the accepted rows. */
  readonly requiredLifecycleStates: readonly RequiredLifecycleState[];
  /** Maximum share of rows that may carry an ordering defect, 0..1. */
  readonly maxOrderingDefectRate: number;
  /** Maximum number of recommended columns that may be absent from the export. */
  readonly maxMissingRecommendedColumns: number;
  /** Whether a provenance independence declaration must have been answered (either way). */
  readonly requireProvenanceDeclaration: boolean;
}

/** A threshold that was not set, or set to something impossible. */
export interface PolicyDefect {
  readonly spec: AdmissionCodeSpec;
  readonly field: string;
  readonly detail: string;
}

const RATE_FIELDS = [
  "maxRejectionRate",
  "maxSingleReasonShare",
  "maxDuplicateRate",
  "maxOrderingDefectRate",
] as const;

const COUNT_FIELDS = [
  "minAcceptedRows",
  "minDistinctEntities",
  "minCoverageDays",
  "maxMissingRecommendedColumns",
] as const;

const LIFECYCLE_STATES: readonly RequiredLifecycleState[] = ["stalled", "reference", "undetermined"];

/**
 * Check a candidate policy. Returns every defect rather than the first, so whoever configures the
 * pilot fixes the policy once instead of discovering the gaps one round trip at a time.
 *
 * `undefined`, `null` and `NaN` are all treated as NOT CONFIGURED — never as zero. Zero is a
 * meaningful, deliberate value ("no duplicates tolerated"); absence is a question nobody answered,
 * and the two must never collapse into each other.
 */
export function validateAdmissionPolicy(policy: unknown): readonly PolicyDefect[] {
  const defects: PolicyDefect[] = [];
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return Object.freeze([
      { spec: POLICY_CODES.POLICY_MISSING, field: "policy", detail: "no admission policy was supplied" },
    ]);
  }
  const p = policy as Record<string, unknown>;

  for (const field of ["policyId", "policyVersion", "calculationMethodVersion"] as const) {
    const value = p[field];
    if (typeof value !== "string" || !value.trim()) {
      defects.push({
        spec: POLICY_CODES.POLICY_VERSION_MALFORMED,
        field,
        detail: `${field} must be a non-empty string`,
      });
    }
  }

  for (const field of RATE_FIELDS) {
    const value = p[field];
    if (typeof value !== "number" || Number.isNaN(value)) {
      defects.push({ spec: POLICY_CODES.THRESHOLD_NOT_CONFIGURED, field, detail: `${field} is not configured` });
    } else if (value < 0 || value > 1) {
      defects.push({ spec: POLICY_CODES.THRESHOLD_INVALID, field, detail: `${field} must be a fraction between 0 and 1` });
    }
  }

  for (const field of COUNT_FIELDS) {
    const value = p[field];
    if (typeof value !== "number" || Number.isNaN(value)) {
      defects.push({ spec: POLICY_CODES.THRESHOLD_NOT_CONFIGURED, field, detail: `${field} is not configured` });
    } else if (!Number.isInteger(value) || value < 0) {
      defects.push({ spec: POLICY_CODES.THRESHOLD_INVALID, field, detail: `${field} must be a non-negative integer` });
    }
  }

  const states = p.requiredLifecycleStates;
  if (!Array.isArray(states)) {
    defects.push({
      spec: POLICY_CODES.THRESHOLD_NOT_CONFIGURED,
      field: "requiredLifecycleStates",
      detail: "requiredLifecycleStates is not configured (an empty list is a valid, explicit choice)",
    });
  } else if (states.some((s) => !LIFECYCLE_STATES.includes(s as RequiredLifecycleState))) {
    defects.push({
      spec: POLICY_CODES.THRESHOLD_INVALID,
      field: "requiredLifecycleStates",
      detail: `allowed states are ${LIFECYCLE_STATES.join(", ")}`,
    });
  }

  if (typeof p.requireProvenanceDeclaration !== "boolean") {
    defects.push({
      spec: POLICY_CODES.THRESHOLD_NOT_CONFIGURED,
      field: "requireProvenanceDeclaration",
      detail: "requireProvenanceDeclaration is not configured",
    });
  }

  return Object.freeze(defects);
}

/**
 * Build a frozen policy, or throw. Deliberately NOT forgiving: there is no partial constructor and
 * no merge-with-defaults, because either would reintroduce the invented threshold through the back
 * door. Callers that hold user input should call `validateAdmissionPolicy` and report the defects.
 */
export function makeAdmissionPolicy(input: PilotAdmissionPolicy): PilotAdmissionPolicy {
  const defects = validateAdmissionPolicy(input);
  if (defects.length > 0) {
    throw new Error(`PilotAdmissionPolicy is invalid: ${defects.map((d) => `${d.field} (${d.spec.code})`).join(", ")}`);
  }
  return Object.freeze({
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    calculationMethodVersion: input.calculationMethodVersion,
    minAcceptedRows: input.minAcceptedRows,
    minDistinctEntities: input.minDistinctEntities,
    maxRejectionRate: input.maxRejectionRate,
    maxSingleReasonShare: input.maxSingleReasonShare,
    maxDuplicateRate: input.maxDuplicateRate,
    minCoverageDays: input.minCoverageDays,
    requiredLifecycleStates: Object.freeze([...input.requiredLifecycleStates]),
    maxOrderingDefectRate: input.maxOrderingDefectRate,
    maxMissingRecommendedColumns: input.maxMissingRecommendedColumns,
    requireProvenanceDeclaration: input.requireProvenanceDeclaration,
  });
}

/** `id@version` — the form stamped into a decision. */
export function admissionPolicyRef(policy: PilotAdmissionPolicy): string {
  return `${policy.policyId}@${policy.policyVersion}`;
}
