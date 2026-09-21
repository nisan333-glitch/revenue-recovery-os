// EP-12A · Real PostgreSQL acceptance tests for the durable agent runtime.
// Skips in portable environments; CI's postgres-integration job applies migrations first.
import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../db";
import { PrismaAgentTaskSqlDatabase, createPostgresAgentTaskStore } from "./prismaTaskDatabase";
import {
  PostgresAgentTaskStore,
  type AgentTaskQueryResult,
  type AgentTaskSqlClient,
  type AgentTaskSqlDatabase,
} from "./postgresTaskStore";
import type { CandidateSignal } from "./types";

const HAS_DB = !!process.env.DATABASE_URL;
const AGENT_ID = "activation-detector";

interface StatusRow extends Record<string, unknown> {
  status: string;
  attempt: number;
  fencing_epoch: bigint;
  lease_owner: string | null;
  lease_token: string | null;
  result: unknown;
}

interface EventRow extends Record<string, unknown> {
  event_id: string;
  event_sequence: bigint;
  kind: string;
  boundary_id: string;
  fencing_epoch: bigint;
  attempt: number;
}

function id(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function signal(boundaryId: string, signalId = id("signal")): CandidateSignal {
  return {
    signalId,
    boundaryId,
    recoveryType: "ActivationMissed",
    sourceRef: `crm:${id("account")}`,
    sourcePayloadHash: "a".repeat(64),
    detectorVersion: "activation-detector@0.1.0",
    observedAt: "2026-09-09T08:00:00.000Z",
    amountAtRiskMinor: 25_000,
    currency: "USD",
    actionAvailable: true,
    expectedProofEvent: "invoice paid",
  };
}

async function enqueue(
  store: PostgresAgentTaskStore,
  boundaryId: string,
  taskId = id("task"),
  idempotencyKey = id("source"),
) {
  return store.enqueueIfAbsent({
    taskId,
    boundaryId,
    agentId: AGENT_ID,
    idempotencyKey,
    payload: { batch: 1 },
    now: 0,
  });
}

async function statusRow(taskId: string): Promise<StatusRow> {
  const rows = await prisma.$queryRawUnsafe<StatusRow[]>(
    `SELECT status, attempt, fencing_epoch, lease_owner, lease_token, result
       FROM agent_tasks WHERE task_id = $1`,
    taskId,
  );
  const row = rows[0];
  if (!row) throw new Error(`missing task '${taskId}'`);
  return row;
}

async function eventRows(taskId: string): Promise<EventRow[]> {
  return prisma.$queryRawUnsafe<EventRow[]>(
    `SELECT event_id, event_sequence, kind, boundary_id, fencing_epoch, attempt
       FROM agent_task_events WHERE task_id = $1 ORDER BY event_sequence`,
    taskId,
  );
}

class FaultingEventSqlClient implements AgentTaskSqlClient {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly failKind: string,
  ) {}

  async query<Row extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[],
  ): Promise<AgentTaskQueryResult<Row>> {
    if (/INSERT INTO agent_task_events/i.test(text) && values[7] === this.failKind) {
      throw new Error(`injected ${this.failKind} event failure`);
    }
    const rows = await this.transaction.$queryRawUnsafe<Row[]>(text, ...values);
    return { rows, rowCount: rows.length };
  }
}

class FaultingEventDatabase implements AgentTaskSqlDatabase {
  constructor(
    private readonly client: PrismaClient,
    private readonly failKind: string,
  ) {}

  transaction<T>(work: (client: AgentTaskSqlClient) => Promise<T>): Promise<T> {
    return this.client.$transaction(
      (transaction) => work(new FaultingEventSqlClient(transaction, this.failKind)),
      { isolationLevel: "ReadCommitted" },
    );
  }
}

describe.skipIf(!HAS_DB)("EP-12A · PostgreSQL agent task store", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("deduplicates concurrent enqueue within a boundary but not across boundaries", async () => {
    const store = createPostgresAgentTaskStore();
    const key = id("same-source");
    const boundaryA = id("boundary-a");
    const boundaryB = id("boundary-b");
    const [first, second] = await Promise.all([
      enqueue(store, boundaryA, id("task-a"), key),
      enqueue(store, boundaryA, id("task-b"), key),
    ]);

    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
    expect(first.task.taskId).toBe(second.task.taskId);
    const otherBoundary = await enqueue(store, boundaryB, id("task-c"), key);
    expect(otherBoundary.created).toBe(true);
    expect(otherBoundary.task.boundaryId).toBe(boundaryB);
    expect(await eventRows(first.task.taskId)).toHaveLength(1);
  });

  it("scopes claims to one boundary and gives exactly one concurrent worker the task", async () => {
    const store = createPostgresAgentTaskStore();
    const boundaryId = id("boundary");
    const { task } = await enqueue(store, boundaryId);

    expect(await store.claimDue({
      boundaryId: id("other-boundary"),
      agentId: AGENT_ID,
      workerId: "wrong-boundary-worker",
      now: 0,
      leaseMs: 30_000,
      maxAttempts: 3,
    })).toBeNull();

    const claims = await Promise.all(
      Array.from({ length: 24 }, (_, index) => store.claimDue({
        boundaryId,
        agentId: AGENT_ID,
        workerId: `worker-${index}`,
        now: 0,
        leaseMs: 30_000,
        maxAttempts: 3,
      })),
    );
    const winners = claims.filter((claim) => claim !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toMatchObject({ taskId: task.taskId, attempt: 1, fencingEpoch: 1 });
  });

  it("renews a live lease and fences every stale-worker transition after reclaim", async () => {
    const store = createPostgresAgentTaskStore();
    const boundaryId = id("boundary");
    const { task } = await enqueue(store, boundaryId);
    const stale = await store.claimDue({
      boundaryId,
      agentId: AGENT_ID,
      workerId: "worker-stale",
      now: 0,
      leaseMs: 30_000,
      maxAttempts: 3,
    });
    const renewed = await store.renewLease({
      taskId: task.taskId,
      boundaryId,
      workerId: "worker-stale",
      leaseToken: stale!.leaseToken!,
      now: 0,
      leaseMs: 60_000,
    });
    expect(renewed.leaseExpiresAt).toBeGreaterThan(stale!.leaseExpiresAt!);
    expect(renewed.fencingEpoch).toBe(stale!.fencingEpoch);

    await prisma.$executeRawUnsafe(
      `UPDATE agent_tasks SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE task_id = $1`,
      task.taskId,
    );
    const current = await store.claimDue({
      boundaryId,
      agentId: AGENT_ID,
      workerId: "worker-current",
      now: 0,
      leaseMs: 30_000,
      maxAttempts: 3,
    });
    expect(current).toMatchObject({ attempt: 2, fencingEpoch: 2 });

    const staleLease = {
      taskId: task.taskId,
      boundaryId,
      workerId: "worker-stale",
      leaseToken: stale!.leaseToken!,
      now: 0,
    };
    await expect(store.succeed({ ...staleLease, result: [] })).rejects.toThrow(/stale.*invalid task lease/i);
    await expect(store.fail({
      ...staleLease,
      error: "late failure",
      maxAttempts: 3,
      retryDelayMs: 0,
    })).rejects.toThrow(/stale.*invalid task lease/i);
    await expect(store.release({
      ...staleLease,
      reason: "late release",
      retryDelayMs: 0,
    })).rejects.toThrow(/stale.*invalid task lease/i);
    await expect(store.renewLease({ ...staleLease, leaseMs: 30_000 }))
      .rejects.toThrow(/stale.*invalid task lease/i);

    await expect(store.succeed({
      taskId: task.taskId,
      boundaryId,
      workerId: "worker-current",
      leaseToken: current!.leaseToken!,
      now: 0,
      result: [signal(boundaryId)],
    })).resolves.toMatchObject({ status: "succeeded", attempt: 2, fencingEpoch: 2 });

    const events = await eventRows(task.taskId);
    expect(events.map((event) => event.kind)).toEqual([
      "task.enqueued",
      "task.claimed",
      "task.lease_renewed",
      "task.claimed",
      "task.succeeded",
    ]);
    expect(events.map((event) => Number(event.fencing_epoch))).toEqual([0, 1, 1, 2, 2]);
  });

  it("dead-letters both explicit failures and crashed final attempts at the ceiling", async () => {
    const store = createPostgresAgentTaskStore();
    const boundaryId = id("boundary");
    const explicit = await enqueue(store, boundaryId);
    let claim = await store.claimDue({
      boundaryId,
      agentId: AGENT_ID,
      workerId: "worker-a",
      now: 0,
      leaseMs: 30_000,
      maxAttempts: 2,
    });
    await store.fail({
      taskId: explicit.task.taskId,
      boundaryId,
      workerId: "worker-a",
      leaseToken: claim!.leaseToken!,
      error: "first failure",
      now: 0,
      maxAttempts: 2,
      retryDelayMs: 0,
    });
    claim = await store.claimDue({
      boundaryId,
      agentId: AGENT_ID,
      workerId: "worker-b",
      now: 0,
      leaseMs: 30_000,
      maxAttempts: 2,
    });
    const terminal = await store.fail({
      taskId: explicit.task.taskId,
      boundaryId,
      workerId: "worker-b",
      leaseToken: claim!.leaseToken!,
      error: "second failure",
      now: 0,
      maxAttempts: 2,
      retryDelayMs: 0,
    });
    expect(terminal).toMatchObject({ status: "dead_lettered", attempt: 2 });

    const crashed = await enqueue(store, boundaryId);
    const finalClaim = await store.claimDue({
      boundaryId,
      agentId: AGENT_ID,
      workerId: "crashed-worker",
      now: 0,
      leaseMs: 30_000,
      maxAttempts: 1,
    });
    expect(finalClaim?.taskId).toBe(crashed.task.taskId);
    await prisma.$executeRawUnsafe(
      `UPDATE agent_tasks SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE task_id = $1`,
      crashed.task.taskId,
    );
    expect(await store.claimDue({
      boundaryId,
      agentId: AGENT_ID,
      workerId: "recovery-worker",
      now: 0,
      leaseMs: 30_000,
      maxAttempts: 1,
    })).toBeNull();
    expect(await statusRow(crashed.task.taskId)).toMatchObject({
      status: "dead_lettered",
      attempt: 1,
      lease_owner: null,
      lease_token: null,
    });
    expect((await eventRows(crashed.task.taskId)).at(-1)?.kind).toBe("task.dead_lettered");
  });

  it("rejects malformed or cross-boundary CandidateSignals before changing task state", async () => {
    const store = createPostgresAgentTaskStore();
    const boundaryId = id("boundary");
    const { task } = await enqueue(store, boundaryId);
    const claim = await store.claimDue({
      boundaryId,
      agentId: AGENT_ID,
      workerId: "worker-a",
      now: 0,
      leaseMs: 30_000,
      maxAttempts: 3,
    });

    await expect(store.succeed({
      taskId: task.taskId,
      boundaryId,
      workerId: "worker-a",
      leaseToken: claim!.leaseToken!,
      now: 0,
      result: [signal(id("wrong-boundary"))],
    })).rejects.toThrow(/boundary/i);
    expect(await statusRow(task.taskId)).toMatchObject({ status: "leased", result: null });
  });

  it("rolls back a task transition when its durable audit insert fails", async () => {
    const normalStore = createPostgresAgentTaskStore();
    const boundaryId = id("boundary");
    const { task } = await enqueue(normalStore, boundaryId);
    const claim = await normalStore.claimDue({
      boundaryId,
      agentId: AGENT_ID,
      workerId: "worker-a",
      now: 0,
      leaseMs: 30_000,
      maxAttempts: 3,
    });
    const faultingStore = new PostgresAgentTaskStore(
      new FaultingEventDatabase(prisma, "task.succeeded"),
    );

    await expect(faultingStore.succeed({
      taskId: task.taskId,
      boundaryId,
      workerId: "worker-a",
      leaseToken: claim!.leaseToken!,
      now: 0,
      result: [signal(boundaryId)],
    })).rejects.toThrow(/injected task\.succeeded event failure/i);
    expect(await statusRow(task.taskId)).toMatchObject({ status: "leased", result: null });
    expect((await eventRows(task.taskId)).filter((event) => event.kind === "task.succeeded"))
      .toHaveLength(0);
  });

  it("survives store recreation and protects audit identity and append-only history", async () => {
    const boundaryId = id("boundary");
    const key = id("source");
    const firstStore = createPostgresAgentTaskStore();
    const first = await enqueue(firstStore, boundaryId, id("task"), key);
    const secondStore = new PostgresAgentTaskStore(new PrismaAgentTaskSqlDatabase(prisma));
    const afterRestart = await enqueue(secondStore, boundaryId, id("duplicate-task"), key);
    expect(afterRestart).toMatchObject({ created: false });
    expect(afterRestart.task.taskId).toBe(first.task.taskId);

    const event = (await eventRows(first.task.taskId))[0]!;
    await expect(prisma.$executeRawUnsafe(
      `UPDATE agent_task_events SET metadata = '{"tampered":true}'::jsonb WHERE event_id = $1`,
      event.event_id,
    )).rejects.toThrow(/append-only/i);
    await expect(prisma.$executeRawUnsafe(
      `DELETE FROM agent_task_events WHERE event_id = $1`,
      event.event_id,
    )).rejects.toThrow(/append-only/i);
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO agent_task_events (
         event_id, task_id, boundary_id, agent_id, worker_id, fencing_epoch,
         attempt, kind, metadata, created_at
       ) VALUES ($1, $2, $3, $4, NULL, 0, 0, 'task.enqueued', '{}'::jsonb, clock_timestamp())`,
      id("forged-event"),
      first.task.taskId,
      id("forged-boundary"),
      AGENT_ID,
    )).rejects.toThrow();
  });
});
