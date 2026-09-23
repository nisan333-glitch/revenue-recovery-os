-- EP-14 · Versioned pilot admission policies, scoped per tenant boundary.
--
-- The thresholds a dataset is judged against are a commercial decision belonging to the people
-- running the pilot, not a default the system picks. They live here, per boundary, and are read
-- back boundary-scoped so one tenant's fitness bar can never judge another tenant's data.
--
-- Append-only: a change is a NEW version, never an edit, so a stamped decision stays reproducible.
CREATE TABLE "pilot_admission_policies" (
    "boundary_id"                     TEXT NOT NULL,
    "policy_id"                       TEXT NOT NULL,
    "policy_version"                  TEXT NOT NULL,
    "calculation_method_version"      TEXT NOT NULL,
    "min_accepted_rows"               INTEGER NOT NULL,
    "min_distinct_entities"           INTEGER NOT NULL,
    "max_rejection_rate"              DOUBLE PRECISION NOT NULL,
    "max_single_reason_share"         DOUBLE PRECISION NOT NULL,
    "max_duplicate_rate"              DOUBLE PRECISION NOT NULL,
    "min_coverage_days"               INTEGER NOT NULL,
    "required_lifecycle_states"       TEXT[] NOT NULL,
    "max_ordering_defect_rate"        DOUBLE PRECISION NOT NULL,
    "max_missing_recommended_columns" INTEGER NOT NULL,
    "require_provenance_declaration"  BOOLEAN NOT NULL,
    "registered_by_actor_id"          TEXT NOT NULL,
    "registered_by_role"              TEXT NOT NULL,
    "registered_at"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_admission_policies_pkey" PRIMARY KEY ("boundary_id", "policy_id", "policy_version")
);

CREATE INDEX "pilot_admission_policies_boundary_idx"
    ON "pilot_admission_policies" ("boundary_id", "policy_id", "registered_at");

-- Thresholds are validated in the domain before they are written; these constraints are the
-- database's own independent refusal, so a direct SQL insert cannot seed an impossible bar.
ALTER TABLE "pilot_admission_policies"
    ADD CONSTRAINT "pilot_admission_policies_rates_are_fractions" CHECK (
        "max_rejection_rate" BETWEEN 0 AND 1
        AND "max_single_reason_share" BETWEEN 0 AND 1
        AND "max_duplicate_rate" BETWEEN 0 AND 1
        AND "max_ordering_defect_rate" BETWEEN 0 AND 1
    ),
    ADD CONSTRAINT "pilot_admission_policies_counts_are_non_negative" CHECK (
        "min_accepted_rows" >= 0
        AND "min_distinct_entities" >= 0
        AND "min_coverage_days" >= 0
        AND "max_missing_recommended_columns" >= 0
    );

-- A published policy version is immutable: editing thresholds under a version that a decision
-- already stamped would silently re-grade a dataset that was judged under the old bar.
CREATE TRIGGER "pilot_admission_policies_no_mutation"
    BEFORE UPDATE OR DELETE ON "pilot_admission_policies"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();
