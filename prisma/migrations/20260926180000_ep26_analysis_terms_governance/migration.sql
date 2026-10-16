-- EP-26 · Governance for analysis terms: the cut-off and the stall definition.
--
-- `as_of` and `stall_threshold_days` decide what an assessment MEASURES. They arrived in a request
-- body, chosen by the party who benefits from the number, while the admission bar — which only
-- decides whether a dataset is fit to judge at all — already required a proposal by one identity and
-- an activation by another. This closes that inversion: Trust Invariant rule 2 says the baseline and
-- the recovery definition are established before the outcome is known.
--
-- Two tables, not an extension of the admission-policy tables. A shared table keyed by one id would
-- let an admission policy id collide with a terms id, so a single governance act could read as the
-- other. The SHAPE is copied on purpose; the storage is not shared.

-- 1 · The registered terms. Append-only per (boundary, id, version): a change is a new version, never
-- an edit, because editing a cut-off that has already produced a finding would silently redefine what
-- that finding measured.
CREATE TABLE "pilot_analysis_terms" (
    "boundary_id"                TEXT NOT NULL,
    "terms_id"                   TEXT NOT NULL,
    "terms_version"              TEXT NOT NULL,
    "as_of"                      TEXT NOT NULL,
    "stall_threshold_days"       INTEGER NOT NULL,
    "calculation_method_version" TEXT NOT NULL,
    "terms_hash"                 TEXT NOT NULL,
    "registered_by_actor_id"     TEXT NOT NULL,
    "registered_by_role"         TEXT NOT NULL,
    "registered_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_analysis_terms_pkey" PRIMARY KEY ("boundary_id", "terms_id", "terms_version")
);

CREATE INDEX "pilot_analysis_terms_boundary_idx"
    ON "pilot_analysis_terms" ("boundary_id", "terms_id", "registered_at");

-- The database refuses a definition the application would also refuse. Defence in depth: a future
-- caller that bypasses the domain constructor still cannot register a cut-off that is not a date or a
-- threshold that is negative, and every downstream day count depends on both.
ALTER TABLE "pilot_analysis_terms"
    ADD CONSTRAINT "pilot_analysis_terms_as_of_iso" CHECK ("as_of" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
    ADD CONSTRAINT "pilot_analysis_terms_as_of_real_date" CHECK (
        to_char(to_date("as_of", 'YYYY-MM-DD'), 'YYYY-MM-DD') = "as_of"
    ),
    ADD CONSTRAINT "pilot_analysis_terms_threshold_range" CHECK (
        "stall_threshold_days" >= 0 AND "stall_threshold_days" <= 3650
    ),
    ADD CONSTRAINT "pilot_analysis_terms_hash_present" CHECK (length(trim("terms_hash")) > 0);

-- Registered terms are frozen forever. An UPDATE here would retroactively change the definition a
-- historical finding was computed under, which is exactly what rule 5 forbids.
CREATE TRIGGER "pilot_analysis_terms_no_mutation"
    BEFORE UPDATE OR DELETE ON "pilot_analysis_terms"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();

-- 2 · Append-only lifecycle log. State is derived from these events, never stored as a column.
CREATE TABLE "pilot_analysis_terms_events" (
    "id"            TEXT NOT NULL,
    "boundary_id"   TEXT NOT NULL,
    "terms_id"      TEXT NOT NULL,
    "terms_version" TEXT NOT NULL,
    "transition"    TEXT NOT NULL,
    "actor_id"      TEXT NOT NULL,
    "actor_role"    TEXT NOT NULL,
    "rationale"     TEXT NOT NULL,
    "at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_analysis_terms_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pilot_analysis_terms_events_identity_idx"
    ON "pilot_analysis_terms_events" ("boundary_id", "terms_id", "terms_version", "at");

ALTER TABLE "pilot_analysis_terms_events"
    ADD CONSTRAINT "pilot_analysis_terms_events_known_transition" CHECK (
        "transition" IN ('PROPOSED', 'ACTIVATED', 'FROZEN', 'UNFROZEN', 'RETIRED')
    ),
    -- A governance decision with no stated reason is not one.
    ADD CONSTRAINT "pilot_analysis_terms_events_rationale_present" CHECK (length(trim("rationale")) > 0);

CREATE TRIGGER "pilot_analysis_terms_events_no_mutation"
    BEFORE UPDATE OR DELETE ON "pilot_analysis_terms_events"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();

-- 3 · Truncation is a mutation with a different verb. Without this, the whole governance history —
-- who proposed a definition and who put it in force — could be erased in one statement while every
-- row-level guard above stayed satisfied.
CREATE TRIGGER "pilot_analysis_terms_no_truncate"
    BEFORE TRUNCATE ON "pilot_analysis_terms"
    FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();

CREATE TRIGGER "pilot_analysis_terms_events_no_truncate"
    BEFORE TRUNCATE ON "pilot_analysis_terms_events"
    FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();
