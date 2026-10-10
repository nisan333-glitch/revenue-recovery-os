// Step 5 · Governed source authority — three propose/activate pairs over one lifecycle.
//
// WHAT IS GOVERNED AND WHY EACH IS SEPARATE:
//   • the NAMESPACE VERSION — what an external system id means;
//   • the BOUNDARY PERMITTED SET — which systems a tenant may draw obligations from;
//   • the DATASET BINDING — which system a specific extract came from, where inheritance cannot decide.
//
// All three reuse `policyLifecycle`, so state is derived from an append-only event log and never stored as a
// status column. All three split proposing from activating, and the split is enforced ON THE ACTOR ID rather
// than on the role: an actor holding both permissions still cannot put their own proposal in force. That is
// the same check `pilotIntakeService` and `pilotAnalysisTermsService` already make, reused rather than
// restated.
//
// EVERY ACTIVATION GOES THROUGH `withCardinalityGuardedActivation`. A lock alone would order two concurrent
// activations without preventing both from succeeding; the guard re-reads inside the transaction and refuses
// rather than creating a second ACTIVE authority. Corrections are RETIRE + ACTIVATE in one transaction —
// `policyLifecycle` has no SUPERSEDED transition and none is invented here.
//
// NO NEW ROLE AND NO SUPERUSER. The customer side proposes; the steward activates. The steward still cannot
// count, so this grants authority over provenance and no path to a number.
import { randomUUID } from "node:crypto";
import { prisma, type DbClient } from "../db";
import { ConflictError, ForbiddenError, NotFoundError } from "../http/errors";
import { requireBoundaryAccess, type ActorContext } from "../auth/identity";
import { requireCan } from "../auth/authorityGate";
import { deriveState, type PolicyLifecycleEvent, type PolicyState } from "../../src/contract/policyLifecycle";
import { sourceNamespaceIdProblem } from "../../src/contract/sourceNamespace";
import { withCardinalityGuardedActivation, type ScopedSubject } from "./governedCardinality";

type Client = DbClient | typeof prisma;

const event = (
  transition: PolicyLifecycleEvent["transition"],
  actor: ActorContext,
  rationale: string,
) => ({ transition, actorId: actor.actorId, actorRole: actor.role, rationale });

function requireRationale(rationale: string): string {
  const trimmed = rationale?.trim() ?? "";
  // A governance decision with no stated reason is not one. The database also refuses it; this gives the
  // caller a 409 instead of a constraint error.
  if (trimmed === "") throw new ConflictError("a governance transition requires a stated reason");
  return trimmed;
}

/** The actor who PROPOSED a subject, or null. Separation of duties is checked against this. */
function proposedBy(events: readonly PolicyLifecycleEvent[]): string | null {
  return events.find((e) => e.transition === "PROPOSED")?.actorId ?? null;
}

function assertDifferentActor(events: readonly PolicyLifecycleEvent[], actor: ActorContext, what: string): void {
  if (proposedBy(events) === actor.actorId) {
    throw new ForbiddenError(
      `separation of duties: the actor who proposed ${what} cannot be the one who puts it in force`,
    );
  }
}

// ── 1 · SourceNamespace ───────────────────────────────────────────────────────────────────────────

export async function proposeSourceNamespace(
  actor: ActorContext,
  input: { readonly namespaceId: string; readonly namespaceVersion: string; readonly label: string; readonly rationale: string },
): Promise<{ readonly namespaceId: string; readonly namespaceVersion: string; readonly state: PolicyState | null }> {
  requireCan(actor, "ProposeSourceNamespace");
  const rationale = requireRationale(input.rationale);
  const problem = sourceNamespaceIdProblem(input.namespaceId);
  // The pure validator's rule, applied before the database restates it — including the refusal of the four
  // class-grained evidence source-system names.
  if (problem !== null) throw new ConflictError(`invalid source namespace: ${problem}`);
  if (input.namespaceVersion.trim() === "" || input.label.trim() === "") {
    throw new ConflictError("a namespace version and a label are both required");
  }

  // ONE TRANSACTION: a registration with no PROPOSED event is not a proposal, it is an orphan row.
  await prisma.$transaction(async (tx) => {
    await tx.pilotSourceNamespaceRecord.upsert({
      where: { namespaceId: input.namespaceId },
      // The stable identity may already exist — a second VERSION of a known system is the ordinary case.
      update: {},
      create: { namespaceId: input.namespaceId, registeredByActorId: actor.actorId, registeredByRole: actor.role },
    });
    await tx.pilotSourceNamespaceVersionRecord.create({
      data: {
        namespaceId: input.namespaceId, namespaceVersion: input.namespaceVersion, label: input.label.trim(),
        registeredByActorId: actor.actorId, registeredByRole: actor.role,
      },
    });
    await tx.pilotSourceNamespaceEventRecord.create({
      data: { id: randomUUID(), namespaceId: input.namespaceId, namespaceVersion: input.namespaceVersion,
        ...event("PROPOSED", actor, rationale) },
    });
  });
  return { namespaceId: input.namespaceId, namespaceVersion: input.namespaceVersion, state: "DRAFT" };
}

async function namespaceScope(namespaceId: string, client: Client = prisma): Promise<readonly ScopedSubject[]> {
  const versions = await client.pilotSourceNamespaceVersionRecord.findMany({ where: { namespaceId } });
  const subjects: ScopedSubject[] = [];
  for (const v of versions) {
    subjects.push({ subjectKey: v.namespaceVersion, events: await namespaceEvents(namespaceId, v.namespaceVersion, client) });
  }
  return subjects;
}

async function namespaceEvents(
  namespaceId: string, namespaceVersion: string, client: Client = prisma,
): Promise<readonly PolicyLifecycleEvent[]> {
  const rows = await client.pilotSourceNamespaceEventRecord.findMany({
    where: { namespaceId, namespaceVersion }, orderBy: { at: "asc" },
  });
  return rows.map((r) => ({
    transition: r.transition as PolicyLifecycleEvent["transition"],
    actorId: r.actorId, actorRole: r.actorRole, rationale: r.rationale, at: r.at.toISOString(),
  }));
}

export async function activateSourceNamespace(
  actor: ActorContext,
  input: { readonly namespaceId: string; readonly namespaceVersion: string; readonly rationale: string; readonly replaces?: string },
): Promise<{ readonly activated: string; readonly retired: string | null }> {
  requireCan(actor, "ActivateSourceNamespace");
  const rationale = requireRationale(input.rationale);
  const existing = await prisma.pilotSourceNamespaceVersionRecord.findUnique({
    where: { namespaceId_namespaceVersion: { namespaceId: input.namespaceId, namespaceVersion: input.namespaceVersion } },
  });
  if (!existing) throw new NotFoundError("no such source-namespace version exists");
  assertDifferentActor(await namespaceEvents(input.namespaceId, input.namespaceVersion), actor, "a source namespace");

  return withCardinalityGuardedActivation({
    scopeKey: `nh-source-namespace:${input.namespaceId}`,
    mode: input.replaces ? "replace" : "activate",
    subjectKey: input.namespaceVersion,
    replacesSubjectKey: input.replaces,
    reread: (tx) => namespaceScope(input.namespaceId, tx),
    append: async (tx, subjectKey, transition) => {
      await tx.pilotSourceNamespaceEventRecord.create({
        data: { id: randomUUID(), namespaceId: input.namespaceId, namespaceVersion: subjectKey,
          ...event(transition, actor, rationale) },
      });
    },
  });
}

// ── 2 · BoundarySourceSet ─────────────────────────────────────────────────────────────────────────

export async function proposeBoundarySourceSet(
  actor: ActorContext,
  input: {
    readonly boundaryId: string; readonly setId: string; readonly setVersion: string;
    readonly memberNamespaceIds: readonly string[]; readonly rationale: string;
  },
): Promise<{ readonly setId: string; readonly setVersion: string; readonly memberCount: number }> {
  requireCan(actor, "ProposeBoundarySourceSet");
  requireBoundaryAccess(actor, input.boundaryId);
  const rationale = requireRationale(input.rationale);
  const members = [...new Set(input.memberNamespaceIds.map((m) => m.trim()).filter((m) => m !== ""))].sort();
  if (members.length === 0) throw new ConflictError("a permitted set must name at least one namespace");

  await prisma.$transaction(async (tx) => {
    await tx.pilotBoundarySourceSetRecord.create({
      data: { boundaryId: input.boundaryId, setId: input.setId, setVersion: input.setVersion,
        registeredByActorId: actor.actorId, registeredByRole: actor.role },
    });
    for (const namespaceId of members) {
      // The foreign key refuses a member that was never registered, so a set cannot permit a namespace
      // nobody has declared.
      await tx.pilotBoundarySourceSetMemberRecord.create({
        data: { boundaryId: input.boundaryId, setId: input.setId, setVersion: input.setVersion, namespaceId },
      });
    }
    await tx.pilotBoundarySourceSetEventRecord.create({
      data: { id: randomUUID(), boundaryId: input.boundaryId, setId: input.setId, setVersion: input.setVersion,
        ...event("PROPOSED", actor, rationale) },
    });
  });
  return { setId: input.setId, setVersion: input.setVersion, memberCount: members.length };
}

async function setEvents(
  boundaryId: string, setId: string, setVersion: string, client: Client = prisma,
): Promise<readonly PolicyLifecycleEvent[]> {
  const rows = await client.pilotBoundarySourceSetEventRecord.findMany({
    where: { boundaryId, setId, setVersion }, orderBy: { at: "asc" },
  });
  return rows.map((r) => ({
    transition: r.transition as PolicyLifecycleEvent["transition"],
    actorId: r.actorId, actorRole: r.actorRole, rationale: r.rationale, at: r.at.toISOString(),
  }));
}

/** Every set version in a boundary. The cardinality scope is the BOUNDARY, across all set identities. */
async function boundarySetScope(boundaryId: string, client: Client = prisma): Promise<readonly ScopedSubject[]> {
  const sets = await client.pilotBoundarySourceSetRecord.findMany({ where: { boundaryId } });
  const subjects: ScopedSubject[] = [];
  for (const s of sets) {
    subjects.push({
      subjectKey: `${s.setId}@${s.setVersion}`,
      events: await setEvents(boundaryId, s.setId, s.setVersion, client),
    });
  }
  return subjects;
}

export async function activateBoundarySourceSet(
  actor: ActorContext,
  input: {
    readonly boundaryId: string; readonly setId: string; readonly setVersion: string;
    readonly rationale: string; readonly replaces?: string;
  },
): Promise<{ readonly activated: string; readonly retired: string | null }> {
  requireCan(actor, "ActivateBoundarySourceSet");
  requireBoundaryAccess(actor, input.boundaryId);
  const rationale = requireRationale(input.rationale);
  const stored = await prisma.pilotBoundarySourceSetRecord.findUnique({
    where: { boundaryId_setId_setVersion: { boundaryId: input.boundaryId, setId: input.setId, setVersion: input.setVersion } },
  });
  if (!stored) throw new NotFoundError("no such permitted-namespace set version exists for this boundary");
  assertDifferentActor(
    await setEvents(input.boundaryId, input.setId, input.setVersion), actor, "a permitted-namespace set",
  );

  return withCardinalityGuardedActivation({
    scopeKey: `nh-boundary-source-set:${input.boundaryId}`,
    mode: input.replaces ? "replace" : "activate",
    subjectKey: `${input.setId}@${input.setVersion}`,
    replacesSubjectKey: input.replaces,
    reread: (tx) => boundarySetScope(input.boundaryId, tx),
    append: async (tx, subjectKey, transition) => {
      const [setId, setVersion] = subjectKey.split("@") as [string, string];
      await tx.pilotBoundarySourceSetEventRecord.create({
        data: { id: randomUUID(), boundaryId: input.boundaryId, setId, setVersion,
          ...event(transition, actor, rationale) },
      });
    },
  });
}

// ── 3 · DatasetSourceBinding ──────────────────────────────────────────────────────────────────────

/**
 * The advisory-lock scope key for one dataset's bindings.
 *
 * NUL IS NOT AVAILABLE HERE, and that is a Postgres fact rather than a preference: a text parameter
 * containing 0x00 is rejected outright ("invalid byte sequence for encoding UTF8"). NUL is the right
 * separator for an in-memory canonical key — `canonicalLeakInstanceKey` uses it — but it cannot cross into
 * SQL. So the boundary id is LENGTH-FRAMED instead, which keeps the key injective for the same reason the
 * canonical encoder frames its components: no value can impersonate the separator.
 *
 * Defined once and used by both the proposal (which allocates a revision) and the activation (which enforces
 * cardinality), so the two provably contend on the same lock rather than on two keys that merely look alike.
 */
function bindingScopeKey(boundaryId: string, datasetFingerprint: string): string {
  return `nh-dataset-source-binding:${boundaryId.length}:${boundaryId}:${datasetFingerprint}`;
}

export async function proposeDatasetSourceBinding(
  actor: ActorContext,
  input: {
    readonly boundaryId: string; readonly datasetFingerprint: string;
    readonly namespaceId: string; readonly rationale: string;
  },
): Promise<{ readonly revision: number }> {
  requireCan(actor, "ProposeDatasetSourceBinding");
  requireBoundaryAccess(actor, input.boundaryId);
  const rationale = requireRationale(input.rationale);

  // The revision is allocated under the SAME advisory lock the activation uses, so two concurrent proposals
  // cannot claim one number. The primary key would also refuse the collision; taking the lock turns a
  // constraint error into an ordered allocation.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${bindingScopeKey(input.boundaryId, input.datasetFingerprint)}))`;
    const prior = await tx.pilotDatasetSourceBindingRecord.findMany({
      where: { boundaryId: input.boundaryId, datasetFingerprint: input.datasetFingerprint },
      orderBy: { revision: "desc" }, take: 1,
    });
    const revision = (prior[0]?.revision ?? 0) + 1;
    await tx.pilotDatasetSourceBindingRecord.create({
      data: { boundaryId: input.boundaryId, datasetFingerprint: input.datasetFingerprint, revision,
        namespaceId: input.namespaceId, registeredByActorId: actor.actorId, registeredByRole: actor.role },
    });
    await tx.pilotDatasetSourceBindingEventRecord.create({
      data: { id: randomUUID(), boundaryId: input.boundaryId, datasetFingerprint: input.datasetFingerprint,
        revision, ...event("PROPOSED", actor, rationale) },
    });
    return { revision };
  });
}

async function bindingEvents(
  boundaryId: string, datasetFingerprint: string, revision: number, client: Client = prisma,
): Promise<readonly PolicyLifecycleEvent[]> {
  const rows = await client.pilotDatasetSourceBindingEventRecord.findMany({
    where: { boundaryId, datasetFingerprint, revision }, orderBy: { at: "asc" },
  });
  return rows.map((r) => ({
    transition: r.transition as PolicyLifecycleEvent["transition"],
    actorId: r.actorId, actorRole: r.actorRole, rationale: r.rationale, at: r.at.toISOString(),
  }));
}

async function bindingScope(
  boundaryId: string, datasetFingerprint: string, client: Client = prisma,
): Promise<readonly ScopedSubject[]> {
  const rows = await client.pilotDatasetSourceBindingRecord.findMany({ where: { boundaryId, datasetFingerprint } });
  const subjects: ScopedSubject[] = [];
  for (const r of rows) {
    subjects.push({
      subjectKey: String(r.revision),
      events: await bindingEvents(boundaryId, datasetFingerprint, r.revision, client),
    });
  }
  return subjects;
}

export async function activateDatasetSourceBinding(
  actor: ActorContext,
  input: {
    readonly boundaryId: string; readonly datasetFingerprint: string; readonly revision: number;
    readonly rationale: string; readonly replaces?: number;
  },
): Promise<{ readonly activated: string; readonly retired: string | null }> {
  requireCan(actor, "ActivateDatasetSourceBinding");
  requireBoundaryAccess(actor, input.boundaryId);
  const rationale = requireRationale(input.rationale);
  const stored = await prisma.pilotDatasetSourceBindingRecord.findUnique({
    where: {
      boundaryId_datasetFingerprint_revision: {
        boundaryId: input.boundaryId, datasetFingerprint: input.datasetFingerprint, revision: input.revision,
      },
    },
  });
  if (!stored) throw new NotFoundError("no such dataset source-binding revision exists");
  assertDifferentActor(
    await bindingEvents(input.boundaryId, input.datasetFingerprint, input.revision), actor, "a dataset source binding",
  );

  return withCardinalityGuardedActivation({
    scopeKey: bindingScopeKey(input.boundaryId, input.datasetFingerprint),
    mode: input.replaces === undefined ? "activate" : "replace",
    subjectKey: String(input.revision),
    replacesSubjectKey: input.replaces === undefined ? undefined : String(input.replaces),
    reread: (tx) => bindingScope(input.boundaryId, input.datasetFingerprint, tx),
    append: async (tx, subjectKey, transition) => {
      await tx.pilotDatasetSourceBindingEventRecord.create({
        data: { id: randomUUID(), boundaryId: input.boundaryId, datasetFingerprint: input.datasetFingerprint,
          revision: Number(subjectKey), ...event(transition, actor, rationale) },
      });
    },
  });
}

// ── 4 · The READ side the resolver needs ──────────────────────────────────────────────────────────

/**
 * Read every governance row bearing on one submission.
 *
 * Deliberately returns the WHOLE binding history, in every state. The resolver must be able to tell "never
 * bound" from "bound and retired", because the second must refuse rather than fall back to inheritance.
 */
export async function readSourceGovernance(
  boundaryId: string,
  datasetFingerprint: string,
): Promise<{
  readonly bindingRevisions: readonly { revision: number; namespaceId: string; state: PolicyState | null }[];
  readonly permittedSets: readonly {
    setId: string; setVersion: string; state: PolicyState | null; activatedAt: string | null;
    memberNamespaceIds: readonly string[];
  }[];
  readonly namespaceVersions: readonly {
    namespaceId: string; namespaceVersion: string; state: PolicyState | null; label: string;
  }[];
}> {
  const bindings = await prisma.pilotDatasetSourceBindingRecord.findMany({
    where: { boundaryId, datasetFingerprint }, orderBy: { revision: "asc" },
  });
  const bindingRevisions = [];
  for (const b of bindings) {
    bindingRevisions.push({
      revision: b.revision, namespaceId: b.namespaceId,
      state: deriveState([...(await bindingEvents(boundaryId, datasetFingerprint, b.revision))]),
    });
  }

  const sets = await prisma.pilotBoundarySourceSetRecord.findMany({ where: { boundaryId } });
  const permittedSets = [];
  for (const s of sets) {
    const events = await setEvents(boundaryId, s.setId, s.setVersion);
    const members = await prisma.pilotBoundarySourceSetMemberRecord.findMany({
      where: { boundaryId, setId: s.setId, setVersion: s.setVersion }, orderBy: { namespaceId: "asc" },
    });
    // The FIRST activation, not the latest: a freeze/unfreeze cycle must not be able to launder a set into
    // looking older than it is, which is the same reasoning the admission bar's ordering rule uses.
    const activatedAt = events.find((e) => e.transition === "ACTIVATED")?.at ?? null;
    permittedSets.push({
      setId: s.setId, setVersion: s.setVersion, state: deriveState([...events]), activatedAt,
      memberNamespaceIds: members.map((m) => m.namespaceId),
    });
  }

  const namespaceIds = [...new Set([
    ...bindingRevisions.map((b) => b.namespaceId),
    ...permittedSets.flatMap((s) => s.memberNamespaceIds),
  ])];
  const namespaceVersions = [];
  for (const namespaceId of namespaceIds) {
    const versions = await prisma.pilotSourceNamespaceVersionRecord.findMany({ where: { namespaceId } });
    for (const v of versions) {
      namespaceVersions.push({
        namespaceId, namespaceVersion: v.namespaceVersion, label: v.label,
        state: deriveState([...(await namespaceEvents(namespaceId, v.namespaceVersion))]),
      });
    }
  }
  return { bindingRevisions, permittedSets, namespaceVersions };
}

/**
 * When this boundary FIRST saw these bytes, or null if it never has.
 *
 * Read from the sighting record the intake writes before it resolves the admission bar, so the ordering
 * check compares governed authority against when the data actually arrived rather than against anything in
 * the current request. Exposed here so the assessment service does not reach for `prisma` directly — it
 * already talks to services and stores, and this keeps that boundary intact.
 */
export async function readDatasetFirstSeenAt(
  boundaryId: string,
  datasetFingerprint: string,
): Promise<string | null> {
  const row = await prisma.pilotDatasetSightingRecord.findUnique({
    where: { boundaryId_datasetFingerprint: { boundaryId, datasetFingerprint } },
  });
  return row ? row.firstSeenAt.toISOString() : null;
}
