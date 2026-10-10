-- Re-assessment under a new calculation method, as a LINKED REVISION.
--
-- Two nullable columns, no backfill and no default. NULL means "an ordinary first assessment", which is
-- what every existing row is and what they must keep meaning: a default would assert that historical
-- executions revised something, and they did not.
--
-- ADDITIVE ONLY. No existing column is altered, no row is touched, and the append-only trigger on this
-- table is unaffected — a revision is a NEW row, never an edit to the one it points at. The earlier
-- execution and its finding remain exactly as they were, which is what makes this a revision rather
-- than a replacement (Trust Invariant rules 5 and 9).
ALTER TABLE "pilot_assessment_executions"
    ADD COLUMN "revises_execution_id" TEXT,
    ADD COLUMN "revision_reason" TEXT;

-- A revision must say why it exists. Enforced in the database as well as the service, because a reason
-- that can be omitted is a reason nobody will supply, and a revision nobody can explain is indistinguishable
-- from a quiet re-grade.
ALTER TABLE "pilot_assessment_executions"
    ADD CONSTRAINT "pilot_assessment_executions_revision_has_reason" CHECK (
        ("revises_execution_id" IS NULL AND "revision_reason" IS NULL)
        OR ("revises_execution_id" IS NOT NULL AND length(trim("revision_reason")) > 0)
    );

-- An execution may not revise itself. A self-link would make the revision chain a cycle and the
-- "previous result" unresolvable.
ALTER TABLE "pilot_assessment_executions"
    ADD CONSTRAINT "pilot_assessment_executions_revision_not_self" CHECK (
        "revises_execution_id" IS NULL OR "revises_execution_id" <> "execution_id"
    );

-- Reading the revision chain forward: "what revised this?" is the question an auditor asks when looking
-- at a historical finding, and it must not table-scan.
CREATE INDEX "pilot_assessment_executions_revises_idx"
    ON "pilot_assessment_executions" ("boundary_id", "revises_execution_id");
