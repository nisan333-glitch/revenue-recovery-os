import { PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { assertCaseCandidateIdentity, type CaseCandidate, type CaseCandidateStore } from "./caseAdmission";

interface Row {
  candidate_id: string;
  dedupe_key: string;
  boundary_id: string;
  agent_id: string;
  signal: unknown;
  submitted_at: Date;
}

/**
 * The minimum a candidate insert needs. Narrow on purpose: an interactive transaction client can
 * satisfy it, and a `PrismaClient` can too, which is what lets one batch be all-or-nothing without
 * duplicating the SQL that decides candidate identity.
 */
type RawQueryClient = Pick<PrismaClient, "$queryRaw">;

/**
 * Insert one candidate unless its dedupe key already exists, using whatever client is supplied.
 *
 * Extracted from the class below so the two callers cannot drift: `ON CONFLICT (dedupe_key) DO NOTHING`
 * followed by a `FOR SHARE` read IS the dedup guarantee, and two copies of it would be two guarantees.
 */
async function insertCandidateIfAbsent(
  client: RawQueryClient,
  candidate: CaseCandidate,
): Promise<{ readonly candidate: CaseCandidate; readonly created: boolean }> {
  const inserted = await client.$queryRaw<Row[]>`
    INSERT INTO agent_case_candidates
      (candidate_id, dedupe_key, boundary_id, agent_id, signal, status, submitted_at, persisted_at)
    VALUES (${candidate.candidateId}, ${candidate.dedupeKey}, ${candidate.boundaryId}, ${candidate.agentId},
            ${JSON.stringify(candidate.signal)}::jsonb, 'pending_review', clock_timestamp(), clock_timestamp())
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING candidate_id, dedupe_key, boundary_id, agent_id, signal, submitted_at`;
  if (inserted[0]) return { candidate: mapRow(inserted[0]), created: true };
  const existing = await client.$queryRaw<Row[]>`
    SELECT candidate_id, dedupe_key, boundary_id, agent_id, signal, submitted_at
      FROM agent_case_candidates WHERE dedupe_key = ${candidate.dedupeKey} FOR SHARE`;
  if (!existing[0]) throw new Error("candidate dedupe conflict could not be resolved");
  return { candidate: mapRow(existing[0]), created: false };
}

export class PostgresCaseCandidateStore implements CaseCandidateStore {
  constructor(private readonly client: PrismaClient = prisma) {}

  async createIfAbsent(candidate: CaseCandidate): Promise<{ readonly candidate: CaseCandidate; readonly created: boolean }> {
    assertCaseCandidateIdentity(candidate);
    return this.client.$transaction(async (tx) => insertCandidateIfAbsent(tx, candidate));
  }
}

/**
 * EP-31 · A store that JOINS an existing transaction instead of opening its own.
 *
 * Why it exists: the governed emitter admits a whole execution's signals together, so a failure part
 * way through must leave NO candidate rather than some. `PostgresCaseCandidateStore` cannot do that —
 * it opens a transaction per candidate, which is correct for a single submission and wrong for a batch.
 * Nothing about candidate identity or dedup differs; both call the same insert.
 */
export class TransactionalCaseCandidateStore implements CaseCandidateStore {
  constructor(private readonly tx: RawQueryClient) {}

  async createIfAbsent(candidate: CaseCandidate): Promise<{ readonly candidate: CaseCandidate; readonly created: boolean }> {
    assertCaseCandidateIdentity(candidate);
    return insertCandidateIfAbsent(this.tx, candidate);
  }
}

function mapRow(row: Row): CaseCandidate {
  const candidate = Object.freeze({
    candidateId: row.candidate_id,
    dedupeKey: row.dedupe_key,
    boundaryId: row.boundary_id,
    agentId: row.agent_id,
    signal: row.signal,
    status: "pending_review" as const,
    submittedAt: row.submitted_at.toISOString(),
  }) as CaseCandidate;
  assertCaseCandidateIdentity(candidate);
  return candidate;
}
