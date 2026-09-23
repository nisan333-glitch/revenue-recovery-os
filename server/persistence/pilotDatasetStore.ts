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
      submittedByActorId: input.submittedByActorId,
      submittedByRole: input.submittedByRole,
    },
  });
  return toRecord(row);
}
