// EP-4 · Authority ledger persistence. Append-only (enforced by DB triggers); it is
// the audit record of who did what, in which role, on which case, under which policy.
import { prisma } from "../db";
import type { ActorContext, GovernedAction } from "./identity";

export interface AuthorityRecord {
  actorId: string;
  role: string;
  action: string;
  policyVersion: string;
  at: Date;
}

export async function recordAuthority(
  recoveryCaseId: string,
  actor: ActorContext,
  action: GovernedAction,
  policyVersion: string,
): Promise<void> {
  await prisma.authorityEvent.create({
    data: {
      id: `AE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      recoveryCaseId,
      actorId: actor.actorId,
      role: actor.role,
      action,
      policyVersion,
    },
  });
}

export async function authorityFor(recoveryCaseId: string): Promise<AuthorityRecord[]> {
  return prisma.authorityEvent.findMany({
    where: { recoveryCaseId },
    orderBy: { at: "asc" },
    select: { actorId: true, role: true, action: true, policyVersion: true, at: true },
  });
}
