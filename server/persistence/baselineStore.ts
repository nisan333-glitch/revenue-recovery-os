// EP-8.1 · Baseline snapshot persistence. Establish + lock happen as ONE insert — the DB
// clock (`lockedAt`, default now()) is the tamper-evident timestamp a proof's temporal
// trust gate relies on; it is never client-suppliable. A proof's baseline amount/method/
// version come ONLY from the snapshot referenced by baselineId — never from the approval
// request body directly. Immutable at the DB level (append-only triggers). A correction
// is a NEW row (`supersedes`) — the prior snapshot, and every proof that already stamped
// it, is never touched or reinterpreted.
import { prisma } from "../db";

export interface EstablishBaselineInput {
  baselineId: string;
  recoveryCaseId: string;
  calculatedMinor: number;
  currency: string;
  method: string;
  methodVersion: number;
  sourceRefs: string[];
  effectiveAt: string;
  establishedBy: string;
  establishedByRole: string;
  supersedes?: string;
}

export interface BaselineSnapshot {
  baselineId: string;
  recoveryCaseId: string;
  calculatedMinor: number;
  currency: string;
  method: string;
  methodVersion: number;
  sourceRefs: string[];
  effectiveAt: string;
  establishedBy: string;
  establishedByRole: string;
  lockedAt: string;
  supersedes: string | null;
}

type Row = Awaited<ReturnType<typeof prisma.baselineSnapshot.findFirstOrThrow>>;

function rowToSnapshot(r: Row): BaselineSnapshot {
  return {
    baselineId: r.baselineId,
    recoveryCaseId: r.recoveryCaseId,
    calculatedMinor: Number(r.calculatedMinor),
    currency: r.currency,
    method: r.method,
    methodVersion: r.methodVersion,
    sourceRefs: r.sourceRefs,
    effectiveAt: r.effectiveAt.toISOString(),
    establishedBy: r.establishedBy,
    establishedByRole: r.establishedByRole,
    lockedAt: r.lockedAt.toISOString(),
    supersedes: r.supersedes,
  };
}

/** Establish and lock a baseline snapshot in a single insert (the DB clock stamps lockedAt). */
export async function establishAndLockBaseline(input: EstablishBaselineInput): Promise<BaselineSnapshot> {
  const row = await prisma.baselineSnapshot.create({
    data: {
      baselineId: input.baselineId,
      recoveryCaseId: input.recoveryCaseId,
      calculatedMinor: BigInt(input.calculatedMinor),
      currency: input.currency,
      method: input.method,
      methodVersion: input.methodVersion,
      sourceRefs: [...input.sourceRefs],
      effectiveAt: new Date(input.effectiveAt),
      establishedBy: input.establishedBy,
      establishedByRole: input.establishedByRole,
      supersedes: input.supersedes ?? null,
    },
  });
  return rowToSnapshot(row);
}

/** Load a locked baseline snapshot by id, or null if it does not exist. */
export async function getBaselineSnapshot(baselineId: string): Promise<BaselineSnapshot | null> {
  const row = await prisma.baselineSnapshot.findUnique({ where: { baselineId } });
  return row ? rowToSnapshot(row) : null;
}
