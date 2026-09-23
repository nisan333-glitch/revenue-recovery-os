// EP-14 · Pilot Assessment Admission Gate — is this dataset FIT for a pilot?
//
// THE GAP THIS CLOSES. `usableForAssessment` means `accepted && acceptedRows > 0`. That is the right
// question for technical processing and the wrong one for pilot fitness: one surviving row among
// 9,999 rejected ones satisfies it, and nothing downstream ever re-asks. A pilot built on that
// dataset produces numbers whose representativeness was never examined — and the rejected 9,999 are
// invisible by then, so no reader can tell.
//
// THREE DISTINCT VERDICTS, none of which replaces another:
//   accepted                     — the file is structurally interpretable
//   usableForAssessment          — at least one valid cycle survived
//   admissibleForPilotAssessment — the dataset satisfies an explicit, versioned pilot policy
//
// FAIL CLOSED. The default is NOT_ASSESSABLE. A missing policy, an unset threshold, an
// uncomputable coverage window — each produces a coded refusal, never a substituted value. An
// unanswered question cannot be a passing answer.
//
// REJECTED ROWS NEVER ENTER. The evaluator reads accepted cycles plus the COUNTS and CODES of
// rejections. It never sees a rejected row's content, so no rejected value can influence a rate, a
// verdict, or anything computed later. Their EFFECT stays fully visible as rates and a reason
// distribution — an exclusion that disappears silently is how a biased dataset passes for a clean one.
//
// CREATES NOTHING. No money, no Proof, no Case, no revenue claim. It returns a judgement.
import type { AssessmentPolicy } from "../assessment/policy";
import type { ExpectationCycle } from "../assessment/types";
import { splitCohorts } from "../assessment/cohort";
import { epochDay } from "../assessment/dateNormalize";
import { fieldsByRequirement } from "./pilotDataContract";
import type { ContractValidationReport } from "./validateDataset";
import {
  admissionPolicyRef,
  validateAdmissionPolicy,
  type PilotAdmissionPolicy,
} from "./pilotAdmissionPolicy";
import {
  DATASET_CODES,
  EVALUATION_CODES,
  type AdmissionCodeSpec,
} from "./admissionCodes";

export type AdmissionOutcome = "ADMISSIBLE" | "NOT_ADMISSIBLE" | "NOT_ASSESSABLE";

/** One evaluated check. Always reports the measure AND the threshold it was judged against. */
export interface AdmissionCheck {
  readonly id: string;
  readonly label: string;
  readonly passed: boolean;
  /** The measured value, as a number (a rate 0..1, a count, or a day span). */
  readonly observed: number;
  /** The configured threshold this was compared to. */
  readonly threshold: number;
  /** "at_least" — observed must be >= threshold; "at_most" — observed must be <= threshold. */
  readonly direction: "at_least" | "at_most";
  readonly code: string | null;
  readonly detail: string;
}

export interface AdmissionReason {
  readonly code: string;
  readonly severity: AdmissionCodeSpec["severity"];
  readonly title: string;
  readonly remediation: string;
  readonly detail: string;
}

/** How rejections were distributed across reasons — the shape that reveals systematic defects. */
export interface RejectionReasonShare {
  readonly code: string;
  readonly count: number;
  readonly share: number;
}

export interface AdmissionDecision {
  readonly outcome: AdmissionOutcome;
  /** Convenience mirror of `outcome === "ADMISSIBLE"`. Never true for any other outcome. */
  readonly admissibleForPilotAssessment: boolean;
  readonly policyRef: string | null;
  readonly policyId: string | null;
  readonly policyVersion: string | null;
  readonly calculationMethodVersion: string;
  /** Ties the decision to the exact bytes judged. */
  readonly datasetFingerprint: string;
  readonly counts: {
    readonly dataRows: number;
    readonly acceptedRows: number;
    readonly rejectedRows: number;
    readonly duplicateRows: number;
    readonly orderingDefectRows: number;
    readonly distinctEntities: number;
    readonly coverageDays: number;
    readonly missingRecommendedColumns: number;
  };
  readonly rates: {
    readonly rejection: number;
    readonly duplicate: number;
    readonly orderingDefect: number;
    readonly largestSingleReasonShare: number;
  };
  readonly lifecyclePresent: {
    readonly stalled: number;
    readonly reference: number;
    readonly undetermined: number;
  };
  /** Rejections by reason code, most frequent first. Exclusions stay visible, never absorbed. */
  readonly rejectionDistribution: readonly RejectionReasonShare[];
  readonly checks: readonly AdmissionCheck[];
  readonly reasons: readonly AdmissionReason[];
  readonly claimBoundary: {
    readonly judgesFitnessOnly: true;
    readonly constitutesProof: false;
    readonly constitutesRevenue: false;
  };
}

export const ADMISSION_EVALUATOR_VERSION = "admission-gate-2026.1";

/** Codes whose presence on a row means the row's event ordering could not be trusted. */
const ORDERING_DEFECT_CODES: readonly string[] = Object.freeze([
  "NH-DC-2005", // wall-clock timestamp with no UTC offset
  "NH-DC-2006", // impossible date sequence
  "NH-DC-2003", // unparseable date
  "NH-DC-2004", // ambiguous numeric date
]);

/** Codes that mean the same record appeared twice. */
const DUPLICATE_CODES: readonly string[] = Object.freeze([
  "NH-DC-4001", // identical row repeated
  "NH-DC-2016", // two rows claiming one cycle identity
]);

function reason(spec: AdmissionCodeSpec, detail: string): AdmissionReason {
  return Object.freeze({
    code: spec.code,
    severity: spec.severity,
    title: spec.title,
    remediation: spec.remediation,
    detail,
  });
}

function check(
  id: string,
  label: string,
  observed: number,
  threshold: number,
  direction: AdmissionCheck["direction"],
  spec: AdmissionCodeSpec,
  detail: string,
): AdmissionCheck {
  const passed = direction === "at_least" ? observed >= threshold : observed <= threshold;
  return Object.freeze({
    id,
    label,
    passed,
    observed,
    threshold,
    direction,
    code: passed ? null : spec.code,
    detail,
  });
}

/** Rate helper. A zero denominator yields 0, never NaN — and never a silent pass. */
function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function notAssessable(
  fingerprint: string,
  policy: PilotAdmissionPolicy | null,
  reasons: readonly AdmissionReason[],
): AdmissionDecision {
  return Object.freeze({
    outcome: "NOT_ASSESSABLE" as const,
    admissibleForPilotAssessment: false,
    policyRef: policy ? admissionPolicyRef(policy) : null,
    policyId: policy?.policyId ?? null,
    policyVersion: policy?.policyVersion ?? null,
    calculationMethodVersion: ADMISSION_EVALUATOR_VERSION,
    datasetFingerprint: fingerprint,
    counts: Object.freeze({
      dataRows: 0,
      acceptedRows: 0,
      rejectedRows: 0,
      duplicateRows: 0,
      orderingDefectRows: 0,
      distinctEntities: 0,
      coverageDays: 0,
      missingRecommendedColumns: 0,
    }),
    rates: Object.freeze({ rejection: 0, duplicate: 0, orderingDefect: 0, largestSingleReasonShare: 0 }),
    lifecyclePresent: Object.freeze({ stalled: 0, reference: 0, undetermined: 0 }),
    rejectionDistribution: Object.freeze([]),
    checks: Object.freeze([]),
    reasons: Object.freeze([...reasons]),
    claimBoundary: Object.freeze({ judgesFitnessOnly: true, constitutesProof: false, constitutesRevenue: false }),
  });
}

/**
 * Evaluate one dataset against one admission policy.
 *
 * Pure and deterministic: no clock, no randomness, no I/O. The same report and policy always yield
 * a byte-identical decision, which is what makes a refusal something a customer can be shown and an
 * approval something that can be re-derived later.
 */
export function evaluateAdmission(
  report: ContractValidationReport,
  assessmentPolicy: AssessmentPolicy,
  admissionPolicy: PilotAdmissionPolicy | null | undefined,
): AdmissionDecision {
  // 1 · The policy must be complete BEFORE anything is measured. Measuring against thresholds that
  //     do not exist would produce a number that looks like a verdict.
  const defects = validateAdmissionPolicy(admissionPolicy);
  if (defects.length > 0) {
    return notAssessable(
      report.datasetFingerprint,
      null,
      defects.map((d) => reason(d.spec, `${d.field}: ${d.detail}`)),
    );
  }
  const policy = admissionPolicy as PilotAdmissionPolicy;

  // 2 · Fitness is a question about a dataset that at least parses.
  if (!report.usableForAssessment) {
    return notAssessable(report.datasetFingerprint, policy, [
      reason(EVALUATION_CODES.DATASET_NOT_USABLE, "the data contract did not mark this dataset usable"),
    ]);
  }

  const cycles: readonly ExpectationCycle[] = report.acceptedCycles;
  const { dataRows, acceptedRows, rejectedRows } = report.counts;

  // 3 · Rejection shape. Only row findings that REJECTED count — a warning is not an exclusion.
  const rejectedFindings = report.rowFindings.filter((f) => f.severity === "row_rejected");
  const byCode = new Map<string, number>();
  const rejectedRowIds = new Set<string>();
  const duplicateRowIds = new Set<string>();
  const orderingRowIds = new Set<string>();
  for (const f of rejectedFindings) {
    byCode.set(f.code, (byCode.get(f.code) ?? 0) + 1);
    rejectedRowIds.add(f.sourceRowId);
    if (DUPLICATE_CODES.includes(f.code)) duplicateRowIds.add(f.sourceRowId);
    if (ORDERING_DEFECT_CODES.includes(f.code)) orderingRowIds.add(f.sourceRowId);
  }
  const totalRejections = [...byCode.values()].reduce((a, b) => a + b, 0);
  const rejectionDistribution: readonly RejectionReasonShare[] = Object.freeze(
    [...byCode.entries()]
      .map(([code, count]) => Object.freeze({ code, count, share: rate(count, totalRejections) }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
  );
  const largestSingleReasonShare = rejectionDistribution[0]?.share ?? 0;

  // 4 · Sample shape, from the ACCEPTED cycles only.
  const distinctEntities = new Set(cycles.map((c) => c.entityId)).size;

  const days = cycles.map((c) => epochDay(c.monetaryEvent.dueAt));
  if (days.length === 0) {
    return notAssessable(report.datasetFingerprint, policy, [
      reason(EVALUATION_CODES.COVERAGE_WINDOW_UNAVAILABLE, "no accepted row carried a usable obligation date"),
    ]);
  }
  // Inclusive span: a single day of data is 1 day of coverage, not 0.
  const coverageDays = Math.max(...days) - Math.min(...days) + 1;

  const cohorts = splitCohorts(cycles, assessmentPolicy);
  const lifecyclePresent = Object.freeze({
    stalled: cohorts.stalled.length,
    reference: cohorts.reference.length,
    undetermined: cohorts.undetermined.length,
  });

  const recommended = fieldsByRequirement("recommended");
  const missingRecommendedColumns = recommended.filter((f) => !(f in report.columnMapping)).length;

  const rejectionRate = rate(rejectedRows, dataRows);
  const duplicateRate = rate(duplicateRowIds.size, dataRows);
  const orderingDefectRate = rate(orderingRowIds.size, dataRows);

  // 5 · The checks. Each states what was measured and what it was measured against, so a refusal
  //     can be argued with on the facts rather than taken on faith.
  const checks: AdmissionCheck[] = [
    check("sample_size", "Accepted rows", acceptedRows, policy.minAcceptedRows, "at_least",
      DATASET_CODES.SAMPLE_TOO_SMALL, `${acceptedRows} accepted of ${dataRows} read`),
    check("distinct_entities", "Distinct entities", distinctEntities, policy.minDistinctEntities, "at_least",
      DATASET_CODES.TOO_FEW_ENTITIES, `${distinctEntities} distinct entities across ${acceptedRows} accepted rows`),
    check("rejection_rate", "Rejection rate", rejectionRate, policy.maxRejectionRate, "at_most",
      DATASET_CODES.REJECTION_RATE_TOO_HIGH, `${rejectedRows} of ${dataRows} rows rejected`),
    check("rejection_concentration", "Largest single rejection reason", largestSingleReasonShare, policy.maxSingleReasonShare, "at_most",
      DATASET_CODES.REJECTION_CONCENTRATED,
      rejectionDistribution.length > 0
        ? `${rejectionDistribution[0]!.code} accounts for ${rejectionDistribution[0]!.count} of ${totalRejections} rejections`
        : "no rejections"),
    check("duplicate_rate", "Duplicate rate", duplicateRate, policy.maxDuplicateRate, "at_most",
      DATASET_CODES.DUPLICATE_RATE_TOO_HIGH, `${duplicateRowIds.size} of ${dataRows} rows were duplicates`),
    check("coverage_days", "Observed period (days)", coverageDays, policy.minCoverageDays, "at_least",
      DATASET_CODES.COVERAGE_TOO_SHORT, `obligations span ${coverageDays} day(s)`),
    check("ordering_quality", "Ordering defect rate", orderingDefectRate, policy.maxOrderingDefectRate, "at_most",
      DATASET_CODES.ORDERING_QUALITY_TOO_LOW, `${orderingRowIds.size} of ${dataRows} rows had unusable event ordering`),
    check("missing_recommended", "Missing recommended columns", missingRecommendedColumns, policy.maxMissingRecommendedColumns, "at_most",
      DATASET_CODES.MISSING_RECOMMENDED_COLUMNS, `${missingRecommendedColumns} recommended column(s) absent`),
  ];

  // Lifecycle coverage: one check per state the policy requires, so the report names WHICH is absent.
  for (const state of policy.requiredLifecycleStates) {
    checks.push(
      check(`lifecycle_${state}`, `Lifecycle coverage — ${state}`, lifecyclePresent[state], 1, "at_least",
        DATASET_CODES.LIFECYCLE_COVERAGE_MISSING, `${lifecyclePresent[state]} ${state} cycle(s) present`),
    );
  }

  if (policy.requireProvenanceDeclaration) {
    // Checks that someone ANSWERED, never that the answer is true — the contract is explicit that
    // declared independence stays an assertion until source verification proves otherwise.
    const declared = report.provenance.dataOwnerRole.trim() !== "" && report.provenance.extractionMethod.trim() !== "";
    checks.push(
      check("provenance_declared", "Provenance declared", declared ? 1 : 0, 1, "at_least",
        DATASET_CODES.PROVENANCE_INCOMPLETE,
        declared ? "provenance declaration present (an assertion, not verification)" : "no provenance declaration"),
    );
  }

  const failed = checks.filter((c) => !c.passed);
  const reasons = failed.map((c) => {
    const spec = Object.values(DATASET_CODES).find((s) => s.code === c.code)!;
    return reason(spec, `${c.label}: ${c.detail}`);
  });

  return Object.freeze({
    outcome: (failed.length === 0 ? "ADMISSIBLE" : "NOT_ADMISSIBLE") as AdmissionOutcome,
    admissibleForPilotAssessment: failed.length === 0,
    policyRef: admissionPolicyRef(policy),
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    calculationMethodVersion: ADMISSION_EVALUATOR_VERSION,
    datasetFingerprint: report.datasetFingerprint,
    counts: Object.freeze({
      dataRows,
      acceptedRows,
      rejectedRows,
      duplicateRows: duplicateRowIds.size,
      orderingDefectRows: orderingRowIds.size,
      distinctEntities,
      coverageDays,
      missingRecommendedColumns,
    }),
    rates: Object.freeze({
      rejection: rejectionRate,
      duplicate: duplicateRate,
      orderingDefect: orderingDefectRate,
      largestSingleReasonShare,
    }),
    lifecyclePresent,
    rejectionDistribution,
    checks: Object.freeze(checks),
    reasons: Object.freeze(reasons),
    claimBoundary: Object.freeze({ judgesFitnessOnly: true, constitutesProof: false, constitutesRevenue: false }),
  });
}
