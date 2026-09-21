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
