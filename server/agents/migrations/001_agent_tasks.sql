-- Durable queue for the fail-closed agent runtime.
-- Candidate results are observations only; this table grants no Case/Proof authority.

CREATE TABLE IF NOT EXISTS agent_tasks (
  task_id          text PRIMARY KEY,
  boundary_id      text NOT NULL CHECK (btrim(boundary_id) <> ''),
  agent_id         text NOT NULL CHECK (btrim(agent_id) <> ''),
  idempotency_key  text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  payload          jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status           text NOT NULL CHECK (
    status IN ('queued', 'leased', 'retry_wait', 'succeeded', 'dead_lettered')
  ),
  attempt          integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  not_before       timestamptz NOT NULL,
  lease_owner      text,
  -- Token embeds the fencing epoch as "epoch:uuid". Completion statements
  -- require both this capability token and the matching numeric epoch.
  lease_token      text,
  lease_expires_at timestamptz,
  fencing_epoch    bigint NOT NULL DEFAULT 0 CHECK (fencing_epoch >= 0),
  result           jsonb,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at       timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT agent_tasks_boundary_agent_idempotency_unique UNIQUE (boundary_id, agent_id, idempotency_key),
  CONSTRAINT agent_tasks_lease_shape CHECK (
    (status = 'leased' AND lease_owner IS NOT NULL AND btrim(lease_owner) <> ''
     AND lease_token IS NOT NULL
     AND lease_token ~ '^[1-9][0-9]*:[0-9a-fA-F-]{36}$'
     AND lease_expires_at IS NOT NULL)
    OR
    (status <> 'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT agent_tasks_result_shape CHECK (
    result IS NULL OR jsonb_typeof(result) = 'array'
  ),
  CONSTRAINT agent_tasks_succeeded_result CHECK (
    status <> 'succeeded' OR result IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS agent_tasks_due_idx
  ON agent_tasks (boundary_id, agent_id, not_before, created_at, task_id)
  WHERE status IN ('queued', 'retry_wait');

CREATE INDEX IF NOT EXISTS agent_tasks_expired_lease_idx
  ON agent_tasks (boundary_id, agent_id, lease_expires_at, task_id)
  WHERE status = 'leased';

CREATE INDEX IF NOT EXISTS agent_tasks_dead_letter_idx
  ON agent_tasks (boundary_id, agent_id, updated_at, task_id)
  WHERE status = 'dead_lettered';
