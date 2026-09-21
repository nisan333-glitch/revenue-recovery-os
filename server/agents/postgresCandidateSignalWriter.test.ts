import { describe, expect, it } from "vitest";
import { PostgresCandidateSignalWriter } from "./postgresCandidateSignalWriter";
import type { AgentTaskQueryResult, AgentTaskSqlClient } from "./postgresTaskStore";
import type { CandidateSignal } from "./types";

const SIGNAL: CandidateSignal = {
  signalId: "signal-1", boundaryId: "tenant-1", recoveryType: "ActivationMissed",
  sourceRef: "crm:account-1", sourcePayloadHash: "a".repeat(64), detectorVersion: "detector@1",
  observedAt: "2026-09-13T00:00:00.000Z", amountAtRiskMinor: 50_000, currency: "USD",
  actionAvailable: true, expectedProofEvent: "invoice paid",
};

class Client implements AgentTaskSqlClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  constructor(private readonly rowCount = 1) {}
  async query<Row extends Record<string, unknown>>(text: string, values: readonly unknown[]): Promise<AgentTaskQueryResult<Row>> {
    this.calls.push({ text, values });
    return { rows: this.rowCount ? [{ candidate_id: values[0] }] as Row[] : [], rowCount: this.rowCount };
  }
}

describe("transactional candidate publication", () => {
  const policies = new Map([["ActivationMissed", { recoveryType: "ActivationMissed", economicThresholdMinor: 10_000 }]]);

  it("publishes admitted signals with deterministic identity", async () => {
    const client = new Client();
    const result = await new PostgresCandidateSignalWriter(policies).writeWithin(client, {
      taskId: "task-1", boundaryId: "tenant-1", agentId: "detector", signals: [SIGNAL],
    });
    expect(result).toEqual({ admittedCount: 1, createdCount: 1, filteredCount: 0 });
    expect(client.calls[0]!.text).toMatch(/INSERT INTO agent_case_candidates/);
    expect(client.calls[0]!.values[0]).toMatch(/^CC-[a-f0-9]{24}$/);
  });

  it("reports dedupe without inventing another candidate", async () => {
    await expect(new PostgresCandidateSignalWriter(policies).writeWithin(new Client(0), {
      taskId: "task-1", boundaryId: "tenant-1", agentId: "detector", signals: [SIGNAL],
    })).resolves.toEqual({ admittedCount: 1, createdCount: 0, filteredCount: 0 });
  });

  it("fails closed for an unknown recovery type", async () => {
    await expect(new PostgresCandidateSignalWriter(policies).writeWithin(new Client(), {
      taskId: "task-1", boundaryId: "tenant-1", agentId: "detector",
      signals: [{ ...SIGNAL, recoveryType: "Unknown" }],
    })).rejects.toThrow(/no admission policy/);
  });

  it("rejects cross-boundary output", async () => {
    await expect(new PostgresCandidateSignalWriter(policies).writeWithin(new Client(), {
      taskId: "task-1", boundaryId: "tenant-2", agentId: "detector", signals: [SIGNAL],
    })).rejects.toThrow(/boundary/);
  });
});
