-- Step 5 · B · The boundary permitted-namespace set — per-tenant authority, versioned so it can be stamped.
--
-- WHY THIS IS A SEPARATE OBJECT rather than "the namespaces registered for this boundary". An execution must
-- record WHICH governed authority produced its resolution, and a set derived from N rows has no version to
-- record. Making the set a first-class versioned object is what lets an execution carry
-- `source_permitted_set_id` and `source_permitted_set_version` and be reconstructable without consulting
-- current state. Both are persisted, not the version alone, because a boundary may hold more than one set
-- identity over time.
--
-- MEMBERSHIP REFERENCES THE STABLE NAMESPACE ID, not a version. A set states WHICH SYSTEMS this boundary may
-- draw obligations from; which registered VERSION of a system is in force is a separate governance question,
-- answered at resolution time by requiring exactly one ACTIVE version. Pinning a version here would make a
-- frozen set brittle — a label correction would invalidate it — while pinning nothing would let a retirement
-- silently change the set's meaning. Referencing the id and checking ACTIVE at the gate gets neither defect:
-- a retirement fails loudly instead.
--
-- CARDINALITY IS THE POINT. Inheritance applies only when exactly one namespace is permitted. A boundary
-- with two billing systems is legitimate and simply cannot be resolved by inheritance — it needs an explicit
-- per-dataset binding (migration C). Nothing here ever picks one member of several.

CREATE TABLE "pilot_boundary_source_sets" (
    "boundary_id"            TEXT NOT NULL,
    "set_id"                 TEXT NOT NULL,
    "set_version"            TEXT NOT NULL,
    "registered_by_actor_id" TEXT NOT NULL,
    "registered_by_role"     TEXT NOT NULL,
    "registered_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_boundary_source_sets_pkey" PRIMARY KEY ("boundary_id", "set_id", "set_version")
);

CREATE INDEX "pilot_boundary_source_sets_boundary_idx"
    ON "pilot_boundary_source_sets" ("boundary_id", "registered_at");

ALTER TABLE "pilot_boundary_source_sets"
    ADD CONSTRAINT "pilot_boundary_source_sets_ids_present" CHECK (
        length(trim("boundary_id")) > 0 AND length(trim("set_id")) > 0 AND length(trim("set_version")) > 0
    );

CREATE TRIGGER "pilot_boundary_source_sets_no_mutation"
    BEFORE UPDATE OR DELETE ON "pilot_boundary_source_sets"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();

CREATE TRIGGER "pilot_boundary_source_sets_no_truncate"
    BEFORE TRUNCATE ON "pilot_boundary_source_sets"
    FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();

-- 2 · Members of one set VERSION. Frozen with their version: a change of membership is a new set version
-- with its own proposal and its own activation, so a boundary's permitted sources can never be widened by
-- editing a row.
CREATE TABLE "pilot_boundary_source_set_members" (
    "boundary_id"  TEXT NOT NULL,
    "set_id"       TEXT NOT NULL,
    "set_version"  TEXT NOT NULL,
    "namespace_id" TEXT NOT NULL,

    CONSTRAINT "pilot_boundary_source_set_members_pkey"
        PRIMARY KEY ("boundary_id", "set_id", "set_version", "namespace_id")
);

ALTER TABLE "pilot_boundary_source_set_members"
    ADD CONSTRAINT "pilot_boundary_source_set_members_set_fkey"
        FOREIGN KEY ("boundary_id", "set_id", "set_version")
        REFERENCES "pilot_boundary_source_sets" ("boundary_id", "set_id", "set_version")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    -- The STABLE identity, deliberately. See the header.
    ADD CONSTRAINT "pilot_boundary_source_set_members_namespace_fkey"
        FOREIGN KEY ("namespace_id") REFERENCES "pilot_source_namespaces" ("namespace_id")
        ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TRIGGER "pilot_boundary_source_set_members_no_mutation"
    BEFORE UPDATE OR DELETE ON "pilot_boundary_source_set_members"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();

CREATE TRIGGER "pilot_boundary_source_set_members_no_truncate"
    BEFORE TRUNCATE ON "pilot_boundary_source_set_members"
    FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();

-- 3 · Append-only lifecycle log, keyed per set VERSION.
CREATE TABLE "pilot_boundary_source_set_events" (
    "id"          TEXT NOT NULL,
    "boundary_id" TEXT NOT NULL,
    "set_id"      TEXT NOT NULL,
    "set_version" TEXT NOT NULL,
    "transition"  TEXT NOT NULL,
    "actor_id"    TEXT NOT NULL,
    "actor_role"  TEXT NOT NULL,
    "rationale"   TEXT NOT NULL,
    "at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_boundary_source_set_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pilot_boundary_source_set_events_identity_idx"
    ON "pilot_boundary_source_set_events" ("boundary_id", "set_id", "set_version", "at");

ALTER TABLE "pilot_boundary_source_set_events"
    ADD CONSTRAINT "pilot_boundary_source_set_events_known_transition" CHECK (
        "transition" IN ('PROPOSED', 'ACTIVATED', 'FROZEN', 'UNFROZEN', 'RETIRED')
    ),
    ADD CONSTRAINT "pilot_boundary_source_set_events_rationale_present"
        CHECK (length(trim("rationale")) > 0);

CREATE TRIGGER "pilot_boundary_source_set_events_no_mutation"
    BEFORE UPDATE OR DELETE ON "pilot_boundary_source_set_events"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();

CREATE TRIGGER "pilot_boundary_source_set_events_no_truncate"
    BEFORE TRUNCATE ON "pilot_boundary_source_set_events"
    FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();
