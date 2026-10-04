-- Step 5 · D · Source-resolution lineage on the execution, and a key id on the staged attribution.
--
-- WHY THESE COLUMNS ARE NOT IN THE HASHED BINDING. `canonicalBinding` feeds BOTH `hashExecutionBinding` AND
-- `deriveExecutionId`, and the latter is documented as producing "the execution's identity AND its
-- idempotency key". Adding source fields there would change every execution id, so a replay of the same
-- submission would create a NEW execution instead of being recognised as a repeat, the frozen validation
-- cycles' recorded `PAX-…` ids would stop being reproducible, and it would meet the data contract's own
-- definition of a MAJOR change ("Change the identity/idempotency derivation"). So lineage is persisted
-- BESIDE the binding, and `source_resolution_hash` — a deterministic canonical digest over the six lineage
-- fields plus the boundary and the fingerprint — supplies the tamper-evidence the binding hash cannot.
-- Immutability of these columns comes from this table's existing no-mutation trigger, not from the hash.
--
-- EVERY COLUMN IS NULLABLE, AND THAT IS FORCED RATHER THAN CHOSEN. `pilot_assessment_executions` refuses
-- UPDATE and DELETE, so no existing row can ever be backfilled; and the table holds real rows in ordinary
-- test databases (90 in one, 1 in another when this was written). A NOT NULL column without a default would
-- therefore fail the ALTER outright, and a default would be a fabricated value standing where a governed
-- resolution never happened. Historical executions keep NULL, which reads correctly: no governed source
-- authority resolved them, because none existed. NOTHING IS BACKFILLED.
--
-- This mirrors EP-15, which added `admission_outcome` and the admission policy columns to this same table as
-- nullable for the same reason.

ALTER TABLE "pilot_assessment_executions"
    ADD COLUMN "source_namespace_id"           TEXT,
    ADD COLUMN "source_namespace_version"      TEXT,
    ADD COLUMN "source_binding_mode"           TEXT,
    ADD COLUMN "source_permitted_set_id"       TEXT,
    ADD COLUMN "source_permitted_set_version"  TEXT,
    ADD COLUMN "source_binding_revision"       INTEGER,
    ADD COLUMN "source_resolution_hash"        TEXT;

ALTER TABLE "pilot_assessment_executions"
    ADD CONSTRAINT "pilot_assessment_executions_source_binding_mode" CHECK (
        "source_binding_mode" IS NULL OR "source_binding_mode" IN ('explicit', 'inherited')
    ),
    -- An explicit resolution must name the revision that produced it, or the lineage cannot be
    -- reconstructed. An inherited one must NOT carry a revision, because no binding was involved.
    ADD CONSTRAINT "pilot_assessment_executions_explicit_has_revision" CHECK (
        "source_binding_mode" IS DISTINCT FROM 'explicit' OR "source_binding_revision" IS NOT NULL
    ),
    ADD CONSTRAINT "pilot_assessment_executions_inherited_has_no_revision" CHECK (
        "source_binding_mode" IS DISTINCT FROM 'inherited' OR "source_binding_revision" IS NULL
    ),
    -- An inherited resolution must name the set that granted it; an explicit one must not.
    ADD CONSTRAINT "pilot_assessment_executions_inherited_has_set" CHECK (
        "source_binding_mode" IS DISTINCT FROM 'inherited'
        OR ("source_permitted_set_id" IS NOT NULL AND "source_permitted_set_version" IS NOT NULL)
    ),
    -- A resolution is all-or-nothing: either the namespace, its version, the mode and the hash are all
    -- present, or none of them are. A half-written lineage would be unreconstructable and must not exist.
    ADD CONSTRAINT "pilot_assessment_executions_source_lineage_complete" CHECK (
        (
            "source_namespace_id" IS NULL AND "source_namespace_version" IS NULL
            AND "source_binding_mode" IS NULL AND "source_resolution_hash" IS NULL
            AND "source_permitted_set_id" IS NULL AND "source_permitted_set_version" IS NULL
            AND "source_binding_revision" IS NULL
        ) OR (
            "source_namespace_id" IS NOT NULL AND "source_namespace_version" IS NOT NULL
            AND "source_binding_mode" IS NOT NULL AND "source_resolution_hash" IS NOT NULL
        )
    ),
    ADD CONSTRAINT "pilot_assessment_executions_source_hash_shape" CHECK (
        "source_resolution_hash" IS NULL OR "source_resolution_hash" LIKE 'sha256:%'
    );

-- 2 · Which pseudonymisation key produced a staged `source_ref`.
--
-- Q3, and it is an identity problem rather than an ops detail. `source_ref` is persisted and the candidate
-- dedupe key is derived from it under a UNIQUE index whose rows can be neither updated nor deleted. So if
-- the HMAC key changes, the SAME leak instance derives a DIFFERENT pseudonym, hence a different dedupe key,
-- hence a SECOND permanent candidate for one obligation — silently, because nothing recorded which key was
-- in force. Recording the key id makes that failure loud.
--
-- NULLABLE, for the same reason as above: this table is append-only and holds real rows in test databases
-- (2 when this was written), so no backfill is possible. A NULL key id is NOT treated as "current" — the
-- pure predicate returns `source_ref_key_id_missing` and refuses, which is what makes a nullable column safe
-- here rather than a hole. This adds no rotation, no dual-key derivation and no re-keying.
ALTER TABLE "pilot_assessment_entity_attributions"
    ADD COLUMN "source_ref_key_id" TEXT;

ALTER TABLE "pilot_assessment_entity_attributions"
    ADD CONSTRAINT "pilot_assessment_attributions_key_id_present" CHECK (
        "source_ref_key_id" IS NULL OR length(trim("source_ref_key_id")) > 0
    );
