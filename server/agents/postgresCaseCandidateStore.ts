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

export class PostgresCaseCandidateStore implements CaseCandidateStore {
  constructor(private readonly client: PrismaClient = prisma) {}

  async createIfAbsent(candidate: CaseCandidate): Promise<{ readonly candidate: CaseCandidate; readonly created: boolean }> {
    assertCaseCandidateIdentity(candidate);
    return this.client.$transaction(async (tx) => {
      const inserted = await tx.$queryRaw<Row[]>`
        INSERT INTO agent_case_candidates
          (candidate_id, dedupe_key, boundary_id, agent_id, signal, status, submitted_at, persisted_at)
        VALUES (${candidate.candidateId}, ${candidate.dedupeKey}, ${candidate.boundaryId}, ${candidate.agentId},
                ${JSON.stringify(candidate.signal)}::jsonb, 'pending_review', clock_timestamp(), clock_timestamp())
        ON CONFLICT (dedupe_key) DO NOTHING
        RETURNING candidate_id, dedupe_key, boundary_id, agent_id, signal, submitted_at`;
      if (inserted[0]) return { candidate: mapRow(inserted[0]), created: true };
      const existing = await tx.$queryRaw<Row[]>`
        SELECT candidate_id, dedupe_key, boundary_id, agent_id, signal, submitted_at
          FROM agent_case_candidates WHERE dedupe_key = ${candidate.dedupeKey} FOR SHARE`;
      if (!existing[0]) throw new Error("candidate dedupe conflict could not be resolved");
      return { candidate: mapRow(existing[0]), created: false };
    });
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
