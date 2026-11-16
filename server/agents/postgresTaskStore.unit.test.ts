import { describe, expect, it, vi } from "vitest";
import {
  PostgresAgentTaskStore,
  type AgentTaskQueryResult,
  type AgentTaskSqlClient,
  type AgentTaskSqlDatabase,
} from "./postgresTaskStore";
import type { CandidateSignal } from "./types";

const SIGNAL: CandidateSignal = {
  signalId: "signal-1", boundaryId: "tenant-1", recoveryType: "ActivationMissed",
  sourceRef: "crm:1", sourcePayloadHash: "a".repeat(64), detectorVersion: "detector@1",
  observedAt: "2026-09-13T00:00:00.000Z", amountAtRiskMinor: 10_000, currency: "USD",
  actionAvailable: true, expectedProofEvent: "invoice paid",
};

function database(order: string[]): AgentTaskSqlDatabase {
  const client: AgentTaskSqlClient = {
    // A DOUBLE CANNOT MINT AN ARBITRARY `Row`: the production caller chooses that type parameter, so no
    // concrete literal satisfies it. The double returns the exact column shapes the store reads and
    // says so, rather than widening `AgentTaskSqlClient` to accommodate a test — which would weaken the
    // type every production implementation is held to. No assertion is relaxed by this.
    async query<Row extends Record<string, unknown>>(
      text: string,
      values: readonly unknown[],
    ): Promise<AgentTaskQueryResult<Row>> {
      if (/UPDATE agent_tasks/.test(text)) {
        order.push("task");
        return { rowCount: 1, rows: [{
          task_id: "task-1", boundary_id: "tenant-1", agent_id: "detector", idempotency_key: "source-1",
          payload: {}, status: "succeeded", attempt: 1, fencing_epoch: 1, not_before_ms: 0,
          lease_owner: null, lease_token: null, lease_expires_at_ms: null, result: [SIGNAL], last_error: null,
        }] } as unknown as AgentTaskQueryResult<Row>;
      }
      if (/INSERT INTO agent_task_events/.test(text)) {
        order.push("event");
        return { rowCount: 1, rows: [{ event_id: values[0] }] } as unknown as AgentTaskQueryResult<Row>;
      }
      throw new Error("unexpected SQL");
    },
  };
  return { transaction: (work) => work(client) };
}

describe("task success publication seam", () => {
  it("runs candidate publication before the durable success event", async () => {
    const order: string[] = [];
    const sink = { writeWithin: vi.fn(async () => {
      order.push("candidate");
      return { admittedCount: 1, createdCount: 1, filteredCount: 0 };
    }) };
    const store = new PostgresAgentTaskStore(database(order), sink);
    await store.succeed({ taskId: "task-1", boundaryId: "tenant-1", workerId: "worker-1",
      leaseToken: "1:123e4567-e89b-42d3-a456-426614174000", now: 0, result: [SIGNAL] });
    expect(order).toEqual(["task", "candidate", "event"]);
  });

  it("propagates publication failure before an event can be written", async () => {
    const order: string[] = [];
    const store = new PostgresAgentTaskStore(database(order), { writeWithin: async () => { throw new Error("candidate failed"); } });
    await expect(store.succeed({ taskId: "task-1", boundaryId: "tenant-1", workerId: "worker-1",
      leaseToken: "1:123e4567-e89b-42d3-a456-426614174000", now: 0, result: [SIGNAL] }))
      .rejects.toThrow(/candidate failed/);
    expect(order).toEqual(["task"]);
  });
});
