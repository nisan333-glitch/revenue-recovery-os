// Assessment orchestration — pure and deterministic. Given the adapter's per-row outcomes and a
// policy, it detects cycleId collisions (rejecting ALL colliding rows, never picking a "winner"),
// splits the deviation cohort, computes the Observed summary, and stamps a fully reproducible result.
// Estimated and Forecast are structurally unavailable; Proven is structurally zero.
import type { AssessmentPolicy } from "./policy";
import type { AssessmentResult, ColumnMapping, ExclusionRecord, ExpectationCycle, RowOutcome } from "./types";
import { splitCohorts } from "./cohort";
import { observedSummary } from "./observed";
import { shortHash, fingerprintSource } from "./fingerprint";
import { parseCsv } from "./parse";
import {
  toCycle,
  missingRequiredColumns,
  SAAS_ADAPTER_ID,
  SAAS_ADAPTER_VERSION,
  SAAS_MAPPING_SPEC,
  type AdapterOptions,
} from "./adapters/saasActivation";
import { autoDetectMapping, applyMapping, mappingId } from "./columnMap";
import { PARSER_VERSION } from "./parse";
import { zeroMoney } from "../domain/money";

export interface AssessMeta {
  readonly fingerprint: string;
  readonly fingerprintAlgo: string;
  readonly createdAt: string; // caller-supplied (deterministic input)
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly columnMapping: ColumnMapping;
  readonly mappingId: string;
  readonly amountFormat: string; // "US" | "EU" | "auto"
  readonly dateLocale: string; // "MDY" | "DMY" | "auto"
}

/** Reject cycleId collisions: every row sharing a duplicated cycleId is excluded and reported. */
function dedupeCollisions(cycles: ExpectationCycle[]): {
  unique: ExpectationCycle[];
  collisions: ExclusionRecord[];
} {
  const byId = new Map<string, ExpectationCycle[]>();
  for (const c of cycles) {
    const arr = byId.get(c.cycleId) ?? [];
    arr.push(c);
    byId.set(c.cycleId, arr);
  }
  const unique: ExpectationCycle[] = [];
  const collisions: ExclusionRecord[] = [];
  for (const [cycleId, group] of byId) {
    if (group.length === 1) {
      unique.push(group[0]!);
    } else {
      for (const c of group) {
        collisions.push({ sourceRowId: c.sourceRowId, reason: "duplicate_cycle_id", detail: cycleId });
      }
    }
  }
  return { unique, collisions };
}

export function assess(outcomes: readonly RowOutcome[], policy: AssessmentPolicy, meta: AssessMeta): AssessmentResult {
  const rawCycles: ExpectationCycle[] = [];
  const exclusions: ExclusionRecord[] = [];
  for (const o of outcomes) {
    if (o.kind === "cycle") rawCycles.push(o.cycle);
    else exclusions.push(o.exclusion);
  }

  const { unique, collisions } = dedupeCollisions(rawCycles);
  const allExclusions = [...exclusions, ...collisions];

  const { stalled, undetermined, reference } = splitCohorts(unique, policy);
  const observed = observedSummary(stalled, policy);

  const assessmentId =
    "A-" +
    shortHash(
      [
        meta.fingerprint,
        policy.policyId,
        policy.policyVersion,
        policy.asOf,
        policy.stallThresholdDays,
        policy.calculationMethodVersion,
        meta.mappingId, // same file + policy + mapping ⇒ same id; a different mapping ⇒ a different id
        meta.amountFormat, // a different amount/date interpretation changes the numbers ⇒ a different id
        meta.dateLocale,
      ].join("|"),
    );

  return Object.freeze({
    assessmentId,
    createdAt: meta.createdAt,
    columnMapping: meta.columnMapping,
    mappingId: meta.mappingId,
    amountFormat: meta.amountFormat,
    dateLocale: meta.dateLocale,
    sourceFingerprint: meta.fingerprint,
    fingerprintAlgo: meta.fingerprintAlgo,
    adapterId: meta.adapterId,
    adapterVersion: meta.adapterVersion,
    parserVersion: PARSER_VERSION,
    policy,
    acceptedCycleCount: unique.length,
    excludedRowCount: allExclusions.length,
    exclusions: Object.freeze(allExclusions),
    stalledCount: stalled.length,
    undeterminedCount: undetermined.length,
    referenceCount: reference.length,
    observed,
    estimated: "unavailable_in_validation_slice" as const,
    forecast: "unavailable_in_validation_slice" as const,
    proven: zeroMoney(policy.currency),
  }) as AssessmentResult;
}

export interface MappingPlan {
  readonly headers: string[]; // the raw source headers, for a UI picker
  readonly mapping: ColumnMapping; // auto-detected canonical → source
  readonly requiredFields: string[]; // all required canonicals (for the confirm UI)
  readonly unmatchedRequired: string[]; // required canonicals the UI MUST resolve before running
  /** True when the operator should review the mapping: a required field is unmatched OR matched by a guess. */
  readonly needsReview: boolean;
}

/**
 * Pure pre-flight: what the auto-detector makes of a CSV's headers. The UI uses this to decide whether
 * to run directly (every required column matched EXACTLY) or to show a confirmation/mapping step when
 * a required column is missing or was matched only by a synonym guess.
 */
export function planColumnMapping(csvText: string): MappingPlan {
  const parsed = parseCsv(csvText);
  const { mapping, unmatchedRequired, synonymMatched } = autoDetectMapping(parsed.headers, SAAS_MAPPING_SPEC);
  const requiredFields = [...SAAS_MAPPING_SPEC.requiredFields];
  const requiredMatchedByGuess = requiredFields.filter((f) => synonymMatched.includes(f));
  const needsReview = unmatchedRequired.length > 0 || requiredMatchedByGuess.length > 0;
  return { headers: parsed.headers, mapping, requiredFields, unmatchedRequired, needsReview };
}

/**
 * Convenience end-to-end runner used by the UI (CP4). Async only because the source fingerprint uses
 * a one-way crypto hash where available. The heavy lifting (`assess`) stays pure and synchronous.
 *
 * A `mapping` may be supplied (from a guided mapping step); otherwise it is auto-detected from the
 * headers. The mapping is applied BEFORE the adapter, so a real export whose columns are named
 * differently still runs — and the mapping is stamped into the result for reproducibility.
 */
export async function assessCsv(
  csvText: string,
  policy: AssessmentPolicy,
  opts: AdapterOptions & { createdAt: string; mapping?: ColumnMapping },
): Promise<AssessmentResult> {
  const parsed = parseCsv(csvText);
  const mapping = opts.mapping ?? autoDetectMapping(parsed.headers, SAAS_MAPPING_SPEC).mapping;
  const mapped = applyMapping(parsed, mapping);
  // Structural guard: a header missing required columns (wrong file, bad export, unmapped) must fail
  // LOUDLY, never silently exclude every row and report zero accepted cycles.
  const missing = missingRequiredColumns(mapped.headers);
  if (missing.length > 0) {
    throw new Error(`CSV is missing required column(s): ${missing.join(", ")}`);
  }
  const outcomes = mapped.rows.map((r) => toCycle(r, policy, opts));
  const fp = await fingerprintSource(csvText);
  return assess(outcomes, policy, {
    fingerprint: fp.hash,
    fingerprintAlgo: fp.algo,
    createdAt: opts.createdAt,
    adapterId: SAAS_ADAPTER_ID,
    adapterVersion: SAAS_ADAPTER_VERSION,
    columnMapping: mapping,
    mappingId: mappingId(mapping),
    amountFormat: opts.amountFormat ?? "auto",
    dateLocale: opts.locale ?? "auto",
  });
}
