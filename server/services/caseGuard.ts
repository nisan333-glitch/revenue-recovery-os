// EP-11 · Case Halt enforcement — the single, centralized gate every governed mutation passes.
//
// THE PROBLEM THIS CLOSES (security P0): before this module, `POST /cases/:id/halt` recorded a
// `Halt` row in the authority ledger and NOTHING read it back. A halted case still accepted
// Author, EstablishBaseline, Intervene, IngestEvidence, Approve and Revise — so a governance
// stop was advisory only, and a counted number could be created after the case had been halted.
// Halt is the mechanism a Steward uses to stop a suspect recovery; if it does not actually stop
// writes, the trust model's "no beneficiary may push a number through once governance objects"
// is unenforced.
//
// DESIGN
//  * ONE place decides. Every governed mutation calls `withGovernedCaseMutation`; the check is
//    not copy-pasted per service function, so a new mutation cannot be added that silently
//    forgets it (and `HALTED_MUTATIONS` names exactly what is covered).
//  * The check and the write are ATOMIC. The halt test runs INSIDE the same interactive
//    transaction as the write, so there is no read-then-write window in which a Halt could
//    commit between "not halted" and the INSERT.
//  * Halt and mutation are SERIALIZED per case by a Postgres transaction-scoped advisory lock
//    keyed on the case id. Postgres SERIALIZABLE alone would NOT close this race: a Halt that
//    only inserts creates no read-write dependency back to the approving transaction, so there
//    is no dangerous-structure cycle to detect and both could commit (classic write skew). The
//    advisory lock makes the ordering explicit and deterministic instead of hoping the isolation
//    level notices. It is released automatically at COMMIT or ROLLBACK — no unlock path to leak.
//  * FAIL CLOSED, but never RETROACTIVE. If Halt commits first, the mutation is rejected and no
//    row is written. If the mutation commits first, it stands: a Halt arriving afterwards must
//    never rewrite history — proof immutability (Trust Invariant #5/#6) forbids reaching back
//    into an approved proof, and "learning may change future decisions only."
//
// WHAT IS DELIBERATELY NOT BLOCKED
//  * Every READ. Audit trails, CFO exports, proof chains, baseline and evidence history stay
//    fully available on a halted case — halting a case must make it MORE inspectable, not less.
//    A halt that blinded the auditor would defeat its own purpose.
//  * Governance actions: Flag, Halt (idempotent — re-halting is not an error), Exclude, and the
//    Verify oversight stamp. These never create or change a counted number, and blocking them
//    would strand a halted case with no way to exclude or annotate it. Only the six mutations in
//    `HALTED_MUTATIONS` — the ones that author, establish, intervene, ingest, approve or revise —
//    are stopped.
import { prisma, type DbClient } from "../db";
import { ConflictError } from "../http/errors";

/**
 * The governed mutations a Halt stops. Named explicitly (rather than "anything that writes") so
 * the blocked set is reviewable in one place and appears verbatim in the rejection message.
 */
export type HaltedMutation =
  | "Author"
  | "EstablishBaseline"
  | "Intervene"
  | "IngestEvidence"
  | "Approve"
  | "Revise";

export const HALTED_MUTATIONS: readonly HaltedMutation[] = Object.freeze([
  "Author",
  "EstablishBaseline",
  "Intervene",
  "IngestEvidence",
  "Approve",
  "Revise",
]);

/** The authority-ledger action that halts a case. Matches what `haltCase` records. */
export const HALT_ACTION = "Halt";

/**
 * 409, not 403: the actor's role and separation of duties are irrelevant here — no actor of any
 * role may mutate a halted case, because the CASE STATE conflicts with the request. Consistent
 * with the other state conflicts in this service (duplicate chain root, baseline ordering).
 */
export class CaseHaltedError extends ConflictError {
  constructor(recoveryCaseId: string, mutation: HaltedMutation) {
    super(
      `case ${recoveryCaseId} is halted: '${mutation}' is rejected. A halted case accepts no governed mutation ` +
        `(${HALTED_MUTATIONS.join(", ")}); audit reads remain available.`,
    );
    this.name = "CaseHaltedError";
  }
}

/**
 * Is there a Halt in the case's append-only authority ledger? Reads through whichever handle it
 * is given, so inside `withGovernedCaseMutation` it sees the transaction's own snapshot.
 *
 * There is no "unhalt": the ledger is append-only and a Halt row can never be updated or deleted
 * (DB triggers reject both). Lifting a halt would be a new, separately-governed action with its
 * own authority record — not a mutation of history — and is deliberately not implemented here.
 */
export async function isCaseHalted(recoveryCaseId: string, client: DbClient = prisma): Promise<boolean> {
  const halt = await client.authorityEvent.findFirst({
    where: { recoveryCaseId, action: HALT_ACTION },
    select: { id: true },
  });
  return halt !== null;
}

/**
 * Fast, EARLY rejection before an expensive gate chain runs (`approve` reads the authority
 * ledger, the locked baseline and every referenced evidence record before it writes anything).
 *
 * This is a courtesy check, NOT the enforcement point: it is deliberately outside any
 * transaction, so a Halt could still commit after it passes. The authoritative test is the one
 * inside `withGovernedCaseMutation`, which no governed mutation can skip. Removing this line
 * would change latency and the error a caller sees first — never whether a halted case can be
 * mutated.
 */
export async function assertCaseNotHalted(
  recoveryCaseId: string,
  mutation: HaltedMutation,
  client: DbClient = prisma,
): Promise<void> {
  if (await isCaseHalted(recoveryCaseId, client)) {
    throw new CaseHaltedError(recoveryCaseId, mutation);
  }
}

/**
 * Take the per-case transaction-scoped advisory lock. `hashtext` maps the case id into the
 * advisory-lock key space; a hash collision between two different case ids can only cause extra
 * serialization (two unrelated cases briefly queue), never a missed halt or a wrong answer.
 */
async function lockCase(recoveryCaseId: string, tx: DbClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${recoveryCaseId}))`;
}

/**
 * Run one governed mutation under the halt gate.
 *
 * Order inside the transaction is the whole point:
 *   1. take the per-case advisory lock — serializes against a concurrent Halt;
 *   2. re-read the halt state through the transaction — no stale pre-check is trusted;
 *   3. reject (rolling back, so nothing partial survives) or run the write.
 *
 * `fn` receives the SAME transaction client and must use it for every write, so the halt test
 * and the write commit or roll back together.
 */
export async function withGovernedCaseMutation<T>(
  recoveryCaseId: string,
  mutation: HaltedMutation,
  fn: (tx: DbClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await lockCase(recoveryCaseId, tx);
    if (await isCaseHalted(recoveryCaseId, tx)) {
      throw new CaseHaltedError(recoveryCaseId, mutation);
    }
    return fn(tx);
  });
}

/**
 * Record a Halt under the SAME per-case lock the mutations take. This is what makes concurrent
 * Halt-vs-Approve deterministic rather than a coin flip: the two transactions cannot interleave
 * between the halt check and the write, so the outcome is always exactly one of
 *   • Halt first  → the mutation is rejected and writes nothing, or
 *   • mutation first → it commits, and the Halt applies to everything after it.
 * There is no interleaving in which a governed row is written after a Halt has committed.
 */
export async function withCaseHalt<T>(recoveryCaseId: string, fn: (tx: DbClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await lockCase(recoveryCaseId, tx);
    return fn(tx);
  });
}
