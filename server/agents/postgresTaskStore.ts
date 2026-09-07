import { randomUUID } from "node:crypto";
import type { AgentTask, AgentTaskStore, AgentTaskStatus, CandidateSignal } from "./types";
import { assertCandidateSignal } from "./admission";

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

interface TaskRow extends Record<string, unknown> {
  task_id: string;
  boundary_id: string;
  agent_id: string;
  idempotency_key: string;
  payload: unknown;
  status: string;
  attempt: number;
  not_before_ms: string | number;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at_ms: string | number | null;
  result: unknown;
  last_error: string | null;
}

function taskColumns(alias: string): string {
  return `
    ${alias}.task_id,
    ${alias}.boundary_id,
    ${alias}.agent_id,
    ${alias}.idempotency_key,
    ${alias}.payload,
    ${alias}.status,
    ${alias}.attempt,
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
 * Durable AgentTaskStore backed by PostgreSQL.
 *
 * The database adapter deliberately exposes only parameterized queries and an
 * explicit transaction boundary. A pg/Prisma-specific adapter can implement
 * these two small interfaces without coupling the runtime contract to a driver.
 */
export class PostgresAgentTaskStore implements AgentTaskStore {
  constructor(private readonly database: AgentTaskSqlDatabase) {}

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
                   to_timestamp($6::double precision / 1000.0), 0,
                   clock_timestamp(), clock_timestamp())
         ON CONFLICT (boundary_id, agent_id, idempotency_key) DO NOTHING
         RETURNING ${taskColumns("task")}`,
        [input.taskId, input.boundaryId, input.agentId, input.idempotencyKey, JSON.stringify(input.payload), input.now],
      );

      if (inserted.rowCount === 1) {
        return { task: mapTask(oneRow(inserted, "enqueue insert")), created: true };
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
    readonly agentId: string;
    readonly workerId: string;
    readonly now: number;
    readonly leaseMs: number;
  }): Promise<AgentTask | null> {
    requireNonBlank("agentId", input.agentId);
    requireNonBlank("workerId", input.workerId);
    requireFiniteTime("now", input.now);
    if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs <= 0) {
      throw new Error("leaseMs must be a positive safe integer");
    }

    const leaseToken = randomUUID();
    return this.database.transaction(async (client) => {
      const claimed = await client.query<TaskRow>(
        `WITH candidate AS (
           SELECT task_id
             FROM agent_tasks
            WHERE agent_id = $1
              AND not_before <= to_timestamp($3::double precision / 1000.0)
              AND (
                status IN ('queued', 'retry_wait')
                OR (status = 'leased' AND lease_expires_at <= to_timestamp($3::double precision / 1000.0))
              )
            ORDER BY not_before ASC, created_at ASC, task_id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE agent_tasks AS task
            SET status = 'leased',
                attempt = task.attempt + 1,
                lease_owner = $2,
                lease_token = (task.fencing_epoch + 1)::text || ':' || $5,
                lease_expires_at = to_timestamp(($3::double precision + $4::double precision) / 1000.0),
                fencing_epoch = task.fencing_epoch + 1,
                updated_at = clock_timestamp()
           FROM candidate
          WHERE task.task_id = candidate.task_id
         RETURNING ${taskColumns("task")}`,
        [input.agentId, input.workerId, input.now, input.leaseMs, leaseToken],
      );
      if (claimed.rowCount === 0) return null;
      return mapTask(oneRow(claimed, "claim"));
    });
  }

  async succeed(input: {
    readonly taskId: string;
    readonly leaseToken: string;
    readonly result: readonly CandidateSignal[];
  }): Promise<AgentTask> {
    return this.mutateLeased(
      `UPDATE agent_tasks AS task
          SET status = 'succeeded', result = $3::jsonb, last_error = NULL,
              lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
              updated_at = clock_timestamp()
        WHERE task_id = $1 AND lease_token = $2 AND status = 'leased'
          AND fencing_epoch = split_part($2, ':', 1)::bigint
          AND lease_expires_at > clock_timestamp()
      RETURNING ${taskColumns("task")}`,
      [input.taskId, input.leaseToken, JSON.stringify(input.result)],
      "succeed",
    );
  }

  async fail(input: {
    readonly taskId: string;
    readonly leaseToken: string;
    readonly error: string;
    readonly now: number;
    readonly maxAttempts: number;
    readonly retryDelayMs: number;
  }): Promise<AgentTask> {
    requireFiniteTime("now", input.now);
    if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts <= 0) {
      throw new Error("maxAttempts must be a positive safe integer");
    }
    if (!Number.isSafeInteger(input.retryDelayMs) || input.retryDelayMs < 0) {
      throw new Error("retryDelayMs must be a non-negative safe integer");
    }
    return this.mutateLeased(
      `UPDATE agent_tasks AS task
          SET status = CASE WHEN attempt >= $4 THEN 'dead_lettered' ELSE 'retry_wait' END,
              not_before = CASE WHEN attempt >= $4 THEN not_before
                                ELSE to_timestamp(($5::double precision + $6::double precision) / 1000.0) END,
              last_error = $3,
              lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
              updated_at = clock_timestamp()
        WHERE task_id = $1 AND lease_token = $2 AND status = 'leased'
          AND fencing_epoch = split_part($2, ':', 1)::bigint
          AND lease_expires_at > clock_timestamp()
      RETURNING ${taskColumns("task")}`,
      [input.taskId, input.leaseToken, input.error, input.maxAttempts, input.now, input.retryDelayMs],
      "fail",
    );
  }

  async release(input: {
    readonly taskId: string;
    readonly leaseToken: string;
    readonly reason: string;
    readonly notBefore: number;
  }): Promise<AgentTask> {
    requireFiniteTime("notBefore", input.notBefore);
    return this.mutateLeased(
      `UPDATE agent_tasks AS task
          SET status = 'retry_wait',
              not_before = to_timestamp($4::double precision / 1000.0),
              last_error = $3,
              lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
              updated_at = clock_timestamp()
        WHERE task_id = $1 AND lease_token = $2 AND status = 'leased'
          AND fencing_epoch = split_part($2, ':', 1)::bigint
          AND lease_expires_at > clock_timestamp()
      RETURNING ${taskColumns("task")}`,
      [input.taskId, input.leaseToken, input.reason, input.notBefore],
      "release",
    );
  }

  private async mutateLeased(
    sql: string,
    values: readonly unknown[],
    operation: string,
  ): Promise<AgentTask> {
    requireNonBlank("taskId", String(values[0] ?? ""));
    requireLeaseToken(String(values[1] ?? ""));
    return this.database.transaction(async (client) => {
      const result = await client.query<TaskRow>(sql, values);
      if (result.rowCount !== 1) {
        throw new Error(`stale, expired, or invalid task lease during ${operation}`);
      }
      return mapTask(oneRow(result, operation));
    });
  }
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
  return Object.freeze(value.map((signal) => {
    assertCandidateSignal(signal);
    return Object.freeze({ ...signal });
  }));
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

function requireLeaseToken(value: string): void {
  if (!/^[1-9][0-9]*:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("leaseToken is invalid");
  }
}
