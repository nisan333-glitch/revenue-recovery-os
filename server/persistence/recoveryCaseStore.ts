import { prisma, type DbClient } from "../db";
import { NotFoundError } from "../http/errors";

export function recoveryCaseRootEnforcementEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.NH_REQUIRE_RECOVERY_CASE_ROOT === "true" || env.NODE_ENV === "production";
}

export async function recoveryCaseExists(
  recoveryCaseId: string,
  client: DbClient = prisma,
): Promise<boolean> {
  const row = await client.recoveryCaseRecord.findUnique({
    where: { recoveryCaseId },
    select: { recoveryCaseId: true },
  });
  return row !== null;
}

export async function assertRecoveryCaseRootIfRequired(
  recoveryCaseId: string,
  client: DbClient = prisma,
): Promise<void> {
  if (!recoveryCaseRootEnforcementEnabled()) return;
  if (!(await recoveryCaseExists(recoveryCaseId, client))) {
    throw new NotFoundError(`RecoveryCase ${recoveryCaseId} has no authoritative root`);
  }
}

/**
 * The authoritative case root, read back whole.
 *
 * WHY THIS DID NOT EXIST. Until now the ONLY production reader of `RecoveryCaseRecord` was
 * `recoveryCaseExists` above — a boolean probe. Promotion persisted who opened the case, which
 * candidate it came from, which detector found it, the at-risk amount and the boundary, and nothing
 * ever read any of it back. That is the `obligation_ref` lesson in reverse: a value written with no
 * consumer collects no evidence and invites prose about what happens to it. The consumer ships here.
 *
 * `amountAtRiskMinor` is a `BigInt` in the row and a `number` here. The narrowing is checked rather
 * than assumed — a silently truncated money figure is the one thing this layer must never produce.
 */
export interface RecoveryCaseRoot {
  readonly recoveryCaseId: string;
  readonly boundaryId: string;
  readonly sourceCandidateId: string;
  readonly recoveryType: string;
  readonly sourceRef: string;
  readonly amountAtRiskMinor: number;
  readonly currency: string;
  readonly detectorVersion: string;
  readonly openedByActorId: string;
  readonly openedByRole: string;
  readonly policyVersion: string;
  readonly openedAt: string;
}

export async function getRecoveryCase(
  recoveryCaseId: string,
  client: DbClient = prisma,
): Promise<RecoveryCaseRoot | null> {
  const row = await client.recoveryCaseRecord.findUnique({ where: { recoveryCaseId } });
  if (row === null) return null;
  if (row.amountAtRiskMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      `recovery case ${recoveryCaseId} carries an at-risk amount beyond safe integer range; ` +
        "refusing to narrow it rather than reporting a truncated figure",
    );
  }
  return Object.freeze({
    recoveryCaseId: row.recoveryCaseId,
    boundaryId: row.boundaryId,
    sourceCandidateId: row.sourceCandidateId,
    recoveryType: row.recoveryType,
    sourceRef: row.sourceRef,
    amountAtRiskMinor: Number(row.amountAtRiskMinor),
    currency: row.currency,
    detectorVersion: row.detectorVersion,
    openedByActorId: row.openedByActorId,
    openedByRole: row.openedByRole,
    policyVersion: row.policyVersion,
    openedAt: row.openedAt.toISOString(),
  });
}
