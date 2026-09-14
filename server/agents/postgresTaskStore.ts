import { randomUUID } from "node:crypto";
import { assertCandidateSignal, assertCandidateSignalBatch } from "./admission";
import type { AgentTask, AgentTaskStatus, AgentTaskStore, CandidateSignal } from "./types";

export interface AgentTaskQueryResult<Row> {
  readonly rows: readonly Row[];
  readonly rowCount: number;
}

export interface AgentTaskSqlClient {
  query<Row extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[],
  ): Promise<AgentTaskQueryResult<Row>>;
}

export interface AgentTaskSqlDatabase {
  transaction<T>(work: (client: AgentTaskSqlClient) => Promise<T>): Promise<T>;
}

export interface AgentTaskSuccessMetadata extends Readonly<Record<string, unknown>> {
  readonly admittedCount: number;
  readonly createdCount: number;
  readonly filteredCount: number;
}

export interface AgentTaskSuccessSink {
  writeWithin(
    client: AgentTaskSqlClient,
    input: {
      readonly taskId: string;
      readonly boundaryId: string;
      readonly agentId: string;
      readonly signals: readonly CandidateSignal[];
    },
  ): Promise<AgentTaskSuccessMetadata>;
}

interface TaskRow extends Record<string, unknown> {
  task_id: string;
  boundary_id: string;
  agent_id: string;
  idempotency_key: string;
  payload: unknown;
  status: string;
  attempt: number;
  fencing_epoch: string | number | bigint;
  not_before_ms: string | number | bigint;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at_ms: string | number | bigint | null;
  result: unknown;
  last_error: string | null;
}

type DurableTaskEventKind =
  | "task.enqueued"
  | "task.claimed"
  | "task.lease_renewed"
  | "task.succeeded"
  | "task.retry_scheduled"
  | "task.released"
  | "task.dead_lettered";

function taskColumns(alias: string): string {
  return `
    ${alias}.task_id,
    ${alias}.boundary_id,
    ${alias}.agent_id,
    ${alias}.idempotency_key,
    ${alias}.payload,
    ${alias}.status,
    ${alias}.attempt,
    ${alias}.fencing_epoch,
    floor(extract(epoch FROM ${alias}.not_before) * 1000)::bigint AS not_before_ms,
    ${alias}.lease_owner,
    ${alias}.lease_token,
    CASE WHEN ${alias}.lease_expires_at IS NULL THEN NULL
         ELSE floor(extract(epoch FROM ${alias}.lease_expires_at) * 1000)::bigint END AS lease_expires_at_ms,
    ${alias}.result,
    ${alias}.last_error
  `;
}

const VALID_STATUSES = new Set<AgentTaskStatus>([
  "queued",
  "leased",
  "retry_wait",
  "succeeded",
  "dead_lettered",
]);

/**
 * Durable, boundary-scoped AgentTaskStore backed by PostgreSQL.
 *
 * Every state transition and its audit event share one database transaction. PostgreSQL's
 * clock is authoritative for due checks, leases, heartbeat renewal and retry scheduling;
 * worker clock skew cannot create an already-expired lease. Fencing uses both the monotonic
 * epoch embedded in the capability token and the worker/boundary identity.
 */
export class PostgresAgentTaskStore implements AgentTaskStore {
  constructor(
    private readonly database: AgentTaskSqlDatabase,
    private readonly successSink?: AgentTaskSuccessSink,
  ) {}

  async enqueueIfAbsent(input: {
    readonly taskId: string;
    readonly boundaryId: string;
    readonly agentId: string;
    readonly idempotencyKey: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly now: number;
  }): Promise<{ readonly task: AgentTask; readonly created: boolean }> {
    requireNonBlank("taskId", input.taskId);
    requireNonBlank("boundaryId", input.boundaryId);
    requireNonBlank("agentId", input.agentId);
    requireNonBlank("idempotencyKey", input.idempotencyKey);
    requireFiniteTime("now", input.now);

    return this.database.transaction(async (client) => {
      const inserted = await client.query<TaskRow>(
        `INSERT INTO agent_tasks AS task (
           task_id, boundary_id, agent_id, idempotency_key, payload, status, attempt,
           not_before, fencing_epoch, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, 'queued', 0,
                   clock_timestamp(), 0, clock_timestamp(), clock_timestamp())
         ON CONFLICT (boundary_id, agent_id, idempotency_key) DO NOTHING
         RETURNING ${taskColumns("task")}`,
        [input.taskId, input.boundaryId, input.agentId, input.idempotencyKey, JSON.stringify(input.payload)],
      );

      if (inserted.rowCount === 1) {
        const row = oneRow(inserted, "enqueue insert");
        await appendTaskEvent(client, row, "task.enqueued", null, {});
        return { task: mapTask(row), created: true };
      }

      const existing = await client.query<TaskRow>(
        `SELECT ${taskColumns("task")}
           FROM agent_tasks AS task
          WHERE boundary_id = $1 AND agent_id = $2 AND idempotency_key = $3
          FOR SHARE`,
        [input.boundaryId, input.agentId, input.idempotencyKey],
      );
      return { task: mapTask(oneRow(existing, "idempotency lookup")), created: false };
    });
  }

  async claimDue(input: {
    readonly boundaryId: string;
    readonly agentId: string;
    readonly workerId: string;
    readonly now: number;
    readonly leaseMs: number;
    readonly maxAttempts: number;
  }): Promise<AgentTask | null> {
    requireNonBlank("boundaryId", input.boundaryId);
    requireNonBlank("agentId", input.agentId);
    requireNonBlank("workerId", input.workerId);
    requireFiniteTime("now", input.now);
    requirePositiveInteger("leaseMs", input.leaseMs);
    requirePositiveInteger("maxAttempts", input.maxAttempts);

    const tokenId = randomUUID();
    return this.database.transaction(async (client) => {
      // A worker may crash on its final attempt without ever calling `fail`. Expired work at
      // the ceiling is terminalized here before any new claim, preventing infinite reclaim.
      const exhausted = await client.query<TaskRow>(
        `WITH exhausted_candidate AS (
           SELECT task_id
             FROM agent_tasks
            WHERE boundary_id = $1 AND agent_id = $2 AND attempt >= $3
              AND (status = 'retry_wait'
                   OR (status = 'leased' AND lease_expires_at <= clock_timestamp()))
            ORDER BY updated_at ASC, task_id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 50
         )
         UPDATE agent_tasks AS task
            SET status = 'dead_lettered',
                last_error = COALESCE(last_error, 'attempt ceiling reached after lease expiry'),
                lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
                updated_at = clock_timestamp()
           FROM exhausted_candidate
          WHERE task.task_id = exhausted_candidate.task_id
        RETURNING ${taskColumns("task")}`,
        [input.boundaryId, input.agentId, input.maxAttempts],
      );
      for (const row of exhausted.rows) {
        await appendTaskEvent(client, row, "task.dead_lettered", null, {
          reason: "attempt ceiling reached during lease recovery",
        });
      }

      const claimed = await client.query<TaskRow>(
        `WITH candidate AS (
           SELECT task_id
             FROM agent_tasks
            WHERE boundary_id = $1
              AND agent_id = $2
              AND attempt < $6
              AND not_before <= clock_timestamp()
              AND (
                status IN ('queued', 'retry_wait')
                OR (status = 'leased' AND lease_expires_at <= clock_timestamp())
              )
            ORDER BY not_before ASC, created_at ASC, task_id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE agent_tasks AS task
            SET status = 'leased',
                attempt = task.attempt + 1,
                lease_owner = $3,
                lease_token = (task.fencing_epoch + 1)::text || ':' || $5,
                lease_expires_at = clock_timestamp() + ($4::double precision * interval '1 millisecond'),
                fencing_epoch = task.fencing_epoch + 1,
                last_error = NULL,
                updated_at = clock_timestamp()
           FROM candidate
          WHERE task.task_id = candidate.task_id
         RETURNING ${taskColumns("task")}`,
        [input.boundaryId, input.agentId, input.workerId, input.leaseMs, tokenId, input.maxAttempts],
      );
      if (claimed.rowCount === 0) return null;
      const row = oneRow(claimed, "claim");
      await appendTaskEvent(client, row, "task.claimed", input.workerId, {});
      return mapTask(row);
    });
  }

  async succeed(input: {
    readonly taskId: string;
    readonly boundaryId: string;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly now: number;
    readonly result: readonly CandidateSignal[];
  }): Promise<AgentTask> {
    requireFiniteTime("now", input.now);
    assertCandidateSignalBatch(input.result, input.boundaryId);
    return this.mutateLeased(
      `UPDATE agent_tasks AS task
          SET status = 'succeeded', result = $5::jsonb, last_error = NULL,
              lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
              updated_at = clock_timestamp()
        WHERE task_id = $1 AND boundary_id = $2 AND lease_owner = $3
          AND lease_token = $4 AND status = 'leased'
          AND fencing_epoch = split_part($4, ':', 1)::bigint
          AND lease_expires_at > clock_timestamp()
      RETURNING ${taskColumns("task")}`,
      [input.taskId, input.boundaryId, input.workerId, input.leaseToken, JSON.stringify(input.result)],
      "succeed",
      "task.succeeded",
      input.workerId,
      { signalCount: input.result.length },
      async (client, row) => this.successSink?.writeWithin(client, {
        taskId: row.task_id,
        boundaryId: row.boundary_id,
        agentId: row.agent_id,
        signals: input.result,
      }),
    );
  }

  async fail(input: {
    readonly taskId: string;
    readonly boundaryId: string;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly error: string;
    readonly now: number;
    readonly maxAttempts: number;
    readonly retryDelayMs: number;
  }): Promise<AgentTask> {
    requireFiniteTime("now", input.now);
    requirePositiveInteger("maxAttempts", input.maxAttempts);
    requireNonNegativeInteger("retryDelayMs", input.retryDelayMs);
    return this.mutateLeased(
      `UPDATE agent_tasks AS task
          SET status = CASE WHEN attempt >= $6 THEN 'dead_lettered' ELSE 'retry_wait' END,
              not_before = CASE WHEN attempt >= $6 THEN not_before
                                ELSE clock_timestamp() + ($7::double precision * interval '1 millisecond') END,
              last_error = $5,
              lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
              updated_at = clock_timestamp()
        WHERE task_id = $1 AND boundary_id = $2 AND lease_owner = $3
          AND lease_token = $4 AND status = 'leased'
          AND fencing_epoch = split_part($4, ':', 1)::bigint
          AND lease_expires_at > clock_timestamp()
      RETURNING ${taskColumns("task")}`,
      [input.taskId, input.boundaryId, input.workerId, input.leaseToken, input.error, input.maxAttempts, input.retryDelayMs],
      "fail",
      null,
      input.workerId,
      { error: input.error },
    );
  }

  async release(input: {
    readonly taskId: string;
    readonly boundaryId: string;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly reason: string;
    readonly now: number;
    readonly retryDelayMs: number;
  }): Promise<AgentTask> {
    requireFiniteTime("now", input.now);
    requireNonNegativeInteger("retryDelayMs", input.retryDelayMs);
    return this.mutateLeased(
      `UPDATE agent_tasks AS task
          SET status = 'retry_wait',
              not_before = clock_timestamp() + ($6::double precision * interval '1 millisecond'),
              last_error = $5,
              lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
              updated_at = clock_timestamp()
        WHERE task_id = $1 AND boundary_id = $2 AND lease_owner = $3
          AND lease_token = $4 AND status = 'leased'
          AND fencing_epoch = split_part($4, ':', 1)::bigint
          AND lease_expires_at > clock_timestamp()
      RETURNING ${taskColumns("task")}`,
      [input.taskId, input.boundaryId, input.workerId, input.leaseToken, input.reason, input.retryDelayMs],
      "release",
      "task.released",
      input.workerId,
      { reason: input.reason },
    );
  }

  async renewLease(input: {
    readonly taskId: string;
    readonly boundaryId: string;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly now: number;
    readonly leaseMs: number;
  }): Promise<AgentTask> {
    requireFiniteTime("now", input.now);
    requirePositiveInteger("leaseMs", input.leaseMs);
    return this.mutateLeased(
      `UPDATE agent_tasks AS task
          SET lease_expires_at = clock_timestamp() + ($5::double precision * interval '1 millisecond'),
              updated_at = clock_timestamp()
        WHERE task_id = $1 AND boundary_id = $2 AND lease_owner = $3
          AND lease_token = $4 AND status = 'leased'
          AND fencing_epoch = split_part($4, ':', 1)::bigint
          AND lease_expires_at > clock_timestamp()
      RETURNING ${taskColumns("task")}`,
      [input.taskId, input.boundaryId, input.workerId, input.leaseToken, input.leaseMs],
      "renew lease",
      "task.lease_renewed",
      input.workerId,
      {},
    );
  }

  private async mutateLeased(
    sql: string,
    values: readonly unknown[],
    operation: string,
    eventKind: DurableTaskEventKind | null,
    workerId: string,
    metadata: Readonly<Record<string, unknown>>,
    afterUpdate?: (
      client: AgentTaskSqlClient,
      row: TaskRow,
    ) => Promise<Readonly<Record<string, unknown>> | undefined>,
  ): Promise<AgentTask> {
    requireNonBlank("taskId", String(values[0] ?? ""));
    requireNonBlank("boundaryId", String(values[1] ?? ""));
    requireNonBlank("workerId", workerId);
    requireLeaseToken(String(values[3] ?? ""));
    return this.database.transaction(async (client) => {
      const result = await client.query<TaskRow>(sql, values);
      if (result.rowCount !== 1) {
        throw new Error(`stale, expired, cross-boundary, or invalid task lease during ${operation}`);
      }
      const row = oneRow(result, operation);
      const additionalMetadata = await afterUpdate?.(client, row);
      const kind = eventKind ?? (row.status === "dead_lettered" ? "task.dead_lettered" : "task.retry_scheduled");
      await appendTaskEvent(client, row, kind, workerId, { ...metadata, ...additionalMetadata });
      return mapTask(row);
    });
  }
}

async function appendTaskEvent(
  client: AgentTaskSqlClient,
  row: TaskRow,
  kind: DurableTaskEventKind,
  workerId: string | null,
  metadata: Readonly<Record<string, unknown>>,
): Promise<void> {
  const inserted = await client.query<{ event_id: string }>(
    `INSERT INTO agent_task_events (
       event_id, task_id, boundary_id, agent_id, worker_id, fencing_epoch,
       attempt, kind, metadata, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, clock_timestamp())
     RETURNING event_id`,
    [
      randomUUID(),
      row.task_id,
      row.boundary_id,
      row.agent_id,
      workerId,
      Number(row.fencing_epoch),
      Number(row.attempt),
      kind,
      JSON.stringify(metadata),
    ],
  );
  oneRow(inserted, `${kind} audit insert`);
}

function mapTask(row: TaskRow): AgentTask {
  if (!VALID_STATUSES.has(row.status as AgentTaskStatus)) {
    throw new Error(`invalid agent task status '${row.status}'`);
  }
  const payload = requireObject(row.payload, "payload");
  const result = row.result === null ? null : requireSignalArray(row.result);
  return Object.freeze({
    taskId: row.task_id,
    boundaryId: row.boundary_id,
    agentId: row.agent_id,
    idempotencyKey: row.idempotency_key,
    payload: Object.freeze({ ...payload }),
    status: row.status as AgentTaskStatus,
    attempt: Number(row.attempt),
    fencingEpoch: Number(row.fencing_epoch),
    notBefore: Number(row.not_before_ms),
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at_ms === null ? null : Number(row.lease_expires_at_ms),
    result,
    lastError: row.last_error,
  });
}

function requireSignalArray(value: unknown): readonly CandidateSignal[] {
  if (!Array.isArray(value)) throw new Error("invalid persisted agent result");
  return Object.freeze(
    value.map((signal) => {
      assertCandidateSignal(signal);
      return Object.freeze({ ...signal });
    }),
  );
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`invalid persisted agent ${name}`);
  }
  return value as Record<string, unknown>;
}

function oneRow<Row>(result: AgentTaskQueryResult<Row>, operation: string): Row {
  const row = result.rows[0];
  if (result.rowCount !== 1 || row === undefined) {
    throw new Error(`agent task ${operation} returned ${result.rowCount} rows`);
  }
  return row;
}

function requireNonBlank(name: string, value: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function requireFiniteTime(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
}

function requireNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
}

function requireLeaseToken(value: string): void {
  if (!/^[1-9][0-9]*:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("leaseToken is invalid");
  }
}
