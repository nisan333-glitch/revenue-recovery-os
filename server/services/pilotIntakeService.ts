// EP-13 · Customer Pilot Intake — the authoritative server side of the data contract.
//
// WHY THIS EXISTS. Until now the intake ran entirely in the browser ("your file is read locally and
// never uploaded"). That is fine for a private assessment, but it means the rules a pilot depends on
// were enforced only where the customer could change them. Client validation cannot be authoritative
// for tenancy, limits, or duplicate detection: a client controls its own code.
//
// So the split is explicit, and the naming reflects it: the browser may run the SAME contract
// validator as PREFLIGHT ASSISTANCE, to give instant feedback before a large upload. This module is
// what decides. If the two ever disagree, this one is right.
//
// WHAT IT DOES NOT DO. It creates no RecoveryEvent, no Case, no Proof and no revenue claim. It does
// not touch Case Halt, the authority ledger, the baseline, evidence or the proof chain. A validated
// dataset is input to an observed assessment, and it reaches the governed world only by a human
// walking it through the existing Case → Evidence → Approval path.
import {
  validatePilotDataset,
  type ContractValidationReport,
  type DatasetSubmission,
} from "../../src/contract/validateDataset";
import {
  PILOT_DATA_CONTRACT_VERSION,
  type DatasetProvenance,
} from "../../src/contract/pilotDataContract";
import { IDENTITY_CODES } from "../../src/contract/rejectionCodes";
import { evaluateAdmission, type AdmissionDecision } from "../../src/contract/admissionGate";
import { POLICY_CODES } from "../../src/contract/admissionCodes";
import { makeAdmissionPolicy, type PilotAdmissionPolicy } from "../../src/contract/pilotAdmissionPolicy";
import { findAdmissionPolicy, registerAdmissionPolicy } from "../persistence/pilotAdmissionPolicyStore";
import { makePolicy } from "../../src/assessment/policy";
import type { DateLocale } from "../../src/assessment/dateNormalize";
import type { AmountFormat } from "../../src/assessment/amountNormalize";
import { ConflictError, ForbiddenError } from "../http/errors";
import { requireCan } from "../auth/authorityGate";
import { requireBoundaryAccess, type ActorContext } from "../auth/identity";
import { findSubmission, recordSubmission } from "../persistence/pilotDatasetStore";

export interface PilotDatasetRequest {
  /**
   * The tenant boundary this upload is FOR. This is an authorization REQUEST, never an assertion:
   * `requireBoundaryAccess` refuses it unless the authenticated context already grants it, so a
   * client can only name a boundary it provably owns. Nothing in the CSV can influence tenancy —
   * the contract declares no tenant field, so a `tenant_id` column is rejected as undeclared.
   */
  readonly boundaryId: string;
  readonly datasetId: string;
  readonly declaredVersion: string;
  readonly csvText: string;
  readonly policy: {
    readonly stallThresholdDays: number;
    readonly asOf: string;
    readonly currency: string;
  };
  readonly provenance: DatasetProvenance;
  readonly locale?: DateLocale;
  readonly amountFormat?: AmountFormat;
  /**
   * Which versioned admission policy to judge fitness against. Omitting it does NOT mean "skip the
   * check" — it means NOT_ASSESSABLE (NH-AG-1001). There is no configuration in which a dataset is
   * admitted without an explicit bar.
   */
  readonly admissionPolicyId?: string;
  readonly admissionPolicyVersion?: string;
}

/**
 * What the UI receives. Deliberately NOT the full internal report: `acceptedCycles` carries raw
 * customer identifiers and Money objects and has no business crossing the wire — the browser
 * already holds the file it uploaded, and the server's job here is the verdict, not the data.
 */
export interface PilotIntakeResponse {
  readonly contractRef: string;
  readonly contractVersion: string;
  readonly declaredVersion: string;
  readonly boundaryId: string;
  readonly datasetId: string;
  readonly accepted: boolean;
  /** The flag the UI must gate progression on. `accepted` alone is never sufficient. */
  readonly usableForAssessment: boolean;
  readonly counts: ContractValidationReport["counts"];
  readonly datasetFindings: ContractValidationReport["datasetFindings"];
  readonly rowFindings: ContractValidationReport["rowFindings"];
  readonly datasetFingerprint: string;
  readonly idempotencyKey: string;
  readonly columnMapping: ContractValidationReport["columnMapping"];
  readonly mappingId: string;
  readonly claimBoundary: ContractValidationReport["claimBoundary"];
  /** Server-recorded submission time when the dataset was accepted and recorded; else null. */
  readonly recordedAt: string | null;
  /**
   * EP-14 · Pilot fitness — a THIRD verdict, additive and independent. `accepted` and
   * `usableForAssessment` keep their existing meanings exactly; this one answers whether the
   * dataset satisfies an explicit, versioned pilot policy.
   */
  readonly admission: AdmissionDecision;
}

/** The contract version this build serves. Advertised so a client can pin and compare. */
export const SERVED_CONTRACT_VERSION = PILOT_DATA_CONTRACT_VERSION;

function toResponse(
  report: ContractValidationReport,
  recordedAt: string | null,
  admission: AdmissionDecision,
): PilotIntakeResponse {
  return Object.freeze({
    contractRef: report.contractRef,
    contractVersion: report.contractVersion,
    declaredVersion: report.declaredVersion,
    boundaryId: report.boundaryId,
    datasetId: report.datasetId,
    accepted: report.accepted,
    usableForAssessment: report.usableForAssessment,
    counts: report.counts,
    datasetFindings: report.datasetFindings,
    rowFindings: report.rowFindings,
    datasetFingerprint: report.datasetFingerprint,
    idempotencyKey: report.idempotencyKey,
    columnMapping: report.columnMapping,
    mappingId: report.mappingId,
    claimBoundary: report.claimBoundary,
    recordedAt,
    admission,
  });
}

/** Distinct codes only — never a finding's `detail`, which can echo a customer value. */
function distinctCodes(report: ContractValidationReport): string[] {
  const codes = new Set<string>();
  for (const f of report.datasetFindings) codes.add(f.code);
  for (const f of report.rowFindings) codes.add(f.code);
  return [...codes].sort();
}

/**
 * Validate and (only if usable) record one customer pilot dataset.
 *
 * Order is the security design:
 *   1. least privilege — may this role submit at all;
 *   2. tenant authorization — is this actor entitled to THIS boundary;
 *   3. contract validation — limits, structure, PII, rows (the contract's rules, not a copy);
 *   4. duplicate detection — scoped to the authorized boundary;
 *   5. persistence — ONLY when the dataset is usable, and only counts and codes.
 *
 * Nothing is written before step 3 passes, so an invalid dataset and a rejected row never reach the
 * database at all.
 */
export async function submitPilotDataset(
  actor: ActorContext,
  request: PilotDatasetRequest,
): Promise<PilotIntakeResponse> {
  requireCan(actor, "SubmitPilotDataset");
  // Authoritative tenancy. Everything downstream uses THIS value — never a body field, never a
  // CSV column, never a value echoed back from the client.
  requireBoundaryAccess(actor, request.boundaryId);
  const boundaryId = request.boundaryId.trim();

  // A malformed policy is the caller's error, and its message must not echo customer data.
  let policy;
  try {
    policy = makePolicy({
      stallThresholdDays: request.policy.stallThresholdDays,
      asOf: request.policy.asOf,
      currency: request.policy.currency,
    });
  } catch {
    throw new ForbiddenError("assessment policy is invalid (stall threshold, as-of date or currency)");
  }

  const submission: DatasetSubmission = {
    declaredVersion: request.declaredVersion,
    boundary: { boundaryId, datasetId: request.datasetId },
    // Cross-check against the authorized boundary. They are equal by construction here; the check
    // stays so a future refactor that lets them diverge fails loudly instead of silently.
    ingestionBoundaryId: boundaryId,
    provenance: request.provenance,
    csvText: request.csvText,
    policy,
    adapterOptions: { locale: request.locale, amountFormat: request.amountFormat },
  };

  const report = await validatePilotDataset(submission);

  // EP-14 · Pilot fitness. The policy is loaded BOUNDARY-SCOPED, so a policy id belonging to
  // another tenant reads as absent and yields NOT_ASSESSABLE rather than judging this dataset by
  // someone else's bar. No policy named, or none found: NOT_ASSESSABLE. Never a default.
  let admissionPolicy: PilotAdmissionPolicy | null = null;
  if (request.admissionPolicyId?.trim()) {
    const stored = await findAdmissionPolicy(
      boundaryId,
      request.admissionPolicyId.trim(),
      request.admissionPolicyVersion?.trim() || undefined,
    );
    admissionPolicy = stored?.policy ?? null;
  }
  const admission = evaluateAdmission(report, policy, admissionPolicy);

  // Duplicate detection runs against the AUTHORIZED boundary, so a key minted for another tenant
  // reads as absent rather than as that tenant's record.
  const prior = await findSubmission(report.idempotencyKey, boundaryId);
  void POLICY_CODES; // the codes the evaluator emits; referenced so the dependency is explicit
  if (prior !== null) {
    throw new ConflictError(
      `${IDENTITY_CODES.DUPLICATE_SUBMISSION.code}: this exact dataset was already submitted for this tenant on ${prior.submittedAt}. ${IDENTITY_CODES.DUPLICATE_SUBMISSION.remediation}`,
    );
  }

  // Persist ONLY a usable dataset. An invalid dataset, or one whose every row was rejected, leaves
  // no row behind: the uploader gets the findings and the database gets nothing. That also keeps a
  // corrected re-upload a genuinely new submission rather than a "duplicate" of a failure.
  if (!report.usableForAssessment) {
    return toResponse(report, null, admission);
  }

  const recorded = await recordSubmission({
    idempotencyKey: report.idempotencyKey,
    boundaryId,
    datasetId: report.datasetId,
    contractVersion: report.contractVersion,
    datasetFingerprint: report.datasetFingerprint,
    accepted: report.accepted,
    usable: report.usableForAssessment,
    dataRows: report.counts.dataRows,
    acceptedRows: report.counts.acceptedRows,
    rejectedRows: report.counts.rejectedRows,
    warnedRows: report.counts.warnedRows,
    findingCodes: distinctCodes(report),
    submittedByActorId: actor.actorId,
    submittedByRole: actor.role,
  });

  return toResponse(report, recorded.submittedAt, admission);
}

export interface RegisterAdmissionPolicyRequest {
  readonly boundaryId: string;
  readonly policy: PilotAdmissionPolicy;
}

/**
 * Register a versioned admission policy for one boundary.
 *
 * Thresholds are the customer's commercial decision, so they must be able to state them — a policy
 * that could only be inserted by hand would push every pilot back to "the system decided". The
 * policy is validated by the domain constructor before it is written, and the (boundary, id,
 * version) primary key makes a published version immutable: a change is a new version.
 */
export async function registerPilotAdmissionPolicy(
  actor: ActorContext,
  request: RegisterAdmissionPolicyRequest,
): Promise<{ readonly boundaryId: string; readonly policyRef: string; readonly registeredAt: string }> {
  requireCan(actor, "SubmitPilotDataset");
  requireBoundaryAccess(actor, request.boundaryId);
  const boundaryId = request.boundaryId.trim();

  let policy: PilotAdmissionPolicy;
  try {
    policy = makeAdmissionPolicy(request.policy);
  } catch {
    // The message is deliberately generic; the caller gets the per-field defects from the gate's
    // own codes rather than an exception string that could echo their input.
    throw new ForbiddenError("admission policy is incomplete or out of range — every threshold must be configured explicitly");
  }

  const stored = await registerAdmissionPolicy({
    boundaryId,
    policy,
    registeredByActorId: actor.actorId,
    registeredByRole: actor.role,
  });
  return Object.freeze({
    boundaryId: stored.boundaryId,
    policyRef: `${stored.policy.policyId}@${stored.policy.policyVersion}`,
    registeredAt: stored.registeredAt,
  });
}
