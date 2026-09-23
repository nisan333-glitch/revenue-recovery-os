// EP-13 · Client for the server-authoritative pilot intake.
//
// THE SPLIT THIS FILE ENCODES. `preflightPilotDataset` runs the SAME contract validator in the
// browser so a customer sees problems before waiting on a 10 MB upload. It is ASSISTANCE ONLY and
// is labelled as such everywhere it surfaces. `submitPilotDataset` is what decides — if the two
// ever disagree, the server is right, because a client controls its own code and cannot be
// authoritative about tenancy, limits or duplicates.
import { apiRequest } from "./apiClient";
import type { DevActor } from "./devActor";
import { validatePilotDataset, type ContractValidationReport } from "../contract/validateDataset";
import { PILOT_DATA_CONTRACT_VERSION, type DatasetProvenance } from "../contract/pilotDataContract";
import { evaluateAdmission, type AdmissionDecision } from "../contract/admissionGate";
import type { PolicyState } from "../contract/policyLifecycle";
import type { PilotAdmissionPolicy } from "../contract/pilotAdmissionPolicy";
import { makePolicy } from "../assessment/policy";
import type { DateLocale } from "../assessment/dateNormalize";
import type { AmountFormat } from "../assessment/amountNormalize";

export interface PilotIntakeFinding {
  readonly code: string;
  readonly severity: "dataset_rejected" | "dataset_warning" | "row_rejected" | "row_warning";
  readonly title: string;
  readonly remediation: string;
  readonly detail: string;
}

export interface PilotIntakeDatasetFinding extends PilotIntakeFinding {
  readonly subject: string | null;
}

export interface PilotIntakeRowFinding extends PilotIntakeFinding {
  readonly sourceRowId: string;
  readonly rowNumber: number;
  readonly field: string | null;
}

export interface PilotIntakeResult {
  readonly contractRef: string;
  readonly contractVersion: string;
  readonly declaredVersion: string;
  readonly boundaryId: string;
  readonly datasetId: string;
  readonly accepted: boolean;
  /** The ONLY flag that may gate progression into assessment. */
  readonly usableForAssessment: boolean;
  readonly counts: {
    readonly dataRows: number;
    readonly acceptedRows: number;
    readonly rejectedRows: number;
    readonly warnedRows: number;
  };
  readonly datasetFindings: readonly PilotIntakeDatasetFinding[];
  readonly rowFindings: readonly PilotIntakeRowFinding[];
  readonly datasetFingerprint: string;
  readonly idempotencyKey: string;
  readonly recordedAt: string | null;
  /** EP-14 · pilot fitness — separate from, and never a substitute for, usableForAssessment. */
  readonly admission: AdmissionDecision;
  /** EP-15 · lifecycle state of the policy consulted; null when none was named or found. */
  readonly admissionPolicyState: PolicyState | null;
  /** EP-15 · deterministic hash of the bar this decision was judged under. */
  readonly admissionPolicyHash: string | null;
  /** EP-15 · set when governance refused to let the named policy judge this dataset. */
  readonly admissionGovernanceRefusal: string | null;
}

export interface PilotIntakeParams {
  readonly boundaryId: string;
  readonly datasetId: string;
  readonly csvText: string;
  readonly provenance: DatasetProvenance;
  readonly stallThresholdDays: number;
  readonly asOf: string;
  readonly currency: string;
  readonly locale?: DateLocale;
  readonly amountFormat?: AmountFormat;
  /** Which versioned admission policy to judge fitness against. Absent means NOT_ASSESSABLE. */
  readonly admissionPolicyId?: string;
  readonly admissionPolicyVersion?: string;
  /**
   * Preflight only: the policy the browser judges against locally. The SERVER always loads its own
   * copy boundary-scoped and ignores anything sent from here — a client-supplied threshold could
   * otherwise set its own bar.
   */
  readonly preflightAdmissionPolicy?: PilotAdmissionPolicy;
}

/**
 * Local preflight. Runs the identical contract validator against the identical rules, purely so the
 * customer gets an answer without a round trip. Its verdict is never acted on as authority: the UI
 * labels it as a preview and still submits.
 */
export async function preflightPilotDataset(params: PilotIntakeParams): Promise<ContractValidationReport> {
  return validatePilotDataset({
    declaredVersion: PILOT_DATA_CONTRACT_VERSION,
    boundary: { boundaryId: params.boundaryId, datasetId: params.datasetId },
    provenance: params.provenance,
    csvText: params.csvText,
    policy: makePolicy({
      stallThresholdDays: params.stallThresholdDays,
      asOf: params.asOf,
      currency: params.currency,
    }),
    adapterOptions: { locale: params.locale, amountFormat: params.amountFormat },
  });
}

/** Submit for the authoritative verdict. The server decides; this only carries the answer back. */
/**
 * Local admission preview. Uses the SAME evaluator the server runs, so the preview cannot be more
 * permissive by construction — but it judges against whatever policy the browser happens to hold,
 * which is why the server reloads its own copy boundary-scoped and never trusts this one.
 */
export function preflightAdmission(
  report: ContractValidationReport,
  assessmentPolicy: Parameters<typeof evaluateAdmission>[1],
  policy: PilotAdmissionPolicy | null | undefined,
): AdmissionDecision {
  return evaluateAdmission(report, assessmentPolicy, policy);
}

export function submitPilotDataset(params: PilotIntakeParams, actor: DevActor): Promise<PilotIntakeResult> {
  return apiRequest<PilotIntakeResult>("POST", "/pilot/datasets", actor, {
    boundaryId: params.boundaryId,
    datasetId: params.datasetId,
    declaredVersion: PILOT_DATA_CONTRACT_VERSION,
    csvText: params.csvText,
    policy: {
      stallThresholdDays: params.stallThresholdDays,
      asOf: params.asOf,
      currency: params.currency,
    },
    provenance: params.provenance,
    ...(params.locale ? { locale: params.locale } : {}),
    ...(params.amountFormat ? { amountFormat: params.amountFormat } : {}),
    ...(params.admissionPolicyId ? { admissionPolicyId: params.admissionPolicyId } : {}),
    ...(params.admissionPolicyVersion ? { admissionPolicyVersion: params.admissionPolicyVersion } : {}),
  });
}

/** Group row findings by code so a 10,000-row rejection reads as a handful of actionable problems. */
export interface FindingGroup {
  readonly code: string;
  readonly title: string;
  readonly remediation: string;
  readonly severity: PilotIntakeFinding["severity"];
  readonly count: number;
  /** First few affected data-row numbers, so the customer knows where to look. */
  readonly exampleRows: readonly number[];
}

export function groupRowFindings(findings: readonly PilotIntakeRowFinding[]): readonly FindingGroup[] {
  const groups = new Map<string, { spec: PilotIntakeRowFinding; rows: number[] }>();
  for (const f of findings) {
    const entry = groups.get(f.code);
    if (entry) entry.rows.push(f.rowNumber);
    else groups.set(f.code, { spec: f, rows: [f.rowNumber] });
  }
  return Object.freeze(
    [...groups.values()]
      .map(({ spec, rows }) =>
        Object.freeze({
          code: spec.code,
          title: spec.title,
          remediation: spec.remediation,
          severity: spec.severity,
          count: rows.length,
          exampleRows: Object.freeze(rows.slice(0, 5)),
        }),
      )
      // Rejections before warnings, then most frequent first — the biggest fix comes first.
      .sort((a, b) => {
        const fatal = (s: FindingGroup["severity"]) => (s === "row_rejected" ? 0 : 1);
        return fatal(a.severity) - fatal(b.severity) || b.count - a.count || a.code.localeCompare(b.code);
      }),
  );
}
