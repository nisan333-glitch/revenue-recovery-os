-- EP-17 · Truncate guards and bounded, auditable retention for assessment-execution inputs.
--
-- TWO GAPS THIS CLOSES, both found in review of EP-16.
--
-- 1 · TRUNCATE was permitted. EP-16's four tables rejected UPDATE and DELETE per row but installed no
--     statement-level TRUNCATE trigger, unlike `Proof` and `EvidenceRecord`
--     (20260726153500_ep2_immutability). So "append-only" was true row by row and false for the table:
--     one TRUNCATE emptied an audit trail. It was also the only way to delete stored customer-derived
--     rows — an all-or-nothing instrument that could not be scoped to one tenant, which is the
--     opposite of what a deletion obligation needs.
--
-- 2 · There was no retention bound and no deletion path at all. `pilot_assessment_execution_inputs`
--     holds pseudonymised customer-derived rows, and the row-level DELETE trigger made erasure
--     impossible. Indefinite retention of customer-derived data with no purge route is not a
--     conservative default; it is an unbounded one.
--
-- WHAT A PURGE IS HERE. Not a delete. It is an INSERT into an append-only authorization table that
-- preserves the input's hash and cycle count, names the reason and the policy applied, and records who
-- authorized it — followed by the delete, in the same transaction. The audit trail therefore says "an
-- input existed, it had N cycles, its hash was X, it was purged at T by A under policy P for reason
-- R". Nothing about the execution, its binding, its event log or its finding is touched.
--
-- WHY THE TRIGGER DOES NOT KEY ON "A FINDING EXISTS". A finding is written just before the COMPLETED
-- event, so "a finding exists" is true inside the window where the run has not yet durably completed,
-- and it says nothing at all about an execution that was blocked or abandoned. Keying deletion on it
-- would authorize a purge from a fact that is not the fact in question. The trigger instead requires
-- an explicit, recorded authorization whose own INSERT is validated against the durable event log, the
-- task state and the elapsed time.

-- ── 1 · TRUNCATE protection on every EP-16 table ──────────────────────────────────────────────────
-- Statement-level, matching the EP-2 pattern exactly. With these in place the inputs table can be
-- emptied only through the governed purge path below, one execution at a time, with an audit row.

CREATE TRIGGER "pilot_assessment_executions_no_truncate"
    BEFORE TRUNCATE ON "pilot_assessment_executions"
    FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();

CREATE TRIGGER "pilot_assessment_execution_inputs_no_truncate"
    BEFORE TRUNCATE ON "pilot_assessment_execution_inputs"
    FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();

CREATE TRIGGER "pilot_assessment_execution_events_no_truncate"
    BEFORE TRUNCATE ON "pilot_assessment_execution_events"
    FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();

CREATE TRIGGER "pilot_assessment_findings_no_truncate"
    BEFORE TRUNCATE ON "pilot_assessment_findings"
    FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();

-- ── 2 · The purge authorization record ────────────────────────────────────────────────────────────
-- Append-only, boundary-scoped, and it is what survives the input. The hash and cycle count are
-- copied here before the delete, so a purged execution remains verifiable: re-derive the projection
-- from the customer's CSV, hash it, and compare against both this row and
-- `pilot_assessment_executions.input_hash`.

CREATE TABLE "pilot_assessment_input_purges" (
    "execution_id"             TEXT NOT NULL,
    "boundary_id"              TEXT NOT NULL,
    -- Closed set. A new reason is a migration, not a string someone passes in.
    "reason"                   TEXT NOT NULL,
    -- Preserved from the deleted input, so the finding stays reproducible from the source CSV.
    "input_hash"               TEXT NOT NULL,
    "cycle_count"              INTEGER NOT NULL,
    -- The policy ACTUALLY APPLIED, recorded so the arithmetic below is checkable after the fact and
    -- a later change to configuration cannot be mistaken for the rule this purge ran under.
    "terminal_grace_hours"     INTEGER NOT NULL,
    "abandoned_retention_days" INTEGER NOT NULL,
    "authorized_by_actor_id"   TEXT NOT NULL,
    "authorized_by_role"       TEXT NOT NULL,
    "purged_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_assessment_input_purges_pkey" PRIMARY KEY ("execution_id")
);

CREATE UNIQUE INDEX "pilot_assessment_input_purges_identity_boundary_unique"
    ON "pilot_assessment_input_purges" ("execution_id", "boundary_id");

CREATE INDEX "pilot_assessment_input_purges_boundary_idx"
    ON "pilot_assessment_input_purges" ("boundary_id", "purged_at");

ALTER TABLE "pilot_assessment_input_purges"
    ADD CONSTRAINT "pilot_assessment_input_purges_known_reason" CHECK (
        "reason" IN ('terminal_completed', 'terminal_blocked', 'abandoned_retention_elapsed')
    ),
    ADD CONSTRAINT "pilot_assessment_input_purges_hash_present"
        CHECK ("input_hash" LIKE 'sha256:%'),
    ADD CONSTRAINT "pilot_assessment_input_purges_counts_sane"
        CHECK ("cycle_count" > 0 AND "terminal_grace_hours" >= 0 AND "abandoned_retention_days" >= 0);

CREATE TRIGGER "pilot_assessment_input_purges_no_mutation"
    BEFORE UPDATE OR DELETE ON "pilot_assessment_input_purges"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();

CREATE TRIGGER "pilot_assessment_input_purges_no_truncate"
    BEFORE TRUNCATE ON "pilot_assessment_input_purges"
    FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();

-- ── 3 · Authorization is validated where it is created ────────────────────────────────────────────
-- The service decides WHETHER to purge and supplies the configured policy; this function checks that
-- the decision is consistent with the durable record. Both halves matter: a service bug cannot
-- authorize a purge the event log contradicts, and a hand-written INSERT cannot either.
--
-- It cannot defend against an actor who can drop triggers — nothing in a database can. What it does
-- is make every purge consistent with the event log, bounded by a recorded elapsed time, and
-- attributable.

CREATE OR REPLACE FUNCTION nh_assert_input_purge_authorized() RETURNS trigger AS $$
DECLARE
  scheduled       timestamptz;
  completed_at    timestamptz;
  blocked_at      timestamptz;
  has_retryable   boolean;
BEGIN
  SELECT e.scheduled_at INTO scheduled
    FROM "pilot_assessment_executions" e
   WHERE e.execution_id = NEW.execution_id AND e.boundary_id = NEW.boundary_id;
  IF scheduled IS NULL THEN
    RAISE EXCEPTION 'input purge names no execution in this boundary'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- The LATEST terminal event of each kind. Latest, not earliest: a grace period must run from the
  -- most recent time the execution actually reached that state.
  SELECT max(v.at) INTO completed_at FROM "pilot_assessment_execution_events" v
   WHERE v.execution_id = NEW.execution_id AND v.boundary_id = NEW.boundary_id
     AND v.transition = 'COMPLETED';
  SELECT max(v.at) INTO blocked_at FROM "pilot_assessment_execution_events" v
   WHERE v.execution_id = NEW.execution_id AND v.boundary_id = NEW.boundary_id
     AND v.transition = 'BLOCKED';

  -- RETAIN DURING RETRIES, structurally and for every reason. A task that can still be claimed will
  -- need its input again; time elapsed is not a reason to take it away from a run still in flight.
  SELECT EXISTS(
    SELECT 1 FROM "agent_tasks" t
     WHERE t.boundary_id = NEW.boundary_id
       AND t.idempotency_key = NEW.execution_id
       AND t.status NOT IN ('succeeded', 'dead_lettered')
  ) INTO has_retryable;
  IF has_retryable THEN
    RAISE EXCEPTION 'input purge refused: the execution still has a claimable task'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.reason = 'terminal_completed' THEN
    IF completed_at IS NULL THEN
      RAISE EXCEPTION 'input purge claims completion but no COMPLETED event exists'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF completed_at + (NEW.terminal_grace_hours * interval '1 hour') > clock_timestamp() THEN
      RAISE EXCEPTION 'input purge refused: the terminal grace period has not elapsed'
        USING ERRCODE = 'restrict_violation';
    END IF;

  ELSIF NEW.reason = 'terminal_blocked' THEN
    IF blocked_at IS NULL THEN
      RAISE EXCEPTION 'input purge claims a block but no BLOCKED event exists'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF blocked_at + (NEW.terminal_grace_hours * interval '1 hour') > clock_timestamp() THEN
      RAISE EXCEPTION 'input purge refused: the terminal grace period has not elapsed'
        USING ERRCODE = 'restrict_violation';
    END IF;

  ELSIF NEW.reason = 'abandoned_retention_elapsed' THEN
    -- Abandoned means it never reached a terminal state. An execution that DID reach one must be
    -- purged under that reason, so the audit row cannot describe a completed run as abandoned.
    IF completed_at IS NOT NULL OR blocked_at IS NOT NULL THEN
      RAISE EXCEPTION 'input purge claims abandonment but the execution reached a terminal state'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF scheduled + (NEW.abandoned_retention_days * interval '1 day') > clock_timestamp() THEN
      RAISE EXCEPTION 'input purge refused: the abandoned retention period has not elapsed'
        USING ERRCODE = 'restrict_violation';
    END IF;

  ELSE
    -- Unreachable while the CHECK constraint holds; kept so a future reason cannot arrive unvalidated.
    RAISE EXCEPTION 'input purge reason % is not recognised', NEW.reason
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pilot_assessment_input_purges_authorized"
    BEFORE INSERT ON "pilot_assessment_input_purges"
    FOR EACH ROW EXECUTE FUNCTION nh_assert_input_purge_authorized();

-- ── 4 · The input becomes deletable only through a recorded purge ─────────────────────────────────
-- EP-16 rejected UPDATE and DELETE with one trigger. UPDATE stays rejected unconditionally — an input
-- is never edited. DELETE is now permitted only when this execution's purge authorization already
-- exists, which (per §3) means it was validated against the event log, the task state and an elapsed
-- bound. Replacing the trigger does not weaken the audit trail: the execution, its events and its
-- finding keep their original unconditional guards.

DROP TRIGGER "pilot_assessment_execution_inputs_no_mutation" ON "pilot_assessment_execution_inputs";

CREATE OR REPLACE FUNCTION nh_reject_input_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only: UPDATE on pilot_assessment_execution_inputs is rejected (an execution input is never edited; purge it through the governed path instead)'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pilot_assessment_execution_inputs_no_update"
    BEFORE UPDATE ON "pilot_assessment_execution_inputs"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_input_update();

CREATE OR REPLACE FUNCTION nh_assert_input_purge_recorded() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM "pilot_assessment_input_purges" p
     WHERE p.execution_id = OLD.execution_id AND p.boundary_id = OLD.boundary_id
  ) THEN
    RAISE EXCEPTION 'deletion of an execution input requires a recorded purge authorization'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pilot_assessment_execution_inputs_purge_only"
    BEFORE DELETE ON "pilot_assessment_execution_inputs"
    FOR EACH ROW EXECUTE FUNCTION nh_assert_input_purge_recorded();

-- ── 5 · Correcting EP-16's description of what this table holds ───────────────────────────────────
--
-- The EP-16 migration's comment called this "the de-identified execution input" and said "identities
-- do not [survive]". That overstated the protection. The rows are PSEUDONYMISED customer-derived data:
-- direct identifiers are replaced by ordinals, but each cycle still carries several exact dates and
-- one or two exact minor-unit amounts, and those can permit linkage back to the source export or any
-- overlapping extract. No rate of successful re-identification is claimed here — only the exposure.
--
-- That file is already applied, so its text is left alone rather than edited underneath a recorded
-- checksum. The authoritative description is attached to the objects themselves below, where anyone
-- inspecting the schema (\d+, information_schema, a migration diff) reads it without having to find
-- the right migration file.

COMMENT ON TABLE "pilot_assessment_execution_inputs" IS
  'PSEUDONYMISED CUSTOMER-DERIVED DATA, retained under an explicit policy and in scope for data-protection obligations. Direct identifiers (cycle, entity, source row) are replaced by first-appearance ordinals, but exact dates and exact minor-unit amounts remain and can permit linkage back to the customer''s source export or any overlapping extract. Not anonymous. Holds accepted cycles only; a rejected row has no representation here. Purged through the governed path recorded in pilot_assessment_input_purges; see server/services/pilotInputRetention.ts.';

COMMENT ON COLUMN "pilot_assessment_execution_inputs"."cycles" IS
  'Accepted cycles only, with direct identifiers replaced by ordinals and free-text customer fields (status, plan, segment, product) removed. Retains exact dates and exact minor-unit amounts because they are the assessment; those values are what make linkage possible.';

COMMENT ON TABLE "pilot_assessment_input_purges" IS
  'Append-only record of why an execution input was collected, and what survives it: the input hash and cycle count, the reason, the retention policy applied, and who authorized it. Insertion is validated against the durable event log, the task state and an elapsed bound.';
