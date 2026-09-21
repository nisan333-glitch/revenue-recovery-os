-- EP-12A · Durable, boundary-scoped runtime for observation-only agents.
-- CandidateSignal results are hypotheses only: these tables grant no Case/Proof authority.

CREATE TABLE "agent_tasks" (
  "task_id"          text        NOT NULL,
  "boundary_id"      text        NOT NULL,
  "agent_id"         text        NOT NULL,
  "idempotency_key"  text        NOT NULL,
  "payload"          jsonb       NOT NULL,
  "status"           text        NOT NULL,
  "attempt"          integer     NOT NULL DEFAULT 0,
  "not_before"       timestamptz(3) NOT NULL,
  "lease_owner"      text,
  "lease_token"      text,
  "lease_expires_at" timestamptz(3),
  "fencing_epoch"    bigint      NOT NULL DEFAULT 0,
  "result"           jsonb,
  "last_error"       text,
  "created_at"       timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_tasks_pkey" PRIMARY KEY ("task_id"),
  CONSTRAINT "agent_tasks_boundary_agent_idempotency_unique"
    UNIQUE ("boundary_id", "agent_id", "idempotency_key"),
  CONSTRAINT "agent_tasks_identity_boundary_unique"
    UNIQUE ("task_id", "boundary_id", "agent_id"),
  CONSTRAINT "agent_tasks_task_id_nonblank" CHECK (btrim("task_id") <> ''),
  CONSTRAINT "agent_tasks_boundary_id_nonblank" CHECK (btrim("boundary_id") <> ''),
  CONSTRAINT "agent_tasks_agent_id_nonblank" CHECK (btrim("agent_id") <> ''),
  CONSTRAINT "agent_tasks_idempotency_key_nonblank" CHECK (btrim("idempotency_key") <> ''),
  CONSTRAINT "agent_tasks_payload_object" CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "agent_tasks_status_valid" CHECK (
    "status" IN ('queued', 'leased', 'retry_wait', 'succeeded', 'dead_lettered')
  ),
  CONSTRAINT "agent_tasks_attempt_nonnegative" CHECK ("attempt" >= 0),
  CONSTRAINT "agent_tasks_fencing_epoch_nonnegative" CHECK ("fencing_epoch" >= 0),
  CONSTRAINT "agent_tasks_lease_shape" CHECK (
    (
      "status" = 'leased'
      AND "lease_owner" IS NOT NULL AND btrim("lease_owner") <> ''
      AND "lease_token" IS NOT NULL
      AND "lease_token" ~ '^[1-9][0-9]*:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      AND split_part("lease_token", ':', 1)::bigint = "fencing_epoch"
      AND "lease_expires_at" IS NOT NULL
    )
    OR
    (
      "status" <> 'leased'
      AND "lease_owner" IS NULL
      AND "lease_token" IS NULL
      AND "lease_expires_at" IS NULL
    )
  ),
  CONSTRAINT "agent_tasks_result_array" CHECK (
    "result" IS NULL OR jsonb_typeof("result") = 'array'
  ),
  CONSTRAINT "agent_tasks_succeeded_has_result" CHECK (
    "status" <> 'succeeded' OR "result" IS NOT NULL
  ),
  CONSTRAINT "agent_tasks_non_succeeded_has_no_result" CHECK (
    "status" = 'succeeded' OR "result" IS NULL
  )
);

CREATE INDEX "agent_tasks_due_idx"
  ON "agent_tasks" ("boundary_id", "agent_id", "not_before", "created_at", "task_id")
  WHERE "status" IN ('queued', 'retry_wait');

CREATE INDEX "agent_tasks_expired_lease_idx"
  ON "agent_tasks" ("boundary_id", "agent_id", "lease_expires_at", "task_id")
  WHERE "status" = 'leased';

CREATE INDEX "agent_tasks_dead_letter_idx"
  ON "agent_tasks" ("boundary_id", "agent_id", "updated_at", "task_id")
  WHERE "status" = 'dead_lettered';

CREATE TABLE "agent_task_events" (
  "event_id"      text        NOT NULL,
  "event_sequence" bigserial  NOT NULL,
  "task_id"       text        NOT NULL,
  "boundary_id"   text        NOT NULL,
  "agent_id"      text        NOT NULL,
  "worker_id"     text,
  "fencing_epoch" bigint      NOT NULL,
  "attempt"       integer     NOT NULL,
  "kind"          text        NOT NULL,
  "metadata"      jsonb       NOT NULL,
  "created_at"    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_task_events_pkey" PRIMARY KEY ("event_id"),
  CONSTRAINT "agent_task_events_sequence_key" UNIQUE ("event_sequence"),
  CONSTRAINT "agent_task_events_task_boundary_agent_fkey"
    FOREIGN KEY ("task_id", "boundary_id", "agent_id")
    REFERENCES "agent_tasks"("task_id", "boundary_id", "agent_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "agent_task_events_event_id_nonblank" CHECK (btrim("event_id") <> ''),
  CONSTRAINT "agent_task_events_boundary_id_nonblank" CHECK (btrim("boundary_id") <> ''),
  CONSTRAINT "agent_task_events_agent_id_nonblank" CHECK (btrim("agent_id") <> ''),
  CONSTRAINT "agent_task_events_worker_id_nonblank" CHECK (
    "worker_id" IS NULL OR btrim("worker_id") <> ''
  ),
  CONSTRAINT "agent_task_events_fencing_epoch_nonnegative" CHECK ("fencing_epoch" >= 0),
  CONSTRAINT "agent_task_events_attempt_nonnegative" CHECK ("attempt" >= 0),
  CONSTRAINT "agent_task_events_kind_valid" CHECK (
    "kind" IN (
      'task.enqueued',
      'task.claimed',
      'task.lease_renewed',
      'task.succeeded',
      'task.retry_scheduled',
      'task.released',
      'task.dead_lettered'
    )
  ),
  CONSTRAINT "agent_task_events_metadata_object" CHECK (jsonb_typeof("metadata") = 'object')
);

CREATE INDEX "agent_task_events_task_sequence_idx"
  ON "agent_task_events" ("task_id", "event_sequence");

CREATE INDEX "agent_task_events_boundary_agent_sequence_idx"
  ON "agent_task_events" ("boundary_id", "agent_id", "event_sequence");

-- Durable runtime events are historical facts. Reuse the append-only function introduced by
-- EP-2 so direct SQL cannot rewrite or delete them after a state transition commits.
CREATE TRIGGER agent_task_events_no_update
  BEFORE UPDATE ON "agent_task_events"
  FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();

CREATE TRIGGER agent_task_events_no_delete
  BEFORE DELETE ON "agent_task_events"
  FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();

CREATE TRIGGER agent_task_events_no_truncate
  BEFORE TRUNCATE ON "agent_task_events"
  FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();
