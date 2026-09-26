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

/** Full lifecycle history, oldest first. Boundary-scoped: another tenant's log is invisible. */
export async function analysisTermsEvents(
  boundaryId: string,
  termsId: string,
  termsVersion: string,
  client: DbClient = prisma,
): Promise<readonly PolicyLifecycleEvent[]> {
  const rows = await client.pilotAnalysisTermsEventRecord.findMany({
    where: { boundaryId, termsId, termsVersion },
    orderBy: [{ at: "asc" }, { id: "asc" }], // id breaks ties so ordering is total, not merely stable
  });
  return Object.freeze(
    rows.map((r) =>
      Object.freeze({
        transition: r.transition as PolicyTransition,
        actorId: r.actorId,
        actorRole: r.actorRole,
        rationale: r.rationale,
        at: r.at.toISOString(),
      }),
    ),
  );
}

export interface AnalysisTermsGovernanceState {
  readonly state: PolicyState | null;
  readonly events: readonly PolicyLifecycleEvent[];
  readonly proposedBy: string | null;
  readonly proposedAt: string | null;
  readonly activatedBy: string | null;
  /** When the CURRENT activation took effect. */
  readonly activatedAt: string | null;
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
  const events = await analysisTermsEvents(boundaryId, termsId, termsVersion, client);
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
  });
}
