// EP-26 · Storage for governed analysis terms, and for their append-only lifecycle.
//
// TENANT ISOLATION IS THE POINT, as it is for the admission bar: every read is filtered by
// `boundaryId`, so a terms id borrowed from another tenant reads as ABSENT rather than as that
// tenant's cut-off. Silently reading tenant B's data as of tenant A's cut-off would not error — it
// would produce a confident, wrong number, and it would leak which period A considers current.
//
// A SEPARATE MODULE from `pilotPolicyGovernanceStore`, mirroring it rather than extending it. The
// lifecycle RULES are shared (`src/contract/policyLifecycle.ts`, imported by both); the STORAGE is
// not, because one event table keyed by a single id would let an admission policy id collide with a
// terms id and make one governance act read as the other.
import { prisma, type DbClient } from "../db";
import { makeAnalysisTerms, type AnalysisTerms } from "../../src/contract/analysisTerms";
import type { PolicyLifecycleEvent, PolicyState, PolicyTransition } from "../../src/contract/policyLifecycle";
import { deriveState } from "../../src/contract/policyLifecycle";

export interface StoredAnalysisTerms {
  readonly boundaryId: string;
  readonly terms: AnalysisTerms;
  /** Deterministic hash of the definition, stamped into every execution binding. */
  readonly termsHash: string;
  readonly registeredByActorId: string;
  readonly registeredByRole: string;
  readonly registeredAt: string;
}

type Row = Awaited<ReturnType<typeof prisma.pilotAnalysisTermsRecord.findFirstOrThrow>>;

function toStored(row: Row): StoredAnalysisTerms {
  return Object.freeze({
    boundaryId: row.boundaryId,
    termsHash: row.termsHash,
    // Rebuilt through the domain constructor, which re-validates. A row that somehow held an
    // impossible cut-off fails loudly here rather than quietly defining what "stalled" means.
    terms: makeAnalysisTerms({
      termsId: row.termsId,
      termsVersion: row.termsVersion,
      asOf: row.asOf,
      stallThresholdDays: row.stallThresholdDays,
      currency: row.currency,
      calculationMethodVersion: row.calculationMethodVersion,
    }),
    registeredByActorId: row.registeredByActorId,
    registeredByRole: row.registeredByRole,
    registeredAt: row.registeredAt.toISOString(),
  });
}

/**
 * Load one terms version for a boundary.
 *
 * Unlike the admission bar, `termsVersion` is REQUIRED — there is no "latest" fallback. "Latest"
 * would mean a newly activated cut-off could silently become the one a caller gets, which is the
 * ungoverned change this feature exists to prevent: the caller must name the definition it wants,
 * and that name is what the binding records.
 */
export async function findAnalysisTerms(
  boundaryId: string,
  termsId: string,
  termsVersion: string,
  client: DbClient = prisma,
): Promise<StoredAnalysisTerms | null> {
  const row = await client.pilotAnalysisTermsRecord.findUnique({
    where: { boundaryId_termsId_termsVersion: { boundaryId, termsId, termsVersion } },
  });
  return row ? toStored(row) : null;
}

/** Every registered version in a boundary, newest first. Boundary-scoped. */
export async function listAnalysisTerms(
  boundaryId: string,
  client: DbClient = prisma,
): Promise<readonly StoredAnalysisTerms[]> {
  const rows = await client.pilotAnalysisTermsRecord.findMany({
    where: { boundaryId },
    orderBy: [{ registeredAt: "desc" }, { termsId: "asc" }, { termsVersion: "asc" }],
  });
  return Object.freeze(rows.map(toStored));
}

export interface RegisterAnalysisTermsInput {
  readonly boundaryId: string;
  readonly terms: AnalysisTerms;
  /** Computed by the caller from the domain hasher — never derived inside the store. */
  readonly termsHash: string;
  readonly registeredByActorId: string;
  readonly registeredByRole: string;
}

/** Register a terms version. A duplicate (boundary, id, version) is refused by the primary key. */
export async function registerAnalysisTerms(
  input: RegisterAnalysisTermsInput,
  client: DbClient = prisma,
): Promise<StoredAnalysisTerms> {
  const t = input.terms;
  const row = await client.pilotAnalysisTermsRecord.create({
    data: {
      boundaryId: input.boundaryId,
      termsId: t.termsId,
      termsVersion: t.termsVersion,
      asOf: t.asOf,
      stallThresholdDays: t.stallThresholdDays,
      currency: t.currency,
      calculationMethodVersion: t.calculationMethodVersion,
      termsHash: input.termsHash,
      registeredByActorId: input.registeredByActorId,
      registeredByRole: input.registeredByRole,
    },
  });
  return toStored(row);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────────────────────────

export interface AppendAnalysisTermsEventInput {
  readonly boundaryId: string;
  readonly termsId: string;
  readonly termsVersion: string;
  readonly transition: PolicyTransition;
  readonly actorId: string;
  readonly actorRole: string;
  readonly rationale: string;
}

export async function appendAnalysisTermsEvent(
  input: AppendAnalysisTermsEventInput,
  client: DbClient = prisma,
): Promise<PolicyLifecycleEvent> {
  const row = await client.pilotAnalysisTermsEventRecord.create({
    data: {
      id: `PTE-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      boundaryId: input.boundaryId,
      termsId: input.termsId,
      termsVersion: input.termsVersion,
      transition: input.transition,
      actorId: input.actorId,
      actorRole: input.actorRole,
      rationale: input.rationale,
    },
  });
  return Object.freeze({
    transition: row.transition as PolicyTransition,
    actorId: row.actorId,
    actorRole: row.actorRole,
    rationale: row.rationale,
    at: row.at.toISOString(),
  });
}

/**
 * The ordered rows. ONE query, shared by the two public readers so neither pays for the other.
 *
 * `at` ASC stays PRIMARY, and that is deliberate rather than inherited: the log spans the migration
 * that introduced `seq`, so rows older than it have a real timestamp and no append order. Making `seq`
 * primary would hoist every legacy row to one end of the log.
 *
 * `seq` ASC then resolves same-timestamp ties in TRUE APPEND ORDER. `at` is timestamp(3), so ties are
 * not rare — and here a reversed PROPOSED/ACTIVATED pair does not merely reorder two rows: `deriveState`
 * drops an activation that arrives before any state exists, and an ACTIVE definition reads as a DRAFT.
 *
 * `id` ASC remains last and is now honest about its job: it keeps the order TOTAL for two legacy rows
 * that tie on `at` with no sequence between them. That order is arbitrary, it is no longer trusted, and
 * the governance-state reader reports it as uncertain rather than presenting it as chronology.
 */
async function orderedAnalysisTermsEventRows(
  boundaryId: string,
  termsId: string,
  termsVersion: string,
  client: DbClient,
): Promise<readonly { transition: string; actorId: string; actorRole: string; rationale: string; at: Date; seq: bigint | null }[]> {
  return client.pilotAnalysisTermsEventRecord.findMany({
    where: { boundaryId, termsId, termsVersion },
    orderBy: [{ at: "asc" }, { seq: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    select: { transition: true, actorId: true, actorRole: true, rationale: true, at: true, seq: true },
  });
}

/**
 * Which timestamps in this log hold two or more events with NO append order between them.
 *
 * The uncertainty preserved explicitly rather than resolved retroactively. Note what does NOT count: a
 * legacy row ALONE at its timestamp is ordered with certainty, because `at` alone decides it. Only a tie
 * with nothing to break it is uncertain.
 */
function uncertainTimestamps(
  rows: readonly { at: Date; seq: bigint | null }[],
): readonly string[] {
  const byAt = new Map<string, { total: number; withoutSeq: number }>();
  for (const r of rows) {
    const k = r.at.toISOString();
    const g = byAt.get(k) ?? { total: 0, withoutSeq: 0 };
    g.total += 1;
    if (r.seq === null) g.withoutSeq += 1;
    byAt.set(k, g);
  }
  return Object.freeze(
    [...byAt.entries()].filter(([, g]) => g.total > 1 && g.withoutSeq > 1).map(([k]) => k).sort(),
  );
}

/** One row as a lifecycle event. `seq` is NOT exposed: a sequence number is not a fact any consumer
 *  needs, and the smallest surface is the right one. What a consumer may need is whether the ORDER can
 *  be trusted, and that is reported by the governance-state reader where a state is derived from it. */
const toLifecycleEvent = (r: {
  transition: string; actorId: string; actorRole: string; rationale: string; at: Date;
}): PolicyLifecycleEvent =>
  Object.freeze({
    transition: r.transition as PolicyTransition,
    actorId: r.actorId,
    actorRole: r.actorRole,
    rationale: r.rationale,
    at: r.at.toISOString(),
  });

/** Full lifecycle history, oldest first. Boundary-scoped: another tenant's log is invisible. */
export async function analysisTermsEvents(
  boundaryId: string,
  termsId: string,
  termsVersion: string,
  client: DbClient = prisma,
): Promise<readonly PolicyLifecycleEvent[]> {
  const rows = await orderedAnalysisTermsEventRows(boundaryId, termsId, termsVersion, client);
  return Object.freeze(rows.map(toLifecycleEvent));
}

export interface AnalysisTermsGovernanceState {
  readonly state: PolicyState | null;
  readonly events: readonly PolicyLifecycleEvent[];
  readonly proposedBy: string | null;
  readonly proposedAt: string | null;
  readonly activatedBy: string | null;
  /** When the CURRENT activation took effect. */
  readonly activatedAt: string | null;
  /**
   * False when some timestamp in this log holds two or more events with no append order between them,
   * which can only be legacy rows written before `seq` existed. The derived state is then the reading of
   * an ambiguous log, and saying so is the point: it is NOT re-derived, invented or reordered.
   */
  readonly orderCertain: boolean;
  /** The exact timestamps whose internal order is unknown. Empty whenever `orderCertain` is true. */
  readonly orderUncertainAt: readonly string[];
}

/**
 * Current state plus the audit metadata a decision must carry.
 *
 * `activatedAt` is the MOST RECENT activation, not the first — a definition frozen and later resumed
 * has been re-blessed, and the authority actually in force is the latest blessing. Taking the
 * earliest would let a freeze/resume cycle launder a version into looking older than its authority.
 */
export async function analysisTermsGovernanceState(
  boundaryId: string,
  termsId: string,
  termsVersion: string,
  client: DbClient = prisma,
): Promise<AnalysisTermsGovernanceState> {
  const rows = await orderedAnalysisTermsEventRows(boundaryId, termsId, termsVersion, client);
  const events = Object.freeze(rows.map(toLifecycleEvent));
  const orderUncertainAt = uncertainTimestamps(rows);
  const proposed = events.find((e) => e.transition === "PROPOSED") ?? null;
  const activations = events.filter((e) => e.transition === "ACTIVATED" || e.transition === "UNFROZEN");
  const latestActivation = activations.length > 0 ? activations[activations.length - 1]! : null;
  return Object.freeze({
    state: deriveState(events),
    events,
    proposedBy: proposed?.actorId ?? null,
    proposedAt: proposed?.at ?? null,
    activatedBy: latestActivation?.actorId ?? null,
    activatedAt: latestActivation?.at ?? null,
    orderCertain: orderUncertainAt.length === 0,
    orderUncertainAt,
  });
}
