-- EP-13 · Customer pilot dataset submissions.
--
-- Purpose: recognise a repeated upload so the same exposure is not assessed twice.
-- This table is NOT evidence, NOT a case, NOT a proof, and confers no authority.
--
-- Privacy: it stores counts, the deterministic idempotency key, the file fingerprint and the
-- NH-DC-#### codes produced. It never stores uploaded row content, customer identifiers,
-- monetary values, or finding detail text (which can echo a customer value).
CREATE TABLE "pilot_dataset_submissions" (
    "idempotency_key"      TEXT NOT NULL,
    "boundary_id"          TEXT NOT NULL,
    "dataset_id"           TEXT NOT NULL,
    "contract_version"     TEXT NOT NULL,
    "dataset_fingerprint"  TEXT NOT NULL,
    "accepted"             BOOLEAN NOT NULL,
    "usable"               BOOLEAN NOT NULL,
    "data_rows"            INTEGER NOT NULL,
    "accepted_rows"        INTEGER NOT NULL,
    "rejected_rows"        INTEGER NOT NULL,
    "warned_rows"          INTEGER NOT NULL,
    "finding_codes"        TEXT[] NOT NULL,
    "submitted_by_actor_id" TEXT NOT NULL,
    "submitted_by_role"    TEXT NOT NULL,
    "submitted_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_dataset_submissions_pkey" PRIMARY KEY ("idempotency_key")
);

CREATE INDEX "pilot_dataset_submissions_boundary_idx"
    ON "pilot_dataset_submissions" ("boundary_id", "submitted_at");

-- A submission record is append-only, exactly like every other governed record in this schema.
-- Re-uploading an identical file must be recognised as a repeat, never rewritten to look new.
CREATE TRIGGER "pilot_dataset_submissions_no_mutation"
    BEFORE UPDATE OR DELETE ON "pilot_dataset_submissions"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();
