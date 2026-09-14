import { assertCandidateSignal, canBeCase, type RecoveryTypeAdmissionPolicy } from "./admission";
import { caseCandidateDedupeKey, caseCandidateId } from "./caseAdmission";
import type { AgentTaskSqlClient, AgentTaskSuccessMetadata, AgentTaskSuccessSink } from "./postgresTaskStore";
import type { CandidateSignal } from "./types";

export class PostgresCandidateSignalWriter implements AgentTaskSuccessSink {
  constructor(private readonly policies: ReadonlyMap<string, RecoveryTypeAdmissionPolicy>) {
    if (policies.size === 0) throw new Error("candidate publication requires an admission policy registry");
    for (const [type, policy] of policies) {
      if (type !== policy.recoveryType || !Number.isSafeInteger(policy.economicThresholdMinor) || policy.economicThresholdMinor < 0) {
        throw new Error("candidate admission policy registry is invalid");
      }
    }
  }

  async writeWithin(
    client: AgentTaskSqlClient,
    input: {
      readonly taskId: string;
      readonly boundaryId: string;
      readonly agentId: string;
      readonly signals: readonly CandidateSignal[];
    },
  ): Promise<AgentTaskSuccessMetadata> {
    if (!input.taskId.trim() || !input.boundaryId.trim() || !input.agentId.trim()) {
      throw new Error("task, boundary and agent identity are required for candidate publication");
    }
    let admittedCount = 0;
    let createdCount = 0;
    for (const signal of input.signals) {
      assertCandidateSignal(signal);
      if (signal.boundaryId !== input.boundaryId) throw new Error("CandidateSignal boundary does not match task boundary");
      const policy = this.policies.get(signal.recoveryType);
      if (!policy) throw new Error(`no admission policy exists for recovery type '${signal.recoveryType}'`);
      if (!canBeCase(signal, policy).admitted) continue;
      admittedCount += 1;
      const dedupeKey = caseCandidateDedupeKey(signal);
      const result = await client.query<{ candidate_id: string }>(
        `INSERT INTO agent_case_candidates
           (candidate_id, dedupe_key, boundary_id, agent_id, signal, status, submitted_at, persisted_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'pending_review', clock_timestamp(), clock_timestamp())
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING candidate_id`,
        [caseCandidateId(dedupeKey), dedupeKey, input.boundaryId, input.agentId, JSON.stringify(signal)],
      );
      createdCount += result.rowCount;
    }
    return Object.freeze({
      admittedCount,
      createdCount,
      filteredCount: input.signals.length - admittedCount,
    });
  }
}
