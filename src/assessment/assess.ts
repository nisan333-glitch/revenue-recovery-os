// Assessment orchestration — pure and deterministic. Given the adapter's per-row outcomes and a
// policy, it detects cycleId collisions (rejecting ALL colliding rows, never picking a "winner"),
// splits the deviation cohort, computes the Observed summary, and stamps a fully reproducible result.
// Estimated and Forecast are structurally unavailable; Proven is structurally zero.
import type { AssessmentPolicy } from "./policy";
import type { AssessmentResult, ExclusionRecord, ExpectationCycle, RowOutcome } from "./types";
import { splitCohorts } from "./cohort";
import { observedSummary } from "./observed";
import { shortHash, fingerprintSource } from "./fingerprint";
import { parseCsv } from "./parse";
import { toCycle, SAAS_ADAPTER_ID, SAAS_ADAPTER_VERSION, type AdapterOptions } from "./adapters/saasActivation";
import { PARSER_VERSION } from "./parse";
import { zeroMoney } from "../domain/money";

export interface AssessMeta {
  readonly fingerprint: string;
  readonly fingerprintAlgo: string;
  readonly createdAt: string; // caller-supplied (deterministic input)
  readonly adapterId: string;
  readonly adapterVersion: string;
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

  const { stalled, reference } = splitCohorts(unique, policy);
  const observed = observedSummary(stalled, policy);

  const assessmentId =
    "A-" +
    shortHash(
      [meta.fingerprint, policy.policyId, policy.policyVersion, policy.asOf, policy.stallThresholdDays, policy.calculationMethodVersion].join(
        "|",
      ),
    );

  return Object.freeze({
    assessmentId,
    createdAt: meta.createdAt,
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
    referenceCount: reference.length,
    observed,
    estimated: "unavailable_in_validation_slice" as const,
    forecast: "unavailable_in_validation_slice" as const,
    proven: zeroMoney(policy.currency),
  }) as AssessmentResult;
}

/**
 * Convenience end-to-end runner used by the UI (CP4). Async only because the source fingerprint uses
 * a one-way crypto hash where available. The heavy lifting (`assess`) stays pure and synchronous.
 */
export async function assessCsv(
  csvText: string,
  policy: AssessmentPolicy,
  opts: AdapterOptions & { createdAt: string },
): Promise<AssessmentResult> {
  const parsed = parseCsv(csvText);
  const outcomes = parsed.rows.map((r) => toCycle(r, policy, opts));
  const fp = await fingerprintSource(csvText);
  return assess(outcomes, policy, {
    fingerprint: fp.hash,
    fingerprintAlgo: fp.algo,
    createdAt: opts.createdAt,
    adapterId: SAAS_ADAPTER_ID,
    adapterVersion: SAAS_ADAPTER_VERSION,
  });
}
