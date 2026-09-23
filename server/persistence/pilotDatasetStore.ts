// EP-13 · Persistence for customer pilot dataset submissions.
//
// This table exists for ONE reason: to recognise a repeated upload so the same exposure is not
// assessed twice. It is not evidence, not a case, not a proof, and it confers no authority.
//
// PRIVACY BOUNDARY, enforced by what this module can even see: the input type carries counts, the
// deterministic key, the fingerprint and NH-DC-#### codes. It has no field for uploaded row content,
// customer identifiers, monetary values, or a finding's `detail` text (which can echo a customer
// value). A rejected row is reported to the uploader and then forgotten.
//
// TENANT ISOLATION: every read is filtered by `boundaryId` as well as the key. The key already
// contains the boundary, so this is defence in depth — a second, independent reason a lookup cannot
// cross tenants even if key derivation were ever changed.
import { prisma, type DbClient } from "../db";

export interface PilotSubmissionInput {
  readonly idempotencyKey: string;
  readonly boundaryId: string;
  readonly datasetId: string;
  readonly contractVersion: string;
  readonly datasetFingerprint: string;
  readonly accepted: boolean;
  readonly usable: boolean;
  readonly dataRows: number;
  readonly acceptedRows: number;
  readonly rejectedRows: number;
  readonly warnedRows: number;
  /** Distinct NH-DC-#### codes only — asserted by the caller and by tests. */
  readonly findingCodes: readonly string[];
  /**
   * EP-15 · The exact bar this decision was judged under, frozen with the decision. Retiring or
   * superseding the policy later can never reach back and alter these — which is what makes a
   * historical verdict reproducible rather than merely remembered.
   */
  readonly admissionOutcome: string | null;
  readonly admissionPolicyId: string | null;
  readonly admissionPolicyVersion: string | null;
  readonly admissionPolicyHash: string | null;
  /**
   * EP-16 · Deterministic identifier for this decision, derived from the fields above. An execution
   * binds to it, so it is what makes "this run was authorised by that decision" checkable rather
   * than merely asserted. Null on a submission recorded before orchestration existed.
   */
  readonly admissionDecisionId: string | null;
  readonly submittedByActorId: string;
  readonly submittedByRole: string;
}

export interface PilotSubmissionRecord extends PilotSubmissionInput {
  readonly submittedAt: string;
}

function toRecord(row: {
  idempotencyKey: string;
  boundaryId: string;
  datasetId: string;
  contractVersion: string;
  datasetFingerprint: string;
  accepted: boolean;
  usable: boolean;
  dataRows: number;
  acceptedRows: number;
  rejectedRows: number;
  warnedRows: number;
  findingCodes: string[];
  admissionOutcome: string | null;
  admissionPolicyId: string | null;
  admissionPolicyVersion: string | null;
  admissionPolicyHash: string | null;
  admissionDecisionId: string | null;
  submittedByActorId: string;
  submittedByRole: string;
  submittedAt: Date;
}): PilotSubmissionRecord {
  return Object.freeze({
    idempotencyKey: row.idempotencyKey,
    boundaryId: row.boundaryId,
    datasetId: row.datasetId,
    contractVersion: row.contractVersion,
    datasetFingerprint: row.datasetFingerprint,
    accepted: row.accepted,
    usable: row.usable,
    dataRows: row.dataRows,
    acceptedRows: row.acceptedRows,
    rejectedRows: row.rejectedRows,
    warnedRows: row.warnedRows,
    findingCodes: Object.freeze([...row.findingCodes]),
    admissionOutcome: row.admissionOutcome,
    admissionPolicyId: row.admissionPolicyId,
    admissionPolicyVersion: row.admissionPolicyVersion,
    admissionPolicyHash: row.admissionPolicyHash,
    admissionDecisionId: row.admissionDecisionId,
    submittedByActorId: row.submittedByActorId,
    submittedByRole: row.submittedByRole,
    submittedAt: row.submittedAt.toISOString(),
  });
}

/**
 * Look up a prior submission. Scoped to the boundary: a key from another tenant reads as absent
 * rather than as someone else's record.
 */
export async function findSubmission(
  idempotencyKey: string,
  boundaryId: string,
  client: DbClient = prisma,
): Promise<PilotSubmissionRecord | null> {
  const row = await client.pilotDatasetSubmissionRecord.findFirst({
    where: { idempotencyKey, boundaryId },
  });
  return row ? toRecord(row) : null;
}

/**
 * EP-16 · Look up the admission decision an execution is bound to.
 *
 * Boundary-scoped like every other read here. A decision id minted for another tenant reads as
 * absent, so an execution cannot borrow another tenant's admission to authorise itself.
 */
export async function findSubmissionByDecisionId(
  admissionDecisionId: string,
  boundaryId: string,
  client: DbClient = prisma,
): Promise<PilotSubmissionRecord | null> {
  const row = await client.pilotDatasetSubmissionRecord.findFirst({
    where: { admissionDecisionId, boundaryId },
  });
  return row ? toRecord(row) : null;
}

/** Record one accepted submission. Append-only; DB triggers reject UPDATE and DELETE. */
export async function recordSubmission(
  input: PilotSubmissionInput,
  client: DbClient = prisma,
): Promise<PilotSubmissionRecord> {
  const row = await client.pilotDatasetSubmissionRecord.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      boundaryId: input.boundaryId,
      datasetId: input.datasetId,
      contractVersion: input.contractVersion,
      datasetFingerprint: input.datasetFingerprint,
      accepted: input.accepted,
      usable: input.usable,
      dataRows: input.dataRows,
      acceptedRows: input.acceptedRows,
      rejectedRows: input.rejectedRows,
      warnedRows: input.warnedRows,
      findingCodes: [...input.findingCodes],
      admissionOutcome: input.admissionOutcome,
      admissionPolicyId: input.admissionPolicyId,
      admissionPolicyVersion: input.admissionPolicyVersion,
      admissionPolicyHash: input.admissionPolicyHash,
      admissionDecisionId: input.admissionDecisionId,
      submittedByActorId: input.submittedByActorId,
      submittedByRole: input.submittedByRole,
    },
  });
  return toRecord(row);
}
