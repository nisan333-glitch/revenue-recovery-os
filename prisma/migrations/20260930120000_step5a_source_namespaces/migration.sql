-- Step 5 · A · The SourceNamespace registry — a stable identity, separately versioned.
--
-- WHY A NEW VOCABULARY AT ALL. Candidate identity needs an authoritative source namespace, and the obvious
-- candidate — the `sourceSystem` values in `NH_EVIDENCE_SOURCE_KEYS` — cannot serve, for three independent
-- reasons established before this was written: that registry refuses any entry without an Ed25519 key, so a
-- customer whose billing system cannot sign could not be named at all; it is built from `process.env` at
-- startup and never persisted, so which namespaces existed when a candidate was created is reconstructable
-- from no record; and `sourceSystem` is load-bearing at CLASS grain in the proof path
-- (`INDEPENDENT_SOURCE_SYSTEMS` decides trust classification, and `OUTCOME_EVIDENCE_TYPES` is keyed on the
-- literal 'billing' to decide `evidenceRole`), so an instance-grained value would be silently downgraded to
-- beneficiary_controlled + supporting, breaking BOTH the independence classification and the
-- outcome-single-use guard. The third reason is why this is a correctness requirement, not tidiness.
--
-- IDENTITY AND VERSION ARE SEPARATE TABLES, on purpose. Boundary permitted-set membership references the
-- STABLE `namespace_id`, so adding a governed version of a namespace never invalidates a set that named it,
-- while governance can still resolve and audit exactly which VERSION was in force. And the candidate
-- identity carries `source_namespace_id` only — never the version — so a governed re-registration of the
-- same real system cannot split one obligation into two candidates.
--
-- THIS TABLE IS NOT BOUNDARY-SCOPED, and that is deliberate. A namespace denotes a real external system; it
-- holds an id and a descriptive label and NO customer data. All per-tenant authority lives in the permitted
-- set (migration B), which is boundary-scoped. Registering a namespace grants nothing by itself.

CREATE TABLE "pilot_source_namespaces" (
    "namespace_id"           TEXT NOT NULL,
    "registered_by_actor_id" TEXT NOT NULL,
    "registered_by_role"     TEXT NOT NULL,
    "registered_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_source_namespaces_pkey" PRIMARY KEY ("namespace_id")
);

ALTER TABLE "pilot_source_namespaces"
    -- The same shape the pure validator enforces, restated in the database so a caller that bypasses the
    -- domain constructor still cannot register a malformed id.
    ADD CONSTRAINT "pilot_source_namespaces_id_shape"
        CHECK ("namespace_id" ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
    -- THE CLASS/INSTANCE GUARD. 'billing' already means an evidence CLASS and the proof path reads it.
    -- Accepting it here would put one string in two meanings, so the database refuses it.
    ADD CONSTRAINT "pilot_source_namespaces_not_evidence_class"
        CHECK ("namespace_id" NOT IN ('billing', 'product', 'crm', 'external'));

-- A stable identity is stable: it is never edited and never deleted.
CREATE TRIGGER "pilot_source_namespaces_no_mutation"
    BEFORE UPDATE OR DELETE ON "pilot_source_namespaces"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();

CREATE TRIGGER "pilot_source_namespaces_no_truncate"
    BEFORE TRUNCATE ON "pilot_source_namespaces"
    FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();

-- 2 · The governed versions. A change to what a namespace MEANS is a new version, never an edit, because
-- editing a label that a historical execution already resolved against would retroactively restate which
-- system that execution measured.
CREATE TABLE "pilot_source_namespace_versions" (
    "namespace_id"           TEXT NOT NULL,
    "namespace_version"      TEXT NOT NULL,
    -- Human-facing description. DESCRIPTIVE ONLY — never part of any identity, so a rename cannot mint a
    -- second identity for one system. It is compared against the uploader's declared billing source.
    "label"                  TEXT NOT NULL,
    "registered_by_actor_id" TEXT NOT NULL,
    "registered_by_role"     TEXT NOT NULL,
    "registered_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_source_namespace_versions_pkey" PRIMARY KEY ("namespace_id", "namespace_version")
);

ALTER TABLE "pilot_source_namespace_versions"
    ADD CONSTRAINT "pilot_source_namespace_versions_namespace_fkey"
        FOREIGN KEY ("namespace_id") REFERENCES "pilot_source_namespaces" ("namespace_id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "pilot_source_namespace_versions_label_present"
        CHECK (length(trim("label")) > 0),
    ADD CONSTRAINT "pilot_source_namespace_versions_version_present"
        CHECK (length(trim("namespace_version")) > 0);

CREATE INDEX "pilot_source_namespace_versions_identity_idx"
    ON "pilot_source_namespace_versions" ("namespace_id", "registered_at");

CREATE TRIGGER "pilot_source_namespace_versions_no_mutation"
    BEFORE UPDATE OR DELETE ON "pilot_source_namespace_versions"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();

CREATE TRIGGER "pilot_source_namespace_versions_no_truncate"
    BEFORE TRUNCATE ON "pilot_source_namespace_versions"
    FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();

-- 3 · Append-only lifecycle log, keyed per VERSION. State is derived from these events and is never stored
-- as a column: a status column can be set to anything by anyone who can write the row, while a derived
-- state can only be what its events produced.
CREATE TABLE "pilot_source_namespace_events" (
    "id"                TEXT NOT NULL,
    "namespace_id"      TEXT NOT NULL,
    "namespace_version" TEXT NOT NULL,
    "transition"        TEXT NOT NULL,
    "actor_id"          TEXT NOT NULL,
    "actor_role"        TEXT NOT NULL,
    "rationale"         TEXT NOT NULL,
    "at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_source_namespace_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pilot_source_namespace_events_identity_idx"
    ON "pilot_source_namespace_events" ("namespace_id", "namespace_version", "at");

ALTER TABLE "pilot_source_namespace_events"
    ADD CONSTRAINT "pilot_source_namespace_events_known_transition" CHECK (
        "transition" IN ('PROPOSED', 'ACTIVATED', 'FROZEN', 'UNFROZEN', 'RETIRED')
    ),
    -- A governance decision with no stated reason is not one.
    ADD CONSTRAINT "pilot_source_namespace_events_rationale_present"
        CHECK (length(trim("rationale")) > 0);

CREATE TRIGGER "pilot_source_namespace_events_no_mutation"
    BEFORE UPDATE OR DELETE ON "pilot_source_namespace_events"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();

CREATE TRIGGER "pilot_source_namespace_events_no_truncate"
    BEFORE TRUNCATE ON "pilot_source_namespace_events"
    FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();
