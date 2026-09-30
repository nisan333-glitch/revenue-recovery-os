// Step 5 · Activation that enforces CARDINALITY, not merely serialization.
//
// THE DEFECT THIS EXISTS TO PREVENT, and it is in the existing pattern rather than hypothetical.
// `transitionAnalysisTerms` derives state, checks `canTransition`, then appends an event — with no
// transaction and no lock. Two concurrent activations of two DIFFERENT versions of one id both read DRAFT
// for their own version, both pass the check, and both commit. The result is TWO ACTIVE versions.
//
// That is tolerable for the objects that already exist, because they are always resolved BY EXPLICIT
// CITATION (`termsId@version`), so two ACTIVE versions are never ambiguous — the caller names one. Those
// paths are deliberately left untouched here; this is not a silent fix applied to them.
//
// Source authority is the first thing resolved BY CARDINALITY: "exactly one ACTIVE namespace version",
// "exactly one ACTIVE permitted set", "exactly one ACTIVE binding revision". So it is the first place the
// gap bites, and a lock alone does not close it — two transactions can serialize perfectly and still both
// activate if the second never re-reads. The order below is the whole point:
//
//   1. take the per-scope advisory lock — serializes against every other activation in the same scope;
//   2. RE-READ the authoritative event log THROUGH the transaction — no stale pre-check is trusted;
//   3. verify the ACTIVE cardinality the scope requires;
//   4. transition, or refuse;
//   5. commit — the lock releases at COMMIT or ROLLBACK, so there is no unlock path to leak.
//
// This is `withGovernedCaseMutation`'s shape (`caseGuard.ts`), for the same reason its comment gives:
// Postgres SERIALIZABLE alone would not close it, because two inserts create no read-write dependency and
// there is no dangerous structure to detect — classic write skew. The lock makes the ordering explicit
// instead of hoping the isolation level notices.
//
// REPLACEMENT IS ATOMIC OR IT DOES NOT HAPPEN. A correction is RETIRE(incumbent) + ACTIVATE(replacement) in
// ONE transaction under ONE lock, so no window exists in which zero or two authorities are ACTIVE. And
// because `policyLifecycle` has no SUPERSEDED transition, RETIRE + ACTIVATE is the honest representation
// rather than a new verb invented to describe it.
import { prisma, type DbClient } from "../db";
import { ConflictError } from "../http/errors";
import { canTransition, deriveState, type PolicyLifecycleEvent, type PolicyState } from "../../src/contract/policyLifecycle";

/** What a scope's ACTIVE population must look like for a transition to be legal. */
export type CardinalityMode =
  /** Activating a new authority. REFUSES if any other authority in scope is already ACTIVE. */
  | "activate"
  /** Correcting: retire the named incumbent and activate the replacement, atomically. */
  | "replace";

/** One versioned subject inside a cardinality scope — a namespace version, a set version, a revision. */
export interface ScopedSubject {
  /** Stable, human-readable key for this subject within its scope (e.g. a version or revision). */
  readonly subjectKey: string;
  readonly events: readonly PolicyLifecycleEvent[];
}

export interface CardinalityDecision {
  readonly subjectKey: string;
  readonly state: PolicyState | null;
}

/**
 * Take the per-scope transaction-scoped advisory lock.
 *
 * The key is CLASS-PREFIXED so two unrelated governance objects never queue on each other and the intent is
 * legible at the call site. As in `caseGuard`, a `hashtext` collision can only cause extra serialization —
 * two unrelated scopes briefly queue — never a wrong answer.
 */
export async function lockScope(scopeKey: string, tx: DbClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scopeKey}))`;
}

/**
 * Which subjects in this scope are ACTIVE, derived from their event logs.
 *
 * Deliberately takes the already-read events rather than querying: the CALLER must have read them inside the
 * transaction, and passing them in makes that visible at the call site instead of hiding a query in here.
 */
export function activeSubjects(subjects: readonly ScopedSubject[]): readonly CardinalityDecision[] {
  return Object.freeze(
    subjects
      .map((s) => ({ subjectKey: s.subjectKey, state: deriveState([...s.events]) }))
      .filter((s) => s.state === "ACTIVE"),
  );
}

export interface CardinalityGuardInput {
  /** The advisory-lock scope. Every activation that competes for singular authority shares it. */
  readonly scopeKey: string;
  readonly mode: CardinalityMode;
  /** The subject being activated. */
  readonly subjectKey: string;
  /** Required when `mode` is "replace": the incumbent to retire in the same transaction. */
  readonly replacesSubjectKey?: string;
  /**
   * Re-read EVERY subject in the scope through the transaction. Called after the lock is held, so what it
   * returns is what the scope actually contains at the moment of decision.
   */
  readonly reread: (tx: DbClient) => Promise<readonly ScopedSubject[]>;
  /** Append one lifecycle event. Runs on the SAME transaction client, so it commits or rolls back together. */
  readonly append: (tx: DbClient, subjectKey: string, transition: "ACTIVATED" | "RETIRED") => Promise<void>;
}

/**
 * Activate — or atomically replace — one authority, refusing rather than creating a second ACTIVE one.
 *
 * Throws `ConflictError` on every cardinality violation. That is correct here and is NOT the fail-closed
 * path for assessment: this is a governance WRITE requested by a steward, so a refusal belongs in the
 * response to that request. Candidate-capable staging fails closed separately, through the typed
 * non-throwing decision the resolver returns.
 */
export async function withCardinalityGuardedActivation(
  input: CardinalityGuardInput,
): Promise<{ readonly activated: string; readonly retired: string | null }> {
  return prisma.$transaction(async (tx) => {
    // 1 · serialize every competing activation in this scope.
    await lockScope(input.scopeKey, tx);

    // 2 · re-read INSIDE the transaction. A lock without this step orders the writes and still permits two
    //     ACTIVE authorities, which is the whole defect.
    const subjects = await input.reread(tx);
    const active = activeSubjects(subjects);
    const self = subjects.find((s) => s.subjectKey === input.subjectKey);
    if (!self) throw new ConflictError("the subject being activated does not exist in this scope");

    const selfState = deriveState([...self.events]);
    if (!canTransition(selfState, "ACTIVATED")) {
      throw new ConflictError(
        `cannot activate from ${selfState ?? "no state"}: only a draft or a frozen authority may be activated`,
      );
    }

    // 3 · verify cardinality.
    const others = active.filter((a) => a.subjectKey !== input.subjectKey);
    if (input.mode === "activate") {
      if (others.length > 0) {
        throw new ConflictError(
          `another authority is already active in this scope (${others.map((o) => o.subjectKey).join(", ")}); ` +
            "activation does not implicitly displace an incumbent — request a replacement naming it explicitly",
        );
      }
      await input.append(tx, input.subjectKey, "ACTIVATED");
      return { activated: input.subjectKey, retired: null };
    }

    // "replace" — the incumbent must be named, must exist, and must be the ONLY other active authority.
    const incumbent = input.replacesSubjectKey;
    if (!incumbent) throw new ConflictError("a replacement must name the authority it replaces");
    if (others.length !== 1 || others[0]!.subjectKey !== incumbent) {
      throw new ConflictError(
        `the named incumbent is not the sole active authority in this scope (active: ` +
          `${others.map((o) => o.subjectKey).join(", ") || "none"})`,
      );
    }
    // 4 · retire and activate TOGETHER. One transaction, one lock: no window with zero or two ACTIVE.
    await input.append(tx, incumbent, "RETIRED");
    await input.append(tx, input.subjectKey, "ACTIVATED");
    return { activated: input.subjectKey, retired: incumbent };
  });
}
