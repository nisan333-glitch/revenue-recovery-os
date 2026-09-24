-- EP-16 · Pilot assessment orchestration.
--
-- The governed handoff from an admitted dataset into an assessment run. Before this, admission
-- governed a verdict about a FILE and governed nothing about the RUN that used it — assessment
-- happened in the browser, on whatever bytes were in memory, under whatever policy the page held.
--
-- Everything below is ADDITIVE: no DROP, no TRUNCATE, no data rewrite. One nullable column is added
-- to an existing table; every new table rejects UPDATE and DELETE by trigger.

-- 1 · Each admission decision gets a deterministic identifier, derived from its own stored fields.
--
-- Nullable, and deliberately NOT backfilled. Rows written before this migration were never bound to
-- an execution, and computing an identifier for them now would assert a binding that never existed.
-- An execution against such a row is refused with NH-AX-1002, which is the honest answer.
ALTER TABLE "pilot_dataset_submissions"
    ADD COLUMN "admission_decision_id" TEXT;

CREATE INDEX "pilot_dataset_submissions_decision_idx"
    ON "pilot_dataset_submissions" ("boundary_id", "admission_decision_id");

-- 2 · The execution record: the immutable binding, written once.
--
-- The primary key IS the deterministic execution id (sha256 over the whole binding), so scheduling
-- the same binding twice collides here instead of starting a parallel run — idempotency is a
-- property of the key, not of a code path that has to remember to check.
CREATE TABLE "pilot_assessment_executions" (
    "execution_id"             TEXT NOT NULL,
    "boundary_id"              TEXT NOT NULL,
    "dataset_fingerprint"      TEXT NOT NULL,
    "admission_decision_id"    TEXT NOT NULL,
    "admission_policy_id"      TEXT NOT NULL,
    "admission_policy_version" TEXT NOT NULL,
    "admission_policy_hash"    TEXT NOT NULL,
    "contract_version"         TEXT NOT NULL,
    "assessment_policy_id"     TEXT NOT NULL,
    "assessment_policy_version" TEXT NOT NULL,
    "calculation_method_version" TEXT NOT NULL,
    "as_of"                    TEXT NOT NULL,
    "stall_threshold_days"     INTEGER NOT NULL,
    "currency"                 TEXT NOT NULL,
    "mapping_id"               TEXT NOT NULL,
    "amount_format"            TEXT NOT NULL,
    "date_locale"              TEXT NOT NULL,
    -- Optional link to a governed recovery case. When set, that case's Halt blocks this execution.
    "recovery_case_id"         TEXT,
    "binding_hash"             TEXT NOT NULL,
    "input_hash"               TEXT NOT NULL,
    "scheduled_by_actor_id"    TEXT NOT NULL,
    "scheduled_by_role"        TEXT NOT NULL,
    "scheduled_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_assessment_executions_pkey" PRIMARY KEY ("execution_id")
);

-- Defence in depth for tenant isolation: every read filters by boundary as well as id, and this
-- unique pair means a join on (id, boundary) cannot silently succeed across tenants.
CREATE UNIQUE INDEX "pilot_assessment_executions_identity_boundary_unique"
    ON "pilot_assessment_executions" ("execution_id", "boundary_id");

CREATE INDEX "pilot_assessment_executions_boundary_idx"
    ON "pilot_assessment_executions" ("boundary_id", "scheduled_at");

ALTER TABLE "pilot_assessment_executions"
    ADD CONSTRAINT "pilot_assessment_executions_threshold_sane"
        CHECK ("stall_threshold_days" >= 0),
    ADD CONSTRAINT "pilot_assessment_executions_hashes_present"
        CHECK ("binding_hash" LIKE 'sha256:%' AND "input_hash" LIKE 'sha256:%');

CREATE TRIGGER "pilot_assessment_executions_no_mutation"
    BEFORE UPDATE OR DELETE ON "pilot_assessment_executions"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();

-- 3 · The de-identified execution input.
--
-- This is the one place accepted-row-derived values are persisted, and it is why an execution is
-- reproducible rather than merely remembered. Identifiers are replaced by first-appearance ordinals
-- (c-0001, e-0001, r-0001) before they arrive here, so equality classes survive and identities do
-- not. Free-text customer fields (status, plan, segment) never reach this table. REJECTED ROWS HAVE
-- NO REPRESENTATION HERE AT ALL — the projection's only input is the accepted cycles.
CREATE TABLE "pilot_assessment_execution_inputs" (
    "execution_id" TEXT NOT NULL,
    "boundary_id"  TEXT NOT NULL,
    "cycles"       JSONB NOT NULL,
    "cycle_count"  INTEGER NOT NULL,
    "input_hash"   TEXT NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_assessment_execution_inputs_pkey" PRIMARY KEY ("execution_id")
);

CREATE UNIQUE INDEX "pilot_assessment_inputs_identity_boundary_unique"
    ON "pilot_assessment_execution_inputs" ("execution_id", "boundary_id");

ALTER TABLE "pilot_assessment_execution_inputs"
    -- An execution over an empty input would report zeroes that read like findings.
    ADD CONSTRAINT "pilot_assessment_inputs_non_empty" CHECK ("cycle_count" > 0),
    ADD CONSTRAINT "pilot_assessment_inputs_hash_present" CHECK ("input_hash" LIKE 'sha256:%');

CREATE TRIGGER "pilot_assessment_execution_inputs_no_mutation"
    BEFORE UPDATE OR DELETE ON "pilot_assessment_execution_inputs"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();

-- 4 · Append-only lifecycle log. The five states the UI shows are DERIVED from these events; there
-- is deliberately no status column, because a status column can be set to anything by anyone who
-- can write the row, while a derived state can only be what its events produced.
CREATE TABLE "pilot_assessment_execution_events" (
    "id"           TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "boundary_id"  TEXT NOT NULL,
    "transition"   TEXT NOT NULL,
    -- The NH-AX-#### code, when the transition carries one. NULL for ordinary progress.
    "code"         TEXT,
    "by_id"        TEXT NOT NULL,
    "detail"       TEXT NOT NULL,
    "at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_assessment_execution_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pilot_assessment_events_identity_idx"
    ON "pilot_assessment_execution_events" ("boundary_id", "execution_id", "at");

ALTER TABLE "pilot_assessment_execution_events"
    ADD CONSTRAINT "pilot_assessment_events_known_transition" CHECK (
        "transition" IN ('SCHEDULED', 'CLAIMED', 'RELEASED', 'BLOCKED', 'COMPLETED', 'FAILED')
    ),
    -- A blocked or failed transition must name its code; an unexplained stop is not a verdict.
    ADD CONSTRAINT "pilot_assessment_events_code_when_stopped" CHECK (
        "transition" NOT IN ('BLOCKED', 'FAILED') OR "code" IS NOT NULL
    );

CREATE TRIGGER "pilot_assessment_execution_events_no_mutation"
    BEFORE UPDATE OR DELETE ON "pilot_assessment_execution_events"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();

-- 5 · The finding: an OBSERVATION, never a proof and never revenue.
--
-- Keyed by the execution id, so a retry after a committed finding conflicts instead of writing a
-- second answer. The content is deterministic given the binding and the input, so the conflict is
-- either a provable no-op (same hash) or a tamper signal (different hash) — never a silent overwrite.
CREATE TABLE "pilot_assessment_findings" (
    "execution_id"  TEXT NOT NULL,
    "boundary_id"   TEXT NOT NULL,
    "assessment_id" TEXT NOT NULL,
    "finding"       JSONB NOT NULL,
    "finding_hash"  TEXT NOT NULL,
    "produced_by"   TEXT NOT NULL,
    "recorded_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_assessment_findings_pkey" PRIMARY KEY ("execution_id")
);

CREATE UNIQUE INDEX "pilot_assessment_findings_identity_boundary_unique"
    ON "pilot_assessment_findings" ("execution_id", "boundary_id");

ALTER TABLE "pilot_assessment_findings"
    ADD CONSTRAINT "pilot_assessment_findings_hash_present" CHECK ("finding_hash" LIKE 'sha256:%');

CREATE TRIGGER "pilot_assessment_findings_no_mutation"
    BEFORE UPDATE OR DELETE ON "pilot_assessment_findings"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();
