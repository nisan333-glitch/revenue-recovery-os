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
 * Extracted from the class below so the two callers cannot drift: the unarbitrated `ON CONFLICT DO
 * NOTHING` followed by a `FOR SHARE` read IS the dedup guarantee, and two copies of it would be two
 * guarantees.
 *
 * WHY THE CONFLICT CLAUSE NAMES NO ARBITER, which is a correction rather than a style choice. It read
 * `ON CONFLICT (dedupe_key) DO NOTHING`, and a comment here called that THE dedup guarantee. It is not:
 * `agent_case_candidates` carries THREE unique constraints — `PRIMARY KEY (candidate_id)`,
 * `UNIQUE (dedupe_key)` and `UNIQUE (candidate_id, boundary_id)` — and an ON CONFLICT arbiter covers
 * exactly ONE index. Every other unique violation is raised, not suppressed. So two concurrent
 * submissions of the SAME candidate raced into the primary key and a raw Postgres 23505
 * (`Key (candidate_id)=(CC-…) already exists`) escaped to the caller instead of the idempotent
 * `created: false` this function promises.
 *
 * THE THREE CONSTRAINTS ARE ONE EVENT, which is what licenses dropping the arbiter rather than being
 * a reason to fear doing so. `caseCandidateId` is `CC-` plus the first 24 hex of the dedupe key, so
 * `candidate_id` is a PURE FUNCTION of `dedupe_key`; `boundary_id` is in the dedupe preimage and is
 * re-checked against the signal; and `assertCaseCandidateIdentity` enforces both BEFORE this insert
 * runs. One identical candidate therefore violates all three indexes simultaneously, and which one
 * reports it is an implementation detail of index insertion order — which is precisely why this was
 * green locally and red in CI on the same commit, the event-ordering lesson in another costume.
 * `candidateIdentityConstraintsAreCorrelated` in the test file pins that derivation, so a change
 * decoupling the id from the key fails loudly instead of quietly re-opening this hole.
 *
 * AND IT STILL FAILS CLOSED FOR ANYTHING ELSE. DO NOTHING suppresses only unique and exclusion
 * violations — never a CHECK — and a conflict that is NOT this candidate's dedupe key leaves the
 * fallback SELECT empty, which throws below. A future unique constraint on some other column would
 * therefore surface as a loud refusal rather than as a wrong `created: false`.
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
    ON CONFLICT DO NOTHING
    RETURNING candidate_id, dedupe_key, boundary_id, agent_id, signal, submitted_at`;
  if (inserted[0]) return { candidate: mapRow(inserted[0]), created: true };
  const existing = await client.$queryRaw<Row[]>`
    SELECT candidate_id, dedupe_key, boundary_id, agent_id, signal, submitted_at
      FROM agent_case_candidates WHERE dedupe_key = ${candidate.dedupeKey} FOR SHARE`;
  if (!existing[0]) throw new Error("candidate dedupe conflict could not be resolved");
  return { candidate: mapRow(existing[0]), created: false };
}

/**
 * Does this boundary already hold a candidate under this exact dedupe key?
 *
 * READS THE SAME COLUMN THE INSERT DOES, which is UNIQUE and therefore already indexed — so the
 * cross-case overlap check costs one indexed lookup and needs no schema change. `boundary_id` is in
 * the predicate as well as the key's preimage, so the query is tenant-scoped by the DATABASE and not
 * only by a property of a hash.
 */
async function candidateExists(
  client: RawQueryClient, boundaryId: string, dedupeKey: string,
): Promise<boolean> {
  const rows = await client.$queryRaw<{ one: number }[]>`
    SELECT 1 AS one FROM agent_case_candidates
      WHERE dedupe_key = ${dedupeKey} AND boundary_id = ${boundaryId} LIMIT 1`;
  return rows.length > 0;
}

export class PostgresCaseCandidateStore implements CaseCandidateStore {
  constructor(private readonly client: PrismaClient = prisma) {}

  async createIfAbsent(candidate: CaseCandidate): Promise<{ readonly candidate: CaseCandidate; readonly created: boolean }> {
    assertCaseCandidateIdentity(candidate);
    return this.client.$transaction(async (tx) => insertCandidateIfAbsent(tx, candidate));
  }

  async existsByDedupeKey(boundaryId: string, dedupeKey: string): Promise<boolean> {
    return candidateExists(this.client, boundaryId, dedupeKey);
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

  async existsByDedupeKey(boundaryId: string, dedupeKey: string): Promise<boolean> {
    // INSIDE THE CALLER'S TRANSACTION, deliberately. The governed emitter admits a whole execution's
    // signals together, so the overlap check must see the same snapshot the inserts will — a read on
    // a separate connection could miss a row the same transaction is about to write.
    return candidateExists(this.tx, boundaryId, dedupeKey);
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
