-- Step 5 · C · The explicit (boundary, datasetFingerprint) → namespace binding, with revisions.
--
-- WHAT IT IS FOR. Inheritance answers the single-source case. A boundary that genuinely draws obligations
-- from two billing systems cannot be resolved by cardinality, and the contract carries no per-row source
-- field, so those bytes must be bound explicitly by governance. This is that binding.
--
-- IT CANNOT EXIST FOR BYTES NOBODY HAS SEEN. The foreign key to `PilotDatasetSightingRecord` means a binding
-- is always about a dataset this boundary actually submitted, and it gives the resolution gate the
-- `first_seen_at` it compares authority against. The sighting record already refuses UPDATE and DELETE, so
-- the same bytes can never be re-sighted under a different first-seen time.
--
-- CORRECTION IS A NEW REVISION, NEVER AN EDIT. `policyLifecycle` has exactly five transitions — PROPOSED,
-- ACTIVATED, FROZEN, UNFROZEN, RETIRED — and no SUPERSEDED. So a mistaken binding is corrected by RETIRING
-- the revision that is wrong and ACTIVATING a new one, both under one advisory lock in one transaction, and
-- the wrong revision stays on the record. Nothing is rewritten.
--
-- AND A RETIRED BINDING DOES NOT FALL BACK TO INHERITANCE. That is the sharpest rule in this migration's
-- reason for existing: if these bytes have ever been explicitly bound, the absence of an ACTIVE revision is
-- a REFUSAL. Falling back would let the correction window silently move authority from explicit to
-- inherited, changing which namespace governs the bytes while nobody decided to. The resolver enforces it;
-- this table simply keeps the whole history so the resolver can tell "never bound" from "bound and retired".

CREATE TABLE "pilot_dataset_source_bindings" (
    "boundary_id"            TEXT NOT NULL,
    "dataset_fingerprint"    TEXT NOT NULL,
    "revision"               INTEGER NOT NULL,
    "namespace_id"           TEXT NOT NULL,
    "registered_by_actor_id" TEXT NOT NULL,
    "registered_by_role"     TEXT NOT NULL,
    "registered_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_dataset_source_bindings_pkey"
        PRIMARY KEY ("boundary_id", "dataset_fingerprint", "revision")
);

CREATE INDEX "pilot_dataset_source_bindings_dataset_idx"
    ON "pilot_dataset_source_bindings" ("boundary_id", "dataset_fingerprint", "revision");

ALTER TABLE "pilot_dataset_source_bindings"
    ADD CONSTRAINT "pilot_dataset_source_bindings_revision_positive" CHECK ("revision" >= 1),
    -- A binding is about bytes this boundary has actually seen, and the sighting supplies the first-seen
    -- time the resolution gate compares governed authority against.
    ADD CONSTRAINT "pilot_dataset_source_bindings_sighting_fkey"
        FOREIGN KEY ("boundary_id", "dataset_fingerprint")
        REFERENCES "PilotDatasetSightingRecord" ("boundary_id", "dataset_fingerprint")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "pilot_dataset_source_bindings_namespace_fkey"
        FOREIGN KEY ("namespace_id") REFERENCES "pilot_source_namespaces" ("namespace_id")
        ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TRIGGER "pilot_dataset_source_bindings_no_mutation"
    BEFORE UPDATE OR DELETE ON "pilot_dataset_source_bindings"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();

CREATE TRIGGER "pilot_dataset_source_bindings_no_truncate"
    BEFORE TRUNCATE ON "pilot_dataset_source_bindings"
    FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();

-- 2 · Append-only lifecycle log, keyed per REVISION.
CREATE TABLE "pilot_dataset_source_binding_events" (
    "id"                  TEXT NOT NULL,
    "boundary_id"         TEXT NOT NULL,
    "dataset_fingerprint" TEXT NOT NULL,
    "revision"            INTEGER NOT NULL,
    "transition"          TEXT NOT NULL,
    "actor_id"            TEXT NOT NULL,
    "actor_role"          TEXT NOT NULL,
    "rationale"           TEXT NOT NULL,
    "at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_dataset_source_binding_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pilot_dataset_source_binding_events_identity_idx"
    ON "pilot_dataset_source_binding_events" ("boundary_id", "dataset_fingerprint", "revision", "at");

ALTER TABLE "pilot_dataset_source_binding_events"
    ADD CONSTRAINT "pilot_dataset_source_binding_events_known_transition" CHECK (
        "transition" IN ('PROPOSED', 'ACTIVATED', 'FROZEN', 'UNFROZEN', 'RETIRED')
    ),
    ADD CONSTRAINT "pilot_dataset_source_binding_events_rationale_present"
        CHECK (length(trim("rationale")) > 0);

CREATE TRIGGER "pilot_dataset_source_binding_events_no_mutation"
    BEFORE UPDATE OR DELETE ON "pilot_dataset_source_binding_events"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();

CREATE TRIGGER "pilot_dataset_source_binding_events_no_truncate"
    BEFORE TRUNCATE ON "pilot_dataset_source_binding_events"
    FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();
