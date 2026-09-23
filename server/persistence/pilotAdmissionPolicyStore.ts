// EP-14 · Storage for versioned pilot admission policies.
//
// TENANT ISOLATION IS THE POINT OF THIS MODULE. Every read is filtered by `boundaryId`, so a policy
// id borrowed from another tenant reads as ABSENT rather than as that tenant's thresholds. That
// distinction matters more here than in most stores: silently applying tenant A's fitness bar to
// tenant B's data would not error, it would produce a confident, wrong verdict — and a fitness bar
// is a commercial judgement, so it would also leak what A considers acceptable.
//
// Append-only. A threshold change is a NEW version, never an edit: a decision stamps the exact
// policy id and version it used, and editing under that version would silently re-grade a dataset
// already judged under the old bar.
import { prisma, type DbClient } from "../db";
import { makeAdmissionPolicy, type PilotAdmissionPolicy } from "../../src/contract/pilotAdmissionPolicy";

export interface StoredAdmissionPolicy {
  readonly boundaryId: string;
  readonly policy: PilotAdmissionPolicy;
  /** EP-15 · deterministic hash of the thresholds, stamped into every decision. */
  readonly policyHash: string;
  readonly registeredByActorId: string;
  readonly registeredByRole: string;
  readonly registeredAt: string;
}

type Row = Awaited<ReturnType<typeof prisma.pilotAdmissionPolicyRecord.findFirstOrThrow>>;

function toStored(row: Row): StoredAdmissionPolicy {
  return Object.freeze({
    boundaryId: row.boundaryId,
    policyHash: row.policyHash,
    // Rebuilt through the domain constructor, which re-validates. A row that somehow held an
    // impossible threshold fails loudly here rather than quietly judging a dataset.
    policy: makeAdmissionPolicy({
      policyId: row.policyId,
      policyVersion: row.policyVersion,
      calculationMethodVersion: row.calculationMethodVersion,
      minAcceptedRows: row.minAcceptedRows,
      minDistinctEntities: row.minDistinctEntities,
      maxRejectionRate: row.maxRejectionRate,
      maxSingleReasonShare: row.maxSingleReasonShare,
      maxDuplicateRate: row.maxDuplicateRate,
      minCoverageDays: row.minCoverageDays,
      requiredLifecycleStates: row.requiredLifecycleStates as PilotAdmissionPolicy["requiredLifecycleStates"],
      maxOrderingDefectRate: row.maxOrderingDefectRate,
      maxMissingRecommendedColumns: row.maxMissingRecommendedColumns,
      requireProvenanceDeclaration: row.requireProvenanceDeclaration,
    }),
    registeredByActorId: row.registeredByActorId,
    registeredByRole: row.registeredByRole,
    registeredAt: row.registeredAt.toISOString(),
  });
}

/**
 * Load one policy for a boundary. When `policyVersion` is omitted the most recently registered
 * version of that id is used — and the version actually used is returned and stamped, so "latest"
 * never becomes ambiguous after the fact.
 */
export async function findAdmissionPolicy(
  boundaryId: string,
  policyId: string,
  policyVersion?: string,
  client: DbClient = prisma,
): Promise<StoredAdmissionPolicy | null> {
  const row = await client.pilotAdmissionPolicyRecord.findFirst({
    where: { boundaryId, policyId, ...(policyVersion ? { policyVersion } : {}) },
    orderBy: { registeredAt: "desc" },
  });
  return row ? toStored(row) : null;
}

export interface RegisterAdmissionPolicyInput {
  readonly boundaryId: string;
  readonly policy: PilotAdmissionPolicy;
  /** Computed by the caller from the domain hasher — never derived inside the store. */
  readonly policyHash: string;
  readonly registeredByActorId: string;
  readonly registeredByRole: string;
}

/** Register a policy version. A duplicate (boundary, id, version) is refused by the primary key. */
export async function registerAdmissionPolicy(
  input: RegisterAdmissionPolicyInput,
  client: DbClient = prisma,
): Promise<StoredAdmissionPolicy> {
  const p = input.policy;
  const row = await client.pilotAdmissionPolicyRecord.create({
    data: {
      boundaryId: input.boundaryId,
      policyId: p.policyId,
      policyVersion: p.policyVersion,
      calculationMethodVersion: p.calculationMethodVersion,
      minAcceptedRows: p.minAcceptedRows,
      minDistinctEntities: p.minDistinctEntities,
      maxRejectionRate: p.maxRejectionRate,
      maxSingleReasonShare: p.maxSingleReasonShare,
      maxDuplicateRate: p.maxDuplicateRate,
      minCoverageDays: p.minCoverageDays,
      requiredLifecycleStates: [...p.requiredLifecycleStates],
      maxOrderingDefectRate: p.maxOrderingDefectRate,
      maxMissingRecommendedColumns: p.maxMissingRecommendedColumns,
      requireProvenanceDeclaration: p.requireProvenanceDeclaration,
      policyHash: input.policyHash,
      registeredByActorId: input.registeredByActorId,
      registeredByRole: input.registeredByRole,
    },
  });
  return toStored(row);
}
