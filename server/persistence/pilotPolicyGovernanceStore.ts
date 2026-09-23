// EP-15 · Persistence for policy lifecycle and dataset pre-registration.
//
// Two append-only tables, both boundary-scoped, both with no mutation path:
//   • the lifecycle log, from which a policy's state is DERIVED (never an editable status column);
//   • dataset sightings, which record when a boundary first saw a dataset fingerprint.
//
// The sighting table is small and looks unimportant, and it is the reason the whole feature holds:
// a policy may judge a dataset only if it was activated BEFORE that dataset was first seen. Without
// it, someone could read a verdict, activate a laxer version and resubmit — tuning the bar to the
// result. It stores a fingerprint and a timestamp: no row content, no identifiers.
import { prisma, type DbClient } from "../db";
import type { PolicyLifecycleEvent, PolicyState, PolicyTransition } from "../../src/contract/policyLifecycle";
import { deriveState } from "../../src/contract/policyLifecycle";

export interface AppendPolicyEventInput {
  readonly boundaryId: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly transition: PolicyTransition;
  readonly actorId: string;
  readonly actorRole: string;
  readonly rationale: string;
}

export async function appendPolicyEvent(
  input: AppendPolicyEventInput,
  client: DbClient = prisma,
): Promise<PolicyLifecycleEvent> {
  const row = await client.pilotAdmissionPolicyEventRecord.create({
    data: {
      id: `PPE-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      boundaryId: input.boundaryId,
      policyId: input.policyId,
      policyVersion: input.policyVersion,
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
export async function policyEvents(
  boundaryId: string,
  policyId: string,
  policyVersion: string,
  client: DbClient = prisma,
): Promise<readonly PolicyLifecycleEvent[]> {
  const rows = await client.pilotAdmissionPolicyEventRecord.findMany({
    where: { boundaryId, policyId, policyVersion },
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

export interface PolicyGovernanceState {
  readonly state: PolicyState | null;
  readonly events: readonly PolicyLifecycleEvent[];
  readonly proposedBy: string | null;
  readonly proposedAt: string | null;
  readonly activatedBy: string | null;
  /** When the CURRENT activation took effect. Compared against a dataset's first sighting. */
  readonly activatedAt: string | null;
}

/**
 * Current state plus the audit metadata a decision must carry.
 *
 * `activatedAt` is the MOST RECENT activation, not the first: a policy frozen and later resumed has
 * effectively been re-blessed, and the pre-registration test must be against the blessing that is
 * actually in force. Taking the earliest would let a freeze/unfreeze cycle launder a policy into
 * looking older than its current authority.
 */
export async function policyGovernanceState(
  boundaryId: string,
  policyId: string,
  policyVersion: string,
  client: DbClient = prisma,
): Promise<PolicyGovernanceState> {
  const events = await policyEvents(boundaryId, policyId, policyVersion, client);
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

/**
 * Record that this boundary has seen this dataset, returning the FIRST sighting time.
 *
 * Idempotent by construction: a repeat submission does not move the timestamp, because the first
 * sighting is the one the pre-registration rule depends on. Moving it later would be exactly the
 * loophole — resubmit until the clock favours a newly activated policy.
 */
export async function recordDatasetSighting(
  boundaryId: string,
  datasetFingerprint: string,
  client: DbClient = prisma,
): Promise<string> {
  const existing = await client.pilotDatasetSightingRecord.findUnique({
    where: { boundaryId_datasetFingerprint: { boundaryId, datasetFingerprint } },
  });
  if (existing) return existing.firstSeenAt.toISOString();
  try {
    const created = await client.pilotDatasetSightingRecord.create({ data: { boundaryId, datasetFingerprint } });
    return created.firstSeenAt.toISOString();
  } catch {
    // Lost a race with a concurrent identical submission: re-read rather than overwrite. The row
    // the other request wrote IS the first sighting.
    const row = await client.pilotDatasetSightingRecord.findUniqueOrThrow({
      where: { boundaryId_datasetFingerprint: { boundaryId, datasetFingerprint } },
    });
    return row.firstSeenAt.toISOString();
  }
}
