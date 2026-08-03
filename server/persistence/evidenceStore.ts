// EP-8.1 · Governed, pre-proof evidence ingestion. Immutable at the DB level (append-only
// triggers). Every classification a caller might claim is DERIVED here, never accepted:
//  * trustClassification/beneficiaryControl — via the domain's own `makeEvidence`
//    (src/domain/evidence.ts), unmodified.
//  * evidenceRole ("outcome" | "supporting") — via `deriveEvidenceRole`
//    (server/domain/evidenceRole.ts), a server-only concept beside the domain's.
// `observedAt` is recorded (falsifiable against sourceRecordId) but is a CLAIMED fact —
// it is never used as the positive timing signal. `ingestedAt` (the DB clock) is.
import { prisma } from "../db";
import { makeEvidence } from "../../src/domain/evidence";
import { deriveEvidenceRole, ROLE_MAP_VERSION } from "../domain/evidenceRole";

export interface IngestEvidenceInput {
  evidenceId: string;
  recoveryCaseId: string;
  sourceSystem: string;
  sourceRecordId: string;
  evidenceType: string;
  observedAt: string;
  amountMinor?: number;
  currency?: string;
  ingestedBy: string;
  ingestedByRole: string;
  note?: string;
}

export interface IngestedEvidence {
  evidenceId: string;
  recoveryCaseId: string;
  sourceSystem: string;
  sourceRecordId: string;
  evidenceType: string;
  observedAt: string;
  amountMinor: number | null;
  currency: string | null;
  trustClassification: "independent" | "beneficiary_controlled";
  beneficiaryControl: boolean;
  evidenceRole: "outcome" | "supporting";
  roleMapVersion: string;
  ingestedBy: string;
  ingestedByRole: string;
  ingestedAt: string;
}

type Row = Awaited<ReturnType<typeof prisma.evidenceRecord.findFirstOrThrow>>;

function rowToEvidence(r: Row): IngestedEvidence {
  return {
    evidenceId: r.evidenceId,
    recoveryCaseId: r.recoveryCaseId,
    sourceSystem: r.sourceSystem,
    sourceRecordId: r.sourceRecordId,
    evidenceType: r.evidenceType,
    observedAt: r.observedAt.toISOString(),
    amountMinor: r.amountMinor === null ? null : Number(r.amountMinor),
    currency: r.currency,
    trustClassification: r.trustClassification as "independent" | "beneficiary_controlled",
    beneficiaryControl: r.beneficiaryControl,
    evidenceRole: r.evidenceRole as "outcome" | "supporting",
    roleMapVersion: r.roleMapVersion,
    ingestedBy: r.ingestedBy,
    ingestedByRole: r.ingestedByRole,
    ingestedAt: r.ingestedAt.toISOString(),
  };
}

/**
 * Ingest one evidence item. Independence and outcome-role are both DERIVED server-side —
 * the caller supplies only raw, falsifiable facts (source system/record/type/amount).
 */
export async function ingestEvidence(input: IngestEvidenceInput): Promise<IngestedEvidence> {
  const derived = makeEvidence({
    evidenceId: input.evidenceId,
    evidenceType: input.evidenceType,
    sourceSystem: input.sourceSystem,
    sourceRecordId: input.sourceRecordId,
    observedAt: input.observedAt,
    ingestedAt: new Date().toISOString(), // not persisted from this — the DB clock is authoritative
    trustClassification: "independent", // a claim; makeEvidence forces it to the true value
    suppliedBy: input.ingestedBy,
  });
  const role = deriveEvidenceRole(input.sourceSystem, input.evidenceType);

  const row = await prisma.evidenceRecord.create({
    data: {
      evidenceId: input.evidenceId,
      recoveryCaseId: input.recoveryCaseId,
      sourceSystem: input.sourceSystem,
      sourceRecordId: input.sourceRecordId,
      evidenceType: input.evidenceType,
      observedAt: new Date(input.observedAt),
      amountMinor: input.amountMinor === undefined ? null : BigInt(input.amountMinor),
      currency: input.currency ?? null,
      trustClassification: derived.trustClassification,
      beneficiaryControl: derived.beneficiaryControl,
      evidenceRole: role,
      roleMapVersion: ROLE_MAP_VERSION,
      ingestedBy: input.ingestedBy,
      ingestedByRole: input.ingestedByRole,
      note: input.note ?? null,
    },
  });
  return rowToEvidence(row);
}

/** Load evidence by id, scoped to a case — an id belonging to a different case is omitted
 * entirely (never silently borrowed across cases). */
export async function getEvidenceByIds(
  recoveryCaseId: string,
  evidenceIds: string[],
): Promise<IngestedEvidence[]> {
  const rows = await prisma.evidenceRecord.findMany({
    where: { evidenceId: { in: evidenceIds }, recoveryCaseId },
  });
  return rows.map(rowToEvidence);
}
